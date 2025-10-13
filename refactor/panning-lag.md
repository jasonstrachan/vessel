# Panning Lag Investigation

## Findings
- `useSimplePan` (src/hooks/useSimplePan.ts:15-55) stores offsets in React state, so every pointer move triggers `setPanState`, forcing `DrawingCanvas` and downstream consumers to re-render each frame.
- `DrawingCanvas` syncs those offsets back into Zustand inside an effect (src/components/canvas/DrawingCanvas.tsx:559-597). Updating the full `canvas` slice wakes subscribers such as `BrushEditorUI` on every pan frame.
- The redraw effect (src/components/canvas/DrawingCanvas.tsx:2288-2301) depends on `pan.panState.offsetX/offsetY`, so even with a guard for the `PANNING` mode the dependency changes still churn effect bookkeeping each frame.
- Pointer move handlers also call `setMousePosition` every event (`src/hooks/canvas/handlers/pointerHandlers.ts:1774-1819` combined with `DrawingCanvas.tsx:193-207`), causing a second React update on the hot path.

## Refactor Recommendations
1. Rework `useSimplePan` to keep offsets in refs (or an internal store via `useSyncExternalStore`). Expose a subscription hook or `MutableRefObject` so consumers read live values without React re-renders; keep `isPanning` in state if UI feedback needs it.
2. Defer syncing offsets into `useAppStore`. Either batch through `requestAnimationFrame`/`endPan`, or write into the store only when offsets actually change outside active drags, while continuing to apply immediate visual updates via `viewTransformRef`.
3. Introduce a focused `useCanvasTransform` selector that returns memoized `{ scale, offset }`, and update components like `BrushEditorUI` to depend on it instead of the entire `canvas` object to minimize downstream re-rendering.
4. Route cursor position through a mutable ref and throttle any React state updates tied to it. `BrushCursor` can read from the ref (or subscribe separately) so pan gestures don't double-trigger React updates per frame.
