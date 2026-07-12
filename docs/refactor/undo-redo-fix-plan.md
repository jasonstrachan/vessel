# Undo/Redo Core Fix Plan (v6 — prove, repair, verify)

## Target failure

`docs/refactor/dump.md` captures undo on a color-cycle layer failing with
`HistoryReplayDriftError: pixel-version-mismatch` (`expected = 12`, `actual = 13`,
`documentVersion = 14`). The rejection escapes four times, the user receives no notification, and
the same top history entry remains permanently unavailable.

## Current conclusion

**Proven 2026-07-12:** the invalid transition was a history-capture ordering defect. The old shape
path passed `afterColorState: null` into the deferred pipeline, so a later legitimate
`brush-stroke-write` transaction could become the earlier action's after-state anchor. Undo then
encountered an entry whose captured generation belonged to later work.

The owning contract is `scheduleDeferredColorCycleSaveWithState`: it must capture the immutable
color-cycle after-state synchronously at the completed shape boundary and pass that state into the
deferred persistence/history pipeline. The current implementation does this. No replay guard,
counter adjustment, or downstream compensation is part of the repair.

## Immediate scope

The reported failure is fixed at the first incorrect canonical-pixel mutation or history-capture
ordering boundary. The immediate implementation consists only of:

1. instrumenting and reproducing the transition;
2. repairing the proven owner;
3. verifying the exact production-preview interaction.

Do not add replay blocking, counter rebasing, compensating state adjustments, new mutation guards, or
unrelated delta fixes to make the symptom disappear. Existing guards remain unchanged unless the
evidence proves that one participates in the incorrect transition. Replay UX, mask-version cleanup,
and structural enforcement are separate follow-ups and are not prerequisites for the core repair.

## Goals

1. **Identify the exact invalid transition.** Prove which transaction changes the color-cycle
   document after the history entry captures its pixel-version anchor and before undo begins.
2. **Fix the owning contract.** Correct the first invalid mutation or capture-ordering boundary so a
   completed user action leaves a history entry anchored to the actual final canonical pixel state.
3. **Preserve valid behavior.** Keep legitimate color-cycle publication, runtime synchronization,
   history drift detection, and the existing interaction/scheduler guards working as designed.
4. **Prove undo and redo end to end.** In the production preview, perform a 40-fill sampled-shape
   sequence, wait for delayed work, undo 40 times, and redo 40 times with pixel-identical expected
   states and no replay refusal or unhandled rejection.
5. **Leave one understandable ownership path.** The final repair must remove the invalid transition
   at its source without adding compensating state changes elsewhere.

## Non-goals

- Do not make drift errors recoverable by skipping entries, rebasing counters, or healing content.
- Do not add new guards, wrappers, retries, blocked-entry state, or downstream synchronization to
  conceal the invalid mutation.
- Do not redesign the history system or introduce document-produced history in this repair.
- Do not bundle mask-version corrections, replay-error UX, or unrelated history cleanup.
- Do not remove existing guards unless evidence proves a guard itself causes the invalid transition.

## Definition of done

The core fix is complete only when all of the following are true:

- instrumentation identifies the first invalid pixel-version transition, its reason, owning stack,
  changed buffers, and relationship to the captured history anchor;
- a focused regression test fails on the old behavior and passes with the source repair;
- removing the source repair restores the recorded extra transition, demonstrating causality;
- the final code contains no symptom-specific counter adjustment, replay bypass, or compensating
  mutation outside the owning boundary;
- the scripted production-preview sequence completes undo ×40 and redo ×40 with the expected pixels,
  matching version anchors, and no unhandled rejection;
- focused tests, type checking, lint, the production build, and `git diff --check` pass.

## Exit evidence — 2026-07-12

