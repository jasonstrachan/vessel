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
| Dither / Algorithm / Pattern | Enables a spatial mix and selects its distribution. Sierra Lite also exposes Variety. |
| Res | Fixed dither-cell size. |
| Riso | Adds print texture at the chosen Intensity. |
| Draw Test Swatches | Adds a fixed diagnostic palette to the active normal layer. Undo removes the swatches; they do not use the current gradient or texture settings. |

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
- **Graphic panel:** chosen gradient, few colours, Bayer, low Res.
- **Worn projection:** moderate Lostedge and restrained Riso.

Do not use a smooth gradient to conceal unclear value structure. Confirm the
two endpoint colours work as a simple plane first.
