import {
  createFunctionHandle,
  DocumentByName,
  Expand,
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  getFunctionName,
  internalMutationGeneric,
  makeFunctionReference,
  MutationBuilder,
  NamedTableInfo,
  OrderedQuery,
  QueryInitializer,
  RegisteredMutation,
  TableNamesInDataModel,
} from "convex/server";
import {
  MigrationArgs,
  migrationArgs,
  migrationResult,
  MigrationResult,
  MigrationStatus,
} from "../shared.js";
export type { MigrationArgs, MigrationResult, MigrationStatus };
import { api } from "../component/_generated/api.js"; // the component's public api

import { ConvexError, GenericId, v } from "convex/values";

// Note: this value is hard-coded in the docstring below. Please keep in sync.
export const DEFAULT_BATCH_SIZE = 100;

export class Migrations<DataModel extends GenericDataModel> {
  /**
   * Makes the migration wrapper, with types for your own tables.
   *
   * It will keep track of migration state.
   * Add in convex/migrations.ts for example:
   * ```ts
   * import { Migrations } from "@convex-dev/migrations";
   * import { components } from "./_generated/api.js";
   * import { internalMutation } from "./_generated/server";
   *
   * export const migrations = new Migrations(components.migrations, { internalMutation });
   * // the private mutation to run migrations.
   * export const run = migrations.runFromCLI();
   *
   * export const myMigration = migrations.define({
   *  table: "users",
   *  migrateOne: async (ctx, doc) => {
   *    await ctx.db.patch(doc._id, { someField: "value" });
   *  }
   * });
   * ```
   * You can then run it from the CLI or dashboard:
   * ```sh
   * npx convex run migrations:run '{"fn": "migrations:myMigration"}'
   * ```
   * For starting a migration from code, see {@link runOne}/{@link runSerially}.
   * @param component - The migrations component. It will be on components.migrations
   * after being configured in in convex.config.js.
   * @param options - Configure options and set the internalMutation to use.
   */
  constructor(
    public component: UseApi<typeof api>,
    public options?: {
      /**
       * Uses the internal mutation to run the migration.
       * This also provides the types for your tables.
       * ```ts
       * import { internalMutation } from "./_generated/server.js";
       * ```
       */
      internalMutation?: MutationBuilder<DataModel, "internal">;
      /**
       * How many documents to process in a batch.
       * Your migrateOne function will be called for each document in a batch in
       * a single transaction.
       */
      defaultBatchSize?: number;
      /**
       * Prefix to add to the function name when running migrations.
       * For example, if you have a function named "foo" in a file
       * "convex/bar/baz.ts", you can set {migrationsLocationPrefix: "bar/baz:"}
       * and then run:
       * ```sh
       * npx convex run migrations:run '{"fn": "foo"}'
       * ```
       */
      migrationsLocationPrefix?: string;
    }
  ) {}

  /**
   * Creates a migration runner that can be called from the CLI or dashboard.
   *
   * For starting a migration from code, see {@link runOne}/{@link runSerially}.
   *
   * It can be created for a specific migration:
   * ```ts
   * export const runMyMigration = runFromCLI(internal.migrations.myMigration);
   * ```
   * CLI: `npx convex run migrations:runMyMigration`
   *
   * Or for any migration:
   * ```ts
   * export const run = runFromCLI();
   * ```
   * CLI: `npx convex run migrations:run '{"fn": "migrations:myMigration"}'`
   *
   * Where `myMigration` is the name of the migration function, defined in
   * "convex/migrations.ts" along with the run function.
   *
   * @param specificMigration If you want a migration runner for one migration,
   * pass in the migration function reference like `internal.migrations.foo`.
   * Otherwise it will be a generic runner that requires the migration name.
   * @returns An internal mutation,
   */
  runFromCLI(specificMigration?: MigrationFunctionReference) {
    return internalMutationGeneric({
      args: {
        fn: v.optional(v.string()),
        cursor: v.optional(v.union(v.string(), v.null())),
        batchSize: v.optional(v.number()),
        dryRun: v.optional(v.boolean()),
        next: v.optional(v.array(v.string())),
      },
      handler: async (ctx, args) => {
        // Future: Call it so that it can return the id: ctx.runMutation?
        if (args.fn && specificMigration) {
          throw new Error("Specify only one of fn or specificMigration");
        }
        if (!args.fn && !specificMigration) {
          throw new Error(
            `Specify the migration: '{"fn": "migrations:foo"}'\n` +
              "Or initialize a `runFromCLI` runner specific to the migration like\n" +
              "`export const runMyMigratio = runFromCLI(internal.migrations.myMigration)`"
          );
        }
        const name = args.fn
          ? this.prefixedName(args.fn)
          : getFunctionName(specificMigration!);
        async function makeFn(fn: string) {
          try {
            return await createFunctionHandle(
              makeFunctionReference<"mutation">(fn)
            );
          } catch {
            throw new Error(
              `Can't find function ${fn}\n` +
                "The name should match the folder/file:method\n" +
                "See https://docs.convex.dev/functions/query-functions#query-names"
            );
          }
        }
        const fnHandle = args.fn
          ? await makeFn(name)
          : await createFunctionHandle(specificMigration!);
        const next =
          args.next &&
          (await Promise.all(
            args.next.map(async (nextFn) => ({
              name: this.prefixedName(nextFn),
              fnHandle: await makeFn(this.prefixedName(nextFn)),
            }))
          ));
        return ctx.runMutation(this.component.public.runMigration, {
          name,
          fnHandle,
          cursor: args.cursor,
          batchSize: args.batchSize,
          next,
          dryRun: args.dryRun ?? false,
        });
      },
    });
  }

