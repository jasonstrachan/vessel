# Color Cycle Stroke

**Preset:** `color-cycle-stroke`

**Role:** animated contour, current, and line of energy

**Layer requirement:** Color Cycle layer. This brush cannot draw on a normal layer.

Color Cycle Stroke makes a repeated tip whose indexed colours move after the
gesture is complete. It can describe electricity, blood flow, weather,
attention, signal, time, or any boundary that should remain active.

## Controls

| Control | Effect and use |
| --- | --- |
| CC stamp buttons | Select Square, Checkered, Round, Diamond 5/7/9, Triangle, Shape, or Gradient systems. These may switch the underlying preset. |
| Size | Overall animated line weight. Establish hierarchy just as with a static brush. |
| Spacing / Vel | Stamp interval and optional response to drawing speed. Tight spacing makes flow; open spacing exposes pulses. |
| Speed / Vel | Cycle rate and optional velocity linkage. Use speed as narrative tempo, not a universal special effect. |
| Band px | Canvas distance before the next colour band. Changes the stamp ink pair without changing tip geometry, stamp spacing, or dither resolution. |
| FG Grad | Builds related stops from the foreground colour. |
| Light / Hue / Sat / Opacity / Stops | Defines variation across a foreground-derived gradient. |
| Man Grad | Uses editable authored stops, positions, and opacity. |
| Sample / Hard seam | Derives colours from the canvas and chooses whether the loop join pulses or blends. |
| Contrast | Increases separation across the sampled or derived gradient. |
| Ink Spd | For Palette, FG Grad, Sample and Unresolve, 0 uses identical inks and 100 increases their separation within gamut while preserving their combined colour. Applies to new stamp-dither strokes with BG Fill on; Contrast stays independent. |
| Stamp Dither | Converts the animated tip into a dithered texture. |
| Algorithm / Pattern | Distribution of pixels within a dithered stamp. |
| Res / Pres Res / Max | Base stamp cell size, pressure linkage, and largest linked cell. |
| BG Fill | Makes dither gaps opaque with the background colour or leaves underlying paint visible. |
| Pressure / Min / Max | Varies the overall line weight. |
| Rotation | Turns asymmetric tips along the gesture. |
| Lostedge | Interrupts the animated contour. |
| Dashed / L / G / V | Groups motion into repeated runs and gaps. |
| Grid Snap / grid size | Aligns animated marks to a shared spatial module. |

The default uses a square stamp around Size 20, Spacing 8, 30 FPS, and 12
bands.

Palette, FG Grad, and Sample use Band px for colour spacing in ordinary strokes,
Pencil, bristles, and custom tips. Each stroke keeps the selected tip and texture.
Captured-data tips retain their internal colour differences while the whole tip's
colour phase advances by canvas distance. Bristles retain their strand offsets.

Sample captures the complete path in order, at approximately one canvas pixel
per sample up to 256 samples, then freezes that stroke's gradient on release.
The sampled colour sequence is smoothed around its cycle, including the join
from its last colour back to its first. Small colour spikes soften while broad
colour regions remain. Preview and release use the same smoothing; tip geometry,
dither masks and Band px are unchanged. The captured gradient repeats at Band px
spacing; release does not stretch it
across the completed stroke. Longer paths can contain more repeated bands without
needing more palette entries. The 255 available colour positions still limit
colour precision within one cycle, independently of the number of repeated bands.
Stamp spacing remains independent: boundaries appear at available stamp positions.

CC Shape also uses Band px. Linear fills measure along their direction; concentric
fills measure inward from the polygon edge. Larger shapes add repeated bands.
The dedicated Gradient tool retains its authored gradient range and ink controls.

In Studio, new sampled stamp-dither strokes drawn with Unresolve enabled retain
sample positions along the entire stroke. Band px groups nearby stamp positions;
it does not repeat the complete sampled sequence every few bands. At Resolve,
light and dark regions follow the source along the stroke. Each stamp keeps its
shape, including at overlaps and crossings.

