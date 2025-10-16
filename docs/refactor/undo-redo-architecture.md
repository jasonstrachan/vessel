# Undo / Redo Architecture Refactor

## Problem Summary
- History entries were historically captured ad hoc by calling `saveCanvasState(canvas, actionType, description)` inside each tool. The utility has now been removed in favor of audited helpers, eliminating a common source of missing history entries.
- Captures rely on cloned `ImageData` and full layer copies; non-canvas mutations (project metadata, selection, shape sessions) do not restore correctly.
- Color Cycle brushes batch all strokes into one snapshot because the current logic forces a full layer clone; undo removes the entire session instead of the most recent stroke.
- Shape tools and other procedural actions mutate store slices without a clear history boundary, so undo merges multiple logical steps.
- Undo/redo application lives in `DrawingCanvas`, making it impossible to reuse history logic outside the main canvas component.

## Goals
1. Standardize how history entries are created so any tool/brush integrates automatically.
2. Support intent-level undo (per stroke, per structural change) for brushes, shapes, and Color Cycle workflows.
3. Capture all relevant store slices (layers, project metadata, selection, tool sessions, color-cycle state) without cloning entire canvases unless required.
4. Centralize history stack management and snapshot restoration in a reusable module.
5. Maintain performance and memory constraints appropriate for large canvases.

## Scope Requirements
- **Layer & project state**: layer ordering, visibility, alignment, project dimensions, metadata.
- **Bitmap content**: traditional layers, Color Cycle layer canvases, ImageData snapshots, worker-managed buffers.
- **Tool state**: active tool, brush preset, shape session data, selection bounds, floating paste.
- **View context**: zoom/rotation/canvas offset needed to restore user view.
- **Color Cycle brushes**: per-stroke granularity, gradient/palette state, serialized runtime buffers.
- **Shapes & procedural tools**: multi-step actions should emit discrete history entries (e.g., marquee start, drag, commit).

## Proposed Architecture
1. **History Domain Model**
   - Introduce `HistoryEntry` types (e.g., `LayerBitmapChange`, `LayerStructureChange`, `ColorCycleStroke`, `ShapeCommit`, `ProjectTransform`, `SelectionChange`).
   - Entries encode *deltas*: previous vs. next metadata plus optional binary blobs for bitmap content.
   - Maintain compatibility adapter for legacy `CanvasSnapshot` until all call sites migrate.

2. **History Manager Module**
   - New module (e.g., `src/history/historyManager.ts`) that owns `undoStack`, `redoStack`, `beginAction`, `appendChange`, `commit`, and `revert`.
   - Provides lifecycle hooks so tools can stage multiple diffs under a single action and commit once (`beginAction('brush-stroke')`, `appendChange(...)`, `commit('Brush Stroke')`).
   - Handles stack size limits, debouncing, and automatic redo invalidation.

3. **Application Layer Refactor**
   - Move snapshot apply logic from `DrawingCanvas` into the history manager (`applyEntry`, `applySnapshot`).
   - Expose store-level helpers (`history.applyLatest()`) so UI and headless routines share the same path.
   - Ensure Color Cycle state restoration (buffers, animation state) is handled within `applyEntry`.

4. **Diff Producers**
   - Wrap existing mutators (layer updates, project setters, selection handlers, shape tool commit, color cycle renderer) so they emit typed history diffs.
   - Provide utility helpers for common cases (e.g., `recordLayerPixels(layerId, canvas)`, `recordColorCycleStroke(layerId, serializedState)`).
   - Color Cycle brushes emit per-stroke diffs by serializing only the incremental stroke data rather than the entire canvas.

5. **Compatibility Layer**
  - Legacy `saveCanvasState` adapter removed; remaining tools must use history helpers (`commitLayerHistory`, transaction APIs).
  - Gradually migrate any remaining snapshot-based fallbacks (e.g., exports) once new deltas cover all flows.

6. **Testing & Tooling**
   - Add unit tests for the history manager covering push/pop order, max stack enforcement, and revert behavior.
   - Add integration tests for brush, Color Cycle brush, and shape tools to assert per-stroke undo behavior.
   - Update developer documentation to describe the new API and how to register history participation for new tools.

## Implementation Phases
1. **Baseline Inventory**  
   - Catalogue store slices and action types that must participate in history; document invariants and required state for restoration.
2. **History Manager Scaffold**  
   - Implement `HistoryManager` with typed entries, stack management, and basic apply/rollback using current snapshots.
3. **Store Integration**  
   - Replace direct stack mutations in `useAppStore` with calls into the manager; expose `history.undo()`/`history.redo()` delegating to it.
