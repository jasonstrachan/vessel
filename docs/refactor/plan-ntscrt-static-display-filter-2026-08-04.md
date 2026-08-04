# NTSCRT Static Display Filter Plan

Last updated: 2026-08-04

Status: Track B retained; separate NTSE CRT implemented and technically verified;
awaiting user visual acceptance

## Separate NTSE CRT Result — 2026-08-04

- The existing `CRT` filter remains unchanged as the simpler four-pass Track B
  implementation.
- A new saved filter ID, `ntse-crt`, appears in the panel as **NTSE CRT** and
  uses its own lazy WebGL2 state, controls, fallback, and Goblet runtime path.
- The new deterministic five-pass chain is ordered as full-resolution analog
  smear, nearest 320px signal downscale, scanline beam reconstruction,
  quarter-resolution horizontal glow, and vertical glow resolve.
- Its defaults deliberately emphasize the reference qualities the existing CRT
  lacked: asymmetric chroma trails, horizontal echo, line displacement, luma
  ringing, imperfect static noise, low-resolution beam structure, and glow.
- It exposes Signal Smear, Signal Noise, Scanline Size, Scanline Strength, and
  Glow Strength.
  None of these settings use time, a frame counter, or an animation uniform.
- Production-preview playback produced 135 GPU draws for 27 Vessel frame
  uploads: exactly five draws per source frame. After Vessel playback paused,
  the measured draw and upload deltas were both zero.
- A same-browser 180-frame comparison measured 120.22 FPS with the filter off
  and 120.19 FPS with NTSE CRT enabled at the tested document and viewport.
  The measured JavaScript/WebGL command-submission interval for the NTSE chain
  averaged 0.036 ms per source frame with a 0.10 ms p95; this excludes
  asynchronous GPU completion time. Changing Scanline Size from 1.00x to
  2.00x caused zero texture reallocations and retained five draws per upload.
- Scanline Size now scales the beam cadence and source-row reconstruction from
  the same coordinate, so larger values produce proportionally taller signal
  rows instead of applying a larger beam over independently sampled rows.
- The retained CRT Flicker control now selects a deterministic frozen-frame
  brightness variation, while NTSE Signal Noise also remains effective in the
  Canvas2D fallback. Neither path introduces filter-owned animation.
- The production preview compiled and rendered without browser or WebGL errors.
  Transparent canvas regions remained transparent after the final resolve.
- This is original browser-native shader code informed by the pinned NTSCRT
  processing order; it does not copy or distribute the native `ntsc-rs` core,
  librashader, or mixed-license RetroArch shader sources.
- Exact NTSCRT output remains Track A. That still requires the pinned
  `ntsc-rs` WASM/worker port, the complete seven-pass preset semantics, a native
  golden-reference harness, and an approved third-party licensing model.

## Track B Implementation Result — 2026-08-04

- The shared Vessel/Goblet pipeline now lazily compiles the deterministic
  analog, CRT base, horizontal bloom, and resolve programs.
- A production preview compiled all four shaders at a 711 x 720 render size
  with no WebGL errors.
- The idle probe remained at 8 draws and 2 uploads for 1.5 seconds, confirming
  that the filter owns no animation loop.
- Vessel playback reached 5,320 draws for 1,330 source uploads: exactly four
  draws per Vessel frame, with zero stable-size texture reallocations and zero
  WebGL errors.
- A temporary method-level WebGL probe supplied the draw, upload, allocation,
  shader-source, and error evidence. Spector.js was not installed in this
  workspace, so a formal Spector capture remains optional follow-up evidence.
- Type-check, lint, production preview build, generated Goblet verification,
  focused regression tests, and the full Jest suite pass under Node 22.22.0.

## Outcome Goal

Replace Vessel's current CPU-heavy `CRT` display-filter implementation with a
lazy GPU path that captures the static visual character of NTSCRT while
preserving Vessel's own color-cycle and sequential animation.

The filter must be deterministic. It must not start an animation loop or add
time-varying tape noise, flicker, jitter, interlacing, or parameter animation.
Each Vessel frame is the input; the same input pixels and settings must produce
the same filtered pixels.

This plan records two possible implementations:

1. **Reference-matched NTSCRT pipeline** — reproduce NTSCRT's complete static
   processing recipe as closely as browser rendering permits.
2. **Simplified deterministic Analog + CRT Glow pipeline** — reproduce the
   important signal-smear and display qualities with a small native WebGL2
   implementation and no Rust/WASM or third-party shader runtime.

The simplified track is the recommended first implementation. It directly
addresses the desired look with substantially less runtime, packaging,
licensing, and maintenance cost. The reference-matched track remains available
if comparison against NTSCRT proves that the simpler result is insufficient.

## Current Evidence And Owner

