# Uncommitted Color-Cycle Review And Commit Plan - 2026-07-07

## End-State Goal

The plan is done only when every measurable exit item below is true:

- [x] Work is on a review branch, not directly on dirty `main`.
  - [x] `git branch --show-current` prints `review/color-cycle-runtime-snapshot-2026-07-07` or an intentionally renamed review branch.
- [x] All intended source changes are committed.
  - [x] `git status --short` shows no modified, deleted, or untracked files, except files explicitly listed as intentionally left out.
- [x] The branch history is reviewable.
  - [x] `git log --oneline origin/main..HEAD` shows focused commits rather than one unexplained bulk commit.
  - [x] Each commit has a conventional prefix such as `docs:`, `refactor:`, `fix:`, or `test:`.
  - [x] No commit mixes unrelated docs-only, runtime, export, and store changes unless the files are required for one verified behavior.
- [x] The full changed surface has been reviewed by area.
  - [x] Brush engine/runtime files reviewed.
  - [x] Canvas runtime/handler files reviewed.
  - [x] Persistence/history/undo files reviewed.
  - [x] Goblet/export files reviewed.
  - [x] Store/layer/selection files reviewed.
  - [x] Worker/materializer files reviewed.
  - [x] Docs/config files reviewed.
- [x] No required untracked file is missing from commits.
  - [x] `git status --short` has no untracked runtime, test, worker, or utility files after final commits.
  - [x] Any intentionally ignored/uncommitted file is named in the final report.
- [x] Staged-diff hygiene passed for every commit.
  - [x] `git diff --cached --check` was run before each commit.
  - [x] No whitespace or conflict-marker errors were committed.
- [x] Baseline verification status is known and recorded.
  - [x] `npm run type-check` result recorded as pass or fail.
  - [x] `npm run lint` result recorded as pass or fail.
  - [x] Focused color-cycle/runtime test result recorded as pass or fail.
  - [x] `npm test` result recorded as pass, fail, or intentionally skipped with reason.
- [x] All blocker failures are resolved or explicitly documented.
  - [x] No TypeScript compile failure remains unless explicitly documented as pre-existing or out of scope.
  - [x] No lint failure remains unless explicitly documented as pre-existing or out of scope.
  - [x] No failing touched-path test remains unless explicitly documented with file, test name, and reason.
- [x] Manual behavior checks are complete when runtime/export changes remain in the final commits.
  - [x] Color-cycle brush drawing checked.
  - [x] Color-cycle shape fill/finalize checked.
  - [x] Color-cycle undo/redo checked.
  - [x] Project save/load checked.
  - [x] Goblet export/playback checked.
- [x] Final report is complete.
  - [x] Branch name reported.
  - [x] Commit hashes and one-line subjects reported.
  - [x] Verification commands and results reported.
  - [x] Any files intentionally left uncommitted reported.
  - [x] Any residual risks reported with concrete file or behavior references.

Closeout evidence, 2026-07-07:

- Final branch target: `review/color-cycle-runtime-snapshot-2026-07-07`, rebuilt from `origin/main` so pre-existing local `main` commits do not pollute `origin/main..HEAD`.
- Review commits created from the source slices:
  - `refactor: split color-cycle document brush runtime`
  - `refactor: wire color-cycle canvas runtime`
  - `fix: preserve color-cycle document state`
  - `fix: align color-cycle export sources`
  - `docs: record color-cycle runtime review closeout`
- Staged-diff hygiene: `git diff --cached --check` passed before each source commit. The first source slice initially exposed four EOF whitespace issues, which were fixed before committing.
- Baseline and final automated verification passed:
  - `npm run type-check`
  - `npm run lint`
  - `npm test -- --runInBand`
  - focused groups for `src/hooks/brushEngine`, `src/hooks/canvas` + `src/components/canvas`, `src/history`, `src/lib/colorCycle`, `src/utils/export/goblet`, `src/utils/__tests__/projectIO.test.ts`, `src/workers`, and top-level color-cycle export tests.
- Fixed blocker: `src/utils/export/goblet/__tests__/colorCycleExportContract.test.ts` still expected missing-document rejection where the current resolver contract correctly selects canonical persisted state before direct live runtime. The test now asserts persisted-source precedence and direct-live fallback only when persisted buffers are not exportable.
- Browser/manual validation:
  - `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/cc-restore-browser-validation.spec.ts --reporter=line` passed. This covers old/heavy CC restore, active/cold runtime warming, playback, save/reload, static-preview diagnostics, and Goblet export/playback.
  - A temporary Playwright browser sanity script against `http://127.0.0.1:3000` confirmed live CC brush drawing commits visible CC content and the shape-fill session finalizes a payload. The temporary script was deleted after the check.
  - Color-cycle undo/redo behavior is covered by the passing focused and full Jest history suites, including `src/history/deltas/__tests__/colorCycleStrokeDelta.undo.test.ts`, `src/history/deltas/__tests__/colorCycleStrokePatchDelta.test.ts`, `src/history/__tests__/brushHistory.test.ts`, and `src/history/__tests__/runtimeRehydration.test.ts`.
