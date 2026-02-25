# Plan: Digital-Native Brush Program + Secondary Effects

## Goal
Ship digital-native brush systems that center on indexed color, dithering, pixel sorting, and algorithmic transforms (not skeuomorphic media emulation).

Program tracks:
1. Primary track (current): `Run-Sort`, `Palette-Sort`, `Indexed Pulse`, `Dither Morph`.
2. Secondary track (after primary): `Magnetic Ink`, `Pixel Sort`, `Dither Pulse`, `Ink Bleed Diffusion`.

Secondary-track detail is retained below, but implementation priority is now digital-native first.

Legacy secondary set:
1. `Magnetic Ink` brush (snap-to-nearby-stroke behavior for calligraphic pulling).
2. `Pixel Sort Brush` (directional glitch dragging/sorting of sampled pixels).
3. `Dither Pulse` animated shader/material (temporal ordered-dither pulse).
4. `Ink Bleed Diffusion` animated shader/material (outward alpha diffusion over time).

This plan is implementation-first and mapped to current Vessel architecture.

## Non-Negotiables
- No mock-only confidence for final validation: run integration/E2E checks for brush interaction and playback.
- Preserve existing behavior for current brushes and Color Cycle paths.
- Keep basePath/export constraints intact (`/vessel`, static export).
- Avoid per-frame heavy allocations; reuse buffers/canvas pools and worker offload where needed.

## Scope
In scope:
- Brush settings model updates (`src/types/index.ts`, tool slice wiring).
- Preset additions (`src/presets/brushPresets.ts`).
- Runtime brush logic integration in engine paths (`src/hooks/useBrushEngineSimplified.ts`, `src/hooks/brushEngine/*`).
- New reusable compute helpers in `src/utils` and optional worker offload in `src/workers`.
- Animated material/shader integration across WebGL + CPU fallback renderers.
- Automated tests for unit + integration + worker contract.

Out of scope (phase-later):
- New export formats.
- Replacing current Color Cycle architecture.
- Full brush plugin migration for all legacy brush kinds.

Priority constraint:
- All new execution work starts with the digital-native primary track.
- Secondary-track items are queued only after primary track Phase DN-5 exit criteria pass.

## Execution Path Matrix
- `Magnetic Ink`: standard brush stroke path in `src/hooks/useBrushEngineSimplified.ts` (Canvas2D stamp pipeline).
- `Pixel Sort Brush`: standard brush stroke path in `src/hooks/useBrushEngineSimplified.ts` with ROI transform pass.
- `Dither Pulse`:
  - Phase A: standard brush stroke preview/final in brush engine (primary target).
  - Phase B: optional Color Cycle layer playback parity via `src/lib/ColorCycleAnimator.ts` + renderers.
- `Ink Bleed Diffusion`:
  - Phase A: standard brush stroke/layer composite pass (primary target).
  - Phase B: optional Color Cycle playback parity path.

Rule: no feature is considered complete unless it works in the standard brush pipeline first.

## Existing Codepaths to Reuse
- Brush settings and feature flags:
  - `src/types/index.ts`
  - `src/stores/slices/toolsSlice.ts`
  - `src/presets/brushPresets.ts`
