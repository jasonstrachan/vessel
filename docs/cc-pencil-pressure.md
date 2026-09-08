# CC Stroke Pencil Pressure

Pencil Pressure is optional and off by default. Sensitivity and Res are saved
per preset. Higher sensitivity produces more coverage with less force. Res
scales the selected dither texture. Pressure changes coverage and modestly varies
width (65–100% of authored size), preserving the selected CC palette.
The pressure curve is slightly lighter: at Sensitivity 50, half pressure requests
about 31% coverage rather than 35%; full pressure still requests 100%.

Pencil uses the current Dither algorithm and pattern, including custom image tiles,
rather than a separate random paper texture. Algorithm, Pattern and Sierra Lite
Variety remain available with Pencil enabled. The Dither toggle is preserved;
Pencil controls deposition while enabled, and switching it off restores ordinary
Dither behaviour. The same Res control scales both modes from 1 to 64 pixels.
Pres Res and BG Fill are hidden during Pencil use: pressure controls coverage,
and unpainted pores always preserve existing paint. The separate Grain setting
has been removed.

The mask is anchored to canvas coordinates. Sierra Lite uses a fixed half-tone
with ranked pores: increasing pressure adds pixels without moving existing pores.
This prevents overlapping light samples from rapidly filling the entire stroke.
Mouse-classified tablet pressure is preserved when Pencil alone is enabled.
Repeating the same texture at the same pressure preserves its pattern; harder
passes add coverage. There is no
independent random reseeding between strokes or simulated pigment accumulation.
Sample, Pickup and Bristles remain available. CC Shapes and custom stamp rendering
are outside this mode's scope. No playback channels or file formats change.

Pencil retains one playback speed for the stroke. Sampled Pencil strokes use the
whole-path phase remap even when the Dither toggle remains enabled. Grain holes
preserve existing paint and animation data.

Verification covers nested Sierra Lite coverage at Variety 0, 50 and 100,
Pencil-only tablet input, saved playback speed with Dither on/off, and continuous
phase mapping across a long stroke with varying drawing speed. Production-preview
checks confirm lighter coverage (about 7%, 31%, and 100% at 20%, 50%, and 100%
pressure) and whole-stroke sampled playback. Pressure was supplied by synthetic
pointer events; physical pen feel remains subject to user verification.
