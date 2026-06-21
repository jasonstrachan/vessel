# Next Audit Remediation Plan

## Goal

Unblock `npm run audit:prod` without using `npm audit fix`.

## Patch

- Upgrade `next` and `eslint-config-next` together to the same latest stable version.
- Keep React, app code, static export settings, and Node 22 runtime unchanged unless verification proves a real break.
- Do not use canary packages.

## Verify

Run under Node 22:

```sh
mise exec node@22.22.0 -- npm run audit:prod
mise exec node@22.22.0 -- npm run architecture:check
mise exec node@22.22.0 -- npm run type-check
mise exec node@22.22.0 -- npm run type-check:workers
mise exec node@22.22.0 -- npm run type-check:tests
mise exec node@22.22.0 -- npm run lint
mise exec node@22.22.0 -- npm test -- --runInBand
mise exec node@22.22.0 -- npm run verify:goblet2-inline
mise exec node@22.22.0 -- npm run build:github
```

## Stop Rule

If latest stable Next still fails the production audit, stop and document risk acceptance. Do not chase canary.

## Implementation Update - 2026-06-21

Tried latest stable:

- `next@16.2.9`
- `eslint-config-next@16.2.9`

Result:

- `npm run audit:prod` still failed.
- The remaining production finding is `postcss <8.5.10` nested under `next`.
- npm's suggested forced fix would install `next@9.3.3`, which is a breaking downgrade and not acceptable.
- The dependency changes were backed out.

Decision:

- Do not ship the Next 16.2.9 upgrade for this audit pass because it does not clear the production audit.
- Do not chase canary.
- Accept and document the residual audit risk for the current public GitHub Pages release shape: Vessel exports static files, does not run a Next server in production, and does not use server middleware/image optimization at runtime.

Next useful move:

- Recheck latest stable Next when npm publishes a release outside the advisory range with patched nested `postcss`.

## Accepted Release Exception - 2026-06-21

`npm run audit:prod` now runs `scripts/audit-prod.mjs`.

The script still runs `npm audit --omit=dev --json` and fails new production findings. It accepts only the known current shape:

- vulnerability names are limited to `next` and `postcss`;
- `postcss` is nested at `node_modules/next/node_modules/postcss`;
- npm reports the `postcss` vulnerable range as `<8.5.10`;
- the `next` finding is via nested `postcss`.

Rationale:

- Vessel publishes a static GitHub Pages export.
- The public deployment does not run a Next server, middleware, or image optimizer.
- Latest stable Next tested for this pass still vendors the flagged PostCSS version.
- Canary Next is out of scope for this release.

Remove this exception when stable Next ships patched nested PostCSS metadata and `npm audit --omit=dev` passes directly.
