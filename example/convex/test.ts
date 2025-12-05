/**
 * Manual test for forceContinue feature
 * Run with: npx convex run test
 *
 * This tests the realistic production behavior of forceContinue,
 * which can't be properly tested with convex-test due to _end_cursor artifacts.
 */
import { internalAction } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { migrations } from "./example.js";
import { runToCompletion, type MigrationStatus } from "@convex-dev/migrations";

export default internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("🧪 Testing forceContinue feature...\n");

    // Step 1: Clean up any existing test data
    console.log("Step 1: Cleaning up existing data...");
    const existingDocs = await ctx.runQuery(internal.example.getStatus);
    console.log(`  Found ${existingDocs.length} existing migrations\n`);

    // Step 2: Seed initial data
    console.log("Step 2: Seeding initial 5 documents...");
    await ctx.runMutation(internal.example.seed, { count: 5 });
    console.log("  ✓ Seeded 5 documents\n");

    // Step 3: Run migration to completion
    console.log("Step 3: Running migration to completion...");
    await ctx.runMutation(internal.example.runIt, {});

    // Poll until done
    let status = await pollUntilDone(ctx, "example:setDefaultValue");
    console.log(
      `  ✓ Migration completed: processed=${status.processed}, cursor=${status.cursor}\n`,
    );

    const processedBefore = status.processed;

    // Step 4: Add more documents after completion
    console.log("Step 4: Adding 3 more documents after completion...");
    await ctx.runMutation(internal.example.seed, { count: 3 });
    console.log("  ✓ Seeded 3 more documents\n");

    // Step 5: Try running WITHOUT forceContinue (should no-op)
    console.log("Step 5: Running without forceContinue (should no-op)...");
    await ctx.runMutation(internal.example.runIt, {});
    status = await pollUntilDone(ctx, "example:setDefaultValue");
    console.log(
      `  Status: isDone=${status.isDone}, processed=${status.processed}`,
    );

    if (status.processed === processedBefore) {
      console.log("  ✓ Correctly did not process new documents\n");
    } else {
      console.log(
        "  ⚠️  Unexpectedly processed documents without forceContinue\n",
      );
    }

    // Step 6: Run with forceContinue
    console.log("Step 6: Running with forceContinue=true...");
    await runToCompletion(
      ctx,
      components.migrations,
      internal.example.setDefaultValue,
      {
        forceContinue: true,
        batchSize: 2,
      },
    );

    // Poll until done again
    status = await pollUntilDone(ctx, "example:setDefaultValue");
    console.log(
      `  ✓ Migration completed: processed=${status.processed}, cursor=${status.cursor}\n`,
    );

    const processedAfter = status.processed;

    // Step 7: Verify processed count increased
    console.log("Step 7: Verifying results...");
    console.log(`  Processed before: ${processedBefore}`);
    console.log(`  Processed after:  ${processedAfter}`);

    if (processedAfter > processedBefore) {
      console.log(
        `  ✅ SUCCESS: Processed count increased by ${processedAfter - processedBefore}`,
      );
      console.log("\n✅ forceContinue works correctly in production!");
      return { success: true, processedBefore, processedAfter };
    } else {
      console.log(`  ❌ FAILURE: Processed count did not increase`);
      console.log(`  This means forceContinue did not pick up new documents.`);
      console.log(
        `  To process new documents, you need: forceContinue=true + cursor=null`,
      );
      return { success: false, processedBefore, processedAfter };
    }
  },
});

async function pollUntilDone(
  ctx: any,
  migrationName: string,
  maxAttempts = 30,
): Promise<MigrationStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    const [status] = await migrations.getStatus(ctx, {
      migrations: [migrationName],
    });

    if (status.state === "failed") {
      throw new Error(`Migration failed: ${status.error}`);
    }

    if (status.isDone && status.state !== "inProgress") {
      return status;
    }

    console.log(
      `  Polling... state=${status.state}, processed=${status.processed}`,
    );
    await sleep(100);
  }

  throw new Error("Migration timed out");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
