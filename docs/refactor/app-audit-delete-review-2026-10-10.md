# Vessel audit area 02 — delete pixels source review

Date: 10 October 2026. Scope: read-only source review delegated by the main audit chat. This document is the only file created by this review. No runtime changes, browser interactions, test runs, commits, or area signoff were performed. **All runtime cases below remain unverified.**

Read alongside `app-functionality-audit-2026-10-10.md` and its handover. Preserve the shared dirty/staged worktree and keep production-preview/browser ownership with the main audit chat. The source references below describe the reviewed working tree and may shift after subsequent edits.

## Owning path

- App entry: `src/app/page.tsx` → `HomeClientMount` → `HomeClient` and comprehensive keyboard handling.
- `src/hooks/useComprehensiveKeyboard.ts:784-800`: scoped Delete/Backspace prevents the default action; floating paste routes to `deleteFloatingPaste`, otherwise a selection with both endpoints routes to `deleteSelectedPixels('keyboard-delete')`. No selection is a no-op.
- `src/stores/slices/selectionSlice.ts:1659-1835`: resolves active layer, rejects adjustment targets, preflights CC through `runCcSelectionTransaction`, and uses `authorizeSelectionDelete` directly for other layer types.
- Raster mutation: `selectionSlice.ts:1931-2016` reads framebuffer pixels when available, applies rectangular or mask deletion, writes framebuffer and imageData, and invalidates composition.
- CC mutation: `selectionSlice.ts:1903-1929` clears canonical channels via `clearColorCycleRegion`, clears the erase mask, and schedules slot rebuild.
- Sequence mutation: `selectionSlice.ts:1837-1900` constructs a selection mask and appends an opacity-1 destination-out event at `getSequentialLayerRenderFrame`.
- Raster/CC history: `selectionSlice.ts:2023-2036` → `src/history/helpers/layerHistory.ts`; sequence history uses `src/history/helpers/sequentialLayerHistory.ts`.
- Floating deletion: `src/stores/helpers/selectionPaste.ts:1150-1192` discards the overlay; an extracted selection with matching history context records its already-cleared source in layer history. A copied paste without source history creates no pixel history.

## Findings requiring exact browser reproduction

### D01 — layer lock does not authorize selection deletion

High-confidence source defect; runtime unverified. The reachable Layers menu toggles `layer.locked` through `src/components/panels/LayersPanel.tsx:490-495`; its button appears at lines 1460-1472. `deleteSelectedPixels` checks adjustment type but never `locked`. `src/stores/helpers/selectionDeleteAuthorization.ts:128-227` also has no lock check. CC transaction preflight delegates to that authorization (`src/stores/helpers/colorCycleSelectionTransaction.ts:189-217`). The raster, CC, and sequence mutation branches therefore have no observed lock gate.

Reproduction: create selected opaque pixels on each target type, use the actual layer menu to lock the layer, press Delete/Backspace, then inspect pixels/canonical channels/sequence events and history. Expected lock behavior: no authored-content or history mutation. If reproduced, repair the shared selection-delete authorization boundary with coverage of all three branches; do not introduce only a keyboard guard that API callers bypass.

Adjacent observation, outside this delegated repair scope: the reviewed stroke-start layer guard also lacks a lock check. Report that for the drawing/layer areas rather than expanding this deletion fix silently.

### D02 — deleting a masked selection loses its shape on undo

High-confidence source contract defect; runtime unverified. `selectionSlice.ts:1829` captures `selectionSnapshotFromValues(selectionStart, selectionEnd)` without mask, vector path, or provenance. `src/history/selectionState.ts:8-12` only supports endpoints and optional provenance. Undo restores through `src/history/deltas/selectionDelta.ts:45-59`, calling `setSelectionBounds`; that setter clears `selectionVectorPath`, `selectionMask`, mask bounds, and mask owner (`selectionSlice.ts:1216-1223`). The restored selection is thus its rectangular bounding box. A subsequent raster Delete can remove pixels that were outside the original mask.

