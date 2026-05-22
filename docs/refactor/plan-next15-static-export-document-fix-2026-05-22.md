# Next 15 Static Export `_document` Build Fix Plan

## Goal

Restore `npm run build` as a reliable production/static-export gate for the App Router build without weakening TypeScript validation, adding root `app/` route shims, or moving the real app out of `src/app`.

Current failure:

```text
PageNotFoundError: Cannot find module for page: /_document
```

## Current Evidence

- `scripts/next-build.mjs` is the production build entry and spawns `next build` with `NEXT_DIST_DIR=.next-build`.
- `next.config.ts` currently enables `output: 'export'`, `basePath: '/vessel'`, and `assetPrefix: '/vessel/'` only when `process.env.NODE_ENV === 'production'`.
- Under the wrapper/Next 15 path, relying on `NODE_ENV` is not enough to prove the export config is active for every build phase.
- The real App Router source is in `src/app`; there should be no root `app/`, `pages/`, or `src/pages` compatibility tree added as a workaround.
- Adding root `app/*` wrappers and `_document` files produced brittle special-route behavior (`/_not-found`, `/404`, Pages manifest lookups) and should not be the target architecture.
- `npm run type-check`, `npm run lint`, and the CC Gradient targeted Jest set pass independently of the build failure.

## Architecture Decision

The build wrapper owns production intent. `next.config.ts` should read an explicit build/export signal from the wrapper, not infer production/export mode from route layout or Pages compatibility files.

Do:

- Keep canonical routes in `src/app`.
- Keep the build artifact directory configurable via `NEXT_DIST_DIR`.
- Make static export/basePath activation deterministic for `npm run build`, `build:clean`, `build:github`, and `preview:prod:build`.
- Keep Next build-time type validation enabled.
- Add build-config and wrapper regression checks so this does not drift back.

Do not:

- Add root `app/` wrappers.
- Add `pages/_document` or `src/pages/_document` just to satisfy the error.
- Set `typescript.ignoreBuildErrors`.
- Move the app directory.
- Change `basePath` or `assetPrefix` away from `/vessel`.

## Proposed Fix

### Slice 1 - Add Explicit Build Phase Env

Update the build wrappers to set an explicit repo-owned export signal:

- `scripts/next-build.mjs`: set `env.VESSEL_STATIC_EXPORT = '1'`.
- `scripts/preview-build.mjs`: set `env.VESSEL_STATIC_EXPORT = '1'` inside `runBuild`.

Rationale:

- The wrapper already owns `NEXT_DIST_DIR`; adding one explicit boolean makes config intent clear.
- This avoids coupling static export behavior to `NODE_ENV`, shell command shape, or Next internals.

### Slice 2 - Make `next.config.ts` Deterministic

Refactor production/export detection:

```ts
const isStaticExport =
  process.env.VESSEL_STATIC_EXPORT === '1' ||
  process.env.NEXT_DIST_DIR === '.next-build' ||
  process.env.NEXT_DIST_DIR === '.next-preview';
```

Use `isStaticExport` to apply:

- `output: 'export'`
- `trailingSlash: true`
- `basePath: '/vessel'`
- `assetPrefix: '/vessel/'`

Keep `distDir` as:

```ts
const distDir = process.env.NEXT_DIST_DIR || (isStaticExport ? '.next-build' : '.next');
```

Keep development behavior unchanged.

### Slice 3 - Remove Bad Workarounds

Verify the tree contains no workaround directories or files:

- no root `app/**`
- no root `pages/**`
- no `src/pages/**`

If any appear from prior experiments, delete the empty directories and any files before testing. This check must fail on empty compatibility directories too, because Next route discovery can be sensitive to directory layout even when no files remain.

### Slice 4 - Add Guardrail Test

Add lightweight config and wrapper tests, preferably without running Next:

- Create a small helper in `next.config.ts` or a new `scripts/build-mode.cjs` that resolves `isStaticExport`/`distDir` from an env object.
- Unit-test that:
  - `VESSEL_STATIC_EXPORT=1` enables export settings.
  - `NEXT_DIST_DIR=.next-build` enables export settings.
  - default dev env does not set `output: 'export'`.
  - `basePath` and `assetPrefix` remain `/vessel` and `/vessel/`.
- Add a wrapper regression check that reads `scripts/next-build.mjs` and `scripts/preview-build.mjs` and asserts both set `VESSEL_STATIC_EXPORT` before spawning `next build`.

If importing `next.config.ts` directly is awkward because it is TS, prefer a tiny plain JS helper used by both config and test.

## Validation

Run in this order:

1. Confirm no workaround route directories or files:

```sh
find app pages src/pages -maxdepth 3 -print 2>/dev/null
```

Expected: no output.

2. Run a clean production build:

```sh
npm run clean
npm run build
```

Expected:

- Next compiles.
- Type validation runs and passes.
- static export completes.
- the expected static export artifact is present for the build mode being tested.
- the generated 404 artifact contains the custom Vessel not-found text: `Page not found`.

3. Run preview production build:

```sh
npm run preview:prod:build
```

Expected:

- `.next-preview` is produced.
- no Pages manifest or `/_document` errors.

4. Run GitHub Pages build:

```sh
npm run build:github
```

Expected:

- the GitHub Pages static export directory is produced.
- `out/.nojekyll` exists.
- `out/404.html` contains the custom Vessel not-found text: `Page not found`.
- no Pages manifest or `/_document` errors.

5. Run quality gates:

```sh
npm run type-check
npm run lint
npm test -- --runTestsByPath <new config test path>
```

6. Run the existing focused CC Gradient tests to ensure the previous feature remains green:

```sh
npm test -- --runTestsByPath \
  src/hooks/canvas/handlers/shapes/__tests__/ccGradientDrawingGeometry.test.ts \
  src/hooks/canvas/handlers/shapes/__tests__/shapeDrawing.finalizeResolution.test.ts \
  src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts \
  src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts \
  src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx \
  src/stores/__tests__/toolsSlice.test.ts
```

## Review Checklist

- [x] No new route wrapper or Pages Router compatibility directories/files.
- [x] No `ignoreBuildErrors`.
- [x] `next.config.ts` still keeps `/vessel` as the production base path.
- [x] `scripts/next-build.mjs` and `scripts/preview-build.mjs` use the same export signal, with a regression test/assertion covering both wrappers.
- [x] Clean build and preview build both pass.
- [x] GitHub Pages build produces `out/.nojekyll` and `out/404.html`.
- [x] Custom 404 output is preserved.
- [x] Dirty Shape Fill draft files remain out of this fix unless the user explicitly scopes them in.

## Definition of Done

- `npm run build` passes from a clean tree.
- `npm run preview:prod:build` passes.
- `npm run build:github` passes and produces the expected `out/` artifacts.
- Type-check/lint/config tests pass.
- No root `app`, `pages`, or `src/pages` workaround directories/files are present.
- The final commit contains only build-config/wrapper/test changes needed for this fix.
