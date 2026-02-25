# Plan: Sequential Materializer Dirty-Run + Queue Debt Controls

Date: 2026-02-12
Status: In Progress (implementation underway)

## Implementation Snapshot (2026-02-12)
Completed:
- Phase 1: Queue foundation implemented.
  - `strokeProcessor` moved from `shift()` drain to head-cursor queue + compaction.
  - `OptimizedPipeline` request queue moved to dual cursor queues (`high` + `normalLow`), no `unshift`/`splice(0,n)` hot-path drain.
- Phase 2: Debt guardrails implemented for pixel queue.
  - Pending cap (`MAX_PENDING_PIXEL_TASKS`) with bounded catch-up drain behavior.
- Phase 3: Region-scoped materializer primitives implemented.
  - Added `FrameTilePatch` + `SequentialMaterializeRectInput`.
  - Added backend `materializeRect` contract and CPU/GPU implementation path.
  - Added explicit patch merge logic.
- Phase 4: Dirty tile/run extraction and collapse in CPU patch path implemented.
  - Dirty ROI -> tile keys -> run coalescing.
  - Band/full collapse thresholds + clear-tile handling.
- Phase 5: Renderer wiring implemented.
  - Append and preview patch flows now prefer `materializeRect` when available.
  - Fallback to full materialization remains in place on exceptions.
  - Patch reason telemetry now emitted (`applied_run_patch`, `collapsed_to_band_patch`, `collapsed_to_full_patch`, `fallback_exception`).

Validation completed:
- `type-check`, `lint`, and targeted sequential/materializer/queue/perf-probe tests pass in this change set.
- New tests added for:
  - `materializeRect` parity and clipping
  - patch merge parity + clear tile behavior
  - renderer append path preference for `materializeRect`
  - patch reason counter shape + monotonic increments

Rollout state:
- Feature flags are implemented and currently default to safe/off:
  - `enableSequentialTypedQueueDebtControl`
  - `enableSequentialDirtyRunPatch`
- This keeps existing runtime behavior stable until explicitly enabled for perf rollout.

Remaining:
- Manual perf sanity pass (dense long-session drawing) against acceptance criteria.
- Optional threshold tuning from probe data (collapse thresholds and queue compaction heuristics).

## Goal
Reduce paint and sequential recording/playback latency by eliminating full-frame rebuild work where possible and preventing unbounded queue debt under sustained input.

## Scope
- `src/lib/sequential/materializer/SequentialCpuMaterializer.ts`
- `src/lib/sequential/materializer/SequentialMaterializerBackend.ts`
- `src/lib/sequential/SequentialLayerRenderer.ts`
- `src/hooks/brushEngine/strokeProcessor.ts`
- `src/lib/colorCycle/performance/OptimizedPipeline.ts` (secondary queue draining hygiene; only if profiling confirms impact)
- Related tests under:
  - `src/lib/sequential/materializer/__tests__/SequentialCpuMaterializer.test.ts`
  - `src/lib/sequential/__tests__/SequentialLayerRenderer.test.ts`

Out of scope:
- Feature-level UX changes
- Canvas semantics changes (blend/opacity behavior must remain identical)

## Current Bottlenecks (verified)
1. `patchFrame` inflates pixels and re-builds tiles from effectively full-frame scratch.
2. Tile extraction scans all tile cells for alpha on every patch/materialize.
3. Hot-path task queues use O(n) dequeue patterns (`shift`/`splice`) under pressure.
4. Queue debt controls are partial (payload caps exist for sequential capture), but task-work collapse is missing.

## Target Architecture
## 1) Region-Scoped Materializer API
Add a region-aware path so patching can stay tile-scoped.

Proposed backend additions:
- `materializeRect(input): FrameTilePatch`
- `patchFrame(...)` remains for compatibility but internally delegates to region/tile-scoped logic.

`materializeRect` contract:
- Inputs: `{ width, height, frameIndex, events, rect, eventsAreFrameScoped? }`
- `rect` normalized/clamped to canvas bounds.
- Output is patch-only (not a full authoritative frame tile set).
- Only tiles intersecting `rect` are produced/updated.

`FrameTilePatch` contract:
- `frameIndex: number`
- `tileSize: number`
- `tiles: FrameTile[]` (replacement tiles)
- `clearTileKeys?: number[]` (tile keys that must be deleted when patch result is now fully transparent)

Cache application rule:
- `FrameTilePatch` must be merged into an existing authoritative frame cache entry.
- Existing `FrameTileSet` remains the authoritative representation at renderer boundaries.

Behavioral invariant:
- For any frame, `full materialize` == `base + patch/materializeRect updates` byte-for-byte.

## 2) Dirty Tile Tracking + Run Coalescing
Introduce dirty tile coordinates during paint and process them as runs.

