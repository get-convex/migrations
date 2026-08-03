import {
  type FunctionHandle,
  type FunctionReference,
  makeFunctionReference,
  type WithoutSystemFields,
} from "convex/server";
import { ConvexError, type ObjectType, v } from "convex/values";
import {
  MIGRATION_BATCH_FAILURE,
  type MigrationArgs,
  type MigrationResult,
  type MigrationStatus,
  getMigrationDryRunResult,
  migrationStatus,
} from "../shared.js";
import { api } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  internalAction,
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server.js";
import {
  chooseBatchSizeAfterLimitFailure,
  chooseBatchSizeAfterSuccess,
  getTransactionLimitMetric,
  looksLikeExecutionTimeout,
  looksLikeOccError,
  looksLikeSystemOperationsTimeout,
  MUTATION_SYSTEM_OPERATIONS_TIME_METRIC,
  MUTATION_USER_EXECUTION_TIME_METRIC,
  OCC_LIMITING_METRIC,
} from "./batchSize.js";

export type MigrationFunctionHandle = FunctionHandle<
  "mutation",
  MigrationArgs,
  MigrationResult
>;

const migrationInvocationArgs = {
  name: v.string(),
  fnHandle: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),

  batchSize: v.optional(v.number()),
  initialBatchSize: v.optional(v.number()),
  next: v.optional(
    v.array(
      v.object({
        name: v.string(),
        fnHandle: v.string(),
      }),
    ),
  ),
  dryRun: v.boolean(),
  reset: v.optional(v.boolean()),
  adaptiveBatchSize: v.optional(v.boolean()),
  currentRangeIndex: v.optional(v.number()),
};

const scheduledMigrationArgs = {
  ...migrationInvocationArgs,
  workerGeneration: v.number(),
};

const runMigrationArgs = {
  ...migrationInvocationArgs,
  oneBatchOnly: v.optional(v.boolean()),
  workerGeneration: v.optional(v.number()),
};

const workerFailure = v.union(
  v.object({
    kind: v.literal("transactionLimit"),
    limitingMetric: v.string(),
    message: v.string(),
  }),
  v.object({
    kind: v.literal("occ"),
    message: v.string(),
  }),
  v.object({
    kind: v.literal("executionTimeout"),
    message: v.string(),
  }),
  v.object({
    kind: v.literal("systemOperationsTimeout"),
    message: v.string(),
  }),
  v.object({
    kind: v.literal("unknown"),
    message: v.string(),
  }),
);

type ScheduledMigrationArgs = ObjectType<typeof scheduledMigrationArgs>;
type WorkerScheduleArgs = Omit<ScheduledMigrationArgs, "workerGeneration">;
type WorkerFailure = ObjectType<{ failure: typeof workerFailure }>["failure"];

// Generated API types import this module, so referring to these same-module
// internal functions through `internal` would create circular type inference.
const runWorkerFunction = makeFunctionReference<
  "action",
  ScheduledMigrationArgs,
  MigrationStatus
>("lib:runWorker") as unknown as FunctionReference<
  "action",
  "internal",
  ScheduledMigrationArgs,
  MigrationStatus
>;
const recoverWorkerFailureFunction = makeFunctionReference<
  "mutation",
  {
    migration: ScheduledMigrationArgs;
    failure: WorkerFailure;
  },
  MigrationStatus
>("lib:recoverWorkerFailure") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    migration: ScheduledMigrationArgs;
    failure: WorkerFailure;
  },
  MigrationStatus
>;

