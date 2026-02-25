# Color-Cycle Erase Preview Shows Protected Pixels

Status: Open  
Severity: Medium (visual correctness during preview; finalized output can still be correct)  
Last updated: 2026-02-13

## Summary

On `color-cycle` layers, after erasing and then painting back over the erased region with a color-cycle brush, live preview can show erased pixels as still protected. Finalized stroke output may look correct, but in-stroke feedback is wrong.

## Reproduction

1. Create/select a `color-cycle` layer.
2. Erase a region using eraser.
3. Switch to a color-cycle brush and paint across the erased area.
4. Observe preview while dragging.

## Expected

- During stroke preview, newly painted marks should appear over the erased region immediately.

## Actual

- Preview can treat erased area as protected/blocked.
- User-visible result: mismatch between in-stroke preview and finalized appearance.

## Scope Notes

- This is specifically a preview-path behavior issue.
- Final commit/finalized output may still be correct.
- Regressions from attempted fixes were observed in performance (stutter/flicker/lag), so perf is a hard constraint.

## Guardrails For Future Fix

- Do not add per-frame full-canvas compositing in preview path.
- Do not add per-stamp `updateLayer` churn in hot loops.
- Keep overlay and layer-canvas composition single-pass for active color-cycle brush preview.
- Validate on large canvas (performance baseline) before merging.

## Validation Checklist (future fix)

- Erase -> repaint preview parity test on color-cycle layer.
- No visible flicker/aura around stroke while dragging.
- No added stutter compared to current baseline.
- `npm run type-check`, `npm run lint`, targeted canvas/CC tests pass.

