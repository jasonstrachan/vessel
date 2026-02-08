# Plan: CC-Native Sequential Record Mode

Date: 2026-02-07
Status: Proposed (updated after architecture review)

## Goal
Implement sequential capture in Vessel where users draw while frames advance, producing moving brush stamps, with smooth performance and minimal architectural entanglement.

## Locked Product Decisions
- Build this inside Vessel (no separate app).
- Keep current `Play/Pause` as the only transport control.
- Do not add a separate `Record` toggle.
- Add `FPS`, `Frames`, and `Time-smear` controls.
- Support all brush paths (normal, custom, resampler, color-cycle).
- Use a dedicated sequential animation layer type.
- Capture writes only to sequential layers (when the active layer is sequential).
- Sequential layers must support normal layer compositing semantics (opacity + blend mode).
- For performance and determinism, each recorded event keeps an immutable `frameIndex`.

## Architecture Decision
Use a CC-native architecture:
- One shared animation runtime (same clock family as color-cycle playback).
- CPU-canonical domain model (single source of truth for behavior).
- GPU path only as an optional acceleration backend.
- Event-sourced stroke recording plus incremental frame cache (not naive full-frame snapshots).
- Canonical write path is event-log only; frame caches are derived artifacts only.

## Shared Runtime Shape (Multiplexer)
- Treat shared runtime as a thin multiplexer module, not a CC refactor target.
- Runtime owns:
  - one tick loop
  - consumer registration/unregistration
  - dispatching `(timestampMs, deltaMs)` to consumers
- Runtime does not own subsystem logic (no CC/sequential branching beyond registered consumers).
- CC and sequential integrate as independent consumers.

## Why This Is the Smartest Path
- Stays close to existing color-cycle orchestration and composite segmentation.
- Avoids duplicated CPU/GPU business logic.
- Keeps behavior deterministic for undo/redo, save/load, and export.
- Delivers smooth playback by rendering cached frame artifacts, not replaying all strokes every tick.

## One-Button UX Policy
- `Play/Pause` remains the only transport control.
- Capture occurs only when all conditions are true:
  - playback is `Play`
  - active layer is `sequential`
  - pointer is drawing
- Show a visible `REC` badge on the `Play/Pause` button while capture is active.
- No capture occurs on normal or color-cycle layers.

## Sequential Overlay Model
- Explicit runtime overlay is part of capture UX.
- While capturing:
  - render `current materialized sequential frame + live stroke overlay`.
- On frame advance:
  - canonical events are already appended for that slice/window.
  - clear live overlay and continue capture on next frame.
- Overlay is runtime-only (not persisted, not canonical).
- `Time-smear` slider lives directly under `Play/Pause`.
- `Time-smear` controls how much stroke-time is accumulated per frame:
  - lower values preserve a cleaner stamp-per-frame look
  - higher values accumulate more events and create stronger smear/trail behavior

## Explicit CPU vs GPU Policy
## Canonical Path
- `SequentialEventLog` and frame assignment are CPU-side source of truth.
- All semantics must be reproducible without GPU.

## GPU Path
- GPU is an accelerator for rasterization/compositing/caching only.
- GPU must never own authoritative sequencing rules.
- GPU backend can be disabled without changing output semantics.

## Parity Rule
- Every GPU stage requires CPU parity tests before default enablement.

## Data Model
## New Layer Type
- Add `layerType: 'sequential'` in `src/types/index.ts`.
- Add `sequentialData` payload on sequential layers only.

## Sequential Data (persisted)
- `frameCount: number`
- `fps: number`
- `durationMs: number` (derived/convenience)
- `events: SequentialStrokeEvent[]` (authoritative)

## Sequential Runtime State (not persisted)
- `frameIndexCache: Map<number, FrameTileSet>` (non-authoritative cache)
- `dirtyFrames: Set<number>`