- Brush runtime + dithering utilities:
  - `src/hooks/useBrushEngineSimplified.ts`
  - `src/hooks/brushEngine/dithering.ts`
  - `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
- Animated renderer pipeline:
  - `src/lib/ColorCycleAnimator.ts`
  - `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts`
  - `src/lib/colorCycle/rendering/CPUColorCycleRenderer.ts`
- Worker patterns + tests:
  - `src/workers/colorCycleFill.worker.ts`
  - `src/workers/colorCycleFillTypes.ts`
  - `src/workers/colorCycleFillClient.ts`
  - `src/workers/__tests__/colorCycleFill.worker.contract.test.ts`

## Shared Architecture Decisions

### 1) Feature Gating and Rollout
Add feature flags in `src/config/featureFlags.ts`:
- `brushMagneticInk`
- `brushPixelSort`
- `shaderDitherPulse`
- `shaderInkBleedDiffusion`
- `brushRunSort`
- `brushPaletteSort`
- `brushIndexedPulse`
- `brushDitherMorph`

Default: disabled in production until integration pass is complete.

### 2) Unified Animated Material Surface
Add an internal material config consumed by brush runtime and renderers:
- `material.type: 'none' | 'dither-pulse' | 'ink-bleed-diffusion'`
- `material.params` object per type.

This avoids one-off booleans and keeps future shader features composable.

Material ownership:
- Brush engine owns primary behavior for non-Color-Cycle strokes.
- Color Cycle renderer integration is parity/extension, not the sole implementation target.

### 3) Determinism + History
- Persist only settings needed to replay/restore behavior.
- Keep transient buffers/runtime state non-serializable (as today).
- Snapshot compatibility: old projects load with safe defaults.

### 4) Performance Constraints
- Main-thread target during drawing: <= 2 ms average brush compute on 1080p canvas at medium brush size.
- Heavy per-pixel transforms (pixel-sort/diffusion) must support ROI processing and worker offload.
- WebGL path must have CPU parity fallback with same visual class (not bit-exact).

## Data Model and Settings Plan

### Additions to `BrushSettings` (`src/types/index.ts`)
- `magneticInkEnabled?: boolean`
- `magneticRadiusPx?: number` (4-256)
- `magneticStrength?: number` (0-1)
- `magneticFalloff?: 'linear' | 'smoothstep' | 'gaussian'`
- `magneticSampleStride?: number` (1-8)

- `pixelSortEnabled?: boolean`
- `pixelSortMode?: 'luma' | 'hue' | 'saturation'`
- `pixelSortWindowPx?: number` (4-128)
- `pixelSortThreshold?: number` (0-1)
- `pixelSortDirectionJitter?: number` (0-1)
- `pixelSortSmearMix?: number` (0-1)

- `animatedMaterial?: 'none' | 'dither-pulse' | 'ink-bleed-diffusion'`
- `ditherPulseStrength?: number` (0-1)
- `ditherPulseRateHz?: number` (0.1-12)
- `ditherPulsePixelSize?: number` (1-16)
- `ditherPulsePattern?: 'bayer4' | 'bayer8'`

- `inkBleedRadiusPx?: number` (1-64)
- `inkBleedRate?: number` (0-1)
- `inkBleedNoise?: number` (0-1)
- `inkBleedEdgeDarken?: number` (0-1)

Digital-native additions:
- `runSortEnabled?: boolean`
- `runSortThreshold?: number` (0-1)
- `runSortMinLength?: number` (1-64)
- `runSortMaxLength?: number` (1-512)
- `runSortDirection?: 'asc' | 'desc' | 'alternate' | 'pingpong'`
- `runSortMix?: number` (0-1)
- `runSortPostDither?: boolean`

- `paletteSortEnabled?: boolean`
- `paletteSortWindowPx?: number` (4-256)
- `paletteSortKey?: 'luma' | 'hue' | 'saturation' | 'distance-to-fg' | 'gradient-position'`
- `paletteSortDirection?: 'tangent' | 'normal' | 'radial' | 'spiral'`
- `paletteSortMix?: number` (0-1)
- `paletteSortPostDither?: boolean`

- `indexedPulseEnabled?: boolean`
- `indexedPulseRateHz?: number` (0.1-12)
- `indexedPulseDepth?: number` (0-1)
- `indexedPulseWaveform?: 'sine' | 'triangle' | 'stepped'`
- `indexedPulseSync?: 'global' | 'stroke' | 'tile'`
- `indexedPulseSteps?: number` (2-64)

- `ditherMorphEnabled?: boolean`
- `ditherMorphSource?: 'pressure' | 'velocity' | 'time' | 'manual'`
- `ditherMorphPhase?: number` (0-1)
- `ditherMorphRateHz?: number` (0.1-12)
- `ditherMorphPixelSize?: number` (1-16)
- `ditherMorphSerpentine?: boolean`

### Settings Precedence and Compatibility
- Precedence order:
  1. `animatedMaterial` (new)
  2. Feature-specific enable flags (`pixelSortEnabled`, `magneticInkEnabled`)
  3. Legacy dither flags (`ditherEnabled`, `ditherAlgorithm`, etc.)
- If `animatedMaterial !== 'none'`, legacy dither settings are treated as secondary unless explicitly bridged.
- `ditherEnabled` is not auto-forced by `animatedMaterial`; UI shows an explicit compatibility hint.
- Existing projects without new fields default to:
  - `animatedMaterial: 'none'`
  - all new effect toggles disabled
- Migration must be no-op for old presets/history entries.

### Store/Preset/UI Wiring
- Extend defaults and persistence paths in `src/stores/slices/toolsSlice.ts`.
- Add primary digital-native presets in `src/presets/brushPresets.ts`:
  - `run-sort`
  - `palette-sort`
  - `indexed-pulse`
  - `dither-morph`
- Add secondary-track presets in `src/presets/brushPresets.ts`:
  - `magnetic-ink`
  - `pixel-sort`
  - `dither-pulse`
  - `ink-bleed`
- Add controls where existing brush settings are surfaced (reuse existing slider/toggle patterns).

## Feature Implementation Details

## A) Magnetic Ink Brush

### Behavior
While drawing, stroke points are attracted toward nearby painted edges/strokes within a search radius. Attraction is blended with pointer path to preserve user control.

### Algorithm (v1)
1. Build a local attraction field from nearby alpha/edge data around current pointer.
2. Compute closest N attractor points (or weighted centroid) inside `magneticRadiusPx`.
3. Derive pull vector `P` with falloff and clamp by `magneticStrength`.
4. Apply blended point:
   - `p' = lerp(pointerPoint, pointerPoint + P, magneticStrength)`