- **Owning transition:** a development trace recorded audit sequence 2,
  `reason = brush-stroke-write`, `pixelVersion 0 → 1`, with changes to `paintBuffer`,
  `gradientIdBuffer`, `gradientDefIdBuffer`, `speedBuffer`, and `flowBuffer`. Its stack runs through
  `colorCycleEndStroke` → `ColorCycleRuntimeDocumentState.setStrokeStateWithDocumentPublish` →
  `ColorCycleLayerDocument.replaceState`.
- **Capture correlation:** the corresponding history entry recorded `afterPixelVersion = 1`,
  `afterStateAuditSequence = 2`, and `helperBeginAuditSequence = 2`. In the 40-fill production run,
  all 40 entries formed consecutive anchors `0 → 1` through `39 → 40`; no document commit occurred
  between each completed after-state capture and history-helper entry.
- **Causal A/B:** the focused test advances the live document from pixel version 12 / audit sequence
  7 to version 13 / sequence 8 after the shape boundary. With only synchronous capture removed, the
  test fails with `Expected: 12, Received: 13`. Restoring the source contract makes the same test
  pass with the version-12, sequence-7 anchor.
- **Production interaction:** 40 sampled triangle fills across an 8 × 5 grid, including a tiny final
  triangle, produced document version 41 / pixel version 40 with 40 distinct entries. Undo ×40
  returned consecutively to version 1 / pixel version 0 and produced 40 distinct SHA-256 canvas
  checkpoints. Redo ×40 restored every checkpoint exactly, including final hash
  `21fb50bcca13e10b37c1587c1a40e1eaa0ba3f17b65721e186f16f343561e73d`. No history incident,
  replay refusal, or browser console error occurred.
- **Static verification:** `npm run type-check`, `npm run type-check:tests`, `npm run lint`, the
  production preview build, and `git diff --check` passed under Node 22.22.0. The full Jest run passed
  448 suites and 3,182 tests, with one suite/test skipped by the repository.
- **Closeout cleanup:** the temporary Phase A audit-sequence, per-buffer comparison, stack capture,
  history-correlation metadata, and replay-preparation logging were removed after the evidence was
  recorded. The final runtime retains the source-owned synchronous capture contract, the causal
  regression test, and the pre-existing lightweight diagnostics; it adds no new replay guard or
  compensating state path.

## Established facts

- `colorCycleStrokePatchDelta` refuses replay when the current document `pixelVersion` differs from
  the entry's expected anchor.
- `HistoryManager` correctly leaves stacks unchanged when replay preparation fails.
- `historyLifecycle.ts` only gives special user-visible handling to
  `HistoryReplayRecoveryError`; drift currently escapes through the keyboard callback as an
  unhandled rejection.
- `finalizeCurrentStroke` returns immediately when no stroke is active. Therefore a stale
  gradient-apply callback firing between strokes does not, by itself, prove a pixel mutation.
- `ColorCycleLayerDocument.commitTransaction` normally compares canonical buffer bytes, but
  `pixelsChanged: true` bypasses that comparison and unconditionally advances `pixelVersion`.
- The erase mask and soft-edge mask are not canonical document pixel buffers. Each has its own
  store-owned version: `eraseMaskVersion` and `softEdgeMaskVersion`.
- Committed HEAD contains both guards from commit `08f67ab00`: undo cancels an active interaction
  before history lookup, and `flushGradientApply` cancels a pending scheduled apply before flushing.
  The existing dump does not prove whether its runtime bundle included those guards.

## Hypothesis verdict

| ID | Hypothesis | Verdict |
|----|------------|---------|
| H1 | A delayed gradient-apply path commits after history capture. | Not the root cause. No post-capture gradient-apply commit appeared in the detailed or production sequence. |
| H2 | Finalization/history capture selects the wrong final generation. | **Confirmed.** Deferring `afterColorState` selection lets a later `brush-stroke-write` become the earlier action's anchor. |
| H3 | Publication, autosave, or runtime synchronization commits after capture. | Not observed in the evidence interval. |
| H4 | A caller passes `pixelsChanged: true` even though canonical bytes are unchanged. | Not the reported transition. The real shape commit changed five canonical buffers; identical-buffer forced publication remains visible in diagnostics. |
| H5 | Another path owns the transition. | Not observed. |

