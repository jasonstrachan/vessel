# Rectangle Gradient

**Preset:** `rectangle-gradient`

**Role:** directional tonal or chromatic plane

Rectangle Gradient builds a rectangular gradient from sampled canvas colour or
a chosen gradient source. It is useful for light planes, walls, screens,
atmosphere, shadows, and compositional fields whose direction matters.

## Controls

| Control | Effect and use |
| --- | --- |
| Gradient source | None samples the canvas; the other entries use a chosen preset gradient. Sampling integrates the plane, while a preset introduces a designed colour sequence. |
| Colors | Number of bands or colours, from 2–64. Few make a graphic division; many make a smoother transition. |
| Lostedge | Erodes parts of the rectangle boundary so the field can merge with surrounding paint. |
| Dither / Algorithm / Pattern | Enables a spatial mix and selects its distribution. |
| Res / Pres Res / Max | Base dither-cell size, optional pressure response, and largest linked cell. |
| Pxl Edge | Preserves hard dither boundaries. |
| PigLift | Subtracts underlying material with Strength, Feather, and Texture before applying the field. |
| Riso | Adds print Intensity, Hue Jitter, and optional edge emphasis. |
| Draw Test Swatches | Renders diagnostic swatches for judging the active gradient and texture. Use for setup, then remove or undo them before treating the composition as final. |

The preferred preset configuration enables dithering around Res 3.

## Painting with it

- Place the rectangle for compositional weight before tuning its texture. A
  plane changes balance even at low opacity.
- Align the gradient with light or depth, or oppose those directions
  intentionally to produce unease.
- Sample when glazing or extending an existing atmosphere. Choose a preset
  gradient when the plane represents another system, space, or source.

## Starting points

- **Architectural light:** sampled source, many colours, low Res, clean edges.
- **Graphic panel:** chosen gradient, few colours, Bayer, Pxl Edge on.
- **Worn projection:** moderate Lostedge, restrained Riso, PigLift with soft
  Feather.

Do not use a smooth gradient to conceal unclear value structure. Confirm the
two endpoint colours work as a simple plane first.
