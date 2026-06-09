# Color-Cycle LUT Renderer Performance Plan - 2026-06-09

Status: proposed.

## Goal

Make color-cycle playback faster, lighter, and visually smoother without changing
what color-cycle artwork means.

The target model is:

- painting and fills write stable address data: paint/index, gradient slot or
  gradient definition, speed, flow, and phase;
- gradients are precomputed into compact LUT/palette rows when inputs change;
- each animation frame changes phase/time and samples those LUTs with
  fractional interpolation;
- the renderer avoids rebuilding a full RGBA canvas on the CPU unless it is in a
  fallback path.

This is a playback/rendering optimization, not a saved-format rewrite.

## Current Evidence

- `src/lib/colorCycle/Renderer2D.ts` is the heavy Canvas2D fallback. It walks
  every `indexData` pixel each render, resolves slot/def palette, decodes
  speed/flow/phase, optionally blends adjacent colors, then writes the full
  `ImageData` with `putImageData`.
- `src/lib/ColorCycleAnimator.ts` already has a GPU branch that uploads index,
  gradient id, speed, flow, phase, and def-id data only when dirty, then renders
  with time/phase uniforms.
- `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts` explicitly states
  the desired model: upload index/slot/palette textures and animate by shifting
  sampling offset, not by re-uploading or remapping full RGBA frames.
- `docs/refactor/plan-goblet-cc-gradient-slow-playback-parity-2026-04-29.md`
  established the smoothness contract: fractional phase and adjacent palette
  interpolation are required. Integer palette shifts cause visible stepping,
  especially at slow speeds.
- `tests/goblet2-runtime-regression.test.ts` already guards Goblet against
  regressing slot-speed playback back to integer shift gates.
- `tests/goblet2-cc-gradient-shapes-perf.spec.ts` is a reusable 2000x2000,
  256-shape Goblet performance fixture.

## Non-Negotiable Requirements

1. Faster and lighter means less main-thread work and fewer full-surface memory
   writes per frame, not just moving complexity around.
2. Colors must blend smoothly. Playback must use fractional palette positions
   and interpolate adjacent palette entries when phase lands between indices.
3. No frame-by-frame stutter from integer palette-step gates. Slow speeds such as
   `0.01` must still produce tiny continuous color deltas, not hold-then-jump
   motion.
4. Manual gradients, sampled gradients, foreground-derived gradients, shape
   fills, strokes, dithering, speed, flow, and phase keep their current meaning.
5. Save/autosave/history/Goblet export continue to use canonical CC buffers and
   gradient defs unless a measured need proves otherwise.
6. Vessel runtime and Goblet export/runtime stay in sync for any playback
   semantic change.

## Success Metrics

Measure before and after on the same hardware/browser. Absolute numbers can
vary; the comparison matters.

### Vessel Editor Metrics

- Deterministic fixture:
  - add a reproducible Vessel editor/perf fixture before optimization work;
  - target at least one 2000x2000 color-cycle layer with 256 deterministic
    gradient-shape regions, matching the Goblet fixture shape count where
    practical;
  - include speed, flow, phase, slot palettes, and at least one gradient-def
    palette case so fallback and atlas behavior can be compared on the same
    payload.
- CPU frame cost for active CC playback:
  - baseline: instrument `ColorCycleAnimator.renderFrame(...)` and
    `Renderer2D.render(...)`.
  - target: reduce average CPU render time for animated CC layers by at least
    40% on the deterministic Vessel fixture when WebGL is available.
- Full-surface writes:
  - baseline: count Canvas2D `putImageData` calls during active CC playback.
  - target: zero per-frame full-surface `putImageData` on the accelerated path.
- Buffer uploads:
  - baseline: count texture/buffer uploads per frame.
  - target: upload index/slot/speed/flow/phase/def buffers only when dirty;
    animation-only frames update uniforms/time only.
- Memory churn:
  - baseline: track ImageData allocation and frame-buffer churn.
  - target: no per-frame `ImageData` allocation on the accelerated path.
