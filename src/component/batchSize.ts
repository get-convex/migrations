import { type TransactionMetrics } from "convex/server";

const TARGET_USED_RATIO = 0.5;
const DOCUMENTED_MUTATION_EXECUTION_LIMIT_MS = 1_000;
export const MUTATION_WALL_TIME_METRIC = "mutationWallTime";
export const MUTATION_USER_EXECUTION_TIME_METRIC = "mutationUserExecutionTime";
export const MUTATION_SYSTEM_OPERATIONS_TIME_METRIC =
  "mutationSystemOperationsTime";
export const OCC_LIMITING_METRIC = "optimisticConcurrencyControl";

// Successful batches use the returned TransactionMetrics object generically.
// Failed child mutations can abort before metrics are returned to the component
// runner, so these source-backed short and user-facing messages are the
// fallback for classifying batch-size-reducible transaction-limit failures.
//
// Backend sources:
// - Read document, byte, and index-range limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/database/src/reads.rs#L537-L582
// - Write document and byte limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/database/src/writes.rs#L287-L301
// - Scheduled function count and total argument-size limits:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/model/src/scheduled_jobs/mod.rs#L176-L192
// - System-operation timeout surfaces:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/isolate/src/termination.rs#L130-L151
// - User-execution timeout surface:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/isolate/src/termination.rs#L221-L223
//
// Current Convex transaction-limit dimensions:
// - Backend limit warnings enumerate the same transaction dimensions as the
//   TransactionMetrics object returned from successful queries/mutations:
//   https://github.com/get-convex/convex-backend/blob/e6b2110477ac23cc988320e299c7773211a27ab1/crates/isolate/src/environment/udf/mod.rs#L875-L944
// - convex-js documents the same TransactionMetrics fields:
//   https://github.com/get-convex/convex-js/blob/f57c39da88fd0c93bc2d7b7eeb924c1c58f91eea/src/server/meta.ts#L21-L29
// - `getTransactionMetrics()` is query/mutation metadata:
//   https://github.com/get-convex/convex-js/blob/f57c39da88fd0c93bc2d7b7eeb924c1c58f91eea/src/server/meta.ts#L124-L126
const TRANSACTION_LIMIT_ERRORS_BY_METRIC = {
  documentsRead: [
    "TooManyDocumentsRead",
    "Too many documents read in a single function execution",
  ],
  bytesRead: [
    "TooManyBytesRead",
    "Too many bytes read in a single function execution",
  ],
  databaseQueries: [
    "TooManyReads",
    "Too many reads in a single function execution",
  ],
  // TooManyWrites also identifies the deployment-wide write-throughput limiter.
  documentsWritten: ["Too many writes in a single function execution"],
  bytesWritten: [
    "TooManyBytesWritten",
    "Too many bytes written in a single function execution",
  ],
  functionsScheduled: [
    "TooManyFunctionsScheduled",
    "Too many functions scheduled by this mutation",
  ],
  scheduledFunctionArgsBytes: [
    "ScheduledFunctionsArgumentsTooLarge",
    "Too large total size of the arguments of scheduled functions from this mutation",
  ],
} as const;
type KnownTransactionMetricName =
  keyof typeof TRANSACTION_LIMIT_ERRORS_BY_METRIC;
const knownTransactionMetricNames = Object.keys(
  TRANSACTION_LIMIT_ERRORS_BY_METRIC,
) as KnownTransactionMetricName[];

// An action catches the user-facing Error.message from runMutation, not the
// backend-only short code. User-table and system-table OCCs use different
// messages, so recognize both; keep the short code for other JS boundaries.
const OCC_ERROR_SHORT_MESSAGE = "OptimisticConcurrencyControlFailure";
const OCC_ERROR_USER_MESSAGE_PARTS = [
  "Documents read from or written to",
  "changed while this mutation was being run and on every subsequent retry",
] as const;
const SYSTEM_OCC_ERROR_USER_MESSAGE =
  "Data read or written in this mutation changed while it was being run";
const EXECUTION_TIMEOUT_ERROR_PREFIX =
  "Function execution timed out (maximum duration:";
const SYSTEM_TIMEOUT_ERROR_SHORT_MESSAGE = "SystemTimeoutError";
const SYSTEM_TIMEOUT_ERROR_INTERNAL_PREFIX =
  "Hit maximum total syscall duration (maximum duration:";
const SYSTEM_TIMEOUT_ERROR_USER_MESSAGE =
  "Your request timed out performing too many system operations.";

export function chooseBatchSizeAfterSuccess(args: {
  batchSize: number;
  metrics?: TransactionMetrics;
  durationMs: number;
  lastFailedBatchSize?: number;
}): { batchSize: number; limitingMetric?: string } {
  const tightestMetric = getTightestMetric(args.metrics, args.durationMs);
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
}): number {
  return Math.max(1, Math.floor(args.batchSize / 2));
}

export function getTransactionLimitMetric(
  error: unknown,
): KnownTransactionMetricName | undefined {
  const text = error instanceof Error ? error.message : String(error);
  for (const metric of knownTransactionMetricNames) {
    if (
      TRANSACTION_LIMIT_ERRORS_BY_METRIC[metric].some((message) =>
        text.includes(message),
      )
    ) {
      return metric;
    }
  }
  return undefined;
}

export function looksLikeOccError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text.includes(OCC_ERROR_SHORT_MESSAGE) ||
    text.includes(SYSTEM_OCC_ERROR_USER_MESSAGE) ||
    OCC_ERROR_USER_MESSAGE_PARTS.every((part) => text.includes(part))
  );
}

export function looksLikeExecutionTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(EXECUTION_TIMEOUT_ERROR_PREFIX);
}

export function looksLikeSystemOperationsTimeout(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text.includes(SYSTEM_TIMEOUT_ERROR_SHORT_MESSAGE) ||
    text.includes(SYSTEM_TIMEOUT_ERROR_INTERNAL_PREFIX) ||
    text.includes(SYSTEM_TIMEOUT_ERROR_USER_MESSAGE)
  );
}

function getTightestMetric(
  metrics: TransactionMetrics | undefined,
  durationMs: number,
): {
  name: string;
  usedRatio: number;
} {
  let tightest:
    | {
        name: string;
        usedRatio: number;
      }
    | undefined;
  if (metrics) {
    for (const name of Object.keys(metrics)) {
      const metric = metrics[name as keyof TransactionMetrics];
      const used: unknown = metric.used;
      const remaining: unknown = metric.remaining;
      if (
        typeof used !== "number" ||
        !Number.isFinite(used) ||
        typeof remaining !== "number" ||
        !Number.isFinite(remaining) ||
        !Number.isFinite(used + remaining)
      ) {
        continue;
      }
      const usedRatio = getUsedRatio({ used, remaining });
      if (usedRatio === undefined) {
        continue;
      }
      if (!tightest || usedRatio > tightest.usedRatio) {
        tightest = { name, usedRatio };
      }
    }
  }
  // This is observed wall time around the nested mutation, not Convex user
  // execution time. Queueing and syscalls intentionally make the controller
  // more conservative under load. The outer action handles failures that occur
  // later, during the enclosing transaction's commit or timeout.
  const wallTimeRatio =
    Math.max(0, durationMs) / DOCUMENTED_MUTATION_EXECUTION_LIMIT_MS;
  return !tightest || wallTimeRatio > tightest.usedRatio
    ? { name: MUTATION_WALL_TIME_METRIC, usedRatio: wallTimeRatio }
    : tightest;
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
