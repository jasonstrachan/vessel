# Shape Fill Preview and Finalize Regression Plan

## Goal

Restore Shape Fill brush behavior end to end:

- the shape is visibly previewed while drawing,
- the adjustment phase keeps showing the generated fill,
- finalizing commits the visible fill to the active layer instead of clearing or losing it,
- the fix is covered by the same path users exercise in the app.

## Current Evidence

The reported symptom matches the dedicated Shape Fill session path, not just the new CC Gradient drawing-shape selector:

- Shape Fill enters through `ShapeToolHandlerRuntime.ts` and calls `beginShapeFillSession(...)` on pointer-up.
- During initial drag, Shape Fill currently calls `startShapeDrawing(..., { renderPreview: false })` and `continueShapeDrawing(..., { renderPreview: false })`, so it depends on the separate polygon overlay renderer for visibility while drawing.
- Adjustment rendering uses `renderShapeFillLiveResult(...)`, which draws generated fill output onto `drawingHandlers.drawingCanvas`; this explains why the fill can appear during adjustment even when the initial drawing preview is weak.
- Finalization uses `runShapeFillFinalize(...)`, which draws the final result to `drawingHandlers.drawingCanvas`, then either commits via `commitRasterOverlay(...)` for raster layers or falls back to `drawingHandlers.finalizeDrawing(...)` for missing/color-cycle active layers.
- Existing focused tests for the current CC Gradient shape work pass, but they do not prove the Shape Fill session path: `ccGradientDrawingGeometry.test.ts`, `shapeDrawing.finalizeResolution.test.ts`, and `ShapeToolHandler.ccDitherReplay.test.ts` all passed locally.

## Working Hypotheses

1. **Initial preview visibility is intentionally suppressed in the wrong place.** Shape Fill disables the normal `shapeDrawing.ts` preview and relies on the polygon overlay branch. That branch gives a low-alpha fill only after enough points exist, so drag feedback can be hard to see or absent for short/tiny shapes.

2. **Finalize can clear the only visible output before a layer commit succeeds.** `runShapeFillFinalize(...)` clears preview/session state and the drawing canvas after commit. If the active-layer branch falls through, has an invalid ROI, or uses the generic fallback incorrectly, the visible adjustment output disappears without durable layer pixels.

3. **Color-cycle active layers are an unhandled Shape Fill target.** The fallback path for `activeLayer.layerType === 'color-cycle'` delegates to generic `finalizeDrawing(...)`, but Shape Fill output is raster strategy output, not canonical Color Cycle shape paint. This path must be validated before `finalizeShapeFillSession()` mutates session state, then either blocked with user-visible feedback or implemented as a real CC-compatible commit strategy.

4. **The regression is under-tested because the saved CC Gradient plan marked manual shape/fill sanity complete without a targeted Shape Fill finalize test.** The current test suite covers nearby CC preview/finalize behavior, not Shape Fill begin -> adjust -> finalize -> layer pixel persistence.

## Investigation Checklist

- [ ] Reproduce in the browser on a normal raster layer with each Shape Fill strategy: hatch, contour, stipple, dashes, flow, sierra, noise, and delaunay.
- [ ] Repeat on a Color Cycle layer and record whether the app should block Shape Fill there or support a real CC-compatible commit.
- [ ] Add temporary on-screen/debug-overlay breadcrumbs for the Shape Fill path:
  - pointer-down start accepted,
  - pointer-move point count,
  - session stage,
  - `drawingCanvasHasContent`,
  - active layer id/type,
  - finalize branch chosen,
  - ROI dimensions,
  - commit result.
- [ ] Inspect layer pixels before and after finalize on the same active layer to prove whether the fill was never committed or was committed then overwritten by recomposition.
- [x] Check whether `commitRasterOverlay(...)` receives a non-empty overlay and a valid `beforeImage`/ROI for the failing case. The non-empty check must inspect `drawingHandlers.drawingCanvas` alpha/delta inside the ROI after lost-edge/transparency masking and before commit, not the post-seeded temp commit canvas.