## Event Shape
- `id`, `layerId`, `strokeId`
- `timestampMs` (relative to record session start)
- `frameIndex` (canonical, immutable after capture, used for deterministic export/replay)
- brush snapshot fields needed for replay/materialization:
  - `tool`, `brushShape`, `size`, `opacity`, `blendMode`, `rotation`, `spacing`, `color`
  - resolved custom brush stamp metadata when applicable
- geometry payload:
  - final resolved stamp list only (post-spacing/post-randomization)

## Canonical Recording Invariant
- Sequential recordings store final post-spacing stamp points and a fully-resolved brush snapshot.
- Materialization must not re-run spacing/randomization logic.

## Time-smear Mapping (Locked)
Mapping choice: **B (advance currentFrame by accumulated time)**.

Rules:
- `frameDurationMs = 1000 / fps`
- Per active stroke/session maintain `accumMs`.
- For each pointer sample delta:
  - `accumMs += deltaMs * timeSmearFactor`
  - while `accumMs >= frameDurationMs`:
    - `accumMs -= frameDurationMs`
    - `currentFrame = nextFrame(currentFrame)`
- All stamps emitted for that sample are tagged with the current `frameIndex`.

Frame progression mode:
- Sequential playback mode is **looped** by default.
- `nextFrame(i) = (i + 1) % frameCount`.
- While drawing, if advancing past last frame, capture wraps to frame `0` and continues.
- No clamp mode in v1 (can be added later as explicit mode).

## Runtime Topology
## Shared Animation Runtime
- Implement a neutral animation runtime module and connect CC + sequential consumers.
- Global tick drives:
  - color-cycle updates
  - sequential frame stepping
- Runtime runs when either subsystem is active.

## Sequential Materialization
- On record tick while drawing:
  - resolve stroke contribution and append canonical events tagged to current frame.
  - mark the current frame dirty for materializer rebuild.
  - clear transient overlay and advance frame.
- On pointer-up:
  - append trailing events and mark dirty frame(s).
- Playback:
  - draw from cached frame tiles for active frame index.

## Recording Controls Policy (performance-first)
- `FPS`/`Frames` changes during active capture do not remap already-recorded events.
- `Time-smear` changes affect subsequent captured events only (no retroactive remap).
- While capture is active:
  - either lock controls, or
  - apply changes to the next take only.
- Optional future operation: explicit offline rebake/remap command for existing event logs.

## Event Volume and Autosave Bounds
- Max stamp emission target per active stroke: `MAX_STAMPS_PER_SEC = 6000` (enforced deterministically).
- Persist sequential data as stroke chunks (delta-encoded stamp streams + brush snapshot header).
- Autosave payload thresholds for sequential data:
  - soft warning: `32 MB` per project
  - hard cap: `96 MB` per project (block new capture until user action).

## Stamp Cap Enforcement (Locked)
Deterministic per-stroke token bucket:
- State:
  - `tokens: number`
  - `maxTokens = MAX_STAMPS_PER_SEC * 0.1` (100 ms burst)
- On each pointer sample:
  - `tokens = min(maxTokens, tokens + deltaMs * MAX_STAMPS_PER_SEC / 1000)`
- For each candidate resolved stamp (in stable order):
  - if `tokens >= 1`: emit and `tokens -= 1`
  - else: drop

Notes:
- No random thinning.
- Candidate order is deterministic.
- Cap behavior is independent of render FPS; depends only on captured sample deltas.

## Sequential Chunk Format (Locked v1)
`SequentialStrokeChunkV1`
- `header`
  - `encodingVersion: 1`
  - `layerId: string`
  - `strokeSessionId: string`
  - `brushSnapshotId: string` (or hash)
  - `coordSpace: 'project-px'`
  - `quantization: 'q8.8'`
  - `fpsAtCapture: number`
  - `frameCountAtCapture: number`
  - `startFrameIndex: number`
- `body`
  - anchor point: `anchorXQ8_8: int32`, `anchorYQ8_8: int32`
  - packed stamp stream arrays:
    - `dXQ8_8: Int16Array`
    - `dYQ8_8: Int16Array`
    - `dFrame: Int16Array`
    - `pressureU8: Uint8Array`
    - `rotationI16: Int16Array`
    - `sizeU16: Uint16Array`
    - `alphaU8: Uint8Array`

