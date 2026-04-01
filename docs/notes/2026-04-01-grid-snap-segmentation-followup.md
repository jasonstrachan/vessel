# Grid Snap Segmentation Follow-up

Status: speculative patches reverted on 2026-04-01.

Summary:
- Several experimental changes were tried to stop segmented rendering for normal brush strokes with `gridSnapEnabled === true`.
- Those experiments did not resolve the visible behavior in the live app and have been removed.

Reverted experiments:
- Pointer-layer gating to suppress `continueDrawing(...)` when the snapped cell did not change.
- Stroke-batching changes to force cell-step stamping instead of snapped segment interpolation.
- Brush-engine flags and renderer probes for `cellStepGridSnap`.
- Pointer-up release-cap removal and related test updates.
- Temporary debug logging under the `grid-snap-probe` scope.

Observed during debugging:
- Pointer-move probes showed many same-cell samples and occasional real snapped-cell transitions.
- Downstream brush-engine probes did not appear in the live reproduction path.
- That suggests the visible segmented stroke is likely not coming from the instrumented `pointerHandlers -> continueDrawing -> processBatchedStrokes -> useBrushEngineSimplified -> BrushEngineFacade` path.

Recommended next step:
- Trace the actual live render path from `DrawingCanvas` / canvas runtime composition to identify which code path paints the visible segmented stroke.
- Add a probe at the final compositing or overlay-preview draw site, not at the speculative brush-engine path.

Guardrail:
- Avoid stacking further behavior changes until the real live draw path is identified.