5. Feed `p'` into existing stamp spacing and pressure pipeline.

### Integration
- New helper module: `src/utils/magneticField.ts`
- Hook into stamp placement path in `src/hooks/useBrushEngineSimplified.ts`.
- Reuse existing canvas/image sampling strategy from current brush internals where possible.

### Performance
- Use stride sampling (`magneticSampleStride`) and ROI bounds.
- Cache edge mask per stroke segment; invalidate only when required.

### Tests
- Unit: falloff/pull vector correctness for deterministic fixtures.
- Integration: stroke drawn near existing line visibly converges; far-away stroke unaffected.

## B) Pixel Sort Brush

### Behavior
For each stamp region, sample source pixels along stroke direction and locally sort them (luma/hue/saturation), then write back blended result for glitch smear effect.

### Algorithm (v1)
1. Define oriented ROI from stamp center, `pixelSortWindowPx`, and stroke tangent.
2. Read ROI pixels into linear buffer.
3. Partition into scanlines parallel to stroke direction.
4. For each scanline:
   - Detect sortable runs using `pixelSortThreshold`.
   - Sort run by selected key (`luma|hue|saturation`).
5. Blend sorted result with source by `pixelSortSmearMix`.
6. Write ROI back to destination.

### Integration
- New module: `src/utils/pixelSortBrush.ts`
- Brush engine call site in `src/hooks/useBrushEngineSimplified.ts`.
- For large ROI or high stamp counts, use worker offload:
  - `src/workers/pixelSort.worker.ts`
  - `src/workers/pixelSortClient.ts`
  - `src/workers/pixelSortTypes.ts`

### Performance
- Hard cap ROI area in v1 (fallback to smaller window if exceeded).
- Reuse typed arrays from pool to avoid GC churn.
- Worker path uses transferables for ROI buffers.

### Worker Contract (required)
- Follow existing client pattern from `src/workers/colorCycleFillClient.ts`:
  - browser-only guards (`typeof window !== 'undefined'`)
  - module worker first; resilient fallback path
  - explicit error propagation with stable error messages
- Message types are versioned and strongly typed (`*Types.ts`).
- ROI buffers are transferred, not cloned.
- Worker tests include:
  - unit/contract
  - malformed-message resilience
  - termination/error cleanup behavior

### Tests
- Unit: sorting key comparators + run detection.
- Worker contract tests similar to existing fill worker tests.
- Integration: directional stroke produces stable sorted smear with no crashes.

## C) Dither Pulse Animated Shader/Material

### Behavior
Applies temporal ordered-dither modulation to stroke/layer output, producing retro pulsing gradients while preserving palette character.

### GPU Path (WebGL)
- Extend shader uniforms in `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts`:
  - `uPulseTime`, `uPulseStrength`, `uPulsePixelSize`, `uPulsePattern`, `uMaterialType`
