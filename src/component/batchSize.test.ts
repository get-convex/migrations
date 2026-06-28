import type { TransactionMetrics } from "convex/server";
import { describe, expect, test } from "vitest";
import {
  chooseBatchSizeAfterLimitFailure,
  chooseBatchSizeAfterSuccess,
  getTransactionLimitMetric,
  looksLikeOccError,
} from "./batchSize.js";

describe("batch-size policy", () => {
  test("reduces failed batch size without exact failure metrics", () => {
    expect(chooseBatchSizeAfterLimitFailure({ batchSize: 50 })).toBe(25);
    expect(
      chooseBatchSizeAfterLimitFailure({
        batchSize: 50,
        lastSuccessfulBatchSize: 25,
      }),
    ).toBe(37);
    expect(chooseBatchSizeAfterLimitFailure({ batchSize: 1 })).toBe(1);
  });

  test("recognizes source-backed transaction-limit short messages", () => {
    expect(getTransactionLimitMetric(new Error("TooManyDocumentsRead"))).toBe(
      "documentsRead",
    );
    expect(
      getTransactionLimitMetric(
        new Error("Uncaught Error: TooManyDocumentsRead"),
      ),
    ).toBe("documentsRead");
    expect(
      getTransactionLimitMetric(new Error("Too many documents read.")),
    ).toBeUndefined();
  });

  test("recognizes source-backed OCC short message", () => {
    const error = new Error("OptimisticConcurrencyControlFailure");
    expect(looksLikeOccError(error)).toBe(true);
  });

  test("grows successful batch conservatively when usage is low", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
      }).batchSize,
    ).toBe(100);
  });

  test("keeps growth below known failed batch size", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
        lastFailedBatchSize: 90,
      }).batchSize,
    ).toBe(70);
  });

  test("ignores stale failed batch size at or below successful batch size", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.25),
        lastFailedBatchSize: 50,
      }).batchSize,
    ).toBe(100);
  });

  test("does not grow when one more document would exceed the target", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.491),
      }).batchSize,
    ).toBe(50);
  });

  test("grows when one more document stays within the target", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0.49),
      }).batchSize,
    ).toBe(51);
  });

  test("grows by one when transaction usage is zero", () => {
    expect(
      chooseBatchSizeAfterSuccess({
        batchSize: 50,
        metrics: metricsWithRatio(0),
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
    });

    expect(result.batchSize).toBe(27);
    expect(result.limitingMetric).toBe("vectorIndexReads");
  });
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
