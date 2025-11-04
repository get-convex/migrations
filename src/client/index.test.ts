import { describe, test, expect } from "vitest";
import { Migrations, DEFAULT_BATCH_SIZE } from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

describe("Migrations class", () => {
  test("can instantiate without error", () => {
    const dummyComponent = {} as ComponentApi;
    expect(() => new Migrations(dummyComponent)).not.toThrow();
  });
});

describe("DEFAULT_BATCH_SIZE", () => {
  test("should equal 100", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(100);
  });
});