- Ordered threshold sampled from deterministic Bayer matrix (4x4 or 8x8).
- Pulse function:
  - `pulse = 0.5 + 0.5 * sin(2pi * rateHz * time + phase)`
- Final color quantization threshold modulated by `pulse * strength`.

### CPU Fallback
- Mirror logic in `src/lib/colorCycle/rendering/CPUColorCycleRenderer.ts` with LUT/table helpers to limit per-pixel math.

### Integration
- Phase A (required): wire through brush runtime path in `src/hooks/useBrushEngineSimplified.ts`.
- Phase B (optional parity extension): pass parameters through animator (`src/lib/ColorCycleAnimator.ts`) and Color Cycle renderers.
- Ensure parity for preview/final and live animation in each enabled path.

### Tests
- Renderer tests for uniform plumbing and fallback parity class.
- Integration playback test to ensure no frame stalls/regressions.

## D) Ink Bleed Diffusion Animated Shader/Material

### Behavior
Simulates pigment diffusion outward from painted alpha regions over time with subtle noise breakup and optional edge darkening.

### v1 Simulation Strategy
- ROI-local iterative diffusion, not full-canvas global sim.
- Maintain per-layer diffusion state buffers (alpha + optional pigment density).
- Each animation tick:
  1. Dilate/blur alpha locally by `inkBleedRadiusPx`.
  2. Blend toward diffusion target using `inkBleedRate`.
  3. Apply noise perturbation (`inkBleedNoise`) for organic edges.
  4. Apply optional dark edge weighting (`inkBleedEdgeDarken`).

### GPU Path
- Add a lightweight post-pass in WebGL renderer for diffusion material type.
- If WebGL budget unavailable, fall back to CPU path.

### CPU/Worker Path
- Phase A: CPU pass in brush/composite runtime with separable kernel optimization.
- Phase B parity: CPU fallback in `CPUColorCycleRenderer`.
- Worker option for large affected regions:
  - `src/workers/inkBleed.worker.ts`
  - `src/workers/inkBleedClient.ts`
  - `src/workers/inkBleedTypes.ts`

### Tests
- Unit tests for diffusion kernel and edge-darken math.
- Worker contract tests.
- Integration test: alpha expands over ticks and remains bounded/stable.

## Delivery Phases

### Phase DN-0: Digital-Native Foundations (1-2 days)
- Add digital-native settings fields + defaults + presets + flags.
- Add index-domain helper interfaces (`runSort`, `paletteSort`, pulse metadata, morph selector).
- Add deterministic seed strategy for static brushes.

Exit criteria:
- Flags off => no behavior changes.
- New settings serialize/rehydrate safely.

### Phase DN-1: Run-Sort Brush (2-3 days)
- Implement run detection + sorting in oriented ROI.
- Add post-dither option and history-safe commit behavior.
- Add unit + integration tests.

Exit criteria:
- Stable deterministic output for same input/seed.
- No per-stamp history writes.

### Phase DN-2: Palette-Sort Brush (2-3 days)
- Implement index-domain sort by selected key/direction.
- Reuse ROI/scalar comparator primitives from Run-Sort/Pixel Sort.
- Add tests and perf checks.

Exit criteria:
- Index-domain transforms (not raw RGB sort) verified in tests.
- Interactive performance within benchmark budgets.

### Phase DN-3: Indexed Pulse Brush (2-3 days)
- Implement pulse metadata buffer and renderer-time index remap.
- Add CPU/WebGL parity logic for remap semantics.
- Add animation correctness tests.

Exit criteria:
- Pulse behavior works as animated-only feature.
- No animation tick history pollution.

### Phase DN-4: Dither Morph Brush (3-4 days)
- Implement morph drivers (`pressure`, `velocity`, `manual`, `time`).
- Add morph chain and interpolation behavior.
- Validate deterministic behavior for non-time modes.

Exit criteria:
- Time-mode animation and non-time deterministic modes both pass tests.
- Dither morph chain quality validated against fixtures.

### Phase DN-5: Hardening + Release (2 days)
- Full regression on tools/history/save/load/perf.
- Tune defaults and preset ergonomics for digital-native workflow.
- Enable primary-track flags gradually.