Reproduction: seed an opaque raster with distinguishable pixels inside and outside a triangular/lasso mask but inside its bounding rectangle. Create the mask using real selection interaction; Delete; undo; assert exact pixels and mask; press Delete again and compare against the first deletion. Inverted selection is especially useful because the bounded area contains intentionally excluded pixels. Test extracted masked floating-selection Delete → undo as well: extraction captures the same bounds-only snapshot (`selectionSlice.ts:2062`) and floating deletion forwards it to history.

Likely owner: selection history snapshot/delta plus its deletion/extraction callers. A local deletion workaround would leave the shared restore invariant broken. Any repair should preserve immutable mask snapshots and history-restored provenance, and account for history serialization/size contracts before expanding files.

### D03 — sequence delete undo does not restore selection

Source behavior gap; runtime unverified. Sequence deletion clears selection at `selectionSlice.ts:1881`, but the history call at lines 1883-1894 omits the captured `selectionBefore`. `SequentialLayerHistoryPayload` has no selection field (`src/history/helpers/sequentialLayerHistory.ts:25-33`) and the transaction only pushes the sequence delta (lines 116-130). Raster/CC deletion forwards its selection snapshot to layer history. Existing sequence deletion coverage verifies event undo but does not assert selection restoration.

Reproduction: create a sequence selection, Delete, undo, compare authored frame and restored selection against raster behavior; include masked selection after D02 is resolved. A shared history repair should restore the actual mask rather than adding another bounds-only path.

## Intentional CC safety policies to preserve

These are explicit current policy, not automatically actionable defects:

- `selectionDeleteAuthorization.ts:159-165` blocks CC keyboard deletion from history-restored selections. Existing `selectionDeleteAuthorization.test.ts` and `selectionFramebufferDelete.test.ts` assert the block; `docs/refactor/plan-selection-delete-authorization-2026-05-01.md` explains its safety purpose.
- CC keyboard full-content deletion is allowed for fresh marquee/selection-handle or explicit select-all selections, but blocked for other owner kinds when all canonical paint would be cleared (`selectionDeleteAuthorization.ts:197-207`). Missing full canonical payload also blocks mutation.
- Selection ownership from another layer currently applies to the active layer. Tests explicitly cover marquee and mask cross-layer deletion; old proposed ownership restrictions in the May plan do not describe current implementation.

Reachable policy observations to exercise and record: Layers menu **Select alpha → Delete** on CC, magic wand encompassing all CC paint, and inverted mask encompassing all remaining paint. `selectLayerAlpha` produces mask-selection provenance (`selectionSlice.ts:1458-1547`), so it may hit the full-content guard. Do not remove the guard casually. Document whether feedback explains the block and distinguish a policy limitation from a source bug.

Hidden active layers also lack a deletion visibility gate. Runtime behavior and intended hidden-layer editing policy must be established before treating this as a defect; lock behavior is the stronger invariant.

## Runtime matrix — all pending

Use the existing single isolated browser/session and rebuilt production preview. Seed data through the exposed store only for fixtures; exercise deletion, selection creation, locks, target switching, and history through actual UI/keys. Wait for explicit state/render/history conditions rather than fixed sleeps.

