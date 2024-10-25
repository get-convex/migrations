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
        error?: string;
        isDone: boolean;
        latestEnd?: number;
        latestStart: number;
        name: string;
        next?: Array<string>;
        processed: number;
        state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
      }
    >;
    cancelAll: FunctionReference<
      "mutation",
      "public",
      { sinceTs?: number },
      Array<{
        batchSize?: number;
        cursor?: string | null;
        error?: string;
        isDone: boolean;
        latestEnd?: number;
        latestStart: number;
        name: string;
        next?: Array<string>;
        processed: number;
        state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
      }>
    >;
    clearAll: FunctionReference<"mutation", "public", { before?: number }, any>;
    getStatus: FunctionReference<
      "query",
      "public",
      { limit?: number; names?: Array<string> },
      Array<{
        batchSize?: number;
        cursor?: string | null;
        error?: string;
        isDone: boolean;
        latestEnd?: number;
        latestStart: number;
        name: string;
        next?: Array<string>;
        processed: number;
        state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
      }>
    >;
    migrate: FunctionReference<
      "mutation",
      "public",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun: boolean;
        fnHandle: string;
        name: string;
        next?: Array<{ fnHandle: string; name: string }>;
      },
      {
        batchSize?: number;
        cursor?: string | null;
        error?: string;
        isDone: boolean;
        latestEnd?: number;
        latestStart: number;
        name: string;
        next?: Array<string>;
        processed: number;
        state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
      }
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

export declare const components: {};

/* prettier-ignore-end */
