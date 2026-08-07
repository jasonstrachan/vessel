# Soft

**Preset:** `soft-round`

**Role:** atmosphere, volume, light, and gradual transition

Soft uses an antialiased round tip by default. It is useful when the boundary
should be felt before it is seen: shadow, glow, haze, skin transition, or a
quiet change of colour.

## Controls

| Control | Effect and use |
| --- | --- |
| Square / Round | Chooses the softened tip silhouette. Round is atmospheric; square can make a hazy plane or block. |
| Size | Controls the breadth of the transition. Work larger than the detail scale when describing volume. |
| Opacity | Controls accumulation. Low opacity supports gradual modelling; high opacity makes an airbrushed graphic mark. |
| Spacing / Vel | Controls how smoothly stamps overlap and whether speed alters that overlap. Low spacing is usually best for even atmosphere. |
| Lostedge | Interrupts the soft boundary further, useful for smoke, glare, and forms entering shadow. |
| Sprd / Sample / BG Fill | Adjust palette spread, canvas colour sampling, and whether dither gaps receive the background colour. |
| Dither controls | Adds an algorithmic grain, with Res, pressure-linked Max, Pxl Edge, Smoosh, and Pattern controls. |
| PigLift | Turns the brush into a soft wipe or textured eraser before it deposits paint. |
| Riso | Adds printed grain, chromatic jitter, and optional edge emphasis. |
| Shape | Switches from an open stroke to a closed filled form. Useful for soft-edged masses rather than linear modelling. |
| Pressure / Min / Max | Makes breadth respond to pressure. A wide range can model swelling and taper in one gesture. |
| Rotation | Rotates a non-round tip; has little visible effect on a round tip. |
| Dashed / L / G / V | Breaks softness into pulses, clouds, or repeated halos. |
| Grid Snap / grid size | Quantizes the centres of soft marks for repeated lights or modular haze. |

## Painting with it

- Model the large value relationship before adding surface detail. A broad,
  quiet shadow can make a form read more strongly than many contour lines.
- Sample from the painting to unite transitions; disable sampling to introduce
  a genuinely new temperature of light.
- Combine one soft transition with one selected hard Pixel edge. The contrast
  between them directs attention.

## Starting points

- **Volume:** large size, low opacity, close spacing, canvas sampling on.
- **Glow:** large size, very low opacity, a warmer or lighter colour, several
  controlled passes.
- **Wiped light:** PigLift on, moderate Strength, generous Feather, restrained
  Texture.

Too many evenly soft passages make a painting foggy. Preserve at least a few
hard boundaries where structure or focus demands them.
