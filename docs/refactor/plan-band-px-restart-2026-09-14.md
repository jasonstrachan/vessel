# Band px — problems and goals

## Two separate things

- **Dither pattern:** the texture and marks made by the selected brush tip.
- **Bands / gradient:** the colours that move through that pattern.

Band px controls colour spacing by canvas distance. It must preserve the dither pattern and tip shape.

## Problems

- The implementation confused the dither pattern with the moving colour bands.
- Narrow spacing, especially 1 px, lost the original dither character.
- The selected tip shape was not preserved for each band/stamp. Preserving only the overall stroke outline is insufficient.
- Finalizing long strokes became slow.
- Passing code tests was mistaken for proving the brush looked right.

## Goals

- Change colour-band spacing without changing the dither pattern.
- Preserve the selected tip shape for each band/stamp, not just the overall stroke outline.
- Longer strokes get more colour bands instead of stretched bands.
- Keep the gradient moving smoothly through the pattern.
- Performance first: keep drawing and finishing strokes responsive.
- The live preview should approximate the finished stroke as closely as practical without sacrificing performance; an exact match is not required.
- Start again from the earlier working brush and verify the result visually against it.

## Restart scope and evidence

- Baseline: current committed brush at `d3adb47ba`, retaining unrelated staged gradient work.
- History audit: the stroke `Band px` control and sampled-path palette format were uncommitted. `d5403fe66` and `99729173b` changed sampled finalization; its nearest-path projection is replaced for dither stamps. Pencil retains its existing whole-stroke path.
- Removed the abandoned extended palette, renderer, export, packing and serialization changes. Backups of removed working changes are in `/tmp/vessel-band-px-restart`.
- Authoring owner: `colorCycleStrokeTimingRuntime`, the standard/custom stamp runtimes and their instance settings. Geometry, stamp spacing, dither masks and playback remain owned by their existing code.
- Sample finalization owner: stamp tags and one distance per stamp, consumed by `ccSampling` through the existing runtime owner in `colorCycleCommit`. No new persisted format.
- Verification: compare square, round, triangle and diamond in the production preview at 1 px and 20 px; check animation and long strokes. Regression tests compare original dither coverage and check fixed spatial repetition and sampled stamp ownership.
- Stop condition: targeted tests, type-check and lint pass; live comparisons retain visible tip-shaped bands and dither marks; long strokes finish responsively.

The existing 255-index palette still limits sampled colour precision. More physical bands may share a colour on long sampled paths; Band px does not allocate a larger playback palette. Stamp spacing remains independent, so colour transitions are represented at available stamp positions.

Performance follow-up: CPU profiling found repeated `getImageData` calls dominated sampled drawing (2.5 seconds in a 3.8-second short-stroke trace). Scope expanded to `useDrawingCanvasSampling`, `canvasSamplingBatch`, and its tests. A synchronous gradient sampling pass now reuses 256 px readback tiles; it releases every tile at the end of the pass. Ordinary single-pixel picking keeps its existing readback path.

## Final verification

- Production preview: square, round, triangle and diamond compared at 1 px and 20 px against the restored brush; sampled dither stamps also inspected after palette binding completed.
- The same roughly 4,600 px sampled gesture committed in 185 ms after readback batching (263 ms before); observed long tasks fell from 448 to 1. These are local automated-browser measurements, not device-independent guarantees.
- Live control: changing Band px to 2 updated the engine to 2 while retaining triangle tip, 1 px stamp spacing and 2 px dither resolution.
- Playback changed 150,936 rendered colour pixels while keeping authored paint indices unchanged.
- Targeted brush, sampling, settings, UI and readback tests passed. Type-check, lint and production build passed.
- Screenshots: `output/playwright/band-restart-baseline.png`, `band-restart-1px.png`, `band-restart-20px.png`, `band-restart-sample-1px.png`, `band-restart-long-sample.png`, and `band-restart-final-controls.png`.
- Ordinary non-dither sampled strokes and Pencil keep their existing sampled projection. The new stamp-owned finalization applies to dither strokes.

## Unresolve Band px correction

