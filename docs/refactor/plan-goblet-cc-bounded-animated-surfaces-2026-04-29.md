# Goblet CC Bounded Animated Surfaces Plan - 2026-04-29

Status: In progress.

This plan is retained as a follow-up only. The speculative implementation attempt was backed out after the real failing ZIP path was traced to a missing packaged runtime dependency (`displayFilterPipeline.js`). Reintroduce these items only one at a time with a reproducible export fixture and browser-render verification.

## Highest Impact

- [x] Add a reusable 256 CC gradient-shape performance fixture.
  - Intended benefit: give every later optimization a stable browser-rendered
    stress file for FPS checks instead of relying on ad hoc exports.
  - 2026-04-29: Added `tests/goblet2-cc-gradient-shapes-perf.spec.ts` and
    `npm run test:goblet2:cc-gradient-shapes-perf`. The fixture builds a
    16x16 grid of 256 animated CC gradient-shape cells in one Goblet 2 file,
    verifies painted pixels, and reports RAF FPS/callback cost. Verified run:
    `fps=239.5 avgCallback=1.02ms maxCallback=2.20ms`.
  - 2026-04-29: Updated the same fixture to a 2000x2000 Goblet 2 surface and
    dithered each CC gradient-shape payload with an ordered 8x8 index pattern.
    Verified run: `fps=68.4 avgCallback=12.36ms maxCallback=30.60ms`.
  - Baseline for bounded-surface optimization: `2000x2000`, `256` dithered CC
    gradient shapes, slot-speed mode, single full-size brush payload. Current
    result before brush-payload cropping is `68.4 FPS`, `12.36ms` average RAF
    callback cost, and `30.60ms` max RAF callback cost.

- [x] Crop brush payloads before packing.
  - Intended benefit: reduce decode cost, memory, frame fill loops, and `putImageData`.
  - 2026-04-29: Goblet brush-mode export now crops array-backed brush payloads
    to computed coverage before numeric buffers are packed. Cropped payloads
    export with local source bounds while preserving document bounds, so
    placement remains unchanged. Added a sparse Goblet 2 brush export regression
    covering cropped `brushState`, local source bounds, document bounds, and
    content bounds.
  - 2026-04-29 review fix: Cropped/rebased serialized alpha masks with cropped
    brush payloads so offset erase masks stay aligned to the local Goblet source
    surface. Added sparse Goblet 2 mask coverage.
  - Verified:
    `npm test -- tests/export-color-cycle-html.test.ts --runInBand`,
    `npm run type-check`, and
    `npm run test:goblet2:cc-gradient-shapes-perf`
    (`fps=67.3 avgCallback=12.60ms maxCallback=33.60ms`).

- [x] Crop matching alpha/texture source.
  - Intended benefit: keep alpha/texture data aligned with any future bounded brush payload.
  - 2026-04-29: Goblet brush export now carries the original brush crop
    rectangle internally so the exporter can crop/re-encode the matching texture
    source before enabling source-alpha mode. Texture crops are scaled from brush
    coordinates into the actual source texture dimensions, and the exported
    source surface is reduced to the cropped brush dimensions. If a cropped
    texture cannot be encoded, export falls back to synthetic/opaque-index
    behavior instead of using a misaligned full-surface alpha source.
  - Verified:
    `npm test -- tests/export-color-cycle-html.test.ts --runInBand`,
    `npm run type-check`, `npm run lint`, and
    `npm run test:goblet2:cc-gradient-shapes-perf`
    (`fps=67.1 avgCallback=12.57ms maxCallback=30.60ms`).

- [x] Avoid forced per-pixel speed buffers when slot speeds are enough.
  - Intended benefit: use smaller and cheaper slot-speed mode when per-pixel speed is not semantically required.
  - 2026-04-29: Goblet 2 exports now keep serializer-selected `speedMode: 'slot'`
    payloads instead of forcing a per-pixel speed buffer. Goblet 2 WebGL brush
    initialization remains limited to explicit buffer-mode payloads, so slot-mode
    exports use the existing slot-speed CPU path without speed-buffer decode or upload.

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
