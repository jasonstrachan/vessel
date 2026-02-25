# Memory Leak Follow-Up Tasks

## High-Risk / Needs Further Design
1. Audit ImageBitmap usage in `src/utils/export/webglExporter.ts` to ensure every bitmap gets `close()`d on error paths.

## Medium-Risk / Pending Verification
- Verify that color cycle brush disposal now fires in undo/redo flows; add regression tests covering `disposeColorCycleBrushManager()` in Jest harness.
- Investigate whether `autosaveService.stop()` should await in-flight saves before clearing `hasUnsavedChanges`.

## Recently Completed
- Hardened autosave interval orchestration and made the service singleton-aware (`src/utils/autosave.ts`).
- Deferred IndexedDB initialization in `src/utils/backgroundStorage.ts` so failed open attempts no longer pin promises.

(Updated: 2025-11-06)
