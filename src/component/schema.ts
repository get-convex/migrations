import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  migrations: defineTable({
    name: v.string(), // Defaults to the function name.
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    workerId: v.optional(v.id("_scheduled_functions")),
    error: v.optional(v.string()),
    // The number of documents processed so far.
    processed: v.number(),
    // 0-based position in the customRange list when a migration has multiple ranges.
    currentRangeIndex: v.optional(v.number()),
    latestStart: v.number(),
    latestEnd: v.optional(v.number()),
    // Adaptive batch-size state. Missing on rows written by older versions.
    currentBatchSize: v.optional(v.number()),
    lastSuccessfulBatchSize: v.optional(v.number()),
    lastFailedBatchSize: v.optional(v.number()),
    // TransactionMetrics key that most recently caused an adaptive shrink.
    limitingMetric: v.optional(v.string()),
  })
    .index("name", ["name"])
    .index("isDone", ["isDone"]),
});