- CPU-surface dependency:
  - baseline: audit every accelerated-path consumer that still forces
    `renderer2D.ensureImageData()`, including animation callbacks and sampling
    probes;
  - target: normal accelerated playback does not require a CPU `ImageData`
    surface unless a compatibility callback or explicit readback path is active.
- Visual smoothness:
  - two nearby timestamps below one palette index interval must produce a small
    non-zero color delta on animated pixels.

### Goblet Metrics

- Re-run `npm run test:goblet2:cc-gradient-shapes-perf`.
- Compare `avgCallbackMs`, `maxCallbackMs`, and `measuredFps` with the existing
  fixture.
- Preserve the existing slow-playback regression guard in
  `tests/goblet2-runtime-regression.test.ts`.

## Architecture Decision

Keep the existing saved/export data contract.

The current address-buffer model is the right foundation:

- `paintBuffer` / index data says where animated paint exists;
- `gradientIdBuffer` chooses slot and flow bits;
- `gradientDefIdBuffer` binds pixels to immutable gradient definitions;
- `speedBuffer` gives per-pixel or per-region speed;
- `flowBuffer` gives forward/reverse/pingpong behavior;
- `phaseBuffer` gives per-pixel phase offsets;
- `gradientDefStore` and slot palettes define the colors.

The expensive part is not having these buffers. The expensive part is
materializing every animated pixel into a full RGBA canvas on the CPU every
frame. The optimization should therefore replace the frame execution strategy,
not the document model.

## Implementation Plan

### Phase 0 - Baseline And Tripwires

- Add a deterministic Vessel CC playback fixture that can be run before and
  after changes:
  - use fixed canvas dimensions, fixed seeded shape placement, fixed gradients,
    and fixed speed/flow/phase buffers;
  - cover slot palettes and gradient definitions;
  - report the same counters as the runtime profiler so plan slices can compare
    one payload instead of ad hoc artwork.
- Add lightweight runtime profiling behind an opt-in flag, for example
  `window.__vesselCcPerf = true` or an existing debug/profile flag.
- Record:
  - render path: GPU, CPU, fallback reason;
  - render frame duration;
  - `Renderer2D.render(...)` duration;
  - `putImageData` count;
  - GPU buffer upload count and dirty rect size;
  - palette/def atlas upload count;
  - animated layer dimensions and non-zero paint count.
- Audit accelerated-path CPU-surface usage:
  - `ColorCycleAnimator.renderFrame(...)` currently keeps a `Renderer2D`
    instance around even when WebGL renders the visible frame;
  - identify callbacks, probes, and compatibility paths that still call
    `ensureImageData()` or read pixels from the CPU canvas;
  - decide which consumers are required and which can move behind explicit
    readback/debug flags.
- Add one focused smoothness test for Vessel's renderer semantics:
  - construct a tiny indexed payload with non-zero speed and phase;
  - render at two close timestamps below one integer palette step;
  - assert a small non-zero channel delta;
  - assert no integer hold-then-jump behavior.
- Add or extend a renderer-path unit test proving animation-only frames do not
  mark index data dirty.

Goal score:

- Faster: no user-visible speedup yet, but creates proof.
- Lighter: no user-visible reduction yet, but creates counters.
- Smooth colors: starts with an explicit regression test.

### Phase 1 - Make The Accelerated Path The Primary Playback Path

- Audit why `ColorCycleAnimator` falls back to `Renderer2D.render(...)`:
  - WebGL unavailable;
  - context budget exhausted;
  - missing def palette residency;
  - unsupported def-id or palette state;
  - explicit `forceCanvas2D`.
- Fix avoidable fallbacks first. In particular:
  - ensure def palettes are uploaded to the atlas before falling back;
  - keep base and slot palettes resident by signature;
  - make missing optional buffers resolve to zero/default textures instead of
    disabling acceleration;
  - keep context creation bounded and reusable.
- Make the render-path profiler visible enough to confirm when CC is on GPU vs
  CPU during normal drawing and playback.
