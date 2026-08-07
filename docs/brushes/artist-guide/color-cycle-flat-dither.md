# Color Cycle Flat Dither

**Preset:** `color-cycle-flat-dither`

**Role:** stable dither material with colour moving through it

**Layer requirement:** Color Cycle layer. This brush cannot draw on a normal layer.

Color Cycle Flat Dither differs from an ordinary animated gradient: the dither
texture stays at a constant 50/50 structure while a pair of neighbouring inks
slides through the cycle. The surface remains materially stable even though
its colour changes.

## Controls

| Control | Effect and use |
| --- | --- |
| CC stamp buttons | Flat Dither is reached through the gradient/CC system; other buttons can switch the underlying brush behaviour. |
| Size | Width of the region-defining gesture. |
| Spacing / Vel | Boundary sampling interval and optional speed response. |
| Speed / Vel | Rate of the ink-pair movement and optional velocity linkage. |
| Drawing shape | Free, Rect, Oval, Line, Click Line, Tri, or Poly construction. |
| FG Grad / Man Grad / Sample | Creates the cycling colour sequence from foreground colour, authored stops, or sampled canvas colour. |
| Foreground controls | Bands, Light, Hue, Sat, Opacity, and Stops define the generated colour family. |
| Manual gradient controls | Edit stop colours, positions, opacity, and saved gradients. |
| Sample controls / Soft seam | Capture canvas colour and blend or expose the cycle seam. |
| Grad / Stroke / Concentric | Chooses how colour order is mapped spatially through the form. |
| Contrast | Separates the colours travelling through the texture. |
| Algorithm / Pattern | Selects the forced dither structure. Pattern adds repeat, scale, inversion, threshold, and offset controls. |
| Res / Pres Res / Max | Sets the texture cell size and optional pressure-linked maximum. |
| Pxl Edge | Preserves hard cells. |
| Variety | Adds controlled internal variation. |
| Ink Spread | Expands colour distribution through the form. |
| Flat Cycle Banding | From 0–32. At 0 the neighbouring ink pair slides smoothly; higher values snap its centre into visible temporal steps. |
| BG Fill | Fills dither gaps with background colour or reveals existing paint. |
| Pressure / Min / Max | Varies the boundary gesture size. |
| Rotation | Turns asymmetric construction elements. |
| Lostedge | Erodes parts of the region boundary. |
| Grid Snap / grid size | Quantizes geometric placement. |
| Rounded corners / radius | Rounds supported snapped geometry and sets the radius. |

The preset begins with forced Bayer dither, approximately Res 6, Pxl Edge on,
palette spread around 35, and Flat Cycle Banding at 0.

## Painting with it

- Use it when the surface should retain an identity—cloth, skin, screen,
  mineral, static—while colour carries time.
- Set cell scale from the viewing distance. Coarse cells make the mechanism
  explicit; fine cells optically mix into a field.
- Increase Flat Cycle Banding only when stepped time supports the idea. Zero
  produces the smoothest sliding pair.

## Starting points

- **Living fabric:** sampled palette, Pattern or Bayer, slow Speed, Banding 0.
- **Electronic panel:** high Contrast, hard Pxl Edge, geometric shape, visible
  banding.
- **Chromatic weather:** BG Fill off, larger Res, moderate Lostedge, slow smooth
  cycle.

The brush is already complex. Keep its geometry and palette disciplined so the
stable texture remains legible beneath the motion.
