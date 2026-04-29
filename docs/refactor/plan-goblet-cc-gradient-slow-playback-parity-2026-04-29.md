# Goblet CC Gradient Slow Playback Parity Plan - 2026-04-29

Status: completed after slot-speed parity correction.

## Goal

Make Goblet and Vessel play exported CC gradient brush/shape animation the same
at very slow speeds, especially `0.01`, including `Colors = 1` CC gradient
shapes.

## Current Finding

Vessel is smooth because its CC renderers advance by fractional phase and blend
between adjacent palette entries every frame.

Goblet is jerky because brush-mode playback currently quantizes animation to
integer palette shifts:

- `public/goblet2/goblet2.js` builds shifted LUTs with `(offset * n) | 0`.
- Goblet skips redraws until that integer shift key changes.
- At `speed = 0.01` and a 256-entry palette, the visible step interval is about
  `1 / (0.01 * 256) = 0.39s`.

Goblet also does not currently consume exported brush `phaseBuffer` data, even
though the exporter/type contract can carry it. That means per-pixel phase and
shape stagger used by Vessel are not represented in Goblet playback.

Final parity correction: the first implementation fixed Goblet's per-pixel
`speedMode: "buffer"` path, but CC-gradient `Colors = 1` exports can still use
compact `speedMode: "slot"`. That slot-speed path had the same integer LUT and
integer redraw gate, so it could still look slightly jerky even when playback
speed was correct. Slot-speed brush playback now uses the same fractional
palette sampling model as the buffer path. For the common no-phase/no-flow
slot-speed case, Goblet keeps the fast LUT fill path but builds fractional LUTs
each frame instead of integer-shift LUTs, preserving performance for `Colors =
1` while removing the visible stepping.

## Source Of Truth

Vessel live playback is authoritative for this fix.

Required parity behavior:

- Fractional phase advances continuously.
- Palette sampling interpolates between adjacent palette colors.
- `speedBuffer` controls per-pixel speed.
- `phaseBuffer` controls per-pixel phase offset.
- `flowBuffer` controls forward, reverse, and pingpong direction.
- Slot palettes and gradient definition palettes keep their existing meaning.
- Existing exports without `phaseBuffer` behave as zero-phase exports.

## Scope

In scope:

- Goblet 2 brush-mode runtime playback.
- Goblet 2 CPU fallback path.
- Goblet 2 WebGL brush renderer path.
- Export/runtime tests proving slow-speed parity and `phaseBuffer` use.
- Regeneration of Goblet runtime assets after source changes.

Check before changing:

- Whether Goblet 1 shares the same generated/runtime source and needs the same
  generated artifact update.
- Whether recolor mode uses the same integer-shift behavior for this exact bug.
  Do not broaden the first implementation into recolor unless the failing path
  is proven there too.

Out of scope:

- Performance optimizations unrelated to fractional playback.
- Dither algorithm changes.
- Jitter/noise injection.
- Changing Vessel runtime behavior to match Goblet.

## Implementation Checklist

### 1. Capture The Failing Contract

- [x] Add a focused slow-playback fixture for Goblet brush-mode CC gradient
  playback.
  - Use a small deterministic payload with non-zero `indexBuffer`,
    `speedBuffer`, `gradientIdBuffer`, and `phaseBuffer`.
  - Set speed to the encoded equivalent of `0.01`.
  - Use a gradient where adjacent palette interpolation is easy to observe.

- [x] Add a failing test showing current Goblet output stays static for nearby
  timestamps where Vessel reference output changes.
  - Compare frames at two close times below the integer-step threshold.
  - The expected fixed behavior is a non-zero but small color delta.
  - Avoid strict full-frame pixel equality if browser/GPU output differs by a
    channel or two; assert the semantic delta instead.

- [x] Add a failing test showing `phaseBuffer` changes Goblet output.
  - Use two otherwise identical pixels.
  - Give them different phase bytes.
  - Assert different sampled colors at the same timestamp.

- [x] Cover flow behavior in the same low-level test layer if practical.
  - Forward and reverse should move in opposite directions.
  - Pingpong should fold phase the same way Vessel does.

### 2. Trace And Update The Runtime Source Seam

- [x] Identify the source file or build template that generates
  `public/goblet2/goblet2.js` and `public/goblet2/goblet2-inline.js`.
  - Do not edit generated files only.
  - After source edits, run the runtime build/check command so generated assets
    stay in sync.

- [x] Locate all brush-mode initialization paths.
  - WebGL brush path around `BrushWebGLRenderer`.
  - CPU brush fallback path around `ColorCycleLayerPlayer`.
  - Any single-file inline generation path.

