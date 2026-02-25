# Plan: Custom Brush Captured Color-Cycle Data

Date: 2026-02-25
Status: Implemented

## Goal
Add a source-faithful custom-brush animation mode that captures color-cycle phase/index behavior from a selected CC region and stamps that behavior during painting.

## Requested UX
In custom-brush color-cycle options, add a top mode switch:
- `Tip Mode`
- `Color Cycle Data`

`Color Cycle Data` should use captured CC payload instead of regenerating phase from only gradient + speed.

## Scope
- Custom brush capture from active color-cycle layer.
- Custom brush metadata persistence (project + local storage).
- Brush engine playback path for captured CC data mode.
- UI mode controls and safe fallback behavior.
- Tests and docs updates.

## Non-goals
- Storing full frame-by-frame animation bitmaps in custom brush payload.
- Rewriting CC layer architecture.
- Breaking schema compatibility with existing custom brushes.

## Design Summary
Do not store literal frame sequences. Store compact per-pixel descriptors:
- per-pixel phase/index map for captured ROI
- optional alpha mask
- source cycle length metadata

At paint time:
- compute current animation phase
- recolor tip pixels using captured map + active gradient
- stamp result using existing custom brush pipeline and controls

This keeps payload bounded and avoids frame-stream bottlenecks.

## Data Contract

### 1) `CustomBrush.colorCycle` schema upgrade
File: `src/types/index.ts`

Current uses `schemaVersion: 1` with gradient/speed/phase metadata only.

Upgrade to discriminated union:
- `schemaVersion: 1` (legacy)
- `schemaVersion: 2` (new)

`schemaVersion: 2` fields:
- `mode: 'tip' | 'captured-data'`
- `source: 'color-cycle-layer' | 'manual' | 'unknown'`
- `gradient?: Array<{ position: number; color: string }>`
- `speed?: number`
- `phaseMode?: 'global' | 'per-stroke-seeded' | 'jittered'`
- `phaseJitter?: number`
- `sourceCycleLength: number`
- `mapWidth: number`
- `mapHeight: number`
- `phaseMap?: Uint16Array`
- `indexMap?: Uint16Array`
- `alphaMask?: Uint8Array`

Validation rules:
- `mapWidth * mapHeight` must match provided map lengths
- clamp `sourceCycleLength` >= 1
- reject malformed payload with graceful fallback to `mode: 'tip'`

## Capture Pipeline

### 2) Capture CC payload from active CC layer
Files:
- `src/components/toolbar/CustomBrushPanel.tsx`
- `src/utils/customBrushCapture.ts`

Behavior:
- only when source is active color-cycle layer (`sampleAllLayers=false`)
- rectangle/freehand capture both supported
- capture tip RGBA as today
- additionally extract CC map payload from aligned ROI:
  - phase/index field (prefer source index semantics from CC buffers)
  - optional alpha mask from tip alpha
  - cycle length metadata

Output:
- saved temp brush gets `colorCycle.schemaVersion=2`
- default `mode='captured-data'` for CC-origin capture
- non-CC capture remains static / `tip` behavior

## Persistence

### 3) Local storage roundtrip
File: `src/utils/customBrushPersistence.ts`

Add `schemaVersion:2` serializer/deserializer:
- encode typed arrays to base64
- validate lengths on load
- drop invalid map payload safely
- preserve legacy `schemaVersion:1`

### 4) Project file roundtrip
File: `src/utils/projectIO.ts`

Extend `SerializedCustomBrush.colorCycle`:
- include v2 fields and typed-array payload (base64)
- restore to typed arrays on load
- keep v1 compatibility

### 5) Preset bridge
File: `src/utils/customBrushPreset.ts`

Ensure custom brush preset handoff keeps v2 colorCycle payload intact.

## UI Plan

### 6) Add top mode group in custom brush CC options
File: `src/components/toolbar/BrushControls.tsx`

In the existing active custom-brush CC block, add:
- `ButtonGroup`: `Tip Mode | Color Cycle Data`