## Fix Plan

## Target Architecture

Shape Fill should have one explicit workflow boundary instead of scattered preview/session/finalize logic inside `ShapeToolHandlerRuntime.ts`.

### Proposed Modules

- `src/hooks/canvas/handlers/shapes/shapeFill/shapeFillWorkflow.ts`
  - optional second-pass extraction only if pointer routing remains tangled after the finalize/preview modules land,
  - owns the high-level state machine for Shape Fill pointer events when extracted,
  - maps pointer-down/move/up/finalize into session actions,
  - returns typed outcomes instead of mutating unrelated canvas state directly.
- `src/hooks/canvas/handlers/shapes/shapeFill/shapeFillPreview.ts`
  - renders the drawing-outline preview and adjustment/live-result preview,
  - owns preview clearing rules,
  - never commits layer pixels or mutates store session state.
- `src/hooks/canvas/handlers/shapes/shapeFill/shapeFillFinalize.ts`
  - renders the final strategy output,
  - validates overlay content and target layer,
  - commits raster overlays and reports a typed finalize result.
- `src/hooks/canvas/handlers/shapes/shapeFill/shapeFillGeometry.ts`
  - keeps bounds, ROI, pixel-perfect polygon conversion, and non-empty overlay checks testable.

### Ownership Rules

- `ShapeToolHandlerRuntime.ts` should only route events to the Shape Fill workflow and handle UI-level side effects like feedback and redraw scheduling.
- The store slice remains the source of truth for Shape Fill session state: `beginShapeFillSession`, `commitShapeFillParameter`, `finalizeShapeFillSession`, and `cancelShapeFillSession`.
- Preview modules may draw to overlay/drawing canvases, but only finalize modules may persist pixels to layers.
- Finalize must validate the active target before calling `finalizeShapeFillSession()` and return a typed outcome:
  - `committed-raster`
  - `blocked-unsupported-layer`
  - `failed-empty-overlay`
  - `failed-missing-target`
  - `failed-invalid-project-size`
- Cleanup happens only after the outcome is known. No module should clear the drawing canvas as a side effect of "trying" to finalize.
- Generic `finalizeDrawing(...)` is not an accepted Shape Fill finalize fallback unless a focused regression test proves it persists the visible Shape Fill pixels on that exact target.

### Clean Dependency Shape

Use dependency objects instead of importing global app state throughout the new modules.

```ts
type ShapeFillWorkflowDeps = {
  getState: typeof getAppStoreState;
  drawing: ShapeFillDrawingSurface;
  preview: ShapeFillPreviewRenderer;
  finalize: ShapeFillFinalizer;
  feedback?: (message: string) => void;
  requestRedraw: () => void;
};
```

The workflow should be easy to unit test with fake canvases/store state, while one integration-style test covers the real Zustand mutations and commit path.

### Slice 1 - Preview While Drawing

- [x] Make Shape Fill drawing preview explicit instead of relying on the generic low-alpha polygon fallback.
- [x] Keep it lightweight: draw a high-contrast outline plus translucent fill while collecting points.
- [x] Keep the adjustment-phase generated fill preview on `drawingHandlers.drawingCanvas`; do not replace it with a placeholder.
- [x] Add a focused test or harness assertion that the Shape Fill pointer-move branch with `{ renderPreview: false }` schedules/renders the explicit Shape Fill preview once there are at least 3 points.
- [x] Extract this preview logic into `shapeFillPreview.ts` before changing behavior.

### Slice 2 - Finalize Commit Contract

- [x] Make `runShapeFillFinalize(...)` return a branch-specific result that distinguishes:
  - committed to raster layer,
  - blocked unsupported target,
  - failed because no active layer/canvas/ROI,
  - failed because project/layer dimensions are invalid.
