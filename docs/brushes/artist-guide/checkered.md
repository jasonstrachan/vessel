# Checkered

**Preset:** `checkered`

**Role:** animated woven, tiled, or alternating texture

**Layer requirement:** Color Cycle layer. This brush cannot draw on a normal layer.

Checkered is a Color Cycle stamp brush with an alternating square structure.
It can read as textile, screen, signal, game board, architecture, or an
unstable surface depending on scale and animation speed.

## Controls

| Control | Effect and use |
| --- | --- |
| CC stamp buttons | Switch among Square, Checkered, Round, Diamond variants, Triangle, Shape, and Gradient systems. Staying on Checkered preserves its alternating identity. |
| Size | Overall checkered stamp footprint. |
| Spacing / Vel | Interval between stamps and optional speed response. Align spacing with Size for a continuous weave; separate it for explicit tiles. |
| Speed / Vel | Colour-cycle rate and optional link to drawing speed. |
| Bands | Number of indexed colours travelling through the stamp. Few bands make a bold pulse; more make a longer chromatic sequence. |
| FG Grad / Man Grad / Sample | Builds the animated palette from foreground colour, authored stops, or sampled canvas colour. |
| Foreground gradient controls | Bands, Light, Hue, Sat, Opacity, and Stops define a related colour family. |
| Manual gradient controls | Edit stop colours, positions, opacity, and saved gradient choices. |
| Sample controls / Soft seam | Capture canvas colours, reset the sample, and choose a smooth or explicit loop join. |
| Stamp Dither | Dithers the checkered stamp material itself. |
| Algorithm / Pattern | Chooses the stamp dither distribution. |
| Res / Pres Res / Max | Sets stamp cell size and optional pressure-linked coarsening. |
| BG Fill | Fills pattern gaps with the background colour. |
| Pressure / Min / Max | Changes the overall stamp size with pressure. |
| Rotation | Turns the checker structure with the stroke. |
| Lostedge | Breaks parts of the repeated boundary. |
| Dashed / L / G / V | Groups the texture into rhythmic runs and gaps. |

The preset begins near Size 8 and Spacing 8, with a relatively slow 10 FPS
cycle, 12 bands, stamp dithering on, Res 1, and BG Fill on.

## Painting with it

- Use a large checker scale when the grid is the subject; use a small scale when
  it should read as cloth or optical mixture.
- Sample the painting's palette when the animated region should feel embedded.
  Use a manual contrasting gradient when it should behave as a signal or alarm.
- Keep one axis or rotation dominant across a region. Changing orientation can
  then mark folds, planes, or competing forces.

## Starting points

- **Woven cloth:** Size and Spacing matched, slow Speed, sampled gradient,
  restrained pressure.
- **Digital signal:** smaller spacing, high-contrast manual gradient, faster
  Speed, hard BG Fill.
- **Broken grid:** moderate Lostedge, some rotation, separated stamps.

Checkered is visually assertive. Use it to identify a meaningful region rather
than applying equal animation and grid density everywhere.
