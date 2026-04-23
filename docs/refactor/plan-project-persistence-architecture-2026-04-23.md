# Project Persistence Architecture

Date: 2026-04-23

## Goal

Fix the root cause behind color-cycle project files becoming internally inconsistent, oversized, and slow to load or play back.

This plan now defines the project-level persistence architecture too, so:

- regular raster layers
- color-cycle layers
- sequential layers

all fit under one consistent archive model with separate canonical contracts.

The architecture must prevent:

- duplicated authoritative buffer sets
- save-time drift between top-level layer buffers and brush snapshots
- giant `project.json` payloads full of base64 pixel buffers
- eager restoration of heavy runtime state for every color-cycle layer
- loss of dithering, display filters, recolor settings, or slot metadata during cleanup/migration

## Problem Summary

Current color-cycle persistence mixes three different kinds of state:

1. Document state
- Layer metadata
- Gradient definitions
- Slot palettes
- Recolor settings
- Dither settings
- Canonical per-pixel indexed buffers

2. Runtime editing state
- Brush/session-owned snapshots
- Playback controller state
- Tool-local transient state

3. Derived caches
- Animator buffers
- GPU upload state
- Palette atlases
- Temporary slot rebuild artifacts

These boundaries are not enforced strongly enough. As a result, files can accumulate overlapping representations of the same color-cycle layer. Those copies can drift. Even when the archive compresses well, the uncompressed `project.json` becomes large and expensive to parse, decode, and hydrate.

The same architectural lesson applies at project scope:

- each layer family needs one canonical persisted representation
- the container format must support all layer families without mixing their concerns

## Architectural Principle

There must be exactly one canonical persisted representation of a color-cycle layer.

At the project level, there must be exactly one canonical persisted representation for each persisted layer family.

Everything else must be either:

- reconstructed from canonical persisted state
- metadata-only
- runtime-only and never authoritative on disk

## Project-Level Persistence Architecture

The Vessel project archive should be modeled in layers:

1. Project container contract
- project metadata
- layer ordering/topology
- shared binary manifest
- references to per-layer persisted state

2. Layer-family persisted contracts
- regular raster layers
- color-cycle layers
- sequential layers

3. Runtime hydration layer
- converts persisted state into live editor/runtime objects

The archive format should unify container rules while keeping layer-family contracts separate.

## Project Container Contract

### Purpose

Provide one stable archive structure that can host all layer families without forcing them into one shared schema blob.

### Container responsibilities

- project metadata
- project dimensions
- layer list and order
- layer type discriminator
- shared view-state metadata
- binary manifest
- references to per-layer canonical state

### Proposed project shape

```ts
type VesselProjectArchiveV1 = {
  version: 1;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    layerGroups?: LayerGroup[];
    defaultCustomBrushId?: string | null;
    brushSpecificSettings?: Record<string, unknown>;
    globalBrushSize?: number;
    referenceLayerId?: string | null;
    exportLayout?: ExportContainerLayout;
    palette?: PaletteState;
    canvasShape?: Project['canvasShape'];
    viewState?: {
      zoom: number;
      displayFilters?: unknown;
    };
    layers: PersistedLayerEnvelope[];
    customBrushes: PersistedCustomBrush[];
  };
  binaries: {
    entries: BinaryManifestEntry[];
  };
};

type PersistedLayerEnvelope =
  | PersistedRasterLayerEnvelope
  | PersistedColorCycleLayerEnvelope
  | PersistedSequentialLayerEnvelope;

type PersistedLayerEnvelopeBase = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  transparencyLocked?: boolean;
  order: number;
  alignment?: LayerAlignmentSettings;
  groupId?: string;
};

type PersistedRasterLayerEnvelope = PersistedLayerEnvelopeBase & {
  layerType: 'normal';
  state: RasterPersistedLayerStateV1;
};

type PersistedColorCycleLayerEnvelope = PersistedLayerEnvelopeBase & {
  layerType: 'color-cycle';
  state: ColorCyclePersistedLayerStateV1;
};

type PersistedSequentialLayerEnvelope = PersistedLayerEnvelopeBase & {
  layerType: 'sequential';
  state: SequentialPersistedLayerStateV1;
};
```

### Container invariants

- every layer has exactly one `layerType`
- every layer has exactly one canonical `state`
- no layer stores another layer family’s canonical state fields
- binary references resolve only through the shared binary manifest

## Regular Raster Layer Contract

### Purpose

Persist a normal non-CC, non-sequential raster layer with one canonical image authority.

### Contract

```ts
type RasterPersistedLayerStateV1 = {
  version: 1;
  dimensions: {
    width: number;
    height: number;
  };
  imageRef: BinaryRef; // canonical
};
```

### Rules

- one canonical raster image authority only
- no framebuffer/runtime-canvas duplication on disk
- previews are rebuilt, not persisted as authoritative layer state

## Sequential Layer Contract

### Purpose

Persist sequential animation layers without mixing them into color-cycle persistence.

### Contract

```ts
type SequentialPersistedLayerStateV1 = {
  version: 1;
  frameCount: number;
  fps: number;
  durationMs: number;
  encoding: 'chunked-events-v1';
  chunksRef: BinaryRef;
  brushSnapshotsRef?: BinaryRef;
};
```

### Rules

- sequential layers own their own canonical format
- sequential state is not stored inside CC fields
- chunk/event encoding is canonical for sequential layers
- runtime playback caches for sequential layers are derived and forbidden on disk

### Authority

- sequential event/chunk data is canonical
- sequential renderer/materializer caches are derived
- playback session position is runtime-only unless explicitly added later as metadata-only UX restore

## Target Persistence Model

### 1. Canonical persisted layer state

Persist only the minimum required to reproduce the artwork and preserve editing fidelity:

- `gradientDefStore`
- `slotPalettes`
- `activeGradientId`
- `paintSlot`
- dither settings
- display-filter related project/view-state metadata
- canonical indexed buffers required for the layer

This is the only authoritative saved form.

This color-cycle contract exists inside the larger project container contract and does not replace the raster or sequential layer contracts.

## Strict Persisted Contract

The implementation must define a concrete `ColorCyclePersistedLayerState` contract, not an informal shape.

