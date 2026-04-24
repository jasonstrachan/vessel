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

---

Update: 2026-04-24 13:23 AEST

Latest user-provided reload evidence:

- The tab hung again and recovered/reloaded.
- The recovered report showed:
  - `message: "Recovered after event-loop lag spike"`
  - `gapMs: 58998`
  - `breadcrumbs: 0`
- The console stack still showed React scheduler churn after recovery.

What this newly proved:

- The existing sampled-shape breadcrumbs were not being persisted in the local production-style repro bundle.
- The app was running hashed production chunks on `localhost`, so `process.env.NODE_ENV === 'production'`.
- `recordBreadcrumb(...)` was still dev-gated, so sampled-shape and renderer breadcrumbs were silently dropped even though `GlobalErrorHooks` persisted the hang report.

What landed from this update:

1. Local production repros now persist runtime breadcrumbs.
   - `recordBreadcrumb(...)` now runs in dev and on local hosts (`localhost` / `127.0.0.1`).
   - This keeps deployed production hosts quiet while making `npm run preview:prod:watch` style repros useful.

2. Lag and long-task runtime posts now include breadcrumbs.
   - Heartbeat posts stay lean.
   - Crash, lag, and long-task reports now carry the same persisted breadcrumb context.

3. Composite bitmap invalidation now verifies store ownership before requesting recomposition.
   - The renderer still records the invalid bitmap event.
   - It only clears/recomposes if `state.currentCompositeBitmap` is still the same bitmap instance that failed to draw.
   - This prevents a stale React prop from re-dirtying recomposition after the store has already moved on.

4. Regression coverage was added for:
   - local breadcrumb persistence
   - the composite invalidation ownership guard

Status:

- The previous empty-breadcrumb report is now explained and fixed.
- The composite invalidation loop guard is stricter, but the latest runtime repro still needs to be repeated against this patch.
- If the hang happens again after this update, the next `[previous-hang]` / `[recovered-hang]` report should include persisted breadcrumbs rather than `breadcrumbs: 0`.

---

Update: 2026-04-24 13:52 AEST

Latest useful breadcrumb capture after rebuilding the production preview bundle:

- `TB_BREADCRUMBS` reached the 200-entry cap.
- Event counts were:
  - `sampled-worker-begin`: 46
  - `sampled-stops-ready`: 47
  - `sampled-fill-end`: 47
  - `sampled-publish`: 47
  - `sampled-preview-dispatch`: 6
  - `preview-frame-start`: 3
  - `finalize-begin`: 1
  - `client-runtime-longtask`: 3
- The preview worker path was completing:
  - recent `sampled-fill-end` entries reported `durationMs` around `1-2`.
  - preview point counts were bounded around `128-137`.
- The last sampled-shape breadcrumb before runtime long tasks was:
  - `event: "finalize-begin"`
  - `pointCount: 4500`
  - `source: "sampled"`
- There was no `finalize-end` breadcrumb in the captured tail.

What this newly proved:

- The live sampled preview worker was not the immediate stuck point in this capture.
- The hang moved into sampled shape finalize after the full raw polygon was handed off.
- The raw finalize geometry was still large (`4500` points), while preview geometry stayed bounded (`~137` points).

Root cause found in finalize:

- The linear fallback direction calculation used an O(n^2) farthest-pair scan over every finalize point.
- With `4500` points, that means about 20 million pair-distance checks before the color-cycle shape fill can even start.
- This explains the breadcrumb pattern:
  - `finalize-begin`
  - no fill-stage breadcrumbs
  - later `client-runtime-longtask`

What landed:

- `computeFallbackLinearDirection(...)` now computes the same farthest-pair direction through:
  - finite-point filtering
  - monotonic-chain convex hull
  - rotating-calipers farthest-pair search
- The full shape polygon is still passed to the committed fill.
- This does not cap or simplify finalize geometry, so committed shape fidelity is preserved.
- Regression coverage now compares the new direction helper against the old brute-force result and covers a 5000-point sampled-drag-style polygon.

Verification:

- `npm test -- --runTestsByPath src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.direction.test.ts src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.transparencyLock.test.ts src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm run preview:prod:build`

Status:

- `localhost:3001` has been rebuilt with the finalize-direction fix.
- The next runtime check is to hard-reload `http://localhost:3001/` and repeat the sampled shape repro.
- If it still hangs, the next breadcrumb tail should show whether the stall moved from direction calculation into fill, commit, sampled persist, or composite redraw.

Related bug document:

- `docs/bugs/color-cycle-layer-clear-animation-loop-2026-04-24.md`
  - separate issue covering the old color-cycle layer clear / lingering animation-loop behavior

---

Update: 2026-04-24 14:20 AEST

Added a temporary persisted finalize phase recorder for the next runtime repro.

What changed:

- `runColorCycleShapeFill(...)` now writes `TB_LAST_PHASE` at:
  - `finalize:begin`
  - `finalize:before-direction`
  - `finalize:after-direction`
- Linear and concentric finalize now write `TB_LAST_PHASE` around:
  - sampled render-session resolution
  - fill call and completion
  - committed-state commit
  - sampled slot persist
  - finalize end
- The recorder writes one localStorage key only and does not emit console logs.
- The payload includes the phase, timestamp, mode, point count, layer id, source, and binding slot when available.

Repro dump after reload:

```js
JSON.parse(localStorage.getItem('TB_LAST_PHASE') || 'null')
```

Verification:

- `npm test -- colorCycleShapeFill.direction.test.ts`
- `npm test -- src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm run preview:prod:build`

Status:

- This is diagnostic-only instrumentation, not another behavioral fix.
- `localhost:3001` has been rebuilt with the `TB_LAST_PHASE` recorder.
- Remove it after the next repro identifies the stuck synchronous finalize substep, or reduce it back into normal breadcrumb-only diagnostics if the signal is useful.

---

Update: 2026-04-24 15:05 AEST

Latest local production repro with `TB_LAST_PHASE`:

- The tab recovered from another hang.
- `TB_LAST_PHASE` was:
  - `phase: "finalize:before-fill"`
  - `mode: "linear"`
  - `pointCount: 374`
  - `source: "sampled"`
  - `bindingSlot: 77`
- This proves the current remaining stall is inside the actual linear fill call, after sampled-session resolution and before the fill returns.

Root cause narrowed in fill:

- The sampled linear final fill goes through `fillCcGradientDither(...)`.
- That utility already yielded during the final pixel-write pass, but it did not yield during earlier scanline/grid preparation work.
- The `levels === 1` flat-pattern branch also delegated to synchronous flat pattern fill loops.
- Large sampled final fills could therefore still monopolize the main thread while `TB_LAST_PHASE` remained `finalize:before-fill`.

What landed:

- `fillCcGradientDither(...)` now cooperatively yields during:
  - scanline span construction
  - active-cell coverage construction
  - pair-band/error-diffusion cell passes
  - whole-cell edge writes
- `fillFlatPatternMode(...)` is now async and accepts `yieldIfNeeded`, so the flat sampled Sierra-Lite branch can also yield row-by-row.
- Pixel output is preserved; this only changes scheduling of long CPU fill work.
- Regression coverage now verifies the dither fill yields before first pixel write.

Verification:

