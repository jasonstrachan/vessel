# True Stroke Data Plan for Custom Color-Cycle Brushes

## Goal
Preserve and replay captured color-cycle custom brushes with **true source stroke semantics**, including mixed gradients within a single captured region, instead of collapsing playback to a single active gradient.

## Current Problem
Current custom CC capture stores:
- Per-pixel phase/index-like map (`phaseMap`/`indexMap`)
- Optional alpha mask
- A single gradient payload

At replay, pixels are resolved through one active gradient palette. If source content used multiple gradients/defs/slots, that structure is lost.

## Desired End State
Captured custom CC payload should preserve:
- Per-pixel phase/index data
- Per-pixel gradient identity data
- Referenced gradient definitions/slot palettes

Replay should resolve each pixel through its original gradient identity + phase progression, with deterministic behavior and acceptable performance.

## Scope
In scope:
- Custom brush capture from CC layers (`rectangle` + `freehand` modes)
- Payload schema changes for custom brush CC v2+ format
- Replay/runtime changes for `captured-data` mode
- Storage serialization/deserialization updates
- Tests + migration behavior

Out of scope:
- Rewriting full CC layer architecture
- Breaking legacy custom brush payloads

## Architecture Changes

### 1. Payload Model Extension
Add a new schema version (recommended `schemaVersion: 3`) for custom brush color-cycle payloads.

Proposed fields:
- `mode: 'captured-data' | 'tip'`
- `mapWidth`, `mapHeight`
- `sourceCycleLength`
- `phaseMap?: Uint16Array` (or `indexMap` fallback)
- `alphaMask?: Uint8Array`
- `gradientIdMap?: Uint16Array` (or `Uint8Array` when bounded)
- `gradientDefs?: Array<{ defId: number; slot?: number; stops: GradientStop[]; kind?: 'linear' | 'concentric'; hash?: string }>`
- `defaultGradientDefId?: number` (fallback)
- `useAlphaMask`

Compatibility:
- Keep v1/v2 support unchanged.
- v3 replay path only when `gradientIdMap + gradientDefs` exist.

### 2. Capture Pipeline Upgrade
In `captureColorCycleDataFromLayer`:
- Read runtime snapshot from CC brush (`getLayerSnapshot`) including:
  - `paintBuffer`
  - `gradientDefIdBuffer` (preferred)
  - fallback `gradientIdBuffer`
- Crop all relevant maps to capture bounds.
- Build compact local def table:
  - Collect unique def IDs in cropped map.
  - Fetch matching defs/stops from layer (`gradientDefStore`, `slotPalettes`, `gradientDefs`).
  - Remap sparse/global IDs to compact local IDs if beneficial.
- Save remapped `gradientIdMap` + compact `gradientDefs` into payload.

Fallback rules:
- If no gradient ID buffer exists, produce v2-compatible payload (single-gradient behavior).
- If defs cannot be resolved, preserve map with `defaultGradientDefId` fallback.

### 3. Replay/Rendering Upgrade
In captured-data stamping path:
- For each stamped pixel:
  - Read phase/index value.
  - Read per-pixel gradient ID.
  - Resolve palette/LUT by gradient ID.
  - Apply phase offset.
  - Write RGBA (respect alpha mask).

Performance-sensitive design:
- Precompute/cache palette LUT per gradient ID and cycle length.
- Avoid object lookups in inner loops (array-indexed structures only).
- Use fast-path when payload has one gradient ID only.
- Retain old path for v1/v2 payloads.

### 4. Serialization / Persistence
Update `customBrushColorCycle` serialization helpers:
- Encode/decode `gradientIdMap` and def table for v3.
- Keep base64 strategy consistent with existing typed-array encoding.
- Versioned decode path:
  - v1/v2 untouched
  - v3 robust with bounds checks and fallback to `tip` mode if corrupted.

### 5. Type System Updates
Extend shared types:
- `CustomBrushColorCycleV3`
- Union: `CustomBrushColorCycleData = V1 | V2 | V3`
- Strong discriminants for replay branch safety.

## Performance Strategy