- `src/lib/displayFilterPipeline.js` owns the shared Vessel and Goblet display
  filter algorithms.
- Its `applyCrtWholeImage(...)` path calls `getImageData`, loops over every
  output pixel on the main thread, and finishes with `putImageData` plus a
  Canvas2D bloom composite.
- `src/components/canvas/useDrawingCanvasBaseRenderer.ts` places the filter
  after the final artwork composite and before editor overlays.
- `scripts/build-goblet-runtime.mjs` copies and inlines the shared filter
  runtime into Goblet outputs.
- The existing persisted `crt` settings already describe the intended control
  surface: source cell size, scanlines, mask, curvature, chromatic separation,
  beam focus, brightness, shadow lift, vignette, signal artifacts, and bloom.
- NTSCRT's default static display recipe uses a 320-pixel-wide nearest-neighbor
  downscale and the seven-pass `crtglow_gauss` RetroArch preset. NTSCRT also
  enables a full-resolution `ntsc-rs` signal stage by default.

The smallest owning change is therefore the `crt` branch inside the shared
display-filter pipeline. This is not a brush, layer, color-cycle, or saved
project-format change.

## Invariants

- Vessel animation remains the only animation authority.
- The CRT filter creates no `requestAnimationFrame`, interval, or independent
  frame counter.
- Source layers, color-cycle buffers, history, and saved artwork are unchanged.
- The filter remains display-only and runs before editor overlays.
- Existing saved projects with `id: 'crt'` keep loading without migration.
- Filter order and stacking behavior remain unchanged.
- The GPU context, programs, textures, framebuffers, and typed data are reused;
  no per-frame GPU object allocation is allowed.
- WebGL initialization is lazy and occurs only after the CRT filter is enabled.
- A shader compile, link, framebuffer, context-loss, or upload failure falls
  back to the current CPU implementation without blanking the canvas.
- Vessel, modular Goblet, and single-file Goblet use the same rendering
  contract.
- Disabling all filters remains visually identical to the current unfiltered
  path.

## Transparency Decision

NTSCRT renders opaque image/video frames and its shader passes normally write
alpha `1`. Vessel supports transparent artwork, so byte-identical NTSCRT alpha
behavior would bake the preview background into the result.

For Vessel, preserve the display-filter contract instead:

1. Run the CRT color treatment against the existing background-first display
   composite.
2. Carry the source alpha through the GPU passes.
3. Never write the checker or gray preview into layer or project pixels.

This deliberately prioritizes Vessel correctness over byte-identical NTSCRT
alpha at translucent edges. If an opaque NTSCRT-style export is desired later,
it must be a separate export option with an explicit background color.

## Track A — Reference-Matched NTSCRT Pipeline

### Target

Reproduce NTSCRT's static default recipe, with its animation disabled:

```text
Vessel frame
  -> pinned ntsc-rs signal stage at a fixed frame index/seed
  -> nearest downscale to 320px wide, aspect-derived even height
  -> seven-pass CRT Glow Gaussian shader chain
  -> Vessel display composite
```

Pin the reference before implementation:

- NTSCRT repository revision selected during baseline capture;
- `ntsc-rs` revision `add90f5`;
- `slang-shaders` revision `cb01f2f`;
- `librashader` revision `76462c03`;
- preset `crt/crtglow_gauss.slangp`;
- NTSCRT house values `BOOST=1.1`, `GLOW_ROLLOFF=2.4`, and
  `BLOOM_STRENGTH=0.1`;
- nearest downscale at 320 pixels wide;
- `FrameCount=0` and a fixed NTSC frame index/seed.

### Required Work

1. Build a native reference harness that renders fixed fixtures through the
   pinned NTSCRT pipeline at exact source and output dimensions.
2. Compile the pinned `ntsc-rs` processing core to WebAssembly, expose only the
   required still-frame API, and run it in a worker using transferable buffers.
3. Precompile or port all seven `crtglow_gauss` passes while preserving preset
   semantics: source/output sizes, pass aliases, explicit gamma, intermediate
   formats, linear/nearest sampling, quarter-resolution bloom, mipmaps, and
   viewport scaling.
4. Package WASM and shader assets only when the CRT filter is present in a
   Goblet export; update modular ZIP and single-file HTML packaging.
5. Audit and document every third-party license before distributing the
   runtime. `ntsc-rs` is permissive, `librashader` is MPL-2.0, and the
   RetroArch shader files have mixed per-file licenses.
6. Compare browser output with the native references using pixel-difference,
   RMSE, and SSIM reports. Cross-backend GPU rounding means the acceptance
   contract must use a measured tolerance rather than promise byte identity.

### Cost And Risk