---

## Phase A — Instrument, reproduce, and prove the cause — complete

**Blocking gate. Nothing in Phase C starts before this phase succeeds.**

### A1. Record every document commit accurately

Extend `ColorCycleLayerDocumentAuditEntry` and `commitTransaction` diagnostics with:

- a document-local monotonic `sequence`;
- `reason`;
- `versionBefore` / `versionAfter`;
- `pixelVersionBefore` / `pixelVersionAfter`;
- `pixelsChangedFlag` exactly as supplied by the caller;
- `pixelBuffersWereEqual`;
- `changedBufferKeys` across paint, gradient ID, gradient-def ID, speed, flow, and phase;
- normalized dirty rects;
- a truncated development stack.

When `pixelsChanged: true` is supplied, run a **development-only shadow byte comparison** for the
diagnostic fields. Do not use its result to change production behavior during this phase. Without
this shadow comparison, H4 cannot be proved or falsified because the current implementation skips
the normal comparison.

Record all pixel-version advances. Do not classify a commit as unauthorized based on whether a
`HistoryManager` transaction is open: current color-cycle history capture begins after the document
mutation, so that test would falsely flag legitimate user actions.

### A2. Correlate document commits with history capture

Add a development diagnostic event at `commitLayerHistory` containing:

- a generated `historyCaptureId` also placed in the history entry metadata;
- layer ID and action;
- captured before/after document and pixel versions;
- the document audit sequence recorded with the completed `afterColorState` capture;
- the document audit sequence visible when `commitLayerHistory` began;
- the sequence visible when the history transaction committed;
- a truncated stack.

The completed `afterColorState` capture must carry its audit sequence with the captured version
anchors. Do not infer that boundary from entry into `commitLayerHistory`: callers may supply an
`afterColorState` captured before the helper begins, which is one of the ordering failures under
investigation.

Add a second event immediately before `HistoryManager` prepares the top entry. It must record the
document ID, entry ID, direction, layer ID, current audit sequence, current document version, and
current pixel version. This event is the authoritative end of the evidence interval; a diagnostics
dump taken near undo is useful context but is not a concurrency boundary.

The candidate transition is the first pixel-bumping audit record satisfying:

```text
afterStateCaptureAuditSequence < mutation.sequence <= undoPreparationAuditSequence
```

The history entry's captured `afterPixelVersion` must equal that mutation's `pixelVersionBefore`.
The helper-begin and history-commit sequences classify whether the transition occurred before,
during, or after entry construction; they are milestones, not the lower bound of the search. Audit
sequence and pixel version are separate counter domains and must never be compared directly. Do not
depend on the literal values `12 → 13`; fresh reproductions may start from different counters.

### A3. Reproduce without disturbing the dirty tree

Create two temporary worktrees under `/tmp`: one from committed HEAD with both `08f67ab00` guards
present, and one with a synthetic patch that removes only those two guards. Apply the same minimal
instrumentation patch to both. Do not restore, stash, or checkout files in the user's current working
tree to create these variants.

In each variant, run the same production-preview interaction:

1. Create a fresh project with one color-cycle layer.
2. Draw 40 sampled triangle fills across the canvas, including a tiny final triangle.
3. Wait at least one second so delayed callbacks execute.
4. Capture diagnostics before undo.
5. Undo 40 times, then redo 40 times.
6. Capture diagnostics after replay or refusal.

Automate the sequence with Playwright if manual reproduction is not deterministic. Record the exact
route, build commit, guard variant, and reproduction result with each dump.

### A4. Run cheap falsification tests

- H1: schedule and synchronously flush a gradient apply, advance document metadata with identical
  palettes, then allow the stale callback to run. Assert document commit count and `pixelVersion`.
- H4: drive each `pixelsChanged: true` publication path with byte-identical canonical buffers.
  Assert whether it advances `pixelVersion` and capture its reason.
