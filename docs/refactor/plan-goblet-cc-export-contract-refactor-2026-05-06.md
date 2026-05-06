# Goblet Color-Cycle Export Contract Refactor Plan - 2026-05-06

## Goal

Make Goblet export deterministic and inspectable for color-cycle layers by replacing the current fallback-heavy export path with one canonical export contract.

## Completion Evidence - 2026-05-06

Implemented in this change:

- `src/utils/export/goblet/colorCycleExportSourceResolver.ts` resolves CC export sources into cloned/export-local layer snapshots.
- `src/utils/export/goblet/colorCyclePayloadBuilder.ts` is the canonical Goblet CC payload builder used by `exportProjectAsWebGL()`.
- `src/utils/export/goblet/colorCyclePayloadValidation.ts` validates dimensions, paint presence, slot palette coverage, and mask dimensions before packaging.
- `src/utils/export/goblet/gobletMetadataSchema.ts` centralizes minify/unminify schema coverage; Goblet 1 and Goblet 2 runtime maps were updated and inline runtimes regenerated.
- `ExportModal.tsx` now surfaces CC source, payload stats, diagnostics, skipped-hidden rows, failed rows, and copyable diagnostics.
- `tests/helpers/gobletArtifactHarness.ts` plus `tests/goblet2-artifact-cc-export.spec.ts` render a synthetic Ada-like Goblet artifact, isolate visible CC layers, and pixel-check each layer.
- `docs/bugs/goblet-cc-export-ada-evidence-2026-05-06.md`, `docs/exporting.md`, and `docs/color-cycle-compatibility-contract.md` record the export contract and evidence.

Validation run:

- `npm run type-check -- --pretty false`
- `npm run lint`
- `npm test -- --runInBand`
- `npm run build:goblet-inline`
- `npm run verify:goblet2-inline`
- `node scripts/build-goblet-runtime.mjs --check --target=all`
- `npx playwright test tests/goblet2-single-file-smoke.spec.ts tests/goblet2-binary-sidecar-smoke.spec.ts tests/goblet2-artifact-cc-export.spec.ts --reporter=line`

The export path must:

- preserve Vessel project color-cycle data; export is read/materialize-only and must not wipe or rewrite canonical CC data;
- keep layer-by-layer export progress visible in the export UI;
- fail or warn clearly when a layer cannot produce a valid Goblet payload;
- prove the final exported artifact renders each exported CC layer, not just that metadata exists.

## Current Diagnosis

The current Goblet path is fragile because these areas make independent decisions:

- project archive lazy hydration in `src/utils/projectIO.ts`;
- live CC brush runtime serialization in `src/utils/export/goblet/gobletColorCycleSerializer.ts`;
- fallback brush-state extraction from document state, saved snapshots, brush properties, and animator state;
- minified property mapping in `src/utils/export/goblet/gobletExporter.ts`;
- unminified runtime mapping in `public/goblet2/goblet2.js`;
- ZIP/single-file metadata loading in `src/utils/export/goblet/gobletHtmlBuilder.ts` and `src/utils/export/goblet/gobletZipBuilder.ts`;
- Goblet 2 runtime rendering in `public/goblet2/goblet2.js`.

This creates symptoms that look different but share the same root problem:

- a CC layer plays in Vessel but exports blank;
- a layer exports with wrong green/yellow palettes because slot-to-gradient-def bindings are guessed or unavailable;
- cold archive refs are not materialized before Goblet serialization;
- minified and unminified payload maps can drift;
- ZIP sidecar and single-file export paths do not exercise the same runtime loading path;
- tests often validate the returned metadata object instead of the actual generated artifact.

## Non-Negotiables

