import { describe, test, expect } from "vitest";
import {
  Migrations,
  DEFAULT_BATCH_SIZE,
  isNewFormatCursor,
  isPaginatorCursor,
} from "./index.js";
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

describe("isPaginatorCursor", () => {
  test("null or undefined cursor returns false (built-in pagination)", () => {
    expect(isPaginatorCursor(null)).toBe(false);
    expect(isPaginatorCursor(undefined)).toBe(false);
  });

  test("legacy paginator cursor (JSON array) returns true", () => {
    // Example cursors from convex-helpers paginator
    expect(isPaginatorCursor('["value", 1234567890, "documentId"]')).toBe(true);
    expect(isPaginatorCursor('[null, "undefined", 1234567890.5, "id"]')).toBe(
      true,
    );
    expect(
      isPaginatorCursor('[1719412234000,"k97d5ycbj3vgwcprmmxvmrm2dh7a5qhv"]'),
    ).toBe(true);
  });

  test("built-in cursor (opaque string) returns false", () => {
    // Example cursors from built-in .paginate() - opaque encrypted strings
    expect(isPaginatorCursor("u1oU8i23WMATVwA2CneZ")).toBe(false);
    expect(isPaginatorCursor("encryptedOpaqueString123")).toBe(false);
    expect(isPaginatorCursor("abc")).toBe(false);
  });

  test("convex-test built-in cursor (JSON array of strings) returns false", () => {
    expect(
      isPaginatorCursor(
        '["1792024584238.001","\\"0000000000000000000010001myTable\\""]',
      ),
    ).toBe(false);
    expect(isPaginatorCursor("_end_cursor")).toBe(false);
  });

  test("edge cases", () => {
    expect(isPaginatorCursor("")).toBe(false);
    expect(isPaginatorCursor("{}")).toBe(false); // object, not array
    expect(isPaginatorCursor("null")).toBe(false); // string "null"
    expect(isPaginatorCursor("[]")).toBe(false);
    expect(isPaginatorCursor("[not json")).toBe(false);
  });
});

describe("isNewFormatCursor (deprecated)", () => {
  test("null or paginator cursor returns true", () => {
    expect(isNewFormatCursor(null)).toBe(true);
    expect(isNewFormatCursor("[]")).toBe(true);
  });

  test("built-in cursor returns false", () => {
    expect(isNewFormatCursor("u1oU8i23WMATVwA2CneZ")).toBe(false);
  });
});
