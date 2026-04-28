# Spec: <title>

## Goal

<One sentence describing the outcome.>

## Scope

- In scope:
  - <files, features, or behavior allowed>
- Out of scope:
  - <files, features, or behavior excluded>

## Current Problem

<What is broken, missing, or being changed. Include concrete repro steps or screenshots if relevant.>

## Acceptance Criteria

- [ ] <observable behavior that must be true>
- [ ] <another required outcome>
- [ ] No unrelated files are changed.

## Validation

- [ ] <targeted test or manual check>
- [ ] `npm run type-check` if TypeScript/app logic changes.
- [ ] `npm run lint` if source files change.
- [ ] `npm test` if behavior or shared logic changes.

## Implementation Notes

<Optional constraints, preferred files, prior attempts, risks, or useful context.>

## Handoff

Codex must stop before commit and report:

- changed files,
- validation results,
- self-review findings and fixes,
- any unresolved risks,
- manual test steps.
