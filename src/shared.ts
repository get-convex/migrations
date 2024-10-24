import { Infer, ObjectType, v } from "convex/values";

export const migrationArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  batchSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
};
export type MigrationArgs = ObjectType<typeof migrationArgs>;

export const migrationResult = v.object({
  continueCursor: v.string(),
  isDone: v.boolean(),
  processed: v.number(),
});
export type MigrationResult = Infer<typeof migrationResult>;

export const migrationStatus = v.object({
  name: v.string(),
  cursor: v.optional(v.union(v.string(), v.null())),
  processed: v.number(),
  isDone: v.boolean(),
  error: v.optional(v.string()),
  state: v.union(
    v.literal("inProgress"),
    v.literal("success"),
    v.literal("failed"),
    v.literal("canceled"),
    v.literal("unknown")
  ),
  latestStart: v.number(),
  latestEnd: v.optional(v.number()),
  batchSize: v.optional(v.number()),
  next: v.optional(v.array(v.string())),
});
export type MigrationStatus = Infer<typeof migrationStatus>;