4. **Tool Migration**  
   - Migrate brush/eraser/fill, shape tools, layer ops, and Color Cycle brushes to emit structured diffs. Ensure Color Cycle strokes are per-entry.
5. **Refine Apply Logic**  
   - Move the replay logic out of `DrawingCanvas` into the manager; update the component to consume the new API.
6. **Clean-up & Documentation**  
   - Remove deprecated snapshot paths once all tools migrate. Update `docs/` and add tests to guard against regressions.

## Open Questions
- Do we need separate stacks per document/tab or one global history?
- How large can serialized Color Cycle diffs get, and do we need compression or chunking?
- Should history entries be persisted for crash recovery or limited to runtime only?

## Detailed Implementation Plan

### Phase 0 — Discovery & Alignment (3–4 days)
- **Inventory Matrix (`docs/refactor/undo-redo-inventory.md`)**
  - Enumerate every state slice in `src/stores/useAppStore.ts` and tag each with: participates in undo, restore requirements, serialization notes.
  - Call out Color Cycle brush state objects (`colorCycleData`, runtime buffers, `ColorCycleSnapshot`) and shape fill session state (`ShapeFillState`, `ShapeState`).
  - ✅ 2025-09-09: Inventory matrix drafted with layer/shape/color-cycle participation notes.
- **Action Taxonomy (`src/history/actionTypes.ts`)**
  - Draft discriminated union of history action IDs (brush-stroke, cc-stroke, shape-commit, layer-structure, project-transform, selection-change).
  - For each action, define required payload structure and restoration semantics.
  - ✅ 2025-09-11: `HistoryActionId` union established; per-action delta contracts linked in comments.
- **Stakeholder Review**
  - Share findings with maintainers, confirm per-stroke Color Cycle expectation and shape granularity, decide on global vs. per-document stacks.
  - ✅ 2025-09-12: Maintainer sync confirmed per-stroke CC undo and per-document history manager instance.

### Phase 1 — History Manager Scaffold (1 week)
- **Module Skeleton (`src/history/historyManager.ts`)**
  - Implement `HistoryManager` class with methods: `begin(actionId, meta)`, `pushDelta(delta)`, `commit(label)`, `cancel()`, `undo()`, `redo()`, `peekUndo()`, `peekRedo()`.
  - Maintain `isReplaying` flag exposed via getter; wrap store mutators with a guard/middleware so deltas are ignored while `isReplaying === true`.
  - Store stacks as arrays of `HistoryEntry` keyed per-document (`docId`) with metadata (timestamp, tool, description).
  - Enforce `maxHistorySize` and clear redo stack on new commit.
  - ✅ 2025-09-18: `HistoryManager` implemented with scoped transactions, doc-aware stacks, replay guard, and max-size trimming.
- **Delta Contracts (`src/history/types.ts`)**
  - Define discriminated `HistoryDelta` interfaces per action (e.g., `LayerBitmapDelta`, `LayerStructureDelta`, `ColorCycleStrokeDelta`, `ShapeSessionDelta`, `SelectionDelta`, `ViewStateDelta`).
  - Each delta provides `apply(direction)` implementation and optional `approxBytes`.
  - Transactions use `ScopedTxn` interface returning from `begin`, supporting multi-step tools (start → updates → commit/cancel).
  - ✅ 2025-09-22: Core delta interfaces plus bitmap/color-cycle/shape-session implementations landed; selection/view deltas remain TODO under Phase 4.
- **Legacy Adapter (`src/history/legacyCanvasSnapshot.ts`)**
  - Wrap existing `CanvasSnapshot` into `HistoryEntry` format for gradual migration.
  - Provide helper `fromCanvasSnapshot` and `toCanvasSnapshot` for compatibility.
  - ✅ 2025-09-24: Legacy adapter translating snapshots to history entries shipped.
- **Unit Tests (`tests/history/historyManager.test.ts`)**
  - Cover stacking, max size enforcement, redo invalidation, replay guard, and adapter behavior.
  - ✅ 2025-09-25: Jest suite exercises stack behavior, replay guard, and legacy adapter.

### Phase 2 — Store Integration (1 week)
- **Store Wiring (`src/stores/useAppStore.ts`)**
  - Replace inline history arrays with a single `historyManager` instance inside the store (Zustand middleware or module-level singleton).
  - Migrate selectors `undo`, `redo`, `canUndo`, `canRedo`, `clearHistory` to delegate to the manager.
  - Update autosave flagging to respond to manager events (`onCommit` callback) without firing during replay (respect `isReplaying`).
  - ✅ 2025-09-29: Store delegates history APIs to `historyManager`; autosave updates gated behind transaction commits while `isReplaying` guard prevents recursion.
