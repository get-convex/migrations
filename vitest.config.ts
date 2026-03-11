import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@convex-dev/migrations": resolve(__dirname, "src/client/index.ts"),
    },
  },
  test: {
    environment: "edge-runtime",
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
