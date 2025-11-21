# Coverage gaps (2025-11-20 snapshot)

Source: `coverage/coverage-final.json` from the latest Jest run. Overall statement coverage is **3.19%** (1 601 / 50 162 statements). Numbers below are based on simple hit-count parsing: total statements vs. statements executed at least once.

## Highest-untested files (by uncovered statements)
- `src/hooks/useDrawingHandlers.ts` — 4% (121 / 2 929); pointer + gesture orchestration untouched.
- `src/hooks/canvas/handlers/pointerHandlers.ts` — 11% (181 / 1 632); low-level pointer routing lacks coverage.
- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` — 27% (502 / 1 894); GPU/CPU path parity untested.
- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts` — 8% (119 / 1 491); shape preview/commit logic uncovered.
- `src/hooks/useBrushEngineSimplified.ts` — 3% (41 / 1 392); core stroke pipeline not exercised.
- `src/components/modals/ExportModal.tsx` — 0% (0 / 912); export UX flow untested.
- `src/components/canvas/DrawingCanvas.tsx` — 41% (618 / 1 515); render loop/event wiring partially covered only via indirect tests.
- `src/components/modals/LoadProjectModal.tsx` — 0% (0 / 697); load/import flow untested.
- `src/utils/export/webglExporter.ts` — 51% (707 / 1 395); happy-path only, no error/export variants.
- `src/utils/projectIO.ts` — 8% (50 / 610); save/load/metadata handling lacks coverage.

## Thematic gaps and suggested tests
- **Input & canvas interaction**
  - Files: `useDrawingHandlers`, `pointerHandlers`, `ShapeToolHandler`, `useCanvasStateMachine` (0%), `useBrushEngineSimplified`, `brushEngine/shapes.ts`.
  - Add RTL + canvas-mocked integration tests that simulate down/move/up with pressure, multi-button pan, and shape drag/commit to cover branchy guardrails (tool gating, selection overrides, panning precedence).
  - Add unit tests for shape helper paths (preview vs. finalize) and pointer capture loss to lock re-entrancy bugs.

- **Brush/color-cycle rendering**
  - Files: `ColorCycleBrushCanvas2D` (27%), `ColorCycleBrush2D` (0%), `ColorCycleBrushPath2D` (0%), `ColorCycleBrushOptimized` (0%), `lib/colorCycle/rendering/WebGLColorCycleRenderer.ts` (4%), `lib/ColorCycleAnimator.ts` (25%).
  - Create golden-image or fixture-based tests comparing CPU vs. GPU buffer outputs for fixed seeds; add disposal tests to ensure managers release WebGL/worker resources.
  - Cover palette changes during active strokes and undo/redo hydration (ties into `colorCycleBrushManager`).

- **UI panels & modals**
  - Files at 0%: `ExportModal.tsx`, `LoadProjectModal.tsx`, `BrushEditorUI.tsx`, `GradientEditor.tsx`, `BrushControls.tsx`, `ColorPicker.tsx`, `MinimalLayerList.tsx`, `BrushLibrary.tsx`, `LayersPanel.tsx`, `RecolorPanel.tsx`, `Dropdown.tsx`.
  - Add React Testing Library tests that render with mocked `useAppStore` selectors to verify: modal open/close, validation/error states, basePath-safe download links, preset editing flows, layer visibility/reorder buttons, and color picker keyboard support.

- **Persistence & export**
  - Files: `projectIO.ts` (8%), `utils/colorCycleStorage.ts` (0%), `utils/brushThumbnailGenerator.ts` (0%), `utils/export/webglExporter.ts` (51%).
  - Add unit tests with fake `File`/`Blob` objects covering: corrupted project import, missing texture assets under `/vessel` basePath, thumbnail generation for custom brushes, WebGL export failure paths and cleanup.

- **Store slices and selectors**
  - Files: `stores/slices/autosaveSlice.ts` (0%), `paletteSlice.ts` (0%), `stateSelectors.ts` (0%), `colorAdjustSlice.ts` (12%), `selectionSlice.ts` (40%), `canvasSlice.ts` (27%).
  - Introduce slice-level tests mirroring existing `toolsSlice.test.ts` style to cover: autosave enable/disable and debounce timers, palette foreground/background swap, selection ROI merge/cancel, and canvas transform invariants.