Every persisted field must be classified as one of:

- `canonical`
- `metadata`
- `derived-forbidden-on-disk`

### Required schema-level rule

No field or buffer may exist in both canonical and runtime-snapshot form on disk, even if the values are equal.

This is not guidance. This is a hard schema invariant.

### Proposed contract

Keep V1 intentionally narrow.

The first implementation should persist only:

- canonical dimensions
- canonical `gradientDefStore`
- canonical `slotPalettes`
- `activeGradientId`
- `paintSlot`
- required mode flag
- required dither metadata
- canonical CC buffers

Defer FG-derived metadata, recolor persistence expansion, playback session restore, and optional raster carry-through until the canonical format is stable.

```ts
type ColorCyclePersistedLayerStateV1 = {
  version: 1;

  dimensions: {
    width: number;   // canonical
    height: number;  // canonical
  };

  defs: {
    gradientDefStore: Array<{
      id: number;
      kind: 'linear' | 'concentric';
      stops: Array<{ position: number; color: string }>;
      hash: string;
      source: 'manual' | 'fg' | 'sampled';
      seamProfile?: 'hard' | 'soft';
      createdAtMs: number;
      slot?: number;
      speedCps?: number;
    }>; // canonical
    nextGradientDefId: number; // metadata
  };

  slots: {
    slotPalettes: Array<{
      slot: number;
      stops: Array<{ position: number; color: string }>;
    }>; // canonical
    activeGradientId?: string; // metadata
    paintSlot?: number; // metadata
  };

  mode?: 'brush' | 'recolor'; // metadata

  dither: {
    ditherEnabled?: boolean;
    ditherStrength?: number;
    ditherPixelSize?: number;
    perceptualDither?: boolean;
  }; // metadata

  buffers: {
    paintRef?: BinaryRef;          // canonical
    gradientIdRef?: BinaryRef;     // canonical
    gradientDefIdRef?: BinaryRef;  // canonical
    speedRef?: BinaryRef;          // canonical only if not derivable
    flowRef?: BinaryRef;           // canonical only if not derivable
    phaseRef?: BinaryRef;          // canonical only if not derivable
  };
};
```

### Buffer dtype contract

The persisted format must specify exact dtypes:

- `paintRef`: `Uint8`
- `gradientIdRef`: `Uint8`
- `gradientDefIdRef`: `Uint16`
- `speedRef`: `Uint8`
- `flowRef`: `Uint8`
- `phaseRef`: `Uint8`
- recolor `indexBufferRef`: `Uint8`
- recolor `indexPhaseMapRef`: `Uint8`
- recolor `phaseMapRef`: `Uint8`
- raster image refs: encoded image payload, not typed raw array unless explicitly versioned as such

### Dimension/source-of-truth rule

Canonical width and height come from `dimensions.width` and `dimensions.height`.

All canonical per-pixel buffers must match these dimensions exactly.

No buffer is allowed to carry independent authority for dimensions.

### Nullability rules

- Canonical fields required to reconstruct editable color-cycle output must be present if the layer is in the corresponding mode.
- Metadata-only fields may be omitted when not applicable.
- Derived-forbidden-on-disk fields must never be serialized as `null`, omitted, or present. They are schema-invalid on disk.

### Forbidden on disk

These must be explicitly classified as derived-and-forbidden-on-disk:

- runtime `brushState` snapshots carrying pixel buffers
- animator index buffers
- GPU state
- palette atlas caches
- playback controller internals
- `colorCycleBrush`
- any duplicate canonical pixel buffer encoded under a runtime namespace

### `gradientDefStore` vs `gradientDefs`

For V1, make this simple:

- `gradientDefStore` is canonical
- pixel buffers reference `gradientDefStore.id`
- `gradientDefs` is not persisted in V1

If editor-facing grouping or labels still matter later, they can return as metadata-only once the canonical path is stable.

### 2. Runtime editing state

Brush/session state exists only in memory.

Examples:

- `colorCycleBrush`
- playback controller internals
- session-local snapshots used during editing
- transient tool buffers

This state may be serialized only as metadata if needed for UX continuity, but never as a second authoritative copy of layer pixel data.

### 3. Derived caches

Derived caches are rebuildable and disposable:

- animator index buffers
- GPU upload state
- palette atlases
- thumbnails
- temporary slot-GC products

These must never be persisted as authoritative document state.

## Target On-Disk Archive Format

Use zip as the container, but move all large color-cycle buffers out of `project.json`.

### Archive layout

- `project.json`
- `manifest.json`
- `buffers/manifest.json`
- `buffers/raster/<layerId>/image.bin`
- `buffers/color-cycle/<layerId>/paint.bin`
- `buffers/color-cycle/<layerId>/gradient-id.bin`
- `buffers/color-cycle/<layerId>/gradient-def-id.bin`
- `buffers/color-cycle/<layerId>/speed.bin`
- `buffers/color-cycle/<layerId>/flow.bin`
- `buffers/color-cycle/<layerId>/phase.bin`
- `buffers/sequential/<layerId>/chunks.bin`
- `buffers/sequential/<layerId>/brush-snapshots.bin`

Only include binaries that are actually required by the canonical persisted layer state.

### Binary manifest details

Binary references must not be opaque path strings alone.

Every binary reference must resolve through a manifest entry with:

```ts
type BinaryRef = {
  manifestId: string;
};

type BinaryManifestEntry = {
  id: string;
  path: string;
  kind:
    | 'cc-paint'
    | 'cc-gradient-id'
    | 'cc-gradient-def-id'
    | 'cc-speed'
    | 'cc-flow'
    | 'cc-phase'
    | 'raster-image'
    | 'sequential-chunks'
    | 'sequential-brush-snapshots'
    | 'cc-canvas-image'
    | 'cc-erase-mask'
    | 'recolor-index'
    | 'recolor-index-phase-map'
    | 'recolor-phase-map'
    | 'recolor-original-image';
  dtype:
    | 'uint8'
    | 'uint16'
    | 'png'
    | 'webp'
    | 'raw-image-v1';
  width?: number;
  height?: number;
  lengthBytes: number;
  checksum: string;
  checksumAlgorithm: 'sha256';
  encoding: 'binary';
  compression: 'deflate' | 'stored';
  schemaVersion: 1;
};
```

