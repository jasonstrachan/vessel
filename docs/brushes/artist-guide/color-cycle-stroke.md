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
| Bands | Number of indexed colour bands in the cycle. Few bands pulse; many bands travel smoothly. |
| FG Grad | Builds related stops from the foreground colour. |
| Light / Hue / Sat / Opacity / Stops | Defines variation across a foreground-derived gradient. |
| Man Grad | Uses editable authored stops, positions, and opacity. |
| Sample / Hard seam | Derives colours from the canvas and chooses whether the loop join pulses or blends. |
| Contrast | Increases separation across the sampled or derived gradient. |
| Ink Spd | Separates the two stamp-dither inks along the gradient: 0 uses neighbouring colours, 100 uses colours half a cycle apart. Applies to new strokes with BG Fill on; Contrast stays independent. |
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

FG Grad and Man Grad continue their colour progression across consecutive
strokes, with or without Stamp Dither. Sample maps its gradient from beginning
to end along each completed stroke. Starting a stroke does not restart playback.

Sample captures the complete path in order, at approximately one canvas pixel
per sample up to 256 samples, then freezes that stroke's gradient on release.
Longer paths distribute those samples across their full length. This samples
the centreline, not every pixel across the brush width.
Sampled Stamp Dither uses neighbouring colours along that path for its two inks;
it does not jump to a distant part of the sampled gradient.

In Studio, Effects → Unresolve keeps those gradients, path indices, and bristle
phase offsets intact.
Sample strokes: On selects the sampled source with neutral sampled contrast and a
hard seam, pauses playback, and resets the layer clock so new strokes align with
the sampled image on release. The button shows On/Off; turning it off selects
Palette again. The shared cycle moves each stroke's own colours along its path;
Resolve returns every Unresolve layer to its original alignment together.
Apply joins the selected CC layer to the shared Unresolve clock at its current
position. Global playback speed controls this clock; individual layer speed
multipliers do not separate Unresolve layers. Ordinary CC layers retain their
own playback. This synchronisation also applies in Goblet exports. There is no separate
unresolved palette or frame capture. Existing strokes retain their captured
sampling detail; denser sampling applies to new strokes.
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