- Capture ordering: assert that no pixel-bumping document sequence occurs between the recorded
  `afterColorState` capture and history transaction commit.

### Phase A exit criteria

Phase A succeeds only when evidence provides:

- the first post-capture pixel-version transition;
- its reason and owning stack;
- which canonical buffers changed, or proof that none changed;
- the associated history capture ID and expected anchor;
- the exact capture-commit and undo-preparation audit-sequence bounds;
- whether the failure reproduces with the guards present;
- an A/B run where disabling only the identified mutation removes the extra transition and makes
  the exact undo interaction pass.

If the failure cannot be reproduced, retain the instrumentation and stop. Do not select a hypothesis
by plausibility, and do not ship surrounding hygiene as a substitute for the missing root-cause
proof.

---

## Separate follow-up B — Replay hygiene and independent mask fixes

This section is deliberately outside the immediate core fix. Do not implement or bundle it with
Phases A, C, or F. Review and schedule each item independently after the reported failure is fixed.

### B1. Handle replay failures by actual cause

Classify every public replay failure in `historyLifecycle.ts`, inspecting nested causes where the
wrapper preserves one:

- `HistoryReplayPreparationError` caused by `HistoryReplayDriftError`: show a warning that the
  recorded step no longer matches the layer.
- `HistoryReplayPreparationError` caused by `HistoryBlobReadError`: show an error that required undo
  data is unavailable.
- any other `HistoryReplayPreparationError`: log structured diagnostics and show a generic history
  preparation error.
- `HistoryReplayApplyError`: report that replay failed but the prior document state was restored,
  include its cause in structured diagnostics, and block deterministic retries of that entry.
- `HistoryReplayRecoveryError`: preserve the existing stronger recovery warning and manager fault
  lock.
- `HistoryReplayInProgressError` and `HistoryReplayFaultedError`: treat these as manager-state
  failures, not corrupt-entry failures; do not create a new blocked-entry record.
- `HistoryReplayBlockedError`: return the existing blocked state without preparing or notifying
  again.
- any unknown error: log it and show a generic history error.

Handled preparation and successfully compensated apply failures return `null` after notification.
Keyboard `onUndo` / `onRedo` handlers also catch and log unexpected failures so promises never
escape into the global unhandled-rejection handler.

Do not drop or skip a failed entry. `HistoryManager` owns a blocked-replay registry keyed by document
ID, entry ID, direction, and failure class. `undo()` / `redo()` must reject a blocked top entry before
preparation with a typed `HistoryReplayBlockedError`, and `canUndo` / `canRedo` must reflect the same
manager query; UI availability is not the enforcement boundary. Reaching a buried blocked entry
after undoing newer work must block again.

A new commit must not coalesce into a blocked top entry because coalescing preserves the entry ID
while changing its deltas. Force a new entry in that case. Redo invalidation, max-entry trimming,
entry disposal, document replacement, and `clearHistory(docId)` must remove blocked records for
entries that no longer exist. Clearing one document must not affect another document's block.
Notifications are deduplicated by document, entry, direction, and failure class and must explain
that clearing history or reloading a known-good document is required to continue past the entry.

Add tests for drift, missing blob, unknown preparation failure, compensated apply failure, recovery
failure, in-progress/faulted classification, direct manager retry refusal, notification
deduplication, blocked `canUndo` / `canRedo`, coalescing against a blocked top entry, trimming and
disposal, and document-scoped clearing.

### B2. Put mask deltas in the correct version domains

The erase-mask delta must validate against `eraseMaskVersion`; the soft-edge-mask delta must validate
against `softEdgeMaskVersion`. Capture both version anchors as first-class fields independently of
the optional mask payload. A missing mask still has a store-owned version, so creation and removal
must not lose either replay anchor. Pass those explicit before/after anchors into each delta and
compare the current store-owned version with the direction-appropriate anchor during preparation.