Data model:
- Dirty tile set key: `tileY * tileCols + tileX`.
- Row-run form: per row, sorted contiguous runs `{ tileY, x0, x1 }`.

Rules:
- Coalesce contiguous dirty tiles into runs before extraction.
- If run count exceeds threshold, collapse to a larger region (row bands or full-frame patch; see thresholds).

Benefits:
- Fewer tile-copy loops.
- Better cache locality.
- Bounded per-patch scheduling overhead.

## 3) Queue Implementation Hygiene (No O(n) Dequeue)
Replace `shift`/`splice(0, n)` draining in hot paths with cursor-based queues or ring buffers.

Targets:
- `strokeProcessor` task queue.
- `OptimizedPipeline` pending request queue (secondary priority).

Approach:
- Maintain `head` cursor and compact only when needed.
- Keep high-priority behavior by using dual queues (`high`, `normalLow`) instead of `unshift`.
- Refactor queue items to typed tasks before applying collapse policies.

## 4) Debt Guardrails (Pending Cap + Collapse)
Add hard limits to prevent latency spiral.

Controls:
- Max pending task count.
- Max dirty tile/run count per tick.
- Collapse policy to coarser unit when above thresholds.

Existing payload-byte caps in sequential capture remain unchanged and complementary.

Safety rule:
- For stroke paint queues, do not drop/skip arbitrary queued closures.
- Collapse only typed mergeable work units (for example, union ROI update work), while preserving final visual state semantics.

## Proposed Thresholds (initial)
These are initial values; tune with perf probes after implementation.

- `SEQUENTIAL_TILE_SIZE`: existing `128` (unchanged initially)
- `MAX_PENDING_PIXEL_TASKS`: `2048`
- `MAX_DIRTY_TILE_KEYS_PER_PATCH`: `4096`
- `MAX_DIRTY_RUNS_PER_PATCH`: `512`
- `DIRTY_RUN_COLLAPSE_TO_BANDS_THRESHOLD`: `256`
- `DIRTY_COLLAPSE_TO_FULL_FRAME_THRESHOLD`: `1024` dirty tiles or `> 35%` tile coverage
- `QUEUE_COMPACT_INTERVAL`: compact when `head > 1024` and `head > queue.length / 2`

Collapse strategy:
1. Normal: run-coalesced tile extraction.
2. If runs too high: collapse to row bands.
3. If coverage/debt too high: full-frame patch for that tick, then reset debt.

## Implementation Plan (phased)
## Phase 1: Typed queue foundation (low risk)
1. Replace `shift`/`splice` dequeue patterns with cursor/ring queue adapters.
2. Introduce typed queue tasks for `strokeProcessor` (explicitly mark mergeable vs non-mergeable).
3. Add counters/telemetry for queue depth and queue compaction behavior.

Deliverables:
- No behavior change, only queue-performance and observability improvements.

## Phase 2: Queue debt guardrails (safe collapse)
1. Add queue caps and collapse policy only for mergeable typed tasks.
2. Enforce no-drop behavior for non-mergeable stroke tasks.
3. Add counters for collapsed ticks and forced coarse updates.

Deliverables:
- Stability guardrails without stroke-loss regressions.

## Phase 3: Region-scoped materializer primitives
1. Add rect normalization and tile-intersection helpers.
2. Add `materializeRect` to backend interface + CPU implementation with explicit `FrameTilePatch`.
3. Keep existing `materializeFrame` path unchanged for baseline and fallback.
4. Add explicit patch-merge helper in materializer/cache layer.

Deliverables:
- Unit tests for rect clipping, empty rect, edge tiles, and parity with full materialization.

## Phase 4: Dirty tile/run extraction in patch path
1. During `patchFrame`, derive dirty tile keys from conservative brush/plugin ROI bounds.
2. Coalesce keys into row runs.
3. Extract/update only dirty runs (plus required halo policy by blend mode/brush mode).
4. Apply run/debt collapse thresholds.

Deliverables:
- `patchFrame` avoids full-frame scan in common case.
- Preserves byte parity with full rematerialization.

ROI rule for large/custom brushes:
- Custom stamp brushes, rotated stamps, plugin brushes, and erase/destination-out paths must use conservative bounds with deterministic inflation.
- If ROI confidence is uncertain, force band/full-frame fallback for correctness.

## Phase 5: Renderer wiring and fallback policy
1. Update `SequentialLayerRenderer` to prefer rect/tile-scoped patching.
2. Maintain fallback to full materialization on any patch exception.
3. Emit patch outcome stats with reasons:
   - `applied_run_patch`
   - `collapsed_to_band_patch`
   - `collapsed_to_full_patch`
   - `fallback_exception`

