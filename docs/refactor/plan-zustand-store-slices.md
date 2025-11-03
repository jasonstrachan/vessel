# Modularizing Zustand Store Slices (Plan)

## Goal
- Replace the monolithic `src/stores/useAppStore.ts` with a slice-composed architecture that preserves behavior while improving maintainability, render performance, and testability.

## Scope
- In scope: Zustand store implementation, selectors, typed helpers, impacted hooks/components/tests relying on `useAppStore`.
- Out of scope: Introducing new UI or feature work; large-scale brush/canvas refactors beyond adapting to the new store surface.

## Constraints & Guardrails
- Maintain existing runtime behavior and persisted state shape (local storage, history payloads).
- Keep path alias `@/*` intact; expose slices via a single store entry point.
- Ensure color-cycle brush manager and autosave services continue to function.
- No regression in undo/redo or layer invariants.

## Success Criteria
- `useAppStore` file is split into domain slices (project, layers, canvas viewport, tools/brush, history, UI, autosave, selection/paste).
- Components subscribe through exported selectors/hooks with shallow equality where appropriate.
- `subscribeWithSelector` (or equivalent) is wired once at store creation.
- TypeScript emits no errors; lint/test suites pass; flamegraph/manual checks confirm reduced re-render hotspots (DrawingCanvas, LayersPanel, BrushLibrary).

## Work Breakdown

### Phase 0 – Discovery & Safeguards
- Audit current store API: catalog actions/selectors used by components/hooks (`rg 'useAppStore' src`).
- Snapshot critical flows (history commits, color-cycle updates, autosave) into `docs/refactor/zustand-store-slices-snapshot.md` for quick reference.
- Add high-level regression tests (if missing) for undo/redo, layer add/remove, brush preset switch.

### Phase 1 – Infrastructure Setup
- Introduce `src/stores/createStore.ts` (or similar) that applies middleware (`immer`, `subscribeWithSelector`, devtools in dev).
- Define shared types: `StoreState`, `StoreSlice<TSlice>`, `BoundStore`.
- Create `src/stores/selectors/` folder with typed selector helpers (e.g., `createSelectorHook`).

### Phase 2 – Slice Extraction
- Sequence slices to minimize churn:
  1. **Project & Canvas metadata** (dimensions, base project actions).
  2. **Layers & compositing flags** (layer list, `layersNeedRecomposition`, layer history metadata).
  3. **Tools & brush settings** (brush/eraser, color-cycle toggles).
  4. **Selection & floating paste** (clipboard, ROI helpers).
  5. **History & undo/redo** (actions, recomposition triggers).
  6. **UI & modals**.
  7. **Autosave & services glue**.
- For each slice:
  - Extract state + actions into `src/stores/slices/<name>Slice.ts`.
  - Provide dedicated selectors and action creators.
  - Update root store to compose slices.
  - Adjust dependent modules incrementally; run unit tests after each slice merge.

### Phase 3 – Selector Migration
- Replace broad `useAppStore` calls with slice selectors or memoized combiners.
- Introduce `useAppSelector(selector, equality?)` helper that defaults to shallow comparison; migrate high-traffic components (`DrawingCanvas`, `BrushLibrary`, `LayersPanel`, `BrushSettingsPanel`).
- Add lint rule (or codemod doc) discouraging raw object destructure from store.

### Phase 4 – Service & Middleware Alignment
- Update `colorCycleBrushManager`, `autosaveService`, `registerToolFlush`, etc., to consume the new store modules (`setColorCycleStoreStateGetter` should leverage selectors instead of accessing full state).
- Validate persistence: ensure localStorage hydration paths still map (consider migration layer if state shape changed).

### Phase 5 – Verification & Hardening
- Run `npm run type-check`, `npm run lint`, `npm test`.
- Manual QA: basic drawing workflow, undo/redo, color-cycle play/stop, autosave toggle, modal toggles, load/export smoke test.
- Capture React profiler snapshot to confirm subscription reductions (document before/after in `docs/refactor/zustand-store-slices-results.md`).

## Risks & Mitigations
- **State shape drift**: add runtime invariant checks during transition; write integration tests around history payloads.
- **Subscription regressions**: adopt `zustand/traditional` `shallow` helper and ensure selectors use stable refs; leverage React profiler.
- **Incremental migration complexity**: keep feature flags per slice to toggle old vs new in staging if needed.

## Dependencies
- Relies on existing docs (`docs/maintainability-performance.md`, `docs/refactor/zustand-subscription-optimization.md`) for guidance.
- Should coordinate with any in-flight work touching `useAppStore`.

## Timeline (Rough)
- Phase 0–1: 1–2 days.
- Phase 2: 4–5 days (stagger slices).
- Phase 3: 2 days.
- Phase 4–5: 2 days.
- Total ~2 weeks of focused effort, allowing buffer for QA.

## Validation Checklist
- [ ] All slices composed without circular dependencies.
- [ ] High-frequency components subscribe via narrow selectors.
- [ ] Services/utilities updated and tested.
- [ ] Regression tests for undo/redo, layer operations, autosave pass.
- [ ] Documentation (`docs/refactor/...`) updated with outcomes and profiling data.
