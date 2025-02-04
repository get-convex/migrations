/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Migrations } from "@convex-dev/migrations";
import schema from "./schema";
import componentSchema from "../../src/component/schema";
import { api, components, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const componentModules = import.meta.glob("../../src/component/**/*.ts");

describe("migrations client", () => {
  async function setupTest() {
    const t = convexTest(schema, modules);
    t.registerComponent("migrations", componentSchema, componentModules);
    await t.mutation(internal.example.seed, { count: 10 });
    return t;
  }

  let testEnv: {
    t: Awaited<ReturnType<typeof setupTest>>;
    migrations: Migrations;
    testMigration: ReturnType<typeof Migrations.prototype.define>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    const t = await setupTest();
    const migrations = new Migrations(components.migrations);
    const testMigration = migrations.define({
      table: "myTable",
      migrateOne: async () => ({ optionalField: "default" })
    });
    testEnv = { t, migrations, testMigration };
  });

  afterEach(async () => {
    await testEnv.t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("run basic migration", async () => {
    const { t, migrations, testMigration } = testEnv;
    
    await migrations.runOne(t.ctx, testMigration);
    
    const docs = await t.db.query("myTable").collect();
    for (const doc of docs) {
      expect(doc.optionalField).toBe("default");
    }
  });

  test("run validation migration", async () => {
    const { t, migrations } = testEnv;
    
    const validateMigration = migrations.define({
      table: "myTable",
      customRange: (query) =>
        query.withIndex("by_requiredField", (q) => q.eq("requiredField", "")),
      migrateOne: async (_ctx, doc) => {
        return { requiredField: "<unknown>" };
      },
    });
    
    await migrations.runOne(t.ctx, validateMigration);
    
    const docs = await t.db
      .query("myTable")
      .withIndex("by_requiredField", (q) => q.eq("requiredField", ""))
      .collect();
    expect(docs).toHaveLength(0);
  });

  test("run type conversion migration", async () => {
    const { t, migrations } = testEnv;
    
    const convertMigration = migrations.define({
      table: "myTable",
      migrateOne: async (ctx, doc) => {
        if (typeof doc.unionField === "number") {
          await ctx.db.patch(doc._id, { unionField: doc.unionField.toString() });
        }
      },
    });
    
    await migrations.runOne(t.ctx, convertMigration);
    
    const docs = await t.db.query("myTable").collect();
    for (const doc of docs) {
      expect(typeof doc.unionField).toBe("string");
    }
  });

  test("run batch migration with parallelize", async () => {
    const { t, migrations } = testEnv;
    
    const batchMigration = migrations.define({
      table: "myTable",
      batchSize: 2,
      parallelize: true,
      migrateOne: async (_ctx, doc) => {
        return { processed: true };
      },
    });
    
    await migrations.runOne(t.ctx, batchMigration);
    
    const docs = await t.db.query("myTable").collect();
    for (const doc of docs) {
      expect(doc.processed).toBe(true);
    }
  });

  test("handle failing migration", async () => {
    const { t, migrations } = testEnv;
    
    const failingMigration = migrations.define({
      table: "myTable",
      migrateOne: async (_ctx, _doc) => {
        throw new Error("Migration failed");
      },
    });
    
    await expect(migrations.runOne(t.ctx, failingMigration)).rejects.toThrow("Migration failed");
  });

  test("track migration state", async () => {
    const { t, migrations } = testEnv;
    
    const stateMigration = migrations.define({
      table: "myTable",
      migrateOne: async (_ctx, doc) => {
        return { state: "migrated" };
      },
    });
    
    const migration = migrations.runOne(t.ctx, stateMigration);
    
    // Check initial state
    let status = await t.query(api.lib.getStatus, { names: ["stateMigration"] });
    expect(status[0].state).toBe("inProgress");
    
    await migration;
    
    // Check final state
    status = await t.query(api.lib.getStatus, { names: ["stateMigration"] });
    expect(status[0]).toMatchObject({
      isDone: true,
      state: "success",
      processed: expect.any(Number),
      latestStart: expect.any(Number),
      latestEnd: expect.any(Number)
    });
  });
});
