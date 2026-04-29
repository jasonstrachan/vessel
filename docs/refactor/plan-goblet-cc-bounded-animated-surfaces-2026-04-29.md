# Goblet CC Bounded Animated Surfaces Plan - 2026-04-29

Status: In progress.

This plan is retained as a follow-up only. The speculative implementation attempt was backed out after the real failing ZIP path was traced to a missing packaged runtime dependency (`displayFilterPipeline.js`). Reintroduce these items only one at a time with a reproducible export fixture and browser-render verification.

## Highest Impact

- [ ] Crop brush payloads before packing.
  - Intended benefit: reduce decode cost, memory, frame fill loops, and `putImageData`.
  - Not currently implemented.

- [ ] Crop matching alpha/texture source.
  - Intended benefit: keep alpha/texture data aligned with any future bounded brush payload.
  - Not currently implemented.

- [ ] Avoid forced per-pixel speed buffers when slot speeds are enough.
  - Intended benefit: use smaller and cheaper slot-speed mode when per-pixel speed is not semantically required.
  - Not currently implemented.

- [x] Do not animate static-preview-only, no-content, or empty-coverage CC layers.
  - Intended benefit: prevent empty/static CC layers from entering `dynamicPlayers`.
  - 2026-04-29: Implemented the safe first slice for brush-mode empty coverage:
    all-zero and fully erased brush payloads now export with `isAnimating: false`
    after coverage is computed. Added focused serializer coverage and refreshed the
    single-file Goblet fixture for the required `displayFilterPipeline.js` asset.

- [ ] Preserve the static/dynamic split but reduce dynamic surface size.
  - Intended benefit: keep existing static compositing while reducing oversized dynamic CC surfaces.
  - Not currently implemented.

## Verification Required Before Any Future Implementation

- Inspect the exported ZIP/HTML payload, not only app-side state.
- Serve the ZIP contents over HTTP and confirm all module imports load.
- Render in a browser and inspect canvas pixels before and after the change.
- Add focused regression coverage for the exact export contract changed.