- **State Snapshot Helpers**
  - Add utilities under `src/history/helpers/`:
    - `captureLayerBitmap(layerId, canvas)` returning `LayerBitmapDelta`.
    - `captureColorCycleStroke(layer)` serializing incremental buffers.
    - `captureShapeSession(shapeSession)` capturing live session state for transactional undo when cancelled mid-session.
  - `captureViewState(canvasState)` for zoom/offset.
  - ✅ 2025-10-14: Layer/color-cycle/shape-session helpers available via `history/helpers`; ✕ 2025-10-14: View-state capture intentionally skipped (zoom/pan excluded from history by product decision).
- **Apply Logic Extraction**
  - Move replay code from `src/components/canvas/DrawingCanvas.tsx:1520-1688` into `historyManager.apply(entry, direction)` so the UI simply triggers `history.undo()` and re-renders.
  - Ensure `captureCanvasToActiveLayer` is invoked during apply when needed.
  - Provide resource adapters (`rehydrateColorCycleRuntime`, `rehydrateWorkerResources`) to restore GPU/worker state deterministically.
  - ✅ 2025-10-15: Undo/redo replay now routed through store/state helpers; `DrawingCanvas.tsx` delegates to `useAppStore.undo/redo` while history flags drive recomposition (`src/components/canvas/DrawingCanvas.tsx`, `src/stores/useAppStore.ts`).

### Phase 3 — Tool Migration Wave 1 (brush, eraser, fill) (1–2 weeks)
- **Brush/Eraser (`src/hooks/useDrawingHandlers.ts`)**
  - Standard pattern:
    ```
    const txn = historyManager.begin('brush-stroke', { layerId, tool: 'brush' });
    txn.push(recordLayerBitmap(layerId, before, after));
    txn.push(recordColorCycleStroke(layerId, strokeInputs, fallbackPatch));
    txn.commit('Brush Stroke');
    ```
  - ✅ 2025-10-14: Per-stroke commits capture Color Cycle buffers for single-stroke undo.
  - ✅ 2025-10-14: Pointer coalescing window implemented in brush pipeline.
  - ✅ 2025-10-14: Brush/eraser finalize path now uses `commitLayerHistory`; CC strokes capture pre/post state.
  - ✅ 2025-10-14: Pointer coalescing window implemented; brush/eraser commits merge per stroke session.
- **Fill & Flood Tools (`src/utils/floodFill.ts` consumers)**
  - Hook into history manager before mutating layer data; capture diff via bitmap delta helper.
  - ✅ 2025-10-14: Canvas flood-fill handler now records bitmap/color-cycle deltas through `commitLayerHistory`; baseline `saveCanvasState` snapshots removed.
- **Tests**
  - ✅ 2025-10-14: Extended `tests/history/historyManager.test.ts` with brush and Color Cycle scenarios (simulate delta apply + revert).
  - ✅ 2025-10-14: Added integration coverage for per-stroke undo in `tests/canvas/brushHistory.test.tsx`.
- **Status (2025-10-14, Phase 3)**
  - Brush/eraser strokes routed through `commitLayerHistory` (see `src/hooks/useDrawingHandlers.ts`).
  - Flood-fill handler emits bitmap deltas via `commitLayerHistory` (`src/hooks/canvas/handlers/pointerHandlers.ts`).
  - Legacy `saveCanvasState` adapter removed; new history helpers cover brush, eraser, flood fill, and crop flows.
  - ✅ 2025-10-14: Added brush history coalescing coverage in `src/history/__tests__/brushHistory.test.ts`.

### Phase 4 — Tool Migration Wave 2 (shapes, selection, structural) (2 weeks)
- **Shape Tools (`src/hooks/useDrawingHandlers.ts` shape branch, `ShapeFillState`)**
  - Emit `shape-session-start`, `shape-update`, and `shape-commit` deltas; ensure undo rehydrates live session if undone before commit.
  - Capture parameters for hatch/flow strategies and restore them on undo.
  - ✅ 2025-10-14: Shape fill orchestrator now stages `shape-session` transactions; undo restores in-progress sessions.
- **Selection & Floating Paste**
  - Record selection bounds changes (`SelectionDelta`) so undo toggles selection back.
  - For floating paste commit, emit layered bitmap delta plus selection delta.
  - ✅ 2025-10-14: Floating paste commits now route through `commitLayerHistory` (bitmap + CC state).
  - ✅ 2025-10-14: Selection bounds now recorded via `SelectionDelta`.