The earlier sampled stamp remap still normalized ink indices by total path
length. Reproduced through Effects → Unresolve → Sample strokes: On: finishing
changed 21,997 existing pixels at 1 px and 22,079 at 20 px, spreading the gradient
across both strokes. The finalizer must preserve distance-authored dither ink
indices; only the sampled palette is frozen and bound on release.

Scope: `colorCycleCommit`, `ccSampling`, their tests, and removal of the now-unused
stamp distance fields/writes in `strokeStampDither/state` and `index`. These six
files remove the superseded remap and its metadata. This artist guide and plan
record the corrected contract. No playback format or private extension changes.
The earlier long-path precision caveat above described the removed remap: dither
strokes now repeat their gradient at fixed spacing regardless of total length.
Non-dither Sample and Pencil retain their existing mapping.

Exit criteria: the same Unresolve toggle and 1 px / 20 px gestures preserve
existing paint indices at release, keep the visible dither/tip pattern, and animate;
a longer gesture adds bands without widening them. Targeted tests, type-check,
lint, and a Studio production build must pass.

Verified in the private Studio production preview through the actual Sample
strokes toggle. The 1 px and 20 px triangle strokes visibly retain separate
spacing after release. A roughly 1,690 px folded stroke at 20 px finished in
116 ms with zero existing paint indices changed; playback changed 294,117 RGBA
components. Screenshot: `output/playwright/unresolve-band-after.png` (before:
`output/playwright/unresolve-band-before.png`). The shorter strokes retained 761 release-time pixel changes each; their
exact final-stamp contribution was not isolated. Targeted suites: 117 tests passed; final commit fixture
rerun: 17 passed. Type-check, lint, Studio production build, and diff check passed.
Browser session and temporary Studio preview server were closed.

## Remaining mode coverage

Outcome: one canvas-distance colour spacing control for CC strokes (Palette,
FG Grad, Sample, Pencil, bristles, and captured custom tips) and CC Shape.
Non-goals: changing stamp geometry, strand fields, pressure masks, dither algorithms,
playback format, or the dedicated Gradient tool's authored range/ink controls.

Stroke owners: `colorCyclePaintStrokeRuntime`, `colorCycleCustomStampRuntime`,
`colorCycleCommit`, and `ccSampling` (remove the obsolete nearest-path remapper).
Settings/control owners: `colorCycleInitController`, `colorCycleBrushSettingsController`,
`BrushControls`, plus their tests. Custom Band px uses the existing committed-value
hook exactly once; the second committing slider wrapper discarded the new value.

Shape scope necessarily expands across both authoring backends: shape execution
context/API, linear/concentric runtimes and perceptual helpers, linear scanline,
`distanceBands`, `concentricFillCore`, fill worker/types, `ColorCycleAnimator`,
and `WebGLColorCycleRenderer`. Each carries or consumes the same optional spacing;
CPU/worker and GPU convert physical distance to the repeating palette position.
Goblet needs no authoring change: saved indices and motion channels are unchanged.

Verification: deterministic repeat-width and texture checks for Pencil, bristles,
captured tips and growing linear/concentric shapes; worker parity; slider commits;
production-preview strokes, captured custom tips, shapes, GPU error check and
playback. Stop when these paths pass, along with type-check, lint and build.

Final mode verification:
- 180 targeted tests passed across seven suites, plus 17 settings/init tests.
- Type-check, lint, production build and diff check passed.
- Live Sample strokes without Dither, Pencil, and bristles retained repeated
  colour bands and their distinct grain/strand detail; release took 88–122 ms.
- Captured-tip slider committed 2 px in the real UI. Both 2 px and 20 px strokes
  retained the captured diamond's internal two-colour pattern (25 authored inks).
- Small and large CC Shape polygons showed matching concentric band widths.
- GPU validation exposed an existing illegal dynamic uniform-array subscript.
  The same shader now traverses adjacent vertices using the loop index, then
  explicitly closes the polygon. All four linear/concentric GPU calls succeeded;
  shader error list was empty and `getError()` returned zero. Linear rows matched
  across different widths and repeated every 20 px for four 5 px bands.
