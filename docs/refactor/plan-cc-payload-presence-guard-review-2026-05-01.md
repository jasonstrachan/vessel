# Color-Cycle Payload Presence Guard Review Plan - 2026-05-01

## Context

This plan exists because the previous process moved too quickly from backing out bad review-loop patches into a replacement implementation. The next step must treat any replacement as a proposal until the actual diff and architecture boundary have been reviewed.

Current checkout note from the planning pass: `git status --short --untracked-files=all` and `git diff --name-only` were both empty, so the first step is to reconcile that with the handover's claim that there is current dirty refactor work.

## Goal

Review or re-create the color-cycle persistence/warmup fix so archive-backed refs hydrating into real buffers are not misclassified as data loss, while true primary payload drops are blocked and logged explicitly.

## Non-Negotiable Invariants

- Do not use raw object/ref identity between archive refs and hydrated buffers to decide whether payload was lost.
- Do not use paint-only checks as the canonical content proof.
- Do not use `paintBuffer.some(byte !== 0)` as a content test; zero-valued paint bytes can still represent a valid palette/paint slot, so byte value `0` is not absence by itself.
- Do not blindly reuse mutated `brushState` as canonical save authority.
- Do not add scattered one-off logging outside the persistence/runtime boundary.
- Do not make preview-only damaged layers falsely editable.
- Runtime hydration and canonical save must consume validated document state, not loose preview fallback evidence.

## Architecture Boundary

The intended shared persistence boundary is under `src/lib/colorCycle/persistence/`:

- `resolveColorCyclePersistenceSource.ts`: source selection only.
- `emitColorCycleDocumentState.ts`: normalized document-state emission only.
- `colorCyclePersistenceValidation.ts`: invariant checks only.
- `captureColorCyclePersistenceSnapshot.ts`: orchestration only.

Save-side entry remains `serializeLayer()` in `src/utils/projectIO.ts`, routed through `captureColorCyclePersistenceSnapshot(...)`.

Warmup/runtime publication guards remain in the layer runtime restore/materialization path. A cold archive-backed layer with canonical refs may stay cold, but it must not publish a false empty runtime over canonical state.

## Required Canonical Payload Channels

Healthy editable color-cycle persistence must preserve the full canonical channel set:

- `paintRef` / `paintBuffer`
- `gradientIdRef` / `gradientIdBuffer`
- `gradientDefIdRef` / `gradientDefIdBuffer`
- `speedRef` / `speedBuffer`
- `flowRef` / `flowBuffer`
- `phaseRef` / `phaseBuffer`

Gradient refs alone are not enough for lazy/deferred archive runtime serialization.

## Validation Predicate

For this plan, "validates" means the canonical channel passes the same predicate regardless of whether it is still a deferred archive ref or has already hydrated into an `ArrayBuffer`.

- A deferred archive ref is valid when it is a non-empty `zip:` ref and archive analysis confirms the referenced payload exists.
- A hydrated `ArrayBuffer` is valid when it is present and has the expected byte length for the document dimensions.
- Expected byte lengths:
  - `paintBuffer`, `gradientIdBuffer`, `speedBuffer`, `flowBuffer`, and `phaseBuffer`: `width * height` bytes.
  - `gradientDefIdBuffer`: `width * height * 2` bytes.
- The validation predicate must not require object identity between the original archive ref and the hydrated buffer.
- Value-range checks are channel-specific follow-up validation, not the primary presence predicate:
  - `gradientDefIdBuffer` is a 16-bit channel and must be interpreted with its existing encoding.
  - scalar byte channels must remain byte-addressable, but zero byte values are not absence.

## Partial Canonical State Policy

Editable canonical color-cycle state is all-or-blocked for save and runtime publication:

- Paint, gradient-id, gradient-def-id, speed, flow, and phase are co-required for healthy editable canonical state.
- Paint plus gradient bindings without speed/flow/phase is not a degraded-but-valid editable state; it is a partial canonical state and must be blocked from canonical save/runtime publication.
- A partial state may remain visible only as static-preview/repair-failed evidence when preview pixels exist.
- Import repair and diagnostics may classify partial state, but they must not promote it to healthy editable runtime authority.

## Planned Steps

1. [x] Freeze and reconcile state.
   - Record current branch and HEAD.
   - Record `git status --short --untracked-files=all`.
   - Record `git diff --name-only`.
   - Determine whether the proposed refactor is present, already committed, on another branch, or absent.
   - Do not code until this is clear.
   - Result: branch `poc2`, HEAD `7ca607b37`; only this plan file is untracked; `git diff --name-only` is empty. No dirty implementation refactor is present in this checkout, so implementation proceeds from this plan.

