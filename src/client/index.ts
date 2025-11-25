import {
  createFunctionHandle,
  type DocumentByName,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  getFunctionAddress,
  getFunctionName,
  internalMutationGeneric,
  makeFunctionReference,
  type MutationBuilder,
  type NamedTableInfo,
  type OrderedQuery,
  type QueryInitializer,
  type RegisteredMutation,
  type TableNamesInDataModel,
} from "convex/server";
import {
  type MigrationArgs,
  migrationArgs,
  type MigrationResult,
  type MigrationStatus,
} from "../shared.js";
export type { MigrationArgs, MigrationResult, MigrationStatus };

import { ConvexError, type GenericId } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import { logStatusAndInstructions } from "./log.js";
import type { MigrationFunctionHandle } from "../component/lib.js";

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
   * export const run = migrations.runner();
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
    public component: ComponentApi,
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
    },
  ) {}

  /**
   * Creates a migration runner that can be called from the CLI or dashboard.
   *
   * For starting a migration from code, see {@link runOne}/{@link runSerially}.
   *
   * It can be created for a specific migration:
   * ```ts
   * export const runMyMigration = runner(internal.migrations.myMigration);
   * ```
   * CLI: `npx convex run migrations:runMyMigration`
   *
   * Or for any migration:
   * ```ts
   * export const run = runner();
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
  runner(
    specificMigrationOrSeries?:
      | MigrationFunctionReference
      | MigrationFunctionReference[],
  ) {
    return internalMutationGeneric({
      args: migrationArgs,
      handler: async (ctx, args) => {
        const [specificMigration, next] = Array.isArray(
          specificMigrationOrSeries,
        )
          ? [
              specificMigrationOrSeries[0],
              await Promise.all(
                specificMigrationOrSeries.slice(1).map(async (fnRef) => ({
                  name: getFunctionName(fnRef),
                  fnHandle: await createFunctionHandle(fnRef),
                })),
              ),
            ]
          : [specificMigrationOrSeries, undefined];
        if (args.fn && specificMigration) {
          throw new Error("Specify only one of fn or specificMigration");
        }
        if (!args.fn && !specificMigration) {
          throw new Error(
            `Specify the migration: '{"fn": "migrations:foo"}'\n` +
              "Or initialize a `runner` runner specific to the migration like\n" +
              "`export const runMyMigration = runner(internal.migrations.myMigration)`",
          );
        }
        return await this._runInteractive(ctx, args, specificMigration, next);
      },
    });
  }

  private async _runInteractive(
    ctx: MutationCtx | ActionCtx,
    args: MigrationArgs,
    fnRef?: MigrationFunctionReference,
    next?: { name: string; fnHandle: string }[],
  ) {
    const name = args.fn ? this.prefixedName(args.fn) : getFunctionName(fnRef!);
    async function makeFn(fn: string) {
      try {
        return await createFunctionHandle(
          makeFunctionReference<"mutation">(fn),
        );
      } catch {
        throw new Error(
          `Can't find function ${fn}\n` +
            "The name should match the folder/file:method\n" +
            "See https://docs.convex.dev/functions/query-functions#query-names",
        );
      }
    }
    const fnHandle = args.fn
      ? await makeFn(name)
      : await createFunctionHandle(fnRef!);
    if (args.next) {
      next = (next ?? []).concat(
        await Promise.all(
          args.next.map(async (nextFn) => ({
            name: this.prefixedName(nextFn),
            fnHandle: await makeFn(this.prefixedName(nextFn)),
          })),
        ),
      );
    }
    let status: MigrationStatus;
    try {
      status = await ctx.runMutation(this.component.lib.migrate, {
        name,
        fnHandle,
        cursor: args.cursor,
        batchSize: args.batchSize,
        next,
        dryRun: args.dryRun ?? false,
      });
    } catch (e) {
      if (
        args.dryRun &&
        e instanceof ConvexError &&
        e.data.kind === "DRY RUN"
      ) {
        status = e.data.status;
      } else {
        throw e;
      }
    }

    return logStatusAndInstructions(name, status, args);
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
   * @param parallelize - If true, each migration batch will be run in parallel.
   * @returns An internal mutation that runs the migration.
   */
  define<TableName extends TableNamesInDataModel<DataModel>>({
    table,
    migrateOne,
    customRange,
    batchSize: functionDefaultBatchSize,
    parallelize,
  }: {
    table: TableName;
    migrateOne: (
      ctx: GenericMutationCtx<DataModel>,
      doc: DocumentByName<DataModel, TableName> & { _id: GenericId<TableName> },
    ) =>
      | void
      | Partial<DocumentByName<DataModel, TableName>>
      | Promise<Partial<DocumentByName<DataModel, TableName>> | void>;
    customRange?: (
      q: QueryInitializer<NamedTableInfo<DataModel, TableName>>,
    ) => OrderedQuery<NamedTableInfo<DataModel, TableName>>;
    batchSize?: number;
    parallelize?: boolean;
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
      handler: async (ctx, args) => {
        if (args.fn) {
          // This is a one-off execution from the CLI or dashboard.
          // While not the recommended appproach, it's helpful for one-offs and
          // compatibility with the old way of running migrations.

          return (await this._runInteractive(ctx, args)) as any;
        } else if (args.next?.length) {
          throw new Error("You can only pass next if you also provide fn");
        } else if (
          args.cursor === undefined ||
          args.cursor === "" ||
          args.dryRun === undefined ||
          args.batchSize === 0
        ) {
          console.warn(
            "Running this from the CLI or dashboard? Here's some args to use:",
          );
          console.warn({
            "Dry run": '{ "dryRun": true, "cursor": null }',
            "For real": '{ "fn": "path/to/migrations:yourFnName" }',
          });
        }

        const numItems = args.batchSize || defaultBatchSize;
        if (args.cursor === undefined || args.cursor === "") {
          if (args.dryRun === undefined) {
            console.warn(
              "No cursor or dryRun specified - doing a dry run on the next batch.",
            );
            args.cursor = null;
            args.dryRun = true;
          } else if (args.dryRun) {
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
        let continueCursor: string;
        let page: DocumentByName<DataModel, TableName>[];
        let isDone: boolean;
        try {
          ({ continueCursor, page, isDone } = await range.paginate({
            cursor: args.cursor,
            numItems,
          }));
        } catch (e) {
          console.error(
            "Error paginating. This can happen if the migration " +
              "was initially run on a different table, different custom range, " +
              "or you upgraded convex-helpers with in-progress migrations. " +
              "This creates an invalid pagination cursor. " +
              "Run all migrations to completion on the old cursor, or re-run " +
              "them explicitly with the cursor set to null. " +
              "If the problem persists, contact support@convex.dev",
          );
          throw e;
        }
        async function doOne(doc: DocumentByName<DataModel, TableName>) {
          try {
            const next = await migrateOne(
              ctx,
              doc as { _id: GenericId<TableName> },
            );
            if (next && Object.keys(next).length > 0) {
              await ctx.db.patch(doc._id as GenericId<TableName>, next);
            }
          } catch (error) {
            console.error(`Document failed: ${doc._id}`);
            throw error;
          }
        }
        if (parallelize) {
          await Promise.all(page.map(doOne));
        } else {
          for (const doc of page) {
            await doOne(doc);
          }
        }
        const result = {
          continueCursor,
          isDone,
          processed: page.length,
        };
        if (args.dryRun) {
          // Throwing an error rolls back the transaction
          let anyChanges = false;
          let printedChanges = 0;
          for (const before of page) {
            const after = await ctx.db.get(before._id as GenericId<TableName>);
            if (JSON.stringify(after) !== JSON.stringify(before)) {
              anyChanges = true;
              printedChanges++;
              if (printedChanges > 10) {
                console.debug(
                  "DRY RUN: More than 10 changes were found in the first page. Skipping the rest.",
                );
                break;
              }
              console.debug("DRY RUN: Example change", {
                before,
                after,
              });
            }
          }
          if (!anyChanges) {
            console.debug(
              "DRY RUN: No changes were found in the first page. " +
                `Try {"dryRun": true, "cursor": "${continueCursor}"}`,
            );
          }
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
    ctx: MutationCtx | ActionCtx,
    fnRef: MigrationFunctionReference,
    opts?: {
      cursor?: string | null;
      batchSize?: number;
      dryRun?: boolean;
    },
  ) {
    return ctx.runMutation(this.component.lib.migrate, {
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
  async runSerially(
    ctx: MutationCtx | ActionCtx,
    fnRefs: MigrationFunctionReference[],
  ) {
    if (fnRefs.length === 0) return;
    const [fnRef, ...rest] = fnRefs;
    const next = await Promise.all(
      rest.map(async (fnRef) => ({
        name: getFunctionName(fnRef),
        fnHandle: await createFunctionHandle(fnRef),
      })),
    );
    return ctx.runMutation(this.component.lib.migrate, {
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
    ctx: QueryCtx | MutationCtx | ActionCtx,
    {
      migrations,
      limit,
    }: {
      migrations?: (string | MigrationFunctionReference)[];
      limit?: number;
    },
  ): Promise<MigrationStatus[]> {
    const names = migrations?.map((m) =>
      typeof m === "string" ? this.prefixedName(m) : getFunctionName(m),
    );
    return ctx.runQuery(this.component.lib.getStatus, {
      names,
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
    ctx: MutationCtx | ActionCtx,
    migration: MigrationFunctionReference | string,
  ): Promise<MigrationStatus> {
    const name =
      typeof migration === "string"
        ? this.prefixedName(migration)
        : getFunctionName(migration);
    return ctx.runMutation(this.component.lib.cancel, { name });
  }

  /**
   * Cancels all migrations that are in progress.
   * You can resume it later by calling the migration without an explicit cursor.
   * If the migration had "next" migrations, e.g. from {@link runSerially},
   * they will not run. To resume, call the series again or manually pass "next".
   * @param ctx Context from a mutation or action. Needs `runMutation`.
   * @returns The status of up to 100 of the canceled migrations.
   */
  async cancelAll(ctx: MutationCtx | ActionCtx) {
    return ctx.runMutation(this.component.lib.cancelAll, {});
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

/**
 * Start a migration and run it synchronously until it's done.
 * If this function crashes, the migration will not continue.
 *
 * ```ts
 * // In an action
 * const toRun = internal.migrations.myMigration;
 * await runToCompletion(ctx, components.migrations, toRun);
 * ```
 *
 * If it's already in progress, it will no-op.
 * If you run a migration that had previously failed which was part of a series,
 * it will not resume the series.
 * To resume a series, call the series again: {@link Migrations.runSerially}.
 *
 * Note: It's up to you to determine if it's safe to run a migration while
 * others are in progress. It won't run multiple instances of the same migration
 * but it currently allows running multiple migrations on the same table.
 *
 * @param ctx Context from an action.
 * @param component The migrations component, usually `components.migrations`.
 * @param fnRef The migration function to run. Like `internal.migrations.foo`.
 * @param opts Options to start the migration.
 *   It's helpful to see what it would do without committing the transaction.
 */
export async function runToCompletion(
  ctx: ActionCtx,
  component: ComponentApi,
  fnRef: MigrationFunctionReference | MigrationFunctionHandle,
  opts?: {
    /**
     * The name of the migration function, generated with getFunctionName.
     */
    name?: string;
    /**
     * The cursor to start from.
     * null: start from the beginning.
     * undefined: start, or resume from where it failed. No-ops if already done.
     */
    cursor?: string | null;
    /**
     * The number of documents to process in a batch.
     * Overrides the migrations's configured batch size.
     */
    batchSize?: number;
    /**
     * If true, it will run a batch and then throw an error.
     * It's helpful to see what it would do without committing the transaction.
     */
    dryRun?: boolean;
  },
): Promise<MigrationStatus> {
  let cursor = opts?.cursor;
  const {
    name = getFunctionName(fnRef),
    batchSize,
    dryRun = false,
  } = opts ?? {};
  const address = getFunctionAddress(fnRef);
  const fnHandle =
    address.functionHandle ?? (await createFunctionHandle(fnRef));
  while (true) {
    const status = await ctx.runMutation(component.lib.migrate, {
      name,
      fnHandle,
      cursor,
      batchSize,
      dryRun,
      oneBatchOnly: true,
    });
    if (status.isDone) {
      return status;
    }
    if (status.error) {
      throw new Error(status.error);
    }
    if (!status.cursor || status.cursor === cursor) {
      throw new Error(
        "Invariant violation: Migration did not make progress." +
          `\nStatus: ${JSON.stringify(status)}`,
      );
    }
    cursor = status.cursor;
  }
}

/* Type utils follow */

type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<
  GenericMutationCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "storage"
>;
