# CC Undo/History Cleanup Plan

Date: 2026-05-04

## Goal

Remove ambiguity around color-cycle undo/history authority. The active undo/history path should keep using validated canonical CC state through the persistence snapshot boundary, and legacy `CanvasSnapshot.colorCycleState` should not be able to replace or wipe canonical CC payload.

## Current Finding

CC history capture currently flows through:

```text
captureColorCycleBrushState(...)
  -> captureColorCyclePersistenceSnapshot(..., mode: 'history', requirePaint: true)
  -> color-cycle history deltas / layer-structure brushState
```

The suspicious cleanup target is `CanvasSnapshot.colorCycleState` construction in `src/stores/helpers/historyLifecycle.ts`. Current search showed it is written there and typed in `src/types/index.ts`, but no active replay path appeared to read it. This should be confirmed before removal.

## Checklist

### 1. Confirm Active Consumers

- [ ] Search all `CanvasSnapshot.colorCycleState` and `colorCycleState` reads.
- [ ] Verify it is not used by undo/redo replay, save, export, restore, or layer-structure history.
- [ ] If any consumer exists, classify it as active behavior or dead legacy.

### 2. Document Current Authority

- [ ] Update `docs/notes/cc-layer-wipe-authority-boundaries-2026-05-03.md`.
- [ ] State that CC history authority is `captureColorCycleBrushState(...) -> captureColorCyclePersistenceSnapshot(..., mode: 'history')`.
- [ ] State that undo/redo replay uses CC deltas / validated layer brush state, not `CanvasSnapshot.colorCycleState`.
- [ ] Mark `CanvasSnapshot.colorCycleState` as legacy unless a real consumer is found.

### 3. Add Regression Coverage First

- [ ] Add a layer-structure history regression:
  - create a CC layer with valid `colorCycleData.brushState`;
  - include bogus/empty `CanvasSnapshot.colorCycleState`;
  - undo/redo layer structure;
  - assert CC runtime restores from validated layer brush state, not the bogus snapshot.
- [ ] Add or extend coverage proving metadata-only CC history capture returns `null` and logs, instead of creating an empty undo state.

### 4. Remove Or Quarantine Legacy Field

- [ ] Preferred: remove `colorCycleState` construction from `createHistorySnapshotFromState(...)` if no active consumer exists.
- [ ] If removal is too risky, mark it legacy diagnostic-only and ensure replay never reads it.
- [ ] Keep `colorCycleData.brushState` as the only CC payload inside layer-structure snapshots.

### 5. Tighten Types

- [ ] If removal succeeds, remove or deprecate `CanvasSnapshot.colorCycleState` from `src/types/index.ts`.
- [ ] If the type must remain, add a comment saying it is not canonical CC history authority.

### 6. Run Focused Gates

- [ ] Run:

```bash
npm test -- --runTestsByPath src/history/helpers/__tests__/colorCycle.test.ts src/history/deltas/__tests__/colorCycleStrokePatchDelta.test.ts src/history/deltas/__tests__/colorCycleStrokeDelta.undo.test.ts src/history/__tests__/runtimeRehydration.test.ts src/stores/__tests__/historyIntegration.test.ts tests/history/historyManager.test.ts --runInBand
```

- [ ] Run:

```bash
npm run type-check
npm run lint
```

### 7. Optional Full Gate

- [ ] Run full Jest if shared history types or replay structures change:

```bash
npm test -- --runInBand
```

## Definition Of Done

- [ ] CC undo/history has one clear authority path.
- [ ] No active legacy `CanvasSnapshot.colorCycleState` ambiguity remains.
- [ ] Tests prove bogus snapshot data cannot wipe or replace canonical CC payload.
- [ ] Targeted gates pass.