Minimum requirements:

- checksum/hash
- dtype
- width/height when pixel-shaped
- schema version
- optional compression flag promoted to an explicit manifest field

Without this, binary references are too loose and validation remains weak.

### JSON responsibilities

`project.json` should hold:

- metadata
- layer topology
- slot/gradient definitions
- settings
- references to binary entries

`project.json` should not inline large pixel buffers as base64 strings except for small fallback payloads or legacy migration compatibility.

## Canonical Color-Cycle Layer Shape

Each persisted color-cycle layer should contain:

- metadata:
  - defs
  - slot palettes
  - active ids
  - paint slot
  - dither settings
  - any view/filter-related metadata that is logically part of the document
- one canonical per-pixel buffer set

It should not contain:

- duplicate runtime brush snapshots that encode the same pixel state
- animator index-frame copies if derivable from canonical buffers
- GPU state
- runtime-only playback/session objects

### Raster surface policy

Keep V1 strict:

- previews are rebuilt, not stored
- raster base images are not persisted for color-cycle layers in V1
- only proven user-authored, non-reconstructable surfaces should be considered later

## Authority Matrix

Authority must be explicit for save, load, edit, and playback.

| Concept | Save authority | Load authority | Edit authority | Playback authority |
| --- | --- | --- | --- | --- |
| `paintSlot` | canonical metadata | canonical metadata | runtime mutates canonical metadata | canonical metadata copied into runtime |
| `slotPalettes` | canonical metadata/state | canonical metadata/state | runtime mutates canonical metadata/state | canonical metadata/state |
| gradient def ids in pixel buffers | canonical binary buffers | canonical binary buffers | runtime mutates canonical buffers | runtime reads canonical-derived buffers |
| `gradientDefStore` | canonical metadata/state | canonical metadata/state | runtime mutates canonical metadata/state | canonical metadata/state |
| sampled / FG-derived metadata | not in V1 | not in V1 | runtime/editor-derived | derived |
| recolor settings | not in V1 initial persistence slice unless proven required | not in V1 initial persistence slice unless proven required | runtime/editor state | derived or later-phase persisted state |
| dither settings | canonical metadata | canonical metadata | runtime mutates canonical metadata | canonical metadata copied into runtime |
| display filters | project/view-state metadata | project/view-state metadata | UI mutates project/view-state metadata | render pipeline consumes metadata |
| canvas preview image | forbidden in V1 | forbidden in V1 | rebuilt | rebuilt |
| erase mask | later only if proven user-authored and non-reconstructable | later only if proven user-authored and non-reconstructable | runtime mutates canonical mask | canonical |
| runtime brush snapshot buffers | forbidden on disk | forbidden on disk | runtime-only | runtime-only |
| animator/GPU caches | forbidden on disk | forbidden on disk | derived runtime-only | derived runtime-only |

## Save Pipeline

### Phase 1. Normalize runtime into canonical persisted state

Before writing:

- normalize each layer according to its layer-family contract
- raster layers -> canonical raster image ref
- color-cycle layers -> canonical CC state
- sequential layers -> canonical sequential chunk/event state
- discard duplicated authoritative copies

### Phase 2. Validate invariants

Mandatory save-time checks:

- layer envelope matches `layerType`
- def ids referenced by pixel buffers must exist in `gradientDefStore`
- buffer dimensions must match project/layer dimensions
- slot references must be valid
- no parallel authoritative buffer copies may disagree

If invalid:

- repair deterministically where possible
- otherwise surface a clear load/save warning instead of silently preserving ambiguity

## Failure Policy

Failure policy must be explicit and testable.

### Save-time policy

#### Hard fail save

Hard fail when:

- a canonical binary ref is missing its manifest entry
- a canonical buffer dtype does not match schema
- a canonical buffer length does not match `dimensions`
- a binary checksum does not validate during prewrite verification
- dual authority is detected on disk-bound payload
- canonical data is internally contradictory and no deterministic repair exists
- a layer envelope does not match its declared layer family

#### Warn-and-save

Warn-and-save only when:

- non-canonical derived caches are dropped
- optional previews are regenerated
- metadata-only fields are normalized without changing visible output

#### Auto-repair and save

Auto-repair is allowed only when:

- runtime snapshot disagrees with canonical state but canonical state validates
- invalid derived caches can be discarded safely
- slot palette ordering or equivalent normalization is lossless
- legacy payload duplicates can be removed without changing canonical output

### Load-time policy

#### Recoverable legacy layer

A legacy layer is recoverable when:

- one canonical interpretation validates completely
- all referenced def ids can be resolved
- dimensions are coherent
- missing fields can be reconstructed deterministically

#### Unrecoverable legacy layer

A legacy layer is unrecoverable when:

- no canonical buffer set validates
- required def ids are missing with no valid fallback source
- dimensions are contradictory across all candidate authorities
- required canonical payload is missing and cannot be derived from surviving data

Unrecoverable loads must fail the layer import explicitly, not silently synthesize ambiguous state.

### Dirty-state policy after repair

If a load performs a deterministic repair that changes persisted meaning or removes invalid legacy authority, the document should be marked dirty immediately.

If a load only rebuilds derived caches or drops forbidden runtime-only data, the document should not be marked dirty.

### Phase 3. Externalize binaries

Write large arrays to binary zip entries.

Store references in JSON.

Do not emit large base64 buffers into `project.json` in the modern format.

### Phase 4. Version and migrate

Save all newly written projects in the canonical format version.

## Load Pipeline

### Phase 1. Parse metadata first

- load `project.json`
- validate schema
- validate binary references

Do not eagerly decode every binary buffer during the preview/import pipeline unless needed.

### Phase 2. Hydrate canonical layer state

For each layer:

- raster: load canonical image ref
- color-cycle: load canonical CC buffers and validate defs
- sequential: load canonical chunk/event payload
- reject or repair inconsistent legacy combinations

### Phase 3. Rebuild runtime state from canonical state

Create runtime brush/editor objects from canonical buffers, not from saved runtime snapshots.

### Phase 4. Lazy heavy hydration

