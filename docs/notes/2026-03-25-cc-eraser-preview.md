# CC Eraser Preview Notes

Date: 2026-03-25

Problem:
- Erasure preview did not render on color-cycle layers during interaction.
- Repainting erased color-cycle pixels could leave regions effectively protected because the erase mask was not consistently cleared in all CC commit paths.

Root causes:
- The CC eraser strategy updated the authoritative erase mask, but the seeded overlay preview was not kept in sync.
- CC eraser begin did not apply an initial pointer-down stamp for color-cycle layers.
- The overlay renderer could suppress the overlay while CC animation was active, even when the overlay canvas contained a valid live preview.
- CC shape/gradient finalize did not clear the erase mask ROI after repaint.
- CC stroke finalize only cleared the erase mask when a fresh stroke bbox ROI existed; fallback capture ROI was not threaded through.

Fixes:
- `src/tools/strategies/CCMaskEraseStrategy.ts`
  - Mirror CC erase stamps into the preview overlay using `destination-out` while still writing to the erase mask.
- `src/tools/EraserTool.ts`
  - Apply an initial erase stamp on `begin()` for color-cycle layers so taps and first-frame preview render immediately.
- `src/components/canvas/drawingCanvasOverlay.ts`
  - Stop suppressing overlay rendering purely because color-cycle animation is active.
- `src/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit.ts`
  - Use fallback capture ROI to clear the erase mask even when no fresh stroke bbox ROI exists.
- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
  - Clear the erase mask inside the finalized ROI for CC shape/gradient fills.

Regression coverage:
- `src/tools/strategies/__tests__/CCMaskEraseStrategy.test.ts`
- `src/tools/__tests__/EraserTool.test.ts`
- `src/components/canvas/__tests__/drawingCanvasOverlay.test.ts`
- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleStrokeCommit.finalizeMask.test.ts`
- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.eraseMask.test.ts`

Validation:
- `npm run type-check`
- `npm run lint`
- Targeted Jest suites for overlay, eraser tool, CC mask strategy, and CC finalize mask paths