- Remove avoidable CPU-surface work from the accelerated path:
  - do not allocate or refresh `ImageData` during normal WebGL animation frames
    just to keep legacy callback plumbing warm;
  - keep explicit CPU readback/debug/probe paths available, but count them
    separately from normal playback;
  - if a public callback contract requires `ImageData`, document it as a
    compatibility fallback and exclude it from the accelerated hot path.

Goal score:

- Faster: high. The GPU path avoids CPU per-pixel color mapping.
- Lighter: high. Animation-only frames should avoid full RGBA writes.
- Smooth colors: must remain high because shader sampling must keep fractional
  interpolation.

### Phase 2 - Harden Existing GPU/LUT Semantics

- Verify the WebGL shader samples the same semantic inputs as `Renderer2D`:
  - color index;
  - gradient slot;
  - def id;
  - speed byte;
  - flow;
  - phase byte;
  - base time.
- Keep palette textures `NEAREST`; explicitly sample lower and upper palette
  entries and `mix(...)` by fractional phase. Do not rely on texture filtering
  for correctness. This is already the intended WebGL/CPU behavior, so this
  phase should preserve and test that contract rather than rewrite the sampler
  unless evidence shows a mismatch.
- Add parity tests comparing CPU and GPU sampling on a tiny fixture:
  - static pixels;
  - per-pixel speed;
  - zero speed;
  - forward/reverse/pingpong;
  - phase offsets;
  - slot palette;
  - gradient definition palette.
- Ensure animation-only frames update time/uniforms and do not re-upload
  index/slot/speed/flow/phase/def textures.

Goal score:

- Faster: high on supported browsers.
- Lighter: high if dirty uploads stay bounded.
- Smooth colors: high because blending is explicit and covered by tests.

### Phase 3 - Reduce CPU Fallback Cost Without Changing Semantics

The CPU path still matters for unsupported WebGL, context exhaustion, tests, and
safe fallback. It should become a bounded fallback, not the main experience.

- Keep the existing LUT sampling semantics, including fractional interpolation.
- Add dirty/static partitioning:
  - static/non-animated pixels can be cached until paint, palette, or layer data
    changes;
  - animated pixels update each frame;
  - fully transparent zero-index runs can be skipped.
- Consider an active-pixel list or dirty-run table built when paint buffers
  change:
  - list non-zero `paint/index` positions;
  - optionally bucket by contiguous row runs;
  - update only active pixels on CPU animation frames.
- Avoid allocating a new typed view or `ImageData` in the hot path.
- Decide explicitly whether CPU fallback continues to present via full-surface
  `putImageData`:
  - if yes, document that Phase 3 reduces CPU sampling work but does not satisfy
    the full-surface-write target for unsupported environments;
  - if no, add dirty-rect `putImageData` or row-run writeback support and test
    that stale pixels outside the updated rect do not survive.
- Preserve correctness before micro-optimizing. If active-pixel bookkeeping
  becomes complex or bug-prone, prefer keeping CPU fallback simple and make the
  GPU path reliable.

Goal score:

- Faster: medium to high for sparse CC layers; lower for fully painted large
  layers.
- Lighter: medium, mainly fewer writes and less hot-loop work.
- Smooth colors: unchanged if it keeps the same fractional sampler.

### Phase 4 - Goblet Runtime Parity And Optional Shared Sampler

- Do not change Goblet export metadata unless the runtime contract changes.
- Keep `paint/index`, `gradientIdBuffer`, `gradientDefIdBuffer`, `speedBuffer`,
  `flowBuffer`, `phaseBuffer`, `slotPalettes`, and `gradientDefStore` as the
  exported authority.
- If Vessel sampler math changes, port the same semantic change to Goblet:
  - CPU runtime;
  - WebGL runtime;
  - inline runtime generation.
- Prefer extracting a small shared sampling contract/spec over duplicating
  magic constants:
  - speed-byte decode range;
  - phase byte normalization;
  - forward/reverse/pingpong folding;
  - fractional palette sampling.
- Regenerate Goblet runtime assets after source changes:
  - `npm run build:goblet-inline`;
  - `npm run verify:goblet2-inline`.

Goal score:

