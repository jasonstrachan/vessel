# Color Cycle Playback Stabilization Plan

## Goal
Unify the color cycle animation state so play/pause is consistent across UI, brush engine, and layer data while preserving undo/redo fidelity.

## Scope
- `src/stores/useAppStore.ts`
- `src/utils/colorCyclePlayback.ts`
- `src/components/toolbar/BrushControls.tsx`
- `src/components/panels/AnimationControlsPanel.tsx`
- `src/hooks/useDrawingHandlers.ts`
- `src/hooks/useBrushEngineSimplified.ts`
- Related color cycle brush implementations (read-only unless synchronization changes are required)

## Constraints
- Maintain current undo/redo behavior and history granularity.
- Avoid breaking color cycle shape previews and recolor mode.
- Respect existing feature flags and basePath handling.

## Plan

[x] **Single Source of Truth**
   - Add `ui.colorCycle` slice to `useAppStore` with `isPlaying`, `suspensionCount`, and optional diagnostics (`lastReason`).
   - Provide actions `playColorCycle`, `pauseColorCycle`, `suspendColorCycle`, and `resumeColorCycle` that atomically update layer `colorCycleData.isAnimating` flags and internal counters.

[x] **Refactor Global Toggle**
   - Rewrite `toggleGlobalColorCyclePlayback` to delegate to the new store actions.
   - Keep recolor manager orchestration, but drop direct writes to global refs/events; rely on store state changes instead.

[x] **UI Integration**
   - Update `BrushControls`, `AnimationControlsPanel`, and other playback UIs to read `isPlaying` from the store.
   - Remove `globalIsAnimating`, `setColorCycleAnimationState`, and DOM event listeners; dispatch store actions instead.

[x] **Drawing Handler Synchronization**
   - Replace manual RAF refs with an effect keyed on the store’s `isPlaying` flag.
   - Convert `pauseAllBrushCCAnimationsNow`/`resumeColorCycleAfterInteraction` into `suspendColorCycle`/`resumeColorCycle` calls so strokes, shapes, and non-CC interactions share one suspension counter.

[x] **Brush Engine Alignment**
   - Adjust `useBrushEngineSimplified` (and underlying color cycle brush implementations) to respond to the shared store flag rather than starting/stopping animation directly.
   - Ensure stroke finalization still commits to canvases and keeps history deltas unchanged.

[x] **Undo/History Verification**
   - Ensure `colorCycleStrokeDelta` and `captureCanvasToActiveLayer` operate regardless of play state.
   - Replace direct `isAnimating` mutations inside history helpers with store actions if needed.

[x] **Validation**
   - Automated: `npm run lint`, `npm run type-check`, `npm test`.
   - Manual: play/pause toggles, CC stroke drawing with animation on/off, shape preview suspension, switching layers, undo/redo of CC strokes (recommended ongoing sanity).

## Risks & Mitigations
- **Race conditions when multiple callers pause**: use the suspension counter to prevent premature resumes.
- **Recolor integration gaps**: ensure recolor animations subscribe to the same store state before removing legacy hooks.
- **Performance regressions**: profile RAF startup; confirm we only trigger renders when the flag changes.

## Definition of Done
- Animation state stays consistent after strokes, shape previews, layer switches, and undo/redo.
- Play/pause button reflects actual rendering behavior.
- All validation steps pass.
