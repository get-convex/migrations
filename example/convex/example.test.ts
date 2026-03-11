import {
  afterEach,
  assertType,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { initConvexTest } from "./setup.test";
import { components, internal } from "./_generated/api";
import { runToCompletion } from "@convex-dev/migrations";
import { createFunctionHandle, getFunctionName } from "convex/server";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("test setDefaultValue migration", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    await t.run(async (ctx) => {
      const docs = await ctx.db.query("myTable").collect();
      expect(docs).toHaveLength(10);
      expect(docs.some((doc) => doc.optionalField === undefined)).toBe(true);
    });
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.example.setDefaultValue,
        { batchSize: 2 },
      );
    });
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after).toHaveLength(10);
      expect(after.every((doc) => doc.optionalField !== undefined)).toBe(true);
    });
  });

  test("test failingMigration", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    await expect(
      t.run(async (ctx) => {
        await runToCompletion(
          ctx,
          components.migrations,
          internal.example.failingMigration,
        );
      }),
    ).rejects.toThrow("This migration fails after the first");
  });

  test("test migrating with function handle", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    await t.run(async (ctx) => {
      const docs = await ctx.db.query("myTable").collect();
      expect(docs).toHaveLength(10);
      expect(docs.some((doc) => doc.optionalField === undefined)).toBe(true);
    });
    await t.run(async (ctx) => {
      const fnHandle = await createFunctionHandle(
        internal.example.setDefaultValue,
      );
      await runToCompletion(ctx, components.migrations, fnHandle, {
        name: getFunctionName(internal.example.setDefaultValue),
        batchSize: 2,
      });
    });
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after).toHaveLength(10);
      expect(after.every((doc) => doc.optionalField !== undefined)).toBe(true);
    });
  });
  test("test migration with runtime args", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.example.setConfiguredValue,
        { args: { value: "configured" } },
      );
    });
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after).toHaveLength(10);
      expect(after.every((doc) => doc.optionalField === "configured")).toBe(
        true,
      );
    });
  });

  test("same migration with different args runs independently", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 10 });
    // Run with first set of args
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.example.setConfiguredValue,
        { args: { value: "first" } },
      );
    });
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after.every((doc) => doc.optionalField === "first")).toBe(true);
    });
    // Run with second set of args — should NOT no-op
    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.example.setConfiguredValue,
        { args: { value: "second" } },
      );
    });
    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(after.every((doc) => doc.optionalField === "second")).toBe(true);
    });
  });

  test("args type is inferred from the migration definition", () => {
    // Type-level only test: verify that args for setConfiguredValue is inferred
    // as { value: string }, not `any`.
    // We use a function that is never called to avoid runtime errors.
    function _typeCheck(ctx: any) {
      // Correct args — should type-check fine
      void runToCompletion(
        ctx,
        components.migrations,
        internal.example.setConfiguredValue,
        { args: { value: "test" } },
      );

      // @ts-expect-error — wrong args: `notAField` is not in { value: string }
      void runToCompletion(
        ctx,
        components.migrations,
        internal.example.setConfiguredValue,
        { args: { notAField: 123 } },
      );
    }
    _typeCheck;
  });
});
