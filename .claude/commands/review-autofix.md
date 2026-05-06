# review-autofix

Review the current uncommitted diff, fix every actionable issue found, verify the fixes, and repeat until the review is clean.

Scope argument, if provided: `$ARGUMENTS`

## Workflow

1. Inspect the current uncommitted diff and relevant surrounding code.
2. Review in code-review stance first: prioritize bugs, regressions, data loss, broken contracts, unsafe edge cases, and missing tests.
3. Fix every actionable issue found, keeping changes scoped to the current work.
4. Run the smallest meaningful verification first; broaden to type-check, lint, build, or tests when risk warrants it.
5. Repeat review -> fix -> verify until there are no remaining actionable findings.
6. Report final changes, verification run, and any residual risk or non-actionable observations.

## Constraints

- Do not stop after the first review/fix pass.
- Do not revert unrelated user changes.
- Do not stack speculative patches. If a fix is proven wrong and does not improve clarity or correctness, back it out before trying another approach.
- Keep the patch focused; avoid broad refactors unless required to fix a reviewed issue.
- Preserve valid edge cases while rejecting genuinely invalid data.
- If verification cannot be run, state exactly why and what remains unverified.
