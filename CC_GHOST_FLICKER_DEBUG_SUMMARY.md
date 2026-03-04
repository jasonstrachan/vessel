# CC Shape Ghost/Flicker Debug Summary

## Problem Statement
- Primary issue: Color-cycle (CC) shape finalize had visible flicker (shape briefly disappears/reappears).
- Secondary issue introduced during fixes: post-finalize ghost/floating copy appears on zoom until next shape interaction.

## Files Touched During Investigation
- `src/hooks/canvas/handlers/pointerHandlers.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
- `src/hooks/canvas/handlers/shapes/shapeDrawing.ts`
- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
- `src/hooks/canvas/handlers/wheelHandlers.ts`

## Attempt Log (What Was Tried)

1. Pointer-up pre-clear / prewrite behavior changes
- Change:
  - Removed pointer-up prewrite of CC preview cache into committed CC layer canvas.
  - Gated pointer-up overlay clear for shape-routed flows.
- Goal: prevent pre-finalize visual drop causing flicker.
- Result: mixed; did not produce stable final fix.

2. CC finalize sequencing changes in `colorCycleShapeFill.ts`
- Change:
  - Reordered overlay handoff relative to frame update.
  - Changed deferred save from awaited to fire-and-forget.
- Goal: reduce long visible-finalize stalls and frame timing artifacts.
- Result: did not fully resolve flicker/ghost pair.

3. Shape finalize state timing changes
- Change:
  - Moved some `DRAWING_END`/cleanup timing to `finalizePromise.finally(...)`.
  - Adjusted preview clear paths for CC finalize.
- Goal: avoid teardown before async finalize completes.
- Result: unstable tradeoff; symptom moved between flicker and ghost.

4. Transform normalization for cached CC preview draws (`ShapeToolHandler.ts`)
- Change:
  - Added shared helper for cached preview draws.
  - Normalized transform/clear/draw paths to avoid inconsistent scaling/translation.
- Goal: fix zoom drift/floating behavior caused by inconsistent transforms.
- Result: improved one class of drift behavior but did not eliminate ghost in all flows.

5. `pxlEdge` propagation to CC dither preview
- Change:
  - Passed `pxlEdge` into CC dither preview fill path.
- Goal: fix edge-color mismatch with pixel-edge mode.
- Result: addressed edge-consistency concern in preview path, but not the ghost/flicker core race.

6. Cancel/abort in-flight async CC preview jobs
- Change:
  - Added sequence/state guard before async preview job paints.
  - Released temp canvas and aborted paint when stale or not actively drawing.
- Goal: prevent late async preview repaint after finalize.
- Result: partial; reduced one repaint race but did not fully remove ghost in user repro.

7. Finalize-owner handoff delay in `shapeDrawing.ts`
- Change:
  - After CC finalize, waited one animation frame, then cleared preview overlay.
- Goal: avoid early clear flicker while still clearing preview eventually.
- Result: did not reliably solve both symptoms simultaneously.

8. Zoom-time hard clears (`wheelHandlers.ts`)
- Change:
  - On wheel zoom (CC shape mode, not drawing), cleared overlay canvas.
  - Then expanded to also clear `drawingCanvasRef`, mark `drawingCanvasHasContent=false`, clear preview cache.
- Goal: force-remove ghost during zoom.
- Result: still not reliable for reported repro.

## Net Assessment
- The bug behaves like a render ownership/handoff race between:
  1) preview surfaces/caches (overlay + drawing preview), and
  2) finalized color-cycle layer render/update timing.
- Multiple tactical patches moved symptoms between flicker and ghost.
- No attempt produced a robust dual fix in this session.

## Rollback Decision
Per request, all code modifications from this debug sequence are rolled back.