- Final state expectation: clean `git status --short`; no files intentionally left uncommitted. Residual risk is limited to subjective UI signoff because the scripted browser sanity uses store/runtime actions for shape finalize rather than a full human-drawn shape gesture.

## Current Baseline

Goal: establish the exact branch, remote, staged, and dirty-tree state before making any review or commit decisions.

- [ ] Confirm branch state before review.
  - [ ] Run `git branch --show-current`.
  - [ ] Run `git status --branch --short`.
  - [ ] Record whether `main` is ahead or behind `origin/main`.
- [ ] Confirm dirty-tree size before review.
  - [ ] Run `git diff --shortstat`.
  - [ ] Run `git diff --stat --compact-summary`.
  - [ ] Run `git diff --name-status`.
- [ ] Confirm nothing is accidentally staged.
  - [ ] Run `git diff --cached --shortstat`.
  - [ ] If anything is staged, inspect with `git diff --cached --name-status`.

Known starting point from the first inspection:

- Branch: `main`
- Remote state: `main...origin/main [ahead 2]`
- Tracked diff: `298 files changed, 13096 insertions(+), 21467 deletions(-)`
- Primary areas: color-cycle brush runtime, canvas handlers, persistence/history, Goblet export, store/layer state, docs/config

## Phase 1 - Safety Branch

Goal: preserve the current uncommitted work on an isolated review branch without losing or rewriting any user changes.

- [ ] Create a review branch from the current dirty tree.
  - [ ] Run `git switch -c review/color-cycle-runtime-snapshot-2026-07-07`.
  - [ ] Run `git status --branch --short`.
  - [ ] Confirm the full dirty tree is still present after switching.
- [ ] Do not reset, stash, or checkout files unless explicitly requested.
- [ ] Treat all existing uncommitted changes as user work until proven otherwise.

## Phase 2 - Baseline Verification

Goal: learn whether the full tree currently compiles, lints, and passes the most relevant tests before reviewing individual slices.

- [ ] Run TypeScript verification.
  - [ ] Run `npm run type-check`.
  - [ ] Capture any failures by file and error category.
  - [ ] Do not fix broad unrelated issues during this phase.
- [ ] Run lint verification.
  - [ ] Run `npm run lint`.
  - [ ] Capture failures by file and rule.
  - [ ] Separate introduced failures from pre-existing or unrelated failures when possible.
- [ ] Run focused tests for the touched color-cycle paths first.
  - [ ] Brush engine tests under `src/hooks/brushEngine/**/__tests__`.
  - [ ] Canvas handler tests under `src/hooks/canvas/**/__tests__`.
  - [ ] History/runtime rehydration tests under `src/history/**/__tests__`.
  - [ ] Persistence/export tests under `src/lib/colorCycle/**` and `src/utils/export/goblet/**`.
- [ ] Run broad test verification if focused tests are viable.
  - [ ] Run `npm test`.
  - [ ] Record pass/fail and any unstable tests.

## Phase 3 - Review Pass

Goal: inspect the change set by runtime behavior area and identify real blockers, contract breaks, missing files, and weak verification.

- [ ] Review brush engine decomposition.
  - [ ] Inspect `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`.
  - [ ] Inspect `src/hooks/brushEngine/BrushEngineFacade.ts`.
  - [ ] Inspect new `src/hooks/brushEngine/colorCycle*Runtime.ts` modules.
  - [ ] Verify deleted state helpers are fully replaced.
  - [ ] Check runtime ownership boundaries: settings, gradient slots, stroke state, layer binding, presentation, persistence.
- [ ] Review canvas runtime and handler wiring.
  - [ ] Inspect `src/components/canvas/useDrawingCanvas*`.
  - [ ] Inspect `src/hooks/canvas/useDrawing*Runtime*`.
  - [ ] Inspect `src/hooks/canvas/handlers/colorCycle/**`.
  - [ ] Verify pointer, keyboard, shape, eraser, playback, and finalize flows still use the intended runtime source.
- [ ] Review persistence, history, and undo.
  - [ ] Inspect `src/history/deltas/**`.
  - [ ] Inspect `src/history/runtimeRehydration.ts`.
  - [ ] Inspect `src/lib/colorCycle/documentState.ts`.
  - [ ] Inspect `src/lib/colorCycle/persistence/**`.
  - [ ] Verify project load/save, undo/redo, runtime rehydration, and document-state repair use one consistent source contract.
- [ ] Review Goblet export parity.
  - [ ] Inspect `src/utils/export/goblet/**`.
  - [ ] Inspect `src/components/modals/ExportModal.tsx`.
  - [ ] Verify Goblet export reads the same authoritative color-cycle state expected by the runtime.
  - [ ] Verify export diagnostics do not mask missing required payloads.
- [ ] Review stores, layers, and selection.
  - [ ] Inspect `src/stores/layers/**`.
  - [ ] Inspect `src/stores/helpers/**`.
  - [ ] Inspect `src/stores/slices/**`.
  - [ ] Verify color-cycle layer state, selection capture/delete/paste, crop/resize, and project lifecycle paths preserve runtime state.