- `npm test -- src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
- `npm test -- colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm run preview:prod:build`

Status:

- `localhost:3001` has been rebuilt with the fill-yield fix.

---

Update: 2026-04-24 15:23 AEST

Latest local production repro after the fill-yield attempt:

- The tab still recovered from a hang.
- `TB_LAST_PHASE` was still:
  - `phase: "finalize:before-fill"`
  - `mode: "linear"`
  - `pointCount: 950`
  - `source: "sampled"`
  - `bindingSlot: 3`

What this proved:

- The cooperative-yield fill patch did not fix the observed sampled finalize hang.
- The failed attempt was backed out from:
  - `src/utils/colorCycle/ccGradientDither.ts`
  - `src/utils/colorCycle/ccFlatModePatterns.ts`
  - `src/utils/colorCycle/__tests__/ccGradientDither.test.ts`

Status:

- Keep the diagnostics and direction O(n^2) fix.
- Do not stack more fill-path patches without a narrower internal fill-phase trace.

---

Update: 2026-04-24 15:38 AEST

Added a narrower temporary linear fill phase recorder after the failed fill-yield attempt was backed out.

What changed:

- `ColorCycleBrushCanvas2D.fillShapeLinear(...)` now writes `TB_LAST_FILL_PHASE`.
- The recorder stamps setup and sampled dither branch boundaries:
  - `fill:begin`
  - `fill:after-stroke-data`
  - `fill:before-ensure-full-resolution`
  - `fill:after-ensure-full-resolution`
  - `fill:before-bounds`
  - `fill:after-bounds`
  - `fill:before-bbox-snapshot`
  - `fill:after-bbox-snapshot`
  - `fill:before-gpu`
  - `fill:after-gpu`
  - `fill:before-direct-fill`
  - `fill:after-direct-fill`
  - `fill:before-dither`
  - `fill:after-dither`
  - `fill:before-render`
  - `fill:after-render`
  - `fill:end`
- This is diagnostic-only and writes one localStorage key without console spam.

Repro dump after reload:

```js
JSON.parse(localStorage.getItem('TB_LAST_FILL_PHASE') || 'null')
```

Verification:

- `npm test -- colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm run preview:prod:build`

Status:

- `localhost:3001` has been rebuilt with `TB_LAST_FILL_PHASE`.

---

Update: 2026-04-24 later prod repro

Latest local production repro after adding `TB_LAST_FILL_PHASE`:

- The tab still recovered from a hang.
- `TB_LAST_FILL_PHASE` was:
  - `phase: "fill:before-dither"`
  - `pointCount: 380`
  - `source: "sampled"`
  - `bindingSlot: 97`
  - `bbox: { minX: 186, minY: 455, width: 168, height: 246 }`
  - `pixelSize: 7`
  - `quantLevels: 2`
  - `pairBandCount: 0`
  - `sampledStopCount: 2`
  - `algorithm: "sierra-lite"`

What this proved:

- Linear fill setup completed.
- Full-resolution canvas setup completed.
- Bounds and bbox snapshot completed.
- GPU attempt and direct-fill allocation completed.
- The remaining stall is inside `fillCcGradientDither(...)`, before it returns.

Added the next temporary persisted recorder:

- `fillCcGradientDither(...)` now writes `TB_LAST_DITHER_PHASE`.
- The recorder stamps:
  - `dither:begin`
  - `dither:before-spans`
  - `dither:after-spans`
  - `dither:before-coverage`
  - `dither:after-coverage`
  - `dither:before-index-solve`
  - `dither:after-index-solve`
  - `dither:before-write`
  - `dither:after-write`
  - `dither:end`
- This is diagnostic-only and writes one localStorage key without console spam.

Repro dump after reload:

```js
JSON.parse(localStorage.getItem('TB_LAST_DITHER_PHASE') || 'null')
```

Verification:

- `npm test -- src/utils/colorCycle/__tests__/ccGradientDither.test.ts colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`

Status:

- `localhost:3001` has been rebuilt with `TB_LAST_DITHER_PHASE`.

---

Update: 2026-04-24 write-pass repro

Latest local production repro with `TB_LAST_DITHER_PHASE`:

- The tab still recovered from a hang.
- `TB_LAST_DITHER_PHASE` was:
  - `phase: "dither:before-write"`
  - `pointCount: 1173`
  - `bbox: { minX: 439, minY: 67, width: 523, height: 178 }`
  - `gridW: 131`
  - `gridH: 45`
  - `cellSize: 4`
  - `levels: 2`
  - `pairBandCount: 0`
  - `algorithm: "sierra-lite"`
  - `patternStyle: "dots"`
  - `sampledFlatTraceStage: "brush-linear"`
  - `sampledStopCount: 2`
  - `pxlEdge: true`
  - `useWholeEdgeCells: true`
  - `wholeEdgeCells: true`
  - `activeRowCount: 45`
  - `activeCellCount: 2788`

What this proved:

- Dither span generation completed.
- Active-cell coverage completed.
- Sierra-Lite index solving completed.
- The remaining stall is in the whole-cell edge pixel write pass.

Added narrower temporary write-pass stamps to `TB_LAST_DITHER_PHASE`:

- `dither:write-row`
- `dither:write-progress`
- `dither:before-write-callback`
- `dither:after-write-callback`

These stamps are sampled and diagnostic-only. They are intended to show whether
the write pass stalls before a row yield, during row traversal, or inside the
per-pixel write callback.

Repro dump after reload remains:

```js
JSON.parse(localStorage.getItem('TB_LAST_DITHER_PHASE') || 'null')
```

Verification:

- `npm test -- src/utils/colorCycle/__tests__/ccGradientDither.test.ts colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`

Status:

- `localhost:3001` has been rebuilt with the sampled write-pass stamps.

---

Update: 2026-04-24 broader write trace

The single last-phase recorder was still forcing repeated repros. Added a
broader persisted trace around the sampled dither write path.

What changed:

- `TB_LAST_DITHER_PHASE` still records the last observed dither phase.
- New `TB_DITHER_TRACE` stores the last 80 sampled dither events.
- The trace now includes:
  - row write entry
  - yield entry and exit
  - write progress
  - write callback entry and exit
  - normalized sample entry and exit
  - phase-byte resolve entry and exit
  - index-buffer write entry and exit
  - phase-buffer write entry and exit

This remains diagnostic-only. It is intended to make the next repro decisive
without another one-phase-at-a-time cycle.

Repro dump after reload:

```js
JSON.parse(localStorage.getItem('TB_LAST_DITHER_PHASE') || 'null')
JSON.parse(localStorage.getItem('TB_DITHER_TRACE') || '[]').slice(-80)
```

Verification:

- `npm test -- src/utils/colorCycle/__tests__/ccGradientDither.test.ts colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`

Status:

- `localhost:3001` has been rebuilt with the broader write trace.

---

Update: 2026-04-24 yield-boundary fix

Latest local production repro with `TB_DITHER_TRACE`:

- The tab still recovered from a hang.
- `TB_LAST_DITHER_PHASE` was:
  - `phase: "dither:before-yield"`
  - `pointCount: 2639`
  - `bbox: { minX: 264, minY: 57, width: 564, height: 435 }`
  - `gridW: 141`
  - `gridH: 109`
  - `cellSize: 4`
  - `levels: 2`
  - `pairBandCount: 0`
  - `algorithm: "sierra-lite"`
  - `pxlEdge: true`
  - `useWholeEdgeCells: true`
  - `activeRowCount: 109`
  - `activeCellCount: 6426`
  - `cy: 32`
  - `y: 185`
  - `yieldIteration: 128`
  - `writeCount: 13952`
- The trace showed normal progress through:
  - `dither:write-row`
  - `dither:before-yield`
  - `dither:after-yield`
  - sampled `dither:write-progress`
  - `dither:before-write-callback`
  - `dither:after-sample-normalized`
  - `dither:after-resolve-phase`
  - `dither:after-write-index`
  - `dither:after-write-phase`
  - `dither:after-write-callback`
- The final saved phase stopped at the next `dither:before-yield`.

What this proved:

- The sampled dither math completed.
- The per-pixel write callback completed for sampled points.
- The stall was at the cooperative yield boundary during the finalize write pass.
- Yielding during this critical finalize pass can hand control back while
  color-cycle buffers are partially populated.

What changed:

- `fillCcGradientDither(...)` no longer awaits `yieldIfNeeded(...)` during the
  final pixel write pass.
- The write pass stays synchronous/atomic for committed fill output.
- Geometry, sampled stops, dithering, pixel size, and full preview fidelity are
  unchanged.
- Added regression coverage proving that a provided `yieldIfNeeded` callback is
  not called during the dither final write pass.

Verification:

- `npm test -- src/utils/colorCycle/__tests__/ccGradientDither.test.ts colorCycleShapeFill.direction.test.ts src/utils/__tests__/debug.test.ts src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
- `npm run type-check`
- `npm run lint`

Status:

- `localhost:3001` has been rebuilt with the yield-boundary fix.

---

Update: 2026-04-24 cleanup for commit

Temporary localStorage recorders were removed after the production repro stopped
reproducing with the yield-boundary fix:

- `TB_LAST_PHASE`
- `TB_LAST_FILL_PHASE`
- `TB_LAST_DITHER_PHASE`
- `TB_DITHER_TRACE`

The retained code changes are:

- Replace the sampled linear fallback direction O(n^2) scan with convex hull
  plus rotating calipers.
- Keep the final dither write pass synchronous/atomic by not yielding inside it.
- Keep normal runtime breadcrumb plumbing for future recoverable hang evidence.

Status:

- User could no longer reproduce the hang after repeated local production tries.
- If the hang returns, reintroduce probes at the final dither write boundary
  first, because that was the last confirmed choke point.