Panel behavior:
- `Tip Mode`: existing controls (gradient, bands, speed, phase mode, jitter)
- `Color Cycle Data`:
  - status (`Captured` / `Not captured`)
  - metadata (`Map WxH`, `Cycle Length`)
  - optional toggles (`Use Alpha Mask`, fallback messaging)
  - if payload missing, disable and show recapture hint

Conflict handling:
- controls that override captured semantics are hidden/disabled or explicitly labeled in `Color Cycle Data` mode.

## Runtime / Brush Engine

### 7) Extend custom brush stroke payload
Files:
- `src/hooks/canvas/utils/customBrushData.ts`
- `src/hooks/brushEngine/BrushEngineFacade.ts`

Pass captured CC payload through `CustomBrushStrokeData`.

### 8) Captured-data stamp path
Files:
- `src/hooks/brushEngine/BrushEngineFacade.ts`
- `src/hooks/brushEngine/shapes.ts` (cache integration)

Behavior in `mode='captured-data'`:
- compute runtime phase offset from speed/time/phase mode
- resolve pixel color from captured phase/index map + gradient
- preserve tip shape via alpha mask
- reuse cached canvases per `(brushId, size, gradientHash, phaseBucket, mode)`

Keep existing `Tip Mode` untouched.

## Store Wiring

### 9) Selection restore and defaults
File: `src/stores/slices/toolsSlice.ts`

When selecting custom brush:
- hydrate `schemaVersion:2` metadata
- initialize UI mode correctly
- fall back to `tip` if payload absent/invalid

## Performance Guardrails

### 10) Avoid lag from payload size
- no frame-by-frame animation storage
- typed arrays only; no per-stamp allocations
- cache bounded (LRU/size caps)
- optional capture-size cap/downsample for very large ROI

## Test Plan

### 11) Update tests
- `src/utils/__tests__/customBrushPersistence.test.ts`
  - v2 roundtrip + malformed payload fallback
- `src/utils/__tests__/projectIO.test.ts`
  - project save/load with v2 payload
- `src/components/toolbar/__tests__/CustomBrushPanel.test.tsx`
  - CC capture produces v2 payload (rect + freehand)
- `src/components/toolbar/__tests__/BrushControls.colorCycle.test.tsx`
  - mode group renders and switches panels
- `src/hooks/brushEngine/__tests__/customColorCyclePhase.test.ts`
  - phase semantics remain deterministic
- add focused brush-engine test for captured-data stamp recolor behavior

## Validation Checklist
- `npm run type-check`
- `npm run lint`
- `npm test`
- manual sanity:
  - capture from CC layer -> `Color Cycle Data` mode active
  - paint with custom brush reproduces source-like animation structure
  - save/load project preserves payload
  - local storage hydration preserves payload

## Rollout Sequence
1. [x] Types + serializers (v2 schema) with fallback.
2. [x] Capture pipeline writes v2 payload.
3. [x] UI mode group and panel separation.
4. [x] Brush engine captured-data render path + caching.
5. [x] Tests + docs updates.

## Risks and Mitigations
- Risk: large captured brushes impact memory.
  - Mitigation: size cap/downsample + bounded caches.
- Risk: mode confusion in UI.
  - Mitigation: explicit labels/status and safe fallback.
- Risk: compatibility regressions.
  - Mitigation: strict v1 support and defensive decoding.

## Implementation Notes (2026-02-25)
- Added v2 custom brush color-cycle schema with mode/source/map metadata and typed-array payloads.
- Added defensive v1/v2 normalization + base64 serialization/deserialization for local storage and project IO.
- Added capture-time extraction for CC-origin brushes (`phaseMap` + optional `indexMap` + `alphaMask`) and defaulted CC-origin capture to `captured-data`.
- Added custom brush CC mode switch UI: `Tip Mode` and `Color Cycle Data`, metadata panel, alpha-mask toggle, and safe fallback messaging.
- Added captured-data runtime recolor path in brush engine with bounded palette/pattern caches.
- Updated tests for persistence roundtrip, project IO roundtrip, panel capture behavior, controls mode UX, and captured-data rendering semantics.

## Validation Results (2026-02-25)
- `npm run type-check` passed
- `npm run lint` passed
- `npm test` passed
