# Color Cycle Gradient

**Preset:** `color-cycle-gradient`

**Role:** animated colour with explicit spatial direction

**Layer requirement:** Color Cycle layer. This brush cannot draw on a normal layer.

Color Cycle Gradient combines a drawn region with a second gesture that defines
how colour is laid through it. It is suited to directional light, flow,
transformation, depth, and forms whose animation needs a spatial axis.

## Controls

| Control | Effect and use |
| --- | --- |
| CC stamp buttons | Gradient is the active system; the other buttons switch to stroke, checker, triangle, or shape behaviours. |
| Size | Width of the region-defining gesture. |
| Spacing / Vel | Boundary sampling interval and optional velocity response. |
| Speed / Vel | Animation rate and optional link to drawing velocity. |
| Drawing shape | Free, Rect, Oval, Line, Click Line, Tri, or Poly. Selects how the bounded geometry is constructed. |
| FG Grad / Man Grad / Sample | Uses foreground-derived, authored, or sampled colours. |
| Foreground controls | Bands, Light, Hue, Sat, Opacity, and Stops define the generated palette. |
| Manual gradient controls | Edit stop colour, position, opacity, and saved gradient choices. |
| Sample controls / Soft seam | Capture canvas colours and choose a continuous or pulsing loop join. |
| Grad / Stroke / Concentric | Chooses linear, gesture-following, or radial colour placement. |
| Contrast | Increases separation across the gradient. |
| Dither / Algorithm / Pattern | Enables and selects the texture distributing colours. |
| Res / Pres Res / Max | Base dither-cell size, pressure response, and largest linked cell. |
| Pxl Edge | Keeps the cell boundary hard. |
| Variety | Introduces controlled variation within the gradient field. |
| Ink Spread | Expands colour distribution through the region. |
| BG Fill | Makes dither gaps opaque with background colour or porous to existing paint. |
| Pressure / Min / Max | Varies boundary gesture size. |
| Rotation | Turns asymmetric drawing components. |
| Lostedge | Erodes parts of the region boundary. |
| Grid Snap / grid size | Aligns geometric gradients to a repeated module. |
| Rounded corners / radius | When supported with snapped geometry, rounds corners and controls their radius. |

The preset begins around Size 20, Spacing 4, 64 bands, linear fill, free drawing
shape, Bayer dithering, Res 6, and Pxl Edge on.

## Painting with it

- Treat the gradient direction as part of the drawing. Align it with light,
  gravity, circulation, or a deliberate contradiction.
- Use geometric drawing shapes for constructed space and Free for bodily or
  gestural masses.
- Many bands produce smooth travel; fewer bands expose time as distinct steps.
  Choose based on the work's temporal character.

## Starting points

- **Directional light:** linear Grad, long axis across the form, sampled or
  closely related colours, moderate Speed.
- **Radiating body:** Concentric fill, clear centre, slow outer transition.
- **Graphic flow field:** few bands, Bayer dither, Pxl Edge on, Grid Snap where
  architecture matters.

Avoid adding gradient direction after the fact without checking the whole
composition. A strong axis redirects the viewer's eye.