Exit criteria:
- End-to-end validation complete for primary track.
- Documentation updated with workflow examples.

### Phase 0: Foundations (1-2 days)
- Add settings types, defaults, presets, and feature flags.
- Add no-op plumbing for animated material selection.
- Add initial UI controls hidden behind feature flags.
- Add explicit compatibility/migration table for old settings.

Exit criteria:
- Build/type/lint green.
- No behavior change when flags are off.

### Phase 1: Magnetic Ink (2-3 days)
- Implement magnetic helper and engine integration.
- Add unit + integration tests.
- Tune falloff defaults for calligraphy feel.

Exit criteria:
- Deterministic pull behavior in tests.
- Interactive performance acceptable at medium canvas sizes.

### Phase 2: Pixel Sort Brush (3-4 days)
- Implement main-thread ROI sorter.
- Add worker offload for large ROI.
- Add tests and guardrails.
- Add undo/redo transaction semantics for ROI writeback (`begin -> append -> commit` per stroke).

Exit criteria:
- Stable sorting effect at 60fps target for moderate stroke velocity.
- Worker path verified via contract tests.

### Phase 3: Dither Pulse Material (2-3 days)
- Implement Phase A brush pipeline support first.
- Implement optional WebGL uniforms + shader logic for Color Cycle parity.
- Implement CPU fallback parity.
- Add renderer/integration tests.

Exit criteria:
- Pulse effect visible and configurable.
- No animation regressions in existing color-cycle rendering.

### Phase 4: Ink Bleed Diffusion Material (3-5 days)
- Implement Phase A diffusion sim in brush/composite path (CPU first), then optional WebGL parity post-pass.
- Add worker path for large ROI.
- Add tests and perf profiling.

Exit criteria:
- Organic bleed behavior with bounded cost.
- No memory leaks over sustained playback.

### Phase 5: Hardening + Release (2 days)
- Regression sweep on brushes/layers/history/export.
- Tune defaults and clamp rules.
- Enable feature flags gradually.

Exit criteria:
- End-to-end manual + automated validation complete.
- Docs updated with usage notes and known limits.

## Validation Plan

### Automated
Run at minimum:
- `npm run type-check`
- `npm run lint`
- `npm test`

Add/extend tests in:
- `src/hooks/brushEngine/__tests__/`
- `src/lib/__tests__/`
- `src/workers/__tests__/`
- `tests/canvas/` (integration coverage for history + interactive brush flows)

### History/Undo Integration (required)
- Run-Sort + Palette-Sort + Pixel Sort:
  - commit as one history action per pointer stroke.
  - no per-stamp snapshot writes.
- Animated modes (Indexed Pulse, time-based Dither Morph, Dither Pulse, Ink Bleed):
  - persist settings in stroke/layer state.
  - animation tick updates must not create history entries.
- Rehydrate path must restore visuals from serialized state without requiring live runtime caches.

### Integration/E2E Scenarios
1. Draw `Run-Sort` strokes with fixed seed/input twice; verify deterministic match and undo/redo correctness.
2. Draw `Palette-Sort` strokes over varied indexed palettes; verify index-domain sort behavior and no RGB-path regressions.
3. Animate `Indexed Pulse` in CPU and WebGL parity paths; verify index remap semantics match.
4. Use `Dither Morph` in `pressure` and `time` modes; verify deterministic non-time mode and stable temporal mode.
5. Draw `Magnetic Ink` and `Pixel Sort` regression scenarios to protect secondary-track behavior.
6. Animate `Dither Pulse`/`Ink Bleed Diffusion` parity scenarios where enabled.
7. Project save/load with new settings fields; verify backward compatibility.

### Performance Checks
- Use existing performance instrumentation (`CC_PERF`, relevant probes) and add focused timing markers for new passes.
- Validate no major frame-time regressions in `DrawingCanvas` interaction.

Benchmark protocol:
1. Scene A: 1920x1080, single layer, medium brush size, 10 second continuous stroke.
2. Scene B: 4k canvas, 3 layers visible, fast pointer sweep.
3. Scene C: animated playback active with 2 effect-enabled layers.

