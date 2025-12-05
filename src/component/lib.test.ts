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

export const notDoneMigration = mutation({
  handler: async (_, _args: MigrationArgs): Promise<MigrationResult> => {
    return {
      isDone: false,
      continueCursor: "nextBatch",
      processed: 1,
    };
  },
});

const testApi: ApiFromModules<{
  fns: { doneMigration: typeof doneMigration; notDoneMigration: typeof notDoneMigration };
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

describe("cancel", () => {
  test("throws error if migration not found", async () => {
    // For cancel, ConvexTest-like patterns would be similar – this code demonstrates minimal direct call
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.lib.cancel, { name: "nonexistent" }),
    ).rejects.toThrow();
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

describe("forceContinue", () => {
  test("forceContinue runs a completed migration again", async () => {
    const t = convexTest(schema, modules);
    const fnHandle = await createFunctionHandle(testApi.doneMigration);

    // First run - completes the migration
    const result1 = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      dryRun: false,
    });
    expect(result1.isDone).toBe(true);
    expect(result1.cursor).toBe("foo");
    expect(result1.processed).toBe(1);

    // Second run without forceContinue - should no-op and not run the migration
    const result2 = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      dryRun: false,
    });
    expect(result2.isDone).toBe(true);
    expect(result2.cursor).toBe("foo");
    expect(result2.processed).toBe(1); // still 1, didn't process again

    // Third run WITH forceContinue - should run the migration again
    const result3 = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      forceContinue: true,
      dryRun: false,
    });
    expect(result3.isDone).toBe(true);
    expect(result3.cursor).toBe("foo");
    expect(result3.processed).toBe(2); // incremented because it processed again
  });

  test("forceContinue is not propagated to scheduled batches", async () => {
    const t = convexTest(schema, modules);

    const fnHandle = await createFunctionHandle(testApi.notDoneMigration);

    // Insert a completed migration
    await t.run((ctx) =>
      ctx.db.insert("migrations", {
        name: "testMigration",
        latestStart: Date.now(),
        isDone: true,
        cursor: "previousEnd",
        processed: 5,
      }),
    );

    // Run with forceContinue
    const result = await t.mutation(api.lib.migrate, {
      name: "testMigration",
      fnHandle,
      forceContinue: true,
      dryRun: false,
    });

    expect(result.isDone).toBe(false);
    expect(result.cursor).toBe("nextBatch");

    // Verify the scheduled job was created
    const state = await t.run(async (ctx) => {
      return await ctx.db
        .query("migrations")
        .withIndex("name", (q) => q.eq("name", "testMigration"))
        .unique();
    });

    expect(state).not.toBeNull();
    expect(state!.workerId).toBeDefined();

    // Check that the scheduled job does NOT have forceContinue: true
    const scheduledJob = await t.run(async (ctx) => {
      return await ctx.db.system.get(state!.workerId!);
    });

    expect(scheduledJob).toBeDefined();
    expect(scheduledJob!.args[0]).toMatchObject({
      name: "testMigration",
      forceContinue: false, // This is the key assertion
      cursor: "nextBatch",
    });
  });
});
