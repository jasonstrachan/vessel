# Load Project Modal Performance + Architecture Plan V2 (2026-02-21)

## Goal

Deliver a measurable performance improvement for Load Project flows (single file + folder browse), while reducing architecture risk in `LoadProjectModal` and preserving backward compatibility for `.vessel` archives.

## Implementation Status (updated 2026-08-06)

- Phase 0 complete: characterization/perf harness coverage added for modal+projectIO paths.
- Phase 1 complete: modal responsibilities split into dedicated hooks/components (`useProjectDirectoryBrowser`, `useProjectPreviewLoader`, `usePreviewViewportPanZoom`, `useGlobalProjectDrop`, `useDraggableModal`).
- Phase 2 complete: folder scan now lazy-loads timestamps with chunked hydration and cancellation/version guards.
- Phase 3 complete: latest-wins preview selection aborts superseded retries and archive-inspection stages.
- Phase 4 complete: preview manifest v2 (`manifestVersion: 2`) with compact preview payload and backward-compatible read normalization.
- Phase 5 complete: modal + `projectIO` guardrail tests enforce the compact-preview and 500/1000-file paths; the browser E2E loads a real Vessel archive and verifies automatic fit/centering.
- Follow-up complete: archive preview, ref analysis, and health reporting share one lazy ZIP session. The manifest thumbnail commits before health inspection, and loading remains safety-gated until inspection completes.

## Execution Summary

Primary validation commands:
- `npm run type-check`
- `npm run lint`
- `npm run test:load-project-modal:guardrails`
- `npm run test:e2e:load-project-modal`

CI enforcement:
- `.github/workflows/deploy.yml` runs:
  - `npm run test:load-project-modal:guardrails`

## Why This Plan Exists

Current improvements landed:
- fast preview manifest path (`manifest.json`) for initial modal preview
- alphanumeric folder ordering
- removal of expensive blank-thumbnail scan
- automatic fit/centering owned by the preview viewport hook
- one lazy archive-inspection session per selection
- cancellable, visibly staged preview/health processing
- virtualized folder rows with batched metadata for only the first 40 priority entries
- compact preview payload without duplicate project thumbnail data
- enforceable component and archive-preview performance smoke tests

## Scope

### In Scope
- `src/components/modals/LoadProjectModal.tsx`
- new hooks/components under `src/components/modals/` and `src/hooks/`
- `src/utils/projectIO.ts`
- modal + project I/O unit/integration tests
- modal browser-flow E2E tests
- refactor docs updates

### Out of Scope
- global redesign of all modal infrastructure
- migration CLI/tooling for already-saved archives

## Performance Budgets (Must Pass)

All budgets are measured on local dev/CI test fixtures and enforced by automated tests with generous thresholds.

1. Preview first read from file selection (`manifest.json` path):
- synthetic 5 MB archive smoke <= 200 ms in CI
- real 1.4 MB legacy archive first image <= 1000 ms in browser E2E

2. Folder initial list render for 500 files:
- first visible list paint <= 250 ms
- rendered DOM stays windowed rather than mounting all 500 rows

3. Folder initial list render for 1000 files:
- first visible list paint <= 450 ms
- rendered DOM stays windowed; only 40 priority timestamps hydrate initially

4. Rapid selection stability:
- a new selection aborts the superseded request signal and only the latest preview can commit

5. Payload size for new saves:
- preview-related bytes in archive reduced by >= 30% vs current dual-thumbnail baseline fixture

## Architecture Direction

### Boundary Split
- keep `LoadProjectModal.tsx` as composition + render shell
- move side-effect/data orchestration to hooks:
  - `useProjectDirectoryBrowser`
  - `useProjectPreviewLoader`
  - `usePreviewViewportPanZoom`
- move pure helpers to small utilities (sorting, file acceptance, timestamp formatting, operation tokens)

### Data Flow
1. user selects file/folder
2. preview loader reads `manifest.json` first
3. full `deserializeProject` runs only when:
   - user confirms Load, or
   - fallback preview generation is required for selected file
4. fallback job is cancellable, versioned, and latest-wins
5. stale operations cannot commit state

## Archive Schema Contract (Compatibility-Safe)

### New Manifest Fields
- `manifestVersion: 2`
- `preview` object:
  - `dataUrl` (compact preview)
  - `width`
  - `height`
  - `encoding` (`image/webp` preferred, fallback `image/png`)

### Write Strategy
1. New saves write `manifestVersion: 2` + compact preview in `manifest.json`.
2. New saves do not store full-size duplicate preview in `project.json`; use either:
- absent thumbnail field, or
- tiny placeholder thumbnail capped by strict size limit.
3. Add explicit writer guard so old behavior can be toggled only by a compatibility flag (default off for new saves).

### Read Strategy
1. If `manifestVersion >= 2` and preview exists, use manifest preview.
2. If missing/invalid, fallback to `project.json` thumbnail.
3. If both absent, run fallback generation job.
4. Never fail project load solely due to missing/corrupt preview bytes.

## Cancellable Work Requirements

