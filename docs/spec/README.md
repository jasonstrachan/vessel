# Vessel Spec Workflow

Use this workflow when you want to write the goal as a local Markdown spec and have Codex carry it through implementation without Linear or Symphony.

## User Flow

1. Create a spec from `docs/spec/_template.md`.
2. Fill in the goal, scope, acceptance criteria, and validation.
3. Tell Codex: `execute docs/spec/<spec-file>.md`.
4. Codex implements the spec end to end.
5. Codex performs a code review of its own diff, fixes any issues it finds, and reruns relevant validation.
6. Codex stops before commit and gives you a concise handoff.
7. You manually test.
8. If it looks good, tell Codex to commit.

## Codex Execution Rules

- Treat the spec as the source of scope.
- Do not expand scope unless the spec explicitly allows it.
- Read the relevant code path before editing.
- Keep one active plan step at a time for non-trivial work.
- Update the spec checklist as work completes when the spec contains a checklist.
- Preserve unrelated dirty worktree changes.
- Keep implementation changes minimal and production-oriented.
- Add or update focused tests when behavior changes.
- Run targeted validation first, then broader checks when risk warrants it.
- Before handoff, review the final diff as a code reviewer:
  - bugs or regressions,
  - missed acceptance criteria,
  - unrelated changes,
  - missing or weak tests,
  - type/lint/build risk,
  - docs or behavior mismatch.
- Fix review findings before handing off.
- Do not commit unless the user explicitly asks.

## Handoff Requirements

The final handoff should include:

- What changed.
- Files changed.
- Validation run and results.
- Self-review findings and fixes.
- Anything not done or blocked.
- Manual test notes for the user.

## Commit Rule

Only commit after the user manually tests and explicitly asks for a commit.
