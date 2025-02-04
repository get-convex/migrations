import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { modules } from "./setup.test.js";
import { api } from "./_generated/api.js";

describe("migrations", () => {
  async function setupTest() {
    const t = convexTest(schema, modules);
    t.registerComponent("migrations", schema, modules);
    return t;
  }

  let t: Awaited<ReturnType<typeof setupTest>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = await setupTest();
  });

  afterEach(async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("basic migration", async () => {
    const migrationName = "test_migration";
    await t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/setDefaultValue",
      dryRun: false
    });
    
    const status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0]).toMatchObject({
      name: migrationName,
      isDone: true,
      state: "success"
    });
  });

  test("cancel migration", async () => {
    const migrationName = "test_cancel";
    await t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/setDefaultValue",
      dryRun: false
    });
    
    const status = await t.mutation(api.lib.cancel, { name: migrationName });
    expect(status.state).toBe("canceled");
  });

  test("dry run migration", async () => {
    const migrationName = "test_dry_run";
    await t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/setDefaultValue",
      dryRun: true
    });
    
    const status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0].state).toBe("unknown");
  });

  test("batch operations", async () => {
    const migrationName = "test_batch";
    await t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/setDefaultValue",
      batchSize: 2,
      dryRun: false
    });
    
    const status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0]).toMatchObject({
      name: migrationName,
      isDone: true,
      state: "success",
      batchSize: 2
    });
  });

  test("error handling", async () => {
    const migrationName = "test_error";
    await t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/failingMigration",
      dryRun: false
    });
    
    const status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0]).toMatchObject({
      name: migrationName,
      state: "failed",
      error: expect.any(String)
    });
  });

  test("migration state tracking", async () => {
    const migrationName = "test_state";
    const migration = t.mutation(api.lib.migrate, {
      name: migrationName,
      fnHandle: "function://internal/example/setDefaultValue",
      dryRun: false
    });
    
    // Check initial state
    let status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0].state).toBe("inProgress");
    
    await migration;
    
    // Check final state
    status = await t.query(api.lib.getStatus, { names: [migrationName] });
    expect(status[0]).toMatchObject({
      name: migrationName,
      isDone: true,
      state: "success",
      processed: expect.any(Number),
      latestStart: expect.any(Number),
      latestEnd: expect.any(Number)
    });
  });
});