export const migrate = mutation({
  args: runMigrationArgs,
  returns: migrationStatus,
  handler: async (ctx, args) => {
    // Step 1: Get or create the state.
    const { fnHandle, batchSize, next: next_, dryRun, name } = args;
    if (batchSize !== undefined && !Number.isInteger(batchSize)) {
      throw new Error("Batch size must be an integer");
    }
    if (batchSize !== undefined && batchSize <= 0) {
      throw new Error("Batch size must be greater than 0");
    }
    if (
      args.initialBatchSize !== undefined &&
      !Number.isInteger(args.initialBatchSize)
    ) {
      throw new Error("Initial batch size must be an integer");
    }
    if (args.initialBatchSize !== undefined && args.initialBatchSize <= 0) {
      throw new Error("Initial batch size must be greater than 0");
    }
    if (
      args.currentRangeIndex !== undefined &&
      !Number.isInteger(args.currentRangeIndex)
    ) {
      throw new Error("Current range index must be an integer");
    }
    if (args.currentRangeIndex !== undefined && args.currentRangeIndex < 0) {
      throw new Error("Current range index must be non-negative");
    }
    if (!fnHandle.startsWith("function://")) {
      throw new Error(
        "Invalid fnHandle.\n" +
          "Do not call this from the CLI or dashboard directly.\n" +
          "Instead use the `migrations.runner` function to run migrations." +
          "See https://www.convex.dev/components/migrations",
      );
    }
    const state =
      (await ctx.db
        .query("migrations")
        .withIndex("name", (q) => q.eq("name", name))
        .unique()) ??
      (await ctx.db.get(
        "migrations",
        await ctx.db.insert("migrations", {
          name,
          cursor: args.cursor ?? null,
          isDone: false,
          processed: 0,
          currentRangeIndex: args.currentRangeIndex ?? 0,
          latestStart: Date.now(),
          currentBatchSize: batchSize ?? args.initialBatchSize,
          workerGeneration: args.workerGeneration,
        }),
      ))!;
    const adaptiveBatchSize = args.adaptiveBatchSize !== false;
    const currentRangeIndexDiffers =
      args.currentRangeIndex !== undefined &&
      (state.currentRangeIndex ?? 0) !== args.currentRangeIndex;
    // Reset is a start-position instruction for this invocation. Same-migration
    // continuations and retries must resume the stored reset point, while next
    // migrations still receive reset below when the whole series is reset.
    const {
      reset: _reset,
      workerGeneration: _workerGeneration,
      oneBatchOnly: _oneBatchOnly,
      ...sameMigrationArgs
    } = args;
    const positionDiffers =
      args.reset || state.cursor !== args.cursor || currentRangeIndexDiffers;
    const shouldCheckActiveWorker =
      args.workerGeneration === undefined &&
      (args.oneBatchOnly || positionDiffers);
    const worker =
      shouldCheckActiveWorker && state.workerId
        ? await ctx.db.system.get("_scheduled_functions", state.workerId)
        : undefined;
    let invalidatedWorkerGeneration = false;

    // Check for an active worker before accepting a position-changing call or
    // an external oneBatchOnly call.
    if (shouldCheckActiveWorker) {
      // This happens if:
      // 1. The migration is being reset.
      // 2. The migration is being started/resumed (args.cursor unset).
      // 3. The migration is being resumed at a different cursor.
      // 4. A oneBatchOnly caller is racing with the scheduled continuation.
      // 5. There are two instances of the same migration racing.
      if (
        worker &&
        (worker.state.kind === "pending" || worker.state.kind === "inProgress")
      ) {
        if (
          args.reset &&
          state.workerId &&
          state.workerGeneration !== undefined
        ) {
          await ctx.scheduler.cancel(state.workerId);
        } else {
          // oneBatchOnly calls are external calls, not scheduled continuations.
          // They must not run beside an active worker even when they pass the
          // same stored cursor.
          console.debug({ state, worker });
          return getMigrationState(ctx, state);
        }
      }
    }
    if (
      shouldCheckActiveWorker &&
      args.workerGeneration === undefined &&
      state.workerId !== undefined
    ) {
      // An external call that takes over from a completed, failed, or canceled
      // worker must also make that worker's late recovery stale.
      state.workerGeneration = (state.workerGeneration ?? 0) + 1;
      invalidatedWorkerGeneration = true;
    }
    if (
      args.workerGeneration === undefined &&
      !state.isDone &&
      (invalidatedWorkerGeneration || state.error !== undefined)
    ) {
      state.latestStart = Date.now();
      state.latestEnd = undefined;
    }
    if (
      args.workerGeneration !== undefined &&
      !(await claimWorker(ctx, state, args.workerGeneration))
    ) {
      return getMigrationState(ctx, state);
    }
    if (positionDiffers) {
      // A missing cursor means "resume stored progress". Only an explicit
      // cursor, reset, or explicit range index may rewrite the stored position;
      // this preserves multi-range handoff where the cursor is null but the
      // current range has already advanced.
      if (args.reset || args.cursor !== undefined || currentRangeIndexDiffers) {
        if (
          args.workerGeneration === undefined &&
          !invalidatedWorkerGeneration
        ) {
          // An external position change takes ownership from every older
          // worker, including one canceled just before this transaction. Keep
          // it stale even if this call finishes without scheduling a worker.
          state.workerGeneration = (state.workerGeneration ?? 0) + 1;
        }
        state.cursor = args.cursor ?? null;
        state.isDone = false;
        state.latestStart = Date.now();
        state.latestEnd = undefined;
        state.processed = 0;
        state.currentRangeIndex = args.reset
          ? 0
          : (args.currentRangeIndex ?? 0);
        state.error = undefined;
        state.workerId = undefined;
        state.currentBatchSize = batchSize ?? args.initialBatchSize;
        state.lastFailedBatchSize = undefined;
        state.limitingMetric = undefined;
      }
      // For Case 2, Step 2 will take the right action.
    }

    function updateState(result: MigrationResult, durationMs: number) {
      const completedBatchSize =
        result.batchSize ??
        batchSize ??
        state.currentBatchSize ??
        args.initialBatchSize;
      state.cursor = result.continueCursor;
      state.isDone = result.isDone;
      state.processed += result.processed;
      state.currentRangeIndex =
        result.currentRangeIndex ?? state.currentRangeIndex ?? 0;
      if (completedBatchSize !== undefined) {
        const fullBatch = result.processed >= completedBatchSize;
        if (fullBatch) {
          const lastFailedBatchSize =
            state.lastFailedBatchSize !== undefined &&
            completedBatchSize < state.lastFailedBatchSize
              ? state.lastFailedBatchSize
              : undefined;
          // A successful explicit/default-size run at or above a previous
          // failure disproves that failed size as an adaptive upper bound.
          state.lastFailedBatchSize = lastFailedBatchSize;
          if (adaptiveBatchSize) {
            const next = chooseBatchSizeAfterSuccess({
              batchSize: completedBatchSize,
              metrics: result.metrics,
              durationMs,
              lastFailedBatchSize,
            });
            state.currentBatchSize = next.batchSize;
            state.limitingMetric = next.limitingMetric;
          } else {
            state.currentBatchSize = completedBatchSize;
            state.limitingMetric = undefined;
          }
        } else {
          // An underfilled page does not measure the cost of the requested
          // batch size. Preserve the prior bound and limiting metric.
          state.currentBatchSize = completedBatchSize;
        }
      }
      if (result.isDone && state.latestEnd === undefined) {
        state.latestEnd = Date.now();
      }
    }

    // Step 2: Run the migration. Only failures from this nested call belong to
    // the adaptive retry contract. Handoff and scheduling failures below must
    // abort this transaction so its successful batch is not recorded twice.
    let batchFailed = false;
    if (!state.isDone) {
      const batchSizeToRun =
        batchSize ?? state.currentBatchSize ?? args.initialBatchSize;
      const startedAt = performance.now();
      let successfulResult: MigrationResult | undefined;
      try {
        successfulResult = await ctx.runMutation(
          fnHandle as MigrationFunctionHandle,
          {
            cursor: state.cursor,
            currentRangeIndex: state.currentRangeIndex ?? 0,
            batchSize: batchSizeToRun,
            dryRun,
            oneBatchOnly: true,
          },
        );
      } catch (e) {
        batchFailed = true;
        state.workerId = undefined;
        // Defined migration wrappers attach the attempted size because a
        // failed child cannot return it in the normal result.
        const migrationBatchFailure = getMigrationBatchFailure(e);
        const retryableError = migrationBatchFailure?.message ?? e;
        const transactionLimitMetric =
          getTransactionLimitMetric(retryableError);
        const failedBatchSize =
          migrationBatchFailure?.batchSize ??
          batchSize ??
          state.currentBatchSize ??
          args.initialBatchSize;
        const failedUpperBound =
          transactionLimitMetric !== undefined &&
          failedBatchSize !== undefined
            ? Math.min(
                failedBatchSize,
                state.lastFailedBatchSize ?? failedBatchSize,
              )
            : undefined;
        // An explicit override can exceed a smaller stored failed bound. Branch on the smallest
        // known failure so a size-1 failure remains terminal instead of becoming retryable again.
        const dryRunResult = dryRun ? getMigrationDryRunResult(e) : undefined;
        if (dryRunResult !== undefined) {
          // Add the state to the error to bubble up.
          updateState(dryRunResult, 0);
        } else if (
          !dryRun &&
          failedUpperBound !== undefined &&
          failedUpperBound > 1
        ) {
          const nextBatchSize = chooseBatchSizeAfterLimitFailure({
            batchSize: failedUpperBound,
          });
          state.currentBatchSize = nextBatchSize;
          state.lastFailedBatchSize = failedUpperBound;
          state.limitingMetric = transactionLimitMetric;
          state.latestEnd = undefined;
          state.error = undefined;
          if (!args.oneBatchOnly) {
            await scheduleWorker(ctx, state, {
              ...sameMigrationArgs,
              cursor: state.cursor,
              currentRangeIndex: state.currentRangeIndex ?? 0,
              batchSize: nextBatchSize,
              adaptiveBatchSize,
            });
          }
        } else {
          if (failedUpperBound !== undefined) {
            state.currentBatchSize = failedUpperBound;
            state.lastFailedBatchSize = failedUpperBound;
          }
          state.limitingMetric = transactionLimitMetric;
          state.error =
            migrationBatchFailure?.message ??
            (e instanceof Error ? e.message : String(e));
          state.latestEnd = Date.now();
          console.error(`Migration ${name} failed: ${state.error}`);
        }
        if (dryRun) {
          const status = await getMigrationState(ctx, state);
          status.batchSize = state.currentBatchSize ?? batchSize;
          status.next = next_?.map((n) => n.name);
          throw new ConvexError({
            kind: "DRY RUN",
            status,
          });
        }
      }
      if (!batchFailed) {
        if (successfulResult === undefined) {
          throw new Error("Migration returned undefined");
        }
        updateState(successfulResult, performance.now() - startedAt);
        state.error = undefined;
      }
    }

    // Step 3: Schedule the next batch or next migration after a successful
    // batch. Retryable failures already scheduled their smaller retry above.
    if (!batchFailed) {
      if (args.oneBatchOnly) {
        state.workerId = undefined;
      } else if (!state.isDone) {
        // Run the next controller mutation from an action so failures from its
        // outer transaction boundary are catchable.
        await scheduleWorker(ctx, state, {
          ...sameMigrationArgs,
          cursor: state.cursor,
          currentRangeIndex: state.currentRangeIndex ?? 0,
          batchSize: adaptiveBatchSize ? state.currentBatchSize : batchSize,
          adaptiveBatchSize,
        });
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
          if (args.reset || !doc || !doc.isDone) {
            const [nextFn, ...rest] = next.slice(i);
            if (nextFn) {
              const now = Date.now();
              const nextState =
                doc ??
                (await ctx.db.get(
                  "migrations",
                  await ctx.db.insert("migrations", {
                    name: nextFn.name,
                    cursor: null,
                    isDone: false,
                    processed: 0,
                    currentRangeIndex: 0,
                    latestStart: now,
                    currentBatchSize: adaptiveBatchSize ? undefined : batchSize,
                  }),
                ))!;
              if (args.reset) {
                nextState.cursor = null;
                nextState.currentRangeIndex = 0;
                nextState.isDone = false;
                nextState.processed = 0;
                nextState.currentBatchSize = adaptiveBatchSize
                  ? undefined
                  : batchSize;
                nextState.lastFailedBatchSize = undefined;
                nextState.limitingMetric = undefined;
              }
              nextState.latestStart = now;
              nextState.latestEnd = undefined;
              nextState.error = undefined;
              await scheduleWorker(ctx, nextState, {
                name: nextFn.name,
                fnHandle: nextFn.fnHandle,
                next: rest,
                dryRun: false,
                batchSize: adaptiveBatchSize ? undefined : batchSize,
                adaptiveBatchSize,
                ...(args.reset ? { reset: true, cursor: null } : {}),
              });
              await ctx.db.patch("migrations", nextState._id, nextState);
            }
            break;
          }
        }
        if (args.cursor === undefined) {
          if (next.length && i === next.length) {
            console.info(`Migration${i > 0 ? "s" : ""} up next already done.`);
          }
        } else {
          console.info(
            `Migration ${name} is done.` +
              (i < next.length ? ` Next: ${next[i]!.name}` : ""),
          );
        }
      }
    }

    // Step 4: Update the state
    await ctx.db.patch("migrations", state._id, state);
    if (args.dryRun) {
      // By throwing an error, the transaction will be rolled back and nothing
      // will be scheduled.
      console.debug({ args, state });
      throw new Error(
        "Error: Dry run attempted to update state - rolling back transaction.",
      );
    }
    return getMigrationState(ctx, state);
  },
});