### Data Size Controls
- Prefer `Uint8Array` for gradient map when unique defs <= 255.
- Use `Uint16Array` only when necessary.
- Tight bound cropping only (no full-canvas payloads).
- Optional RLE/delta compression considered only if profiling demands it.

### Runtime Controls
- Palette cache keyed by `(gradientDefId, cycleLength, gradientHash)`.
- Cache reuse across stamps for same brush payload.
- Branch once per brush render path; avoid per-pixel schema branching.
- Early exit on alpha=0 pixels.

### Risk Gates
Set performance budgets:
- `<= 15%` regression for heavy custom brush stamping benchmark.
- `<= 25%` payload size increase for typical single-gradient captures.
- No regressions in non-CC and standard CC brush paths.

## Migration & Compatibility

### Backward Compatibility
- Existing saved brushes (v1/v2) continue to load and replay as today.
- New captures may produce v3 payload.
- Optional feature flag for staged rollout:
  - `customBrushTrueCcPayloadV3`

### Failure Modes
If payload invalid/corrupt:
- Fallback to existing single-gradient captured-data behavior.
- If maps missing, fallback to `tip` mode.

## Test Plan

### Unit Tests
1. Capture:
- Captures `gradientDefIdBuffer` region correctly.
- Builds compact def table and remaps IDs correctly.
- Falls back gracefully when def buffers missing.

2. Serialization:
- v3 round-trip preserves maps/defs exactly.
- Invalid payloads sanitize safely.

3. Replay:
- Multi-gradient payload renders expected pixel colors (deterministic fixture).
- Single-gradient fast-path matches legacy output.

### Integration Tests
1. Capture mixed-gradient region from CC layer -> create custom brush -> stamp -> verify per-pixel gradient identity preserved.
2. Save project + reload -> stamp again -> output parity.
3. Undo/redo around custom brush usage remains stable.

### Performance Tests
- Benchmark stamping with:
  - single-gradient payload
  - 2-4 gradient payload
  - high-size capture payload
- Track frame time and allocation deltas.

## Implementation Phases

### Phase 1: Data Contracts
- Add v3 types.
- Add serializer/deserializer support.
- Add sanitizer and guardrails.

### Phase 2: Capture Enrichment
- Crop gradient ID maps from snapshot.
- Resolve/build gradient defs table.
- Emit v3 payload when data available.

### Phase 3: Replay Engine
- Implement v3 rendering path with caches.
- Add single-gradient fast-path.
- Keep v2 branch untouched.

### Phase 4: Validation & Hardening
- Add unit/integration/perf tests.
- Compare before/after render outputs.
- Tune hot loops and caches.

### Phase 5: Rollout
- Optional feature flag burn-in.
- Enable by default after perf + stability gates pass.

## Definition of Done
- Mixed-gradient CC capture preserves per-pixel gradient identity through custom brush replay.
- v1/v2 payload behavior unchanged.
- Tests added and passing:
  - `npm test`
  - `npm run type-check`
  - `npm run lint`
- No significant perf regressions beyond agreed thresholds.
- Docs updated for payload schema and behavior.

## Concrete File Targets
- `src/types/index.ts`
- `src/utils/customBrushCapture.ts`
- `src/utils/customBrushColorCycle.ts`
- `src/hooks/brushEngine/BrushEngineFacade.ts`
- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` (if required for parity)
- `src/utils/__tests__/customBrushCapture.test.ts`
- `src/hooks/brushEngine/__tests__/BrushEngineFacade.customCapturedData.test.ts`
- Additional integration tests under `src/hooks/canvas/handlers/colorCycle/__tests__/` or `tests/`

## Open Decisions
1. Gradient identity source of truth for v3 capture:
- Prefer `gradientDefIdBuffer` always when present.
- Fallback to slot `gradientIdBuffer` + slot palette resolution.

2. Gradient map storage width:
- Adaptive (`Uint8`/`Uint16`) vs always `Uint16`.

3. Rollout approach:
- Immediate default vs feature-flagged rollout.

## Recommended Defaults
- Use `gradientDefIdBuffer` as authoritative source when available.
- Adaptive map width to reduce memory.
- Ship behind short-lived feature flag, then enable by default after perf gate passes.
