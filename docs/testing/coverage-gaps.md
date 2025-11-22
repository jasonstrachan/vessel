# Coverage gaps (2025-11-22 snapshot)

Latest Jest coverage: **~31.67% statements** (15 879 / 50 129). Rerun `npm test -- --coverage` for fresh numbers.

## Highest-untested areas
- `src/hooks/useDrawingHandlers.ts` — stroke/shape orchestration remains largely uncovered.
- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` — CPU/GPU rendering branches untested.
- `src/components/canvas/DrawingCanvas.tsx` — render/event wiring only lightly covered.
- `src/utils/export/webglExporter.ts` — error/export variants still thin.
- `src/hooks/canvas/handlers/pointerHandlers.ts` — coverage improved via new harness; deep contour/selection/shape branches remain.

## Progress (recent)
- Added `__TESTING__` export plus utils test for contour debug + advanced brush detection (`pointerHandlers.utils.test.ts`).
- Added high-impact harness `pointerHandlers.main.test.ts` (16 flows: pan, recolor sampling, floating paste, coalesced moves, stroke finalize); suites pass.
- Dropped a noisy `useDrawingHandlers` integration harness attempt to keep the suite green.

## Next targets
- Lightweight `useDrawingHandlers` harness with a tight mocked store (stroke start/stop, history commit paths).
- `ColorCycleBrushCanvas2D` class-method tests (buffer lifecycle, CPU vs GPU parity, disposal/flush).
- `DrawingCanvas.tsx` RTL smoke for render/handler wiring and keyboard focus.
- `utils/export/webglExporter.ts` failure/option branches (minify/diagnostics toggles, cleanup).
- Remaining deep `pointerHandlers` branches (contour adjustment, selection/mask edge cases).
