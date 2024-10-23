import { ConvexError, ObjectType, v } from "convex/values";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server.js";
import { FunctionHandle, WithoutSystemFields } from "convex/server";
import {
  MigrationArgs,
  MigrationResult,
  MigrationStatus,
  migrationStatus,
} from "../shared.js";
import { api } from "./_generated/api.js";
import { Doc } from "./_generated/dataModel.js";

export type MigrationFunctionHandle = FunctionHandle<
  "mutation",
  MigrationArgs,
  MigrationResult
>;

const runMigrationArgs = {
  name: v.string(),
  fnHandle: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),

  batchSize: v.optional(v.number()),
  next: v.optional(
    v.array(
      v.object({
        name: v.string(),
        fnHandle: v.string(),
      })
    )
  ),
  dryRun: v.boolean(),
};

export const runMigration = mutation({
  args: runMigrationArgs,
  returns: migrationStatus,
  handler: async (ctx, args) => {
    // Step 1: Get or create the state.
    const { fnHandle, batchSize, next: next_, dryRun, ...initialState } = args;
    const state =
      (await ctx.db
        .query("migrations")
        .withIndex("name", (q) => q.eq("name", args.name))
        .unique()) ??
      (await ctx.db.get(
        await ctx.db.insert("migrations", {
          ...initialState,
          cursor: args.cursor ?? null,
          isDone: false,
          processed: 0,
          latestStart: Date.now(),
        })
      ))!;

    // Update the state if the cursor arg differs.
    if (state.cursor !== args.cursor) {
      // This happens if:
      // 1. The migration is being started/resumed (args.cursor unset).
      // 2. The migration is being resumed at a different cursor.
      // 3. There are two instances of the same migration racing.
      const worker =
        state.workerId && (await ctx.db.system.get(state.workerId));
      if (
        worker &&
        (worker.state.kind === "pending" || worker.state.kind === "inProgress")
      ) {
        // Case 3. The migration is already in progress.
        console.debug({ state, worker });
        return getMigrationState(ctx, state);
      }
      // Case 2. Update the cursor.
      if (args.cursor !== undefined) {
        state.cursor = args.cursor;
        state.isDone = false;
        state.latestStart = Date.now();
        state.processed = 0;
      }
      // For Case 1, Step 2 will take the right action.
    }

    function updateState(result: MigrationResult) {
      state.cursor = result.continueCursor;
      state.isDone = result.isDone;
      state.processed += result.processed;
      if (result.isDone) {
        state.latestEnd = Date.now();
      }
    }

    try {
      // Step 2: Run the migration.
      const result = await ctx.runMutation(
        fnHandle as MigrationFunctionHandle,
        {
          cursor: state.cursor,
          batchSize,
          dryRun,
        }
      );
      updateState(result);
      state.error = undefined;

    // Step 3: Schedule the next batch or next migration.
    if (!state.isDone) {
      // Recursively schedule the next batch.
      state.workerId = await ctx.scheduler.runAfter(
        0,
        api.public.runMigration,
        {
          ...args,
          cursor: state.cursor,
        }
      );
    } else {
      state.workerId = undefined;
      // Schedule the next migration in the series.
      const next = next_ ?? [];
      // Find the next migration that hasn't been done.
      let i = 0;
      for (; i < next.length; i++) {
        const doc = await ctx.db
          .query("migrations")
          .withIndex("name", (q) => q.eq("name", next[i]!.name))
          .unique();
        if (!doc || !doc.isDone) {
          const [nextFn, ...rest] = next.slice(i);
          if (nextFn) {
            await ctx.scheduler.runAfter(0, api.public.runMigration, {
              name: nextFn.name,
              fnHandle: nextFn.fnHandle,
              next: rest,
              batchSize,
              dryRun,
            });
          }
          break;
        }
      }
      if (args.cursor === undefined) {
        if (i === next.length) {
          console.debug(`Migration${i > 0 ? "s" : ""} already done.`);
        }
      } else {
        console.debug(
          `Migration ${args.name} is done.` +
            (i < next.length ? ` Next: ${next[i]!.name}` : "")
        );
      }
    }
    } catch (e) {
      if (dryRun && e instanceof ConvexError && e.data.kind === "DRY RUN") {
        // Add the state to the error to bubble up.
        updateState(e.data.result);
      } else {
        state.error = e instanceof Error ? e.message : String(e);
      }
      if (dryRun) {
        const status = await getMigrationState(ctx, state);
        status.batchSize = batchSize;
        status.next = next_?.map((n) => n.name);
        throw new ConvexError({
          kind: "DRY RUN",
          status,
        });
      }
    }

    // Step 4: Update the state
    await ctx.db.patch(state._id, state);
    if (args.dryRun) {
      // By throwing an error, the transaction will be rolled back and nothing
      // will be scheduled.
      console.debug({ args, state });
      throw new Error(
        "Error: Dry run attempted to update state - rolling back transaction."
      );
    }
    return getMigrationState(ctx, state);
  },
});

