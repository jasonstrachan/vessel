
## Sampled CC Shape Drag Hang

Date: 2026-04-22

Single decisive fix

- The hang stopped when sampled CC shape drag stopped entering the live polygon preview scheduler in `ShapeToolHandler.ts`.
- Concretely:
  - sampled drag stopped passing `renderPreview: true` into `continueShapeDrawing(...)`
  - sampled drag stopped setting `shouldShowPreview = true`
- That cut off:
  - `requestPolygonShapePreviewFrame()`
  - `renderPolygonShapePreviewFrame()`
  during sampled CC drag.

Problem

- Sampled Color Cycle shape drag could hang the tab during long/fast drags.
- The final fix was not in finalize or sampled commit itself.
- The hang came from live drag-time preview/update work accumulating on the main thread.

What we disabled to stop the hang

These changes together made the hang stop reproducing:

1. Sampled CC shape drag became preview-only for sampled data.
   - No `updateCcSampledGradient(...)` on drag start.
   - No `updateCcSampledGradient(...)` during drag.
   - Sampled stops are derived only at finalize, immediately before `finalizeMarkGradientSession(...)`.

2. Sampled CC shape drag stopped doing drag-time store/session mutation.
   - No live sampled session churn during drag.
   - No drag-time gradient store writes for sampled CC shapes.

3. Sampled CC shape drag stopped repeated synthetic stop churn.
   - `shape-tool-drag` stop calls were suppressed for sampled CC drag moves.
   - Playback stop happens on the start edge, not every drag tick.

4. Sampled CC shape drag stopped per-tick snapshot/simple preview work.
   - No `capturePendingShapeSnapshot()` during sampled drag.
   - No `triggerSimpleShapePreview()` during sampled drag.

5. Sampled CC shape drag stopped live preview scheduling entirely.
   - `continueShapeDrawing(..., { renderPreview: false })` for sampled drag.
   - `shouldShowPreview = false` for sampled CC drag in `ShapeToolHandler`.
   - This was the one change after which the hang stopped reproducing.
   removes the whole preview?

6. Resampling was hard-capped.
   - Shared `appendSegmentWithDynamicResampling(...)` now adds at most 32 points per segment.
   - Live drag points are still clamped/decimated in shape drawing.

7. Shape interaction was made single-flight.
   - Phase ref: `idle | drawing | finalizing`
   - New starts are dropped during finalize.
   - `continueShapeDrawing()` no-ops outside `drawing`.

Why this matters

- The last change that stopped the hang was disabling live preview scheduling for sampled CC shape drag.
- That means the dangerous path was live sampled drag preview orchestration, not sampled finalize/commit.

Current safe model

- During sampled CC shape drag:
  - collect geometry only
  - no sampled recompute
  - no sampled store/session mutation
  - no simple preview snapshot path
  - no live fill preview scheduling

- On finalize:
  - derive sampled stops once
  - finalize mark session
  - run fill/commit once

Safe re-enable order

If bringing preview back, do it in this order only:

1. Outline-only preview via the cheap rAF path.
   - No sampled fill work.
   - No snapshot path.
   - No sampled session/store writes.

2. Lightweight fill preview that does not mutate sampled session/store state.
   - Keep it pure overlay-only.

3. Only if proven stable: more detailed sampled fill preview.
   - Never reintroduce drag-time sampled store writes.
   - Never reintroduce per-tick snapshot capture for sampled drag.

Do not reintroduce

- `updateCcSampledGradient(...)` during sampled drag
- `capturePendingShapeSnapshot()` during sampled drag
- `triggerSimpleShapePreview()` during sampled drag
- per-move `stopContinuousColorCycleAnimation('shape-tool-drag')` for sampled drag
- unconditional live preview scheduling for sampled sampled CC drag

Files touched in the stabilization pass

- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
- `src/utils/shapeMaker.ts`
- `src/hooks/canvas/useDrawingHandlerRefs.ts`
- `src/hooks/canvas/handlers/shapes/buildShapeDrawingHandlerOptions.ts`
- `src/hooks/canvas/useDrawingShapeRuntime.ts`
- `src/lib/canvas/FinalizeQueue.ts`
