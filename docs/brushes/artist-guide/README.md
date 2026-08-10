# Vessel Brush Artist Guide

## Our collaboration painting protocol

This is the default visual grammar when Jason and the AI take turns on one
artwork. It overrides the more general recipes elsewhere in this guide.

### Match the brush family to the layer before drawing

**Color Cycle brushes can draw only on a Color Cycle layer. They cannot draw
on a normal layer.** This includes Color Cycle Stroke, Shape, Gradient, Flat
Dither, Triangle, Checkered, and any custom brush carrying Color Cycle data.

- Before selecting a brush or sending a gesture, inspect the active layer type.
- When continuing the CC visual language, “new layer” means a new **Color Cycle
  layer**, not the default normal `Layer 1`.
- If the active layer is normal, stop and create or select a compatible Color
  Cycle layer. Never treat an unused normal layer as an equivalent test target.
- Normal raster brushes belong on normal layers. Match both directions of the
  contract instead of relying on a failed stroke to reveal the mismatch.
- Automation must preflight `brush family -> active layer type` before every
  painting batch and fail clearly without dispatching pointer events when they
  do not match.
- To start a separate pass, use bridge action `create-layer` with `layerType`
  set to `color-cycle` or `normal`. The new layer becomes active immediately;
  CC runtime and layer history remain owned by Vessel.

### Erasing is a gesture, not a different painting system

Use the same canonical stroke path with `tool: "eraser"`. It erases the active
normal or Color Cycle layer using Vessel's current eraser settings and creates
normal undo history. Check that the target layer is active, visible, and
unlocked before erasing. Return to painting with `tool: "brush"`; do not fake
erasures with white paint or direct pixel-buffer edits.

For Jason and AI collaboration, a valid artistic mark is permanent once
committed. Do not use undo or erasure to remove it for aesthetic reasons unless
Jason explicitly changes that rule for the current artwork. Later shapes may
overlap, contradict, absorb, or redirect the earlier mark.

### Look, remember, then draw

The collaboration method is `look -> hold a mass in memory -> draw it -> look
again -> respond`. Particular inaccuracy produced by genuinely observing the
subject is part of the work. Generic blobs, symbols, and reusable polygons come
from insufficient observation and should be prevented before the gesture.

A mass is one connected observed colour/value/material plane, not a semantic
object or face part. “Head”, “eye”, “nose”, “shirt”, and “background” are only
names; each may contain many distinct masses and cannot stand in for looking.

Before drawing, record the mass's normalized source crop, at least three
interior colour/value samples, its visual distinction from neighbours, its
neighbour and occlusion relations, and the current visible checkpoint. Then
describe its source boundary with 20-60 meaningful anchors. Each anchor names a
turn, curvature change, corner, flat, notch, bulge, taper, interruption,
occlusion, or closure; its edge character; its adjacent region; and a stable ID.

Hide the source before translating that observation into a gesture. The
remembered contour answers every source-anchor ID in order. Preserve the source
boundary and remembered contour separately: their difference is where
particular inaccuracy enters. Extra interpolated pointer samples may preserve
continuous motion, but they do not add observational information.

A complex portrait normally contains hundreds of such masses rather than a few
dozen enlarged containers. The exact inventory comes from the image. Spend
materially more mass density on focal and structurally important regions, and
use the approximate 5/15/80 establish/develop/deepen distribution across that
observed total.

### Bridge controls before a painting batch

Start with `observe` and `capture: "none"`. Read back the active layer, brush
preset and capabilities, FG/BG palette, gradient source and stops, dither
configuration, CC settings, and eraser settings. Do not infer them from the
previous turn.

Every shape or stroke must start inside the canvas—never outside it.

For reference preparation, preserve the source aspect by default. Supply the
requested width and let `prepare-reference` derive the height; an explicit
mismatch is rejected unless `--allow-aspect-mismatch` is present. Treat the returned
`reference.transform` as the sole mapping from source-image coordinates to
project coordinates. Analysis and authored shapes must use that same mapping.

