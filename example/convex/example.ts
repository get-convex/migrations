import { Migrations, MigrationStatus } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api.js";
import { internalMutation, internalQuery } from "./_generated/server.js";

export const migrations = new Migrations(components.migrations, {
  internalMutation,
});

// Allows you to run `npx convex run example:run '{"fn":"example:setDefaultValue"}'`
export const run = migrations.runFromCLI();

// This allows you to just run `npx convex run example:runIt`
export const runIt = migrations.runFromCLI(internal.example.setDefaultValue);

export const setDefaultValue = migrations.define({
  table: "myTable",
  migrateOne: async (_ctx, doc) => {
    if (doc.optionalField === undefined) {
      return { optionalField: "default" };
    }
  },
});

export const clearField = migrations.define({
  table: "myTable",
  migrateOne: async (ctx, doc) => {
    if (doc.optionalField !== undefined) {
      await ctx.db.patch(doc._id, { optionalField: undefined });
    }
  },
});

export const validateRequiredField = migrations.define({
  table: "myTable",
  // Specify a custom range to only include documents that need to change.
  // This is useful if you have a large dataset and only a small percentage of
  // documents need to be migrated.
  customRange: (q) =>
    q.withIndex("requiredField", (q) => q.eq("requiredField", "")),
  migrateOne: async (_ctx, doc) => {
    console.log("Needs fixup: " + doc._id);
    // Shorthand for patching
    return { requiredField: "<empty>" };
  },
});

// If you prefer the old-style migration definition, you can define `migration`:
const migration = migrations.define.bind(migrations);
// Then use it like this:
export const convertUnionField = migration({
  table: "myTable",
  migrateOne: async (ctx, doc) => {
    if (typeof doc.unionField === "number") {
      await ctx.db.patch(doc._id, { unionField: doc.unionField.toString() });
    }
  },
});

// It's handy to have a list of all migrations that folks should run in order.
const allMigrations = [
  internal.example.setDefaultValue,
  internal.example.validateRequiredField,
  internal.example.convertUnionField,
];

// Call this from a deploy script to run them after pushing code.
export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    await migrations.runSerially(ctx, allMigrations);
  },
});

// Handy for checking the status from the CLI / dashboard.
export const getStatus = internalQuery({
  args: {},
  handler: async (ctx): Promise<MigrationStatus[]> => {
    return migrations.getStatus(ctx, {
      migrations: allMigrations,
    });
  },
});