- No CC data wipe: export must not clear, replace, compact, or save over `paintBuffer`, `gradientIdBuffer`, `gradientDefIdBuffer`, `speedBuffer`, `flowBuffer`, `phaseBuffer`, `brushState`, `gradientDefStore`, or `slotPalettes`.
- Export-local immutability: Goblet export must operate on cloned/export-local layer data. It must not mutate live store/project layer objects while hydrating, validating, packing, cropping, masking, or minifying.
- No silent static fallback for animated CC layers. If animated payload cannot be built, report that layer as failed/static in progress and metadata diagnostics.
- Preserve layer-by-layer progress:
  - skipped/hidden decision;
  - extracting source;
  - validating CC buffers;
  - packing payload;
  - rendering/exporting layer;
  - final package writing.
- Keep Goblet runtime and Vessel exporter in contract. Any payload key change must update export, runtime expansion, runtime render, and tests together.
- Validate exported artifacts. A passing serializer unit test is not enough.
- Add artifact validation before broad refactor work. The real exported HTML/ZIP must be characterized early so later phases cannot pass metadata-only tests while the artifact regresses.

## Target Architecture

### 1. Canonical Payload Builder

Add a dedicated module:

`src/utils/export/goblet/colorCyclePayloadBuilder.ts`

Public API:

```ts
export type GobletColorCyclePayloadBuildSource =
  | 'hydrated-archive-document-state'
  | 'persisted-brush-state'
  | 'live-runtime'
  | 'recolor-runtime';

export type GobletColorCyclePayloadResult =
  | {
      ok: true;
      layerId: string;
      source: GobletColorCyclePayloadBuildSource;
      payload: WebGLColorCycleMetadata;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
    }
  | {
      ok: false;
      layerId: string;
      reason: string;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
    };

export async function buildGobletColorCyclePayload(
  layer: Layer,
  project: Project,
  options: GobletColorCyclePayloadBuildOptions
): Promise<GobletColorCyclePayloadResult>;
```

Responsibilities:

- materialize lazy archive refs into export-local snapshots without mutating saved project files or live layer objects;
- choose one source of truth using a strict order;
- build one Goblet payload shape;
- validate dimensions and buffer presence before returning;
- bind used gradient slots to actual gradient definitions;
- return diagnostics suitable for the export progress UI.

The existing `serializeColorCycleData()` should become a thin adapter around this builder or be deleted after migration.

### 2. Source Selection Rules

Strict order:

1. Hydrated archive/document state if a layer has lazy archive refs or marked warm archive data.
2. Persisted canonical brush state if it has a same-layer snapshot and all required buffers.
3. Live runtime only when no archive/document state exists or when the layer is actively unsaved/new.
4. Recolor path only for `mode === 'recolor'`.
5. Failure, not silent blank fallback.

Rules:

- Do not let a blank live runtime override non-empty hydrated archive buffers.
- Do not rebuild paint from gradient IDs.
- Do not treat `canvasImageData` as animated CC authority.
- Do not accept gradient-only CC payloads for animated brush export.

### 3. Validation Layer

Add:

`src/utils/export/goblet/colorCyclePayloadValidation.ts`

Validation should check:

- `width * height` matches:
  - paint/index buffer length;
  - gradient ID length;
  - speed length;
  - flow length;
  - phase length;
  - gradient-def byte/entry length.
- non-empty paint when `hasContent === true`;
- each used gradient slot has a palette;
- each used gradient def id exists in `gradientDefStore` or has a safe fallback;
- cropped payloads have valid source/document bounds;
- alpha/erase mask dimensions match payload dimensions when present;
- minified and unminified keys are both representable.

Failure behavior:

- return `ok: false` from the payload builder;
- progress row should show the layer name and reason;
- exported metadata should include diagnostics only when diagnostics are enabled;
- do not mutate or clear the source layer.

### 4. Shared Minify Schema

Move the minify map to a shared generated source:

`src/utils/export/goblet/gobletMetadataSchema.ts`

Expose:

```ts
export const GOBLET_PROPERTY_MINIFY_MAP = { ... } as const;
export const GOBLET_PROPERTY_UNMINIFY_MAP = invertMap(GOBLET_PROPERTY_MINIFY_MAP);
```

Then use this in:

- `src/utils/export/goblet/gobletExporter.ts`;
- Goblet runtime build input for `public/goblet2/goblet2.js`;
- tests that assert map parity.

