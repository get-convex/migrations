/**
 * Example: Migrations inside a Convex Component
 *
 * When writing migrations for data inside a component, you MUST pass the schema
 * to the Migrations constructor. This is because the built-in .paginate() method
 * is not available in component contexts - we use the paginator from convex-helpers instead.
 */
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import schema from "./schema.js";

export const migrations = new Migrations(components.migrations, {
  internalMutation,
  schema,
});

// Create a runner for CLI usage
export const run = migrations.runner();

// Example migration: Add default value to the 'value' field
export const addDefaultValue = migrations.define({
  table: "componentData",
  migrateOne: async (_ctx, doc) => {
    if (doc.value === undefined) {
      return { value: "default" };
    }
  },
});

// Seed function to create test data
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert("componentData", {
        name: `Item ${i}`,
        value: i % 2 === 0 ? undefined : `value-${i}`,
      });
    }
  },
});