export const getStatus = query({
  args: {
    migrationNames: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(migrationStatus),
  handler: async (ctx, args) => {
    const docs = args.migrationNames
      ? await Promise.all(
          args.migrationNames.map(
            async (m) =>
              (await ctx.db
                .query("migrations")
                .withIndex("name", (q) => q.eq("name", m))
                .unique()) ?? {
                name: m,
                processed: 0,
                cursor: null,
                latestStart: 0,
                workerId: undefined,
                isDone: false as const,
              }
          )
        )
      : await ctx.db
          .query("migrations")
          .order("desc")
          .take(args.limit ?? 10);

    return Promise.all(
      docs.reverse().map(async (migration) => getMigrationState(ctx, migration))
    );
  },
});

async function getMigrationState(
  ctx: QueryCtx,
  migration: WithoutSystemFields<Doc<"migrations">>
): Promise<MigrationStatus> {
  const worker =
    migration.workerId && (await ctx.db.system.get(migration.workerId));
  const args = worker?.args[0] as
    | ObjectType<typeof runMigrationArgs>
    | undefined;
  return {
    name: migration.name,
    cursor: migration.cursor,
    processed: migration.processed,
    isDone: migration.isDone,
    latestStart: migration.latestStart,
    latestEnd: migration.latestEnd,
    error: migration.error,
    workerStatus: worker?.state.kind,
    batchSize: args?.batchSize,
    next: args?.next?.map((n: { name: string }) => n.name),
  };
}

export const cancel = mutation({
  args: { name: v.string() },
  returns: migrationStatus,
  handler: async (ctx, args) => {
    const migration = await ctx.db
      .query("migrations")
      .withIndex("name", (q) => q.eq("name", args.name))
      .unique();

    if (!migration) {
      throw new Error(`Migration ${args.name} not found`);
    }
    return cancelMigration(ctx, migration);
  },
});

async function cancelMigration(ctx: MutationCtx, migration: Doc<"migrations">) {
  const state = await getMigrationState(ctx, migration);
  if (state.isDone) {
    return state;
  }
  if (state.workerStatus === "pending" || state.workerStatus === "inProgress") {
    await ctx.scheduler.cancel(migration.workerId!);
    console.log(`Canceled migration ${migration.name}`, state);
    return { ...state, workerStatus: "canceled" as const };
  }
  return state;
}

export const cancelAll = mutation({
  // Paginating with creation time for now
  args: { sinceTs: v.optional(v.number()) },
  returns: v.array(migrationStatus),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("migrations")
      .withIndex("isDone", (q) =>
        args.sinceTs
          ? q.eq("isDone", false).gte("_creationTime", args.sinceTs)
          : q.eq("isDone", false)
      )
      .take(100);
    if (results.length === 100) {
      await ctx.scheduler.runAfter(0, api.public.cancelAll, {
        sinceTs: results[results.length - 1]!._creationTime,
      });
    }
    return Promise.all(results.map((m) => cancelMigration(ctx, m)));
  },
});
