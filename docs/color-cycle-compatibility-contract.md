# Color Cycle Compatibility Contract (Vessel <-> Goblet)

This contract is the shared source of truth for Color Cycle (CC) brush playback parity between Vessel runtime and Goblet runtime.

## Scope

- Applies to brush-mode CC playback (`mode: "brush"`) in runtime and export.
- Recolor mode has its own runtime path and is out-of-scope here.
- Contract target format: `format: "vessel-goblet2"` with `colorCycle.schemaVersion: 2`.

## Required Payload

For each brush CC layer:

- `brushState.indexBuffer`: per-pixel palette index (`0` means transparent).
- `brushState.gradientIdBuffer`: per-pixel slot id.
- `brushState.gradientDefIdBuffer`: per-pixel gradient definition id when sampled/def-bound gradients are present.
- `brushState.speedBuffer`: per-pixel encoded speed byte.
- `brushState.flowBuffer`: per-pixel flow mode byte.
- `brushState.phaseBuffer`: per-pixel phase byte.
- `speedMin` / `speedMax`: decode range for non-zero speed bytes.
- `slotPalettes`: optional per-slot gradient stops.
- `brushState.gradientStops`: fallback gradient when slot palette is missing.

## Export Source Contract

Goblet export source selection is explicit:

1. Hydrated archive/document state for cold or warm archive-backed layers.
2. Persisted brush state with a same-layer snapshot.
3. Live runtime state only when no persisted export source exists.
4. Recolor runtime for `mode: "recolor"`.

The exporter resolves this into an export-local layer snapshot before packing the payload. It must not clear, compact, rewrite, or save over canonical Vessel CC buffers while exporting.

## Validation Contract

Before packaging an animated brush payload, export validates:

- payload dimensions against paint, slot, speed, flow, phase, and def-id buffers;
- non-empty paint when the layer is marked as content-bearing;
- slot palette coverage, with `brushState.gradientStops` allowed as a warning-level fallback;
- alpha and soft-edge mask dimensions against the brush payload.

Malformed animated CC payloads fail the layer export visibly. Static-preview export remains a separate repair/import path and is not used as a silent fallback for animated CC data.

## Buffer Semantics

- `indexBuffer[i] == 0`: output alpha must be `0` (fully transparent).
- `indexBuffer[i] > 0`: palette index base is `clamp(indexBuffer[i] - 1, 0, paletteSize - 1)`.
- `gradientIdBuffer[i]`: slot row lookup for palette table.
  - Runtime must clamp out-of-range slot ids to the last available slot row.
- `speedBuffer[i]`:
  - `0`: static pixel; use legacy offset path only.
  - `1..255`: animating pixel; decode with `speedMin`/`speedMax`.

## Speed Decode

For `speedByte > 0`:

- `normalized = clamp(round(speedByte) - 1, 0, 254) / 254`
- `speed = speedMin + normalized * (speedMax - speedMin)`

For `speedByte <= 0` or non-finite:

- `speed = 0`

## Frame Offset and Shift

- Animated (`speedByte > 0`):
  - `shift = -fract(timeSeconds * speed) * paletteSize`
- Static (`speedByte == 0`):
  - `shift = -legacyOffset01 * paletteSize`

Then:

- `shiftedIndex = mod(baseIndex + shift, paletteSize)`
- Sample RGBA from palette row `[slot, shiftedIndex]`.

## Palette Table Defaults

- Default `paletteSize`: `256` for Goblet2 brush mode.
- If a slot palette is missing, fallback to `brushState.gradientStops`.
- If no valid gradient stops exist, runtime must fallback to black->white `[0..1]`.

## Alpha Rules

- `indexBuffer[i] == 0` => alpha `0`.
- `indexBuffer[i] > 0` => alpha from sampled palette entry (and any additional alpha sources if enabled by runtime).

## Runtime Defaults

When payload fields are missing/invalid:

- Missing `gradientIdBuffer` => zero-filled buffer.
- Missing `speedBuffer` => zero-filled buffer (all static).
- Missing `speedMin`/`speedMax` => `0`.
- Missing slot palette and fallback gradient => black->white fallback.

## Golden Fixture Parity

Golden fixtures live in `tests/fixtures/cc/` and must include cases covering:

- Alpha zero semantics (`indexBuffer=0`).
- Mixed static + animating pixels (`speedBuffer` zero/non-zero mix).
- Slot clamp behavior for out-of-range `gradientIdBuffer` values.
- Palette fallback behavior.

Parity tests must render the same frames in Vessel reference path and Goblet path and enforce channel/alpha delta thresholds.
