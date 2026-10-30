# Strokes disappearing after a selection click

A single click with the Selection tool, or a marquee drag with no width or height,
left both selection endpoints in the store. This had no visible marquee. The live
raster overlay skipped clipping the empty rectangle, while the layer commit tested
every stroke pixel against it and rejected all of them. Undo could remove the
selection transaction and make painting work again.

The selection state contract now represents empty or non-finite rectangle bounds
as no selection. `setSelectionBounds` uses the same normalization as selection
history snapshots, so undo/redo cannot reintroduce an empty rectangle. Positive-area
rectangles, reversed drags, and explicit masks retain their clipping behavior.
The gesture's pointer origin remains in the interaction ref, so an initial click
can still develop into a valid marquee drag.

Owners:

- `src/history/selectionState.ts`: shared selection normalization and replay input.
- `src/stores/slices/selectionSlice.ts`: selection bounds admission.
- `src/stores/__tests__/selectionCommands.history.test.ts`: empty/invalid bounds,
  subsequent paint, valid clipping, and replay regressions.

Production-preview reproduction:

1. Add a regular layer and select the Selection tool.
2. Click the canvas without dragging; switch to Pixel and draw a line elsewhere.
3. Before the repair, the line was black while held, then became the canvas
   background on release; committed layer coverage was zero.
4. After the repair, the click leaves no selection and the line remains after
   release. Also check horizontal/vertical zero-area drags, a valid rectangle,
   Shift-add, Escape, undo/redo, and switching layers before drawing.

A second preview path bypassed valid selection clipping when an adjustment layer
was visible. `drawingCanvasAdjustmentStack.ts` now sends additive live paint
through the same selection-aware overlay renderer as the ordinary canvas, in
project coordinates before adjustments. The committed layer source remains
unclipped. Its compositor tests cover rectangle and mask selection scopes.

Verification on the repaired production preview passed native click, horizontal
and vertical empty-marquee gestures, valid selection painting and clipping,
Escape, undo/redo, and adjustment-layer previews with rectangle and Magic Wand
mask selections. Each formerly lost stroke retained 6,300 painted pixels after
release. The focused checks passed 493 tests across 12 suites; type-check, lint,
and the production build passed. The repeatable browser check and its result are
in `output/playwright/stroke-persistence-zero-selection-check.js` and
`output/playwright/stroke-persistence-zero-selection-after.log`.