- **Workers & heavy utils**
  - Files: `workers/gradientWorker.ts` (0%), `utils/contourLines.ts` (6%), `utils/shapeUtils.ts` (0%), `utils/gifDither.ts` (0%).
  - Add unit tests using worker mocks to verify message contracts and transferables; add geometry tests for contour/shape math and GIF dithering edge cases (palette overflow, transparent pixels).

- **Stale or unexecuted test harnesses**
  - Files in `src/testing/**` and `src/lib/colorCycle/__tests__/integration/**` show 0% execution; they’re instrumented but never run by Jest.
  - Either migrate them into `tests/` and wire into Jest, or exclude from coverage to avoid masking real gaps.

## Quick wins to raise coverage
- Cover `projectIO` round-trips (JSON/PNG) with small fixtures.
- Add component tests for `ExportModal` and `LoadProjectModal` to guard export/import regressions.
- Add focused unit tests for `stateSelectors` and `paletteSlice` to raise store slice baseline.
- Add pointer + shape handler integration to exercise `useDrawingHandlers` hot paths.

Run `npm test -- --coverage` after adding suites to regenerate this snapshot.

## Progress (2025-11-21)
- Added unit coverage for palette and autosave slices plus selectors (`src/stores/__tests__/paletteSlice.unit.test.ts`, `autosaveSlice.unit.test.ts`, `stateSelectors.test.ts`).
- Added manifest decoding tests for project IO (`src/utils/__tests__/projectIO.test.ts`).
- Added RTL smoke tests for export/load modals (`src/components/modals/__tests__/ExportModal.test.tsx`, `LoadProjectModal.test.tsx`) to lift 0% coverage on those components.
- Added utility coverage for `useDrawingHandlers` (dedupe + length helpers) via `src/hooks/__tests__/useDrawingHandlers.utils.test.ts`.
- Added pointer handler smoke test to exercise the event pipeline (`src/components/canvas/__tests__/pointerHandlers.smoke.test.tsx`).
- Added ColorPicker hex-input test with canvas stubs (`src/components/ui/__tests__/ColorPicker.test.tsx`).
- Added colorAdjust slice ROI/preview coverage (`src/stores/__tests__/colorAdjustSlice.test.ts`).
- Added shapeUtils coverage (path/bounds/pixel fill) via `src/utils/__tests__/shapeUtils.test.ts`.
- Added BrushControls render/interaction smoke test (`src/components/toolbar/__tests__/BrushControls.test.tsx`).
- Added Dropdown open/render smoke test (`src/components/ui/__tests__/Dropdown.test.tsx`).
- Added canvas state machine transitions test (`src/hooks/__tests__/useCanvasStateMachine.test.tsx`).
- Added selection slice bounds/clear coverage for select-all + mask reset (`src/stores/__tests__/selectionSlice.bounds.test.ts`).
- Added contourLines geometry spacing/slack coverage (`src/utils/__tests__/contourLines.test.ts`).
- Added canvas slice invariant coverage (zoom clamp, offset/viewport idempotence, ruler/FPS toggles) (`src/stores/__tests__/canvasSlice.test.ts`).
- Added GIF dithering edge coverage for transparent handling and strength clamps (`src/utils/__tests__/gifDither.test.ts`).
- Added gradient worker message/transfer contract coverage (`src/workers/__tests__/gradientWorker.test.ts`).
- Added colorCycle storage deltas/gradient pool coverage (`src/utils/__tests__/colorCycleStorage.test.ts`).
- Added MinimalLayerList visibility toggle coverage for single vs multi-selection (`src/components/__tests__/MinimalLayerList.test.tsx`).
- Added brush editor slider actions coverage (hue/lightness/saturation mirroring to settings) (`src/components/__tests__/BrushEditorUI.test.tsx`).
- Added WebGL exporter failure/minify packing coverage (`src/utils/__tests__/webglExporter.test.ts`).
- Added brush thumbnail generator fallbacks (no document/context/toDataURL failure) coverage (`src/utils/__tests__/brushThumbnailGenerator.test.ts`).
- Added ShapeToolHandler flush preview clearance coverage (`src/hooks/canvas/handlers/shapes/__tests__/ShapeToolHandler.flush.test.tsx`).
- Added BrushLibrary preset click/selection smoke coverage (`src/components/__tests__/BrushLibrary.test.tsx`).
- Added useBrushEngineSimplified facade availability smoke test (`src/hooks/__tests__/useBrushEngineSimplified.test.ts`).
- Added RecolorPanel error/empty-state smoke coverage (`src/components/colorCycle/__tests__/RecolorPanel.test.tsx`).

