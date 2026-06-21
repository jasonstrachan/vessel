# Node 22 Runtime Migration Plan

## Goal

Move Vessel's release/runtime pin from Node 18 to Node 22 LTS. Do not upgrade Next in this patch.

## Why

- `.nvmrc` pins `18.20.8`.
- GitHub Pages CI uses `node-version: '18'`.
- README and `scripts/github-pages-build.mjs` still tell people to build with Node 18.
- Node 18 blocks a clean Next 16 path. Node 20 is not worth choosing as the new anchor; use Node 22 LTS.

## Patch

Edit only the runtime pin and instructions:

- `.nvmrc`: set to the chosen Node 22 LTS patch.
- `.github/workflows/deploy.yml`: set `actions/setup-node` to Node 22.
- `README.md`: replace the Node 18 build command with Node 22.
- `scripts/github-pages-build.mjs`: update the failure hint from Node 18 to Node 22.

Skip `package.json` `engines` for now. The build wrapper already enforces `.nvmrc`, and an engines field can create install noise without improving the release gate.

Skip dependency upgrades. Next/audit remediation is a separate patch.

## Verify

Run under Node 22:

```sh
mise exec node@22 -- npm run architecture:check
mise exec node@22 -- npm run type-check
mise exec node@22 -- npm run lint
mise exec node@22 -- npm test -- --runInBand
mise exec node@22 -- npm run verify:goblet2-inline
mise exec node@22 -- npm run build:github
mise exec node@22 -- npm run audit:prod
```

If `audit:prod` still fails on Next/PostCSS, record it and stop. Do not run `npm audit fix` in this patch.

## Commit

Stage only the touched files:

```sh
git add .nvmrc .github/workflows/deploy.yml README.md scripts/github-pages-build.mjs docs/refactor/plan-node-22-runtime-migration-2026-06-21.md
git commit -m "chore: upgrade node runtime to 22"
```

## Done

- Node 22 is the local and CI release runtime.
- Existing gates pass under Node 22.
- The production audit result is recorded.
- Next remains unchanged.

## Implementation Update - 2026-06-21

Implemented:

- `.nvmrc` now pins `22.22.0`.
- `.github/workflows/deploy.yml` now uses Node 22.
- README GitHub Pages build guidance now uses `mise exec node@22 -- npm run build:github`.
- `scripts/github-pages-build.mjs` now points failed local builds to Node 22.
- Next and package dependencies were not upgraded.

Verified under `mise exec node@22.22.0`:

- `node -v`: `v22.22.0`.
- `npm run architecture:check` passed.
- `npm run type-check` passed.
- `npm run type-check:workers` passed.
- `npm run type-check:tests` passed.
- `npm run lint` passed.
- `npm test -- --runInBand` passed: 404 suites, 2704 tests.
- `npm run verify:goblet2-inline` passed.
- `npm run build:github` passed and prepared `out`.

Audit:

- `npm run audit:prod` could not run inside the sandbox because DNS to `registry.npmjs.org` is blocked.
- Escalated audit was not run because sending the dependency graph to npm audit requires explicit external disclosure approval.
- Local dependency check still shows `next@15.5.12` depends on `postcss@8.4.31`, so Node 22 is complete as a runtime migration but not a Next/PostCSS audit remediation.
