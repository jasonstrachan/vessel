# CC Stroke bristles

The Bristles toggle is off by default and saved with each CC Stroke preset.
Twenty-four stable positions across the brush carry slightly offset parts of
its palette. Their direction follows the gesture and their width scales with
pressure-driven brush size. Stationary pen events retain the last direction.
Ordinary strokes keep each strand's base colour stable between stamps; sampled
strokes retain the final sampled path progression, including colour pickup.

The existing per-pixel phase buffer stores the strand offsets. Undo, project
persistence and CC/Goblet playback consume that native data; there is no new
renderer channel or project format. The normal stamp mask controls coverage.
This affects CC Stroke, including its dither option. It does not add texture to
CC Shape fills or simulate separate pigment pickup for individual bristles.

Verified with real pointer strokes in the isolated production preview: straight
and curved strand continuity, Dither + Pickup, exact undo/redo pixels, and native
save/load. The saved archive contains nonzero strand phase data. The focused
suite passes 205 tests; type-check, lint and production build pass. A temporary
copy of the normal preview build helper excluded changing Studio outputs to
avoid an unrelated generated-file copy race; no repository build config changed.