Contract:
- Coordinate basis is project pixel space (layer-local visual space aligned to canvas origin).
- Upgrade path must bump `encodingVersion`; decoders must branch by version.

## Materializer Target Contract (Locked v1)
`FrameTileSet`
- `frameIndex: number`
- `tileSize: 128`
- `pixelFormat: 'rgba8'`
- `premultipliedAlpha: true`
- `colorSpace: 'srgb'`
- `tiles: FrameTile[]`

`FrameTile`
- `x: number`, `y: number`, `width: number`, `height: number`
- `data: Uint8ClampedArray` (RGBA8 premultiplied, sRGB)

Backend note:
- GPU backend may use texture handles internally, but canonical comparison/export path must materialize to this contract.

## History Coalescing Boundary (Locked)
Stroke session starts:
- pointer-down when `selectSequentialCaptureActive === true`.

Stroke session ends on first of:
- pointer-up / pointer-cancel
- capture deactivates (play paused, active layer leaves sequential, tool switch)
- brush snapshot identity changes.

History rule:
- all chunks/events in one stroke session are one history entry.

## Detailed Implementation Steps
## Step 0 - Prep and Guardrails
Files:
- `src/config/featureFlags.ts`
- `src/components/ui/FeatureFlagToggle.tsx`
- `docs/refactor/plan-sequential-record-mode.md`

Work:
- Add feature flags:
  - `enableSequentialRecordMode`
  - `enableSequentialGpuAcceleration`
- Keep defaults off.
- Add lightweight debug metrics hooks for record tick time and cache stats.

Acceptance:
- App behavior unchanged when flags off.
- Flag toggles visible in dev tooling.

## Step 1 - Types and Store Slice
Files:
- `src/types/index.ts`
- `src/stores/slices/sequentialRecordSlice.ts` (new)
- `src/stores/useAppStore.ts`
- `src/stores/__tests__/...` (new tests)

Work:
- Add sequential layer typings and event/cache interfaces.
- Add store slice state:
  - `fps`, `frameCount`, `timeSmear`, `currentFrame`, `sessionStartMs`
  - `isCaptureActive` (derived/runtime flag; not persisted)
- Add actions:
  - `setRecordFPS`, `setRecordFrameCount`, `setTimeSmear`
  - `stepSequentialFrame`, `setSequentialFrame`
- Add selectors:
  - `selectSequentialPlaybackActive`
  - `selectSequentialCaptureActive` (playing + active sequential layer + pointer-down)
  - `selectGlobalAnimationActive` (CC or sequential)

Acceptance:
- Store unit tests cover all transitions and selector truth tables.

## Step 2 - UI Wiring (Play/Pause + REC Badge + FPS/Frames/Time-smear)
Files:
- `src/components/panels/AnimationControlsPanel.tsx`
- `src/components/panels/__tests__/AnimationControlsPanel.test.tsx`
- `src/components/MinimalLayerList.tsx` (if duplicate controls remain)

Work:
- Add `FPS`/`Frames`/`Time-smear` controls.
- Preserve existing `Play/Pause` behavior.
- Show `REC` badge on the `Play/Pause` button while capture is active.
- Show frame counter (`current/total`) for sequential playback context.
- Enforce recording-controls policy:
  - lock FPS/Frames/Time-smear while actively capturing, or clearly mark as "applies next take".

Acceptance:
- Panel tests verify play/pause behavior, REC badge conditions, and suspended-state behavior.

## Step 3 - Shared Animation Runtime Refactor
Files:
- `src/hooks/canvas/handlers/animation/animationRuntime.ts` (new)
- `src/hooks/canvas/handlers/colorCycle/colorCyclePlayback.ts`
- `src/hooks/canvas/useDrawingPlaybackEffects.ts`
- `src/hooks/useDrawingHandlers.ts` (minimal integration points)

Work:
- Implement runtime multiplexer:
  - one loop
  - registered consumers called with `(timestampMs, deltaMs)`.
