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

---

Update: 2026-04-24 17:28 AEST

Latest confirmed facts from browser tracing:

- The current hang signature is not a hard renderer crash.
- DevTools repeatedly reported:
  - React scheduler churn (`uE` / `ux` / `unstable_scheduleCallback`)
  - watchdog recovery logs such as `[previous-hang] Recovered after long task: self`
- That watchdog log was only symptom-level evidence. It confirmed a stalled main thread, but it did not identify the root cause.

High-signal paused frame:

- The decisive paused frame landed inside the canvas composite draw path, not inside a worker and not in generic app mount.
- The relevant production code path matched:
  - `src/components/canvas/useDrawingCanvasBaseRenderer.ts`
  - call into `drawVisibleCompositeStack(...)`
- In the paused scope:
  - `activeLayer` existed
  - `activeLayer.layerType === 'color-cycle'`
  - `activeLayer.colorCycleData.canvas` existed
  - `activeLayer.framebuffer` existed
  - `activeLayer.imageData` existed
  - `colorCycleManager.isAnimating === false`

What this ruled out:

- not a missing active layer
- not null layer image data
- not a worker crash
- not an uncaught exception in the sampled CC shape path itself
- not generic `useSyncExternalStore` mount churn as the primary remaining cause for this specific hang

What the paused renderer code showed:

- After `drawVisibleCompositeStack(...)`, the renderer can hit:
  - `state.setCurrentCompositeBitmap(null)`
  - `state.setLayersNeedRecomposition(true)`
- That happens when `drawVisibleCompositeStack(...)` reports `invalidCompositeBitmap`.
- `invalidCompositeBitmap` is set when drawing the cached `compositeBitmap` throws `InvalidStateError`.

Current working diagnosis:

- The sampled CC shape "sample flat color 1" path can leave the canvas renderer trying to draw a stale composite `ImageBitmap`.
- The renderer invalidates that bitmap and requests recomposition.
- Before React/store state fully settles, the same stale bitmap can be seen again on the next draw tick.
- That creates a self-sustaining redraw / reschedule loop on the main thread.

What landed locally on 2026-04-24:

1. Renderer-side one-shot invalidation guard.
   - `useDrawingCanvasBaseRenderer.ts` now remembers the last stale `ImageBitmap` it invalidated.
   - The same bitmap can only trigger one invalidation cycle.

2. Idempotent composite bitmap setter.
   - `setCurrentCompositeBitmap(...)` in `layersSlice.ts` now no-ops when the incoming bitmap is the same instance already stored.
   - This avoids needless state churn and avoids recycling the same bitmap instance.

3. Idempotent recomposition setter.
   - `setLayersNeedRecomposition(true)` now no-ops when recomposition is already active and all static segments are already dirty.
   - It still dirties newly clean static segments when needed.

4. More robust stale bitmap detection.
   - `drawingCanvasCompositeStack.ts` now treats stale bitmap draw failures by `error.name === 'InvalidStateError'`.

Regression coverage added:

- `src/stores/__tests__/layersSlice.unit.test.ts`
  - same-bitmap set is a no-op
  - repeated recomposition requests do not remap already-dirty segments
  - recomposition still dirties newly clean segments
- `src/components/canvas/__tests__/drawingCanvasCompositeStack.test.ts`
  - stale composite bitmap draw failure returns `invalidCompositeBitmap === true`

Verification run after the local fix:

- `npm test -- --runTestsByPath src/stores/__tests__/layersSlice.unit.test.ts src/components/canvas/__tests__/drawingCanvasCompositeStack.test.ts`
- `npm run type-check`
- `npm run lint`

Status of this update:

- The root cause is now believed to be the composite bitmap invalidation loop, not the previously suspected live sampled preview scheduler alone.
- This update does not invalidate the earlier sampled-preview stabilization work; it narrows the remaining hang to the canvas composite renderer under the sampled CC shape flow.
- Runtime repro on the latest local branch is still the next verification step after this documentation update.

Related bug document:

- `docs/bugs/color-cycle-layer-clear-animation-loop-2026-04-24.md`
  - separate issue covering the old color-cycle layer clear / lingering animation-loop behavior
