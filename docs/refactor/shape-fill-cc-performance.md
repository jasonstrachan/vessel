## Shape Fill & Color-Cycle Performance Review

Context: previewing and finalizing shape fills on color-cycle layers has become sluggish. Inspection focused on the hot paths in `ShapeToolHandler`, `useDrawingHandlers`, history capture, and the color-cycle runtime sync helpers.

### 1. Preview redraw clears full canvas every frame

- *File*: `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts:309-349`
- *Issue*: `drawShapeFillPreview` runs `strategy.apply(...)` and then `drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)` on the full project-sized canvas for every pointer move. On large canvases this is millions of pixels per frame even when only a small region changed.
- *Recommendation*: Limit redraw to the dirty region (compute bounds from `renderFill`), memoize the last strategy result per param value, or offload the fill computation to a worker so the UI thread just blits a cached bitmap.

### 2. Finalization does deep history capture on hot path

- *Files*: `src/hooks/useDrawingHandlers.ts:2108-2127`, `src/stores/useAppStore.ts:4386-4668`
- *Issue*: The CC shape commit path calls `saveCanvasState(...)`, which deep-clones every layer and often triggers a `getImageData` on a full-size canvas. Even with the 1×1 fast-path, cloning large layer arrays blocks the main thread.
- *Recommendation*: For color-cycle fills, store the serialized animator/index buffers you already collect (as in crop) or defer the heavy snapshot to `requestIdleCallback`. A lightweight history entry per fill will keep finalization responsive.

### 3. Forced composite during finalize

- *File*: `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts:333-343`
- *Issue*: `finalizeShapeFillResult` calls `compositeLayersToCanvas` immediately, which walks every layer, toggles brush playback, and forces `brush.updateAnimation()` in the middle of the finalize gesture.
- *Recommendation*: Flag `layersNeedRecomposition` and let the compositor handle it on the next render loop, or throttle the composite to run after the interaction finishes (e.g., `requestAnimationFrame`).

### 4. Color-cycle runtime sync churn

- *File*: `src/stores/ccRuntime.ts`
- *Issue*: `syncCCRuntimes` is invoked for every `updateLayer`/`setActiveLayer` and unconditionally restarts animation (`startAnimation`) whenever `isAnimating` is true, then fires `cc:request-start-raf`. During preview/finalize we patch layer props frequently, so the animation loop keeps restarting even if state did not change.
- *Recommendation*: Track the last synced gradient/speed/animation state per layer, skip no-op updates, and avoid dispatching RAF start events unless we transition from stopped → playing.

Addressing the top two items should deliver the largest win; the latter two will further smooth interactions once the heavy work has been trimmed.
