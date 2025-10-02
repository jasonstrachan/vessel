# Alignment & Fit Refactor Plan

## Goal
- Rebuild the alignment and fit pipeline (exporter ➜ viewer ➜ resolver) around a minimal, percent-based contract.
- Eliminate legacy code paths in `exporter`, `viewer`, and `src/utils/alignment/alignFitResolver.ts` that mix pixel and percent systems.
- Preserve subpixel precision in positioning and scaling while keeping the implementation straightforward.

## Scope & Guardrails
- Exporter: emit only user-selected alignment/fit settings, document dimensions, and per-layer painted pixel bounds (also expressed as percent of the document size when available).
- Viewer: interpret the exported payload, calculate viewport placement on load, and recompute on resize.
- Alignment resolver: new module responsible for mapping percent offsets + fit selection into viewport transforms.
- Remove the existing resolver helpers, redundant fallbacks, and ad-hoc rounding logic; no partial migration.

## Data Contract (Exporter ➜ Viewer)
- `document`: `{ widthPx, heightPx }` (number, allow floats) — aligns with existing `Project.width`/`height` semantics.
- `layer`: `{ id, documentBoundsPx: { x, y, width, height }, documentBoundsPercent: { x, y, width, height }, alignment: { horizontal, vertical, offsetPercent: { x, y }, positioning }, fit }`.
  - `alignment.horizontal`/`vertical` reuse the current `LayerHorizontalAlignment` (`'left'|'center'|'right'`) and `LayerVerticalAlignment` (`'top'|'center'|'bottom'`) enums.
  - `alignment.positioning` reuses `'anchor'|'auto'`.
  - `fit` reuses `LayerAlignmentFit` but the active set is limited to `'none'|'uniform'|'contain'|'cover'|'fill'`; legacy tokens (`'fit-width'`, `'fit-height'`, etc.) will be removed with this refactor.
- `offsetPercent` is the single source of truth for placement. Values are always expressed as `{ x: percentFromLeft, y: percentFromTop }` relative to the document origin. When `positioning === 'anchor'`, it comes directly from user input. When `positioning === 'auto'`, exporter derives it from `documentBoundsPercent` and stores the result so the viewer never recomputes it.
- Always provide document-relative percents and raw pixel bounds so the viewer can pick whichever base is required for the chosen fit mode.

### Precision Rules
- Retain subpixel floats throughout the pipeline. Exported JSON serializes numbers with `Number` precision but we cap to 6 decimal places when writing to disk to keep payloads stable (`Number(value.toFixed(6))`).
- Viewer math operates on the raw floats; only the final DOM/canvas assignments round if the rendering API requires it.
- Unit tests should compare using a small epsilon (`1e-5`) instead of strict equality.
## Alignment Rules
- Horizontal `left|center|right` and vertical `top|center|bottom` anchors are expressed with `offsetPercent` (0–100 range, can be negative for intentional overscan). `offsetPercent.x` measures from the left edge; `offsetPercent.y` measures from the top edge regardless of fit mode.
- Auto alignment: store the captured pixel bounds as percents of document size during export; viewer uses them directly without recomputing heuristics.
- Offsets apply before fit scaling; compute anchor point in document space, then scale/translate into viewport.

## Fit Rules
- `none`: render at source pixel size (document pixels); scale = 1.
- `uniform`: use `documentBoundsPx` as the source box. Compute `scale = min(viewportWidth / boundsWidth, viewportHeight / boundsHeight)` to preserve aspect ratio without cropping; letterboxing is expected when the aspect ratios differ.
- `contain`: use full document dimensions as the source box. Same scaling equation as `uniform` but against `{ widthPx, heightPx }` so even untouched regions stay visible.
- `cover`: use full document dimensions; compute `scale = max(viewportWidth / documentWidth, viewportHeight / documentHeight)` so the viewport is fully covered, accepting cropping on the excess axis.
- `fill`: use full document dimensions; compute `scaleX = viewportWidth / documentWidth` and `scaleY = viewportHeight / documentHeight` independently (aspect ratio not preserved).
- All fits return subpixel floats; no rounding until final canvas/DOM assignment.

## Implementation Steps
1. **Contracts**: Define new TypeScript interfaces for exporter payloads in a shared module (`src/types/alignment.ts` or similar). Update imports to remove legacy alignment types.
2. **Exporter Rewrite**: Replace old logic with a serializer that captures user settings + pixel bounds ➜ percent conversion. Drop offsetPx math and legacy fallbacks.
3. **Resolver Replacement**: Create a slim resolver that consumes the new contract, applies alignment percentages, calculates fit scaling, and returns viewport transforms with floats.
4. **Viewer Integration**: Update viewer rendering code to call the new resolver on load and on `resize`, removing legacy branching and cached state tied to the old API.
5. **Cleanup**: Delete unused helpers/tests linked to the deprecated pipeline. Ensure build scripts (`scripts/build-align-fit.mjs`) reference the new entry.
6. **Validation**: Refresh unit tests (`src/stores/__tests__/useAppStore.alignment.test.ts` etc.) to cover anchor math, each fit mode, and resize recalculations using high-precision assertions.

## Testing & Verification
- Unit tests for resolver math across anchor combinations and fit types with edge cases (tiny viewport, tall viewport, fractional bounds).
- Integration tests (viewer) to confirm resize triggers recomputation and percent offsets remain stable.
- Manual check in the app exporter ➜ viewer loop to ensure alignment data persists and renders identically.

## Rollout Notes
- Document the new payload contract in `docs/exporting.md` once implemented.
- Communicate removal of pixel offset settings to avoid regressions in custom scripts.
- Monitor initial export/view cycles for rounding issues; adjust only if precision causes visual artifacts.