- `set-palette` changes FG, BG, the active swatch, or swaps FG/BG. Setting
  `foreground` is the canonical way to choose the painting colour.
- `set-gradient-source` selects `fg`, `manual`, or `sampled`. In sampled mode,
  the next canonical stroke or shape supplies the sample path.
- `set-gradient` supplies manual stops, adjusts FG-gradient Light/Hue/Sat/
  Opacity/Stops, or resets the sampled gradient. Manual stops are a completed
  authoring decision: the bridge forks the active layer palette for future
  marks so earlier pixels retain their original gradient.
- `set-brush` owns shared settings plus brush-specific dither controls. Use
  `fillResolution` for dither shapes and Flat Dither; use
  `colorCycleStampDitherPixelSize` for CC Stroke stamp dithering. They are not
  interchangeable Res controls.
- `set-eraser` owns eraser size, opacity, size linking, and square/round/
  diamond tips. The following `stroke` still needs `tool: "eraser"`.

Send compatible setup operations and gestures together in one batch. Observe
again only when either collaborator changed settings outside that batch or when
the returned state does not match the requested controls.

### Collaboration runtime and checkpoint contract

Connect one already-open Vessel tab once and keep that runtime for the artwork.
`prepare-reference` waits for the compatible claimed runtime; it does not open,
navigate, reload, or attach a browser tab. AppleScript and Playwright are not
painting transports. Create the connection through Vessel's one-use pairing
URL; it resolves the bridge's authoritative URL and arbitrary port, and it
cannot be reused.

- Every authoring command carries the claimed protocol/build/instance/lease
  identity. Once the project exists, it also carries the expected project ID
  and revision. A stale fence fails before a mark starts.
- Collaboration shapes call Vessel's internal shape handlers directly. The
  ordered boundary and optional direction are one canonical gesture; direction
  is not replayed as a second painted line.
- Each stage is a bounded job with a named checkpoint. Inspect that rendered
  checkpoint before planning the next stage; do not plan the whole portrait as
  one static operation list.
- A checkpoint decides `advance` or `continue-current`. Continuing keeps the
  same conceptual pass open for more permanent observed responses; completing
  an operation list never forces progression.
- Artwork stages have no default time deadline. Their bounds are the declared
  mark budget, canonical completion, and named checkpoint—not elapsed minutes.
- Count only marks whose canonical document evidence says `committed`. A
  rejected or unverifiable attempt never became an artistic mark.
- Hard failures are limited to unsafe or invalid execution contracts such as
  non-finite data, an off-canvas start point, an incompatible layer/runtime, or
  a stale fence. Coverage, span, and direction placement are diagnostics, not
  universal size rules. A self-intersecting candidate is rejected individually
  and the job continues to its checkpoint. Independent polygons may overlap.
- Keep one persistent bridge client. Reconcile uncertain work by command ID and
  the bridge journal; never recover by reloading the artwork tab.
- Precompute immutable source-derived candidates, but derive every response from
  the latest authoritative checkpoint. Fence every dispatch to the exact
  project revision and planning checkpoint; stale geometry must fail before the
  first mark.
- Reusing a request ID with identical content returns its original result;
  different content fails. Never automatically retry an unfinished or partially
  committed job. Recover its authoritative revision and committed operation IDs,
  then plan a new fenced continuation.
- The 100-operation batch ceiling is a synchronous transport guardrail, not the
  artwork's shape budget. Set creative budgets for the whole intervention and
  continue to its checkpoint without an agent or browser round trip per mark.
- Treat the planned shape and stroke budgets for an artistic stage as initial
  plans, not ceilings. Set them from observed connected regions and linear
  structures plus explicit response capacity, then extend the stage through
  additional validated batches whenever its committed checkpoint remains
  underdeveloped. The 100-operation batch ceiling remains a transport safety
  limit for each dispatch, not a completion rule for the artwork.
- Apply gesture, point, and serialized-payload limits after cached candidates,
  transforms, and residual operations have been expanded. Residual geometry
  records its source revision, parent mass, and reference region. Current staged
  artwork commands also carry mass-plan schema v3 provenance: observation
  checkpoint, fingerprint, observed-mass count, source-region ID, and meaningful
  boundary-anchor count.

