# Color-Cycle Soft Edge Mask Plan

Status: implemented
Date: 2026-05-03

## Goal

Add a saved color-cycle edge-mask action that softens the selected CC layer's visible edges while preserving CC animation, dithering, gradient slots, speed, flow, phase, save/load, and Goblet playback.

This must not bake the CC art to normal pixels. Animation must survive.

## Decision

Use a precomputed alpha mask on the CC layer.

Do not implement this as a live blur display filter. A live blur would add per-frame image processing cost and would blur the rendered dither pattern. The intended behavior is:

1. Render or inspect the current CC layer coverage.
2. Build a one-time soft alpha mask from that coverage.
3. Store the mask on the CC layer.
4. Apply the cached mask after each normal CC frame render.

The CC renderer continues to animate from canonical CC data. The mask only changes layer alpha.

## Non-Negotiables

- Do not mutate CC dithering patterns.
- Do not mutate `paintBuffer`, `gradientIdBuffer`, `gradientDefIdBuffer`, `speedBuffer`, `flowBuffer`, or `phaseBuffer`.
- Do not route this through shape finalize or dither finalize.
- Do not convert the selected CC layer to a normal layer.
- Do not use a per-frame blur.
- Keep Vessel runtime and Goblet export/runtime behavior in sync.
- Treat the operation as destructive to mask state only, with undo/redo support.

## Existing Seams

- Runtime CC erase masks already exist as `colorCycleData.eraseMask` and `eraseMaskImageData`.
- `eraseMask` is subtractive and is applied with `destination-out` in `src/stores/layers/createLayersSlice.ts`.
- Soft edge must be separate from erase mask semantics because it is a keep-opacity mask, not an erase operation.
- Display filters live in `src/lib/displayFilters.ts`, `src/lib/displayFilterPipeline.js`, and `src/components/panels/DisplayFiltersSection.tsx`, but this feature should be a destructive selected-layer action, not another runtime display-filter toggle.
- Layer recomposition already hashes `eraseMaskVersion` in `src/components/canvas/layersHash.ts`; soft edge needs equivalent invalidation.

## Data Model

Update `src/types/index.ts`.

Add persisted compatibility fields:

```ts
softEdgeMaskImageData?: ImageData;
softEdgeMaskVersion?: number;
```

Add runtime field:

```ts
softEdgeMask?: HTMLCanvasElement;
```

Keep these separate from:

- `eraseMask`
- `eraseMaskImageData`
- canonical CC buffers
- `canvasImageData`

## Mask Generation Utility

Create a focused utility, likely `src/utils/colorCycleSoftEdgeMask.ts`.

Inputs:

- selected CC layer
- project width and height
- radius in image pixels

Algorithm:

1. Resolve source coverage:
   - Prefer the live `colorCycleData.canvas` after rendering the current CC frame.
   - Fallback to `colorCycleData.canvasImageData` only if live canvas is unavailable.
2. Build a hard alpha mask:
   - white alpha where CC content is visible
   - transparent where no CC content exists
3. Blur the hard mask once with Canvas2D `filter = blur(${radius}px)`.
4. Preserve solid interiors by drawing the original hard mask back over the blurred mask.
5. Return both:
   - `softEdgeMask` canvas for runtime use
   - `softEdgeMaskImageData` for persistence/history

The utility should operate only on alpha. RGB content is irrelevant.

## Store Actions

Add actions to the layers slice:

```ts
applyColorCycleSoftEdgeMask(layerId: string, radius: number): Promise<boolean>;
clearColorCycleSoftEdgeMask(layerId: string): void;
```

`applyColorCycleSoftEdgeMask` should:

1. Require a color-cycle layer.
2. Ensure the layer runtime is warm/active enough to render the current frame.
3. Render the current CC frame to the layer canvas before deriving alpha.
4. Generate the soft edge mask.
5. Update only:
   - `softEdgeMask`
   - `softEdgeMaskImageData`
   - `softEdgeMaskVersion`
6. Mark composites dirty.
7. Mark autosave dirty.
8. Record history.

`clearColorCycleSoftEdgeMask` should remove the same fields, increment `softEdgeMaskVersion`, mark dirty, and record history.

## Render Path

Patch the existing CC composition sites in `src/stores/layers/createLayersSlice.ts`.

Current flow:

1. render or advance CC canvas
2. apply erase mask with `destination-out`
3. draw layer into composite

New flow:

1. render or advance CC canvas
2. apply erase mask with `destination-out`
3. apply soft edge mask with `destination-in`
4. draw layer into composite

This preserves animation because the CC frame is still regenerated normally before the cached alpha mask is applied.

## History

Extend color-cycle history snapshot handling to include:

- `softEdgeMaskImageData`
- `softEdgeMaskVersion`

Undo/redo must restore only the mask state. It must not restore or rewrite canonical CC paint/gradient/speed/flow/phase buffers unless those were already part of the surrounding history snapshot contract.

Update tests around `src/history/helpers/__tests__/colorCycle.test.ts`.

## Persistence

Update `src/utils/projectIO.ts`.

Serialization:

- Convert `softEdgeMaskImageData` to a data URL in the same area that serializes `eraseMaskImageData`.
- Save `softEdgeMaskVersion`.

Deserialization:

