# Dither Stroke

**Preset:** `dither-stroke`

**Role:** pressure-shaped textured line

Dither Stroke turns a gesture into a line whose density and cell size can
change with pressure. It is especially useful when a contour should carry both
drawing energy and material texture.

## Controls

| Control | Effect and use |
| --- | --- |
| Dither tip | Square, Round, Diamond, Diamond 5/7/9, or Triangle. The silhouette determines whether the line feels mechanical, soft, faceted, or pointed. |
| Size | Overall stroke width. |
| Opacity | Strength of the dithered material. Lower values allow patterns to accumulate without becoming a solid band. |
| Spacing / Vel | Stamp interval and optional speed response. Close spacing makes a continuous textured line; open spacing reveals the tip. |
| Algorithm / Pattern | Distribution rule for pixels. See [Algorithm character](README.md#algorithm-character). |
| Res | Base dither cell size. Higher is coarser. |
| Pres Res / Max | Makes cell size pressure-responsive and sets its largest value. This pair is central to the brush's expressive range. |
| Pxl Edge | Preserves explicit hard cell boundaries. |
| Smoosh | Smooths pressure-linked cell-size transitions along the stroke. |
| Sprd | Expands the palette-index distance between dither colours. |
| Sample | Picks colour from the canvas while drawing, tying the textured line to material already present. |
| BG Fill | Fills gaps with background colour. Disable it to let the existing painting remain inside the stroke. |
| Lostedge | Breaks the line boundary and helps it merge with surrounding paint. |
| PigLift | Adds subtractive Strength, Feather, and Texture before deposition. |
| Riso | Adds print intensity, hue jitter, and optional edge emphasis. |
| Pressure / Min / Max | Separately changes overall stroke size with pressure. Do not confuse this with Pres Res, which changes dither cell size. |
| Rotation | Turns asymmetric tips with the stroke. |
| Dashed / L / G / V | Breaks the textured line into measured units. |
| Grid Snap / grid size | Aligns the gesture to a repeatable spatial module. |

The preset begins with Sierra Lite, a round dither tip, BG Fill on, pressure-
linked resolution on, and a base/maximum dither size around 28.

## Painting with it

- Use overall Pressure for line weight and Pres Res for material density. They
  can reinforce each other or deliberately oppose one another.
- A clean silhouette with changing internal density often reads more clearly
  than simultaneous heavy Lostedge, Riso, jitter, and dashing.
- Use a pointed or diamond tip when direction matters; use Round when pressure
  and density should carry the expression.

## Starting points

- **Printed contour:** Bayer or Sierra Lite, modest Res, Pxl Edge on, little
  Lostedge.
- **Breathing line:** Pres Res on, broad Max range, Smoosh on, BG Fill off.
- **Worn notation:** dashes on, restrained Lostedge and PigLift, limited Riso.

Give the brush one primary source of variation. If pressure changes width,
density, spacing, and colour violently at once, the gesture becomes difficult
to read.