If direct sharing into `public/` is awkward, generate a runtime map file during `npm run build:goblet-inline`.

### 5. Export Progress Contract

Keep and expand layer progress events in `exportProjectAsWebGL()`.

Required per-layer progress statuses:

- `skipped-hidden`;
- `skipped-empty`;
- `hydrating-cc-archive`;
- `building-cc-payload`;
- `validating-cc-payload`;
- `packing-cc-payload`;
- `exporting`;
- `exported`;
- `static-preview`;
- `failed`.

Progress payload should include:

```ts
{
  layer: {
    id: string;
    name: string;
    status: string;
    message?: string;
    colorCycle?: {
      source?: GobletColorCyclePayloadBuildSource;
      payloadPixels?: number;
      nonZeroPaint?: number;
      usedSlots?: number;
      paletteSlots?: number;
      diagnostics?: string[];
    };
  };
}
```

UI requirement:

- `ExportModal.tsx` should continue showing layer-by-layer progress.
- Hidden/excluded layers should appear as skipped when the user needs full diagnostics, so missing layers are not confused with failed exports.
- Failed CC layers must be visible in the progress list, not buried in console output.
- Diagnostics should be copyable from the export modal when enabled.

### 6. Artifact-Level Validation

Add a test helper early, then expand it as phases land:

`tests/helpers/gobletArtifactHarness.ts`

Capabilities:

- export a project to Goblet HTML/ZIP in memory;
- open the actual generated artifact with Playwright;
- render the full artifact;
- isolate each layer by editing metadata visibility in a temporary copy;
- pixel-check each exported visible layer;
- collect console/page errors;
- decode metadata enough to report layer payload stats.

Phase 0/1 minimum harness:

- open one generated single-file artifact;
- isolate each layer by toggling metadata visibility in a temp copy;
- assert visible CC layers render non-zero non-background pixels;
- fail on runtime console/page errors.

Later phases expand the same harness to ZIP sidecars, minified/non-minified parity, and HTTP-hosted ZIP loading.

Minimum checks:

- every visible raster/sequential/CC layer has non-zero alpha unless intentionally empty;
- every visible CC layer with `hasContent` has non-zero non-background pixels when isolated;
- no runtime JS errors;
- minified and non-minified artifacts both expand to the same layer count and CC payload shape;
- ZIP sidecar and single-file paths both load.

Add a fixture specifically covering:

- full-document CC layer like `CC Layer 1`;
- sparse/cropped CC layer like `CC Layer 2`;
- CC layer with many sampled gradient defs;
- CC layer with erase mask image data;
- hidden raster layer excluded from export;
- fixed pixel-perfect viewport.

Do not commit the user’s portrait `.vs` fixture unless they explicitly approve. Build a synthetic fixture with the same structural properties.

## Implementation Steps

### Phase 0 - Freeze Current Evidence

- [x] Add a short bug note under `docs/bugs/` summarizing the Ada Lovelace export evidence:
  - archive contains non-empty `CC Layer 1`;
  - exported HTML metadata contains non-empty `CC Layer 1`;
  - isolated runtime render is non-empty;
  - stale running Vessel can still produce old exporter code.
- [x] Triage current uncommitted Goblet/export patches before refactor:
  - mark each patch as `keep`, `revert`, or `supersede`;
  - record the evidence for that decision;
  - split file-size work from correctness work before committing either.
- [x] Do not add more broad fallback behavior.
- [x] Identify all files touched by current Goblet export changes and split unrelated size-work from correctness-work before commit.
- [x] Add a minimal artifact characterization harness before changing architecture:
  - export or use a generated single-file Goblet artifact;
  - isolate every visible layer in the artifact;
  - assert visible CC layers render non-zero non-background pixels;
  - fail on runtime console/page errors.

Validation:

- [x] `git diff --stat` reviewed for scope.
- [x] No destructive project mutation code added.
- [x] Source layer data is snapshotted before/after export and remains byte-identical.
- [x] Minimal artifact harness runs and captures the current baseline.