| Case | Variants / assertions | Status |
| --- | --- | --- |
| Basic keys | Delete, Backspace; no selection; empty selection/layer; adjustment layer rejects | unverified |
| Rectangle | Forward/reverse marquee; canvas edges; selection spanning transparent pixels; select all | unverified |
| Mask | Lasso/freehand, polygon, holes, inverted selection, select alpha, magic wand; selected pixels clear and excluded pixels survive | unverified |
| Targets | Raster, CC, sequence; selection created on another layer then active target switched | unverified |
| Protection | Unlocked/locked, visible/hidden active targets; group-hidden target if reachable | unverified |
| Raster state | Framebuffer and imageData match; compositor redraws; outside pixels unchanged | unverified |
| CC state | Paint/gradient/motion metadata and erase mask synchronized; remains erased through playback; partial vs full-content safety | unverified |
| Sequence | Intended frame only; correct destination-out event/mask; playback parity; no unintended frame/event changes | unverified |
| History | Undo/redo pixels and exact selection shape; second Delete after undo; pending-history immediate undo; redo invalidated by next edit | unverified |
| Floating copied paste | Delete discards overlay; original layer unchanged; no spurious pixel-history entry | unverified |
| Floating extraction | Extract, move/rotate/resize, Delete, undo/redo; source pixels and original masked selection restored; source/active layer switch | unverified |
| Focus | Text entry suppresses normal selection deletion; floating Delete intentionally enabled in text/numeric fields | unverified |
| Input timing | Held/repeated Delete and Backspace; modifiers; playback running; immediate target/selection changes before key | unverified |

Keyboard focus references: `useComprehensiveKeyboard.ts:565-580` intentionally exempts floating selection Enter/Escape/Delete from text-entry suppression. Existing tests cover Backspace routing and floating Delete routing; do not accidentally remove those supported interactions.

## Existing deterministic coverage to extend after reproduction

- `src/stores/__tests__/selectionFramebufferDelete.test.ts`: raster framebuffer updates, cross-layer select-all, sequence event/undo, CC canonical deletion/safety/cross-layer masks.
- `src/stores/__tests__/selectionClipping.test.ts`: active-layer deletion with another layer's mask.
- `src/stores/helpers/__tests__/selectionDeleteAuthorization.test.ts`: policy and canonical availability.
- `src/stores/helpers/__tests__/selectionPaste.test.ts`: extracted floating deletion history and copied paste discard.
- `src/hooks/__tests__/useComprehensiveKeyboard.eraserHold.test.tsx`: Backspace and floating Delete dispatch.
- `src/history/selectionState.ts`, `src/history/deltas/selectionDelta.ts`, and sequence history tests: owning restore contracts for D02/D03.

Stop condition for area 02: every applicable matrix case exercised, reproduced defects repaired at their owner, exact interactions passing on rebuilt production preview, meaningful deterministic coverage and required gates passing, final diff reviewed, focused commit recorded centrally. This source review alone does not satisfy that condition.

## Session12 production reproduction and repairs

The source-review statuses above are historical. The corrected relative-history production probe now executes44 configurations /238 assertions:196 pass,42 fail on artifact00:37:56UTC. All actual selection/target prerequisites, native key-delivery, exact canonical deletion oracles and runtime-error checks pass. Original hardcoded-history probe is preserved separately; selection creation legitimately adds history.

Reproduced D01 locks fail on all three targets, D02 exact masked shape Undo fails10 assertions, D03 sequence selection Undo fails8, and rename-focused copied floating Delete fails1. An additional20 strict metadata replay failures remain literal:19CC palette/seam/definition-slot losses and1raster automatic alignment mismatch. Decoding retained snapshots identifies exact paths; no field is excluded from acceptance.

Bounded owner repairs have failing-before and passing-after deterministic evidence: shared locked authorization46/46, immutable complete selection plus queued sequence history56/56, rename propagation59/59, and automatic raster replacement alignment45/45. CC patch-history metadata and palette-clone repair is in progress. Production after verification is pending. The remaining matrix beyond the44-case subset is listed in ignored `delete-source-review-session11.md`; do not mark area02 complete from this subset. Session12 handover owns exact current source/artifact/evidence and preserved index state.


