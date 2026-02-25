# Plan: Extract Export Workflows into a Service

Date: 2025-12-31

## Goal
Move export/encode workflows out of `ExportModal.tsx` into a typed service layer to reduce UI complexity and improve testability.

## Scope
- **In**: `src/components/modals/ExportModal.tsx`, `src/utils/export/*`.
- **Out**: Changes to export behavior or UI layout.

## Proposed Design

### Export Service
**Module**: `src/utils/export/exportService.ts`
- Public API:
  - `runExport(request: ExportRequest, onProgress: (p) => void, signal: AbortSignal)`
  - `estimateExport(request: ExportRequest)`
- Encapsulates:
  - GIF/PNG/MP4/WebM/WebGL export flows
  - palette estimation + dithering
  - frame iteration and timing logic

### Frame Provider Contract
- Define a `FrameProvider` interface so export logic does not import UI code.
- Example responsibilities:
  - `getFrameAt(phaseOrIndex): ImageData | HTMLCanvasElement`
  - `getFrameCount()`
  - `getDimensions()`

### Export Modal
**Role**:
- Collect settings
- Invoke service
- Render progress + cancellation

---

## Migration Steps

- [x] **Define types**
  - `ExportRequest`, `ExportResult`, `ExportProgress` in `src/utils/export/types.ts`.

- [x] **Define frame provider**
  - Pull frame capture from `ExportModal` into a provider used by the service.

- [x] **Extract export logic**
  - Move encode loops, palette estimation, and scheduling to service.

- [x] **Simplify modal**
  - Keep UI state only; use service for work.

- [x] **Add tests**
  - Unit tests for `estimateExport` and `runExport` in `src/utils/__tests__`.

---

## Definition of Done
- `ExportModal.tsx` < 800 LOC and UI‑focused.
- Service functions are unit tested.
- Cancellation + progress phases are documented and stable.
- Behavior unchanged.

## Risk + Rollback
- **Risk**: Export regressions due to interface mismatch between UI and service.
- **Mitigation**: Define `FrameProvider` contract and add export golden-path tests.
- **Rollback**: Keep legacy export flow behind a temporary flag and revert if needed.