- Convert the saved data URL back to `ImageData`.
- Recreate `softEdgeMask` canvas during hydration/init using the same broad pattern as erase masks.

Project save/load must preserve the mask without touching canonical CC data.

## Goblet Export And Runtime

Update `src/utils/export/goblet/gobletColorCycleSerializer.ts` and the relevant Goblet runtime paths.

Export:

- Include the soft edge mask alpha data or image data alongside the existing CC payload.
- Keep it separate from erase mask payload.

Runtime:

1. Render CC frame normally.
2. Apply erase mask if present.
3. Apply soft edge mask with `destination-in` if present.

Update Goblet 1 and Goblet 2 parity tests if both runtimes consume CC masks.

## UI

Add the controls near the Filters panel UI in `src/components/panels/DisplayFiltersSection.tsx`, but present it as a selected-layer destructive action rather than a display-filter toggle.

Suggested controls:

- Radius slider, image pixels, `0` to `24`
- `Bake Soft Edge Mask`
- `Clear Soft Edge Mask` when the selected CC layer has one

Availability:

- Enabled only when the selected layer is a color-cycle layer.
- Disabled for normal/sequential layers.

Copy should stay minimal, but the button/section should make clear this bakes mask state, not pixels.

## Tests

Add or update focused tests:

- Utility test: generated mask keeps interiors opaque and softens boundary alpha.
- Store test: applying a mask increments `softEdgeMaskVersion`.
- Store test: applying a mask does not mutate `paintBuffer`, `gradientIdBuffer`, `gradientDefIdBuffer`, `speedBuffer`, `flowBuffer`, or `phaseBuffer`.
- Render/composition test: soft edge uses `destination-in`; erase mask still uses `destination-out`.
- Persistence test: save/load preserves `softEdgeMaskImageData` and `softEdgeMaskVersion`.
- Goblet export/runtime test: exported CC layer includes and applies the soft edge mask.
- Hash test: `src/components/canvas/layersHash.ts` includes `softEdgeMaskVersion`.

## Validation

Run:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
```

For a narrower iteration, run the new focused tests first, then the full suite before commit.

Manual verification:

1. Create or load an animated CC shape layer.
2. Apply a soft edge mask.
3. Confirm animation still plays.
4. Confirm the interior dither pattern remains crisp.
5. Confirm only the silhouette/edge alpha softens.
6. Save and reload the project.
7. Export Goblet and confirm the same animation and mask behavior.

## Risks

- Reusing `eraseMask` would be wrong because erase is subtractive; soft edge is a keep-alpha mask.
- Applying blur to the rendered CC frame each tick would be expensive and would blur dither interiors.
- Forgetting Goblet parity would make Vessel look correct while exported playback regresses.
- Failing to include `softEdgeMaskVersion` in layer hashing may make the canvas fail to redraw after mask edits.

## Current State

Implemented 2026-05-04.

- Added `softEdgeMask`, `softEdgeMaskImageData`, `softEdgeMaskEnabled`, and `softEdgeMaskVersion` as separate CC mask state from erase masks and canonical CC buffers.
- Added a one-time alpha-mask generator in `src/utils/colorCycleSoftEdgeMask.ts`. It prefers canonical CC paint coverage when available, falls back to the current CC canvas or persisted preview, treats outside-canvas coverage as transparent, and builds a distance-based dithered edge band so the mask reads as pixelated/dithered instead of smooth blur. The edge supports ordered and Sierra Lite alpha dithering. The dither pattern size is an explicit bake setting because a CC layer can contain multiple marks with different fill settings.
- Added `applyColorCycleSoftEdgeMask`, `setColorCycleSoftEdgeMaskEnabled`, and `clearColorCycleSoftEdgeMask` store actions with dirty/recomposition marking and undo/redo history support for mask state only.
- Runtime composition applies erase masks with `destination-out`, then soft-edge masks with `destination-in` on a scratch composite source so repeated recomposition does not mutate the canonical CC layer canvas.
- DrawingCanvas live presentation paths now pass the CC layer into `getColorCyclePresentationCanvas` so active/warm/cold CC render paths apply erase and enabled soft-edge masks before drawing the presentation canvas.
- Save/load, background autosave restore, project resize, layer cloning, layer hashing, and Goblet export now preserve the soft-edge mask separately from erase-mask payloads.
- UI controls live in `DisplayFiltersSection` as a CC-only switch, Edge Width slider, Edge Dither dropdown, Dither Size slider, and Save/Refresh Mask action. Edge Dither defaults to Sierra Lite when there is no persisted project preference. Turning the switch off disables the saved mask without deleting it.
- Goblet minified metadata now decodes `sem` back to `softEdgeMask` in both module and inline runtimes.

Validation completed:

- `npm run type-check`
- `npm run lint`
- focused Jest suites for utility, layer hash, composition, project IO, and Goblet export
- focused live DrawingCanvas presentation/composite Jest suites after fixing the missed visual path
- `npm test -- --runInBand`
- Browser canvas sanity check on `http://localhost:3000/`: a `destination-in` alpha mask produced partial alpha `[0, 84, 168, 255]`.

Manual UI walkthrough status:

- Not yet fully completed for drawing a fresh CC gradient shape, baking the mask from the Filters panel, and visually comparing the rendered silhouette in the app.