- Four GPU fills took 156.6 ms including first shader compilation, then 28.5 ms
  warm (the former CPU fallback took about 45 ms in the comparable fixture).
  Playback changed over 372,000 RGBA components in the check.
- Evidence: `output/playwright/band-all-strokes.png`, `band-all-shapes.png`,
  `band-captured-tips.png`, and `band-shapes-gpu.png`.
- Exact Playwright session cleanup completed. No commit or push performed.

## Sampled playback smoothing

User correction: improve colour continuity, without increasing palette capacity.
Owner: `buildSampledStops`, shared by live sampling and finalization. A small
periodic Gaussian filter smooths premultiplied RGBA around the sampled colour
cycle; the last stop matches the first. It retains broad source regions and the
raw sample observations, and softens narrow colour spikes. A one-point generated
two-colour ramp also returns smoothly to its first colour. Shape sampling and
stamp/index geometry remain unchanged.

Scope: `ccSampling`, `smoothSampledGradient`, their tests, the existing mark-session
finalization test, and this plan/artist guide. Stop condition: live before/after
colour-jump reduction with unchanged spacing and texture, responsive playback,
passing tests/type-check/lint/production build.

Before: a two-colour sampled stroke had a 204-channel-level jump at its edge and
loop seam while browser playback frames remained approximately 16.8 ms apart.
This fixture reproduced colour discontinuity without dropped animation frames.

Smoothing verified in production preview: the same two-colour sampled stroke's
largest adjacent channel jump fell from 204 to 10; the loop seam fell from 204
to zero. Palette stop count stayed 256 and authored ink count stayed 25. Triangle,
2 px dither resolution and 20 px Band px were unchanged. Playback maximum frame
interval was 16.7 ms, compared with 16.8 ms before; release was 131 ms versus 141 ms.
These are local fixture measurements. The before/after and Palette reference
were inspected visually (`sample-smoothing-before.png`, `sample-smoothing.png`,
`sample-palette-smooth-comparison.png` in `output/playwright`). 48 targeted tests,
type-check, lint, production build and diff check passed. Browser cleanup passed.


## Source-aligned Unresolve repair

The earlier removal of sampled final alignment fixed distance spacing but discarded
Resolve's source position. Filtering the only saved gradient also changed its
source colours. Those two decisions above are superseded for Studio sampled strokes.

The native contract now reserves flow byte 4: paint stores the source lookup;
phase stores the existing distance-band lookup. A cycle starts and ends at the
unfiltered source. Each pixel samples one continuously moving palette position.
The shortest circular correction reaches the distance-band index halfway through;
two palette turns per cycle keep that correction from cancelling motion. Forward
and Reverse easing keeps at least 25% clock velocity at maximum strength.
No palette-capacity increase, source
image, persisted path, or per-frame CPU remapping is introduced. Ordinary public
Sample retains its previous smoothed distance authoring.

Scope: sampling/session/finalization, transient dither stamp ownership, Canvas2D
and WebGL playback, shared Goblet math and Goblet2 rendering, the private Unresolve
compiler/registration, and their regression tests. Generated Goblet assets follow
from the shared playback source. This exceeds six files because authoring,
serialization normalization, both renderers and export must agree on the new mode.

Resolve must reproduce the sampled alignment; moving frames must retain Band px
spacing and stamp geometry; Apply/return-to-zero must preserve bytes; long-stroke
finish and sustained playback must remain responsive. Pre-existing distance-only
strokes lack source positions and cannot be reconstructed automatically.

Final production evidence: 1 px and 20 px triangular dither strokes matched all
51,244 checked source pixels outside the colour boundary. Resolve/Apply and a
return after playback changed zero rendered channels. A 1,690 px folded stroke
finished in 176 ms; sustained playback median/p95/max were 16.7 ms. Switching
from dither to Pencil matched 2,646 checked pixels and finished in 136 ms.
Goblet2 CPU/GPU outputs matched at five phases. The 144 focused tests, 13 private
Unresolve tests, type-check, lint, and final Studio production build passed.
Screenshots: `output/playwright/unresolve-source-resolved.png`,
`unresolve-source-moving.png`, and `unresolve-long-resolved.png`.


## Remove the rejected Resolve crossfade