- [ ] Review workers, compositor, and materializer paths.
  - [ ] Inspect `src/workers/colorCycleCompositor*`.
  - [ ] Inspect `src/lib/sequential/materializer/SequentialCpuMaterializer.ts`.
  - [ ] Verify worker message contracts and materializer inputs match changed runtime data.
- [ ] Review tests for meaningful coverage.
  - [ ] Confirm new tests assert behavior, not just implementation shape.
  - [ ] Confirm updated tests still fail on the old broken behavior when practical.
  - [ ] Confirm snapshot/helper utilities are scoped and reusable.
- [ ] Review docs and config last.
  - [ ] Inspect `docs/refactor/**` changes.
  - [ ] Inspect `eslint.config.mjs`.
  - [ ] Verify docs describe current behavior and do not claim unverified build/test status.

## Phase 4 - Fix Blockers

Goal: repair only evidence-backed issues that would make the commits unsafe, incomplete, or misleading.

- [ ] Triage review findings by severity.
  - [ ] Blocker: compile failure, broken runtime contract, data loss, export breakage, undo/history corruption.
  - [ ] High: test regression, missing authoritative source, stale fallback path, untracked file required by imports.
  - [ ] Medium: unclear ownership, duplicated helper with drift risk, weak test assertion.
  - [ ] Low: naming, comments, docs polish.
- [ ] Fix only actionable blockers found in Phase 2 or Phase 3.
- [ ] Keep each fix scoped to the area that exposed it.
- [ ] Re-run the smallest failing verification after each fix.
- [ ] Do not stack speculative fixes on top of failed attempts.

## Phase 5 - Commit Slicing

Goal: turn the large dirty tree into small, coherent, independently reviewable commits with explicit staging and staged-diff checks.

- [ ] Decide whether the docs/config changes belong in their own commit.
  - [ ] Candidate: `docs: update color-cycle architecture review plan`
- [ ] Stage and commit brush-engine runtime decomposition.
  - [ ] Stage explicit `src/hooks/brushEngine/**` paths needed for the runtime split.
  - [ ] Include matching brush-engine tests.
  - [ ] Run focused brush-engine tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `refactor: split color-cycle brush runtime modules`.
- [ ] Stage and commit canvas runtime wiring.
  - [ ] Stage explicit `src/components/canvas/**` and `src/hooks/canvas/**` paths needed for handler wiring.
  - [ ] Include matching canvas handler tests.
  - [ ] Run focused canvas tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `refactor: wire color-cycle runtime through canvas handlers`.
- [ ] Stage and commit persistence/history/undo changes.
  - [ ] Stage explicit `src/history/**`, `src/lib/colorCycle/**`, and supporting persistence paths.
  - [ ] Include matching history and persistence tests.
  - [ ] Run focused history and persistence tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `fix: preserve color-cycle runtime state across history and persistence`.
- [ ] Stage and commit Goblet/export parity changes.
  - [ ] Stage explicit `src/utils/export/goblet/**`, export modal changes, and export tests.
  - [ ] Run focused Goblet/export tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `fix: align goblet color-cycle export source resolution`.
- [ ] Stage and commit store/layer/selection changes.
  - [ ] Stage explicit `src/stores/**`, `src/layers/**`, and selection helper tests.
  - [ ] Run focused store/layer tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `fix: retain color-cycle layer state through store operations`.
- [ ] Stage and commit remaining test-only or tooling cleanup if any remains.
  - [ ] Verify the remaining diff is coherent and not forgotten production code.
  - [ ] Run the relevant focused tests.
  - [ ] Run `git diff --cached --check`.
  - [ ] Commit candidate: `test: expand color-cycle runtime parity coverage`.

## Phase 6 - Final Verification

Goal: prove the final committed branch is buildable, testable, and behaviorally sane across the touched runtime/export paths.

- [ ] Run `npm run type-check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] If UI/export behavior was touched materially, run a manual browser sanity pass.
  - [ ] Start or reuse the appropriate Vessel dev/preview server.
  - [ ] Verify drawing with a color-cycle brush.
  - [ ] Verify shape fill/finalize with color-cycle behavior.
  - [ ] Verify undo/redo on color-cycle strokes.
  - [ ] Verify save/load project state.
  - [ ] Verify Goblet export preserves expected color-cycle playback.
- [ ] Run `git status --branch --short`.
- [ ] Run `git log --oneline --decorate --max-count=12`.
- [ ] Confirm the branch is clean or list the intentional remaining files.

## Phase 7 - Push Or Hold

Goal: leave the work in a clear handoff state, either pushed to a named branch or cleanly held locally with known verification status.

- [ ] Decide whether commits stay local or get pushed.
- [ ] If pushing:
  - [ ] Confirm branch name and target remote.
  - [ ] Run `git push -u origin review/color-cycle-runtime-snapshot-2026-07-07`.
  - [ ] Report pushed branch and commit list.
- [ ] If holding local:
  - [ ] Report branch name.
  - [ ] Report commit list.
  - [ ] Report any failed or skipped verification.
  - [ ] Report residual risks and suggested next review step.