## Validation Plan
## Automated
Run:
- `npm run type-check`
- `npm run lint`
- `npm test -- src/lib/sequential/materializer/__tests__/SequentialCpuMaterializer.test.ts src/lib/sequential/__tests__/SequentialLayerRenderer.test.ts`

Add tests for:
- `materializeRect` parity with full materialization for same frame/events.
- Patch merge semantics (`FrameTilePatch` + clear keys) parity against full rematerialization.
- Dirty-run coalescing correctness (sparse, contiguous, fragmented).
- Collapse thresholds triggering expected fallback mode.
- Queue cap behavior does not deadlock, preserves order for non-mergeable tasks, and still drains work.
- Large custom stamp + sequential layer parity tests (rotated/alpha/erase variants).

## Manual perf sanity
- Use sequential recording on dense brush strokes and long sessions.
- Confirm frame-cache misses do not spike unexpectedly.
- Confirm no visible regression in blend/erase behavior.
- Track: avg tick time, p95 tick time, patch success %, collapse %, forced full-frame %.

### Runtime Probe (implemented)
Use the sequential perf probe payload available on `window.__lastSequentialPerf` to inspect patch debt/collapse behavior while drawing.

Focus fields:
- `window.__lastSequentialPerf.patching.attempts`
- `window.__lastSequentialPerf.patching.applied`
- `window.__lastSequentialPerf.patching.fallbacks`
- `window.__lastSequentialPerf.patching.reasons.applied_run_patch`
- `window.__lastSequentialPerf.patching.reasons.collapsed_to_band_patch`
- `window.__lastSequentialPerf.patching.reasons.collapsed_to_full_patch`
- `window.__lastSequentialPerf.patching.reasons.fallback_exception`

Expected directional signals during manual tests:
- Dense normal drawing: `applied_run_patch` should climb steadily.
- Very large/coverage-heavy edits: `collapsed_to_full_patch` should increase.
- Fragmented heavy edits: `collapsed_to_band_patch` may increase.
- Stable sessions should keep `fallback_exception` near zero.

### Manual Perf Runbook (step-by-step)
1. Enable feature flags in the app/session:
   - `enableSequentialTypedQueueDebtControl = true`
   - `enableSequentialDirtyRunPatch = true`
2. Start a sequential recording session on a large canvas (for example `2048x1536`).
3. Draw three workloads for at least 30s each:
   - Dense short strokes (high event count, moderate coverage)
   - Large brush/high-coverage strokes
   - Fragmented sparse strokes across many tile rows
4. During each workload, capture snapshots from:
   - `window.__lastSequentialPerf`
   - `window.vesselSequentialPerf?.getSnapshot?.()`
5. Record at minimum:
   - `patching.attempts`, `patching.applied`, `patching.fallbacks`
   - `patching.reasons.*`
   - runtime tick timing summary (`avg`/`p95` from probe samples)
6. Compare enabled-vs-disabled flag runs using the same document and stroke script.

### Perf Results Template
Use this template per workload and per flag state.

| Date | Flags | Workload | Attempts | Applied | Fallbacks | Run Patch | Band Collapse | Full Collapse | Fallback Exception | Tick Avg (ms) | Tick P95 (ms) | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| YYYY-MM-DD | on/off | dense-short |  |  |  |  |  |  |  |  |  |  |
| YYYY-MM-DD | on/off | high-coverage |  |  |  |  |  |  |  |  |  |  |
| YYYY-MM-DD | on/off | fragmented-sparse |  |  |  |  |  |  |  |  |  |  |

## Acceptance Criteria
- Median sequential patch time reduced by at least 25% on dense append scenarios.
- p95 runtime tick remains within target budget on sustained drawing (no unbounded queue growth).
- No image parity regressions in sequential materializer tests.
- No correctness regressions in existing sequential renderer tests.
- Large custom-brush sequential painting shows reduced jank/stall frequency in manual perf sanity.

## Risks and Mitigations
- Risk: dirty-bound underestimation causes missing pixels.
  - Mitigation: conservative bound inflation per brush + parity tests vs full materialize.
- Risk: too-aggressive collapse causes perf oscillation.
  - Mitigation: hysteresis for collapse/recover thresholds.
- Risk: queue cap drops useful fine-grain work.
  - Mitigation: collapse to coarser work unit (never silently discard final visual state).

## Rollback Strategy
- Keep full-frame materialization path as stable fallback.
- Gate typed queue debt controls and run-patch path with separate flags:
  - `enableSequentialTypedQueueDebtControl`
  - `enableSequentialDirtyRunPatch`
- If instability appears, disable flag and retain queue safety improvements.

## Notes
This plan complements existing sequential payload byte caps and checkpoint flushes; it does not replace them.
It is expected to have meaningful impact on large custom-brush painting in sequential animation layers by reducing patch/rematerialization and queue debt overhead, but it does not remove intrinsic per-stamp rasterization cost.
