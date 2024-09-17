import {
  components,
  internalMutation,
  internalQuery,
} from "./_generated/server.js";
import { defineMigrations } from "@convex-dev/migrations";
import { internal } from "./_generated/api.js";
import { MigrationStatus } from "../../src/shared.js";

export const { run, migration, ...migrationApi } = defineMigrations(
  components.migrations,
  {
    internalMutation,
  }
);

export const setDefaultValue = migration({
  table: "myTable",
  migrateOne: async (_ctx, doc) => {
    if (doc.optionalField === undefined) {
      return { optionalField: "default" };
    }
  },
});

export const clearField = migration({
  table: "myTable",
  migrateOne: async (ctx, doc) => {
    if (doc.optionalField !== undefined) {
      await ctx.db.patch(doc._id, { optionalField: undefined });
    }
  },
});
export const validateRequiredField = migration({
  table: "myTable",
  migrateOne: async (_ctx, doc) => {
    if (doc.requiredField === "") {
      console.log("Needs fixup: " + doc._id);
      // Shorthand for patching
      return { requiredField: "<empty>" };
    }
  },
});

export const convertUnionField = migration({
  table: "myTable",
  migrateOne: async (ctx, doc) => {
    if (typeof doc.unionField === "number") {
      await ctx.db.patch(doc._id, { unionField: doc.unionField.toString() });
    }
  },
});

const allMigrations = [
  internal.example.setDefaultValue,
  internal.example.validateRequiredField,
  internal.example.convertUnionField,
];
export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    await migrationApi.startMigrationsSerially(ctx, allMigrations);
  },
});

export const getStatus = internalQuery({
  args: {},
  handler: async (ctx): Promise<MigrationStatus[]> => {
    return migrationApi.getStatus(ctx, {
      migrations: allMigrations,
    });
  },
});