Do not fully hydrate every color-cycle layer up front.

Preferred strategy:

- hydrate active/visible layers first
- defer hidden/background layers
- build playback caches on demand

## Runtime Architecture Requirements

The current file problem is partly persistence and partly eager runtime restoration.

To prevent future projects from becoming laggy even when structurally valid:

- do not eagerly restore full playback/edit state for all color-cycle layers
- avoid multiple full-screen in-memory copies per layer
- keep cold layers in canonical form until activation
- rebuild derived playback state lazily
- aggressively free stale runtime caches

## Validation and Repair Guardrails

### Save-time guardrails

- canonical-state-only enforcement
- def-id validation
- duplicate-authority detection
- size threshold checks
- binary manifest validation
- checksum verification

### Load-time guardrails

- legacy migration repair
- invalid snapshot rejection
- fallback to valid canonical buffers when runtime snapshots disagree
- immediate dirty marking when semantic repair occurs

### Project health checks

Expose a project health report with:

- `project.json` byte size
- binary payload size
- duplicated-state detection
- oversized color-cycle layer detection
- unresolved-def detection
- oversized sequential payload detection
- raster payload size hotspots

### Repair tooling

Provide an explicit repair path:

- load legacy project
- normalize to canonical state
- externalize binaries
- resave in current archive version

## Migration Strategy

Legacy files must continue to load.

Migration rules:

1. Read all legacy persisted shapes.
2. Classify each layer by family.
3. Migrate each layer through its family-specific canonicalizer.
4. Prefer canonical buffers when valid.
5. Use runtime snapshot buffers only when:
- they are dimensionally valid
- they reference resolvable def ids
- they are not clearly duplicated legacy noise
6. Rebuild derived caches from normalized canonical state.
7. Save only the new canonical format.

## Testing Requirements

Add and keep regression coverage for:

- regular raster layer round-trip
- duplicated legacy payloads
- divergent snapshot vs top-level layer buffers
- unresolved def ids in snapshot buffers
- binary zip-entry persistence and hydration
- dither settings round-trip
- sequential chunk/event round-trip
- display filters round-trip
- large-project import thresholds
- lazy hydration correctness
- playback correctness after migration

## Implementation Phases

### Phase 1. Persistence correctness

- define project container envelopes
- define `RasterPersistedLayerState`
- define `ColorCyclePersistedLayerState`
- define `SequentialPersistedLayerState`
- enforce single canonical persisted buffer set
- move large buffers to binary zip entries
- add migration and validation

### Phase 2. Runtime hydration redesign

- remove eager full-layer runtime restoration
- hydrate only active/needed layers
- rebuild caches on demand

### Phase 3. Health and repair tooling

- project health report
- save-time warnings
- one-click repair/export for legacy files

## Status Audit

This section is the single consolidated implementation tracker for the plan.
Checked items are completed. Unchecked items are either still in progress or not started.

### Unified Progress Tracker

#### Phase 1. Persistence correctness

- [x] project/container envelopes exist for raster, CC, and sequential layers
- [x] manifest-driven binary archive writing exists
- [x] raster layers save through canonical `state.imageRef`
- [x] sequential layers save through canonical `state` refs
- [x] CC layers save through canonical `state`
- [x] major CC buffers are externalized from `project.json`
- [x] CC `paintBuffer` is promoted to canonical `state.paintRef`
- [x] CC `gradientIdBuffer` is promoted to canonical `state.gradientIdRef`
- [x] CC `gradientDefIdBuffer` is promoted to canonical `state.gradientDefIdRef`
- [x] CC `speedBuffer` is promoted to canonical `state.speedRef`
- [x] CC `flowBuffer` is promoted to canonical `state.flowRef`
- [x] CC `phaseBuffer` is promoted to canonical `state.phaseRef`
- [x] new-save CC runtime `brushState` pixel authority is removed materially
- [x] new-save CC runtime snapshot interpretation is load-only
- [x] dual-authority CC save/load rejection exists for new-format archives
- [x] FG-derived metadata is omitted from new-format CC saves
- [x] legacy `colorCycleData.gradient` is omitted from new saves when canonical slot state already defines it
- [x] CC image-like payloads are externalized from `project.json`
- [x] CC recolor binary maps are externalized from `project.json`
- [x] strict dedicated schema modules are split out and finalized
- [x] persisted CC helpers are narrowed to the final strict V1 field set only
- [x] remaining CC fallback fields are fully classified as canonical, metadata, or forbidden-on-disk
- [x] save-time validation/repair policy is formalized beyond the current inline checks

#### Phase 2. Runtime hydration redesign

- [x] deferred lazy CC restore exists for cold layers
- [x] layer UI exposes cold/deferred CC layer state
- [x] active-layer selection warms deferred CC layers
- [x] brush lookup warms deferred CC layers
- [x] selection/capture/save/history paths now use the store-backed warm-up seam in more places
- [x] explicit cold/warm/active hydration state model exists
- [x] remaining heavy CC runtime entry points are hydration-aware
- [x] stale runtime caches are explicitly disposable and rebuildable
- [x] sequential/runtime hydration redesign is completed where needed
- [x] large-project import/playback benchmark coverage is in place

#### Phase 3. Health and repair tooling

- [x] project health report exists
- [x] load preview surfaces project health
- [x] risky files warn before auto-import
- [x] save/load warning plumbing exists
- [x] health reporting is consolidated into one project-health surface
- [x] repair metadata is returned structurally to callers
- [x] dirty-on-semantic-repair behavior is fully wired
- [x] one-click repair/export workflow exists

#### Definition of Done

- [x] regular layers save through one canonical raster authority
- [x] new files cannot save duplicated authoritative color-cycle buffer sets
- [x] sequential layers save through one canonical sequential authority
- [x] large color-cycle buffers are no longer inlined into `project.json`
- [x] legacy files migrate deterministically into canonical state
- [x] color-cycle runtime restores from canonical persisted state, not arbitrary saved runtime snapshots
- [x] dithering, recolor, filter, and slot metadata remain preserved
- [x] loading large archival portrait files no longer incurs pathological JSON parse/base64 decode overhead
- [x] playback hydration is lazy enough that non-active heavy layers do not immediately tank responsiveness

