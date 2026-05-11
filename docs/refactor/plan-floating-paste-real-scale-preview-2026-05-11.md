# Floating Paste Real Scale Preview Plan - 2026-05-11

## Goal

Marquee image scaling must show the real pixels that will be committed at the current size, while staying non-destructive until the user commits.

The user-facing contract is:

1. The preview shows the actual resampled destination pixels for the current marquee size.
2. Commit writes exactly the same pixels the preview showed.
3. If the preview looks wrong, the user can keep resizing without compounding quality loss.

## Current Problem

The floating paste preview and commit paths are separate rasterization paths.

- Preview is drawn in `src/components/canvas/drawingCanvasFloatingPaste.ts`.
- Bitmap commit is drawn in `src/stores/helpers/selectionPaste.ts`.
- Color-cycle floating paste commit uses scalar-buffer resampling in `src/stores/helpers/selectionPaste.ts`.
- Transform handles live in `src/components/canvas/FloatingPasteOverlay.tsx`.

The visible problem is that the preview currently appears to preserve full source resolution regardless of the destination size. When the user scales a pasted/extracted image down, they need to see the pixels that will survive the downsample before committing.

## Non-Negotiable Invariants

- `floatingPaste.imageData` remains the original source image for the full floating-paste session.
- Preview rendering must never overwrite or mutate `floatingPaste.imageData`.
- Every preview frame is derived from original source pixels plus current transform state.
- Commit uses the same raster helper as preview for bitmap paste.
- Repeated resizing cannot chain from the last preview result.
- Selection handles, marquee strokes, and marching ants are UI overlays only. They must not enter the baked pixel output.
- Active canvas shape/project clipping must be preserved.
- Color-cycle canonical payload safety must not be weakened.

## Relevant Files

- `src/components/canvas/drawingCanvasFloatingPaste.ts`
  - Current live preview drawing path.
  - Currently builds a source `pasteCanvas`, applies `imageSmoothingEnabled = false`, and draws it into the transformed destination.

- `src/stores/helpers/selectionPaste.ts`
  - Current commit path for bitmap and color-cycle floating paste.
  - Contains destination rect helpers, off-canvas cropping, nearest-neighbor scalar resampling, history setup, and final capture.

- `src/components/canvas/FloatingPasteOverlay.tsx`
  - Updates `floatingPaste.displayWidth`, `floatingPaste.displayHeight`, position, and rotation via resize/move/rotate handles.

- `src/components/canvas/floatingPasteTransform.ts`
  - Existing transform math helper for anchored handle resizing.

- Tests near:
  - `src/components/canvas/__tests__/floatingPasteTransform.test.ts`
  - `src/components/canvas/__tests__/SelectionMarqueeHandles.test.tsx`
  - `src/hooks/canvas/handlers/__tests__/clipboardHandlers.test.ts`

## Proposed Architecture

Add one shared raster authority for bitmap floating paste preview and commit.

Suggested file:

`src/utils/selection/floatingPasteRaster.ts`

The helper must be framework-light and usable from both the canvas renderer and the store helper. It must not live under `src/components/**`, because `src/stores/helpers/selectionPaste.ts` should not import component-owned code.

### Types

```ts
export interface FloatingPasteRasterSource {
  imageData: ImageData;
  width: number;
  height: number;
  position: { x: number; y: number };
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
}

export interface FloatingPasteRasterProject {
  width: number;
  height: number;
}

export interface FloatingPasteRasterResult {
  canvas: HTMLCanvasElement;
  roi: { x: number; y: number; width: number; height: number };
  destinationRect: { x: number; y: number; width: number; height: number };
  rotatedBounds: { x: number; y: number; width: number; height: number };
}
```

### Integer Pixel Geometry Contract

Preview, commit, history capture, and tests must use the same integer geometry.

- `destinationRect` may preserve float transform state for drawing math.
- `rotatedBounds` may preserve float bounds for analysis/debugging.
- `roi` must always be integer pixel geometry:
  - `x = floor(left)`
  - `y = floor(top)`
  - `right = ceil(right)`
  - `bottom = ceil(bottom)`
  - `width = max(0, right - x)`
  - `height = max(0, bottom - y)`
- The integer ROI must be clipped to project bounds.
- The helper must return `null` when the clipped integer ROI is empty.
- `outputCanvas.width` and `outputCanvas.height` must come from this integer ROI only.
- `captureCanvasToActiveLayer`, preview draw placement, and `commitLayerHistory` bitmap ROI must all consume this same integer ROI.

