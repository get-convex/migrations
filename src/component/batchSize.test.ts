import type { TransactionMetrics } from "convex/server";
import { describe, expect, test } from "vitest";
import {
  chooseBatchSizeAfterLimitFailure,
  chooseBatchSizeAfterSuccess,
  getTransactionLimitMetric,
  looksLikeExecutionTimeout,
  looksLikeOccError,
  looksLikeSystemOperationsTimeout,
} from "./batchSize.js";

describe("batch-size policy", () => {
  test("reduces failed batch size without exact failure metrics", () => {
    expect(chooseBatchSizeAfterLimitFailure({ batchSize: 50 })).toBe(25);
    expect(chooseBatchSizeAfterLimitFailure({ batchSize: 1 })).toBe(1);
  });

  test("recognizes source-backed transaction-limit messages", () => {
    expect(getTransactionLimitMetric(new Error("TooManyDocumentsRead"))).toBe(
      "documentsRead",
    );
    expect(
      getTransactionLimitMetric(
        new Error("Uncaught Error: TooManyDocumentsRead"),
      ),
    ).toBe("documentsRead");
    expect(
      getTransactionLimitMetric(
        new Error(
          "Too many documents read in a single function execution (limit: 16384).",
        ),
      ),
    ).toBe("documentsRead");
  });

  test("recognizes outer mutation OCC and time-limit messages", () => {
    expect(
      looksLikeOccError(new Error("OptimisticConcurrencyControlFailure")),
    ).toBe(true);
    expect(
      looksLikeOccError(
        new Error(
          "Data read or written in this mutation changed while it was being run. " +
            "Consider reducing the amount of data read by using indexed queries.",
        ),
      ),
    ).toBe(true);
    expect(
      looksLikeOccError(
        new Error(
          "Documents read from or written to table users changed while this " +
            "mutation was being run and on every subsequent retry.",
        ),
      ),
    ).toBe(true);
    expect(
      looksLikeExecutionTimeout(
        new Error("Function execution timed out (maximum duration: 1s)"),
      ),
    ).toBe(true);
    expect(
      looksLikeExecutionTimeout(
        new Error(
          "Uncaught Error: Function execution timed out (maximum duration: 750ms)",
        ),
      ),
    ).toBe(true);
    expect(looksLikeExecutionTimeout(new Error("Request timed out"))).toBe(
      false,
    );
    expect(looksLikeExecutionTimeout(new Error("SystemTimeoutError"))).toBe(
      false,
    );
    expect(
      looksLikeSystemOperationsTimeout(new Error("SystemTimeoutError")),
    ).toBe(true);
    expect(
      looksLikeSystemOperationsTimeout(
        new Error("Hit maximum total syscall duration (maximum duration: 15s)"),
      ),
    ).toBe(true);
    expect(
      looksLikeSystemOperationsTimeout(
        new Error(
          "Your request timed out performing too many system operations.",
        ),
      ),
    ).toBe(true);
    expect(
      looksLikeSystemOperationsTimeout(new Error("Request timed out")),
    ).toBe(false);
  });

  test("grows successful batch conservatively when usage is low", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
        durationMs: 100,
      }).batchSize,
    ).toBe(100);
  });

  test("skips non-finite transaction metrics", () => {
    const metrics = metricsWithRatio(0.25);
    metrics.bytesRead = { used: Number.NaN, remaining: 1 };

    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics,
        durationMs: 100,
      }).batchSize,
    ).toBe(100);
  });

  test("keeps growth below known failed batch size", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
        durationMs: 100,
        lastFailedBatchSize: 90,
      }).batchSize,
    ).toBe(70);
  });

  test("ignores stale failed batch size at or below successful batch size", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
        durationMs: 100,
        lastFailedBatchSize: 50,
      }).batchSize,
    ).toBe(100);
  });

  test("does not grow when one more document would exceed the target", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.491),
        durationMs: 100,
      }).batchSize,
    ).toBe(50);
  });

  test("grows when one more document stays within the target", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.49),
        durationMs: 100,
      }).batchSize,
    ).toBe(51);
  });

  test("grows by one when transaction usage is zero", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0),
        durationMs: 0,
      }).batchSize,
    ).toBe(51);
  });

  test("shrinks successful batch on the tightest metric returned at runtime", () => {
    const metrics = metricsWithRatio(0.25);
    Object.assign(metrics, {
      vectorIndexReads: {
        used: 0.9,
        remaining: 0.1,
      },
    });

    const result = chooseBatchSizeAfterSuccess({
      batchSize: 50,
      metrics,
      durationMs: 100,
    });

    expect(result.batchSize).toBe(27);
    expect(result.limitingMetric).toBe("vectorIndexReads");
  });

  test.each([
    { batchSize: 50, durationMs: 900, expected: 27 },
    { batchSize: 100, durationMs: 3_000, expected: 16 },
  ])(
    "shrinks batch size $batchSize after $durationMs ms observed wall time",
    ({ batchSize, durationMs, expected }) => {
      const result = chooseBatchSizeAfterSuccess({
        batchSize,
        metrics: metricsWithRatio(0.25),
        durationMs,
      });

      expect(result.batchSize).toBe(expected);
      expect(result.limitingMetric).toBe("mutationWallTime");
    },
  );
});

function metricsWithRatio(ratio: number): TransactionMetrics {
  const metric = {
    used: ratio,
    remaining: 1 - ratio,
  };
  return {
    bytesRead: metric,
    bytesWritten: metric,
    databaseQueries: metric,
    documentsRead: metric,
    documentsWritten: metric,
    functionsScheduled: metric,
    scheduledFunctionArgsBytes: metric,
  };
}
