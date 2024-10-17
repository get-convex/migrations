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

Migrations allow you to define functions that run on all documents in a table
(or a specified subset). They run in batches asynchronously.

The steps for doing a migration typically look like:

1. Modify your schema to allow old and new values. Typically this is adding a
   new optional field or marking a field as optional so it can be deleted.
   As part of this, update your code to handle both versions.
2. Define a migration to change the data to the new schema.
3. Push the migration and schema changes.
4. Run the migration(s) to completion.
5. Modify your schema and code to assume the new value.
   Pushing this change will only succeed if all the data matches the new schema.

See [below](#usage) and [this article](https://stack.convex.dev/migrating-data-with-mutations) for more information.

## Pre-requisite: Convex

You'll need an existing Convex project to use the component.
Convex is a hosted backend platform, including a database, serverless functions,
and a ton more you can learn about [here](https://docs.convex.dev/get-started).

Run `npm create convex` or follow any of the [quickstarts](https://docs.convex.dev/home) to set one up.

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
This is not a requirement.

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

// Shorthand syntax
export const clearField = migrations.define({
  table: "myTable",
  migrateOne: async (ctx, doc) => ({ optionalField: undefined }),
});

// Specify a custom range to only include documents that need to change.
// This is useful if you have a large dataset and only a small percentage of
// documents need to be migrated.
export const validateRequiredField = migrations.define({
  table: "myTable",
  customRange: (q) =>
    q.withIndex("requiredField", (q) => q.eq("requiredField", "")),
  migrateOne: async (_ctx, doc) => {
    console.log("Needs fixup: " + doc._id);
    // Shorthand for patching
    return { requiredField: "<empty>" };
  },
});
```

### Run it from the Dashboard or CLI by first defining a `run` function:

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
to intercept database writes to apply validation or
[trigger operations on changes](https://stack.convex.dev/triggers).

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
