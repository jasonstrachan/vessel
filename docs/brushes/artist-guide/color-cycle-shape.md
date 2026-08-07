# Color Cycle Shape

**Preset:** `color-cycle-shape`

**Role:** bounded animated colour field

**Layer requirement:** Color Cycle layer. This brush cannot draw on a normal layer.

Color Cycle Shape turns a closed gesture into a region of indexed animated
colour. Unlike a moving outline, it makes time part of the form's interior:
useful for bodies, shadows, portals, weather, screens, pools, or charged
objects.

## Controls

| Control | Effect and use |
| --- | --- |
| CC stamp buttons | Shape is the active system; Square, Checkered, Round, Diamond variants, Triangle, and Gradient can switch to other CC behaviours. |
| Size | Width of the gesture used to define the shape. |
| Spacing / Vel | Sampling interval around the boundary and optional speed response. |
| Speed / Vel | Colour-cycle rate and optional link to drawing velocity. |
| FG Grad / Man Grad / Sample | Sources the animated palette from foreground colour, authored stops, or the canvas. |
| Foreground controls | Bands, Light, Hue, Sat, Opacity, and Stops define a related animated family. |
| Manual gradient controls | Edit stop colour, position, opacity, and saved gradients. |
| Sample controls / Soft seam | Capture canvas colour, reset the capture, and blend or expose the loop join. |
| Grad / Stroke / Concentric | Makes colour travel linearly, follow the gesture, or radiate through the form. |
| Contrast | Separation across the animated gradient. |
| Dither / Algorithm / Pattern | Adds a spatial pixel distribution to the fill and selects its character. |
| Res / Pres Res / Max | Base dither-cell size, pressure link, and largest linked cell. |
| Pxl Edge | Keeps the dither boundary graphically hard. |
| Variety | Adds internal variation across the filled region. |
| Ink Spread | Expands colour distribution inside the shape. |
| BG Fill | Uses background colour in dither gaps or lets existing paint show through. |
| Pressure / Min / Max | Varies the size of the boundary gesture. |
| Rotation | Turns asymmetric components of the gesture. |
| Lostedge | Breaks sections of the completed boundary. |

The preset begins around Size 20, Spacing 4, and 26 colour bands. Shape mode is
intrinsic, so ordinary dashed-line construction is not its main workflow.

## Painting with it

- Choose the fill mode from the form's spatial idea. Concentric suits a source
  or body; Stroke can preserve the drawing gesture; Grad describes direction.
- Use Speed to establish hierarchy between animated forms. A slow large field
  can support one fast small signal.
- Sample existing colour for continuity, then adjust Contrast to make motion
  readable without detaching the form from the painting.

## Starting points

- **Living shadow:** Sample, slow Speed, low Contrast, BG Fill off.
- **Portal or source:** Concentric, authored gradient, stronger Contrast, few
  clear bands.
- **Animated cloth:** Stroke fill, Pattern or Bayer dither, moderate Variety.

Do not make the internal animation more complicated than the silhouette. The
viewer needs to recognize the form before interpreting its motion.
