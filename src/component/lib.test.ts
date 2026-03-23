import { describe, test, expect } from "vitest";
import {
  type ApiFromModules,
  anyApi,
  createFunctionHandle,
} from "convex/server";
import { convexTest } from "convex-test";
import { modules } from "./setup.test.js";
import { api } from "./_generated/api.js";
import type { MigrationArgs, MigrationResult } from "../client/index.js";
import { mutation } from "./_generated/server.js";
import schema from "./schema.js";

export const doneMigration = mutation({
  handler: async (_, _args: MigrationArgs): Promise<MigrationResult> => {
    return {
      isDone: true,
      continueCursor: "foo",
      processed: 1,
    };
  },
});

const testApi: ApiFromModules<{
  fns: { doneMigration: typeof doneMigration };
}>["fns"] = anyApi["lib.test"] as any;

describe("migrate", () => {
  test("runs a simple migration in one go", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await createFunctionHandle(testApi.doneMigration);
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle: fnHandle,
      dryRun: false,
    });
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBe("foo");
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
});

export const inProgressMigration = mutation({
  handler: async (_, _args: MigrationArgs): Promise<MigrationResult> => {
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
    const fnHandle = await createFunctionHandle(
      inProgressApi.inProgressMigration,
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

  test("canceled migration can be restarted", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await createFunctionHandle(testApi.doneMigration);

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