  /**
   * Use this to wrap a mutation that will be run over all documents in a table.
   * Your mutation only needs to handle changing one document at a time,
   * passed into migrateOne.
   * Optionally specify a custom batch size to override the default (100).
   *
   * In convex/migrations.ts for example:
   * ```ts
   * export const foo = migrations.define({
   *  table: "users",
   *  migrateOne: async (ctx, doc) => {
   *   await ctx.db.patch(doc._id, { someField: "value" });
   *  },
   * });
   * ```
   *
   * You can run this manually from the CLI or dashboard:
   * ```sh
   * # Start or resume a migration. No-ops if it's already done:
   * npx convex run migrations:run '{"fn": "migrations:foo"}'
   *
   * # Restart a migration from a cursor (null is from the beginning):
   * npx convex run migrations:run '{"fn": "migrations:foo", "cursor": null }'
   *
   * # Dry run - runs one batch but doesn't schedule or commit changes.
   * # so you can see what it would do without committing the transaction.
   * npx convex run migrations:run '{"fn": "migrations:foo", "dryRun": true}'
   * # or
   * npx convex run migrations:myMigration '{"dryRun": true}'
   *
   * # Run many migrations serially:
   * npx convex run migrations:run '{"fn": "migrations:foo", "next": ["migrations:bar", "migrations:baz"] }'
   * ```
   *
   * The fn is the string form of the function reference. See:
   * https://docs.convex.dev/functions/query-functions#query-names
   *
   * See {@link runOne} and {@link runSerially} for programmatic use.
   *
   * @param table - The table to run the migration over.
   * @param migrateOne - The function to run on each document.
   * @param batchSize - The number of documents to process in a batch.
   *   If not set, defaults to the value passed to makeMigration,
   *   or {@link DEFAULT_BATCH_SIZE}. Overriden by arg at runtime if supplied.
   * @returns An internal mutation that runs the migration.
   */
  define<TableName extends TableNamesInDataModel<DataModel>>({
    table,
    migrateOne,
    customRange,
    batchSize: functionDefaultBatchSize,
  }: {
    table: TableName;
    migrateOne: (
      ctx: GenericMutationCtx<DataModel>,
      doc: DocumentByName<DataModel, TableName> & { _id: GenericId<TableName> }
    ) =>
      | void
      | Partial<DocumentByName<DataModel, TableName>>
      | Promise<Partial<DocumentByName<DataModel, TableName>> | void>;
    customRange?: (
      q: QueryInitializer<NamedTableInfo<DataModel, TableName>>
    ) => OrderedQuery<NamedTableInfo<DataModel, TableName>>;
    batchSize?: number;
  }) {
    const defaultBatchSize =
      functionDefaultBatchSize ??
      this.options?.defaultBatchSize ??
      DEFAULT_BATCH_SIZE;
    // Under the hood it's an internal mutation that calls the migrateOne
    // function for every document in a page, recursively scheduling batches.
    return (
      (this.options?.internalMutation as MutationBuilder<
        DataModel,
        "internal"
      >) ?? (internalMutationGeneric as MutationBuilder<DataModel, "internal">)
    )({
      args: migrationArgs,
      returns: migrationResult,
      handler: async (ctx, args) => {
        const numItems = args.batchSize || defaultBatchSize;
        if (args.batchSize === 0) {
          console.warn(
            `Batch size is zero. Using the default: ${numItems}\n` +
              "Running this from the dashboard? Here's some args to use:\n" +
              `Dry run: { dryRun: true, cursor: null }\n` +
              'For real: run `migrations:run` with { fn: "migrations:yourFnName" }'
          );
        }
        if (
          (args.cursor === undefined || args.cursor === "") &&
          args.dryRun === undefined
        ) {
          console.warn(
            "No cursor or dryRun specified - doing a dry run on the first batch"
          );
          args.cursor = null;
          args.dryRun = true;
        }
        if (args.cursor === "" || args.cursor === undefined) {
          if (args.dryRun) {
            console.warn("Setting cursor to null for dry run");
            args.cursor = null;
          } else {
            throw new Error(`Cursor must be specified for a one-off execution.
              Use null to start from the beginning.
              Use the value in the migrations database to pick up from where it left off.`);
          }
        }

        const q = ctx.db.query(table);
        const range = customRange ? customRange(q) : q;
        const { continueCursor, page, isDone } = await range.paginate({
          cursor: args.cursor,
          numItems,
        });
        for (const doc of page) {
          try {
            const next = await migrateOne(
              ctx,
              doc as { _id: GenericId<TableName> }
            );
            if (next && Object.keys(next).length > 0) {
              await ctx.db.patch(doc._id as GenericId<TableName>, next);
            }
          } catch (error) {
            console.error(`Document failed: ${doc._id}`);
            throw error;
          }
        }
        const result = {
          continueCursor,
          isDone,
          processed: page.length,
        };
        if (args.dryRun) {
          // Throwing an error rolls back the transaction
          console.debug({
            before: page[0],
            after:
              page[0] &&
              (await ctx.db.get(page[0]!._id as GenericId<TableName>)),
            result,
          });
          throw new ConvexError({
            kind: "DRY RUN",
            result,
          });
        }
        if (args.dryRun === undefined) {
          // We are running it in a one-off mode.
          // The component will always provide dryRun.
          // A bit of a hack / implicit, but non-critical logging.
          console.debug(`Next cursor: ${continueCursor}`);
        }
        return result;
      },
    }) satisfies RegisteredMutation<
      "internal",
      MigrationArgs,
      Promise<MigrationResult>
    >;
  }

