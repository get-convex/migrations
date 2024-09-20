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

import type * as example from "../example.js";

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
  example: typeof example;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    public: {
      cancel: FunctionReference<
        "mutation",
        "internal",
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
        "internal",
        { sinceTs?: number },
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
        "internal",
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
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fn: string;
          name: string;
          next?: Array<{ fn: string; name: string }>;
        },
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
    };
  };
};

/* prettier-ignore-end */
