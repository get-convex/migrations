import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema for the local component.
 * This demonstrates a component with its own data that needs migrations.
 */
export default defineSchema({
  componentData: defineTable({
    name: v.string(),
    value: v.optional(v.string()),
  }),
});
