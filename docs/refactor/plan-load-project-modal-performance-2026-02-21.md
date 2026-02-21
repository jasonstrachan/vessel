# Load Project Modal Performance + Architecture Plan (2026-02-21)

## Goal

Make the Load Project flow consistently fast for large `.vessel` files and large folders while reducing architectural risk in `LoadProjectModal`.

## Why This Plan Exists

Current improvements landed:
- fast preview manifest path (`manifest.json`) for initial modal preview
- alphanumeric folder ordering
- removal of expensive blank-thumbnail scan

Remaining high-impact issues:
1. `src/components/modals/LoadProjectModal.tsx` is oversized and mixes too many responsibilities.
2. Folder scan still calls `getFile()` per entry to display timestamps.
3. No-thumbnail fallback still hydrates full project on main thread.
4. Save payload still duplicates preview image data (`project.json` + `manifest.json`).
5. No explicit performance regression tests for the modal path.

## Scope

### In Scope
- `src/components/modals/LoadProjectModal.tsx`
- New hook/components under `src/components/modals/` (or `src/hooks/` where appropriate)
- `src/utils/projectIO.ts`
- Modal and project I/O tests
- Refactor docs updates

### Out of Scope
- Global redesign of all modal infrastructure
- Non-load related project format migration tooling

## Non-Functional Targets

1. Preview-first metadata load should avoid full `deserializeProject` in the common case.
2. Folder open with 500+ files should stay responsive (no long blocking burst on open).
3. Modal file should be reduced below orchestration guardrail hard-stop and split by concern.
4. Save size for preview payload should be reduced without losing a usable preview.

## Architecture Direction

### Boundary Split
- Keep modal shell as composition + rendering.
- Move side-effect/data orchestration into hooks:
  - `useProjectDirectoryBrowser`
  - `useProjectPreviewLoader`
  - `usePreviewViewportPanZoom`
- Keep pure helpers in small utility modules (sorting, file acceptance, formatting).

### Data Flow
1. User selects file/folder.
2. Preview loader reads `manifest.json` (fast path).
3. Full `deserializeProject` only when:
   - user confirms Load, or
   - preview thumbnail missing and fallback preview job is requested.
4. Fallback thumbnail generation runs cancellably and asynchronously.

## Phased Execution

## Phase 1: Decompose Modal Responsibilities

### Tasks
1. Extract directory scanning + selection persistence into `useProjectDirectoryBrowser`.
2. Extract preview pan/zoom interactions into `usePreviewViewportPanZoom`.
3. Extract file processing/import pipeline into `useProjectPreviewLoader`.
4. Keep `LoadProjectModal.tsx` as a view/composition shell.

### Definition of Done
- `LoadProjectModal.tsx` contains no direct directory iteration logic.
- `LoadProjectModal.tsx` contains no direct pointer pan math.
- Behavior remains identical to current UX.

## Phase 2: Folder Scan Performance

### Tasks
1. Make timestamp loading lazy:
   - first pass: collect names/handles only
   - second pass: fill timestamps for visible/selected entries.
2. Add cancellation/versioning so stale scans cannot overwrite new results.
3. Keep list sorted alphanumerically by filename.

### Definition of Done
- Initial list appears quickly without waiting for all `getFile()` calls.
- Timestamp population is incremental and non-blocking.

## Phase 3: Cancellable Thumbnail Fallback

### Tasks
1. Add cancellable fallback generation path for missing thumbnails.
2. Ensure new selection cancels previous pending fallback work.
3. Keep preview panel responsive while fallback job runs.

### Definition of Done
- Switching entries rapidly never queues stale preview updates.
- No full-project hydration unless required for current selected file.

## Phase 4: Preview Payload Size Optimization

### Tasks
1. Introduce project format flag/version note for thumbnail strategy.
2. Keep compact preview in `manifest.json`.
3. Evaluate dropping or heavily shrinking `project.project.thumbnail` in `project.json` for new saves.
4. Preserve backward compatibility on read.

### Definition of Done
- New saves produce meaningfully smaller preview-related payload.
- Older files still load and preview correctly.

## Phase 5: Test + Perf Guardrails

### Tasks
1. Expand `LoadProjectModal` tests for:
   - fast manifest preview path
   - lazy timestamp behavior
   - cancellation of stale preview jobs
2. Expand `projectIO` tests for:
   - preview manifest compatibility
   - old archive fallback behavior
3. Add measurable perf smoke checks (timing-based with generous thresholds).

### Definition of Done
- Tests cover both modern (`manifest.json`) and legacy (`project.json`-only) archives.
- CI catches regressions in preview-path behavior.

## Risks and Mitigations

1. Risk: Refactor introduces behavior drift in keyboard/pointer handling.
- Mitigation: Preserve existing keybindings and add focused modal interaction tests.

2. Risk: Async cancellation leaves stale state visible.
- Mitigation: Operation token/version checks before every state commit.

3. Risk: Thumbnail strategy change breaks older loaders.
- Mitigation: Read path remains tolerant and falls back to `project.json`.

## Validation Checklist Per Phase

Run after each phase:
1. `npm run type-check`
2. `npm run lint`
3. `npm test -- LoadProjectModal projectIO --runInBand`

Before merge:
1. `npm test`
2. Manual sanity:
   - open modal with large folder
   - arrow-key navigation across files
   - double-click auto-load from folder list
   - open legacy `.vessel` file without `manifest.json`

## Success Metrics

1. Median time from file selection to preview render decreases for large projects.
2. Folder browse perceived latency decreases (list appears immediately).
3. `LoadProjectModal.tsx` reduced to composition-level size and complexity.
4. Preview-related saved payload size decreases for newly saved projects.

## Deliverable Order

1. Phase 1 + Phase 2 (architecture + biggest UX latency wins)
2. Phase 3 (stability under rapid user interaction)
3. Phase 4 (format/payload optimization)
4. Phase 5 (guardrails + regression prevention)

