# Dev Tooling Audit Remediation

Last updated: 2026-02-21

## Current Status

- Production dependency audit: clean (`npm run audit:prod` -> 0 vulnerabilities).
- Full dependency audit: remaining high-severity findings are in dev-tooling chains.

## Why Findings Remain

- The remaining advisories are concentrated in ESLint/Jest transitive trees.
- Clearing them requires coordinated major-version migrations (not patch-only updates).
- Prior attempts to force transitive overrides or partially migrate test tooling caused breakage.

## Known Constraints

- `next lint` on Next 15 currently aligns with the ESLint 9 ecosystem in this repo.
- Forcing `minimatch@10` globally breaks lint loading for current ESLint config paths.
- Migrating Jest transforms from `ts-jest` requires broader test harness adjustments.

## Safe Baseline (Now Enforced)

- Deploy CI blocks on production audit only (`npm run audit:prod`).
- Deploy CI runs full audit as non-blocking visibility (`npm run audit:full`).
- Deploy CI exports `audit-full.json` and `audit-full-summary.md` and uploads both as build artifacts for tracking.

## Recommended Next Migration Track

1. Migrate lint to ESLint CLI (away from `next lint`) with flat config parity.
2. Upgrade lint ecosystem as one unit and rebaseline rules/warnings.
3. Evaluate Jest stack migration in one branch (transform strategy + mock compatibility).
4. Re-run full audit and retire non-blocking full-audit status once high findings are cleared.