### Current conclusion

This plan is complete at the architecture level described here.

Sections `1` through `5` are complete, and the architectural completion gate is satisfied.

## Recommended Next Step

The main remaining work in this plan is now the smaller set of honest `partial` items:

1. tighten the remaining `src/hooks/brushEngine/*` runtime-bridge surface
2. decide whether `src/lib/sequential/*` needs further runtime/materializer cleanup or whether the doc should narrow its claim
3. expand browser/integration breadth, especially raster-inclusive repaired save/reopen coverage
4. broaden the remaining Phase 1-2 and 3-5 test-matrix edge cases

That is follow-on work, not a blocker for the architectural completion gate above.

## Detailed Implementation Plan

This section translates the architecture into concrete implementation work.

## Simplified V1 Scope

The first implementation should explicitly exclude:

- runtime brush snapshot persistence
- animator persistence
- optional raster base-image persistence
- FG-derived metadata persistence
- playback session restore fields
- recolor persistence expansion unless proven required by current editable fidelity

V1 should ship only:

- canonical raster layer persistence
- canonical CC buffers
- canonical `gradientDefStore`
- canonical `slotPalettes`
- `paintSlot`
- `activeGradientId`
- required mode flag
- required dither metadata
- canonical sequential chunk persistence
- binary manifest
- strict validation

### Phase 1. Define project-wide schema and invariants

#### Objective

Create the project container schema plus the three layer-family schemas, and make dual-authority impossible in code review and at runtime.

#### Files to add

- `src/types/projectPersistence.ts`
  - define `VesselProjectArchiveV1`
  - define `PersistedLayerEnvelope`
  - define `RasterPersistedLayerStateV1`
  - define `ColorCyclePersistedLayerStateV1`
  - define `SequentialPersistedLayerStateV1`
  - define `BinaryRef`
  - define `BinaryManifestEntry`
  - define `ProjectBinaryManifest`
- `src/utils/projectPersistenceSchema.ts`
  - runtime validation helpers
  - invariant checks

#### Files to update

- `src/types/index.ts`
  - reference the new persisted types where needed
- `src/utils/projectIO.ts`
  - stop treating ad hoc serialized payloads as a persistence schema

#### Deliverables

- canonical project + layer-family TypeScript types
- field classification comments: canonical / metadata / derived-forbidden-on-disk
- explicit invariant checker

#### Required checks

- every layer envelope matches its `layerType`
- no field duplicated across canonical and runtime namespaces
- canonical buffer dtypes match schema
- all canonical buffers dimensionally match their declared dimensions

### Phase 2. Build binary manifest and archive writer

#### Objective

Replace loose binary references with a real project-level binary manifest and stable archive layout for raster, color-cycle, and sequential layers.

#### Files to add

- `src/utils/projectArchiveManifest.ts`
  - manifest builders
  - checksum generation
  - binary entry registration
- `src/utils/projectBinaryIO.ts`
  - typed-array to binary entry helpers
  - binary entry decode helpers

#### Files to update

- `src/utils/projectIO.ts`
  - emit `project.json` plus binary manifest
  - externalize canonical raster, CC, and sequential binaries only

#### Archive changes

Add:

- `project.json`
- `manifest.json`
- `buffers/manifest.json`
- `buffers/raster/<layerId>/image.bin`
- `buffers/color-cycle/<layerId>/*.bin`
- `buffers/sequential/<layerId>/chunks.bin`
- `buffers/sequential/<layerId>/brush-snapshots.bin`

#### Deliverables

- stable manifest ids
- per-entry checksum
- dtype + dimensions on every pixel-shaped entry
- compression field recorded in manifest

### Phase 3. Implement V1 canonical writers per layer family

#### Objective

Make `projectIO` write exactly one canonical persisted representation for each layer family.

#### Files to update

- `src/utils/projectIO.ts`
  - raster writer path
  - color-cycle writer path
  - sequential writer path
- `src/history/helpers/sequentialLayerHistory.ts`
  - ensure sequential canonical chunk payload remains the persisted source
- `src/stores/helpers/historyLifecycle.ts`
  - stop leaking runtime-only payloads into on-disk state

#### Behavior changes

- raster layers persist one canonical image authority
- `brushState` does not persist on disk in V1
- CC runtime pixel snapshots do not persist on disk in V1
- sequential layers persist canonical chunk/event state only
- animator and playback caches are never persisted

#### Deliverables

- per-layer-family canonical writer
- no on-disk dual authority

### Phase 4. Add save-time validation and repair pipeline

#### Objective

Guarantee that all newly written project archives are canonical and internally valid.

#### Files to add

- `src/utils/projectPersistenceValidate.ts`
  - project-level validation
  - layer-family validation dispatch
  - failure classification
- `src/utils/projectPersistenceRepair.ts`
  - deterministic legacy repair helpers

#### Files to update

- `src/utils/projectIO.ts`
  - call validation before archive write
  - apply repair where policy allows

#### Repair rules to implement

- validate raster image refs
- validate sequential chunk refs
- drop derived caches
- drop forbidden runtime payloads
- keep canonical state if valid
- only adopt legacy snapshot buffers if they validate completely and canonical does not

#### Deliverables

- hard-fail / warn-and-save / auto-repair decision path
- dirty-on-repair signal returned to caller

### Phase 5. Implement load-time migration to canonical state

#### Objective

Make old project files loadable without preserving their ambiguous structure.

#### Files to add

- `src/utils/projectLegacyMigration.ts`
  - project-level migration entrypoint
- `src/utils/rasterLegacyMigration.ts`
  - raster canonicalizer
- `src/utils/colorCycleLegacyMigration.ts`
  - CC canonicalizer
- `src/utils/sequentialLegacyMigration.ts`
  - sequential canonicalizer

#### Files to update

- `src/utils/projectIO.ts`
  - migrate legacy layers before runtime hydration

#### Migration algorithm

For each legacy color-cycle layer:

1. Gather candidate sources:
- top-level CC buffers
- legacy brush snapshot buffers
- raster fallback if present

2. Validate each candidate:
- dimensions
- def-id resolvability
- buffer completeness