Cancellation must happen both at commit and at work source:
1. state commit guard:
- operation token/version checked before every state update
2. work-source cancellation:
- `AbortController` (or equivalent) passed through async preview + scan pipeline
- timestamp hydration loop checks abort signal between entries/chunks
- fallback decode/deserialization checks abort before expensive steps
3. latest selection/folder scan always cancels previous pending jobs

## Phased Execution

## Phase 0: Baseline + Characterization Tests

### Tasks
1. Add characterization tests for current keyboard, pointer, double-click load, and legacy file behavior.
2. Add perf harness fixtures for:
- large folder lists (500/1000)
- large `.vessel` preview path
3. Record baseline metrics in this doc before refactor.

### Definition of Done
- existing behavior locked by tests before structural extraction begins
- baseline numbers captured for all five budgets

## Phase 1: Decompose Modal Responsibilities

### Tasks
1. Extract directory scanning/selection persistence to `useProjectDirectoryBrowser`.
2. Extract preview pan/zoom to `usePreviewViewportPanZoom`.
3. Extract preview import/fallback pipeline to `useProjectPreviewLoader`.
4. keep `LoadProjectModal.tsx` as view/composition shell.

### Definition of Done
- `LoadProjectModal.tsx` has no direct directory iteration logic
- `LoadProjectModal.tsx` has no direct pan math
- behavior parity tests (Phase 0) all pass
- modal shell file size <= 500 LOC target (hard stop still 700 LOC)

## Phase 2: Folder Scan Performance

### Tasks
1. Make metadata/timestamps lazy:
- pass 1: names + handles only (fast)
- pass 2: timestamps for visible and selected rows only
2. Add chunking/yield between timestamp batches to avoid long blocking bursts.
3. enforce cancellation/versioning for scan + timestamp hydration.
4. preserve alphanumeric sort order.

### Definition of Done
- 500/1000 file list paint budgets pass
- no stale timestamp commits after folder reselection
- list remains keyboard-navigable during timestamp hydration

## Phase 3: Cancellable Thumbnail Fallback

### Tasks
1. Add fallback generation path that is fully cancellable.
2. Ensure new selection cancels prior fallback decode/hydration work.
3. keep preview panel responsive while fallback runs.
4. evaluate worker offload path; if not implemented now, document threshold and follow-up issue.

### Definition of Done
- rapid selection stability budget passes
- no stale preview commits from superseded selections
- no full-project hydration unless required for current selected file

## Phase 4: Preview Payload Size Optimization

### Tasks
1. Implement `manifestVersion: 2` schema + writer/readers.
2. move canonical preview to `manifest.json` compact encoding.
3. remove or cap duplicate thumbnail payload in `project.json` for new saves.
4. keep tolerant read path for legacy archives.
5. add fixture coverage for modern + legacy + mixed/corrupt preview cases.

### Definition of Done
- preview payload reduction budget (>= 30%) passes
- modern and legacy fixtures load successfully
- corrupt/missing preview data degrades gracefully

## Phase 5: Guardrails + CI Enforcement

### Tasks
1. Add/update tests for:
- fast manifest preview path
- lazy timestamp behavior
- cancellation of stale scan/preview jobs
- schema compatibility behavior
2. add E2E modal flow test:
- open large folder
- keyboard navigation
- rapid selection changes
- double-click load
3. add perf smoke checks with explicit thresholds matching this plan.

### Definition of Done
- CI fails when budgets regress
- both unit/integration and E2E coverage exist for critical modal flows

## Risks and Mitigations

1. Risk: refactor drifts keyboard/pointer behavior.
- Mitigation: Phase 0 characterization tests gate extraction work.

2. Risk: cancellation only prevents stale commits but not CPU contention.
- Mitigation: enforce work-source cancellation and chunked/yielded loops.

3. Risk: thumbnail schema update breaks cross-version compatibility.
- Mitigation: explicit manifest versioning, tolerant read fallback order, fixture matrix for modern/legacy/corrupt cases.

4. Risk: timing tests are flaky across environments.
- Mitigation: use generous thresholds, relative assertions vs baseline where needed, and run perf smoke in stable CI profile.

## Validation Checklist Per Phase

Run after each phase:
1. `npm run type-check`
2. `npm run lint`
3. `npm test -- LoadProjectModal projectIO --runInBand`
4. targeted perf/test command for the phase (documented in test file headers)

Before merge:
1. `npm test`
2. E2E modal flow suite (Playwright or repo-standard browser harness)
3. manual sanity:
- open modal with large folder
- arrow-key navigation across files
- rapid selection changes while preview updates
- double-click auto-load from folder list
- open legacy `.vessel` file without `manifest.json`

## Success Metrics

1. all five performance budgets pass in CI
2. modal browse interaction remains responsive at 500/1000 file fixture sizes
3. `LoadProjectModal.tsx` reduced to composition-level shell (<= 500 LOC target)
4. new-save preview payload reduced by >= 30% with no compatibility regression

## Deliverable Order

1. Phase 0 + Phase 1 (baseline protection + architecture boundary split)
2. Phase 2 (largest browse latency win)
3. Phase 3 (rapid interaction stability)
4. Phase 4 (payload/schema optimization)
5. Phase 5 (CI enforcement and regression guardrails)
