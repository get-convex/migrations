# Convex Stateful Migrations Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fmigrations.svg)](https://badge.fury.io/js/@convex-dev%2Fmigrations)

**Note: Convex Components are currently in beta**

<!-- START: Include on https://convex.dev/components -->

Define migrations, like this one setting a default value for users:

```ts
// in convex/migrations.ts
export const setDefaultValue = migrations.define({
  table: "users",
  migrateOne: async (ctx, user) => {
    if (user.optionalField === undefined) {
      await ctx.db.patch(user._id, { optionalField: "default" });
    }
  },
});
```

See [below](#usage) and [this article](https://stack.convex.dev/migrating-data-with-mutations) for more information.

### Convex App

You'll need a Convex App to use the component. Run `npm create convex` or
follow any of the [Convex quickstarts](https://docs.convex.dev/home) to set one up.

## Installation

Install the component package:

```ts
npm install @convex-dev/migrations
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component by calling `use`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import migrations from "@convex-dev/migrations/convex.config";

const app = defineApp();
app.use(migrations);

export default app;
```

## Usage

Examples below are assuming the code is in `convex/migrations.ts`.
This is not required.

```ts
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
import { DataModel } from "./_generated/dataModel.js";

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runFromCLI();
```

The type parameter `DataModel` is optional. It provides type safety for migration definitions.
As always, database operations in migrations will abide by your schema definition at runtime.

### Define migrations:

```ts
export const setDefaultValue = migrations.define({
  table: "myTable",
  migrateOne: async (ctx, doc) => {
    if (doc.optionalField === undefined) {
      await ctx.db.patch(doc._id, { optionalField: "default" });
    }
  },
});

// Shorthand
export const clearField = migrations.define({
  table: "myTable",
  migrateOne: async (ctx, doc) => ({ optionalField: undefined }),
});

export const validateRequiredField = migrations.define({
  table: "myTable",
  // Specify a custom range to only include documents that need to change.
  // This is useful if you have a large dataset and only a small percentage of
  // documents need to be migrated.
  customRange: (q) =>
    q.withIndex("requiredField", (q) => q.eq("requiredField", "")),
  migrateOne: async (_ctx, doc) => {
    console.log("Needs fixup: " + doc._id);
    // Shorthand for patching
    return { requiredField: "<empty>" };
  },
});
```

### Run it from the CLI by first defining a `run` function:

```ts
// in convex/migrations.ts for example
export const run = migrations.runFromCLI();

// Or define a single runner:
export const runIt = migrations.runFromCLI(internal.migrations.setDefaultValue);
```

Then run it:

```sh
npx convex run migrations:run '{"fn": "migrations:setDefaultValue"}'

# or
npx convex run migrations:runIt
```

You can also run one or more from a server function:

```ts
await migrations.runOne(ctx, internal.example.setDefaultValue);
// Or run a series of migrations in order, e.g. if they depend on each other
// or as part of a post-deploy script:
const allMigrations = [
  internal.migrations.setDefaultValue,
  internal.migrations.validateRequiredField,
  internal.migrations.convertUnionField,
];
await migrations.runSerially(ctx, allMigrations);
```

### Override the internalMutation to apply custom DB behavior

You can customize which `internalMutation` implementation the underly migration should use.

This might be important if you use [custom functions](https://stack.convex.dev/custom-functions)
to intercept database writes to apply validation or trigger operations on changes.

Assuming you define your own `internalMutation` in `convex/functions.ts`:

```ts
import { internalMutation } from "./functions";
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";

export const migrations = new Migrations(components.migrations, {
  internalMutation,
});
```

See [this article](https://stack.convex.dev/migrating-data-with-mutations)
for more information on usage and advanced patterns.

<!-- END: Include on https://convex.dev/components -->
