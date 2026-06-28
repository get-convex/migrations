import { convexTest } from "convex-test";
import {
  type ApiFromModules,
  anyApi,
  createFunctionHandle,
} from "convex/server";
import type { TransactionMetrics } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import type { MigrationResult, MigrationStatus } from "../client/index.js";
import { MIGRATION_BATCH_FAILURE, migrationArgs } from "../shared.js";
import { api } from "./_generated/api.js";
import { mutation } from "./_generated/server.js";
import schema from "./schema.js";
import { modules } from "./setup.test.js";

export const doneMigration = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    return {
      isDone: true,
      continueCursor: "foo",
      processed: 1,
    };
  },
});

export const doneMigration2 = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    return {
      isDone: true,
      continueCursor: "bar",
      processed: 2,
    };
  },
});

export const lowUsageMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    return {
      isDone: false,
      continueCursor: "cursor_after_batch",
      processed: 10,
      batchSize: args.batchSize,
      metrics: metricsWithRatio(0.25),
    };
  },
});

export const highUsageMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    return {
      isDone: false,
      continueCursor: "cursor_after_batch",
      processed: 10,
      batchSize: args.batchSize,
      metrics: {
        ...metricsWithRatio(0.25),
        bytesWritten: {
          used: 0.9,
          remaining: 0.1,
        },
      },
    };
  },
});

export const transactionLimitMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    if ((args.batchSize ?? 100) > 5) {
      throw new Error("TooManyDocumentsRead");
    }
    return {
      isDone: true,
      continueCursor: "done",
      processed: 5,
      batchSize: args.batchSize,
      metrics: metricsWithRatio(0.5),
    };
  },
});

export const unknownLimitMigration = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    throw new Error("TooManyVectorIndexReads");
  },
});

export const wrappedTransactionLimitMigration = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    throw new ConvexError({
      kind: MIGRATION_BATCH_FAILURE,
      batchSize: 100,
      message: "TooManyDocumentsRead",
    });
  },
});

export const nullConvexErrorMigration = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    throw new ConvexError(null);
  },
});

export const occMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    if ((args.batchSize ?? 100) > 5) {
      throw new Error("OptimisticConcurrencyControlFailure");
    }
    return {
      isDone: true,
      continueCursor: "done",
      processed: 5,
      batchSize: args.batchSize,
      metrics: metricsWithRatio(0.5),
    };
  },
});

export const multiRangeMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    if ((args.currentRangeIndex ?? 0) === 0) {
      return {
        isDone: false,
        continueCursor: null,
        processed: 1,
        currentRangeIndex: 1,
        batchSize: args.batchSize,
        metrics: metricsWithRatio(0.5),
      };
    }
    return {
      isDone: true,
      continueCursor: "done",
      processed: 2,
      currentRangeIndex: 1,
      batchSize: args.batchSize,
      metrics: metricsWithRatio(0.5),
    };
  },
});

export const resetContinuationMigration = mutation({
  args: migrationArgs,
  handler: async (_ctx, args): Promise<MigrationResult> => {
    if (args.cursor === null) {
      return {
        isDone: false,
        continueCursor: "cursor_after_reset_batch",
        processed: 1,
        batchSize: args.batchSize,
        metrics: metricsWithRatio(0.5),
      };
    }
    return {
      isDone: true,
      continueCursor: "done",
      processed: 1,
      batchSize: args.batchSize,
      metrics: metricsWithRatio(0.5),
    };
  },
});

const testApi: ApiFromModules<{
  fns: {
    doneMigration: typeof doneMigration;
    doneMigration2: typeof doneMigration2;
    lowUsageMigration: typeof lowUsageMigration;
    highUsageMigration: typeof highUsageMigration;
    transactionLimitMigration: typeof transactionLimitMigration;
    unknownLimitMigration: typeof unknownLimitMigration;
    wrappedTransactionLimitMigration: typeof wrappedTransactionLimitMigration;
    nullConvexErrorMigration: typeof nullConvexErrorMigration;
    occMigration: typeof occMigration;
    multiRangeMigration: typeof multiRangeMigration;
    resetContinuationMigration: typeof resetContinuationMigration;
  };
}>["fns"] = anyApi["lib.test"] as any;