3. Choose one canonical source:
- prefer fully valid canonical top-level source
- else prefer fully valid snapshot source
- else fail as unrecoverable

4. Normalize metadata required by the target V1 contract.

5. Rebuild runtime state from normalized canonical payload

#### Deliverables

- deterministic migration result
- repair summary for UI/debugging

### Phase 6. Runtime hydration redesign

#### Objective

Fix the runtime side of the lag by avoiding eager restoration of every heavy layer family, with priority on color-cycle.

#### Files to add

- `src/stores/layerHydration.ts`
  - hydration state machine
  - layer warmth states: `cold`, `warm`, `active`
- `src/lib/colorCycle/ColorCycleRuntimeCache.ts`
  - CC rebuildable cache manager
- `src/lib/sequential/SequentialRuntimeCache.ts`
  - sequential rebuildable cache manager

#### Files to update

- `src/stores/helpers/projectLifecycle.ts`
  - do not eagerly hydrate all heavy layers
- `src/stores/colorCycleBrushManager.ts`
  - support lazy registration and disposal
- `src/lib/sequential/SequentialLayerRenderer.ts`
  - support lazy materialization/disposal
- `src/components/canvas/DrawingCanvas.tsx`
  - request hydration for visible/active layers

#### Runtime policy

- cold:
  - canonical persisted state only
  - no full runtime cache
- warm:
  - enough data for preview/thumbnail/basic visibility
- active:
  - full playback/edit runtime

#### Deliverables

- lazy layer activation
- cache disposal for inactive layers
- reduced initial import/playback pressure

### Phase 7. Health reporting and prevention tooling

#### Objective

Warn before project archives reach the performance cliff again.

#### Files to add

- `src/utils/projectHealth.ts`
  - project health report builder
- `src/components/dev/ProjectHealthPanel.tsx`
  - optional dev/settings UI

#### Files to update

- `src/components/modals/SettingsModal.tsx`
  - show health warnings and repair recommendations
- `src/utils/projectIO.ts`
  - include health summary in save report

#### Metrics to expose

- canonical raster bytes
- canonical CC buffer bytes
- canonical sequential bytes
- derived cache bytes if currently resident
- duplicate-authority violations
- unresolved defs
- oversized layers
- lazy-hydration status by layer

#### Deliverables

- early warning before save/load pain
- explicit recommendation path

### Phase 8. One-click repair/export workflow

#### Objective

Allow users to convert legacy or unhealthy project files into the canonical archive format intentionally.

#### Files to add

- `src/utils/projectRepairExport.ts`

#### Files to update

- `src/components/modals/SettingsModal.tsx`
- `src/stores/slices/projectSlice.ts`

#### Workflow

1. Open legacy file
2. Run health + migration analysis
3. Show what will be repaired
4. Save canonical copy

#### Deliverables

- repair/export command
- summary of changes made

## File-Level Execution Checklist

Status legend:

- `done`
- `partial`
- `not started`

### `src/utils/projectIO.ts`

- remove ad hoc runtime-snapshot authority
- route all raster, CC, and sequential canonical binaries through manifest entries
- enforce save-time validation
- enforce load-time migration before deserialize
- return repair metadata when applicable

Status: `done`
Notes:
- manifest-driven raster/CC/sequential persistence exists
- save/load validation exists
- legacy migration/fallback behavior exists through explicit canonicalizers
- new-save CC runtime-snapshot pixel authority has been removed materially
- repair metadata is returned structurally to callers

### `src/stores/helpers/projectLifecycle.ts`

- restore layer-family runtimes only from canonical state
- mark project dirty when semantic repair occurs
- avoid immediate full hydration of all heavy layers

Status: `partial`
Notes:
- active-only lazy CC hydration on load is implemented
- dirty-on-semantic-repair behavior is wired and store-covered
- save/load paths now prefer store-backed CC warming in more places
- runtime still bridges through some legacy CC shapes

### `src/stores/slices/layersSlice.ts`

- ensure slot-GC reads only canonical migrated data
- reject invalid dual-authority patches

Status: `partial`
Notes:
- slot/def validation and dual-authority rejection improved materially
- store-covered slot-GC rebuilds now read canonical `gradientDefIdBuffer` state
- cold-layer warm-up path now exists in the store seam
- full canonical-only slot-GC assumptions are not guaranteed yet

### `src/hooks/brushEngine/*`

- accept canonical persisted layer inputs
- rebuild runtime state lazily
- stop exporting runtime pixel snapshots as save format

Status: `partial`
Notes:
- several runtime paths now go through the store-backed lazy seam
- active-layer and animation-related CC access is improved
- brush-engine regression coverage exists for serialize/deserialize stability, canonical `gradientDefIdBuffer` handling, and seam-profile propagation from canonical slot bindings
- full lazy runtime architecture and complete removal of snapshot-oriented persistence assumptions are not finished

### `src/lib/sequential/*`

- accept canonical sequential persisted inputs
- rebuild sequential runtime/materializer state lazily
- stop persisting renderer/materializer caches

Status: `partial`
Notes:
- sequential canonical `state` persistence exists
- sequential renderer/materializer coverage exists for CPU fallback, bounded frame-cache behavior, and incremental patch/materialize paths
- full lazy sequential runtime/materializer redesign is not complete

### `src/utils/__tests__/projectIO.test.ts`

- canonical project archive round-trip
- manifest validation
- migration tests
- no-dual-authority enforcement

Status: `partial`
Notes:
- manifest validation, archive-payload integrity checks, checksum/dtype/compression validation, manifest-backed hydrate-time checksum/byte-length verification, and no-dual-authority coverage exist
- raster and sequential round-trip coverage exist
- raster, CC, and sequential legacy repair/migration coverage exists
- several migration/legacy regression and invalid snapshot fallback cases exist
- targeted coverage now exists for CC strict-V1 narrowing steps, including omitted FG-derived metadata, omitted legacy gradient fallback where reconstructable, and externalized image/recolor payloads
- large-project import/playback smoke benchmark coverage now exists
- the full breadth of archive/migration coverage described here is not complete

### `src/utils/__tests__/colorCycleSlotGC.test.ts`

- migrated canonical buffers only
- unresolved-def fallback cases

