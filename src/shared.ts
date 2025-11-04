import { type Infer, type ObjectType, v } from "convex/values";

export const migrationArgs = {
  fn: v.optional(v.string()),
  cursor: v.optional(v.union(v.string(), v.null())),
  batchSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
  next: v.optional(v.array(v.string())),
};
export type MigrationArgs = ObjectType<typeof migrationArgs>;

export type MigrationResult = {
  continueCursor: string;
  isDone: boolean;
  processed: number;
};

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
    v.literal("unknown"),
  ),
  latestStart: v.number(),
  latestEnd: v.optional(v.number()),
  batchSize: v.optional(v.number()),
  next: v.optional(v.array(v.string())),
});
export type MigrationStatus = Infer<typeof migrationStatus>;
