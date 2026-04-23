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

---

Update: 2026-04-23 07:44 AEST

What turned out to be wrong in the original writeup:

- The shipped fix did not disable sampled preview entirely.
- The shipped fix did not keep sampled finalize capped.
- The final code keeps sampled preview alive and transformed through the normal preview frame path.
- The committed sampled shape still uses the full user-drawn geometry.

What was confirmed in-browser:

- The sampled preview worker was not the main remaining crash source once preview requests were bounded.
- Real logs showed a split between:
  - very large raw drag geometry
  - much smaller sampled preview dispatch geometry
- Example investigation logs showed:
  - `shape: preview frame` with raw counts in the thousands
  - `shape: sampled preview dispatch` with bounded counts around `100-160`

What landed in code:

1. Sampled preview publish now re-enters the normal preview-frame redraw path.
   - This preserves the active zoom/pan transform.
   - It avoids painting the cached sampled preview in raw world coordinates.

2. Sampled preview now reuses cached preview frames when the replay key already matches.
   - This avoids kicking another sampled worker pass just to repaint the same preview.

3. Preview geometry is simplified for live preview only.
   - `ShapeToolHandler.ts` uses a preview-only simplification path.
   - The simplifier is shape-preserving (`simplifyToVertexLimit(...)`), not blunt even-step decimation.
   - The preview guide segment was also corrected to use the same simplified endpoint as the preview polygon.

4. Finalize keeps the full shape geometry.
   - A temporary finalize-time sampled simplification was tried and then removed.
   - It was removed because it changed the committed mask for detailed shapes.
   - Final sampled session setup and sampled fill now use the full user-drawn polygon again.

What this means now:

- Preview path:
  - bounded
  - simplified
  - cached
  - transformed correctly through the normal overlay redraw path

- Finalize path:
  - uses the real shape geometry
  - does not inherit preview simplification

Important follow-up fact:

- Large raw point counts still exist on finalize.
- That means excessive point generation during drag remains a real upstream problem.
- The current shipped code fixes preview stability and transform correctness without changing committed shape fidelity.
- It does not yet solve the broader question of reducing raw drag point generation itself.

Relevant commits from this investigation:

- `844fb1f94` `fix: harden cc shape preview and finalize tracing`
- `ebe6c2470` `fix: stabilize sampled cc shape preview`