For Palette, FG Grad, Sample and Unresolve, the original dither mask selects between two palettes at the same colour position:
a pair controlled by Ink Spd. At 0 both inks match the contrast-adjusted target; increasing
spread separates a pair within the displayable colour range. The pair follows the
target hue smoothly; neutral targets use a cool/warm axis. Their
area-weighted linear-light mixture preserves the gradient target, including at
100. The actual visible dither mask supplies the ink proportions. Near black,
white and saturated colours, separation is limited to keep that target accurate.
Gradient Contrast uses 0 for a flat range, 70 for the original source range,
and 100 for an expanded range. It adjusts the target before the inks are calculated; Spread
changes the individual inks, not that target. Both palettes move together during
playback. Coarse cells and locally uneven patterns remain individually visible;
colour matching is assessed over an area containing both inks.
Sample retains its ordinary band positions, speed, direction and phase. Unresolve
uses the shared clock speed from the first finished stroke, before Apply.
The selected loop seam is applied to the target gradient before the inks are
split, so a soft join preserves the same colour match throughout playback.

This mapping currently applies to native stamp-dither strokes; Pickup, Pencil,
Bristles and shape fills retain their own paths. The live drawing preview uses
the same Contrast, Ink Spread and dither-mask mapping as the finished stroke.
All four modes split the complete 256-colour playback gradient, including colours
between source points. Palette and FG Grad freeze their source on pointer-down. Sample and
Unresolve still update as the path grows; their complete source sequence is frozen
when the stroke finishes. Existing
strokes cannot gain this alignment because their original stamp positions were
not retained. Draw a new stroke to use it.

FG Grad, Palette, Sample and Unresolve form one choice group. Choosing Unresolve
selects sampling and enables shared playback for the selected layer; choosing
another option disables Unresolve. Motion, easing and Resolve settings remain
under Effects → Unresolve. The All Unresolve layers group shares motion, easing
and Length across every participating layer, regardless of the selected layer.
Length sets a complete cycle from 1–60 seconds
in 0.5-second steps, including the full out-and-back for Pendulum and Breathe.
Changing Length keeps the current cycle position. It is saved with the project
and exported with playback; Global Speed scales the chosen duration (2× plays
a 12-second cycle in 6 seconds). Older projects retain their original duration.
Switching off cancels an active preview and returns
the layer to ordinary CC playback without erasing strokes or their palettes. Apply commits the preview to the
shared Unresolve clock. Global speed controls this clock; individual layer speeds
do not separate its layers. Native save/load and Goblet2 use the same sequence.
Older morph strokes retain their distance-band indices in the phase channel;
playback uses those indices directly and ignores the discarded source layout.
Their stored palette colours are retained. New strokes use the ordinary indexed
playback format, without source-remapping buffers or captured frames.
Use global Play/Pause to animate or pause strokes and active Unresolve previews.
After Apply, global Play runs the committed strokes.
Saved projects retain the shared playback position. Older Unresolve files,
including the original captured-frame format, join at the resolved position
when no shared clock was saved; their authored palettes and pixels are retained.

## Collaboration profile

Color Cycle Stroke is an available collaboration brush for genuinely linear
structures. Its sampled profile starts with Size 4 at a 512 px canvas short
edge, Spacing 4, 64 Bands, Contrast 100, Hard seam on, Sierra Lite stamp
dither, BG Fill on, pressure and
rotation off, Lostedge 0, dashed off, and Grid Snap off.

Use one consistent Size for all strokes in an artwork. Scale the nominal 4 px
weight proportionally with the canvas short edge; pass changes do not change
stroke Size.

Speed changes with the conceptual pass:

| Pass | Speed range | Stamp-dither Res |
| --- | --- | --- |
| Establish | `0.005–0.010` | 3 |
| Develop | `0.015–0.020` | 2 |
| Deepen | `0.030–0.045` | 1 |

Use `0.055–0.060` only for selective focal accents; never exceed `0.08`.

## Painting with it

- Decide what the motion represents. Direction, speed, palette, and placement
  should all support that answer.
- Use a heavier stroke for structural silhouette and a smaller one for
  internal seams or ornament. Animation does not replace line-weight hierarchy.
- Sample colour when movement belongs to the existing object. Use a manual
  palette when the line is an external force or signal.

## Starting points

- **Living contour:** sampled gradient, slow Speed, close spacing, modest
  pressure variation.
- **Electrical accent:** high-contrast few-band gradient, faster Speed, smaller
  line used sparingly.
- **Moving stitch:** dashed line, controlled L/G metre, slow cycle, repeated
  placement.

If every contour cycles, none of them feels alive. Reserve motion for the paths
where time or energy is part of the meaning.
