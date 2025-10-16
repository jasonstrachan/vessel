# Stroke Finalization Optimizations

Goal: reduce the handshake time between ending one stroke and starting the next without breaking undo/redo fidelity.

## Current Pain Point
- `finalizeDrawing` sets `isBusyRef.current = true`, captures the entire canvas via `captureCanvasToActiveLayer`, then commits history.
- Pointer-down checks `isBusyRef`. While the flag stays true, the next stroke stalls.
- `captureCanvasToActiveLayer` copies every project pixel on each stroke, allocates fresh `ImageData`, and synchronously updates layer history.

## Recommended Phased Plan

1. **Trim the Busy Window (done)**
   - Keep `isBusyRef` only around the actual pixel capture so history bookkeeping can happen while input unlocks.

2. **Reuse Capture Buffers**
   - In `captureCanvasToActiveLayer`, cache a per-layer `Uint8ClampedArray`/`ImageData`.
   - Copy into the reusable buffer instead of allocating new 12 M-pixel arrays every stroke.
   - Expected win: less GC churn, faster repeated strokes.

3. **Defer History Bookkeeping**
   - After capture completes, queue `commitLayerHistory` via `queueMicrotask`/`requestIdleCallback`.
   - Maintain an in-memory queue so undo entries still apply in order; flush on visibility change/unload.
   - Perceived result: next stroke can start while history metadata finishes.

4. **Instrumentation Before Big Refactors**
   - Log bounding-box sizes for each stroke and capture duration inside `captureCanvasToActiveLayer`.
   - Use the data to decide whether partial captures are worth the complexity.

5. **Optional: Dirty-Rect Captures**
   - If metrics show small stroke footprints dominate, evolve capture/history to store dirty regions instead of the full frame.
   - Requires teaching history/composition/autosave to merge partial updates.

6. **Optional: Off-Thread Capture**
   - Transfer the overlay into an `OffscreenCanvas` and clone pixels in a worker.
   - UI thread releases `isBusyRef` immediately; worker posts back when data is ready for history.

## Key Files
- `src/hooks/useDrawingHandlers.ts` – stroke finalization, busy flag timing.
- `src/stores/useAppStore.ts` – `captureCanvasToActiveLayer` implementation.
- `src/hooks/canvas/handlers/pointerHandlers.ts` – pointer down/up gating on `isBusyRef`.
- `src/history/helpers/layerHistory.ts` – undo payload handling (needs updates for deferred or partial history).

## Next Steps
1. Implement buffer reuse in `captureCanvasToActiveLayer`.
2. Queue history commits outside the busy window.
3. Add capture metrics to guide further optimization efforts.

