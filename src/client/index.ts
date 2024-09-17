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
import { api } from "../component/_generated/api.js"; // the component's public api

import { ConvexError, GenericId, v } from "convex/values";

export const DEFAULT_BATCH_SIZE = 100;

/**
 * Makes the migration wrapper, with types for your own tables.
 *
 * It will keep track of migration state.
 * Add in convex/migrations.ts for example:
 * ```ts
 * import defineMigrations from "@get-convex/migrations";
 * import { components } from "./_generated/api.js";
 * import { internalMutation } from "./_generated/server";
 *
 * export const { migration, run } = defineMigrations(components.migrations, { internalMutation });
 *
 * export const myMigration = migration({
 *  table: "users",
 *  migrateOne: async (ctx, doc) => {
 *    await ctx.db.patch(doc._id, { newField: "value" });
 *  }
 * });
 * ```
 * You can then run it from the CLI or dashboard:
 * ```sh
 * npx convex run migrations:run '{"fn": "migrations:myMigration"}'
 * ```
 * @param internalMutation - The internal mutation to use for the migration.
 * @param options - Configure options and set the internalMutation to use.
 */
export function defineMigrations<DataModel extends GenericDataModel>(
  migrationsComponent: UseApi<typeof api>,
  options: {
    /**
     * Uses the internal mutation to run the migration.
     * This also provides the types for your tables.
     * ```ts
     * import { internalMutation } from "./_generated/server.js";
     * ```
     */
    internalMutation: MutationBuilder<DataModel, "internal">;
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
     * npx convex run migrations: '{"fn": "foo"}'
     * ```
     */
    migrationsLocationPrefix?: string;
  }
) {
  function prefixedName(name: string) {
    return options.migrationsLocationPrefix && !name.includes(":")
      ? `${options.migrationsLocationPrefix}${name}`
      : name;
  }
  /**
   * Use this to wrap a mutation that will be run over all documents in a table.
   * Your mutation only needs to handle changing one document at a time,
   * passed into migrateOne.
   * Optionally specify a custom batch size to override the default.
   *
   * In convex/migrations.ts for example:
   * ```ts
   * export const foo = migration({
   *  table: "users",
   *  migrateOne: async (ctx, doc) => {
   *   await ctx.db.patch(doc._id, { newField: "value" });
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
   * See {@link startMigration} and {@link startMigrationsSerially} for programmatic use.
   *
   * @param table - The table to run the migration over.
   * @param migrateOne - The function to run on each document.
   * @param batchSize - The number of documents to process in a batch.
   *   If not set, defaults to the value passed to makeMigration,
   *   or {@link DEFAULT_BATCH_SIZE}. Overriden by arg at runtime if supplied.
   * @returns An internal mutation that runs the migration.
   */
  function migration<TableName extends TableNamesInDataModel<DataModel>>({
    table,
    migrateOne,
    batchSize: functionDefaultBatchSize,
  }: {
    table: TableName;
    migrateOne: (
      ctx: GenericMutationCtx<DataModel>,
      doc: DocumentByName<DataModel, TableName>
    ) =>
      | void
      | Partial<DocumentByName<DataModel, TableName>>
      | Promise<Partial<DocumentByName<DataModel, TableName>> | void>;
    batchSize?: number;
  }) {
    const defaultBatchSize =
      functionDefaultBatchSize ??
      options?.defaultBatchSize ??
      DEFAULT_BATCH_SIZE;
    // Under the hood it's an internal mutation that calls the migrateOne
    // function for every document in a page, recursively scheduling batches.
    return options.internalMutation({
      args: migrationArgs,
      returns: migrationResult,
      handler: async (ctx, args) => {
        if (args.batchSize === 0) {
          throw new Error(
            "Batch size must be greater than zero.\n" +
              "Running this from the dashboard? Here's some args to use:\n" +
              `Dry run: { dryRun: true, cursor: null }\n` +
              `For real: run the startMigration function with  { fn: "migrations:yourFnName" }`
          );
        }
        if (args.cursor === "") {
          if (args.dryRun) {
            console.warn("Setting cursor to null for dry run");
            args.cursor = null;
          } else {
            throw new Error(`Cursor can't be an empty string.
              Use null to start from the beginning.
              Use the value in the migrations database to pick up from where it left off.`);
          }
        }

        const numItems = args.batchSize ?? defaultBatchSize;
        const { continueCursor, page, isDone } = await ctx.db
          .query(table)
          .paginate({ cursor: args.cursor, numItems });
        for (const doc of page) {
          try {
            const next = await migrateOne(ctx, doc);
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

  const run = internalMutationGeneric({
    args: {
      fn: v.string(),
      cursor: v.optional(v.union(v.string(), v.null())),
      batchSize: v.optional(v.number()),
      dryRun: v.optional(v.boolean()),
      next: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
      // Future: Call it so that it can return the id: ctx.runMutation?
      const name = prefixedName(args.fn);
      const next =
        args.next &&
        (await Promise.all(
          args.next.map(async (nextFn) => ({
            name: prefixedName(nextFn),
            fn: await createFunctionHandle(
              makeFunctionReference<"mutation">(nextFn)
            ),
          }))
        ));
      await ctx.runMutation(migrationsComponent.public.runMigration, {
        name,
        fn: await createFunctionHandle(makeFunctionReference<"mutation">(name)),
        cursor: args.cursor,
        batchSize: args.batchSize,
        next,
        dryRun: args.dryRun ?? false,
      });
    },
  });

  /**
   * Start a migration from a server function via a function reference.
   *
   * ```ts
   * const { startMigration } = defineMigrations(components.migrations, { internalMutation });
   *
   * // in a mutation or action:
   *   await startMigration(ctx, internal.migrations.myMigration, {
   *     startCursor: null, // optional override
   *     batchSize: 10, // optional override
   *   });
   * ```
   *
   * Overrides any options you passed in, such as resetting the cursor.
   * If it's already in progress, it will no-op.
   * If you run a migration that had previously failed which was part of a series,
   * it will not resume the series.
   * To resume a series, call the series again: {@link startMigrationsSerially}.
   *
   * Note: It's up to you to determine if it's safe to run a migration while
   * others are in progress. It won't run multiple instance of the same migration
   * but it currently allows running multiple migrations on the same table.
   *
   * @param ctx ctx from an action or mutation. It only uses the scheduler.
   * @param fnRef The migration function to run. Like internal.migrations.foo.
   * @param opts Options to start the migration.
   * @param opts.startCursor The cursor to start from.
   *   null: start from the beginning.
   *   undefined: start or resume from where it failed. If done, it won't restart.
   * @param opts.batchSize The number of documents to process in a batch.
   * @param opts.dryRun If true, it will run a batch and then throw an error.
   *   It's helpful to see what it would do without committing the transaction.
   */
  async function startMigration(
    ctx: RunMutationCtx,
    fnRef: FunctionReference<"mutation", "internal", MigrationArgs>,
    opts?: {
      startCursor?: string | null;
      batchSize?: number;
      dryRun?: boolean;
    }
  ) {
    // Future: Call it so that it can return the id: ctx.runMutation?
    await ctx.runMutation(migrationsComponent.public.runMigration, {
      name: getFunctionName(fnRef),
      fn: await createFunctionHandle(fnRef),
      cursor: opts?.startCursor,
      batchSize: opts?.batchSize,
      dryRun: opts?.dryRun ?? false,
    });
  }

  /**
   * Start a series of migrations, running one a time. Each call starts a series.
   *
   * ```ts
   * const { startMigrationSerially } = defineMigrations(components.migrations, { internalMutation });
   *
   * // in a mutation or action:
   *   await startMigrationsSerially(ctx, [
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
   * @param ctx ctx from an action or mutation. Only needs the scheduler.
   * @param fnRefs The migrations to run in order. Like [internal.migrations.foo].
   */
  async function startMigrationsSerially(
    ctx: RunMutationCtx,
    fnRefs: FunctionReference<"mutation", "internal", MigrationArgs>[]
  ) {
    if (fnRefs.length === 0) return;
    const [fnRef, ...rest] = fnRefs;
    const next = await Promise.all(
      rest.map(async (fnRef) => ({
        name: getFunctionName(fnRef),
        fn: await createFunctionHandle(fnRef),
      }))
    );
    await ctx.runMutation(migrationsComponent.public.runMigration, {
      name: getFunctionName(fnRef),
      fn: await createFunctionHandle(fnRef),
      next,
      dryRun: false,
    });
  }

  /**
   * Get the status of a migration or all migrations.
   * @param ctx Context from a mutation or query.
   * @param migrations The migrations to get the status of. Defaults to all.
   * @param limit How many migrations to fetch, if not specified by name.
   * @returns The status of the migrations, in the order of the input.
   */
  async function getStatus(
    ctx: RunQueryCtx,
    {
      migrations,
      limit,
    }: {
      migrations?: (
        | string
        | FunctionReference<"mutation", "internal", MigrationArgs>
      )[];
      limit?: number;
    }
  ): Promise<MigrationStatus[]> {
    const migrationNames = migrations?.map((m) =>
      typeof m === "string" ? prefixedName(m) : getFunctionName(m)
    );
    return ctx.runQuery(migrationsComponent.public.getStatus, {
      migrationNames,
      limit,
    });
  }

  /**
   * Cancels a migration if it's in progress.
   * You can resume it later by calling the migration without an explicit cursor.
   * If the migration had "next" migrations, e.g. from startMigrationsSerially,
   * they will not run. To resume, call the series again or manually pass "next".
   * @param ctx Context from a query or mutation. Only needs the db and scheduler.
   * @param migrationId Migration to cancel. Get from status or logs.
   * @returns The status of the migration after attempting to cancel it.
   */
  async function cancelMigration(
    ctx: RunMutationCtx,
    migration: FunctionReference<"mutation", "internal", MigrationArgs> | string
  ): Promise<MigrationStatus> {
    const name =
      typeof migration === "string"
        ? prefixedName(migration)
        : getFunctionName(migration);
    return await ctx.runMutation(migrationsComponent.public.cancel, {
      name,
    });
  }
  return {
    migration,
    run,
    startMigration,
    startMigrationsSerially,
    getStatus,
    cancelMigration,
  };
}

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