Replay restores the recorded target version together with the recorded mask state; it does not
invent `current + 1` for an absent target mask. Subsequent user mutations continue incrementing from
the restored value. This keeps undo and redo anchors deterministic while the redo stack is retained.

Do not use `documentVersion` or `pixelVersion` for mask validation. Neither counter owns those
surfaces.

Add tests proving:

- a metadata-only document commit does not block mask undo;
- an unrelated canonical-pixel commit does not block mask undo;
- an out-of-history erase-mask mutation blocks erase-mask replay;
- an out-of-history soft-edge-mask mutation blocks soft-edge-mask replay;
- creating and removing a mask preserve both version anchors when one payload is absent;
- undo and redo update each mask's own version consistently.

### B3. Validate the existing guards against Phase A evidence

- If the failure reproduces only in the synthetic no-guard variant, retain both guards and their
  focused tests.
- If it reproduces with and without them, decide whether each guard independently protects a valid
  interaction boundary. Keep only guards with a focused regression test.
- Do not remove a scheduler or interaction guard merely because pixel mutations are later fixed;
  stale callbacks can still corrupt runtime metadata or visible interaction state.

Keep the improved `ccDebug` diagnostics and rename the shadowing local `document` variable to
`ccDocument`.

---

## Phase C — Fix only the proven source — complete

H2 is confirmed as a capture-ordering defect. The final pixel-changing commit completes before
`scheduleDeferredColorCycleSaveWithState` captures `afterColorState`. That immutable state is passed
to `scheduleDeferredColorCycleSave`; the idle/deferred stages may no longer choose a newer live
generation for the action.

The causal regression test is
`scheduleDeferredColorCycleSaveWithState › anchors shape history before a later canonical generation
can enter the deferred pipeline`. It fails when only the synchronous capture is removed and passes
when the owning contract is restored. The other hypotheses were not used as fixes.

---

## Separate follow-up D — Enforce the mutation invariant after the fix

This is a separate architecture change, not part of the reported undo/redo repair. Begin it only
after the core fix has passed production-preview verification and the capability design has been
reviewed independently.

Formalize document commit origins as a discriminated union, including user action, history replay,
runtime synchronization, project load/reset, and residency/metadata operations.

Because the current history transaction starts after mutation, enforcement cannot depend on
`HistoryManager.activeTxn`. Introduce an explicit color-cycle mutation capability created by the
user-action orchestration boundary and passed through every synchronous or delayed mutation call.
Do not use a browser-global or stack-like current scope: scheduled callbacks and overlapping actions
would inherit the wrong authority.

- user-action capabilities declare document ID, participating layer IDs, action ID, a unique action
  token, and whether history capture is required;
- delayed work must retain and present the originating token, and the owner must invalidate the token
  when the action commits, cancels, or is superseded;
- multi-layer and composite actions share one action token and declare every participating layer;
- replay capabilities are created and passed only by `HistoryManager` for the entry being replayed;
- project load/reset capabilities identify the affected document and must clear its history;
- runtime synchronization and residency capabilities are canonical-pixel neutral and cannot be
  upgraded into user-action authority by changing an origin string.

In tests, throw when a pixel-bumping commit has no valid scope or occurs in a pixel-neutral scope.
In development, emit a loud audit event and warning containing the origin, scope, changed buffers,
and stack. Keep production behavior unchanged until the structural design in Phase E provides an
atomic capture contract.

Add adversarial tests for a delayed callback after token invalidation, two overlapping actions on
different layers, a multi-layer action, and an attempted pixel mutation under a runtime-sync token.

Document the invariant in `ColorCycleLayerDocument` and `AGENTS.md`:

> Canonical pixel mutations must belong to a declared user action that requires history capture, to
> history replay, or to a load/reset operation that clears history. Runtime synchronization and
> metadata/residency operations must be canonical-pixel neutral.

---

## Separate follow-up E — Design proposal: document-produced history

This is not part of the immediate stabilization implementation. Write and review a dedicated design
document before changing runtime code. Do not delete current drift checks or compensation until all
exit gates below pass.