export const runWorker = internalAction({
  args: scheduledMigrationArgs,
  returns: migrationStatus,
  handler: async (ctx, args): Promise<MigrationStatus> => {
    if (args.dryRun) {
      throw new Error("Scheduled migration workers cannot run dry runs");
    }
    try {
      return await ctx.runMutation(api.lib.migrate, args);
    } catch (error) {
      return await ctx.runMutation(recoverWorkerFailureFunction, {
        migration: args,
        failure: classifyWorkerFailure(error),
      });
    }
  },
});

export const recoverWorkerFailure = internalMutation({
  args: {
    migration: v.object(scheduledMigrationArgs),
    failure: workerFailure,
  },
  returns: migrationStatus,
  handler: async (ctx, { migration: args, failure }) => {
    let state = await ctx.db
      .query("migrations")
      .withIndex("name", (q) => q.eq("name", args.name))
      .unique();
    if (state === null) {
      const id = await ctx.db.insert("migrations", {
        name: args.name,
        cursor: args.cursor ?? null,
        isDone: false,
        processed: 0,
        currentRangeIndex: args.currentRangeIndex ?? 0,
        latestStart: Date.now(),
        currentBatchSize: args.batchSize ?? args.initialBatchSize,
        workerGeneration: args.workerGeneration,
      });
      state = (await ctx.db.get("migrations", id))!;
    }

    if (!(await claimWorker(ctx, state, args.workerGeneration))) {
      return getMigrationState(ctx, state);
    }

    if (args.reset) {
      state.cursor = args.cursor ?? null;
      state.currentRangeIndex = args.currentRangeIndex ?? 0;
      state.isDone = false;
      state.processed = 0;
      state.latestStart = Date.now();
      state.latestEnd = undefined;
      state.currentBatchSize = args.batchSize ?? args.initialBatchSize;
      state.lastFailedBatchSize = undefined;
      state.limitingMetric = undefined;
    } else if (
      (args.cursor !== undefined && state.cursor !== args.cursor) ||
      (args.currentRangeIndex !== undefined &&
        (state.currentRangeIndex ?? 0) !== args.currentRangeIndex)
    ) {
      return getMigrationState(ctx, state);
    }

    const limitingMetric = getWorkerFailureMetric(failure);
    const failedBatchSize =
      args.batchSize ?? state.currentBatchSize ?? args.initialBatchSize;
    const failedUpperBound =
      failure.kind !== "unknown" && failedBatchSize !== undefined
        ? Math.min(
            failedBatchSize,
            state.lastFailedBatchSize ?? failedBatchSize,
          )
        : undefined;
    // An explicit override can exceed a smaller stored failed bound. Branch on the smallest known
    // failure so a size-1 failure remains terminal instead of becoming retryable again.
    if (
      failedUpperBound !== undefined &&
      failedUpperBound > 1
    ) {
      const nextBatchSize = chooseBatchSizeAfterLimitFailure({
        batchSize: failedUpperBound,
      });
      const {
        reset: _reset,
        workerGeneration: _workerGeneration,
        ...sameMigrationArgs
      } = args;
      await scheduleWorker(ctx, state, {
        ...sameMigrationArgs,
        cursor: state.cursor,
        currentRangeIndex: state.currentRangeIndex ?? 0,
        batchSize: nextBatchSize,
        dryRun: false,
      });
      state.error = undefined;
      state.latestEnd = undefined;
      state.currentBatchSize = nextBatchSize;
      state.lastFailedBatchSize = failedUpperBound;
      state.limitingMetric = limitingMetric;
      await ctx.db.patch("migrations", state._id, state);
      return getMigrationState(ctx, state);
    }

    state.workerId = undefined;
    if (failedUpperBound !== undefined) {
      state.currentBatchSize = failedUpperBound;
      state.lastFailedBatchSize = failedUpperBound;
    }
    state.error = failure.message;
    state.latestEnd = Date.now();
    state.limitingMetric = limitingMetric;
    await ctx.db.patch("migrations", state._id, state);
    return getMigrationState(ctx, state);
  },
});