### Raster/Compositing Boundary

The shared helper should bake raw floating-paste pixels only.

It should not bake selection handles, marching ants, layer UI, or the existing destination layer. It should also not silently apply different opacity/blend semantics for preview versus commit.

The caller responsibilities are:

- Preview applies active layer opacity, blend mode, and active canvas shape/project clipping exactly once when drawing the baked raw paste canvas.
- Commit composes the baked raw paste canvas into the temporary layer canvas using the same intended write semantics as the existing paste commit path.
- If preview uses `layerOpacity`/`layerBlendMode` but commit writes raw pixels independent of those properties, that must be treated as an existing semantic decision and documented in the implementation. Do not accidentally make preview look like a layer-composited result if commit writes different pixels.
- Tests must compare the same boundary: raw bake to raw bake, and committed ROI to the expected committed ROI after the same composition semantics.

### Helper Responsibilities

- Resolve destination rect from `position`, `displayWidth/displayHeight`, and original size.
- Resolve rotated bounds.
- Intersect rotated bounds with project bounds to produce the capture/draw ROI.
- Rasterize from original `imageData` into a temporary canvas using nearest-neighbor behavior.
- Handle pixel-exact paste as a direct put/draw path without smoothing.
- Handle scale-down and scale-up by producing destination-sized pixels, not a full-resolution transformed preview.
- Handle partially off-canvas paste using the same crop math for preview and commit.
- Return `null` when there is no visible project intersection.
- Return integer ROI dimensions only.

## Implementation Phases

### Phase 1 - Extract Destination Math

- Move or duplicate-then-delete the following concepts from `selectionPaste.ts` into the new helper:
  - destination rect resolution,
  - rotated bounding rect,
  - integer project intersection,
  - source crop for off-canvas non-rotated scaling,
  - rounded destination dimensions.
- Keep exported helpers small and tested.
- Do not change behavior yet.

Validation:

- Existing tests pass.
- Add unit tests for destination rect and project intersection.

### Phase 2 - Add Bitmap Bake Helper

Implement a helper that always renders from the original source `ImageData`.

Pseudo-flow:

```ts
export const rasterizeFloatingPasteBitmap = (
  source: FloatingPasteRasterSource,
  project: FloatingPasteRasterProject
): FloatingPasteRasterResult | null => {
  const destinationRect = getFloatingPasteDestinationRect(source);
  const rotation = source.rotation ?? 0;
  const rotatedBounds = getRotatedBoundingRect(destinationRect, rotation);
  const roi = intersectIntegerBoundsWithProject(rotatedBounds, project);
  if (!roi) return null;

  const sourceCanvas = getOrCreateSourceCanvas(source.imageData);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = roi.width;
  outputCanvas.height = roi.height;
  const ctx = outputCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;

  // Draw into ROI-local coordinates so outputCanvas pixels are exactly what
  // preview and commit will use.
  ctx.translate(-roi.x, -roi.y);
  drawTransformedPaste(ctx, sourceCanvas, destinationRect, rotation);

  return { canvas: outputCanvas, roi, destinationRect, rotatedBounds };
};
```

Important detail:

- The bake output must be ROI-sized and in world-pixel resolution.
- Preview draws `result.canvas` at `result.roi.x/y` with no additional image smoothing.
- Commit draws/captures the same `result.canvas` at the same ROI.
- `result.roi` must be the only ROI used by preview placement, commit capture, and bitmap history for the transformed destination.

### Phase 3 - Route Preview Through Bake Helper

Update `drawingCanvasFloatingPaste.ts`:

- Keep the function responsible for composition, layer opacity, blend mode, canvas-shape clipping, and marquee UI.
- Replace bitmap draw internals with:
  - call `rasterizeFloatingPasteBitmap(floatingPaste, project)`,
  - clip to project/active shape,
  - draw baked canvas at `roi.x`, `roi.y`, `roi.width`, `roi.height`,
  - ensure `ctx.imageSmoothingEnabled = false`.
- Leave marching ants and vector path strokes after the baked pixel draw.
- Preserve rotation handle/resize handle behavior in `FloatingPasteOverlay.tsx`.
- Preserve the existing layer opacity/blend mode decision intentionally. If commit does not write layer-opacity-composited pixels, do not make the baked preview imply that it does.

Expected behavior:

- Shrinking a high-detail bitmap visibly loses detail during preview.
- Enlarging shows nearest-neighbor chunky pixels during preview.
- Dragging handles regenerates from the original source each frame.

