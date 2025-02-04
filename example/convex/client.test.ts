/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Migrations } from "@convex-dev/migrations";
import { DataModel } from "./_generated/dataModel";
import schema from "./schema";
import componentSchema from "../../src/component/schema";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema";
import { api, components, internal } from "./_generated/api";

const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/*.ts"
);

const modules = import.meta.glob("./**/*.ts");
const componentModules = import.meta.glob("../../src/component/**/*.ts");

describe("migrations client", () => {
  async function setupTest() {
    const t = convexTest(schema, modules);
    t.registerComponent("migrations", migrationsSchema, migrationsModules);
    await t.mutation(internal.example.seed, { count: 10 });
    return t;
  }

  let testEnv: {
    t: ReturnType<typeof convexTest>;
    migrations: Migrations<DataModel>;
    testMigration: ReturnType<typeof Migrations.prototype.define>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    const t = await setupTest();
    const migrations = new Migrations<DataModel>(components.migrations);
    const testMigration = migrations.define({
      table: "myTable",
      migrateOne: async (ctx: { db: any }, doc: { optionalField?: string }) => ({ optionalField: "default" })
    });
    testEnv = { t, migrations, testMigration };
  });

  afterEach(async () => {
    await testEnv.t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("run basic migration", async () => {
    const { t, migrations, testMigration } = testEnv;
    
    await migrations.runOne(t, testMigration);
    
    const docs = await t.query("myTable").collect();
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
      migrateOne: async (ctx, doc: { requiredField?: string }) => {
        return { requiredField: "<unknown>" };
      },
    });
    
    await migrations.runOne(t, validateMigration);
    
    const docs = await t.query("myTable")
      .withIndex("by_requiredField", (q) => q.eq("requiredField", ""))
      .collect();
    expect(docs).toHaveLength(0);
  });

  test("run type conversion migration", async () => {
    const { t, migrations } = testEnv;
    
    const convertMigration = migrations.define({
      table: "myTable",
      migrateOne: async (ctx: { db: any }, doc: { _id: any; unionField: string | number }) => {
        if (typeof doc.unionField === "number") {
          await ctx.db.patch(doc._id, { unionField: doc.unionField.toString() });
        }
      },
    });
    
    await migrations.runOne(t, convertMigration);
    
    const docs = await t.query("myTable").collect();
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
      migrateOne: async (ctx, doc: { processed?: boolean }) => {
        return { processed: true };
      },
    });
    
    await migrations.runOne(t, batchMigration);
    
    const docs = await t.query("myTable").collect();
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
    
    await expect(migrations.runOne(t, failingMigration)).rejects.toThrow("Migration failed");
  });

  test("track migration state", async () => {
    const { t, migrations } = testEnv;
    
    const stateMigration = migrations.define({
      table: "myTable",
      migrateOne: async (ctx, doc: { state?: string }) => {
        return { state: "migrated" };
      },
    });
    
    const migration = migrations.runOne(t, stateMigration);
    
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
