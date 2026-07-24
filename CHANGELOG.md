# Changelog

## Unreleased

- Before starting a migration, `runOne`, `runSerially`, and the `runner`
  functions now check the migration status from a stale snapshot (via
  `ctx.runQuery(..., { useStaleSnapshot: true })`) and no-op if it's already in
  progress. This avoids OCC conflicts with the batches an in-progress migration
  is actively writing, which was likely when re-running a post-deploy script.
  For a series, it checks *all* the migrations at once (not just the first),
  since a mid-series migration that's in progress causes the same conflict.
  Requires `convex@^1.42.0`.

## 0.3.5

- Supports running migrations within components by using the convex-helpers
  paginator instead of built-in .paginate
- Stores a `null` cursor when done with a migration.
- Shows the status for the most recent 100 migrations by default, up from 10.

## 0.3.4

- Allows calling migration functions directly to start them, instead of the
  migrations.runner workaround.

## 0.3.3

- Adds a `reset: true` argument to restart all specified migrations

## 0.3.2

- Fixes the cancel functionality for ongoing migrations

## 0.3.1

- Adds `runToCompletion` which can run a migration synchronously from an action,
  stopping if the action times out or fails.

## 0.3.0

- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API