## Near-term targets (remaining big gaps)
- Shape tool finalize/preview flows (`ShapeToolHandler`, `useDrawingHandlers` shape branches): add down/move/up integration with shape snapshots and ROI capture assertions.
- Color-cycle brush GPU/CPU parity (`ColorCycleBrushCanvas2D`, `ColorCycleBrush2D/Path2D`, `WebGLColorCycleRenderer`): fixture-based golden tests for fixed seeds; disposal/flush coverage.
- Export/WebGL error paths (`utils/export/webglExporter.ts`): simulate minify/diagnostics toggles and failure cleanup.
- Thumbnail/persistence edge cases (`brushThumbnailGenerator`, `colorCycleStorage`, `projectIO` corruption cases): use small fixtures/base64 to cover error branches.
- UI zero-coverage components still pending: `BrushEditorUI`, `GradientEditor`, `BrushControls`, `ColorPicker`, `MinimalLayerList`, `RecolorPanel`, etc. Add RTL render + primary interaction checks with mocked selectors.

## Rolling checklist (mark items as coverage lands)

**Input & canvas interaction**
- [x] Pointer handler smoke path exercised (`pointerHandlers` via RTL smoke test).
- [ ] Shape tool finalize/preview flow: down/move/up with ROI snapshots (`ShapeToolHandler`, `useDrawingHandlers` shape branches).
- [ ] Multi-button pan vs selection gating and pointer-capture loss (`useCanvasStateMachine`, `useDrawingHandlers`).

**Brush/color-cycle rendering**
- [ ] CPU vs GPU parity for color-cycle brushes (`ColorCycleBrushCanvas2D`, `ColorCycleBrush2D/Path2D`); golden fixture for fixed seed.
- [ ] Disposal/flush coverage for renderer/animator (`WebGLColorCycleRenderer`, `ColorCycleAnimator`).
- [x] Brush engine facade smoke coverage (`useBrushEngineSimplified`).

**UI panels & modals**
- [x] Export flow happy-path render + submit (`ExportModal`).
- [x] Load flow happy-path render + submit (`LoadProjectModal`).
- [ ] Brush preset editing interactions (`BrushEditorUI`).
- [ ] Gradient editing interactions (`GradientEditor`).
- [x] Layer visibility toggle multi/single selection (`MinimalLayerList`).
- [ ] Layer reorder buttons (`MinimalLayerList`, `LayersPanel`).
- [x] Recolor panel empty/error states (`RecolorPanel`).
- [ ] Brush library filter/select (`BrushLibrary`).

**Persistence & export**
- [x] Manifest decode/round-trip (`projectIO` base cases).
- [x] Corrupted project import rejection (`projectIO`); missing texture assets still pending (`colorCycleStorage`).
- [x] Thumbnail generation fallbacks (`brushThumbnailGenerator`).
- [x] WebGL export failure/minify packing (`utils/export/webglExporter.ts` happy-path still thin).

**Store slices/selectors**
- [x] Palette slice swaps/defaults.
- [x] Autosave slice enable/disable debounce.
- [x] State selectors core paths.
- [x] Color adjust slice ROI/preview toggles.
- [x] Selection clear + select-all bounds (`selectionSlice`).
- [ ] Selection ROI merge/cut/cancel flows.
- [x] Canvas slice transform invariants (zoom clamps, offset/viewport idempotence).

**Workers & heavy utils**
- [x] Shape util geo/path coverage (`shapeUtils`).
- [x] Contour line geometry edge cases (`contourLines`).
- [x] GIF dithering palette overflow/alpha handling (`gifDither`).
- [x] Gradient worker message contracts/transferables (`gradientWorker`).
- [x] Color cycle storage delta/gradient pooling (`colorCycleStorage`).

**UI primitives still thin**
- [x] Dropdown render/open basics.
- [x] ColorPicker hex input.
- [x] BrushControls render/interaction.
- [ ] Zero-coverage primitives: `ColorCycleBrush*` cursors/overlays, keyboard scopes.
