import { resolve } from "path";
import { defineConfig } from "vitest/config";

// This sucks but import.meta.url error in TypeScript without a way to fix it
// and __dirname is not available in ESM. This relies on where the tests are run from.
const root = resolve(process.cwd());

export default defineConfig({
  resolve: {
    alias: {
      // More specific alias first so "@convex-dev/migrations/test" matches correctly
      "@convex-dev/migrations/test": resolve(root, "src/test.ts"),
      "@convex-dev/migrations": resolve(root, "src/client/index.ts"),
    },
  },
  test: {
    environment: "edge-runtime",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
