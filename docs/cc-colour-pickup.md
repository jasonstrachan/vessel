# CC Colour pickup

The Pickup toggle is off by default and is stored per brush preset for CC Stroke
and CC Shape (including the gradient shape presets).

Pickup captures the visible, masked paint from the active CC layer when a mark
starts. Pickup itself never reads the composite, the reference layer, or its own
preview. The selected manual/FG/sample source supplies the original brush load.
Sample continues sampling its normal composite/reference source, then pickup
blends active-layer paint into that sampled load. A new mark starts a fresh load.

Strokes sample across the tip along the gesture. Crossing paint adds its visible
RGB colour to the load; travelling onward gradually dilutes it back toward the
original palette. Transparent pixels add no paint. Distance, rather than pointer
event count or elapsed time, controls uptake and dilution. This is colour
blending, not a subtractive pigment simulation.

Shapes average the existing paint across successive slices of their interior.
Linear fills carry colour along their fill axis; concentric fills carry it from
the boundary inward. This is a directional fill treatment, not independent
bristle tracks. Sampling is bounded for large or complex polygons.

The resulting colours are stored in the new mark's ordinary immutable CC
palette. They cycle with that mark after painting; pickup does not retain a live
link to the source paint. Existing gradient/index data handles save/load, undo,
playback and Goblet export. No new playback channels or file format are added.
Temporary source pixels belong only to the active mark/queued preview and are
not persisted. Shape preview requests retain their mark's snapshot identity.

Implementation owners: `BrushControls.tsx`, `types/index.ts`, `toolsSlice.ts`,
`utils/colorCycle/ccColourPickup.ts`, `colorCycleMarkSession.ts`,
`colorCycleGradientSourceContract.ts`, `ensureActiveColorCycleGradientSlot.ts`,
`ccGradientSamplingController.ts`, `ccSampling.ts`, `strokeSamplingStart.ts`,
`strokeBatching.ts`, `shapeDrawing.ts`, `ShapeToolHandlerRuntime.ts`, and
`ccShapePreviewDitherRuntime.ts`, plus their focused tests. Existing unrelated
stroke preview/sampling work is preserved.

Verification covers toggle/source persistence, same-layer sampling, transparent
areas, directional carry/recovery, event subdivision, and preview/finalization.
The live acceptance case is a blue stroke and shape crossing a red mark, with a
separate empty active layer proving that visible paint underneath is ignored.
Bristles, wetness, pressure deposition and cross-layer pickup are out of scope.

Review verification (2026-09-07): preserve embedded CSS alpha multiplied by stop
opacity, interpolate unobserved shape slices without replacing measured
transparent slices, and keep sampled motion gated by the selected runtime
palette. The new regressions failed before the fixes. All 188 focused tests,
type-check, lint and the isolated production build pass. Real pointer input on
the production preview confirms both linear and concentric small shapes keep
20% opacity and introduce no artificial colour dips over solid paint. Loading
the saved pickup verification project through the file chooser also succeeds.
