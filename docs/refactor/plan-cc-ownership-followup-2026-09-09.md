# Color Cycle ownership follow-up

Status: complete

## Goal

Keep empty resident documents authoritative during warmup, derive compositor
playback from the same effective state as the runtime controller, and remove
obsolete Goblet brush-state fallback code. Preserve archive imports and rendered
export output. No brush algorithm changes or schema migration. Local commit authorized after review; no push.

## Owners and scope

- `src/lib/colorCycle/document/hydration.ts` and its `__tests__/hydration.test.ts`
- `src/stores/layers/layerCompositeDrawing.ts`, `layerCompositeActions.ts`,
  `__tests__/layerCompositeDrawing.playback.test.ts`, and the existing multiplayer fixture
- `src/runtime/playback/colorCyclePlaybackParticipant.ts`
- `src/utils/export/goblet/gobletColorCycleSerializer.ts`, `gobletExporter.ts`,
  `gobletBrushStateFallbacks.ts`, and `__tests__/gobletBrushStateFallbacks.test.ts`
- `src/utils/export/goblet/__tests__/colorCycleExportContract.test.ts`
- `src/utils/export/__tests__/webglExporter.helpers.test.ts`
- `src/utils/projectIO.ts` and `src/utils/__tests__/projectIO.test.ts`
- This plan

These files are directly required across three separate requested fixes. Existing
unrelated staged and unstaged changes are outside the scope.

## Steps and exit criteria

1. [x] Reproduce stale saved paint replacing an empty resident document.
2. [x] Preserve resident authority during both deferral and activation; verify cold import.
3. [x] Use the shared playback selector in compositing and playback synchronization;
   verify pause, suspension and resume with conflicting legacy flags.
4. [x] Remove fallback entrypoints and exclusively supporting code/tests. Retain
   document export tests for paint, gradient IDs, flow, phase and archive metadata.
5. [x] Run focused tests, type-check/lint, full suite, production build, and live
   warmup/playback/export checks. Close the named browser session.

## Runtime-driven scope expansion

The first rebuilt browser check preserved the empty document but failed renderer
activation: `projectIO.ts` still seeded the renderer from stale saved paint.
Pass the resident document read into materialization, convert it using the existing
canonical brush-state adapter, and preserve its version. Legacy animator pixels
cannot override that read. Regression covers discard and reactivation with stale
saved paint; the production preview must prove successful activation with zero paint.

## Verification

- Old production preview reproduced both defects: paused compositing restarted a
  brush; clearing 1,133,571 pixels followed by renderer discard/reactivation
  restored all those pixels from the stale saved snapshot.
- Final production preview repeated the same controlled manager/store checks:
  paused compositing did not start playback; reactivation succeeded with zero paint.
- Save/reload and direct archive byte inspection retained zero paint for the
  cleared layer and 1,133,571 painted pixels for the other layer.
- Play/suspend/resume/pause produced true/false/true/false runtime playback despite
  conflicting legacy flags. Interlace, full-stack and overlay paths have regression tests.
- Single HTML exported one empty and one animated layer. Its exact preview canvas
  changed hash across 60 animation frames and had visible pixels in both samples.
- Full Jest: 538 suites and 4,308 tests passed; one suite/test skipped. Type-check,
  lint, production-preview build and diff whitespace checks passed.
- Removed 1,579 lines from the Goblet serializer, the fallback module/test, and
  obsolete helper exports; supported document contracts cover paint, definition IDs,
  flow, phase, archive compatibility and rejection of runtime-only sources.
- Closed the named Playwright session and verified no matching daemon remains.
- Verification used the current working tree; unrelated changes were preserved.
  Local commit authorized in the subsequent review; no push requested.

## Commit review

Found that the document-derived restore payload retained a stale animator object.
Its dimensions and encoded buffers still participated in validation before the
resident document could be materialized. Remove that object from the detached
restore projection. The regression supplies malformed animator data alongside a
valid empty resident document and verifies successful, paused restoration with
unchanged document version and empty paint.