export const getStatus = query({
  args: {
    names: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(migrationStatus),
  handler: async (ctx, args) => {
    const docs = args.names
      ? await Promise.all(
          args.names.map(
            async (m) =>
              (await ctx.db
                .query("migrations")
                .withIndex("name", (q) => q.eq("name", m))
                .unique()) ?? {
                name: m,
                processed: 0,
                currentRangeIndex: 0,
                cursor: null,
                latestStart: 0,
                workerId: undefined,
                isDone: false as const,
              },
          ),
        )
      : await ctx.db
          .query("migrations")
          .order("desc")
          .take(args.limit ?? 100);

    return Promise.all(
      docs
        .reverse()
        .map(async (migration) => getMigrationState(ctx, migration)),
    );
  },
});

async function scheduleWorker(
  ctx: MutationCtx,
  state: Doc<"migrations">,
  args: WorkerScheduleArgs,
): Promise<void> {
  const workerGeneration = (state.workerGeneration ?? 0) + 1;
  state.workerId = await ctx.scheduler.runAfter(0, runWorkerFunction, {
    ...args,
    workerGeneration,
  });
  state.workerGeneration = workerGeneration;
}

async function claimWorker(
  ctx: MutationCtx,
  state: Doc<"migrations">,
  workerGeneration: number,
): Promise<boolean> {
  if (state.workerGeneration === workerGeneration) {
    if (state.workerId === undefined) {
      return true;
    }
    const worker = await ctx.db.system.get(
      "_scheduled_functions",
      state.workerId,
    );
    return (
      worker !== null &&
      (worker.state.kind === "pending" || worker.state.kind === "inProgress")
    );
  }
  if (
    state.workerGeneration !== undefined &&
    state.workerGeneration > workerGeneration
  ) {
    return false;
  }
  const storedWorker = state.workerId
    ? await ctx.db.system.get("_scheduled_functions", state.workerId)
    : null;
  if (
    storedWorker !== null &&
    (storedWorker.state.kind === "pending" ||
      storedWorker.state.kind === "inProgress")
  ) {
    return false;
  }
  state.workerGeneration = workerGeneration;
  return true;
}

function classifyWorkerFailure(error: unknown): WorkerFailure {
  const message = error instanceof Error ? error.message : String(error);
  const transactionLimitMetric = getTransactionLimitMetric(error);
  if (transactionLimitMetric !== undefined) {
    return {
      kind: "transactionLimit",
      limitingMetric: transactionLimitMetric,
      message,
    };
  }
  if (looksLikeSystemOperationsTimeout(error)) {
    return { kind: "systemOperationsTimeout", message };
  }
  if (looksLikeExecutionTimeout(error)) {
    return { kind: "executionTimeout", message };
  }
  if (looksLikeOccError(error)) {
    return { kind: "occ", message };
  }
  return { kind: "unknown", message };
}

function getWorkerFailureMetric(failure: WorkerFailure): string | undefined {
  switch (failure.kind) {
    case "transactionLimit":
      return failure.limitingMetric;
    case "executionTimeout":
      return MUTATION_USER_EXECUTION_TIME_METRIC;
    case "systemOperationsTimeout":
      return MUTATION_SYSTEM_OPERATIONS_TIME_METRIC;
    case "occ":
      return OCC_LIMITING_METRIC;
    case "unknown":
      return undefined;
  }
}

async function getMigrationState(
  ctx: QueryCtx,
  migration: WithoutSystemFields<Doc<"migrations">>,
): Promise<MigrationStatus> {
  const worker =
    migration.workerId &&
    (await ctx.db.system.get("_scheduled_functions", migration.workerId));
  const args = worker?.args[0] as
    | ObjectType<typeof runMigrationArgs>
    | undefined;
  const state = migration.isDone
    ? "success"
    : migration.error || worker?.state.kind === "failed"
      ? "failed"
      : worker?.state.kind === "canceled"
        ? "canceled"
        : worker?.state.kind === "inProgress" ||
            worker?.state.kind === "pending"
          ? "inProgress"
          : "unknown";
  return {
    name: migration.name,
    cursor: migration.isDone ? null : migration.cursor,
    processed: migration.processed,
    isDone: migration.isDone,
    latestStart: migration.latestStart,
    latestEnd: migration.latestEnd,
    error:
      migration.error ??
      (worker?.state.kind === "failed" ? worker.state.error : undefined),
    state,
    batchSize: args?.batchSize ?? migration.currentBatchSize,
    limitingMetric: migration.limitingMetric,
    currentRangeIndex:
      args?.currentRangeIndex ?? migration.currentRangeIndex ?? 0,
    next: args?.next?.map((n: { name: string }) => n.name),
  };
}

type MigrationBatchFailure = {
  batchSize: number;
  message: string;
};

function getMigrationBatchFailure(
  error: unknown,
): MigrationBatchFailure | undefined {
  if (!(error instanceof ConvexError)) {
    return undefined;
  }
  const data: unknown = error.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (record.kind !== MIGRATION_BATCH_FAILURE) {
    return undefined;
  }
  if (
    typeof record.batchSize !== "number" ||
    !Number.isInteger(record.batchSize) ||
    record.batchSize <= 0 ||
    typeof record.message !== "string"
  ) {
    return undefined;
  }
  return {
    batchSize: record.batchSize,
    message: record.message,
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
    const state = await cancelMigration(ctx, migration);
    if (state.state !== "canceled") {
      console.log(
        `Did not cancel migration ${migration.name}. Status was ${state.state}`,
      );
    }
    return state;
  },
});

async function cancelMigration(ctx: MutationCtx, migration: Doc<"migrations">) {
  const state = await getMigrationState(ctx, migration);
  if (state.isDone) {
    return state;
  }
  if (state.state === "inProgress") {
    if (migration.workerId) {
      await ctx.scheduler.cancel(migration.workerId);
    }
    console.log(`Canceled migration ${migration.name}`);
    return { ...state, state: "canceled" as const };
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
          : q.eq("isDone", false),
      )
      .take(100);
    if (results.length === 100) {
      await ctx.scheduler.runAfter(0, api.lib.cancelAll, {
        sinceTs: results[results.length - 1]!._creationTime,
      });
    }
    return Promise.all(results.map((m) => cancelMigration(ctx, m)));
  },
});

export const clearAll = mutation({
  args: { before: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("migrations")
      .withIndex("by_creation_time", (q) =>
        q.lte("_creationTime", args.before ?? Date.now()),
      )
      .order("desc")
      .take(100);
    for (const m of results) {
      await ctx.db.delete("migrations", m._id);
    }
    if (results.length === 100) {
      await ctx.scheduler.runAfter(0, api.lib.clearAll, {
        before: results[99]._creationTime,
      });
    }
  },
});