The design must resolve these contracts explicitly:

### E1. Mutation and history ownership

The user-action boundary must open a capture sink before document mutation. Every pixel-changing
document commit must either attach its inverse patch to that sink, be history replay, or be a
load/reset mutation that clears history. An origin string alone is not authorization.

### E2. Patch correctness and dirty rectangles

`commitTransaction` may use dirty rects as an optimization, not as proof of complete change bounds.
In development, compare outside declared rects and fail if bytes changed there. If bounds are absent
or untrusted, fall back to a full canonical-buffer diff. Support multiple non-contiguous rects
without silently dropping changed pixels.

### E3. Blob persistence and failure atomicity

Document commits are currently synchronous while RLE encoding and blob storage are asynchronous.
The design must specify:

- when immutable before/after bytes are owned by history;
- how pending encoding participates in `waitForPendingHistoryCommits`;
- when the history entry becomes visible;
- what remains resident until spill is durable;
- how encoding/storage failure is surfaced without silently losing undo for an already-applied user
  action;
- how cancellation and document close release retained blobs.

### E4. Masks and other non-document participants

Choose explicitly between bringing erase/soft-edge masks into the document transaction or retaining
their separately versioned deltas. Do not delete mask validation while masks remain outside
`ColorCycleLayerDocumentState`. Define how selection and other composite deltas share the same
history entry atomically.

### E5. Replay and production safety

Transaction-produced patches are correct at capture time but can still become stale if a later
out-of-history mutation occurs. Drift validation may be removed only after:

- every production pixel mutation is covered by the capture/replay/load-reset invariant;
- adversarial tests prove unscoped mutations cannot occur silently;
- missing-blob and partial-apply compensation tests still pass;
- old and new capture run in parallel and produce byte-identical patches across brush, shape, fill,
  erase, paste, cold-runtime, and large-layer scenarios;
- the exact live production-preview undo/redo interaction passes.

### Phase E exit criteria

- The dedicated design is reviewed and approved.
- The migration is split into independently revertible stages.
- Net code and retained memory are measured rather than assumed to decrease.
- Existing guards are removed only when focused tests and live interaction proof show they no
  longer protect a distinct runtime boundary.

---

## Phase F — Verification and closeout — complete

Run the smallest focused checks during Phases A and C, then broaden according to risk. Requirements
that exercise separate follow-up B apply only if that follow-up is implemented later.

Required before claiming the runtime fix complete:

- focused document audit, scheduler or owning-boundary tests, and the proven-cause regression test;
- `npm run type-check`;
- `npm run type-check:tests`;
- `npm run lint`;
- relevant Jest history suites;
- `git diff --check`;
- production build using the repo-pinned Node version;
- scripted production-preview reproduction: 40 fills, delayed frame/work, undo ×40, redo ×40, with
  pixel-identical checkpoints and no unhandled rejection;
- browser CC save/reload validation if persistence or cold-runtime behavior changed.

Record the final audit sequence showing that the top history entry's captured pixel anchor still
matches immediately before undo. Update this plan with the Phase A verdict, the source fix, test
evidence, and live verification result.

## Order and stopping rules

| Work | Purpose | Gate |
|------|---------|------|
| Phase A | Instrument and prove the first incorrect transition | Start here |
| Phase C | Repair only the proven source | Requires Phase A evidence |
| Phase F | Verify and close out the core repair | Requires the Phase C regression test |
| Follow-up B | Replay UX, blocked-entry behavior, and mask correctness | Separate approval and change |
| Follow-up D | Add scoped development enforcement | Separate architecture review |
| Follow-up E | Design document-produced history | Separate design review |

If Phase A cannot reproduce the failure, retain diagnostics and stop. If a Phase C attempt does not
remove the exact recorded transition, remove that attempt before continuing. Do not weaken drift
guards, rebase counters, add content-healing behavior, or implement follow-up work to make the symptom
disappear.