### Phase 4 - Route Bitmap Commit Through Bake Helper

Update the bitmap branch of `commitFloatingPaste` in `selectionPaste.ts`:

- Keep history setup, move-history ROI logic, before-image capture, and final `commitLayerHistory`.
- Replace the local `pasteCanvas` and duplicated transform draw logic with `rasterizeFloatingPasteBitmap`.
- Compose the baked canvas into `tempCanvas` at the returned ROI.
- Call `captureCanvasToActiveLayer(tempCanvas, result.roi)`.
- Use `result.roi` as the transformed destination bitmap ROI for `beforeImage` capture.
- For same-layer move history, keep the union behavior, but union the source bounds with `result.roi`, not a separately rounded unrotated destination rectangle.
- `bitmapRoi` passed to `commitLayerHistory` must be `moveHistoryRoi ?? result.roi`, not an independently computed rect.

Commit must no longer have separate rounding/crop/raster behavior from preview.

### Phase 5 - Color-Cycle Destination Math Alignment

This phase is optional follow-up unless bitmap implementation or tests prove color-cycle destination math is part of the same bug.

Do not convert color-cycle paste to bitmap.

Keep CC commit writing canonical scalar buffers through:

- `writeColorCycleRegion(...)`
- `resampleScalarNearest(...)`
- `resampleScalarNearest16(...)`
- gradient slot/definition transfer helpers

But align its destination rect math with the shared helper:

- Use the same destination rect and rounded size rules.
- Keep rotation disabled/blocked for CC floating paste unless a separate feature explicitly adds rotated CC scalar transform support.
- Preserve existing CC transaction preflight, canonical payload checks, gradient transfer, and populated-data safety.
- Do not weaken or bypass `runCcSelectionTransaction(...)`.

### Phase 6 - Cache Without Destructive Baking

Optional performance cache for preview:

- Cache by:
  - `floatingPaste.imageData` identity,
  - `position.x/y`,
  - `displayWidth/displayHeight`,
  - `rotation`,
  - project width/height.
- Cache only derived canvas output.
- Never write cache output back into `floatingPaste.imageData`.
- Invalidate on any transform/source/project change.

This can be skipped initially if performance is acceptable.

## Tests

Add focused tests for the new raster helper.

Suggested file:

`src/components/canvas/__tests__/floatingPasteRaster.test.ts`

Required coverage:

- Scale down a detailed source image and verify output dimensions and sampled pixels.
- Scale up a small source image and verify nearest-neighbor chunky pixels.
- Repeated resize derives from original source:
  - rasterize original `4x4` to `2x2`,
  - then rasterize the same original `4x4` to `3x3`,
  - assert the `3x3` result is not derived from the `2x2` bake.
- Fractional destination position and size use the same rounding for preview and commit.
- Partially off-canvas non-rotated paste produces the expected ROI and cropped pixels.
- Rotated bitmap paste, if existing behavior is preserved, produces stable ROI and non-empty output.
- Integer ROI contract:
  - float left/top are floored,
  - float right/bottom are ceiled,
  - clipped ROI dimensions are integers,
  - empty clipped bounds return `null`.

Add one parity test around commit behavior if feasible:

- Prepare a layer with known pixels.
- Prepare a floating paste source.
- Call the raster helper to get expected preview pixels.
- Commit floating paste.
- Assert the committed layer ROI equals the expected preview pixels.
- Assert `commitLayerHistory` receives the same ROI used for commit capture, or the source/destination union for same-layer move history.

## Manual Validation Checklist

- Paste or extract a high-contrast image with visible fine detail.
- Scale down with marquee handles.
- Confirm preview visibly drops pixels at the current size before commit.
- Scale back up and down repeatedly.
- Confirm the image does not degrade cumulatively while still floating.
- Commit.
- Confirm committed layer pixels match the preview exactly.
- Repeat with a paste partially outside the canvas bounds.
- Repeat with pixel-exact no-scale paste to ensure old simple paste remains correct.

## Definition of Done

- Preview at scaled size is a real pixel preview, not a full-resolution transform.
- Commit result is pixel-identical to the preview bake.
- Repeated resizing remains non-destructive until commit.
- Bitmap paste code has one raster authority shared by preview and commit.
- CC paste canonical scalar path remains intact and guarded.
- Targeted tests cover scale-up, scale-down, off-canvas, repeated resize, and preview/commit parity.
- `npm run type-check` passes.
- `npm run lint` passes.
- Relevant focused tests pass.