- [x] Validate active layer id/type and project dimensions before `finalizeShapeFillSession()` so unsupported targets do not mutate or persist the Shape Fill session.
- [x] Do not clear `drawingHandlers.drawingCanvas` or cancel the session until a real commit path has succeeded or an intentional cancel/block path has run.
- [x] For raster layers, assert the overlay has non-transparent pixels inside the commit ROI before `commitRasterOverlay(...)`.
- [x] For Color Cycle layers, choose one behavior:
  - preferred short-term: block with feedback and keep/cancel cleanly without pretending finalization succeeded,
  - later only if required: implement a canonical CC-compatible Shape Fill commit path.
- [x] Extract final commit logic into `shapeFillFinalize.ts`; leave `ShapeToolHandlerRuntime.ts` as the caller.

### Slice 3 - Recomposition and History

- [x] After raster commit, force recomposition from the updated layer, not from a stale pre-commit composite.
- [x] Preserve the existing history transaction shape: session lifecycle history closes before the layer fill history entry.
- [x] Keep ROI coalescing only when `shapeFillHistoryContext.layerId` still matches the active layer.
- [x] Keep history/coalescing inputs explicit in the finalize result instead of reading hidden mutable context after commit.
- [x] Do not treat `commitRasterOverlay(...)` success as proof that Shape Fill pixels were committed; the overlay-alpha/delta check must pass before commit because the commit helper seeds from the existing layer.

### Slice 4 - Regression Coverage

- [x] Add a Shape Fill finalize regression test that builds a session, renders a fill, finalizes, and asserts active-layer pixels changed.
- [x] Add a failure test for unsupported Color Cycle target behavior once the expected product behavior is chosen.
- [x] Add a preview test for the draw phase so future changes cannot silently suppress the initial preview again, specifically covering the Shape Fill start/continue path that disables generic shape preview rendering.
- [x] Keep existing CC Gradient drawing-shape tests green; this fix must not regress the work currently in the dirty tree.
- [x] Add module-level tests for `shapeFillGeometry.ts` and `shapeFillFinalize.ts` before relying on browser sanity.

## Implementation Order

1. [x] Extract `shapeFillGeometry.ts` for ROI, pixel-perfect polygon bounds, and non-empty overlay alpha/delta checks.
2. [x] Extract `shapeFillFinalize.ts` around the raster commit contract, with target validation before session finalization.
3. [x] Add/adjust the preview renderer in `shapeFillPreview.ts` for the draw phase path currently passing `{ renderPreview: false }`.
4. [ ] Only extract `shapeFillWorkflow.ts` if the remaining pointer-down/move/up routing still needs a separate state-machine boundary after the targeted fixes land. Deferred: the targeted modules landed and `ShapeToolHandlerRuntime.ts` shrank, so a broader workflow extraction is not required for this regression.

## Validation

Minimum automated checks:

- `npm test -- src/stores/__tests__/useAppStore.shapeFillCancellation.test.ts src/stores/__tests__/historyIntegration.test.ts`
- focused new Shape Fill preview/finalize tests
- existing nearby CC tests:
  - `src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.ccDitherReplay.test.ts`
  - `src/hooks/canvas/handlers/shapes/__tests__/shapeDrawing.finalizeResolution.test.ts`
- `npm run type-check`
- `npm run lint`

Manual browser sanity:

1. Select a normal raster layer.
2. Select Shape Fill.
3. Draw a polygon/shape and confirm drawing preview is visible before pointer-up.
4. Adjust the live parameter and confirm the generated fill remains visible.
5. Finalize and confirm the pixels remain on the layer after recomposition, undo, redo, save, and reload.
6. Repeat with a Color Cycle layer and verify the chosen block/support behavior is clear and non-destructive.

## Guardrails

- Do not change dither algorithms or inject noise to hide the issue.
- Do not route Shape Fill final output through CC Gradient shape-fill code unless the output is intentionally converted into canonical Color Cycle paint.
- Do not clear previews/canvases before commit success is known.
- Keep changes in `ShapeToolHandlerRuntime.ts` small; extract testable helper logic if the fix grows.