- Register CC consumer and sequential consumer in integration layers.
- Runtime ownership lives in neutral module, not CC-specific module.
- Remove CC-only early-exit assumptions.
- Keep current CC reasons/suspend model intact.
- Dispatch a unified frame update event that existing redraw hooks can consume.

Runtime invariants (must hold):
- When `selectSequentialCaptureActive` is true, pointer interaction must not suppress shared runtime tick.
- CC may apply internal suspend rules, but must not stop the multiplexer.
- Redraw cadence is driven by frame-update events, not pointer events.

Acceptance:
- Existing color-cycle behavior parity tests still pass.
- Sequential frame advances with no CC layers present.

## Step 4 - Sequential Event Capture Pipeline
Files:
- `src/hooks/canvas/handlers/strokeBatching.ts`
- `src/hooks/useDrawingHandlers.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleInteraction.ts`
- `src/hooks/canvas/utils/...` (new helper modules as needed)

Work:
- Capture resolved post-spacing/post-randomization stamps during draw path.
- Assign `frameIndex` from shared runtime state.
- Apply locked Time-smear Mapping B rules for frame assignment.
- Apply deterministic token-bucket stamp cap when needed.
- During capture mode, bypass non-CC interaction pause that currently suspends playback.
- Gate capture strictly by one-button policy (playing + active sequential layer + pointer-down).
- On tick/finalize, append canonical events and mark dirty frames (no direct authoritative cache writes).

Acceptance:
- Manual and integration tests confirm normal/custom/resampler/CC brushes all capture into advancing frames on sequential layers.

## Step 5 - Frame Cache and Materializer (CPU Canonical)
Files:
- `src/lib/sequential/SequentialEventLog.ts` (new)
- `src/lib/sequential/SequentialFrameCache.ts` (new)
- `src/lib/sequential/materializer/SequentialCpuMaterializer.ts` (new)
- `src/lib/sequential/types.ts` (new)

Work:
- Implement event log append/query APIs.
- Implement frame tile cache with dirty-frame invalidation and LRU eviction.
- CPU materializer produces frame tile sets from events and/or incremental updates.
- Keep cache disposable and rebuildable from event log.
- Ensure cache is strictly derived from event log; never treated as canonical persisted state.

Acceptance:
- Unit tests:
  - deterministic frame reconstruction
  - cache invalidation correctness
  - bounded cache growth under stress

## Step 6 - Optional GPU Acceleration Backend
Files:
- `src/lib/sequential/materializer/SequentialMaterializerBackend.ts` (new interface)
- `src/lib/sequential/materializer/SequentialGpuMaterializer.ts` (new, optional)
- `src/config/featureFlags.ts` (backend gate usage)

Work:
- Define backend interface with identical output contract.
- Implement GPU backend only for acceleration stages.
- Fallback to CPU backend on capability failure.

Acceptance:
- GPU backend disabled by default initially.
- Parity tests compare CPU and GPU materialized frames within tolerance.

## Step 7 - Compositor Integration
Files:
- `src/stores/slices/layersSlice.ts`
- `src/components/canvas/drawingCanvasCompositeStack.ts`
- `src/components/canvas/useDrawingCanvasRedrawEffects.ts`

Work:
- Add sequential segment descriptors.
- Draw active sequential frame artifact in composite order.
- Use existing frame-update redraw mechanism to avoid extra loops.
- Ensure sequential segments honor layer opacity/blend mode exactly like normal/color-cycle segments.

Acceptance:
- Layer ordering, blend, and opacity match expectations with static + CC + sequential layers mixed.

## Step 8 - History Integration
Files:
- `src/history/actionTypes.ts`
- `src/history/deltas/sequentialFrameDelta.ts` (new)
- `src/history/helpers/layerHistory.ts` (integration)
- tests under `src/history/__tests__/`

Work:
- Add sequential delta type for event/frame mutations.
- Coalesce commits per stroke session (not per tick).
- Ensure undo/redo rehydrates sequential cache correctly.

