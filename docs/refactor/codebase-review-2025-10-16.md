# Vessel Codebase Review — October 16, 2025

Context: Full-repo audit to surface the most pressing technical risks before the next milestone. Focus was on persistence integrity, render-loop performance, and runtime compatibility.

## 1. Persistence Breakage (Blocker)
- File: `src/stores/useAppStore.ts:4674-4690`, call-sites `src/stores/useAppStore.ts:4277-4286`, `src/utils/autosave.ts:70-88`
- Issue: `captureCanvasToActiveLayer` exits early unless callers pass a `sourceCanvas`. Both `saveProject` and `autosaveService.performAutosave` invoke it with no arguments, so no fresh pixels are captured before serialization. Result: manual saves and autosave silently write stale or empty layers.
- Next step: Fall back to `state.currentOffscreenCanvas` inside the helper (populated by the renderer) or update callers to supply the active composite canvas.

Immediate Fix Plan — Capture Bug
1. Trace the current flow: reproduce the save/autosave path, confirm `captureCanvasToActiveLayer` is invoked without a canvas, and document which canvases are available via `currentOffscreenCanvas`.
2. Patch the helper and callers: make the helper fall back to `currentOffscreenCanvas` (or require callers to pass their buffer) and add defensive logging when no canvas is available.
3. Validate: run a targeted regression (manual or automated) that paints a known pixel, triggers save/autosave, and verifies the active layer receives the update; finish with `npm run lint` and `npm run type-check`.


## 2. Store Subscription Fan-Out (High Priority)
- Files: `src/components/LeftToolbar.tsx:6`, `src/components/canvas/DrawingCanvas.tsx:127-145`, `src/components/modals/DocumentModal.tsx:38`, `src/components/toolbar/ZoomControls.tsx:9`, plus similar patterns.
- Issue: Components call `useAppStore()` with no selector, pulling the entire store state and forcing re-render on every mutation. This negates the selector discipline used elsewhere and induces unnecessary re-paints during brushes, layer updates, and autosave ticks.
- Next step: Replace broad subscriptions with focused selectors or `useShallow` groups; lift stable action refs from `useAppStore.getState()` when needed.

### Refactor Plan
1. **Audit & grouping** — completed 16 Oct 2025. Offending modules include high-traffic hooks (`useComprehensiveKeyboard`, `useDrawingHandlers`, `useBrushEngineSimplified`, `useToolStateMachine`, `useUserBrushEngine`) and UI shells (`LeftToolbar`, `DrawingCanvas`, `DocumentModal`, `ZoomControls`, `FillControls`, `CustomBrushPanel`, `GradientEditor`).
2. **Selector strategy**
   - Hooks: switch to granular selectors (e.g., `useAppStore(state => state.tools)` replaced by individual `state.tools.currentTool`, `state.activeLayerId`, etc.) or adopt helper selectors exported from `stores/selectors`.
   - Components: pull primitive slices (`currentTool`, `zoom`, `project`) via dedicated selectors; source stable actions via `useAppStore.getState()` or `useAppStore(useCallback(...))` to avoid new function identities.
   - `DrawingCanvas`: introduce a custom hook (e.g., `useCanvasStoreSlices`) that memoizes the handful of slices required using `shallow` compare to prevent re-subscription churn.
3. **Implementation order**
   - Start with UI components (simpler), then hooks (require careful dependency updates), finally complex canvas module.
   - After each refactor, profile render counts (React DevTools Profiler) during stroke replay to ensure the change reduces commits.
4. **Validation**
   - Run `npm run lint`, `npm run type-check`, and targeted interaction tests if available.
   - Update `docs/refactor/zustand-subscription-optimization.md` with examples once first module lands.

_Status (October 16, 2025): left/right panel components, modal shells, `DrawingCanvas`, and shared keyboard/brush hooks now consume targeted selectors; TypeScript check passes (`npm run type-check`)._

## 3. OffscreenCanvas Hard Dependency (High Priority)
- File: `src/stores/useAppStore.ts:4500-4514`
- Issue: `newProject` always instantiates `new OffscreenCanvas(width, height)`. Safari < 17.4 and legacy Edge/WebView deployments lack OffscreenCanvas, causing `ReferenceError` and blocking project creation.
- Next step: Feature-detect (`typeof OffscreenCanvas === 'function'`) and fall back to a standard `<canvas>` element when unavailable.

## Suggested Ordering
1. Patch persistence capture (blocker).
2. Tighten component selectors and profile render cadence after the fix.
3. Ship OffscreenCanvas fallback to restore cross-browser project creation.

Keep `zustand-subscription-optimization.md` in sync once selectors are refactored; it already captures the intended pattern.
