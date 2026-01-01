# Plan: Split Zustand Store into Slices

Date: 2025-12-31

## Goal
Refactor `src/stores/useAppStore.ts` into focused slice modules with explicit boundaries, reducing merge conflicts and making state logic more testable.

## Scope
- **In**: `src/stores/useAppStore.ts`, `src/stores/slices/*`, `src/stores/selectors/*`.
- **Out**: Changes to state shape or API surface.

## Proposed Slice Boundaries
- `toolsSlice` (tools, brush/eraser settings, recolor sampling)
- `layersSlice` (layers, layer ops, compositing)
- `historySlice` (undo/redo, history config)
- `uiSlice` (panels, modals, UI toggles)
- `projectSlice` (project metadata and canvas size)
- `autosaveSlice` (autosave config + interval)
- `exportSlice` (webgl export settings)
- `colorCycleSlice` (playback state + runtime handlers)
- `paletteSlice` (palette colors + picker preference)

## Slice Dependency Notes
- Avoid direct cross-slice imports; use shared types in `src/types` or `src/stores/types`.
- If a slice must call another slice’s action, expose a thin helper in `src/stores/actions` to avoid circular dependencies.

## Migration Steps

- [x] **Create slice modules** with existing logic moved verbatim.
- [x] **Recompose** slices in `useAppStore.ts`.
- [x] **Update imports** in tests and selectors.
- [x] **Add slice tests** for higher‑risk areas (layers/history/tools).

---

## Definition of Done
- `useAppStore.ts` primarily composes slices.
- All existing selectors still work.
- Tests and type‑check pass.

## Risk + Rollback
- **Risk**: Subtle cross-slice dependency issues or selector breakage.
- **Mitigation**: Keep selectors stable and add a slice dependency graph.
- **Rollback**: Revert to the monolithic store file and re-slice incrementally.