describe("migrate", () => {
  test("runs a simple migration in one go", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle: fnHandle,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.batchSize).toBeUndefined();
    expect(result.next).toBeUndefined();
    expect(result.latestEnd).toBeTypeOf("number");
    expect(result.state).toBe("success");
  });

  test("throws error for batchSize <= 0", async () => {
    const args = {
      name: "testMigration",
      fnHandle: "function://dummy",
      cursor: null,
      batchSize: 0,
      next: [],
      dryRun: false,
    };
    const t = convexTest(schema, modules);
    // Assumes testApi has shape matching api.lib – adjust per actual ConvexTest usage
    await expect(t.mutation(api.lib.migrate, args)).rejects.toThrow(
      "Batch size must be greater than 0",
    );
  });

  test("throws error for invalid fnHandle", async () => {
    const args = {
      name: "testMigration",
      fnHandle: "invalid_handle",
      cursor: null,
      batchSize: 10,
      next: [],
      dryRun: false,
    };
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.lib.migrate, args)).rejects.toThrow(
      "Invalid fnHandle",
    );
  });

  test("increases adaptive batch size after a low-usage batch", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.lowUsageMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testAdaptiveBatchSize",
      fnHandle,
      batchSize: 50,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(100);
    expect(result.limitingMetric).toBeUndefined();
    expect(result.state).toBe("unknown");
    expect(result.error).toBeUndefined();
  });

  test("records limiting metric after metric-based shrink", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.highUsageMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testAdaptiveBatchSizeShrink",
      fnHandle,
      batchSize: 50,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(27);
    expect(result.limitingMetric).toBe("bytesWritten");
    expect(result.state).toBe("unknown");
    expect(result.error).toBeUndefined();
  });

  test("reduces batch size after transaction-limit failure", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.transactionLimitMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testTransactionLimitRetry",
      fnHandle,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(5);
    expect(result.limitingMetric).toBe("documentsRead");
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("unknown");
  });

  test("dry run reports transaction-limit failure instead of retrying silently", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.transactionLimitMigration),
    );
    let thrown: unknown;

    try {
      await t.mutation(api.lib.migrate, {
        name: "testDryRunTransactionLimitFailure",
        fnHandle,
        batchSize: 10,
        dryRun: true,
        adaptiveBatchSize: true,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConvexError);
    if (!(thrown instanceof ConvexError)) {
      throw new Error("Expected dry run ConvexError");
    }
    const data = thrown.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Expected dry run status data");
    }
    const record = data as Record<string, unknown>;
    expect(record.kind).toBe("DRY RUN");
    const status = record.status as MigrationStatus;
    expect(status.error).toBe("TooManyDocumentsRead");
  });

  test("dry run treats non-protocol ConvexError data as a migration failure", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.nullConvexErrorMigration),
    );
    let thrown: unknown;

    try {
      await t.mutation(api.lib.migrate, {
        name: "testDryRunNullConvexError",
        fnHandle,
        dryRun: true,
        adaptiveBatchSize: true,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConvexError);
    if (!(thrown instanceof ConvexError)) {
      throw new Error("Expected dry run ConvexError");
    }
    const data = thrown.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Expected dry run status data");
    }
    const record = data as Record<string, unknown>;
    expect(record.kind).toBe("DRY RUN");
    const status = record.status as MigrationStatus;
    expect(status.state).toBe("failed");
    expect(status.error).toBe("null");
  });

  test("reduces wrapped default batch size after transaction-limit failure", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.wrappedTransactionLimitMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testWrappedTransactionLimitRetry",
      fnHandle,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(50);
    expect(result.limitingMetric).toBe("documentsRead");
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("unknown");
  });

  test("stores unknown limit-like failure without retrying", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.unknownLimitMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testUnknownLimitFailure",
      fnHandle,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(10);
    expect(result.limitingMetric).toBeUndefined();
    expect(result.error).toBe("TooManyVectorIndexReads");
    expect(result.state).toBe("failed");
  });

  test("reduces batch size after OCC failure", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.occMigration),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testOccRetry",
      fnHandle,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
      adaptiveBatchSize: true,
    });

    expect(result.batchSize).toBe(5);
    expect(result.limitingMetric).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("unknown");
  });

  test("persists current range index across batches", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.multiRangeMigration),
    );
    const first = await t.mutation(api.lib.migrate, {
      name: "testMultiRange",
      fnHandle,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
    });

    expect(first.isDone).toBe(false);
    expect(first.cursor).toBe(null);
    expect(first.currentRangeIndex).toBe(1);
    expect(first.processed).toBe(1);

    const second = await t.mutation(api.lib.migrate, {
      name: "testMultiRange",
      fnHandle,
      batchSize: 10,
      dryRun: false,
      oneBatchOnly: true,
    });

    expect(second.isDone).toBe(true);
    expect(second.currentRangeIndex).toBe(1);
    expect(second.processed).toBe(3);
  });
});

