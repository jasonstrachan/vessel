# Security Policy

## Dependency Security Gates

- Production dependency audit is a release gate.
  - Run locally: `npm run audit:prod`
  - CI: deploy workflow blocks on unaccepted `audit:prod` failures.
  - Current accepted exception: Next vendors nested `postcss@8.4.31`, flagged by npm as `postcss <8.5.10`. Vessel publishes a static GitHub Pages export with no production Next server runtime. See `docs/refactor/plan-next-audit-remediation-2026-06-21.md`.

- Full dependency audit (including dev tooling) is tracked but non-blocking.
  - Run locally: `npm run audit:full`
  - Export reports:
    - `npm run audit:full:json`
    - `npm run audit:full:summary`

## Current Remediation Plan

- See `docs/security/dev-tooling-audit-remediation.md` for:
  - remaining dependency audit context,
  - migration constraints,
  - planned upgrade path.