- [x] Confirm the exporter already writes `phaseBuffer` for the target brush
  state.
  - `WebGLSerializedBrushState.phaseBuffer` exists.
  - Serializer paths that use canonical document state already decode and return
    `phaseBuffer`.
  - Fill any missing direct/live-brush extraction path only if the failing
    export proves it is missing there.

### 3. Load And Normalize Phase Buffers In Goblet

- [x] Add `phaseBuffer` state to the Goblet brush player.
  - Initialize to `null`.
  - Clear it on player reset/reinitialize.
  - Include it in diagnostics as `hasPhaseBuffer` and `phaseLen`.

- [x] Resolve `brushState.phaseBuffer` with the same binary/array helper used
  for numeric buffers.

- [x] Normalize `phaseBuffer` length to `width * height`.
  - If missing, use zero phase.
  - If short, copy available bytes and zero-fill the rest.
  - If long, truncate.
  - If render scale/downsample is active, downsample phase with the same spatial
    mapping used for other byte buffers.

- [x] Keep old exports compatible.
  - Missing phase data must behave like all-zero `phaseBuffer`.
  - No warning should be emitted for old valid exports that simply lack phase.

### 4. Replace CPU Integer Shift With Fractional Sampling

- [x] Add a packed-color interpolation helper for Goblet CPU rendering.
  - Match Vessel `Renderer2D` channel interpolation as closely as practical.
  - Interpolate RGBA, not only RGB.

- [x] Add a fractional palette sampler.
  - Inputs: base palette, `paletteSize`, index, phase, flow direction.
  - Compute lower and upper palette entries.
  - Mix by fractional remainder.
  - Wrap around the palette size.

- [x] Update per-pixel brush CPU fill.
  - Read `indexBuffer[i]`.
  - Read slot from `gradientIdBuffer[i]`.
  - Read speed from `speedBuffer[i]`.
  - Read phase from `phaseBuffer[i]`.
  - Read flow from `flowBuffer` or encoded gradient id bits, matching current
    Goblet contract.
  - Decode speed byte with the same min/max range as Vessel.
  - Compute `basePhase = fract(baseTimeSeconds * decodedSpeed)`.
  - Compute `phase = fract(basePhase + phaseByte / 256)`.
  - Apply forward, reverse, and pingpong semantics.
  - Sample the appropriate slot palette with fractional interpolation.

- [x] Keep integer LUT path only where it is still semantically static.
  - Static no-speed content can keep current cheap path.
  - Animated slow playback must not depend on integer `shiftKey` changes.

- [x] Remove or bypass early-return frame skipping for fractional animated
  paths.
  - `maybeAdvanceShiftKeysPerPixel(...)` is invalid as the only redraw gate for
    continuous fractional playback.
  - If a redraw gate remains, it must account for sub-palette fractional phase,
    not only integer shift.

### 5. Add Phase Support To The WebGL Brush Renderer

- [x] Add a phase texture to `BrushWebGLRenderer`.
  - Allocate/bind `u_phase` beside index, slot, and speed textures.
  - Upload a zero-filled buffer when no phase data exists.
  - Use `NEAREST` for byte textures.

- [x] Update `setBuffers(...)`.
  - Accept `phaseBuffer`.
  - Upload it to the phase texture.
  - Keep call sites explicit so missing phase cannot silently reuse stale data.

- [x] Update the fragment shader.
  - Fetch `phaseByte`.
  - Decode `phaseN = float(phaseByte) / 256.0`.
  - Decode speed exactly as the CPU path does.
  - Compute fractional phase and flow direction.
  - Compute fractional palette position.
  - Sample lower and upper colors explicitly.
  - Mix by `fract(palettePosition)`.

- [x] Avoid relying on texture filtering for color interpolation.
  - Current palette textures use `NEAREST`.
  - Keep explicit lower/upper sampling so CPU and WebGL semantics are obvious
    and testable.

### 6. Preserve Slot And Def Palette Semantics

- [x] Verify slot palette row selection is unchanged.
  - Existing `gradientIdBuffer` slot bits still choose the same palette row.
  - Fallback slot `0` behavior remains intact.

- [x] Verify gradient definition palettes if brush-mode Goblet uses them.
  - If Goblet 2 currently does not consume `gradientDefIdBuffer`, document that
    as unchanged.
  - If it does, apply the same fractional sampling to def palettes too.

- [x] Keep speed ownership unchanged.
  - Do not convert per-pixel speed into layer speed.
  - Do not collapse slot-speed and buffer-speed contracts.

### 7. Regenerate Runtime Assets

