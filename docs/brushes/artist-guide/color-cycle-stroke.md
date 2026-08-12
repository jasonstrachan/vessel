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
