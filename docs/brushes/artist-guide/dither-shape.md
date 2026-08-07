# Dither Shape

**Preset:** `dither-shape`

**Role:** bounded tonal mass made from texture

Dither Shape closes a drawn boundary and fills it with a dithered field. It is
for treating a silhouette and its internal material as one decision: shadow,
fabric, cloud, skin, architecture, or a graphic colour mass.

## Controls

| Control | Effect and use |
| --- | --- |
| Dither tip | Square, Round, Diamond, Diamond 5/7/9, or Triangle used while defining the form. |
| Size | Width of the boundary-making gesture. |
| Opacity | Strength of the completed fill. |
| Spacing / Vel | Sampling interval while drawing the boundary and optional speed response. |
| Algorithm / Pattern | Pixel distribution rule; Pattern adds tile, scale, threshold, inversion, and offset choices. |
| Res | Base dither cell size. Higher values make coarser cells. |
| Pres Res / Max | Links cell size to pressure and defines the coarse extreme. Max is the effective upper control while linked. |
| Pxl Edge | Keeps cells and the filled edge graphically hard. |
| Sprd | Increases palette separation inside the dither. |
| Variety | Broadens internal colour or density variation. Use it to avoid deadness without dissolving the main value. |
| Sample | Picks colour from the canvas while defining the form, integrating its texture with the local palette. |
| BG Fill | Uses background colour in the dither gaps. Off allows the underlying painting to participate in the fill. |
| Lostedge | Erodes sections of the boundary so the mass can merge with its surroundings. |
| PigLift | Subtracts underlying paint with Strength, Feather, and Texture. |
| Riso | Adds print texture, hue jitter, and optional edge emphasis. |
| Pressure / Min / Max | Changes boundary gesture size with pressure. |
| Rotation | Turns asymmetric boundary tips. |
| Grid Snap / grid size | Quantizes form vertices or sampled positions to a shared module. |

Shape mode is intrinsic to this preset, so the ordinary Shape toggle and dashed
stroke controls are not presented as its main workflow. The preset starts with
Sierra Lite, BG Fill on, pressure-linked resolution on, and no Pxl Edge.

## Painting with it

- Judge the silhouette in flat colour first. Texture cannot rescue a shape
  whose proportion or placement is wrong.
- Assign one dominant value to the form, then use Variety or palette spread as
  secondary information.
- Let BG Fill off connect the new form to existing imagery; turn it on when the
  form must read as an opaque object.

## Starting points

- **Graphic shadow:** Bayer, low Variety, BG Fill on, little Lostedge.
- **Atmospheric mass:** Blue noise or Void & cluster, BG Fill off, soft edge
  treatment, moderate Lostedge.
- **Printed fabric:** Pattern algorithm, authored tile, Pxl Edge on, restrained
  Riso.

Avoid filling every object with a different algorithm. A repeated dither
language helps separate meaningful form changes from decorative variation.
