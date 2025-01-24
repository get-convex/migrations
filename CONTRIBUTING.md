# Developing guide

## Running locally

Setup:

```sh
npm i
cd example
npm i
npm run dev:convex -- --once
```

Run the frontend and backend:

```sh
npm run dev
```

## Testing

```sh
rm -rf dist/ && npm run build
npm run typecheck
cd example
npm run lint
cd ..
```

## Deploying

### Building a one-off package

```sh
rm -rf dist/ && npm run build
npm pack
```

### Deploying a new version

```sh
# this will change the version and commit it (if you run it in the root directory)
npm version patch
npm publish --dry-run
# sanity check files being included
npm publish
git push --tags
git push
```

#### Alpha release

The same as above, but it requires extra flags so the release is only installed with `@alpha`:

```sh
npm version prerelease --preid alpha
npm publish --tag alpha
git push --tags
```