### Phase 1 - Extract Source Resolver

- [x] Create `colorCycleExportSourceResolver.ts`.
- [x] Move lazy archive export hydration and document-state preference into this resolver.
- [x] Resolver returns export-local data structures; it must not patch the live `Layer` object.
- [x] Return an explicit source result instead of mutating layer state implicitly.
- [x] Preserve current `hydrateColorCycleArchiveRuntimeForExport()` as a compatibility adapter until callers migrate.
- [x] Add tests for:
  - cold archive layer with no brush snapshot creates a same-layer export snapshot;
  - blank live runtime cannot override non-empty archive state;
  - missing archive refs fail visibly;
  - no source data produces a failed result, not a blank payload.
  - export source resolution leaves the input layer byte-identical.

Validation:

- [x] `npm test -- --runInBand src/utils/__tests__/projectIO.test.ts -t "lazy|archive|color-cycle"`
- [x] `npm run type-check -- --pretty false`

### Phase 2 - Build Canonical Payload Builder

- [x] Create `colorCyclePayloadBuilder.ts`.
- [x] Move these responsibilities out of `gobletColorCycleSerializer.ts`:
  - `captureGobletColorCyclePersistenceSnapshot`;
  - saved document-state conversion;
  - runtime fallback selection;
  - slot palette resolution;
  - alpha/soft-edge mask attachment;
  - crop bounds generation.
- [x] Keep `gobletColorCycleSerializer.ts` as a packing/encoding layer only.
- [x] Remove duplicate source-selection paths after tests pass.
- [x] Add typed diagnostics for every fallback or rejection.
- [x] Builder accepts resolver output, not live mutable `Layer` state, once Phase 1 is complete.

Validation:

- [x] Existing export tests pass.
- [x] New builder tests cover each source type.
- [x] No source path mutates canonical CC buffers.
- [x] Before/after immutability tests cover archive hydration, crop/mask handling, and packing.

### Phase 3 - Add Payload Validation

- [x] Create `colorCyclePayloadValidation.ts`.
- [x] Validate before packing and after packing.
- [x] Add non-zero paint summaries without scanning huge buffers more than once.
- [x] Emit progress diagnostics from validation.
- [x] Block export of malformed animated CC payloads unless user explicitly chooses static preview export.

Validation:

- [x] Unit tests for mismatched buffer dimensions.
- [x] Unit tests for missing gradient def ids.
- [x] Unit tests for empty paint with `hasContent`.
- [x] Unit tests for crop/mask dimension mismatch.

### Phase 4 - Progress UI Preservation

- [x] Extend `WebGLExportProgress` types with CC diagnostics.
- [x] Update `exportProjectAsWebGL()` to emit phase-level progress for each CC source/build/validate/pack step.
- [x] Emit skipped progress entries for hidden/excluded layers when diagnostics/progress detail is enabled.
- [x] Update `ExportModal.tsx` to show:
  - current layer name;
  - source selected;
  - warnings/failure reason;
  - final exported/static/failed status.
- [x] Add tests for progress events.

Validation:

- [x] Existing export modal tests pass.
- [x] New test proves layer-by-layer progress still reports CC layers.
- [x] New test proves hidden/excluded layers are reported as skipped, not silently absent.

### Phase 5 - Shared Metadata Schema

- [x] Extract property minify map.
- [x] Generate or share unminify map with Goblet runtime.
- [x] Cover every supported runtime artifact:
  - `public/goblet/goblet.js`;
  - `public/goblet/goblet-inline.js`;
  - `public/goblet2/goblet2.js`;
  - `public/goblet2/goblet2-inline.js`.
- [x] If Goblet 1 is no longer supported for CC export, explicitly remove/de-scope it in UI/docs/tests instead of leaving it half-covered.
- [x] Add parity test:
  - every export minify key has runtime unminify support;
  - no duplicate minified keys;
  - critical CC keys are covered:
    - `brushState`;
    - `indexBuffer`;
    - `gradientIdBuffer`;
    - `gradientDefIdBuffer`;
    - `speedBuffer`;
    - `flowBuffer`;
    - `phaseBuffer`;
    - `slotPalettes`;
    - `gradientDefStore`;
    - `coverageBoundsPx`;
    - `coverageBoundsSourcePx`;
    - `alphaMask`;
    - `softEdgeMask`.
