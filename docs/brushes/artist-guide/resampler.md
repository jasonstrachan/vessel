# Resampler

**Preset:** `resampler`

**Role:** clone, smear, echo, and feedback from the existing painting

Resampler paints with material sampled from the canvas. It can extend an edge,
move colour, repeat a fragment, smear time, or make the painting consume and
rewrite itself.

## Controls

| Control | Effect and use |
| --- | --- |
| Continuous sampling | Repeatedly updates the sampled source while painting. Off behaves more like a stable clone; on can recursively ingest the changing canvas. |
| Interval | Sampling interval from 1–10 during continuous mode. Lower values update more often and feel fluid or unstable; higher values retain a sample longer. |
| Size | Footprint of the sampled material. |
| Opacity | Strength of the transferred image. Low opacity blends and ghosts; high opacity relocates it decisively. |
| Spacing / Vel | Interval between sampled stamps and optional speed response. |
| Riso | Adds print Intensity, Hue Jitter, and optional edge emphasis to the transferred material. |
| Shape | Closes the gesture and applies resampled material as a bounded form where supported. |
| Pressure / Min / Max | Varies the sampled footprint with pressure. |
| Rotation | Turns sampled stamps along the gesture, making the source visibly repeat or spiral. |
| Dashed / L / G / V | Breaks the sampled trail into repeated units and speed-responsive gaps. |
| Grid Snap / grid size | Quantizes placement for tiles, echoes, and constructed repetition. |

Resampler does not normally expose the standard Dither block. Its defaults are
approximately Size 20, Opacity 1, Spacing 1, continuous sampling off, and
Interval 5.

## Painting with it

- Choose whether the source should remain recognizable. Stable sampling, high
  opacity, and separated stamps reveal quotation; continuous sampling and close
  spacing transform it into smear or feedback.
- Use it to move relationships already in the painting before introducing new
  colours. This can preserve palette unity while changing structure.
- Sample from a meaningful region. Repetition can turn a face, edge, texture,
  or error into the work's memory.

## Starting points

- **Soft extension:** continuous off, low opacity, close spacing, modest Size.
- **Feedback current:** continuous on, low Interval, close spacing, directionally
  controlled stroke.
- **Quoted fragment:** continuous off, high opacity, separated spacing, Grid
  Snap or dashes.

Continuous sampling can rapidly erase cause and effect. Make a short stroke,
inspect the result, and continue only if the feedback supports the composition.
