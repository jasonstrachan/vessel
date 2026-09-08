# Color Cycle export document authority

Status: complete

## Goal and owner

Goblet brush-mode export must consume one pinned document snapshot. Once pinned,
legacy layer buffers, persisted paint, and live renderer state cannot replace it.
`colorCycleExportSourceResolver.ts` owns resolution; the payload builder carries
the read into `gobletColorCycleSerializer.ts`, which only serializes that read.

Saved and cold archive layers normalize through the existing document normalizer
before serialization. This is an export-local document and does not activate a
layer or allocate its renderer. Preserve archived speed-source metadata. Recolor
keeps its distinct representation.

## Scope

- `src/utils/export/goblet/colorCycleExportSourceResolver.ts`
- `src/utils/export/goblet/colorCyclePayloadBuilder.ts`
- `src/utils/export/goblet/gobletColorCycleSerializer.ts`
- `src/utils/export/goblet/__tests__/colorCycleExportSourceResolver.test.ts`
- `src/utils/export/goblet/__tests__/colorCycleExportContract.test.ts`
- `src/utils/export/goblet/__tests__/gobletSlotSpeedExport.test.ts`
- `src/utils/export/__tests__/webglExporter.helpers.test.ts`
- `tests/export-color-cycle-html.test.ts` (one explicit-source fixture)
- `src/lib/colorCycle/document/hydration.ts`
- `src/lib/colorCycle/document/__tests__/hydration.test.ts`
- `src/utils/__tests__/projectIO.test.ts` (deferred-renderer fixtures now include paint)
- `src/stores/__tests__/projectLifecycle.integration.test.ts` (malformed inactive layers report repair failure)
- This plan. The adjacent test files migrate explicit runtime-fallback
  expectations and fixtures to the document contract; speed/mask assertions remain.

The live legacy save/reload check also reproduced empty placeholder documents
replacing inactive embedded paint. The hydration owner must populate a resident
document from embedded buffers (including speed-source normalization) while
leaving its renderer cold. True archive references retain cold document residency.

No archive schema, brush algorithms, rendering kernels, history, or save-format
changes. Preserve unrelated uncommitted work.

## Steps

1. [x] Reproduce stale legacy gradient buffers overriding a pinned document.
2. [x] Pass the document read directly; normalize archive inputs and remove
   alternate-source selection from the serializer.
3. [x] Verify conflicting buffers, invalid inputs, cold archives, speed metadata,
   and export-local isolation with focused tests.
4. [x] Run type-check and lint, then exercise save/load/export and playback in the
   production preview using one named browser session.

## Exit criteria

The regression passes; document-backed export never consults runtime paint or
legacy mirrors after capture; supported archives still export; missing document
data fails visibly. Report verification evidence and any remaining limitations.

## Evidence

- Before implementation, the stale legacy buffer regression throws
  `missing animated brush data (missing-brush-state)` despite a valid document.

- Production preview: drew a real 17,877-pixel Color Cycle stroke, saved/reloaded
  it, and compared baseline JSON with JSON exported after injecting conflicting
  legacy gradient buffers. The complete Color Cycle payloads were identical.
- Single HTML export rendered in its preview iframe; canvas hashes changed across
  60 animation frames with no browser errors.
- Heavy legacy project: both layers retained 1,133,571 painted pixels through
  save, ZIP buffer inspection, reload, and JSON export. The inactive layer stayed
  cold with no renderer before and after export; active-layer selection was unchanged.
- Inactive malformed layers now report the existing missing-paint repair failure
  instead of receiving an empty deferred document. Lifecycle coverage asserts this.
- Type-check, lint, production preview build, and diff whitespace checks passed.
- The named browser session was closed and its daemon cleanup verified.
- Final full Jest suite: 538 suites and 4,310 tests passed; one suite/test skipped.