- [x] Rebuild Goblet runtime assets.

Validation:

- [x] `npm run build:goblet-inline`
- [x] Runtime map parity test passes.
- [x] Existing Goblet 1 and Goblet 2 runtime regression tests pass, or Goblet 1 is explicitly de-scoped.

### Phase 6 - Artifact Harness

- [x] Add Playwright artifact harness.
- [x] Add synthetic Ada-like fixture generator:
  - full 2000x2000 CC layer;
  - sparse cropped CC layer;
  - many gradient defs;
  - erase mask present;
  - fixed pixel-perfect viewport.
- [x] Test single-file Goblet export.
- [x] Test compatible ZIP export.
- [x] Test smaller ZIP sidecar export through HTTP server, not `file://`.
- [x] Isolate each layer and pixel-check output.
- [x] Capture and fail on runtime console/page errors.

Validation:

- [x] `npx playwright test tests/goblet2-artifact-cc-export.spec.ts --reporter=line`
- [x] Test fails if a visible CC layer renders blank.

### Phase 7 - Remove Old Fallbacks

- [x] Delete obsolete fallback extraction branches that are now replaced by source resolver + payload builder.
- [x] Remove code that accepts gradient-only animated brush payloads.
- [x] Remove duplicate live-runtime preference checks.
- [x] Keep legacy static-preview import repair separate from Goblet animated export.
- [x] Update docs:
  - `docs/exporting.md`;
  - `docs/color-cycle-compatibility-contract.md`;
  - this plan’s status checklist.

Validation:

- [x] `rg` confirms only one Goblet CC source-selection path remains.
- [x] `npm test -- --runInBand src/utils/export tests/export-color-cycle-html.test.ts`
- [x] `npm run type-check -- --pretty false`
- [x] `npx eslint src/utils/export src/components/modals/ExportModal.tsx src/utils/projectIO.ts`

## Definition of Done

- [x] Goblet export has one canonical CC payload builder.
- [x] Export source selection is explicit and tested.
- [x] Export cannot silently produce a blank animated CC layer from non-empty Vessel CC data.
- [x] Export does not wipe or rewrite CC project data.
- [x] Export operates on cloned/export-local CC state; before/after source layer snapshots are byte-identical in tests.
- [x] Export UI still reports layer-by-layer progress.
- [x] Hidden/excluded layers are reported as skipped when detailed progress/diagnostics are enabled.
- [x] Minify/unminify maps cannot drift without test failure.
- [x] Goblet 1/Goblet 2 runtime schema coverage is explicit: both tested if supported, or Goblet 1 deliberately de-scoped.
- [x] Single-file, compatible ZIP, and smaller ZIP paths are artifact-tested.
- [x] Each exported visible CC layer is isolated and pixel-checked in Playwright.
- [x] Existing Ada-like structural repro passes using a synthetic fixture.

## Rollback Strategy

Each phase should land independently.

- If Phase 1 fails, restore current hydration adapter and keep existing exporter behavior.
- If Phase 2 fails, keep `serializeColorCycleData()` as the active path and park the builder behind tests.
- If Phase 5 fails, disable minified output for CC-heavy exports until map parity is fixed.
- If Phase 6 exposes runtime-only failures, keep the harness and fix runtime with the artifact as proof.

Do not roll back safety checks that prevent CC wipes unless they are proven to block valid project data.
Do not roll forward broad fallback patches unless the artifact harness proves they improve the exported output without mutating source CC data.

## Notes

The current evidence does not prove the Ada `.vs` source data is blank. The source archive and exported HTML both contain non-empty `CC Layer 1` payloads. The architectural failure is that too many independent paths can still decide what “the CC payload” means. This refactor is about making that contract single-authority and testable at the artifact level.