### Two types of marks: strokes and shapes

All brush choices should first be understood as one of two mark types:

| | Stroke | Shape |
| --- | --- | --- |
| **What it is** | A path drawn through the painting | A closed region drawn and then filled |
| **Primary job** | Contours, seams, gestures, connections, and detail | Main silhouettes, colour/value masses, planes, and bounded fields |
| **What Size means** | Line weight; comparable strokes should use consistent brush sizes | Boundary-tool size, not the dimensions of the resulting object |
| **Overall scale** | Determined by path length and line weight | Free: a shape can occupy any width or height in the composition |
| **Detail control** | Brush size, spacing, and the stroke's dither Res | Dither Res is the main level-of-detail control, independent of shape size |
| **Typical brushes** | [Color Cycle Stroke](color-cycle-stroke.md) | [Color Cycle Shape](color-cycle-shape.md) and [Color Cycle Flat Dither](color-cycle-flat-dither.md) |

For a **stroke**, preserve brush size as part of the artwork's line-weight
language. Changing Size changes the visual weight of the line.

For a **shape**, draw the boundary at whatever dimensions the composition
requires. The shape may be tiny or fill most of the canvas. Do not use its
physical size to decide its detail level: preserve or change **Res** according
to the detail and distance the shape represents. Gradient-based shape brushes
may add a second gesture after the boundary to establish colour direction.

### Drawn, not mechanically perfect

Lines and shapes should retain the evidence of drawing. Unless the concept
specifically requires machine geometry, do not make perfectly straight lines,
perfect circles, exact rectangles, or uniformly smooth contours.

- **Strokes** should be confident but imperfect paths. Keep small changes in
  direction, pressure, spacing, and curvature instead of repeatedly tracing a
  line until it becomes mechanically clean.
- **Shapes** should have hand-drawn boundaries: slight asymmetry, uneven
  corners, small bulges, imperfect closure, and local changes in curvature are
  welcome.
- Let useful mistakes remain when they give the object character, energy, or
  vulnerability. Correct a mistake when it damages the main silhouette,
  spatial reading, or intended gesture.
- Irregularity should come from the act of drawing, not from applying random
  noise everywhere. The contour should still describe the object clearly.
- Do not create “handmade” variation by randomly changing brush size, Res, or
  dither algorithm. Keep the material language consistent while allowing the
  geometry to wobble.
- Avoid Grid Snap and the Rect, Oval, Line, or Click Line construction modes by
  default. Use them only when rigid geometry has a specific role in the work.

The goal is **controlled imperfection**: the large shape reads immediately,
but its edge reveals a hand, a decision, and a moment in time.

### Keep one mark language

- Use the same brush family and roughly the same brush size for comparable
  lines. Change size to establish a deliberate hierarchy, not simply because a
  new object has begun.
- Keep **Dither on** wherever the selected brush supports it.
- Use **Sierra Lite** as the default dither algorithm across the painting.
- The three primary brushes are [Color Cycle Stroke](color-cycle-stroke.md),
  [Color Cycle Shape](color-cycle-shape.md), and
  [Color Cycle Flat Dither](color-cycle-flat-dither.md).
- Do not change brush, algorithm, spacing, or scale merely to add novelty. A
  repeated vocabulary makes separate human and AI turns belong to one image.

### Use Res as the level-of-detail system

`Res` controls dither-cell size: a higher number produces larger, coarser
cells. It is the key control for keeping the painting's detail hierarchy
coherent.

| Passage | Res relationship | Result |
| --- | --- | --- |
| Focal, near, or detail-bearing | Lower | Smaller cells and more available detail |
| Middle distance or supporting mass | Intermediate | Simplified but still descriptive |
| Far, secondary, or intentionally reduced | Higher | Larger cells and less detail |

These are relative tiers, not invented fixed numbers. Before adding to an
existing passage, inspect and reuse its current Res. Change Res when an object's
distance or required detail changes. A shape may be any physical size: do not
automatically raise Res just because the shape is large.