Live reproduction found 27,770 painted pixels unchanged across advancing clock
steps at the Forward/Reverse wrap and Pendulum midpoint. The stationary-source
crossfade also produced off-palette colours. It is removed from CPU and both GPU
renderers, including the five-tap filtering that was part of that workaround.
Palette-coordinate travel replaces it; the existing source and distance indices
are retained. Tests must prove nonzero directional travel, palette-only output,
source alignment, and continuous Pendulum middle crossings. Visual mode checks
include zero and maximum easing in the production Studio.

## Preserve dither contrast throughout Unresolve

The user explicitly chose original dither contrast over exact source pixels at
Resolve. The earlier source-pixel comparison was insufficient: it compared output
against rewritten indices, not the original brush appearance.

Finalization now retains the original circular ink separation in both source and
distance coordinates. Both inks therefore receive the same motion correction at
every phase. The reserved transparent paint byte is handled by moving the whole
pair one palette entry when necessary, never changing its separation. The commit
brush facade now forwards stamp ownership; previously it silently dropped this
method and forced per-pixel source projection. Source-aligned sampled palettes
also use the existing cyclic smoothing instead of reinstating a hard loop seam.

This changes authoring, not the persisted format or the renderers. Old finalized
strokes lack reliable original ink ownership and must be redrawn; do not guess a
migration. Scope: alignment and sampling plus their tests, brush registry and its
integration test, and the artist guide/this correction to the superseded contract.

Verification: the ink-separation regression failed on the previous authoring and
passes across wrap cases and 65 cycle positions. 168 affected tests, type-check,
lint, and the Studio production build passed. Live triangular strokes at 1 px and
20 px retain visible dithering at Resolve and five moving phases; Apply/playback
change no painted-mask pixels. Full loops in Forward, Reverse, and Pendulum at
0/100 easing had no long holds or WebGL errors (maximum unchanged runs 1–3 display
refreshes). Display refresh p95 was 16.8 ms; this is not an animation-FPS claim.
A roughly 1,700 px folded stroke finished in 162 ms. Screenshots are in
`output/playwright/unresolve-pairs-*.png`. These checks do not establish that old
strokes with discarded ownership can be repaired automatically.


## Fixed sampled sequence (supersedes source-alignment/morph work above)

User-confirmed contract: sample the entire stroke in order; play that sequence
through fixed distance-band indices and the original dither marks. Resolve is
phase zero of that same sequence, not reconstruction of the underlying image.

Removed source-index remapping and its transient stamp-ownership plumbing. The
Studio opt-in now only preserves sampled palette colours from an additional
palette derivation pass. New strokes keep their ordinary authored indices.
Legacy flow 4 reads its retained distance-band index from the phase byte, then
uses the same uniform palette shift as flow 1 in CPU, native GPU, and Goblet2.
The per-pixel shortest-path correction, cosine morph, and extra palette turn are
removed. Existing morph strokes retain their stored palettes and original band
indices; no inferred dither reconstruction or new persistence format is needed.

Keep the narrower gradient softness, dither authoring, Band px distance timing,
mode-selection persistence, shared Unresolve clock and endpoint easing fixes.
Verification must compare actual moving frames with one common palette shift,
check masks and ink pairs across the loop, and test legacy export parity.

Verified in production Studio at 1 px and 20 px with triangular dither: 27,770
painted pixels matched the ordinary single-shift calculation exactly at seven
phases, including return to zero. Masks were unchanged and new strokes used flow
1. Forward, Reverse and Pendulum completed full loops at 0/100 easing without
WebGL errors; the maximum-easing Pendulum turn had up to six identical display
refreshes at the reversal, not an intermediate layout transition. Legacy flow-4
Goblet CPU/GPU frames matched at five times. A roughly 1,700 px folded stroke
finished in 123 ms. 342 affected public/Studio tests, type-check, lint and the
production build passed. Screenshots: `output/playwright/fixed-sequence-*.png`.

### Source-position correction (supersedes repeated-band Unresolve mapping)

