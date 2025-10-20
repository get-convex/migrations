import { describe, test, expect } from "vitest";
import { Migrations, DEFAULT_BATCH_SIZE, type UseApi } from "./index.js";
import type { api } from "../component/_generated/api.js";

describe("Migrations class", () => {
  test("can instantiate without error", () => {
    const dummyComponent = {} as UseApi<typeof api>;
    expect(() => new Migrations(dummyComponent)).not.toThrow();
  });
});

describe("DEFAULT_BATCH_SIZE", () => {
  test("should equal 100", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(100);
  });
});