  /**
   * Start a migration from a server function via a function reference.
   *
   * ```ts
   * const migrations = new Migrations(components.migrations, { internalMutation });
   *
   * // in a mutation or action:
   *   await migrations.runOne(ctx, internal.migrations.myMigration, {
   *     cursor: null, // optional override
   *     batchSize: 10, // optional override
   *   });
   * ```
   *
   * Overrides any options you passed in, such as resetting the cursor.
   * If it's already in progress, it will no-op.
   * If you run a migration that had previously failed which was part of a series,
   * it will not resume the series.
   * To resume a series, call the series again: {@link Migrations.runSerially}.
   *
   * Note: It's up to you to determine if it's safe to run a migration while
   * others are in progress. It won't run multiple instance of the same migration
   * but it currently allows running multiple migrations on the same table.
   *
   * @param ctx Context from a mutation or action. Needs `runMutation`.
   * @param fnRef The migration function to run. Like `internal.migrations.foo`.
   * @param opts Options to start the migration.
   * @param opts.cursor The cursor to start from.
   *   null: start from the beginning.
   *   undefined: start or resume from where it failed. If done, it won't restart.
   * @param opts.batchSize The number of documents to process in a batch.
   * @param opts.dryRun If true, it will run a batch and then throw an error.
   *   It's helpful to see what it would do without committing the transaction.
   */
  async runOne(
    ctx: RunMutationCtx,
    fnRef: MigrationFunctionReference,
    opts?: {
      cursor?: string | null;
      batchSize?: number;
      dryRun?: boolean;
    }
  ) {
    // Future: Call it so that it can return the id: ctx.runMutation?
    await ctx.runMutation(this.component.public.runMigration, {
      name: getFunctionName(fnRef),
      fnHandle: await createFunctionHandle(fnRef),
      cursor: opts?.cursor,
      batchSize: opts?.batchSize,
      dryRun: opts?.dryRun ?? false,
    });
  }

