# Dither Grad

**Preset:** `dither-grad`

**Role:** directional pixel transition

Dither Grad makes a gradient whose tonal change is expressed through dither
cells. It is useful for light crossing a plane, a dissolving edge, projected
colour, graphic depth, or a transition that should remain visibly digital.

## Controls

| Control | Effect and use |
| --- | --- |
| Colors | Chooses 2–6 gradient stops. Fewer stops make a clear value statement; more create a longer chromatic progression. |
| Colour inputs | Sets each stop explicitly when not sampling from the canvas. |
| Algorithm / Pattern | Chooses the dither distribution; Pattern adds authored repeat controls. |
| Res | Base cell size. Higher means coarser pixels. |
| Pres Res / Max | Links cell size to pressure and defines its largest value. |
| Pxl Edge | Preserves hard pixel boundaries. |
| Lostedge | Breaks the transition boundary. |
| Length | Extends or compresses the gradient transition from 20% to 200%. Short is abrupt; long is atmospheric. |
| Sample | Builds the gradient from colours under the gesture instead of only the chosen stops. |
| Trans | Makes up to the trailing stop count transparent. This produces a true dissolve into existing paint. |
| BG Fill | Fills dither gaps with background colour. Disable it for a porous transition. |
| Opacity | Strength of the whole gradient. |
| Grid Snap / grid size | Aligns the gradient geometry to a repeatable module. |

Dithering is intrinsic to this preset. It begins with Bayer, two colours,
approximately Res 6, BG Fill on, and sampling off.

## Painting with it

- Orient the gradient along the actual direction of light, depth, or movement.
  A technically attractive ramp in the wrong direction weakens the form.
- Use Trans when the work needs disappearance rather than a blend to another
  opaque colour.
- Repeat one cell size across related planes. Change Res only when material or
  spatial distance genuinely changes.

## Starting points

- **Hard digital light:** two colours, Bayer, Pxl Edge on, shorter Length.
- **Atmospheric dissolve:** three related colours, long Length, Trans 1–2, BG
  Fill off.
- **Sampled depth:** Sample on, restrained Res, long directional gesture.

Too many stops can disguise the main value relationship. Begin with two, then
add a stop only when it names a necessary intermediate colour.
