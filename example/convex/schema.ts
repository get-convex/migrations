import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";

export default defineSchema({
  // Any tables used by the example app go here.
  myTable: defineTable({
    requiredField: v.string(),
    optionalField: v.optional(v.string()),
    unionField: v.union(v.string(), v.number()),
  }).index("by_requiredField", ["requiredField"]),
});