Session12 exact Delete post-fix probe **238/238** on artifact00:58:30.599UTC (`audit-session12-delete-after-production.log`, `delete-functionality-session12-after.results.txt`). All44native configurations pass actualselection/key prerequisites, canonical deletion, full mask/owner/vector replay, locks, D04rename-floating, CC complete metadata and independently derived raster edit alignment. Undo/Redo remains literal, original238/196 and initial160/90 retained. This closes reproduced D01–D04 plus metadata/alignment within this subset, not the whole area02matrix. Prepared continuation21configs and playback/transformed-floating follow-ups remain pending.

Riso+LostEdge two-file preview repair stable: onlystale Riso exclusion removed,8new nonuniform-alpha rows fail-before and76/76after (composition27/facade28/hook21); original9effectrows preserved,3publications/edge/interior/cap/no-cap/sample+blitbytes/raw+completedimmutability verified. Evidence `a29-riso-lostedge-session12-*`. Root read incrementalpatch; no further issue identified. New isolated build begun after exactDelete script finished; production combo after pending at this entry.


Session12 Delete continuation corrected evidence: `delete-continuation-session12-v2.results.txt` executes134/133; all non-adjustment paths, including the exact full8448-cell off-project sequence event and5760 rendered project pixels, pass. Its only remaining failure is a first-prerequisite absent Marquee control after adjustment activation, not a deletion defect. The reachable adjustment-only route acquires a native raster selection before actual Add Adjustment and row activation, then Backspace; **4/4** pass (`delete-adjustment-session12-v3.results.txt`, `audit-session12-delete-adjustment-v3-production.log`). Full canonical bytes, selection and relative history are preserved. Original v1/v2 results remain; no oracle tolerance or app source change. Together with44configs238/238 and9floating/playback68/68, these close the tested native paths. Final missing-payload/persisted-mask/pending-boundary probes remain preparation; area02 is active, no area02 commit yet.



### Session12 final area02 reproduction — next owner repair (D05)

`delete-final-seams-session12.js` executes **33checks/28pass** on artifact01:10:39.823UTC (`audit-session12-delete-final-seams-production.log`, matching.results.txt). Three explicit API masks at(-8,-8),32x32 RGBA, alpha48/128/255 with8x8hole: raster andsequence pass exact canonical/outside/history checks; CC fails one exact deletion assertion with128canonical paint/gradient-ID/definition-ID mismatches and128alpha mismatches. CC Undo/Redo and mask-byte replay stillpass. The imported/incomplete cold CC payload rejection passes exact three diagnostic feedback events, unchanged persisted gradient-ID bytes, canonical state, selection and history; no invented toast requirement.

**D05 — CC destination clipping loses mask source origin, reproduced/unfixed.** Independent owner trace: `src/stores/helpers/colorCycleSelection.ts` clearColorCycleRegion clamps rect(-8,-8,32,32) to(0,0,24,24), then samples mask x-startX/y-startY instead of original rectangle origin. `selectionSlice.ts` buildColorCycleMaskClearOptions correctly passes offset0 relative to original rect/maskbounds; preflight preserves originalbounds. Expected worldhole4..11 becomes actualhole12..19:64wronglycleared+64missed=128, matching production exactly. Both branches intentionally treat everyalpha>0 asselected; this is geometry/data loss, notfractionalpolicy/oracle.

Announced minimum TWO-file repair boundary for next continuation: `src/stores/helpers/colorCycleSelection.ts` plus existing `src/stores/__tests__/selectionFramebufferDelete.test.ts`. Source must preserve original mask origin through destination clipping (x-Math.floor(rect.x)+offsetX andY equivalent, or mathematically equivalent clippeddelta); change clear path only. Fail-before real-store appendSelectionMask→native-source deleteSelectedPixels fixture matches actualnegative mask; assert allsixcanonical buffers, exact positive selectedzero/outside retention, maskimmutability, onehistoryentry and completeUndoRedo. Add positive-origin explicit-offset control. Rebuild once settled, repeat exact unchanged finalseams script/case; do not relax oracle. No D05 app edit or failing regression has been made yet. Newhelperfile is HEAD-clean and expands existing area02candidate23path snapshot byone; trace/check initialownership beforeediting.

