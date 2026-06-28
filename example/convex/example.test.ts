import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

  test("test migration over multiple custom ranges", async () => {
    const t = initConvexTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("myTable", {
        requiredField: "<todo1>",
        unionField: 1,
      });
      await ctx.db.insert("myTable", {
        requiredField: "<todo1>",
        unionField: 2,
      });
      await ctx.db.insert("myTable", {
        requiredField: "<todo2>",
        unionField: 3,
      });
      await ctx.db.insert("myTable", {
        requiredField: "keep",
        unionField: 4,
      });
    });

    await t.run(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.example.validateRequiredFieldVariants,
      );
    });

    await t.run(async (ctx) => {
      const after = await ctx.db.query("myTable").collect();
      expect(
        after.filter((doc) => doc.requiredField === "<unknown>"),
      ).toHaveLength(3);
      expect(after.filter((doc) => doc.requiredField === "keep")).toHaveLength(
        1,
      );
    });
  });

  test("runToCompletion resumes multi-range migration at stored range", async () => {
    const t = initConvexTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("myTable", {
        requiredField: "<todo1>",
        unionField: 1,
      });
      await ctx.db.insert("myTable", {
        requiredField: "<todo2>",
        unionField: 2,
      });
    });

    await t.run(async (ctx) => {
      const fnHandle = await createFunctionHandle(
        internal.example.validateRequiredFieldVariants,
      );
      const first = await ctx.runMutation(components.migrations.lib.migrate, {
        name: getFunctionName(internal.example.validateRequiredFieldVariants),
        fnHandle,
        cursor: null,
        currentRangeIndex: 0,
        batchSize: 10,
        dryRun: false,
        oneBatchOnly: true,
        adaptiveBatchSize: false,
      });

      expect(first.isDone).toBe(false);
      expect(first.currentRangeIndex).toBe(1);
      expect(first.processed).toBe(1);
    });

    await t.run(async (ctx) => {
      const status = await runToCompletion(
        ctx,
        components.migrations,
        internal.example.validateRequiredFieldVariants,
      );

      expect(status.isDone).toBe(true);
      expect(status.processed).toBe(2);
    });
  });

  test("runToCompletion no-ops while scheduled worker is active", async () => {
    const t = initConvexTest();
    await t.mutation(internal.example.seed, { count: 3 });

    await t.run(async (ctx) => {
      const fnHandle = await createFunctionHandle(
        internal.example.setDefaultValue,
      );
      const first = await ctx.runMutation(components.migrations.lib.migrate, {
        name: getFunctionName(internal.example.setDefaultValue),
        fnHandle,
        cursor: null,
        batchSize: 1,
        dryRun: false,
        adaptiveBatchSize: false,
      });
      expect(first.state).toBe("inProgress");
      expect(first.processed).toBe(1);

      const status = await runToCompletion(
        ctx,
        components.migrations,
        internal.example.setDefaultValue,
        { batchSize: 1 },
      );

      expect(status.state).toBe("inProgress");
      expect(status.processed).toBe(1);
    });
  });
});
