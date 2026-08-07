# Mosaic

**Preset:** `mosaic`

**Role:** block structure, palette rhythm, and tiled material

Mosaic converts a stroke into repeated colour blocks. It can simplify an image
into large chromatic decisions or build a surface that feels tiled, woven,
sampled, or computational.

## Controls

| Control | Effect and use |
| --- | --- |
| Size | Overall stamp footprint. Large size states masses; small size becomes texture. |
| Spacing / Vel | Distance between mosaic stamps and optional speed response. Match spacing to the footprint for a stable rhythm, or separate stamps deliberately. |
| Opacity | Strength of each stamped block system. Lower values let successive palettes intermix. |
| Pixel | Disables or enables antialiasing at tile boundaries. Pixel-on is crisp and explicit; softened edges integrate more gently. |
| Gradient editor | Defines the colour sequence available to the mosaic. A narrow family creates unity; a wide gradient creates internal events. |
| Tile | Size of individual tiles within the stamp. Larger tiles simplify; smaller tiles increase information density. |
| Blocks | Number of block divisions. Controls internal subdivision and rhythm. |
| Palette | Number of colours extracted or used. Fewer colours create graphic cohesion; more describe subtle local variation. |
| Segment | Travel distance over which a palette segment persists. Long segments stabilize colour regions; short segments change frequently. |
| Seg Jit | Randomness in segment length. Adds irregular cadence while preserving the underlying segment logic. |
| Dither | Mixes colours spatially within the mosaic. Use when tiles should optically blend rather than remain isolated. |
| Seed / Rand | Repeats a known arrangement or generates another. Keep the seed when a pattern is part of the composition, not an accident to reroll. |
| Pressure / Min / Max | Varies the mosaic footprint with pressure. |
| Rotation | Turns the block system with the stroke, making direction part of the surface. |

Default construction is approximately Size 60, Tile 8, Blocks 6, Palette 8,
Segment 160, with no segment jitter or dithering.

## Painting with it

- Decide whether the viewer should first see the represented form or the mosaic
  material. Tile and Size determine that distance.
- Limit the palette before increasing block complexity. Colour structure
  usually carries more meaning than random subdivision.
- Repeat one tile scale across separated regions to make them belong to the
  same world.

## Starting points

- **Graphic mass:** large Size and Tile, few palette colours, no jitter.
- **Woven surface:** moderate Size, close spacing, small Tile, a restrained
  gradient, some rotation.
- **Broken memory:** longer strokes, shorter Segment, modest Seg Jit, reduced
  opacity.

Randomizing until something looks busy is not composition. Save a seed when
the arrangement begins to support the subject, then edit around it.
