# Security Policy

## Dependency Security Gates

- Production dependency vulnerabilities are a hard gate.
  - Run locally: `npm run audit:prod`
  - CI: deploy workflow blocks on `audit:prod` failures.

- Full dependency audit (including dev tooling) is tracked but non-blocking.
  - Run locally: `npm run audit:full`
  - Export reports:
    - `npm run audit:full:json`
    - `npm run audit:full:summary`

## Current Remediation Plan

- See `docs/security/dev-tooling-audit-remediation.md` for:
  - remaining dev-tooling vulnerability context,
  - migration constraints,
  - planned upgrade path.

