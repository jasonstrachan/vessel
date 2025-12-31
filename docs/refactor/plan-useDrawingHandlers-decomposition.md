# Plan: Decompose `useDrawingHandlers.ts`

Date: 2025-12-31

## Goal
Break the 7k‑line `src/hooks/useDrawingHandlers.ts` into focused modules without changing behavior. Improve maintainability, isolate tool logic, and make tests more targeted.

## Scope
- **In**: `src/hooks/useDrawingHandlers.ts`, `src/hooks/canvas/handlers/**`, `src/hooks/canvas/utils/**`, tool-specific modules.
- **Out**: Functional changes to rendering, history semantics, export, or UI behavior. No API changes to store slices in this phase.

## Constraints
- No behavior changes: refactor‑only.
- Keep public APIs stable.
- Use `@/*` imports.
- Keep files under ~500–800 LOC where possible.

## Current Risk Hotspots
- `useDrawingHandlers.ts` (7,029 LOC) mixes:
  - input capture + pointer logic
  - tool gating and state machine transitions
  - history recording / delta capture
  - color‑cycle brush management
  - recolor sampling
  - selection and crop workflows
  - shape fill finalization

## Refactor Strategy (Phased)

### Phase 0 — Inventory + Guardrails
- Map internal sections in `useDrawingHandlers.ts` and tag by concern.
- Identify shared helpers already living in `src/hooks/canvas/handlers/` and `src/hooks/canvas/utils/`.
- Add thin typings or interfaces for handler modules (non‑runtime).
- Define a `HandlerDeps` contract listing all dependencies passed into handlers (store, refs, engines).

Deliverable:
- A short section map (comment block) at top of `useDrawingHandlers.ts`.
- `HandlerDeps` type definition colocated with handlers.

---

### Phase 1 — Extract Pure/Utility Helpers (Low Risk)
**Goal**: Move pure, stateless helpers into `src/hooks/canvas/utils/`.

Candidates:
- Color‑cycle gradient helpers (done in current patch)
- CSS color parsing helpers
- Geometry/pressure utilities when referenced by multiple tools

Deliverable:
- `src/hooks/canvas/utils/colorCycleHelpers.ts` (already created)
- Any additional utilities extracted without call‑site behavior change

---

### Phase 2 — Extract Tool Modules (Moderate Risk)
**Goal**: Extract tool‑specific flows into `src/hooks/canvas/handlers/<tool>.ts` or `src/hooks/canvas/handlers/<tool>/` modules.

#### 2.1 Shape Tool Finalization
Move shape finalize/lost‑edge logic to `src/hooks/canvas/handlers/shapes`.
- Related logic today:
  - Shape finalize + erosion + dither
  - `applyLostEdgeErosionToContext`
  - `renderDitherGradientToImageData`

Deliverable:
- `ShapeFinalizeHandler.ts` (or similar) that exposes a `finalizeShape()` with explicit inputs.

#### 2.2 Recolor Sampling Flow
Move recolor sampling steps into `src/hooks/canvas/handlers/recolorSampling.ts`.
- Inputs: sampling state, pointer updates, target resolution
- Outputs: updated recolor settings + layer updates

Deliverable:
- `recolorSamplingHandler.ts` + integration wiring in `useDrawingHandlers`.

#### 2.3 Crop & Selection Flows
If state machine logic is already in `src/hooks/canvas/handlers`, move remaining logic that lives in `useDrawingHandlers`.

Deliverable:
- `cropHandlers.ts` or `selectionHandlers.ts`

---

### Phase 3 — Color‑Cycle Brush Pipeline Isolation (Higher Risk)
**Goal**: Separate history/commit/save behavior for color‑cycle layers into a dedicated helper module.

Move into:
- `src/hooks/canvas/handlers/colorCycle/`
  - `colorCycleCommit.ts`
  - `colorCycleHistory.ts`

Deliverables:
- Dedicated “commit” API used by `useDrawingHandlers` and any other call‑sites.

---

### Phase 4 — Orchestration Simplification
**Goal**: Keep `useDrawingHandlers.ts` as orchestration only.

- All heavy logic delegated to handlers.
- File becomes:
  - dependencies + wiring
  - state/refs coordination
  - hook return surface

Deliverable:
- `useDrawingHandlers.ts` under ~1,500 LOC

## Handler Interface Contract
- Handlers are plain functions (no React hooks).
- All side effects must flow through explicit dependencies in `HandlerDeps`.
- Handler inputs/outputs are typed; state mutation is via passed store/actions only.

---

## Dependency & Ownership Boundaries

### Candidate Folder Structure
```
src/hooks/canvas/
  handlers/
    brushHandlers.ts
    selectionHandlers.ts
    cropHandlers.ts
    recolorSamplingHandler.ts
    shapes/
      ShapeFinalizeHandler.ts
      ShapeToolHandler.ts
    colorCycle/
      colorCycleCommit.ts
      colorCycleHistory.ts
  utils/
    colorCycleHelpers.ts
    pressureUtils.ts
    geometryUtils.ts
```

### Invariants
- `useDrawingHandlers` is the only place with hook‑level state and React lifecycle hooks.
- Handlers are pure or side‑effect driven but do not use React hooks directly.

---

## Testing Strategy
- Use existing tests under `src/hooks/canvas/__tests__` and `src/hooks/__tests__`.
- Add targeted unit tests for extracted helpers as needed.
- Ensure pointer handlers tests remain green.

---

## Incremental Commit Plan

1. **Utility extraction** (low risk)
   - Move helpers, update imports
   - No behavior change
2. **Shape finalize extraction**
3. **Recolor sampling extraction**
4. **Color‑cycle history/commit extraction**
5. **Final cleanup + doc update**

---

## Definition of Done
- `useDrawingHandlers.ts` split into handler modules
- No behavior change in UI or tool workflows
- Tests pass: `npm test`, `npm run lint`, `npm run type-check`
- Documentation in `docs/refactor/plan-useDrawingHandlers-decomposition.md` kept current

## Risk + Rollback
- **Risk**: Subtle behavior changes from refactor-only movement.
- **Mitigation**: Move code in small steps; add golden path tests for pointer handling.
- **Rollback**: Revert the most recent extraction module and restore inline logic in `useDrawingHandlers.ts`.
