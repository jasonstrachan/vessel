# Goblet CC Layer 1/2 Visibility Plan - 2026-06-17

## Problem

The `5.2.vs` archive exports to Goblet with CC Layer 1 and CC Layer 2 present in the exported metadata, but they are visually hard to distinguish or appear missing in Goblet. The hidden raster layers are intentionally hidden and are not part of this issue.

## Evidence

- The source archive contains seven layers. The visible layers are Layer 7 and CC Layer 1 through CC Layer 4.
- CC Layer 1 and CC Layer 2 both have non-empty canonical color-cycle buffers in the archive.
- A fresh Vessel export included five Goblet layers: Layer 7 and all four CC layers.
- The user-supplied Goblet HTML also includes all five layers, with four dynamic color-cycle players.
- Goblet runtime inspection showed CC Layer 1 and CC Layer 2 are loaded, have brush-state buffers, and are placed on the document canvas.
- CC Layer 1 painted bounds: x 87-1694, y 695-2087.
- CC Layer 2 painted bounds: x 386-1940, y 1241-2559.
- Removing CC Layer 1 and CC Layer 2 from the Goblet runtime changes only a small number of final pixels, so the issue is runtime rendering/compositing fidelity, not missing data or off-canvas placement.
- The 2026-06-17T160825 export confirmed the generated HTML had CC1/2 data and loaded WebGL players, but CC1/2 WebGL output had RGB pixels with alpha 0.
- CC1/2 used exported palette slots above 63. Goblet 2's WebGL palette texture was fixed at 64 rows, so those layers sampled invalid/empty palette alpha.
- The 2026-06-17T162119 export embedded the high-slot fix but still rendered CC1/2 with alpha 0. Disabling WebGL masks in the live runtime restored CC1/2 alpha immediately.
- CC1/2 contained stale alpha masks that would erase every remaining painted brush pixel. Those masks should be removed from the exported Goblet payload when the exporter can prove Vessel still considers the brush layer visible.

## Fix

- Size the Goblet 2 WebGL palette table from the highest exported slot id, up to the byte-sized slot range.
- Upload the actual palette-table height to the shader through `u_slotCount`.
- Preserve high numeric gradient slot ids during export so the runtime can sample those expanded palette rows.
- Keep Goblet runtime mask playback literal: valid exported alpha masks still apply as masks.
- During export, materialize brush index buffers for both live arrays and packed buffers, then omit a stale all-erasing alpha mask when applying it would erase every nonzero brush index while the layer still has content.
- Cover the regression with high exported slot ids in the Goblet artifact harness and an export-side stale-mask regression.

## Plan

1. Reproduce the failing comparison from the exported Goblet artifact and keep the source archive unchanged.
2. Trace the Goblet runtime path for dynamic color-cycle layers from metadata hydration to per-frame drawing.
3. Compare the WebGL color-cycle path against the CPU fallback and against the final 2D canvas compositing step.
4. Identify the first divergence in alpha, color, or draw timing for CC Layer 1 and CC Layer 2.
5. Patch the narrowest runtime/export seam that restores CC layer visibility without changing hidden-layer behavior.
6. Add focused regression coverage for exported CC layers that are present, placed, and visibly contribute to the final Goblet render.
7. Rebuild the generated Goblet inline runtime and verify the original `5.2.vs` path again.

## Constraints

- Do not treat hidden raster layers as a bug.
- Do not synthesize or alter CC archive data as a workaround.
- Keep Vessel runtime and Goblet export semantics aligned.
- Preserve base path and static export behavior.
