# CC Stroke bristles

The Bristles width slider is off at 0, with widths from 0.5 to 8 canvas pixels
in 0.5 px steps. Enabled presets without a saved width use 1 px. Width and
enabled state are saved with each CC Stroke preset.
Stable strands across the brush carry slightly offset parts of its palette.
Each strand uses the selected width: increasing brush size or pressure-driven
size adds more strands rather than widening them. Their direction follows the
gesture. Stationary pen events retain the last direction.
Strands continue straight through stroke caps; the selected tip still controls
the outer silhouette. Distance to the stroke segment only resolves stamp overlap.
The phase buffer samples this subpixel pattern once per canvas pixel; individual
half-pixel strands are not separately resolved.
Ordinary strokes keep each strand's base colour stable between stamps; sampled
strokes retain the final sampled path progression, including colour pickup.

The existing per-pixel phase buffer stores the strand offsets. Undo, project
persistence and CC/Goblet playback consume that native data; there is no new
renderer channel or project format. The normal stamp mask controls coverage.
This affects CC Stroke, including its dither option. It does not add texture to
CC Shape fills or simulate separate pigment pickup for individual bristles.

Original toggle implementation verified with real pointer strokes in the isolated production preview: straight
and curved strand continuity, Dither + Pickup, exact undo/redo pixels, and native
save/load. The saved archive contains nonzero strand phase data. The focused
suite passes 205 tests; type-check, lint and production build pass. A temporary
copy of the normal preview build helper excluded changing Studio outputs to
avoid an unrelated generated-file copy race; no repository build config changed.

Width slider verification: native pointer strokes at 0.5, 1 and 4 px, plus Off,
passed in the production Studio on port 3010. All tested new strokes retained
nonzero speed bytes and changed rendered pixels during playback. Focused UI,
preset persistence and bristle tests passed (136 tests).
