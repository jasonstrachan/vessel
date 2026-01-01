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
- [x] Map internal sections in `useDrawingHandlers.ts` and tag by concern.
- [x] Identify shared helpers already living in `src/hooks/canvas/handlers/` and `src/hooks/canvas/utils/`.
- [x] Add thin typings or interfaces for handler modules (non‑runtime).
- [x] Define a `HandlerDeps` contract listing all dependencies passed into handlers (store, refs, engines).

Deliverable:
- [x] A short section map (comment block) at top of `useDrawingHandlers.ts`.
- [x] `HandlerDeps` type definition colocated with handlers (`src/hooks/canvas/utils/types.ts`).

---

### Phase 1 — Extract Pure/Utility Helpers (Low Risk)
**Goal**: Move pure, stateless helpers into `src/hooks/canvas/utils/`.

Candidates:
- [x] Color‑cycle gradient helpers (done in current patch)
- [x] CSS color parsing helpers (none found in `useDrawingHandlers` for extraction)
- [x] Geometry/pressure utilities (extracted stroke capture padding helper into `hooks/canvas/utils`)

Deliverable:
- [x] `src/hooks/canvas/utils/colorCycleHelpers.ts` (already created)
- [x] Any additional utilities extracted without call‑site behavior change (stroke capture padding helper)

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
- [x] `ShapeFinalizeHandler.ts` (or similar) that exposes a `finalizeShape()` with explicit inputs.
  - [x] Implemented: `ShapeFinalizeHandler.ts` now owns raster shape finalize + dither gradient finalize helpers; `buildLostEdgePolygon` moved.
  - [x] Lost-edge polygon erosion helper extracted to `applyPolygonLostEdgeErosion`.
  - [x] Raster shape commit helper extracted to `commitRasterShapeFill`.

#### 2.2 Recolor Sampling Flow
Move recolor sampling steps into `src/hooks/canvas/handlers/recolorSampling.ts`.
- Inputs: sampling state, pointer updates, target resolution
- Outputs: updated recolor settings + layer updates

Deliverable:
- [x] `recolorSamplingHandler.ts` + integration wiring in `useDrawingHandlers`.
  - [x] Implemented: `recolorSamplingHandler.ts` extracted from pointer handlers and wired into `pointerHandlers` (no behavior change).

#### 2.3 Crop & Selection Flows
If state machine logic is already in `src/hooks/canvas/handlers`, move remaining logic that lives in `useDrawingHandlers`.

Deliverable:
- [x] `cropHandlers.ts` or `selectionHandlers.ts`
  - [x] Implemented: `selectionHandlers.ts` extracted from `pointerHandlers` for selection hit-test/start/move/end/clear flows.
  - [x] Crop-specific handler extraction not needed (no crop-specific logic left in `useDrawingHandlers` beyond tool gating).

---

### Phase 3 — Color‑Cycle Brush Pipeline Isolation (Higher Risk)
**Goal**: Separate history/commit/save behavior for color‑cycle layers into a dedicated helper module.

Move into:
- `src/hooks/canvas/handlers/colorCycle/`
  - [x] `colorCycleCommit.ts` (raster overlay commits + brush history scheduling + CC deferred save helper extracted; remaining CC commit paths still inline)
  - [x] `colorCycleHistory.ts`
- [x] `colorCycleShapeFill.ts` (linear/concentric CC shape fill helpers extracted)
- [x] `colorCycleShapeFill.ts` extended with `runColorCycleShapeFill` and linear direction helper

Deliverables:
- Dedicated “commit” API used by `useDrawingHandlers` and any other call‑sites.
  - [x] Implemented: `src/hooks/canvas/handlers/colorCycle/colorCycleHistory.ts` for deferred CC saves + queued history commits; `useDrawingHandlers` now delegates.
  - [x] Extract remaining commit/save paths into `colorCycleCommit.ts` (CC layer stroke commit helper).

---

### Phase 4 — Orchestration Simplification
**Goal**: Keep `useDrawingHandlers.ts` as orchestration only.

- All heavy logic delegated to handlers.
- File becomes:
  - dependencies + wiring
  - state/refs coordination
  - hook return surface

