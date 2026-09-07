# CC Stroke Pencil Pressure

Pencil Pressure is optional and off by default. Sensitivity and Res are saved
per preset. Higher sensitivity produces more coverage with less force. Res
scales the selected dither texture. Pressure changes coverage and modestly varies
width (65–100% of authored size), preserving the selected CC palette.

Pencil uses the current Dither algorithm and pattern, including custom image tiles,
rather than a separate random paper texture. Algorithm, Pattern and Sierra Lite
Variety remain available with Pencil enabled. The Dither toggle is preserved;
Pencil controls deposition while enabled, and switching it off restores ordinary
Dither behaviour. The same Res control scales both modes from 1 to 64 pixels.
Pres Res and BG Fill are hidden during Pencil use: pressure controls coverage,
and unpainted pores always preserve existing paint. The separate Grain setting
has been removed.

The mask is anchored to canvas coordinates. Repeating the same ordered texture at
the same pressure preserves its pattern; harder passes add coverage. There is no
independent random reseeding between strokes or simulated pigment accumulation.
Sample, Pickup and Bristles remain available. CC Shapes and custom stamp rendering
are outside this mode's scope. No playback channels or file formats change.

Verification: 208 focused tests, type-check, lint and production preview build
pass. In the live preview, changing the shared Res slider from 1 to 4 produced
four-times-wider pattern cells (191 versus 47 transitions over the same region),
with equal coverage. Grain was absent and Res stayed at 4 after disabling Pencil.
Pressure was supplied by synthetic pen events; physical pen feel is unverified.