- New Rust/WASM build and worker boundary.
- Seven GPU passes plus a CPU/WASM signal pass per Vessel frame.
- Larger Goblet ZIP and single-file outputs.
- Mixed-license distribution and attribution work.
- Browser/Metal color-space and sampling differences can prevent byte identity
  even when the algorithm and settings match.
- More maintenance whenever NTSCRT, `ntsc-rs`, librashader, or the shader preset
  changes.

### Track A Stop Condition

Track A is justified only if the simplified track is visually rejected against
the same golden fixtures. Stop before implementation if the shader license
audit cannot produce a distribution model compatible with Vessel.

## Track B — Simplified Deterministic Analog + CRT Glow Pipeline (Recommended)

### Hypothesis

The qualities responsible for the desired NTSCRT appearance are:

- composite-video colour encoding and luma/chroma cross-talk;
- reduced chroma bandwidth, horizontal colour bleed, and edge ringing;
- fixed line distortion and imperfect static signal structure;
- a deliberately low-resolution 320px source signal;
- beam-shaped, brightness-dependent scanlines;
- RGB phosphor-mask structure;
- explicit input/output gamma;
- restrained curvature, vignette, and channel separation;
- a soft Gaussian highlight glow.

A deterministic four-draw WebGL2 chain can reproduce those qualities closely
without reproducing the full analog signal simulator or RetroArch runtime.

### Rendering Model

Keep the implementation inside the existing shared display-filter runtime and
preserve the current `CrtDisplayFilter` type and controls.

1. **Analog signal pass — full output resolution**
   - upload the final display composite to one reusable RGBA texture;
   - convert sampled colour to a YIQ-like composite signal;
   - retain higher luma bandwidth while applying a wider horizontal chroma
     filter, fixed phase error, and controlled luma/chroma cross-talk;
   - add deterministic horizontal ringing, colour bleed, line displacement,
     ghosting, and coordinate-seeded signal noise;
   - use no time, animation-frame, or wall-clock uniform;
   - preserve input alpha;
   - render to a reusable full-resolution RGBA8 framebuffer.
2. **CRT base pass — full output resolution**
   - sample the analog-pass texture;
   - quantize source UVs to a 320px-wide nearest-neighbor grid in the shader,
     deriving height from the source aspect ratio;
   - apply explicit input gamma;
   - sample the low-resolution signal for beam width, scanline shape, static
     channel separation, and shadow lift;
   - apply phosphor mask, curvature, vignette, and a fixed coordinate-seeded
     artifact field;
   - preserve input alpha;
   - render to a reusable full-resolution RGBA8 framebuffer.
3. **Bloom horizontal pass — quarter resolution**
   - extract bright energy and apply a fixed-tap horizontal Gaussian blur;
   - render to a reusable quarter-resolution RGBA8 framebuffer.
4. **Bloom vertical and resolve pass — final output**
   - vertically blur the bloom texture;
   - composite it with the CRT base pass;
   - apply output gamma and clamp once;
   - write the reusable WebGL canvas returned by `applyDisplayFilterStack`.

This path uses four draw calls, one source texture upload, three reusable
intermediate textures, and no pixel readback. `signalArtifacts` owns the
strength of the deterministic analog pass. `flickerIntensity` remains
serialized for compatibility but has no time-varying effect; its UI removal or
relabeling is a separate, explicit follow-up rather than part of the renderer
replacement.

### Lazy Runtime Contract

- Add WebGL state to `createDisplayFilterPipelineState()` but do not request a
  context there.
- On the first effective CRT render, request WebGL2 with alpha enabled and
  premultiplied alpha disabled.
- Compile and link the four programs once; include numbered source context in
  development compile errors.
- Cache every uniform location, VAO, buffer, texture, and framebuffer.
- Resize texture storage only when source/output dimensions change.
- Set viewport and scissor explicitly for every framebuffer target.
- Check framebuffer completeness after allocation and `gl.getError()` at
  development-only pass boundaries.
- On `webglcontextlost`, prevent default restoration behavior, mark the GPU
  state unavailable, and use the CPU fallback until a new lazy initialization
  succeeds.
- Use `KHR_parallel_shader_compile` when available without blocking normal
  rendering; show the CPU result while compilation is pending.

### Settings Mapping

- `cellSize`: retained for saved compatibility; default `12` maps to the 320px
  reference grid at the calibration viewport, while non-default values scale
  the effective source resolution rather than changing physical output size.
- `scanlineIntensity`, `maskIntensity`, `beamFocus`: base-pass beam and mask.
- `barrelDistortion`, `vignetteIntensity`: base-pass geometry and edge falloff.
- `chromaticAberration`: static channel sample separation.
- `brightness`, `shadowLift`: linear-light signal shaping.
- `signalArtifacts`: chroma bleed, ringing, cross-talk, fixed line distortion,
  ghosting, and coordinate-seeded signal noise.