When pressure-linked resolution is active, the effective coarse limit is
`Pres Res Max`, not the disabled base `Res` slider. Preserve that value when
continuing a detail tier.

### Build from large to small

1. **Establish** with approximately 5% of planned shapes: a few large support,
   silhouette, and dominant colour/value masses.
2. **Develop** with approximately 15%: secondary overlapping masses that
   organise internal structure.
3. **Deepen** with approximately 80%: repeated observation and nested masses,
   transitions, interruptions, negative spaces, and concentrated detail.

The percentages describe shape count, not coverage or a signoff quota. Deepen
may span several bounded batches and still includes medium or large responsive
shapes; it is not a layer of tiny decorative details. Strokes remain reserved
for genuinely linear structures.

Large-to-small describes hierarchy, not a forced monotonic size sequence. Each
shape takes its physical extent from the observed region. Develop and deepen
need varied scales, and a later response may be physically large.
`Res` controls the dither detail tier independently of that geometry.

Do not disguise an unclear silhouette with symbolic detail. Look again and add
the larger permanent mass the artwork now asks for.

## About this guide

This is an artist-facing guide to the brushes currently exposed by Vessel. It
describes what the controls do, but its real subject is choice: which kind of
mark helps the painting say what it needs to say.

Checked against the Vessel source on 2026-08-07. Brush behaviour is owned by
`src/presets/brushPresets.ts`, `src/components/toolbar/BrushControls.tsx`,
`src/components/toolbar/DitherControls.tsx`, and the relevant brush runtimes.

## Start with the job of the mark

| Need | Start with |
| --- | --- |
| A precise edge, small correction, or deliberate line | [Pixel](pixel.md) |
| Atmosphere, glow, shadow, or a soft transition | [Soft](soft.md) |
| Chunky colour structure and repeated blocks | [Mosaic](mosaic.md) |
| A textured line whose density reacts to pressure | [Dither Stroke](dither-stroke.md) |
| A bounded mass made from tonal texture | [Dither Shape](dither-shape.md) |
| A woven, tiled animated texture | [Checkered](checkered.md) |
| A directional transition made from pixels | [Dither Grad](dither-grad.md) |
| An animated contour or line of energy | [Color Cycle Stroke](color-cycle-stroke.md) |
| A faceted animated contour | [Color Cycle Triangle](color-cycle-triangle.md) |
| A bounded animated colour field | [Color Cycle Shape](color-cycle-shape.md) |
| Animated colour with a spatial direction | [Color Cycle Gradient](color-cycle-gradient.md) |
| A stable dither texture with colour moving through it | [Color Cycle Flat Dither](color-cycle-flat-dither.md) |
| A directional plane of sampled or chosen colour | [Rectangle Gradient](rectangle-gradient.md) |
| A filled form with structural marks such as hatching or stipple | [Shape Pattern](shape-pattern.md) |
| Language, noise, propaganda, or data as material | [Spam Text](spam-text.md) |
| Clone, smear, echo, or feed the painting back into itself | [Resampler](resampler.md) |

Vessel also contains a `shape-gradient` preset definition, but it is excluded
from the active preset list and hidden by the library. It is not treated as an
available brush here.

User-made custom brushes are dynamic rather than one fixed preset. Their
available controls depend on the captured tip and whether Color Cycle data was
captured, so use the closest built-in guide for the active mode and treat the
captured tip itself as the new material.

## Shared mark controls

These controls appear only where the brush supports them.