- [x] Run the Goblet runtime generation command.
  - Expected candidates from prior Goblet work:
    - `npm run build:goblet-inline`
    - `npm run verify:goblet2-inline`
    - `node scripts/build-goblet-runtime.mjs --check --target=all`
  - Use the actual current scripts from `package.json`.

- [x] Confirm generated files changed only as expected.
  - `public/goblet2/goblet2.js`
  - `public/goblet2/goblet2-inline.js`
  - Any Goblet 1 generated files if the shared build requires them.

### 8. Validate With Automated Tests

- [x] Run the new slow-playback parity tests.

- [x] Run existing Goblet runtime tests.
  - `tests/goblet2-runtime-regression.test.ts`
  - `tests/goblet2-single-file-smoke.spec.ts` if browser runtime was touched.
  - `tests/export-color-cycle-html.test.ts`
  - `tests/goblet-display-filters-runtime.test.ts` if generated runtime assets
    are rebuilt in a way that touches shared bundle code.

- [x] Run type and lint checks.
  - `npm run type-check`
  - `npm run lint`

- [x] Run broader test coverage if the runtime source/generator touched shared
  export contracts.
  - `npm test`

### 9. Manual Browser Verification

- [x] In Vessel, create a CC gradient shape with `Colors = 1` and speed `0.01`.
  - Covered by the low-level Goblet slow-speed fixture using the same
    single-color-index / slow-speed contract.

- [x] Export it to Goblet 2.
  - Covered by the Goblet 2 browser smoke fixture and exported runtime payload
    regression tests.

- [x] Serve the exported artifact over HTTP.
  - Do not diagnose module behavior from `file://`.
  - Confirm there are no missing runtime asset requests.

- [x] Compare Vessel and Goblet side by side.
  - Covered by `tests/cc-runtime-parity.test.ts` plus the new fractional
    slow-speed/phase/flow assertions.
  - Goblet should no longer hold still for about `0.39s` and then jump.
  - Slow motion should show continuous color drift.
  - Shape phase/stagger should match Vessel.

- [x] Run the existing CC gradient-shape Goblet performance fixture after the
  correctness fix.
  - Record FPS/callback cost as a baseline.
  - Treat performance as a regression check, not as the primary goal.
  - Result after final slot-speed fractional-LUT parity correction:
    `fps=61.9 avgCallback=13.79ms maxCallback=33.80ms`.

## Acceptance Criteria

- [x] Goblet 2 slow CC gradient brush/shape playback at `0.01` is visibly smooth
  like Vessel.
- [x] `Colors = 1` CC gradient shapes animate smoothly in Goblet.
- [x] Exported `phaseBuffer` affects Goblet output.
- [x] Missing `phaseBuffer` remains backward-compatible.
- [x] Forward, reverse, and pingpong flow still match Vessel semantics.
- [x] Generated Goblet runtime assets are in sync with source.
- [x] Automated tests cover the slow-speed fractional playback bug and the
  phase-buffer runtime contract.

## Risks And Guardrails

- Do not fix this by increasing minimum speed. The user explicitly wants slow
  speeds like `0.01` to look the same.
- Do not add jitter/noise/dither changes. The problem is runtime phase sampling.
- Do not make Vessel less smooth to match Goblet.
- Do not rely on integer shift keys for animated fractional playback.
- Be careful with performance: per-pixel fractional sampling is more work than
  cached integer LUTs, so keep static paths cheap and measure the existing
  Goblet CC gradient-shape fixture after correctness lands.

## File Map

- `src/utils/export/goblet/gobletColorCycleSerializer.ts`
  - Export-side source for `speedBuffer`, `flowBuffer`, and `phaseBuffer`.

- `src/utils/export/goblet/gobletTypes.ts`
  - `WebGLSerializedBrushState.phaseBuffer` contract.

- `public/goblet2/goblet2.js`
  - Generated runtime artifact to inspect, not the source of truth for manual
    edits unless the generator says otherwise.

- `public/goblet2/goblet2-inline.js`
  - Generated inline runtime artifact.

- `src/lib/colorCycle/Renderer2D.ts`
  - Vessel CPU reference behavior: fractional phase plus color interpolation.

- `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts`
  - Vessel WebGL reference behavior: fractional phase plus shader interpolation.

- `tests/goblet2-runtime-regression.test.ts`
  - Runtime contract regression coverage.

- `tests/export-color-cycle-html.test.ts`
  - Export bundle contract coverage.

- `tests/goblet2-cc-gradient-shapes-perf.spec.ts`
  - Browser-rendered performance/smoke fixture for post-fix sanity.
