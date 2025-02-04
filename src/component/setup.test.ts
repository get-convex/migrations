/// <reference types="vite/client" />

import { test } from "vitest";

export const modules = {
  "./lib.test.js": () => import("./lib.test.js"),
  "./schema.js": () => import("./schema.js"),
  "./setup.test.js": () => import("./setup.test.js"),
};

test("setup", () => {});