- Faster: high for exported playback if Goblet uses the same accelerated model.
- Lighter: high if Goblet avoids full CPU frame rebuilds where WebGL is active.
- Smooth colors: mandatory; existing Goblet tests already guard the worst
  integer-shift regression.

### Phase 5 - Remove Or Quarantine Dead Heavy Paths

- After instrumentation proves the accelerated path is stable, identify unused
  or duplicate CC renderers:
  - old wrappers that are not in the live brush path;
  - duplicate LUT builders;
  - debug-only full-frame render paths.
- Remove only paths that are proven unused by `rg`, tests, and runtime trace.
- Keep one clear CPU fallback for unsupported environments.
- Update docs to say CC playback is indexed-buffer + LUT/shader driven.

Goal score:

- Faster: indirect.
- Lighter: high for code size and maintenance complexity.
- Smooth colors: unchanged, guarded by tests.

## Saved Format And Migration Policy

No saved-format migration is planned for this performance work.

Do not change save/Goblet payloads unless one of these becomes necessary and is
proven by tests:

- index precision needs to exceed 8-bit palette positions;
- phase or speed needs higher precision than current byte buffers;
- gradient definitions need a new persisted interpolation mode;
- Goblet needs a new explicit capability flag to distinguish old vs new
  playback semantics.

If any of those happen, add a versioned compatibility plan first. Otherwise,
this work should remain a renderer implementation change.

## Test And Verification Matrix

### Focused Unit Tests

- `src/lib/colorCycle/Renderer2D.ts`
  - fractional sampling produces non-zero deltas below integer step thresholds;
  - speed zero remains static;
  - missing phase buffer behaves like zero phase;
  - flow modes match current semantics.
- `src/lib/ColorCycleAnimator.ts`
  - animation-only frames do not dirty index data;
  - GPU path does not re-upload stable buffers;
  - fallback reason is observable.
  - accelerated playback does not allocate or refresh CPU `ImageData` unless an
    explicit readback/debug/compatibility path is active.
- WebGL renderer tests where practical:
  - texture defaults for missing optional buffers;
  - palette row residency;
  - def palette row selection.
  - fractional palette interpolation remains active for slot and def palettes.

### Goblet Tests

- `tests/goblet2-runtime-regression.test.ts`
- `tests/goblet2-artifact-cc-export.spec.ts`
- `tests/goblet2-binary-sidecar-smoke.spec.ts`
- `tests/goblet2-cc-gradient-shapes-perf.spec.ts`

### Commands

- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run build:goblet-inline`
- `npm run verify:goblet2-inline`
- `npm run test:goblet2:cc-gradient-shapes-perf`

Run the full set before merging renderer/export changes. For planning or early
slices, run focused tests first, then broaden.

## Risks

- A naive "just interpolate colors in JS" rewrite could be simpler but slower,
  because it still does per-pixel CPU work every frame.
- Fixing smoothness by increasing FPS alone will not solve integer palette
  stepping; the sampler must be fractional.
- GPU and CPU paths can drift if constants or flow logic are duplicated.
- WebGL context budget issues can hide the accelerated path and make the app
  silently fall back to the heavy CPU path.
- Def-palette misses can accidentally force CPU fallback on exactly the manual
  gradient cases users care about.
- Over-optimizing the CPU fallback can create more bugs than value if the GPU
  path is the real production target.

## Definition Of Done

- On a representative CC layer, the accelerated path is active by default when
  WebGL is available.
- Animation-only frames do not call full-surface `putImageData` in the
  accelerated path.
- Stable CC buffers are not re-uploaded every frame.
- Slow speeds show blended color movement, not frame-by-frame stepping.
- Vessel and Goblet agree on speed, flow, phase, slots, and def palettes.
- Existing saved files and Goblet exports load without migration.
- The performance fixture records equal or better `avgCallbackMs` and no worse
  smoothness behavior.
- `npm run type-check`, `npm run lint`, `npm test`, `npm run verify:goblet2-inline`,
  and the Goblet CC performance fixture pass or have documented environment
  blockers.