The other four failures are two forcedpending first-prerequisite checks and their aborted-case records. Nativeidle isheld, butsequenceDelete publishes oneentry immediately, so the intended sharedhistorylane barrier was NOTestablished. This is not a provedqueuebug or pendingacceptance. CCeraser awaits captureCanvasToActiveLayer BEFORE scheduleHistoryCommit; firstheldidle may be precapture rather than queuedhistory. Explicit APIactivation also bypasses native targetflush. Diagnose/observe real enqueue beforeholding its idle boundary, or recordunsupportedseam; no fake duplicate singleton/exposure/fixedsleep. Agent final source note follows if available. Original evidence retained.

Independent final D01–D04/metadata/alignment owner reviews found no other demonstrated defect. `area02-readonly-review-provenance-session12.txt` lists23pre-D05candidatepaths (16area02only includingDelete-reviewdoc,5former-sharednowarea02deltas,2umbrellaDocs), disjoint from47initial-workpaths. Refresh hashes afterdocs/D05. Separate bounded testgap: new CCpatch metadata failure mocks lack real document replaceBaseline/audit/dirty APIs, so the compensation branch lacks a new direct real-document metadata/audit rollback assertion; existing real-owner pixel late-failure tests/source review supportit. Consider focused real-document integration coverage beforearea02gate; no speculative runtimepatch. Synthetic legacyRemap normalizationlead remainsseparate/unfixed/notnativeDelete.

Area01 committeddb72ad87d and fullgate572suites/5039tests remainvalid; noarea02commit/fullgate yet. Allsourcebytes since latestproductionartifact unchanged except committedone-lineoldhookmock. Continueall65areas, do not rerun settled area01 matrices withoutaffectingchange.


### Session13 D05 repair and real-document rollback coverage

D05 now samples the selection mask relative to the original rectangle origin while clipping only destination traversal. The two-file repair changes `colorCycleSelection.ts` and extends `selectionFramebufferDelete.test.ts`. The negative (-8,-8), 32×32 mask with alpha48/128/255 and an8×8hole fails before; its positive-origin explicit-offset control passes before. Both pass after, and the complete store suite passes32/32. The regressions compare all six canonical buffers, every outside/hole cell, caller/store mask immutability, one history entry and full Undo/Redo.

Isolated production build completed2026-10-10 01:32:21.536UTC. `delete-final-seams-session13-d05.js` retains the original three negative-mask cases and incomplete-payload rejection assertions verbatim, separating only the pending cases into their existing versioned probe. Production passes27/27 with no runtime errors (`audit-session13-d05-production.log`, matching.results.json). Original33/28 evidence remains intact; no oracle was relaxed.

The CC patch regression gap is closed in the existing delta test with a real `ColorCycleLayerDocument`, both empty and pending dirty batches, independent palette metadata/version, actual Undo and compensation publications. Complete canonical buffers, metadata, versions, audit, dirty batch, store/cache, derived rebuild and history stacks are exact. Suite18/18 and file lint pass. Both cases fail against the earlier HEAD owner and an isolated current-owner mutation removing document compensation; no runtime source patch was needed.

### Session13 D06 pending Undo reproduction

Prepared pending-only v2 now establishes the real shared-history barrier: native sequence Delete authors its exact event with zero published history while the earlier CC history job is held. Row activation waits and then preserves complete chronology and Undo/Redo. Native Undo is delivered while pending but is dropped: after release, history has2Undo/0Redo, held callbacks0, no replay/fault. Diagnostic v3 preserves13checks/12pass including trusted Undo delivery; `audit-session13-delete-pending-v3-before.log` and matching.results.json retain the failure. This is different evidence from the original invalid v1 prerequisite.