Pass thresholds:
- p95 frame time increase <= 20% vs baseline on Scene A.
- no sustained main-thread long tasks > 50 ms during Scene B.
- memory growth returns to steady-state after 30 seconds idle post Scene C.

## Risk Register and Mitigations
- Risk: Per-frame pixel processing causes frame drops.
  - Mitigation: ROI constraints, typed-array pools, worker offload.
- Risk: CPU/WebGL visual divergence for animated materials.
  - Mitigation: shared parameter semantics, parity tests with tolerance bands.
- Risk: Store bloat and migration breakage.
  - Mitigation: optional settings with safe defaults; explicit migration guards.
- Risk: Undo/redo edge cases for stateful effects.
  - Mitigation: integration tests around stroke commit + history lifecycle.

## Definition of Done
All are required:
1. Primary digital-native set implemented with settings and presets:
   - `Run-Sort`, `Palette-Sort`, `Indexed Pulse`, `Dither Morph`
2. Feature flags allow safe rollout and default-off gating.
3. Type-check/lint/test all passing.
4. Integration tests cover interaction + animation + history.
5. Manual validation completed for drawing, playback, save/load.
6. Documentation updated (this plan + follow-up implementation notes).

## Suggested First Execution Slice (Updated Priority)
To de-risk fastest and align with digital-native goals:
1. Ship `Run-Sort` first.
2. Ship `Palette-Sort` second.
3. Ship `Indexed Pulse` third.
4. Ship `Dither Morph` fourth.
5. Queue `Magnetic Ink`, `Pixel Sort`, `Dither Pulse`, `Ink Bleed Diffusion` after primary track completion.

## Detailed Digital-Native Brush Specs
These are the primary algorithm-first brushes aligned with the “no skeuomorphism” direction.

Animation policy:
- Animate only where intrinsic to the brush concept.
- Do not force animation on brushes whose core behavior is a stroke-time transform.

### 1) Palette-Sort Brush (Primarily Static)
Core behavior:
- Operates on indexed/palette space.
- Sorts local palette indices in ROI by selected key and writes reordered indices.

Why static by default:
- The core interaction is a direct structural transform of local index topology.
- Continuous animation is optional and not required for the signature look.

Controls:
- `paletteSortWindowPx`
- `paletteSortKey: 'luma' | 'hue' | 'saturation' | 'distance-to-fg' | 'gradient-position'`
- `paletteSortDirection: 'tangent' | 'normal' | 'radial' | 'spiral'`
- `paletteSortMix` (0-1)
- `paletteSortPostDither: boolean`

Implementation notes:
- Build after `Pixel Sort Brush` primitives exist; reuse ROI extraction and oriented scanline traversal.
- Prefer index-domain sorting and map back through palette LUT.

### 2) Dither Morph Brush (Hybrid: Static + Intrinsic Temporal Mode)
Core behavior:
- Morphs between dithering algorithms based on a morph driver.

Animation stance:
- Intrinsic animation exists only when morph driver is time/oscillator.
- Non-animated drivers (`pressure`, `velocity`, `manual`) are valid and should be first-class.

Controls:
- `ditherMorphEnabled`
- `ditherMorphSource: 'pressure' | 'velocity' | 'time' | 'manual'`
- `ditherMorphPhase` (0-1, for manual mode)
- `ditherMorphRateHz` (time mode)
- `ditherMorphPixelSize`
- `ditherMorphSerpentine: boolean`

Morph chain (v1):
- `bayer4 -> bayer8 -> sierra-lite -> floyd-steinberg -> atkinson`

Implementation notes:
- Reuse existing dither utilities and expose a small interpolation/mix layer between neighboring algorithms.
- Keep deterministic mode when source is not time-based.

### 3) Indexed Pulse Brush (Animated by Definition)
Core behavior:
- Paints base palette indices plus pulse metadata.
- Playback remaps index windows over time (`index + offset`) rather than repainting RGB.

Why animated-only:
- Temporal palette-address shifting is the core identity; static mode is just indexed paint.

Controls:
- `indexedPulseRateHz`
- `indexedPulseDepth`
- `indexedPulseWaveform: 'sine' | 'triangle' | 'stepped'`
- `indexedPulseSync: 'global' | 'stroke' | 'tile'`
- `indexedPulseSteps` (quantized remap)