- **Layer Structure (`useAppStore` layer actions)**
  - Wrap add/remove/reorder operations with `LayerStructureDelta` capturing previous and next arrays and active layer IDs.
  - Ensure Color Cycle layer metadata (e.g., runtime handles) is restored.
  - ✅ 2025-10-14: Layer add/remove/reorder now commit `layer-structure` history entries via `createHistorySnapshotFromState`.
- **View vs. Document History**
  - ✕ 2025-10-14: Zoom/pan/rotation deltas scoped out—view state remains outside undo history.
- **Project & View Transform**
  - For canvas resize, update project dimensions; record `ProjectTransformDelta`; view-state deltas no longer required.
- **Tests**
  - ✅ 2025-10-14: Added `historyIntegration.test.ts` covering shape-session replay and flood-fill deltas.
  - ✅ 2025-10-15: Added store-level undo/redo tests covering layer structure, selection, and project transform view-state scenarios (`src/stores/__tests__/historyIntegration.test.ts`).

### Phase 5 — Cleanup & Optimization (1 week)
- **Remove Legacy Snapshot Usage**
  - ✅ 2025-10-14: Replaced remaining `saveCanvasState` call sites with history helpers; legacy snapshot creation now limited to export fallback.
  - ✅ 2025-10-15: `CanvasSnapshot.imageData` made optional; history paths no longer rely on it and fallback is limited to export helpers.
- **Memory & Performance Review**
  - ✅ 2025-10-15: Color-cycle history profiling records delta sizes/tile counts (`src/history/profiling.ts`); `BitmapTileDelta` surfaces tile metrics while existing RLE + hashed blob storage provide deduplicated tile batches.
  - ✅ 2025-10-14: Added history guardrails to warn/drop oversized entries (50 MB hard cap, 25 MB warn).
- **Docs & Dev Experience**
  - ✅ 2025-10-14: Updated this doc, `docs/project.md`, and `docs/ui/input-shortcuts.md` with the new undo flow.
  - ✅ 2025-10-14: `AGENTS.md` now references history helpers instead of legacy snapshot utilities.

### Phase 6 — Validation & Rollout (ongoing)
- **Manual QA Checklist**
  - Brush, eraser, fill, shapes, color cycle strokes: confirm per-action undo/redo.
  - Layer operations undo in order; verify active layer tracking.
  - Selections and view state restore as expected.
- **Current Risks**
  - Selection history now recorded; auxiliary UI risk reduced. View-state history intentionally excluded (zoom/pan not part of undo).
  - Snapshot adapter removed; remaining follow-up is to retire legacy `CanvasSnapshot` data once exports use structured deltas.
- **Follow-ups**
  - ✅ 2025-10-14: Introduced explicit `SelectionDelta`; view state capture out of scope (zoom/pan excluded).
  - ✅ 2025-10-14: Added integration coverage for selection toggles and layer reorder undo.
- **Automation**
  - ✅ 2025-10-14: History tests now run in CI gating steps (`npm run lint`, `npm run type-check`, `npm test`).
- **Feature Flag Strategy (optional)**
  - If risk is high, wrap new manager behind a runtime flag (e.g., `enableNewHistory`) with kill switch.
- **Post-Rollout Monitoring**
  - Add debug instrumentation (`recordBreadcrumb`) for undo/redo events to help trace issues in beta.

## Risk Mitigations & Infrastructure Additions
- **Reentrancy Guard**
  - `HistoryManager` exposes `isReplaying`; Zustand middleware prevents history recording during undo/redo apply.
- **Transactional Shape Sessions**
  - Model shape workflows as transactions emitting `ShapeSessionDelta` (start/update/cancel/commit). Undo mid-session restores active session state instead of flattening pixels.
- **Blob Storage Strategy**
  - Introduce `historyBlobs` service (RAM + IndexedDB tiers) storing delta payloads keyed by hash with ref-counting. Automatically promote large blobs to persistent storage for crash recovery / memory safety.
- **Bitmap Delta Encoding**
  - Use tile-based dirty regions with compression (RLE or run-length variant) and deduplication; configurable tile size with heuristics for large documents.
- **Color Cycle Determinism**
  - Prefer command-based deltas (seed + params + stroke path). Attach optional fallback tile patch when determinism is not guaranteed.
- **Coalescing Rules**
  - Combine brush deltas while pointer remains down or within time threshold; for Color Cycle, coalesce by stroke ID; configurable via settings.
- **Per-Document Stacks & Routing**
  - Maintain independent stacks per document; global undo routes to active document’s stack with clear API for multi-document workflows.
- **View vs. Document Separation**
  - Track view state changes separately with opt-in inclusion during undo or dedicated view-history control.
- **Crash Recovery**
  - Optional persistence flag instructs manager to write entry headers + blob references to IndexedDB; lazy load blobs on replay.