2. [x] Inventory the intended architecture boundary.
   - Review `src/lib/colorCycle/persistence/`.
   - Confirm source resolution, document emission, validation, and capture orchestration stay separate.
   - Confirm save still enters through `src/utils/projectIO.ts` and does not reintroduce ad hoc serializer branches.
   - Result: the four-file boundary exists and is mostly clean. `serializeLayer()` routes through `captureColorCyclePersistenceSnapshot(...)`. Gap found for later steps: deferred archive emission fills gradient refs when a `brushState` snapshot exists, but does not currently backfill paint/speed/flow/phase refs from the deferred runtime in that branch.

3. [x] Define and verify the payload-presence invariant.
   - Treat archive refs and hydrated buffers as equivalent canonical presence when the channel exists and validates.
   - Detect true primary payload drops by missing required channels, not by object identity.
   - Keep preview pixels out of canonical save/runtime authority except in import repair or diagnostic modes.
   - Result: canonical validation now blocks partial gradient-binding state with `missing-gradient-bindings`, and empty string refs do not count as present. Paint, gradient-id, gradient-def-id, speed, flow, and phase are co-required for healthy editable persistence. Focused persistence snapshot tests pass.

4. [x] Trace archive-ref hydration and materialization directly.
   - Identify the exact path that converts deferred `zip:` refs into hydrated buffers.
   - Confirm successful materialization does not become a "loss" merely because the value changed from a ref string to an `ArrayBuffer`.
   - Confirm canonical presence is evaluated after materialization with the validation predicate above.
   - Confirm failed materialization produces a missing-ref/missing-payload diagnostic rather than a false empty runtime.
   - Result: traced archive hydration through `hydrateSerializedLayerArchiveRefs(...)`, `setLazyColorCycleArchiveRuntime(...)`, and `hydrateLazyColorCycleArchiveRuntime(...)`. Save-time deferred document emission and lazy runtime hydration now backfill missing snapshot channels from top-level deferred refs, so a materialized buffer is treated as canonical presence rather than loss. Focused persistence snapshot tests pass.

5. [x] Review the warmup publication guard.
   - Trace layer restore/materialization for cold archive-backed CC layers.
   - Confirm warm/active hydration metadata is not treated as success without a live brush when edits require runtime.
   - Confirm missing canonical paint becomes static-preview/repair-failed, not fabricated editable state.
   - Confirm the warmup log fires only for a true blocked primary payload drop:
     - `cc-warmup-canonical-payload-drop-blocked`
   - Result: warmup now validates the canonical snapshot after lazy hydration and before publishing a warm/active runtime. Primary payload failures are blocked, logged through `cc-warmup-canonical-payload-drop-blocked`, and left cold/static-preview instead of creating a misleading live brush. Existing lazy archive resave regression passes.

6. [x] Review the save-side guard.
   - Trace `serializeLayer()` through `captureColorCyclePersistenceSnapshot(...)`.
   - Confirm save does not fall back to top-level metadata, preview pixels, or mutated brush state when canonical payload is missing.
   - Confirm deferred archive runtime includes paint, speed, flow, phase, gradient-id, and gradient-def-id refs.
   - Confirm the save log fires only for a true blocked primary payload drop:
     - `cc-save-primary-payload-drop-blocked`
   - Result: save now passes all six lazy refs into the persistence snapshot. Primary payload failures log `cc-save-primary-payload-drop-blocked` and do not reuse rejected partial `brushState` or top-level gradient bindings to serialize healthy canonical refs. Focused persistence and lazy archive resave tests pass.

7. [x] Run the architecture smell check.
   - Search for raw `zip:` ref equality checks against hydrated buffers:
     - `rg -n "zip:|Object\\.is|===|!==" src/lib/colorCycle src/utils src/hooks`
     - Review matches manually for archive-ref equality or inequality checks used as canonical-presence proof.
   - Search for paint-only content checks:
     - `rg -n "paintBuffer.*some|some\\(.*!== 0|hasContent.*paint|paint.*hasContent" src/lib/colorCycle src/utils src/hooks`
   - Search for blind `brushState` reuse after mutation:
     - `rg -n "brushState.*=|brushState:" src/lib/colorCycle src/utils/projectIO.ts src/hooks`
     - Review whether canonical save paths normalize through the persistence boundary before reuse.
   - Search for new one-off logging outside the persistence/runtime boundary:
     - `rg -n "cc-warmup-canonical-payload-drop-blocked|cc-save-primary-payload-drop-blocked|payload-drop|drop-blocked" src`
   - Search for fallback paths that make damaged layers look editable:
     - `rg -n "static-preview|repair-failed|missing-canonical|preview-only|canvasImageData" src/lib/colorCycle src/utils src/hooks`
   - Result: no raw `zip:` object/ref identity comparisons are used as canonical-presence proof. Real issues found and fixed: `documentState` used non-zero paint bytes to infer canonical paint/content, and CC crop readback treated all-zero cropped paint bytes as empty. Both paths now preserve zero-valued paint bytes as valid content evidence when the authoritative snapshot says content exists.