export const inProgressMigration = mutation({
  args: migrationArgs,
  handler: async (): Promise<MigrationResult> => {
    // Simulates a migration that processes 10 items and needs to continue
    return {
      isDone: false,
      continueCursor: "cursor_after_10",
      processed: 10,
    };
  },
});

const inProgressApi: ApiFromModules<{
  fns: { inProgressMigration: typeof inProgressMigration };
}>["fns"] = anyApi["lib.test"] as any;

describe("cancel", () => {
  test("throws error if migration not found", async () => {
    // For cancel, ConvexTest-like patterns would be similar – this code demonstrates minimal direct call
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.cancel, { name: "nonexistent" }),
    ).rejects.toThrow();
  });

  test("cancel calls scheduler.cancel when workerId exists", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(inProgressApi.inProgressMigration),
    );

    // Start migration with oneBatchOnly=false so it schedules next batch
    const result = await t.mutation(api.lib.migrate, {
      name: "testCancelMigration",
      fnHandle: fnHandle,
      dryRun: false,
      oneBatchOnly: false,
    });

    expect(result.state).toBe("inProgress");
    expect(result.isDone).toBe(false);

    // Cancel it
    const cancelResult = await t.mutation(api.lib.cancel, {
      name: "testCancelMigration",
    });
    expect(cancelResult.state).toBe("canceled");

    // Verify getStatus also shows canceled
    const status = await t.query(api.lib.getStatus, {
      names: ["testCancelMigration"],
    });
    expect(status[0]?.state).toBe("canceled");
  });

  test("oneBatchOnly call does not run beside an active scheduled worker", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(inProgressApi.inProgressMigration),
    );

    const first = await t.mutation(api.lib.migrate, {
      name: "testOneBatchOnlyRace",
      fnHandle,
      dryRun: false,
      oneBatchOnly: false,
    });
    expect(first.state).toBe("inProgress");
    expect(first.cursor).toBe("cursor_after_10");
    expect(first.processed).toBe(10);

    const duplicate = await t.mutation(api.lib.migrate, {
      name: "testOneBatchOnlyRace",
      fnHandle,
      cursor: "cursor_after_10",
      dryRun: false,
      oneBatchOnly: true,
    });

    expect(duplicate.state).toBe("inProgress");
    expect(duplicate.processed).toBe(10);

    const [status] = await t.query(api.lib.getStatus, {
      names: ["testOneBatchOnlyRace"],
    });
    expect(status?.state).toBe("inProgress");
    expect(status?.processed).toBe(10);
  });

  test("canceled migration can be restarted", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );

    // Create a migration with a canceled scheduled function
    await t.run(async (ctx) => {
      const workerId = await ctx.scheduler.runAfter(
        0,
        testApi.doneMigration,
        {},
      );
      await ctx.scheduler.cancel(workerId);
      await ctx.db.insert("migrations", {
        name: "testRestartCanceled",
        latestStart: Date.now(),
        workerId,
        isDone: false,
        cursor: "old_cursor",
        processed: 25,
      });
      const [status] = await ctx.runQuery(api.lib.getStatus, {
        names: ["testRestartCanceled"],
      });
      expect(status?.state).toBe("canceled");
    });

    // Restart without a cursor
    const result = await t.mutation(api.lib.migrate, {
      name: "testRestartCanceled",
      fnHandle: fnHandle,
      dryRun: false,
    });

    expect(result.state).toBe("success");
    expect(result.isDone).toBe(true);
  });
});

