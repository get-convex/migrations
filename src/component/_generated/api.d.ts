/* prettier-ignore-start */

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as public from "../public.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  public: typeof public;
}>;
export type Mounts = {
  public: {
    cancel: FunctionReference<
      "mutation",
      "public",
      { name: string },
      {
        batchSize?: number;
        cursor?: string | null;
        isDone: boolean;
        latestStart?: number;
        name: string;
        next?: Array<string>;
        processed: number;
        workerStatus?:
          | "pending"
          | "inProgress"
          | "success"
          | "failed"
          | "canceled";
      }
    >;
    cancelAll: FunctionReference<
      "mutation",
      "public",
      {},
      Array<{
        batchSize?: number;
        cursor?: string | null;
        isDone: boolean;
        latestStart?: number;
        name: string;
        next?: Array<string>;
        processed: number;
        workerStatus?:
          | "pending"
          | "inProgress"
          | "success"
          | "failed"
          | "canceled";
      }>
    >;
    getStatus: FunctionReference<
      "query",
      "public",
      { limit?: number; migrationNames?: Array<string> },
      Array<{
        batchSize?: number;
        cursor?: string | null;
        isDone: boolean;
        latestStart?: number;
        name: string;
        next?: Array<string>;
        processed: number;
        workerStatus?:
          | "pending"
          | "inProgress"
          | "success"
          | "failed"
          | "canceled";
      }>
    >;
    runMigration: FunctionReference<
      "mutation",
      "public",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun: boolean;
        fn: string;
        name: string;
        next?: Array<{ fn: string; name: string }>;
      },
      any
    >;
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

/* prettier-ignore-end */
