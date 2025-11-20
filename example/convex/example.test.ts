import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { internal } from "./_generated/api";
import { migrations } from "./example";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("setDefaultValue", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    await t.run(async (ctx) => {
      const docs = await ctx.db.query("myTable").collect();
      expect(docs).toHaveLength(10);
      expect(docs.some((doc) => doc.optionalField === undefined)).toBe(true);
    });
    await t.run(async (ctx) => {
      await migrations.runOne(ctx, internal.example.setDefaultValue, {
        batchSize: 2,
        dryRun: false,
      });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after).toHaveLength(10);
      expect(after.every((doc) => doc.optionalField !== undefined)).toBe(true);
    });
  });
});