| Control | What it changes | How to use it deliberately |
| --- | --- | --- |
| **Size** | Diameter or extent of the mark. | Establish hierarchy. Large marks state masses; small marks clarify selected edges. Matching every existing line weight usually flattens the image. |
| **Opacity** | Alpha of newly applied paint. | Use low opacity to accumulate atmosphere; use high opacity for decisions that should read as structural. |
| **Spacing** | Distance between repeated stamps along a stroke. | Low values make a continuous line. High values reveal rhythm, beads, gaps, and the identity of the tip. |
| **Vel** beside Spacing | Makes spacing respond to stroke speed. | Useful when gesture should stretch or compress the rhythm. Disable it when repeatability matters. |
| **Pressure** | Enables pressure response. | Use it when the hand's emphasis should remain visible. A stable graphic system may be stronger without it. |
| **Min / Max** | Size deltas below and above the base size. | These are offsets around 100%, not absolute sizes. A modest range preserves control; a wide range makes tapered, calligraphic marks. |
| **Rotation** | Turns the stamp with stroke direction or configured angle. | Meaningful with asymmetric tips; nearly invisible with a round tip. |
| **Dashed** | Breaks the stroke into repeated lengths and gaps. | Turns a contour into notation, stitching, motion, or measured rhythm. |
| **L / G / V** | Dash length, gap, and velocity gap boost. | Use L and G to establish metre. V lets speed pull the pattern apart. |
| **Grid Snap** | Quantizes positions to a grid. | Creates architectural alignment and a shared visual grammar across separate marks. |
| **Grid size** | Size of the snapping interval. | Choose it in relation to the composition, not just the brush: a recurring module can bind the painting together. |
| **Lostedge** | Randomly weakens or omits parts of the edge. | Lets a form merge with its surroundings. Preserve hard edges at focal or load-bearing boundaries. |
| **Auto Pick / Sample** | Pulls colour from the canvas while painting. | Makes a brush belong to existing material. Disable it when a new, contrasting voice must enter. |
| **BG Fill** | Includes the background colour in dithered gaps. | On produces a solid two-colour material; off lets the existing painting show through. |
| **Sprd** | Spreads selected palette indices used by a dither. | Low values keep colours related; high values create stronger chromatic jumps and activity. |
| **Variety** | Broadens variation inside a filled mark. | Use just enough to prevent dead uniformity. Too much can obscure the form's main value. |

## Dither vocabulary

Dither converts a colour or gradient into a spatial pattern. It is not merely a
filter: its scale and algorithm decide whether a passage feels printed,
digital, dusty, woven, or broken.

| Control | What it changes | Artistic consequence |
| --- | --- | --- |
| **Algorithm** | The rule that distributes pixels. | Changes the material character even when the colours stay the same. |
| **Res** | Pixel-cell size, from 1 to 64. | Higher values make larger, coarser cells. This is the reverse of ordinary “image resolution” language. |
| **Pres Res** | Links cell size to pressure. | Makes density part of the gesture instead of a uniform surface. |
| **Max** | Largest pressure-linked pixel cell. | This is the effective coarse end when Pres Res is on; do not judge the effect from Res alone. |
| **Pxl Edge** | Keeps a harder pixel boundary. | On is graphic and explicit; off lets the pattern integrate more softly. |
| **Smoosh** | Smooths pressure-driven cell changes along a stroke. | Reduces abrupt density steps while keeping pressure response. |
| **Pattern controls** | Select pattern/tile, scale, inversion, threshold, and offsets when Pattern is chosen. | Creates authored textile or screen motifs instead of diffusion noise. |

### Algorithm character

| Algorithm | Typical character |
| --- | --- |
| Sierra Lite | Light, fast error diffusion with a lively grain. |
| Sierra 2-row | Balanced diffusion with a slightly broader texture. |
| Sierra 3-row | Smooth, dispersed tonal texture. |
| Bayer ordered | Regular, legible digital or print grid. |
| Pattern | Explicit repeat that can become textile, screen, or ornament. |
| Floyd–Steinberg | Familiar sharp error-diffusion grain. |
| Jarvis–Judice–Ninke | Softer, wider diffusion with less local harshness. |
| Stucki | Clean broad diffusion; useful for controlled tonal fields. |
| Burkes | Directional but economical diffusion. |
| Atkinson | Airy, high-contrast Macintosh-like texture. |
| Blue noise | Even, non-grid speckle with few visible clumps. |
| Void & cluster | Organic dispersed dots, good for stippled surfaces. |

