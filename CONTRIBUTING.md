# Developing guide

## Running locally

```sh
npm i
npm run dev
```

## Testing

```sh
npm run clean
npm run build
npm run typecheck
npm run lint
npm run test
```

### Testing forceContinue behavior

To manually test the `forceContinue` feature in a production-like environment:

```sh
npx convex run test
```

This will:

1. Seed initial data and run a migration
2. Add more documents after completion
3. Test that migration no-ops without `forceContinue`
4. Run with `forceContinue: true` to process new documents
5. Verify that `processed` count increased

Note: Unit tests use `convex-test` which has cursor behavior artifacts. This
manual test provides more realistic validation.

## Deploying

### Building a one-off package

```sh
npm run clean
npm ci
npm pack
```

### Deploying a new version

```sh
npm run release
```

or for alpha release:

```sh
npm run alpha
```