8. [x] Add or confirm regression coverage.
   - Cold archive refs hydrate into real buffers without being treated as loss.
   - Save preserves full `paint/speed/flow/phase/gradientId/gradientDefId` refs for lazy/deferred runtime.
   - Missing paint with preview pixels remains static-preview-only.
   - Missing motion buffers fail canonical save validation.
   - Slot `0` paint is not treated as empty.
   - Warmup/save blocked-drop logs fire only on real primary payload loss.
   - Result: added/confirmed focused tests for deferred archive backfill, missing gradient bindings, missing motion buffers, zero-valued paint bytes, save-side primary payload drop logging/non-serialization, and warmup-side primary payload drop logging/static-preview blocking. Focused tests pass.

9. [x] Make the decision.
   - If the refactor is present and passes the review criteria, keep it and polish naming/log payloads.
   - If the refactor is absent, implement from this plan in small checked steps.
   - If the refactor is present but architecturally wrong and a clean diff boundary exists, revert only the fresh refactor and re-implement from this plan.
   - If no clean diff boundary exists, do not guess a revert. Identify the last known-good commit from `git log --oneline --decorate -20`, compare with `git diff <last-known-good>...HEAD -- <relevant paths>`, and make a new corrective patch from this plan instead of destructive reset/checkout.
   - Result: Step 1 found no dirty replacement refactor, so there was nothing to revert. The implementation was built from this plan in small checked patches.

10. [x] Validate.
   - Run `npm run type-check`.
   - Run `npm run lint`.
   - Run focused Jest for changed persistence/runtime tests.
   - Run full `npm test`.
   - If any guarded orchestration file is touched, run `wc -l` on:
     - `src/hooks/useDrawingHandlers.ts`
     - `src/components/canvas/DrawingCanvas.tsx`
     - `src/hooks/canvas/useCanvasEventHandlers.ts`
   - Guarded orchestration file limits:
     - soft warning: 400 LOC.
     - hard stop: 700 LOC unless there is a documented exception and split follow-up in `docs/refactor/`.
   - Result: `npm run type-check`, `npm run lint`, focused Jest for changed persistence/project/crop/document-state paths, and full `npm test` pass. Full Jest result: 367 suites, 2203 tests. Guarded orchestration file line counts are 79, 42, and 43 LOC, all below the 400 LOC soft warning.

11. [x] Check performance placement.
    - Confirm new guards run only in save, autosave, load/hydration, warmup, or explicit edit-gate paths.
    - Confirm no new guard work runs inside the render/playback frame loop.
    - Confirm no per-frame allocation or archive analysis is introduced for active CC animation.
    - Result: guard call sites are save serialization, load/archive hydration, warmup restore, and the existing history before-state capture path. The new blocked-drop logs only fire in `projectIO.ts`; no render/playback frame loop calls or per-frame archive analysis were introduced.

12. [x] Document the outcome.
    - Update the relevant bug note with the final invariant and fix shape.
    - Keep "code fixed" separate from "existing project file healed" if any damaged `.vs` artifact is involved.
    - Result: updated `docs/bugs/cc-archived-layer-false-empty-write-2026-04-30.md` with the six-channel presence invariant, save/warmup guard behavior, zero-byte paint clarification, validation, and the explicit note that no damaged `.vs` artifact was healed.

## Done Criteria

- No canonical CC payload can be silently replaced by an empty hydrated runtime.
- Cold archive-backed CC layers preserve full canonical refs through save/autosave.
- Damaged preview-only layers remain visibly preview-only and are not made falsely editable.
- Logs identify blocked primary payload drops specifically without broad console noise.
- Tests prove the invariant at save and warmup boundaries.
- Guard additions do not run in the render/playback loop and do not add per-frame archive analysis or allocation.