New native Sample + Unresolve stamp-dither strokes retain cumulative positions per
stamp until finalization. The finalized indices cover the sampled sequence once,
with Band px grouping positions by canvas distance. Both original dither inks use
that position through lighter/darker versions of the same sampled palette; no
quarter-palette offset, crossfade, or geometry morph is used. The existing native
palette/definition buffers carry the result into history and Goblet. New strokes
use the shared clock speed immediately. Ordinary Sample, Pickup, Pencil, Bristles,
and fills retain their existing paths. Previously committed strokes lack the
positions needed for this correction and require redrawing; drawing preview is
still approximate until finalization.

Visual verification used broad light/dark source regions: diamond tips at 4 px and
triangle tips at 1 px followed their source regions at Resolve while retaining the
fixed dither texture. The 1 px stroke finalized in 166 ms in the browser fixture.
Forward, Reverse and Pendulum moved those palettes without changing authored
indices. Goblet CPU/GPU matched exactly at four tested playback times using the
new stroke's stored buffers and palette definitions. These checks support the
mapping contract; visual acceptance on the user's photograph remains theirs.


### Fixed spacing repair, 2026-09-15 (supersedes source-position correction)

The source-position correction reintroduced the reported bug: it divided each
stamp distance by the completed path length. The live Studio reproduction at
20 px advanced about 23 palette positions per band on a 220 px path but only
about 10 on a 520 px path. At 1 px, long paths also collapsed neighbouring bands
onto the same palette index.

Preserve the existing distance-authored primary index for both ink palettes in
preview and commit. Unresolve still supplies shared clock speed and phase; the
sampled sequence repeats at fixed spacing. Remove the superseded stamp-distance
bookkeeping and finalizer spacing parameter. Keep dither ownership, masks,
strand phase, sampled colours, persistence and playback formats intact.

Verification: compare short and long native Unresolve strokes at 1 px and 20 px
in the production Studio, test preserved authoring and prefix indices through
multiple wraps, check dither masks and moving frames, and run affected tests,
type-check and lint. Existing strokes retain their stored mapping.

Verified in the rebuilt production Studio: 220 px and 520 px triangle strokes at
1 px and 20 px retain the same distance-band sequence, including repeated wraps
on the longer strokes. The original painted mask was unchanged on release.
Six sampled playback phases changed colours without changing any authored index
or alpha-mask pixel; phase zero returned to the same rendered image. Goblet CPU
and GPU frames matched exactly at 0, 1, 4 and 8 seconds using those stored strokes.
243 affected tests, public and Studio type-checks, lint and the Studio production
build passed. Visual evidence: `output/playwright/band-length-before.png`,
`band-length-fixed.png` and `band-length-moving.png`.


### Reference-aligned fixed bands, 2026-09-15 (supersedes repeating repair)

The repeating-index repair above was incorrect for Resolve: it preserved band
width but discarded source correspondence. A live Diamond reproduction matched
only 44% of painted pixels to the controlled reference within 35 intensity levels.

Native sampled Unresolve stamp dither with Bristles off now samples fixed-distance
band centres and stores the full ordered RGBA sequence. Each definition owns at
most 255 bands and refers to its offset in that sequence. Flow byte 5 marks rows
that have already been animated from the full sequence; renderers must not apply
a second local palette rotation. Resolve uses phase zero. Sections carry through
history, project archives, private Unresolve anchors and Goblet2 playback.

Regression coverage must prove both source correspondence and fixed band widths
past 255 positions, movement across sections, both ink ownership and unchanged
coverage. Repeating authored indices alone are not an acceptance test. Existing
strokes lack the necessary source positions and retain their saved appearance.


Verified in the production Studio with Diamond, Band px 1, Ink Spd 57,
Bristles/Pencil off: 520 source bands retain their mask through Resolve and moving
playback. At Contrast 70 the measured interior ink mixture differs from the
reference by at most 0.003 in linear-light channels; Contrast 100 deliberately
expands the source range. Finalization took about 210 ms in this fixture.
The permanent browser fixture compares both Goblet renderers to the expected
source sequence at five phases, including motion across 255-band boundaries and
return to Resolve. It caught and now guards against export normalization dropping
flow 5 and causing a second palette shift. Session, animator, archive and private
Unresolve tests cover full source retention, ink ownership, seams and anchors.