Choose an algorithm because its texture belongs to the subject. Repeatedly
changing algorithms inside one form usually reads as indecision unless the
change marks a real conceptual boundary.

## Surface modifiers

| Control | What it changes | Deliberate use |
| --- | --- | --- |
| **PigLift** | Removes or erodes existing paint before applying the new mark. | Makes scraping, wear, correction, excavation, and light emerging from material. |
| **Strength** | Amount of lifted paint. | Keep low for abrasion; increase when subtraction is the main gesture. |
| **Feather** | Softness around the lifted area. | Low feels cut or scratched; high feels wiped or dissolved. |
| **Texture** | Irregularity of the lift. | Adds physical residue. Too much can make every passage equally distressed. |
| **Riso** | Adds risograph-like texture and misregistration. | Useful when reproduction, print, error, or editions are part of the work. |
| **Intensity** | Strength of the Riso effect. | Let the image remain readable before making the process dominant. |
| **Hue Jitter** | Chromatic deviation in the Riso treatment. | Adds plate-like colour instability. Reserve larger values for passages meant to vibrate. |
| **Edges** | Emphasizes the effect around boundaries. | Helps a printed edge announce itself; can clutter already detailed contours. |

## Color Cycle vocabulary

Color Cycle (CC) paint is animated paint. The motion needs a reason: current,
heat, attention, transformation, memory, signal, or time. If every region moves
at the same speed and complexity, motion loses hierarchy.

| Control | What it changes | Deliberate use |
| --- | --- | --- |
| **Speed** | Rate at which colours cycle. | Slow motion can feel atmospheric or bodily; fast motion reads as signal, urgency, or electricity. |
| **Vel** beside Speed | Links cycle speed to stroke velocity. | Records the energy of drawing in the later animation. |
| **Bands** | Number of indexed colour bands. | Few bands feel poster-like and rhythmic; many bands make smoother chromatic travel. |
| **FG Grad** | Builds the cycle from the foreground colour. | Fastest way to keep a new animated mark tied to the active palette. |
| **Man Grad** | Uses an authored multi-stop gradient. | Best when colour order carries meaning and must be repeatable. |
| **Sample** | Derives the cycle from canvas colour. | Lets animation emerge from the painting rather than arriving as a separate palette. |
| **Light / Hue / Sat** | Varies foreground-derived stops. | Shape the range while preserving a family resemblance to the source colour. |
| **Stops** | Number of foreground-derived gradient stops. | More stops create a longer colour narrative; fewer make a strong oscillation. |
| **Soft seam** | Blends the join in a sampled loop. | Use for continuous flow; disable when the loop boundary should pulse. |
| **Grad / Stroke / Concentric** | Linear, stroke-following, or inward/outward fill logic. | Match colour movement to the form's spatial logic. |
| **Contrast** | Separation across the CC gradient. | Higher contrast makes cycling legible from farther away; lower contrast keeps motion embedded. |
| **Ink Spread** | Expands the colour distribution within the fill. | Increases material reach without changing the drawn boundary. |
| **Drawing shape** | Free, rectangle, oval, line, click line, triangle, or polygon. | Choose a geometry that supports the subject rather than adding complexity by default. |
| **Stamp Dither** | Dithers the repeated CC tip itself. | Breaks a clean animated line into print-like or digital matter. |

The CC stamp buttons—Square, Checkered, Round, Diamond variants, Triangle,
Shape, and Gradient—can change the underlying preset. Treat them as changes of
mark-making system, not merely cosmetic tip swaps.

## Composition before settings

Settings make a brush more specific; they do not supply meaning. A useful
sequence is:

1. Name the job: edge, mass, atmosphere, texture, motion, sample, or language.
2. Choose the simplest brush that can perform it.
3. Establish one dominant scale and one subordinate scale.
4. Add variation only where the subject or gesture changes.
5. Inspect the whole image. Remove detail that competes with the focal structure.

The strongest “advanced” setting is often restraint: one repeated spacing, one
recognizable dither language, and a small family of line weights can make marks
from different sessions feel like one painting.
