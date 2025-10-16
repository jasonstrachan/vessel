# Zustand Subscription Optimization Notes

_Last updated: October 16, 2025_

The goal for this pass was to eliminate broad `useAppStore()` subscriptions that forced components to re-render on every state mutation. Below are the key refactors with before/after snapshots you can reference when touching nearby code.

## LeftToolbar

| Before | After |
| --- | --- |
| ```ts
const { tools: toolState, setCurrentTool, saveProject, loadProject, toggleModal } = useAppStore();
...
const isActive = toolState.currentTool === tool.id;
``` | ```ts
const currentTool = useAppStore(state => state.tools.currentTool);
const setCurrentTool = useAppStore(state => state.setCurrentTool);
const saveProject = useAppStore(state => state.saveProject);
const loadProject = useAppStore(state => state.loadProject);
const toggleModal = useAppStore(state => state.toggleModal);
...
const isActive = currentTool === tool.id;
``` |

**Impact:** The toolbar now rerenders only when the active tool or the invoked actions change, instead of every store mutation (layers, autosave, etc.).

## DrawingCanvas

| Before | After |
| --- | --- |
| ```ts
const { setSelectionBounds, clearSelection, setCurrentTool, setCurrentOffscreenCanvas, compositeLayersToCanvas, ... } = useAppStore();
``` | ```ts
const setSelectionBounds = useAppStore(state => state.setSelectionBounds);
const clearSelection = useAppStore(state => state.clearSelection);
const setCurrentTool = useAppStore(state => state.setCurrentTool);
// ...continued one-per-selector pattern
``` |

**Impact:** Removes a massive “subscribe-to-everything” call in the hottest render path. The canvas now reacts only to the pieces of state that actually drive the handler logic.

## useComprehensiveKeyboard

| Before | After |
| --- | --- |
| ```ts
const {
  setCurrentTool,
  tools,
  polygonGradientState,
  setGlobalBrushSize,
  deleteSelectedPixels,
  ...
} = useAppStore();
``` | ```ts
const currentTool = useAppStore(state => state.tools.currentTool);
const brushSettings = useAppStore(state => state.tools.brushSettings);
const polygonGradientState = useAppStore(state => state.polygonGradientState);
const setCurrentTool = useAppStore(state => state.setCurrentTool);
// ...remaining selectors isolated
``` |

**Impact:** Keyboard shortcuts no longer trigger unrelated subscribers and we avoid recreating event handlers when the rest of the store changes.

## Additional Touch Points

- `DocumentModal`, `ZoomControls`, `FillControls`, `CustomBrushPanel`, `GradientEditor`, `useBrushEngineSimplified`, `useDrawingHandlers`, `useToolStateMachine`, and `useUserBrushEngine` now follow the same targeted-selector pattern.
- Documentation snippets (`src/lib/colorCycle/launch/LaunchGuide.md`) and archived hooks (`src/hooks/useBrushEngine.ts.backup`) mirror the new best practice so future copy/paste stays clean.

## Working Guidance

1. **Default to selectors:** When you need multiple fields, pull them individually or create a helper that returns a narrow object and memoize it with Zustand’s `shallow` comparator if necessary.
2. **Actions via selectors:** Store actions are stable functions—subscribing to them individually prevents re-renders while keeping DX simple.
3. **Verify with DevTools:** After touching a component, run a quick React Profiler pass (e.g., start/stop a brush stroke) to confirm render counts drop or stay flat.
4. **Tests:** Finish with `npm run type-check` and the relevant Jest suites whenever selector shapes change.

Keep this doc up-to-date as you touch other areas so the next person knows which patterns to follow. When introducing new components, prefer the “After” style above from the start.*** End Patch
