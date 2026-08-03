import type { TransactionMetrics } from "convex/server";
import { ConvexError, type Infer, type ObjectType, v } from "convex/values";

export const MIGRATION_BATCH_FAILURE = "MigrationBatchFailure";

export const migrationArgs = {
  fn: v.optional(v.string()),
  cursor: v.optional(v.union(v.string(), v.null())),
  batchSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
  next: v.optional(v.array(v.string())),
  reset: v.optional(v.boolean()),
  oneBatchOnly: v.optional(v.boolean()),
  // 0-based position in the customRange list when a migration has multiple ranges.
  currentRangeIndex: v.optional(v.number()),
};
export type MigrationArgs = ObjectType<typeof migrationArgs>;

export type MigrationResult = {
  // `null` starts the next batch from the beginning, used when advancing to
  // the next customRange entry.
  continueCursor: string | null;
  isDone: boolean;
  processed: number;
  // 0-based position in the customRange list when a migration has multiple ranges.
  currentRangeIndex?: number;
  batchSize?: number;
  metrics?: TransactionMetrics;
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
  limitingMetric: v.optional(v.string()),
  // 0-based position in the customRange list when a migration has multiple ranges.
  currentRangeIndex: v.number(),
  next: v.optional(v.array(v.string())),
});
export type MigrationStatus = Infer<typeof migrationStatus>;

export function getMigrationDryRunResult(
  error: unknown,
): MigrationResult | undefined {
  return getMigrationDryRunObjectField(error, "result") as
    | MigrationResult
    | undefined;
}

export function getMigrationDryRunStatus(
  error: unknown,
): MigrationStatus | undefined {
  return getMigrationDryRunObjectField(error, "status") as
    | MigrationStatus
    | undefined;
}

function getMigrationDryRunObjectField(
  error: unknown,
  field: "result" | "status",
): Record<string, unknown> | undefined {
  const data = error instanceof ConvexError ? error.data : undefined;
  if (!isRecord(data) || data.kind !== "DRY RUN") {
    return undefined;
  }
  const value = data[field];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