Root cause is the canvas keyboard `canUndo()` precheck occurring before queued history publication. The store Undo authority already waits correctly. Announced two-file boundary: `useDrawingCanvasKeyboard.ts` and its existing undo test. Await the existing pending-commit barrier after active-operation cancellation and before availability check; preserve cancellation and store policy. Real queue/store/native-delete regression and exact production after-run are pending at this entry. Area02 remains active; no commit/full gate claimed. Area03 source inventory is preparation only; Shift explicitly appends and no square-constraint control is reachable in the traced current runtime.


### Session13 D06 production acceptance and Area02 gate in progress

D06's real shared-queue/store/native-source sequence-delete regression fails before1/3pass, then the undo helper, eraser lifecycle and sequential history suites pass3suites/32tests after. Only the existing keyboard helper and undo test changed. Cancellation returns immediately; otherwise availability is checked after the existing pending-commit barrier. Redo and public options remain unchanged.

Isolated build completed2026-10-10 01:35:11.625UTC. The exact diagnostic v3 pending probe now passes15/15 (`audit-session13-delete-pending-v3-after.log`, `delete-pending-session13-v3-after.results.json`): real unpublished Delete event behind the CC history lane, trusted Undo request, no mutation while held, exact release chronology and complete sequence/selection Undo/Redo; native row activation and subsequent Undo/Redo also pass. The strict v3 before13/12 evidence remains. No fixed sleep, duplicate singleton, queue exposure or relaxed prerequisite/oracle was introduced.

Final read-only source review found no further actionable introduced defect in D01–D05 or CC metadata/rollback, selection/history and raster alignment. Root reviewed the D06 owner/test diff. Review snapshot `area02-final-review-session13.md` and two-file D06 patch preserve boundaries. D05's27/27 production proof remains current; D06 only changes pending Undo preflight.

A fresh26-path Area02 candidate was materialized from db72ad87d HEAD in a temporary Git-aware archive. It includes only the23prior area02 paths plus D05helper and D06helper/test, disjoint from all47initial paths. Full candidate type-check (`--incremental false`) and lint pass. Full Jest is running; no full-gate pass or Area02 commit is claimed at this entry. Original index patch remains byte-identical. Session12's old Area01 generator/commit script remains historical and must not be reused.


### Session13 Area02 software signoff and completed isolated gate

The isolated26-path Area02 candidate passes full type-check, full lint, and **572 suites /5,091 tests** (one suite/test skipped; one snapshot passed) in240.789s. Logs: `audit-session13-area02-candidate-{typecheck,lint,full_jest}.log`; gate receipt `area02-final-gate-session13.json`. Every non-document candidate byte remains identical to the reviewed working source. The47initial work paths and original three-file/seven-addition staged patch remain unchanged.

Area02 is verified for its enumerated software scope: original44configurations238/238;20reachable continuation paths plus corrected adjustment4/4;9transformed-floating/playback configurations68/68; exact negative-mask/incomplete-payload27/27; real pending Undo/row-switch15/15. D01locks, D02complete masked-selection replay, D03sequence selection chronology, D04rename-focused floating deletion, CC complete metadata/palette/rollback, raster replacement alignment, D05mask source origin and D06pending Undo availability are repaired at their owners and retested. Final source review found no additional actionable introduced issue. Existing CC history-restored keyboard/full-content protection remains deliberate and unchanged.

Fixture/API-injected masks, malformed payloads and pending callback delivery are explicitly identified in evidence. These runs establish software interactions, not physical device interruption, external focus, system clipboard permission or hardware performance. No sequence extraction policy expansion is claimed. Synthetic legacyRemap normalization remains an adjacent unreproduced lead. Native software behavior on preserved initial work is distinguished from changes supplied by this audit commit.

Area02 software signoff is contingent on successful focused local commit creation and its receipt, appended after creation. No push, deployment or branch change. Areas03–65 remain the ongoing authorized audit scope; Area03 native findings are preserved separately for the next owner repairs.
