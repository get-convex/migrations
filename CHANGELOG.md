# Changelog

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