  /**
   * Start a series of migrations, running one a time. Each call starts a series.
   *
   * ```ts
   * const migrations = new Migrations(components.migrations, { internalMutation });
   *
   * // in a mutation or action:
   *   await migrations.runSerially(ctx, [
   *    internal.migrations.myMigration,
   *    internal.migrations.myOtherMigration,
   *   ]);
   * ```
   *
   * It runs one batch at a time currently.
   * If a migration has previously completed it will skip it.
   * If a migration had partial progress, it will resume from where it left off.
   * If a migration is already in progress when attempted, it will no-op.
   * If a migration fails or is canceled, it will stop executing and NOT execute
   * any subsequent migrations in the series. Call the series again to retry.
   *
   * This is useful to run as an post-deploy script where you specify all the
   * live migrations that should be run.
   *
   * Note: if you start multiple serial migrations, the behavior is:
   * - If they don't overlap on functions, they will happily run in parallel.
   * - If they have a function in common and one completes before the other
   *   attempts it, the second will just skip it.
   * - If they have a function in common and one is in progress, the second will
   *   no-op and not run any further migrations in its series.
   *
   * To stop a migration in progress, see {@link cancelMigration}.
   *
   * @param ctx Context from a mutation or action. Needs `runMutation`.
   * @param fnRefs The migrations to run in order. Like [internal.migrations.foo].
   */
  async runSerially(ctx: RunMutationCtx, fnRefs: MigrationFunctionReference[]) {
    if (fnRefs.length === 0) return;
    const [fnRef, ...rest] = fnRefs;
    const next = await Promise.all(
      rest.map(async (fnRef) => ({
        name: getFunctionName(fnRef),
        fnHandle: await createFunctionHandle(fnRef),
      }))
    );
    await ctx.runMutation(this.component.public.runMigration, {
      name: getFunctionName(fnRef),
      fnHandle: await createFunctionHandle(fnRef),
      next,
      dryRun: false,
    });
  }

  /**
   * Get the status of a migration or all migrations.
   * @param ctx Context from a query, mutation or action. Needs `runQuery`.
   * @param migrations The migrations to get the status of. Defaults to all.
   * @param limit How many migrations to fetch, if not specified by name.
   * @returns The status of the migrations, in the order of the input.
   */
  async getStatus(
    ctx: RunQueryCtx,
    {
      migrations,
      limit,
    }: {
      migrations?: (string | MigrationFunctionReference)[];
      limit?: number;
    }
  ): Promise<MigrationStatus[]> {
    const migrationNames = migrations?.map((m) =>
      typeof m === "string" ? this.prefixedName(m) : getFunctionName(m)
    );
    return ctx.runQuery(this.component.public.getStatus, {
      migrationNames,
      limit,
    });
  }

  /**
   * Cancels a migration if it's in progress.
   * You can resume it later by calling the migration without an explicit cursor.
   * If the migration had "next" migrations, e.g. from {@link runSerially},
   * they will not run. To resume, call the series again or manually pass "next".
   * @param ctx Context from a mutation or action. Needs `runMutation`.
   * @param migration Migration to cancel. Either the name like "migrations:foo"
   * or the function reference like `internal.migrations.foo`.
   * @returns The status of the migration after attempting to cancel it.
   */
  async cancel(
    ctx: RunMutationCtx,
    migration: MigrationFunctionReference | string
  ): Promise<MigrationStatus> {
    const name =
      typeof migration === "string"
        ? this.prefixedName(migration)
        : getFunctionName(migration);
    return ctx.runMutation(this.component.public.cancel, {
      name,
    });
  }

  /**
   * Cancels all migrations that are in progress.
   * You can resume it later by calling the migration without an explicit cursor.
   * If the migration had "next" migrations, e.g. from {@link runSerially},
   * they will not run. To resume, call the series again or manually pass "next".
   * @param ctx Context from a mutation or action. Needs `runMutation`.
   * @returns The status of up to 100 of the canceled migrations.
   */
  async cancelAll(ctx: RunMutationCtx) {
    return ctx.runMutation(this.component.public.cancelAll, {});
  }

  // Helper to prefix the name with the location.
  // migrationsLocationPrefix of "bar/baz:" and name "foo" => "bar/baz:foo"
  private prefixedName(name: string) {
    return this.options?.migrationsLocationPrefix && !name.includes(":")
      ? `${this.options.migrationsLocationPrefix}${name}`
      : name;
  }
}

export type MigrationFunctionReference = FunctionReference<
  "mutation",
  "internal",
  MigrationArgs
>;

/* Type utils follow */

type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};

export type OpaqueIds<T> =
  T extends GenericId<infer _T>
    ? string
    : T extends (infer U)[]
      ? OpaqueIds<U>[]
      : T extends object
        ? { [K in keyof T]: OpaqueIds<T[K]> }
        : T;

export type UseApi<API> = Expand<{
  [mod in keyof API]: API[mod] extends FunctionReference<
    infer FType,
    "public",
    infer FArgs,
    infer FReturnType,
    infer FComponentPath
  >
    ? FunctionReference<
        FType,
        "internal",
        OpaqueIds<FArgs>,
        OpaqueIds<FReturnType>,
        FComponentPath
      >
    : UseApi<API[mod]>;
}>;