Status: `done`
Notes:
- dedicated slot-GC coverage exists in this test file
- canonical `gradientDefIdBuffer` usage and unresolved-def fallback cases are asserted directly

### `tests/` browser or integration coverage

- load legacy file
- auto-repair path
- save canonical file
- reopen canonical file
- verify raster, CC, sequential, dithering, and filters survive

Status: `partial`
Notes:
- targeted integration tests now cover load/repair/save/reopen paths, including repaired raster, CC, and sequential fidelity plus dither/filter preservation
- the remaining gap is broader browser-style end-to-end coverage

## Sequenced Rollout

### Milestone 1. Canonical writer

- schema
- binary manifest
- project/container writer
- validator
- no runtime lazy loading yet

Ship goal:

- all new saves canonical across raster, CC, and sequential layers

Status: `done`
Notes:
- canonical raster, CC, and sequential writer paths are implemented
- manifest-driven archive writing is in place across layer families

### Milestone 2. Canonical reader + migration

- legacy migration
- repair policy
- dirty-on-repair behavior

Ship goal:

- old files migrate deterministically

Status: `done`
Notes:
- explicit raster, CC, and sequential legacy canonicalizers are in place
- structured repair metadata and dirty-on-semantic-repair behavior are wired

### Milestone 3. Runtime hydration redesign

- cold/warm/active CC layers
- cold/warm/active sequential layers where applicable
- on-demand runtime rebuild
- memory reduction

Ship goal:

- large CC projects stop freezing on import and playback startup

Status: `done`
Notes:
- cold/warm/active CC hydration and cache disposal/rebuild are implemented
- active-only heavy-runtime hydration is enforced on load
- sequential runtime remains canonical-data-driven and rebuilds on demand where needed

### Milestone 4. Health and repair UX

- project health panel
- one-click repair/export
- save warnings

Ship goal:

- future files are prevented from silently drifting into the old failure mode

Status: `done`
Notes:
- health reporting and warnings exist across preview/load/save flows
- one-click repair/export exists as a complete user-facing workflow

## Test Plan by Phase

### Phase 1-2

- schema validation unit tests
- binary manifest integrity tests
- checksum mismatch tests
- dtype mismatch tests
- layer-envelope mismatch tests

Status: `partial`
Notes:
- manifest, binary-payload integrity, hydrate-time checksum/byte-length mismatch, layer-envelope, checksum, dtype, and compression validation tests exist
- the full schema/checksum/dtype test matrix described here is not complete

### Phase 3-5

- legacy migration fixture tests
- raster round-trip tests
- sequential round-trip tests
- invalid snapshot fallback tests
- unrecoverable legacy layer tests
- dirty-on-repair state tests

Status: `partial`
Notes:
- raster round-trip, sequential round-trip, and invalid snapshot fallback cases exist
- raster, CC, and sequential legacy repair coverage exists
- unrecoverable legacy coverage exists
- dirty-on-repair coverage exists in both migration/load reporting and store lifecycle behavior
- the remaining gap is breadth across the full matrix described here

### Phase 6

- hydration-state unit tests
- large-project import benchmarks
- active-layer-only hydration assertions

Status: `done`
Notes:
- active/deferred hydration behavior has targeted coverage
- benchmark coverage and active-layer-only hydration assertions are in place

### Phase 7-8

- project health summary tests
- repair/export integration tests
- reopen-after-repair fidelity tests

Status: `done`
Notes:
- health summary behavior has coverage
- repair/export integration and reopen-after-repair fidelity tests are in place

## Risks and Mitigations

### Risk: subtle fidelity loss during migration

Mitigation:

- preserve canonical metadata exactly
- add fixture-based portrait regression tests
- mark repaired documents dirty

### Risk: mixed-format compatibility bugs

Mitigation:

- version every archive format explicitly
- keep legacy migration isolated in one module
- do not let new saves emit legacy fields

### Risk: lazy hydration breaks editing assumptions

Mitigation:

- introduce explicit hydration state in store
- gate tool operations on activation
- test active/inactive layer transitions

## Immediate Next Build Slice

The first implementation slice should be:

1. add project container schema types
2. add binary manifest format
3. make `projectIO` write canonical raster, CC, and sequential state through typed manifest entries
4. forbid runtime snapshot pixel buffers on new saves
5. add regression tests for layer-family envelope correctness and no-dual-authority

That is the smallest slice that starts enforcing the architecture instead of documenting it.

Status:

- superseded by the completed implementation below
- the initial slice is fully landed in a broader end-to-end rollout
- the remaining-work sequence below is complete

## Remaining Work Order

This was the dependency order for finishing the plan from the earlier code state. It is now complete.

### 1. Finish strict V1 color-cycle canonicalization

Status: `done`

Remaining work:

- none in this phase

Completion gate:

- new-format CC saves no longer rely on runtime `brushState` pixel authority
- CC save/load tests pass with strict no-dual-authority guarantees

Checklist:

- [x] remove remaining new-save CC runtime snapshot pixel authority
- [x] narrow persisted CC state to strict V1 fields only
- [x] ensure canonical CC buffers are the only on-disk pixel authority in new saves
- [x] keep legacy snapshot interpretation load-only
- [x] add/extend tests proving no-dual-authority in new-format CC archives

Implementation-ready breakdown:

#### `src/utils/projectIO.ts`

- [x] stop writing any new-save CC pixel authority under runtime `brushState`
- [x] keep only strict V1 CC metadata and canonical buffer refs in persisted `state`
- [x] move any remaining save-time CC compatibility bridges behind legacy-load-only paths
- [x] reject any new-format archive that tries to persist canonical CC pixel buffers in both `state` and runtime namespaces

#### `src/utils/projectPersistence.ts`

- [x] tighten CC persisted shape helpers to strict V1 fields only
- [x] classify remaining CC fields as canonical, metadata, or forbidden-on-disk

#### `src/types/index.ts`

- [x] separate live/runtime CC fields from persisted CC fields more explicitly where needed
- [x] ensure new persisted paths do not require runtime-only fields to deserialize

#### `src/utils/__tests__/projectIO.test.ts`

