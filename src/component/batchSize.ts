import { type TransactionMetrics } from "convex/server";

const TARGET_USED_RATIO = 0.5;

// Successful batches use the returned TransactionMetrics object generically.
// Failed child mutations can abort before metrics are returned to the component
// runner, so these source-backed short messages are the fallback for
// classifying batch-size-reducible transaction-limit failures.
//
// Backend sources:
// - Read document, byte, and index-range limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/database/src/reads.rs#L537-L582
// - Write document and byte limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/database/src/writes.rs#L287-L301
// - Scheduled function count and total argument-size limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/model/src/scheduled_jobs/mod.rs#L176-L192
//
// Current Convex transaction-limit dimensions:
// - Backend limit warnings enumerate the same transaction dimensions as the
//   TransactionMetrics object returned from successful queries/mutations:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/isolate/src/environment/udf/mod.rs#L875-L944
// - convex-js documents the same TransactionMetrics fields:
//   https://github.com/get-convex/convex-js/blob/f57c39da88fd0c93bc2d7b7eeb924c1c58f91eea/src/server/meta.ts#L21-L29
// - `getTransactionMetrics()` is query/mutation metadata:
//   https://github.com/get-convex/convex-js/blob/f57c39da88fd0c93bc2d7b7eeb924c1c58f91eea/src/server/meta.ts#L124-L126
const TRANSACTION_LIMIT_ERROR_BY_METRIC = {
  documentsRead: "TooManyDocumentsRead",
  bytesRead: "TooManyBytesRead",
  databaseQueries: "TooManyReads",
  documentsWritten: "TooManyWrites",
  bytesWritten: "TooManyBytesWritten",
  functionsScheduled: "TooManyFunctionsScheduled",
  scheduledFunctionArgsBytes: "ScheduledFunctionsArgumentsTooLarge",
} as const;
type KnownTransactionMetricName =
  keyof typeof TRANSACTION_LIMIT_ERROR_BY_METRIC;
const knownTransactionMetricNames = Object.keys(
  TRANSACTION_LIMIT_ERROR_BY_METRIC,
) as KnownTransactionMetricName[];

// Permanent OCC failures are exposed with this short message after Convex has
// already retried internally. Reducing batch size can reduce the read/write set
// and therefore the chance of repeated conflicts.
//
// Sources:
// - OCC short message constant:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/errors/src/lib.rs#L998-L1002
// - Mutations retry OCC internally before surfacing a permanent failure:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/application/src/application_function_runner/mod.rs#L939-L974
// - Official docs describe repeated parallel mutation conflicts:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/npm-packages/docs/docs/error.mdx#L16-L48
const OCC_ERROR_SHORT_MESSAGE = "OptimisticConcurrencyControlFailure";

export function chooseBatchSizeAfterSuccess(args: {
  batchSize: number;
  metrics: TransactionMetrics;
  lastFailedBatchSize?: number;
}): { batchSize: number; limitingMetric?: string } {
  const tightestMetric = getTightestMetric(args.metrics);
  if (!tightestMetric) {
    return { batchSize: args.batchSize };
  }
  const { usedRatio } = tightestMetric;
  let nextBatchSize = args.batchSize;
  let limitingMetric: string | undefined;

  if (usedRatio === 0) {
    nextBatchSize = args.batchSize + 1;
  } else if (
    // Assume metric usage scales roughly with batch size. Grow only when one
    // more document is still projected to stay within the target.
    (usedRatio * (args.batchSize + 1)) / args.batchSize <=
    TARGET_USED_RATIO
  ) {
    nextBatchSize = Math.max(
      args.batchSize + 1,
      Math.floor((args.batchSize * TARGET_USED_RATIO) / usedRatio),
    );
  } else if (usedRatio > TARGET_USED_RATIO) {
    nextBatchSize = Math.max(
      1,
      Math.floor((args.batchSize * TARGET_USED_RATIO) / usedRatio),
    );
    limitingMetric = tightestMetric.name;
  }

  const failedUpperBound =
    args.lastFailedBatchSize !== undefined &&
    args.lastFailedBatchSize > args.batchSize
      ? args.lastFailedBatchSize
      : undefined;
  if (failedUpperBound !== undefined && nextBatchSize >= failedUpperBound) {
    nextBatchSize = Math.max(
      args.batchSize,
      Math.floor((args.batchSize + failedUpperBound) / 2),
    );
    if (nextBatchSize >= failedUpperBound) {
      nextBatchSize = failedUpperBound - 1;
    }
  }

  nextBatchSize = Math.max(1, Math.floor(nextBatchSize));
  return {
    batchSize: nextBatchSize,
    ...(nextBatchSize < args.batchSize && limitingMetric
      ? { limitingMetric }
      : {}),
  };
}

export function chooseBatchSizeAfterLimitFailure(args: {
  batchSize: number;
  lastSuccessfulBatchSize?: number;
}): number {
  if (args.batchSize <= 1) {
    return 1;
  }
  if (
    args.lastSuccessfulBatchSize !== undefined &&
    args.lastSuccessfulBatchSize > 0 &&
    args.lastSuccessfulBatchSize < args.batchSize
  ) {
    return Math.max(
      1,
      Math.floor((args.lastSuccessfulBatchSize + args.batchSize) / 2),
    );
  }
  return Math.max(1, Math.floor(args.batchSize / 2));
}

export function getTransactionLimitMetric(
  error: unknown,
): KnownTransactionMetricName | undefined {
  const text = error instanceof Error ? error.message : String(error);
  for (const metric of knownTransactionMetricNames) {
    const shortMessage = TRANSACTION_LIMIT_ERROR_BY_METRIC[metric];
    if (text.includes(shortMessage)) {
      return metric;
    }
  }
  return undefined;
}

export function looksLikeOccError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(OCC_ERROR_SHORT_MESSAGE);
}

function getTightestMetric(metrics: TransactionMetrics):
  | {
      name: string;
      usedRatio: number;
    }
  | undefined {
  let tightest:
    | {
        name: string;
        usedRatio: number;
      }
    | undefined;
  for (const name of Object.keys(metrics)) {
    const metric = metrics[name as keyof TransactionMetrics];
    const usedRatio = getUsedRatio(metric);
    if (usedRatio === undefined) {
      continue;
    }
    if (!tightest || usedRatio > tightest.usedRatio) {
      tightest = { name, usedRatio };
    }
  }
  return tightest;
}

function getUsedRatio(metric: {
  used: number;
  remaining: number;
}): number | undefined {
  const total = metric.used + metric.remaining;
  if (total <= 0) {
    return undefined;
  }
  return metric.used / total;
}