Deliverable:
- [ ] `useDrawingHandlers.ts` under ~1,500 LOC (currently ~5,209 LOC).
  - [x] color-cycle interaction pause/resume moved to `colorCycleInteraction.ts`.
  - [x] color-cycle rendering/deferred overlay scheduling moved to `colorCycleRender.ts`.
  - [x] color-cycle playback start/stop moved to `colorCyclePlayback.ts`.
  - [x] overlay canvas init/resize moved to `overlayCanvas.ts`.
  - [x] color-cycle surface helpers moved to `colorCycleSurface.ts`.
  - [x] capture-region utilities moved to `captureRegions.ts`.
  - [x] brush sampling helpers (auto-sample stops, preview render/clear, sampleHexAt) moved to `brushSampling.ts`.
  - [x] linear direction selection flow refactored into local helper (`handleLinearDirectionSelection`) for readability.
  - [x] shape finalization flow refactored into local helper (`handleShapeFinalize`) for readability.
  - [x] color-cycle brush finalization flow refactored into local helper (`finalizeColorCycleBrush`) for readability.
  - [x] stroke capture prep (ROI + beforeImage) refactored into local helper (`prepareStrokeCapture`).
  - [x] color-cycle layer canvas init refactored into local helper (`ensureColorCycleLayerCanvas`).
  - [x] Extract color-cycle brush finalize + auto-sample stop orchestration into `handlers/colorCycle/colorCycleFinalize.ts`.
  - [x] Extract CC layer stroke commit branch into `handlers/colorCycle/colorCycleStrokeCommit.ts`.
  - [x] Extract stroke history commit orchestration into `handlers/colorCycle/colorCycleStrokeHistory.ts`.
  - [x] Extract sampling cleanup reset into `handlers/brushSampling.ts` (`resetAutoSampleState`).
  - [x] Extract CC layer canvas init helper into `handlers/colorCycle/colorCycleLayerInit.ts`.
  - [x] Extract remaining CC brush end-of-stroke pipeline (commit + history + sampling handoff) into `handlers/colorCycle/`.
  - [x] Extract eraser finalize path into `handlers/eraserFinalize.ts`.
  - [x] Extract stroke capture prep into `handlers/strokeCapture.ts`.
  - [x] Extract stroke coalesce payload builder into `handlers/strokeHistoryCoalesce.ts`.
  - [x] Extract stroke history metadata resolver into `handlers/strokeHistoryMetadata.ts`.
  - [x] Extract color-cycle brush flags helper into `utils/colorCycleBrushFlags.ts`.
  - [x] Extract custom brush data resolver into `utils/customBrushData.ts`.
  - [x] Extract stroke session helpers into `handlers/strokeSession.ts`.
  - [x] Extract CC brush eraser settings helper into `handlers/colorCycle/colorCycleEraserSettings.ts`.
  - [x] Extract CC stamp target context helper into `handlers/colorCycle/colorCycleStampTarget.ts`.
  - [x] Extract brush rotation resolver into `utils/brushRotation.ts`.
  - [x] Extract idle scheduling helpers into `utils/idle.ts`.
  - [x] Extract snapshot/shape image helpers into `utils/snapshots.ts`.
  - [x] Extract canvas backdrop and line clipping helpers into `utils/canvasBackdrop.ts` and `utils/lineClipping.ts`.
  - [x] Extract color-cycle layer guard into `utils/layerGuards.ts`.
  - [x] Extract perf/timing debug helpers into `utils/perfDebug.ts`.
  - [x] Extract shape snapshot helpers into `handlers/shapeSnapshots.ts`.
  - [x] Extract shape pressure handling into `handlers/shapePressure.ts`.
  - [x] Extract CC finalize queue flush helper into `handlers/colorCycle/colorCycleFinalizeQueue.ts`.
  - [x] Extract finalize stroke prep (batch cancel + resampler reset + engine finalize) into `handlers/strokeFinalizePrep.ts`.
  - [x] Extract finalize guard evaluation into `handlers/finalizeGuards.ts`.
  - [x] Extract finalize busy lock helper into `handlers/finalizeBusyLock.ts`.
  - [x] Extract finalize overlay clear helper into `handlers/finalizeOverlayClear.ts`.
  - [x] Extract pending eraser finalize helper into `handlers/eraserFinalize.ts`.
  - [x] Extract finalize cleanup block into `handlers/finalizeCleanup.ts`.
  - [x] Remaining sensible extractions (not strictly for size)
    - [x] Mask-healing helpers (`createBrushStampSource`, begin/extend/end mask heal) into `handlers/maskHealing.ts`.
    - [x] Custom brush capture/resampler workflow (captureBrushFromCanvas + resampler refs) into `handlers/customBrushCapture.ts`.
    - [x] CC animation pause/resume helpers (`pauseAllBrushCCAnimationsNow`, `resumePausedBrushCCAnimations`) into `handlers/colorCycle/colorCycleInteraction.ts` or sibling.
    - [x] Shape tool orchestration (`startShapeDrawing`, `continueShapeDrawing`, `finalizeShapeDrawing`, direction selection) into `handlers/shapes/shapeDrawing.ts`.
    - [x] Stroke batching + pixel queue plumbing (`strokeBatchRef`, `processBatchedStrokes`, queue setup) into `handlers/strokeBatching.ts`.

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
6. **Color-cycle brush finalize + auto-sample extraction** (done)

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
