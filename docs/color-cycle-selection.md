## Color-cycle selection/move/delete path

When a marquee selection is cut/moved on a color-cycle layer we must mutate the brush paint buffer **and** keep the live animator/compositor in sync. The flow is:

1) `captureSelectionBitmap` grabs RGB pixels and, for CC layers, a scalar `paintBuffer` slice via `captureColorCycleIndices`.
2) `writeColorCycleRegion` / `clearColorCycleRegion` call `mutateColorCycleLayer`, which:
   - Pulls the layer brush snapshot (`paintBuffer`) and copies it into a working buffer.
   - Applies region edits (clear or paste) on that buffer.
   - Calls `applyLayerSnapshot` on the brush, which now also pushes the buffer into the animator via `setIndexBufferFromArray` to keep renders in sync.
   - Renders into the layer canvas (or a fallback) and updates `colorCycleData` with that canvas and fresh `canvasImageData`.
   - Marks composites dirty (`setCurrentCompositeBitmap(null)`, `setLayersNeedRecomposition(true)`, `markCompositeSegmentsDirtyByLayerIds([layer.id])`) so the DrawingCanvas overlay re-renders immediately.

Key guardrails:
- Always persist the canvas used for mutation back onto `colorCycleData` so compositing reads the updated pixels.
- We pass `{ skipColorCycleSync: true }` to `updateLayer` inside these helpers to avoid redundant runtime sync loops; recomposition is driven via the dirty flags above.

Regression coverage:
- `src/stores/helpers/__tests__/colorCycleSelection.test.ts` asserts that CC paste/clear writes reach `applyLayerSnapshot`, that composites are invalidated, and that the canvas reference is preserved.
- `src/stores/helpers/__tests__/selectionPaste.test.ts` includes a CC paste case (intrinsic size vs scaled display) so that `writeColorCycleRegion` receives rounded positions and intrinsic dimensions; this guards against regressions when display scaling is introduced.