- `bloomIntensity`, `bloomRadius`: quarter-resolution Gaussian passes.
- `flickerIntensity`: ignored by the deterministic GPU path but preserved in
  serialized data until a separate UI/schema decision is approved.

Do not add a new preset selector, VHS panel, shader loader, generic post-process
graph, or dynamic pass-description language.

### Track B Expected File Boundary

Authored files:

1. `src/lib/displayFilterPipeline.js`
2. `src/lib/displayFilterPipeline.d.ts`
3. `src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts`
4. `tests/goblet2-runtime-regression.test.ts`

Mechanically generated parity outputs:

1. `public/goblet/displayFilterPipeline.js`
2. `public/goblet/goblet-inline.js`
3. `public/goblet2/displayFilterPipeline.js`
4. `public/goblet2/goblet2-inline.js`

The shared pipeline file already owns the CRT algorithm and is copied verbatim
to modular Goblet. Keeping the compact renderer there avoids adding a new
runtime asset and new single-file bundling contract. If the WebGL code cannot
remain a small single-purpose section, stop and revise the boundary before
extracting a module.

No type, store, panel, persistence, worker, Rust, WASM, or color-cycle files are
in scope. Any expansion requires an updated cause and explicit approval.

### Track B Verification

#### Deterministic tests first

- GPU path is not initialized while CRT is disabled.
- The first effective CRT render initializes once and later frames reuse all
  programs, textures, and framebuffers.
- Resize reallocates storage but does not recompile programs.
- Same source, settings, dimensions, and fixed seed produce identical pixels.
- Different Vessel source frames produce different filtered frames without
  advancing any filter-owned time state.
- Context creation, shader compilation, framebuffer, upload, and context-loss
  failures select the current CPU fallback.
- Alpha remains unchanged through all four passes.
- Other filters retain fixed stack order before and after CRT.
- Modular and inline Goblet runtimes contain the same GPU and fallback paths.

#### Browser correctness pass

Use one consolidated production-preview interaction on a deterministic fixture:

1. render CRT off, current CPU CRT, and new GPU CRT at the same source size,
   viewport, DPR, background, and settings;
2. capture one representative GPU frame with Spector.js;
3. verify exactly four CRT draw calls, expected FBO sizes, sampler modes,
   program uniforms, and no redundant allocation or state churn;
4. confirm no WebGL errors and record unmasked vendor/renderer when available;
5. run Vessel color-cycle and sequential animation under the filter and confirm
   there is no filter-owned motion;
6. repeat the same fixture in a newly generated Goblet output.

#### Performance measurement

Measure CPU and GPU time separately after warm-up on the same machine/browser:

- CPU wall time around `applyDisplayFilterStack`;
- GPU time for the four passes with `EXT_disjoint_timer_query_webgl2` when
  available;
- source texture upload count;
- draw-call count;
- texture/framebuffer allocation count;
- warmed average and p95 filter time over at least 300 Vessel animation frames.

Acceptance requires:

- zero per-frame `getImageData`, `putImageData`, or full-surface CPU pixel loop
  on the GPU path;
- one source upload and four CRT draws per changed Vessel frame;
- zero GPU resource allocation after warm-up at stable dimensions;
- no substantial playback regression when CRT is enabled;
- no context loss or blank frame during the reported animation path.

Run the repository checks under Node `22.22.0`:

```bash
mise exec node@22.22.0 -- npm test -- src/components/canvas/__tests__/useDrawingCanvasBaseRenderer.test.ts tests/goblet2-runtime-regression.test.ts --runInBand
mise exec node@22.22.0 -- npm run build:goblet-inline
mise exec node@22.22.0 -- npm run verify:goblet-runtime
mise exec node@22.22.0 -- npm run type-check
mise exec node@22.22.0 -- npm run lint
git diff --check
```

Because the shared Goblet runtime changes, run the full Jest suite and
production build before commit.

## Decision Gate

Implement Track B first. Compare it against pinned NTSCRT native reference
frames using the same artwork and geometry.

- If the user accepts the appearance, stop. Do not add `ntsc-rs`, WASM,
  librashader, or the seven-pass runtime.
- If the result lacks specifically identifiable analog-signal behavior, record
  the missing artifact and consider adding one narrow deterministic pass.
- If the user requires measured reference parity after that comparison, pause
  Track B and begin Track A with the license audit and native golden harness.

## Overall Stop Condition

The work is complete when the selected track is deterministic, preserves
Vessel animation and transparency contracts, has no filter-owned animation,
passes Vessel and Goblet parity checks, produces no WebGL errors, reuses GPU
resources after warm-up, and receives the user's live visual acceptance.

Do not claim an exact NTSCRT match for Track B. Do not claim byte identity for
Track A unless the native/browser golden comparison actually measures it.