describe("It doesn't attempt a migration if it's already done", () => {
  test("runs a simple migration in one go", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = "function://invalid";
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "testMigration",
        latestStart: Date.now(),
        isDone: true,
        cursor: "foo",
        processed: 1,
      }),
    );
    // It'd throw if it tried to run the migration.
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle: fnHandle,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
  });
});

describe("reset", () => {
  test("reset re-runs a migration that was already done", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    // Pre-seed a completed migration
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "testMigration",
        latestStart: Date.now(),
        isDone: true,
        cursor: "oldCursor",
        processed: 5,
      }),
    );
    // Without reset, it would skip (already done). With reset + cursor: null,
    // it should re-run from the beginning.
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      cursor: null,
      reset: true,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    // processed is reset to 0 then incremented by 1 from doneMigration
    expect(result.processed).toBe(1);
    expect(result.state).toBe("success");
  });

  test("reset with cursor: null restarts from beginning", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    // Pre-seed a migration that was in progress (not done)
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "testMigration",
        latestStart: Date.now(),
        isDone: false,
        cursor: "someCursor",
        processed: 50,
      }),
    );
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      cursor: null,
      reset: true,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    // processed should be reset: 0 + 1 from the migration run
    expect(result.processed).toBe(1);
  });

  test("reset propagates to next migrations in a series", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fnHandle1 = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    const fnHandle2 = await t.run(() =>
      createFunctionHandle(testApi.doneMigration2),
    );
    // Pre-seed both migrations as completed
    await t.run(async (ctx) => {
      await ctx.db.insert("migrations", {
        name: "migration1",
        latestStart: Date.now(),
        isDone: true,
        cursor: "cursor1",
        processed: 10,
      });
      await ctx.db.insert("migrations", {
        name: "migration2",
        latestStart: Date.now(),
        isDone: true,
        cursor: "cursor2",
        processed: 20,
      });
    });
    // Run migration1 with reset and a next migration
    const result = await t.mutation(api.lib.migrate, {
      name: "migration1",
      fnHandle: fnHandle1,
      cursor: null,
      reset: true,
      next: [{ name: "migration2", fnHandle: fnHandle2 }],
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    expect(result.processed).toBe(1);

    // The next migration should have been scheduled with reset: true.
    // Run the scheduled functions to verify it actually runs migration2.
    // finishAllScheduledFunctions runs all scheduled functions including
    // those scheduled by scheduled functions.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Check migration2 state was reset and re-run
    const statuses = await t.query(api.lib.getStatus, {
      names: ["migration2"],
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.isDone).toBe(true);
    // migration2 ran with reset, so processed should be fresh (2 from doneMigration2)
    expect(statuses[0]!.processed).toBe(2);
    vi.useRealTimers();
  });

  test("without reset, already-done next migrations are skipped", async () => {
    const t = convexTest(schema, modules);
    const fnHandle1 = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    const fnHandle2 = await t.run(() =>
      createFunctionHandle(testApi.doneMigration2),
    );
    // Pre-seed migration2 as completed
    await t.run(async (ctx) => {
      await ctx.db.insert("migrations", {
        name: "migration2",
        latestStart: Date.now(),
        isDone: true,
        cursor: null,
        processed: 20,
      });
    });
    // Run migration1 WITHOUT reset, with next pointing to already-done migration2
    const result = await t.mutation(api.lib.migrate, {
      name: "migration1",
      fnHandle: fnHandle1,
      next: [{ name: "migration2", fnHandle: fnHandle2 }],
      dryRun: false,
    });
    expect(result.isDone).toBe(true);

    await t.finishInProgressScheduledFunctions();

    // migration2 should remain unchanged (not re-run)
    const statuses = await t.query(api.lib.getStatus, {
      names: ["migration2"],
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.processed).toBe(20);
    expect(statuses[0]!.cursor).toBe(null);
  });

  test("without reset, partially-done next migration resumes stored range", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fnHandle1 = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    const fnHandle2 = await t.run(() =>
      createFunctionHandle(testApi.multiRangeMigration),
    );
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "migration2",
        latestStart: Date.now(),
        isDone: false,
        cursor: null,
        currentRangeIndex: 1,
        processed: 10,
      }),
    );

    await t.mutation(api.lib.migrate, {
      name: "migration1",
      fnHandle: fnHandle1,
      next: [{ name: "migration2", fnHandle: fnHandle2 }],
      dryRun: false,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [status] = await t.query(api.lib.getStatus, {
      names: ["migration2"],
    });
    expect(status?.isDone).toBe(true);
    expect(status?.currentRangeIndex).toBe(1);
    expect(status?.processed).toBe(12);
    vi.useRealTimers();
  });

  test("reset on a fresh migration (no prior state) works", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    // No pre-seeded state — reset on a brand new migration
    const result = await t.mutation(api.lib.migrate, {
      name: "freshMigration",
      fnHandle,
      cursor: null,
      reset: true,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.state).toBe("success");
  });

  test("reset re-runs a completed migration whose cursor is already null", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.doneMigration),
    );
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "testMigration",
        latestStart: Date.now(),
        isDone: true,
        cursor: null,
        processed: 5,
      }),
    );

    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      cursor: null,
      reset: true,
      dryRun: false,
    });

    expect(result.isDone).toBe(true);
    expect(result.processed).toBe(1);
  });

  test("reset scheduled continuation runs the next batch", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.resetContinuationMigration),
    );
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "resetContinuation",
        latestStart: Date.now(),
        isDone: false,
        cursor: "oldCursor",
        processed: 10,
      }),
    );

    const first = await t.mutation(api.lib.migrate, {
      name: "resetContinuation",
      fnHandle,
      cursor: null,
      reset: true,
      dryRun: false,
    });
    expect(first.isDone).toBe(false);
    expect(first.processed).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [status] = await t.query(api.lib.getStatus, {
      names: ["resetContinuation"],
    });
    expect(status?.isDone).toBe(true);
    expect(status?.processed).toBe(2);
    vi.useRealTimers();
  });

  test("reset transaction-limit retry runs at the smaller batch size", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fnHandle = await t.run(() =>
      createFunctionHandle(testApi.transactionLimitMigration),
    );
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "resetLimitRetry",
        latestStart: Date.now(),
        isDone: false,
        cursor: "oldCursor",
        processed: 10,
      }),
    );

    const first = await t.mutation(api.lib.migrate, {
      name: "resetLimitRetry",
      fnHandle,
      cursor: null,
      reset: true,
      batchSize: 10,
      dryRun: false,
      adaptiveBatchSize: true,
    });
    expect(first.isDone).toBe(false);
    expect(first.batchSize).toBe(5);
    expect(first.limitingMetric).toBe("documentsRead");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [status] = await t.query(api.lib.getStatus, {
      names: ["resetLimitRetry"],
    });
    expect(status?.isDone).toBe(true);
    expect(status?.processed).toBe(5);
    vi.useRealTimers();
  });
});

function metricsWithRatio(ratio: number): TransactionMetrics {
  const metric = {
    used: ratio,
    remaining: 1 - ratio,
  };
  return {
    bytesRead: metric,
    bytesWritten: metric,
    databaseQueries: metric,
    documentsRead: metric,
    documentsWritten: metric,
    functionsScheduled: metric,
    scheduledFunctionArgsBytes: metric,
  };
}