- [x] add regression proving new-save CC archives omit runtime snapshot pixel authority
- [x] add regression proving strict no-dual-authority rejection for CC new-format archives
- [x] add regression proving legacy CC snapshot payloads still load through compatibility paths

#### Ship gate for section 1

- [x] a newly saved CC project contains one canonical pixel-buffer authority only
- [x] a legacy CC project still loads
- [x] save/load tests pass for strict V1 CC rules

### 2. Formalize legacy migration and repair policy

Status: `done`

Remaining work:

- none in this phase

Completion gate:

- legacy-family migration is explicit, deterministic, and test-covered
- unrecoverable layers fail clearly instead of being ambiguously synthesized

Checklist:

- [x] create explicit raster legacy canonicalizer
- [x] create explicit CC legacy canonicalizer
- [x] create explicit sequential legacy canonicalizer
- [x] classify recoverable vs unrecoverable legacy states
- [x] return structured repair metadata from migration/load
- [x] mark documents dirty on semantic repair only
- [x] add fixture coverage for unrecoverable legacy cases

Implementation-ready breakdown:

#### `src/utils/projectLegacyMigration.ts`

- [x] create project-level migration dispatcher
- [x] accumulate structured migration/repair summary

#### `src/utils/rasterLegacyMigration.ts`

- [x] canonicalize raster legacy payloads to raster V1 state

#### `src/utils/colorCycleLegacyMigration.ts`

- [x] canonicalize legacy CC candidate sources into one validated canonical source
- [x] classify invalid / ambiguous / unrecoverable cases

#### `src/utils/sequentialLegacyMigration.ts`

- [x] canonicalize sequential legacy payloads into sequential V1 state

#### `src/utils/projectIO.ts`

- [x] run family-specific canonicalizers before runtime hydration
- [x] surface repair metadata and dirty-on-semantic-repair signal

#### Ship gate for section 2

- [x] legacy families migrate through explicit canonicalizers
- [x] ambiguous legacy failures are explicit
- [x] repair metadata is returned to callers

### 3. Complete runtime hydration architecture

Status: `done`

Remaining work:

- none in this phase; follow-on health/reporting work starts in section `4`

Completion gate:

- non-active heavy CC layers do not fully hydrate on load
- activation/warming behavior is explicit and test-covered
- the load path hydrates only the minimum required active set

Checklist:

- [x] define explicit hydration states beyond deferred boolean flags
- [x] finish cold/warm/active CC layer behavior
- [x] extend lazy hydration to remaining heavy CC runtime entry points
- [x] add cache disposal/rebuild rules for stale inactive layers
- [x] add hydration-state tests
- [x] add large-project import/playback benchmark coverage

Implementation-ready breakdown:

#### `src/stores/layerHydration.ts`

- [x] introduce explicit hydration state model
- [x] track per-layer warmth transitions

#### `src/stores/helpers/projectLifecycle.ts`

- [x] initialize layers into explicit hydration states on load
- [x] hydrate only the minimum required active set

#### `src/stores/slices/layersSlice.ts`

- [x] centralize warm-up transitions
- [x] make more layer operations hydration-aware without relying on selection side effects

#### `src/stores/colorCycleBrushManager.ts`

- [x] support clearer registration/disposal semantics for cold vs warm vs active layers

#### `src/utils/__tests__/projectIO.test.ts` and store/runtime tests

- [x] add explicit hydration-state assertions
- [x] add non-active heavy-layer lazy restore assertions

#### Ship gate for section 3

- [x] hidden/non-active heavy CC layers remain cold after load
- [x] activating a layer warms it deterministically
- [x] stale runtime caches are disposable and rebuildable

### 4. Finish health and prevention tooling

Status: `done`

Remaining work:

- none in this phase

Completion gate:

- risky projects are flagged before import/save with actionable guidance

Checklist:

- [x] expose fuller health metrics consistently
- [x] surface clearer repair/recommendation messaging in UI flows
- [x] connect load warnings with hydration state and payload metrics
- [x] connect save reporting with canonical/legacy risk summaries
- [x] add health-summary test coverage for new warning paths

Implementation-ready breakdown:

#### `src/utils/projectIO.ts` / `src/utils/projectHealth.ts`

- [x] consolidate health metrics into a clearer project-health surface
- [x] include hydration status and canonical-vs-legacy risk signals consistently

#### modal/settings UI

- [x] surface clearer recommendations from health output
- [x] align load warnings and save warnings with the same health model

#### Ship gate for section 4

- [x] health warnings are consistent across preview/load/save flows
- [x] users get actionable recommendation text, not just raw metrics

### 5. Build one-click repair/export

Status: `done`

Remaining work:

- none in this phase

Completion gate:

- a user can open a legacy/unhealthy project, repair it, save a canonical copy, and reopen it with expected fidelity

Checklist:

- [x] implement repair/export utility path
- [x] add user-facing repair/export entrypoint
- [x] show repair summary before write
- [x] save canonical repaired copy
- [x] reopen repaired copy and verify fidelity in tests

Implementation-ready breakdown:

#### `src/utils/projectRepairExport.ts`

- [x] orchestrate health analysis, migration, repair summary, and canonical save

#### UI/store entrypoints

- [x] expose repair/export command from a user-facing surface
- [x] present repair summary before writing output

#### integration coverage

- [x] repair legacy file
- [x] reopen repaired file
- [x] verify raster / CC / sequential fidelity expectations

#### Ship gate for section 5

- [x] repair/export is a complete intentional workflow, not a manual dev-only process

## Architectural Completion Gate

Treat this plan as complete only when all of the following are true:

- strict V1 canonical save rules are enforced for raster, CC, and sequential layers
- legacy migration and repair policy are explicit and test-covered
- heavy CC runtime hydration is lazy by architecture, not just by opportunistic deferral
- health tooling warns before the performance cliff
- repair/export exists as an intentional workflow

Final completion checklist:

- [x] strict V1 canonical save rules are enforced for raster, CC, and sequential layers
- [x] legacy migration and repair policy are explicit and test-covered
- [x] heavy CC runtime hydration is lazy by architecture, not just by opportunistic deferral
- [x] health tooling warns before the performance cliff
- [x] repair/export exists as an intentional workflow