Acceptance:
- Undo/redo integration tests pass for mixed raster/CC/sequential sessions.

## Step 9 - Persistence and Autosave
Files:
- `src/utils/projectIO.ts`
- `src/utils/backgroundStorage.ts`
- `src/stores/__tests__/projectLifecycle.integration.test.ts` and related IO tests

Work:
- Serialize/deserialize sequential data schema.
- Persist only canonical data (`events`, settings); do not persist transient cache blobs unless intentionally optimized.
- Restore runtime cache lazily after load.

Acceptance:
- Save/load round-trip preserves sequential playback deterministically.
- Autosave restore preserves sequential layers and settings.

Sequencing note:
- Step 8 remains before Step 9 because history deltas are defined over runtime canonical events/chunks, not serialized project blobs.

## Step 10 - Export Integration
Files:
- `src/components/modals/ExportModal.tsx`
- `src/utils/export/types.ts`
- `src/utils/export/exportService.ts`
- `src/utils/__tests__/exportService.test.ts`

Work:
- Extend animation session stepping to set sequential frame index deterministically.
- Ensure GIF/video/webgl exports include sequential layers.

Acceptance:
- Export tests verify frame count, fps, and deterministic frame content.

## Step 11 - Performance Hardening
Files:
- `src/utils/performanceMonitor.ts` (if needed)
- `src/lib/sequential/*`
- selected canvas redraw paths

Work:
- Measure and tune:
  - tile size
  - cache window
  - redraw invalidation ROI
- Add guardrails for memory pressure.

Acceptance Targets:
- 30 FPS recording on common canvas sizes without visible stutter.
- No runaway memory growth in 2-minute loop capture tests.

## Testing Strategy
## Unit
- Store transitions and selectors.
- Event log frame mapping.
- Time-smear mapping behavior (Mapping B) including wrap behavior at last frame.
- Stamp-cap token bucket behavior under variable sample intervals.
- Chunk encode/decode v1 round-trip and versioned decode branching.
- FrameTileSet contract checks (premultiply/color-space/pixel format invariants).
- Cache eviction and invalidation.
- CPU/GPU parity (when GPU backend enabled).

## Integration
- Capture with each brush family.
- Capture while CC playback active.
- Layer stack interactions (visibility, opacity, reorder).
- Undo/redo stability.
- Session-boundary coalescing (pointer-up, pause, layer switch, tool switch, brush identity change).

## Export
- Deterministic GIF/video frame output from sequential layers.

## Manual QA
- Toggle play and draw on sequential vs non-sequential layers.
- Change FPS/frame count while capturing and while paused.
- Large canvas sessions with long capture runs.

## Risks and Mitigations
Risk ranking (highest first):
- Determinism drift if non-final stamp state is recorded.
- Runtime suspend interactions (CC playback + pointer-down + capture gating).
- Event log size/perf (autosave, history, export).
- Compositing mismatches (premultiply/alpha/tile format).
- GPU parity regressions (gated; lower immediate risk).

Mitigations:
- CPU-canonical model + parity gates.
- Strict module boundaries (`runtime`, `event-log`, `materializer`, `backend`).
- Runtime multiplexer + consumer isolation.
- Sparse cache + LRU + rebuild from canonical events.

## Definition of Done
- One-button capture UX ships with `REC` badge on play/pause.
- Capture is limited to sequential layers and supports all brush families.
- Existing color-cycle behavior remains stable.
- Undo/redo, save/load, autosave, and export are deterministic.
- CPU path is canonical and GPU acceleration is optional.
- `npm run type-check`, `npm run lint`, and relevant tests pass.

## Decisive Acceptance Tests
- Same fixed-seed recording exported twice produces hash-identical frame payloads.
- Sequential capture works with zero CC layers (frame advance + capture both active).
- Layer mix parity:
  - sequential layer below CC layer above it
  - blend/opacity stable during playback and during active capture.
- Long capture (2 minutes) stays within explicit autosave payload threshold.
- While `selectSequentialCaptureActive` is true, pointer activity cannot stop runtime ticks.