Implementation notes:
- Implement as side-buffer metadata with renderer-time remap.
- CPU/WebGL parity required for index remap semantics.

### 4) Run-Sort Brush (Primarily Static)
Core behavior:
- Detects contiguous runs in oriented ROI and sorts each run.

Why static by default:
- Signature output comes from stroke-time segmentation/sort rules.
- Continuous animation should be omitted in v1 to keep interaction predictable.

Controls:
- `runSortThreshold`
- `runSortMinLength`
- `runSortMaxLength`
- `runSortDirection: 'asc' | 'desc' | 'alternate' | 'pingpong'`
- `runSortMix` (0-1)
- `runSortPostDither: boolean`

Implementation notes:
- Share ROI and comparator infrastructure with Pixel Sort + Palette Sort.
- Commit as one stroke transaction for history integrity.

## Exploratory Digital-Native Concepts (Research Backlog)
These concepts are candidates for post-v1 exploration. They are included to guide future brush R&D and visual direction.

### 1) Paeth Predictor Brush (Static)
Core idea:
- Paint prediction residuals using PNG-style Paeth predictor logic.

How it looks:
- Flat regions stay calm; edge regions gain crisp digital crackle.
- Repeated strokes create compression-like halos near contours.

### 2) Scanline Filter Brush (Static)
Core idea:
- Apply PNG scanline filter behaviors (`Sub`, `Up`, `Average`, `Paeth`) as stroke transforms.

How it looks:
- `Sub`: directional trailing echoes.
- `Up`: vertical memory streaks.
- `Average`: softened digital smear.
- `Paeth`: sharper edge-aware artifacts.

### 3) DCT Quant Ladder Brush (Hybrid)
Core idea:
- Quantize local DCT blocks (8x8/16x16) with controllable coefficient decay.

How it looks:
- Block structure appears in textured zones.
- Fine detail collapses into chunky gradients.
- Strong settings produce ringing/ghosting at edges.

### 4) Blue-Noise Threshold Brush (Hybrid)
Core idea:
- Dither via blue-noise threshold masks (beyond Bayer-only patterns).

How it looks:
- Even stippled grain with fewer checker artifacts.
- Smooth tone transitions through dot-density shifts.
- Optional subtle temporal phase drift gives “breathing” texture.

### 5) Palette Index Advection Brush (Animated)
Core idea:
- Move palette indices through vector fields instead of blending RGB.

How it looks:
- Crisp color bands drift like digital current.
- Edges stay sharp while palette regions flow.

### 6) Run-Length Topology Brush (Static)
Core idea:
- Detect and mutate RLE-like runs aligned with stroke tangent.

How it looks:
- Barcode-like banding that bends with stroke motion.
- Run breaks create deliberate compressed-glitch structure.

### 7) Coefficient Sort Brush (Static)
Core idea:
- Sort transform-domain coefficients (or indexed bins), not raw pixels.

How it looks:
- Texture reorganizes into geometric frequency patterns.
- Less noisy than classic pixel-sort; more structural artifacting.

### 8) Reaction-Diffusion Seeding Brush (Animated)
Core idea:
- Deposit simulation seeds into a reaction-diffusion field and palette-map the result.

How it looks:
- Strokes bloom into cellular spots/stripes/labyrinths over time.
- Strong synthetic-organic motion language.

### Triage Guidance
- Best immediate adds (lowest uncertainty): `Blue-Noise Threshold`, `DCT Quant Ladder`.
- Highest visual payoff (higher complexity): `Palette Index Advection`, `Reaction-Diffusion Seeding`.

## Digital-Native Rollout Order
1. `Run-Sort Brush` (lowest complexity, strongest base primitive)
2. `Palette-Sort Brush` (index-domain extension)
3. `Indexed Pulse Brush` (animated metadata pipeline)
4. `Dither Morph Brush` (most complex blend logic)

## Digital-Native Definition of Done
1. No skeuomorphic language or UI affordances in presets/tooltips.
2. Palette/index/dither terminology is explicit in controls and docs.
3. Animated behavior appears only where intrinsic (`Indexed Pulse`, optional temporal `Dither Morph` mode).
4. Static brushes (`Palette-Sort`, `Run-Sort`) remain deterministic for same input/seed.
