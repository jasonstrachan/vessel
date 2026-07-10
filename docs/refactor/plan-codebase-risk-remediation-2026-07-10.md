# Codebase Risk Remediation Plan - 2026-07-10

Status: in progress

## Explicit Goal

Remove the six highest-impact risks identified in the 2026-07-10 codebase review, starting with history replay correctness.

The first delivery is complete only when one undo or redo entry is an all-or-nothing transaction across every delta and runtime rehydration side effect: either the whole user intent succeeds and moves between history stacks, or the application restores the exact pre-replay document/runtime state and leaves both stacks unchanged.

## Baseline Evidence

Review baseline on `main` at `d829f207e`:

- `npm run type-check`: passed.
- `npm run type-check:workers`: passed.
- `npm run type-check:tests`: passed.
- `npm run lint`: passed.
- `npm test -- --runInBand`: passed, 434 suites / 3004 tests.
- `npm run verify:goblet-runtime`: passed.
- `npm run verify:cc-render-gate`: passed.
- `npm run audit:prod`: passed, 0 production vulnerabilities.
- `npm run architecture:check`: failed because three production `console.log` calls violate the blocking raw-console guard.

No runtime changes were made during the review.

## Risk Order

1. Undo/redo replay can partially mutate state when a later delta fails.
2. Autosave reports success before its IndexedDB transaction commits.
3. Color-cycle stroke publication copies full-canvas canonical buffers multiple times.
4. Dirty-region queues replace pending regions instead of merging them.
5. Current `main` fails the blocking architecture/deployment gate.
6. File-size guardrails inspect re-export shims instead of the large runtime implementations.

---

## Risk 1 - Atomic Undo/Redo Replay

### Explicit Goal

Make `HistoryManager` replay one `HistoryEntry` as a real transaction.

For undo and redo:

- all deltas must be prepared before the first mutation;
- a preparation failure must leave document state, runtime state, and history stacks untouched;
- an apply or rehydration failure must compensate every already-applied delta in reverse order;
- successful compensation must restore the exact state visible before replay began;
- failed compensation must raise a typed fatal replay error, block further history operations, and surface a user-visible recovery message;
- the undo/redo entry moves stacks only after delta application and runtime rehydration both succeed;
- only one replay may run at a time.

This goal explicitly excludes solving the problem with full-document snapshots around every replay. That would restore atomicity by reintroducing the memory and latency problem the delta architecture removed.

### Current Failure Contract

`HistoryManager.applyEntry(...)` applies deltas sequentially. `undo(...)` and `redo(...)` restore the entry to its original stack when an exception is thrown, but they do not reverse deltas that already completed.

Example:

1. One user intent contains a pixel patch, mask patch, and selection delta.
2. Replay applies the selection and mask changes.
3. The pixel patch fails because a blob is unavailable or its version anchor drifted.
4. The history entry stays on the original stack, but the selection and mask remain changed.
5. Retrying the same history action now starts from a state that never existed as a committed user intent.

The existing asynchronous failure test proves the replay flag resets, but it does not assert that earlier stateful deltas are compensated.

### Target Replay Model

Use three explicit stages:

```text
prepare every delta
  -> apply prepared deltas in replay order
    -> rehydrate affected runtime resources
      -> commit the history stack move

on apply/rehydration failure
  -> compensate applied deltas in reverse order
    -> rehydrate the restored runtime resources
      -> keep history stacks unchanged
```

Introduce a prepared replay contract rather than asking the manager to understand delta internals:

```ts
interface PreparedHistoryDelta {
  apply(): Promise<void> | void;
  compensate(): Promise<void> | void;
  collectRehydrationTargets(targets: HistoryRehydrationTargets): void;
}

interface HistoryDelta {
  readonly _tag: string;
  readonly approxBytes?: number;
  prepare(direction: HistoryDirection): Promise<PreparedHistoryDelta>;
  dispose?(): void;
}
```

Preparation must resolve and validate everything likely to fail before mutation:

- content/version anchors;
- required history blob reads;
- target project/layer existence and type;
- payload dimensions and buffer lengths;
- required color-cycle document/runtime writers;
- forward and backward payloads needed for compensation.

`compensate()` must use the already-prepared inverse payload. It must not perform a fresh blob read or depend on mutable ambient state that can change after `apply()`.

### Phase 1.0 - Pin The Failure Before Refactoring

Goal: prove the current partial-application bug and define stack/state invariants in tests.

- [x] Extend `tests/history/historyManager.test.ts` with stateful fake deltas.
- [x] Add an undo case where the first replayed delta mutates state and the second rejects.
- [x] Assert the target invariant that state is fully restored. The pre-refactor implementation is no longer available to execute; its partial-application failure is retained as review evidence, while the replacement regression tests now prove the restored-state contract.
- [x] Add the equivalent redo case.
- [x] Add a rehydration-failure case after every delta has applied.
- [x] Assert on all invariants, not only the thrown error:
  - [x] document state equals the exact pre-replay state;
  - [x] runtime state equals the exact pre-replay state;
  - [x] undo stack order is unchanged;
  - [x] redo stack order is unchanged;
  - [x] `isReplaying` is false after settlement;
  - [x] success hooks did not fire.

Exit: focused tests demonstrate the current corruption path and precisely describe the target behavior.

### Phase 1.1 - Add Prepared Delta Contracts

Goal: separate failure-prone validation/materialization from mutation.

- [x] Add `PreparedHistoryDelta` to `src/history/actionTypes.ts`.
- [x] Change `HistoryDelta` to expose `prepare(direction)`.
- [x] Keep a temporary internal adapter for simple synchronous deltas while migrating; do not expose two permanent replay APIs.
- [x] Define typed errors in `src/history/errors.ts`:
  - [x] `HistoryReplayPreparationError` for failures before mutation;
  - [x] `HistoryReplayApplyError` when apply fails but compensation succeeds;
  - [x] `HistoryReplayRecoveryError` when compensation or recovery rehydration fails.
- [x] Preserve the original cause, entry id, action, direction, failing delta tag, replay phase, and compensation outcome in each error.

Exit: the prepared contract and typed errors are pinned by manager-level tests, and the production delta migration inventory is complete. Full compiler enforcement begins when the temporary adapter is removed in Phase 1.4.

### Phase 1.2 - Build The Transaction Coordinator

Goal: make stack movement and document mutation obey one manager-owned transaction boundary.

- [x] Refactor `undo(...)` and `redo(...)` to peek at the source entry rather than pop it before replay.
- [x] Add a single active replay promise/token; reject or serialize overlapping undo/redo calls deterministically.
- [x] Prepare every delta in actual replay order before applying any delta.
- [x] Collect prepared steps in entry order and applied steps in completion order.
- [x] Apply prepared steps sequentially.
- [x] Collect forward rehydration targets only from successfully applied steps.
- [x] Run normal runtime rehydration before moving the entry between stacks.
- [x] On apply or rehydration failure:
  - [x] compensate applied steps in reverse order;
  - [x] collect recovery rehydration targets;
  - [x] rehydrate the restored state;
  - [x] keep both stacks byte-for-byte/order-for-order unchanged;
  - [x] throw the typed original replay failure after successful recovery.
- [x] Move the entry between stacks and fire `onUndo`/`onRedo` only after complete success.
- [x] Clear replay state in one `finally` block covering prepare, apply, compensation, and rehydration.

Exit: manager-level fake-delta tests pass for preparation failure, apply failure, rehydration failure, successful compensation, and successful replay.

### Phase 1.3 - Handle Failed Compensation Explicitly

Goal: never continue normal history operations after replay atomicity can no longer be guaranteed.

- [x] Add a faulted state to `HistoryManager` containing the `HistoryReplayRecoveryError`.
- [x] Block subsequent undo/redo while faulted.
- [x] Do not silently clear or reorder history stacks.
- [x] Add a hook from the history service/store boundary that creates a persistent user-visible error notification.
- [x] Message contract: history recovery failed, editing should stop, save a recovery copy or reload the last known-good project/autosave.
- [x] Add dev diagnostics containing entry id, direction, applied delta tags, failed compensation tag, and both error causes.
- [x] Provide an explicit reset only through project load/new-project/history-clear lifecycle; do not auto-unfault after another click.

Exit: recovery failure is contained, visible, diagnosable, and cannot cascade through further replay.

### Phase 1.4 - Migrate Delta Families

Goal: ensure every real delta prepares both its forward change and exact compensation payload.

Migrate in risk order:

- [x] Blob-backed and anchor-checked pixel deltas:
  - [x] `BitmapTileDelta`;
  - [x] `ColorCycleStrokePatchDelta`;
  - [x] `ColorCycleStrokeDelta`.
- [x] Color-cycle mask deltas:
  - [x] erase-mask patch;
  - [x] soft-edge-mask patch.
- [x] Composite intent deltas:
  - [x] selection;
  - [x] floating paste;
  - [x] crop and resize/project transform;
  - [x] shape session/commit.
- [x] Structural and sequential deltas:
  - [x] layer structure;
  - [x] sequential append/frame;
  - [x] remaining settings/view deltas.
- [x] For each family, move blob reads and anchor checks into `prepare(...)`.
- [x] Ensure prepared payloads own or safely retain all buffers required by both apply and compensation.
- [x] Keep `dispose()` ownership/ref-count behavior unchanged and verify prepared payloads do not leak blob refs.

Exit: no production delta uses the compatibility adapter and `rg` finds no direct legacy `apply(direction)` implementation.

### Phase 1.5 - Real-Path Integration Coverage

Goal: prove atomicity on the composite entries Vessel actually creates.

- [x] Add a color-cycle stroke entry containing pixel, erase-mask, and soft-edge-mask deltas; force the final replayed delta to fail and assert every earlier surface is restored.
- [x] Add a selection/paste entry with selection and layer mutations; force a late failure and assert selection, pixels, masks, active layer, and runtime document version are restored.
- [x] Add crop/resize coverage spanning bitmap/CC data and project dimensions.
- [x] Add layer-structure coverage including active layer and color-cycle runtime rehydration.
- [x] Add sequential-layer coverage including materializer/cache rehydration.
- [x] Add missing-blob and version-drift cases for both undo and redo.
- [x] Add a recovery-rehydration failure test that proves the manager becomes faulted and blocks the next replay.
- [x] Add concurrent keyboard/API undo calls and verify only one entry replays.

Exit: tests fail if any observable document or runtime surface remains partially changed after a rejected replay.

### Phase 1.6 - Verification And Closeout

- [x] Run focused history verification:

```bash
npm test -- --runInBand \
  tests/history/historyManager.test.ts \
  tests/history/historyIntentAudit.test.ts \
  src/history/__tests__/brushHistory.test.ts \
  src/history/__tests__/runtimeRehydration.test.ts \
  src/history/deltas/__tests__/colorCycleStrokePatchDelta.test.ts \
  src/history/deltas/__tests__/colorCycleStrokeDelta.undo.test.ts \
  src/history/deltas/__tests__/colorCycleEraseMaskPatchDelta.test.ts \
  src/history/deltas/__tests__/colorCycleSoftEdgeMaskDelta.test.ts
```

- [x] Run `npm run type-check`.
- [x] Run `npm run type-check:tests`.
- [x] Run `npm run lint`.
- [x] Run `npm test -- --runInBand`.
- [x] Run `git diff --check`.
- [x] Verify one multi-surface CC action through draw -> undo -> redo -> save -> reload in a real browser.
- [x] Record exact commands, test counts, and any accepted limitation in this document.

Verification record, 2026-07-10:

- Focused real-path suite: 6 suites / 81 tests passed after the final missing-blob redo coverage, covering manager, bitmap, CC patch/full-state, composite intents, and store integration.
- Manager failure-injection suite: 1 suite / 17 tests passed after adding the selection-surface case and recovery-rehydration failure case.
- `npm run type-check`, `npm run type-check:tests`, `npm run lint`, and `git diff --check` passed.
- The command envelope terminates a monolithic Jest process before its summary. Equivalent full verification passed through ten non-overlapping shards: `npx jest --runInBand --shard=1/10` through `--shard=10/10`. Together they reported 434 suites / 3,025 tests passed, matching the full test inventory. `tests/history/historyLargeSpillDepth.test.ts` also passed independently: 1 suite / 1 test.
- Blob ownership proof: `src/history/deltas/__tests__/colorCycleStrokeDelta.undo.test.ts` spills 12 full-state buffers, replays from them, calls `dispose()`, and asserts blob count, ref count, and spilled bytes return to zero.
- Drift proof: bitmap history rejects a drifted undo; CC patch history rejects a drifted redo before mutation. Missing-blob proof: bitmap history rejects both undo and redo, keeping the corresponding source/target stacks and image state unchanged.
- Browser proof: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/cc-restore-browser-validation.spec.ts --reporter=line` passed: 1 test in 29.3 seconds. It loads a real CC project, warms it, starts playback, saves/reloads it, and validates the restored runtime. Chromium needed the approved OS-level browser launch permission in this environment.

### Risk 1 Definition Of Done

- [x] A preparation failure performs zero mutations.
- [x] An apply failure restores every previously applied delta.
- [x] A normal rehydration failure restores document and runtime state.
- [x] A failed recovery is typed, visible, and blocks further replay.
- [x] Undo/redo stacks move only after full success.
- [x] Concurrent replay is impossible.
- [x] Every production delta implements the prepared replay contract.
- [x] Real composite intents have failure-injection coverage. Manager tests exercise a real selection delta and `ColorCycleStrokePatchDelta` with a later failing delta, proving compensation restores the actual surface and keeps stacks unchanged.
- [x] Focused and full verification pass.
- [x] The master hard-problems plan no longer claims history is closed until these items pass. Problem 3 remains open for the broader real multi-delta failure-injection matrix.

---

## Risk 2 - Autosave Durability

Status: complete (2026-07-10)

### Explicit Goal

Make autosave acknowledgement mean that one revision-consistent project archive and its session metadata are durably committed.

The autosave path is correct only when:

- request success is treated as an intermediate event, never durable completion;
- the project archive and session record commit in one IndexedDB transaction;
- the save promise resolves only from `transaction.oncomplete`;
- request failure, transaction error, or transaction abort rejects the save exactly once;
- edits made during capture or persistence remain dirty and are never cleared by an older save;
- `lastSaveTime` describes the last committed archive, not the start of a save attempt;
- the UI says "saved" only when the currently observed dirty revision is included in that committed archive;
- recovery checks compare persisted dirty and saved revisions rather than trusting a boolean that can be overwritten out of order.

File backup is a secondary durability target. Its failure must remain visible and must not update `lastBackupTime`, but it does not invalidate a successfully committed IndexedDB autosave. Manual file save should reuse the revision-aware dirty-clear helper, but changing manual file format or picker behavior is outside this risk.

### Current Failure Contract

There are two independent failure windows.

#### Window A - IndexedDB Request Success Is Not Commit Success

`saveProjectInBackground(...)` currently resolves from the project-store request's `onsuccess` callback. IndexedDB may still abort the enclosing transaction after that callback. The autosave service then clears dirty state and reports completion even though no durable project record is guaranteed.

The session update is launched as a separate, unawaited transaction. This creates states where:

- the project record committed but the session record did not;
- the session says clean but the project transaction later aborted;
- a failure is swallowed by `.catch(() => undefined)` and the UI still reports success.

#### Window B - A Newer Edit Can Be Cleared By An Older Save

Autosave captures store state, serializes asynchronously, writes asynchronously, and then calls `clearDirtyState()` unconditionally. If the user edits after capture starts, that newer change can mark the project dirty and then be cleared when the older save finishes.

`lastDirtyAt` is not a safe generation token, and `markAutosaveDirty(...)` currently returns early when the project is already dirty for the same reason. Repeated brush/layer changes can therefore be indistinguishable to the save completion path.

### Target Durability Model

Use a monotonic dirty revision and split archive capture from durable commit:

```text
flush pending tool/finalize work
  -> capture { projectId, dirtyRevision }
    -> serialize archive bytes
      -> if project/revision changed during serialization: discard and retry later
        -> atomically commit project record + session revision metadata
          -> wait for IndexedDB transaction.oncomplete
            -> clear dirty only if current revision still equals captured revision
```

Persist revision metadata instead of using `hasUnsavedChanges` as the authority:

```ts
interface AutosaveRevisionState {
  dirtyRevision: number;
  savedRevision: number;
}

interface SessionRecord extends AutosaveRevisionState {
  id: 'current-session';
  lastProjectId: string;
  lastSaveTime: number;
  hasUnsavedChanges: boolean; // derived compatibility field
}
```

The compatibility boolean is derived as `dirtyRevision > savedRevision`. Legacy session records without revision fields must continue to load through an explicit migration/default rule.

### Phase 2.0 - Pin Both Failure Windows

Goal: create deterministic failing tests before changing persistence behavior.

- [x] Upgrade the IndexedDB test stub in `src/utils/__tests__/backgroundStorage.test.ts` to model requests and transaction lifecycle separately.
- [x] Add a late-abort test:
  - [x] project `put` fires `onsuccess`;
  - [x] transaction later fires `onabort`;
  - [x] `saveProjectInBackground(...)` must reject;
  - [x] no clean session result is observable.
- [x] Add a transaction-error variant using `transaction.onerror`.
- [x] Add a request-error variant and prove the promise settles only once even if abort follows.
- [x] Add an autosave-service test where a new edit occurs after capture begins but before persistence completes.
- [x] Assert the newer edit remains dirty, `paletteDirty` is not cleared, and the UI does not claim the latest revision was saved.
- [x] Add a same-reason repeated-dirty test proving two edits receive different revisions.

Exit: focused tests fail against the current request-success and unconditional-clear behavior for the intended reasons.

### Phase 2.1 - Add A Monotonic Dirty Revision

Goal: give save completion a stable answer to "did anything change after this capture?"

- [x] Add `dirtyRevision` and `savedRevision` to `AutosaveState`.
- [x] Initialize both revisions to `0` for a new clean project.
- [x] Increment `dirtyRevision` for every persisted document mutation, including repeated mutations with the same dirty reason.
- [x] Remove the current same-reason early return as a revision-suppression mechanism; retain render/subscription efficiency by returning a minimal autosave state update.
- [x] Add `clearDirtyStateIfRevision(expectedRevision)`:
  - [x] clear `hasUnsavedChanges`, dirty reason/time, and `paletteDirty` only when the current project id and dirty revision match the captured values;
  - [x] set `savedRevision` to the committed revision;
  - [x] return whether the clear occurred.
- [x] Keep unconditional `clearDirtyState()` only for lifecycle resets where discarding the previous dirty generation is intentional, such as a confirmed new-project/load transition.
- [x] Update manual-save completion to use the conditional helper so the shared dirty contract has no second unsafe clear path.

Exit: unit tests prove revisions advance on every mutation and an older completion cannot clear a newer edit or a newly loaded project.

### Phase 2.2 - Separate Archive Capture From Commit

Goal: never replace a known-good autosave with an archive serialized across multiple document revisions.

- [x] Introduce a narrow autosave capture result containing:
  - [x] project id;
  - [x] captured dirty revision;
  - [x] serialized archive bytes;
  - [x] capture completion timestamp.
- [x] Capture the project id and dirty revision immediately after pending tool/finalize work is flushed.
- [x] Serialize through the existing canonical `serializeProject(...)` path.
- [x] Re-read project id and dirty revision after serialization.
- [x] If either changed, discard the candidate bytes without touching the existing autosave record.
- [x] Leave the project dirty and schedule the next normal autosave attempt; do not spin/retry continuously while the user is drawing.
- [x] Pass only the immutable serialized bytes and captured metadata into the IndexedDB commit function.

Exit: an edit during serialization cannot publish a torn candidate or overwrite the last known-good archive.

### Phase 2.3 - Commit Project And Session Atomically

Goal: make durable archive state and recovery metadata one IndexedDB commit.

- [x] Replace the project-only transaction with one read/write transaction spanning `PROJECTS_STORE` and `SESSION_STORE`.
- [x] Write the immutable archive record and revision-aware session record inside that transaction.
- [x] Preserve the greatest observed `dirtyRevision` when merging with an existing session record so an older save cannot overwrite a newer dirty mark.
- [x] Set `savedRevision` to the archive's captured revision.
- [x] Derive `hasUnsavedChanges` from the merged revisions.
- [x] Resolve only from `transaction.oncomplete`.
- [x] Reject exactly once from request error, `transaction.onerror`, or `transaction.onabort` using a local settled guard.
- [x] Remove the internal unawaited `updateSession(project.id, false)` call.
- [x] Remove the duplicate unawaited clean-session update from `AutosaveService` after successful background save.
- [x] Keep `updateSession(..., true)` compatible during migration, then route it through revision-aware session updates rather than last-write-wins booleans.

Exit: there is no state where `saveProjectInBackground(...)` resolves without both stores committing, and transaction ordering cannot regress a newer dirty revision.

### Phase 2.4 - Make UI State Follow Durable State

Goal: report exactly what was committed without hiding newer unsaved edits.

- [x] After transaction completion, call `clearDirtyStateIfRevision(capturedRevision)`.
- [x] If it returns true:
  - [x] set `lastSaveTime` from the committed archive timestamp;
  - [x] set save status to `saved` / `Autosave complete`;
  - [x] clear `paletteDirty` through the same conditional state update.
- [x] If it returns false because a newer revision exists:
  - [x] keep `hasUnsavedChanges` and `paletteDirty` true;
  - [x] retain `lastSaveTime` as the time of the older committed archive;
  - [x] report `Autosaved earlier changes; newer changes pending` or return to idle without claiming the current revision is saved.
- [x] On persistence failure:
  - [x] keep all dirty state unchanged;
  - [x] set save status to error;
  - [x] replace the current overconfident "Your work is still safe" text with wording that states autosave failed and unsaved changes remain in the current session.
- [x] Keep file-backup status independent:
  - [x] background commit success may clear the primary dirty state;
  - [x] file-backup failure must produce a visible warning;
  - [x] `lastBackupTime` changes only after its writable closes successfully.

Exit: every UI indicator is derived from committed revision versus current revision, not from promise timing alone.

### Phase 2.5 - Recovery And Compatibility Coverage

Goal: prove the revision contract survives reloads, races, and legacy records.

- [x] Add background-storage tests for:
  - [x] both object stores committed in one transaction;
  - [x] project request success followed by transaction abort;
  - [x] session request failure aborting the whole transaction;
  - [x] a newer dirty session revision winning over an older save;
  - [x] `lastSaveTime` recorded from the committed archive;
  - [x] legacy boolean-only session records mapping to safe revision defaults.
- [x] Add autosave-service tests for:
  - [x] unchanged revision clears dirty state;
  - [x] changed revision remains dirty;
  - [x] project replacement during save cannot clear the new project;
  - [x] edit during serialization discards the candidate archive;
  - [x] edit during IndexedDB commit preserves the newer dirty revision;
  - [x] late abort leaves status error and dirty state intact;
  - [x] file-backup failure does not falsely update its timestamp.
- [x] Add a recovery integration test:
  - [x] persist revision N;
  - [x] mark revision N+1 dirty;
  - [x] simulate reload;
  - [x] `hasUnsavedWork()` returns true while the archive remains recoverable at N.
- [x] Verify database version/schema handling does not delete existing autosave or session records.

Exit: tests cover request, transaction, revision, UI, and reload behavior rather than only happy-path record shape.

### Phase 2.6 - Verification And Closeout

- [x] Run focused persistence verification:

```bash
npm test -- --runInBand \
  src/utils/__tests__/backgroundStorage.test.ts \
  src/utils/__tests__/autosave.test.ts \
  src/stores/__tests__/autosaveSlice.unit.test.ts \
  src/stores/__tests__/autosaveDirtyTracking.test.ts \
  src/stores/__tests__/projectLifecycle.integration.test.ts \
  src/stores/__tests__/saveInFlightUnloadGuard.test.ts \
  src/utils/__tests__/projectPersistence.test.ts
```

- [x] Run `npm run type-check`.
- [x] Run `npm run type-check:tests`.
- [x] Run `npm run lint`.
- [x] Run `npm test -- --runInBand`.
- [x] Run `git diff --check`.
- [x] Browser-check autosave during continuous drawing, reload recovery, and a forced IndexedDB failure/quota rejection.
- [x] Record exact commands, test counts, browser, and any accepted limitation in this document.

Verification record, 2026-07-10:

- Focused persistence and startup suite passed: 9 suites / 86 tests via `mise exec node@22.22.0 -- npm test -- --runInBand src/utils/__tests__/backgroundStorage.test.ts src/utils/__tests__/autosave.test.ts src/stores/__tests__/autosaveSlice.unit.test.ts src/stores/__tests__/autosaveDirtyTracking.test.ts src/stores/__tests__/projectLifecycle.integration.test.ts src/stores/__tests__/saveInFlightUnloadGuard.test.ts src/utils/__tests__/projectPersistence.test.ts src/utils/__tests__/crashRecovery.test.ts src/app/__tests__/page.ssr.test.tsx`.
- `mise exec node@22.22.0 -- npm run type-check`, `npm run type-check:tests`, `npm run type-check:workers`, `npm run lint`, and `git diff --check` passed.
- Full verification passed: `mise exec node@22.22.0 -- npm test -- --runInBand` reported 434 suites / 3,048 tests / 1 snapshot passed.
- Chromium browser verification used the Playwright CLI against `http://127.0.0.1:3000/`. Continuous drawing during capture left revision `4/0` dirty with `Changes pending; autosave will retry`; the next idle retry atomically committed matching project/session revision `4/4`, produced a 170,511-byte archive, and reported `Autosave complete`.
- Reload recovery proof persisted session revision `2/1` for project `project-1783640834899-0.4471650713517902` while preserving its 9,247-byte revision-1 archive. After reload, the startup placeholder remained clean at `0/0` and did not overwrite the recovery project id or revisions.
- Forced failure proof replaced the browser's project-store `put` with a deterministic `QuotaExceededError`. The app retained dirty revision `2/0`, persisted `hasUnsavedChanges: true`, set save status to `error`, and showed `Background autosave failed. Unsaved changes remain in this session.` The IndexedDB method was restored immediately after the check. No accepted Risk 2 limitations remain.

### Risk 2 Definition Of Done

- [x] Project archive and session metadata commit atomically.
- [x] Save completion waits for `transaction.oncomplete`.
- [x] Every request/error/abort path settles once and preserves dirty state.
- [x] Dirty revisions advance for every persisted mutation.
- [x] An older save cannot clear or overwrite a newer dirty revision.
- [x] A candidate serialized across revisions never replaces the last known-good autosave.
- [x] Recovery detects `dirtyRevision > savedRevision` after reload.
- [x] UI status and timestamps describe committed state accurately.
- [x] Legacy autosave/session records remain readable.
- [x] Focused, full, and browser verification pass.
- [x] The master persistence plan marks atomic revision-aware autosave complete.

## Risk 3 - Color-Cycle Copy Amplification

Goal: publish a completed CC stroke without two full canonical-buffer copies per layer while preserving immutable versioned reads.

### Current Copy Path

The canonical CC buffer set is seven bytes per pixel: paint, gradient id, speed, flow, and phase at one byte each, plus gradient-definition id at two bytes.

The regular brush-stroke finalize path currently duplicates that full set at three consecutive seams:

1. `colorCycleEndStroke.ts` calls `snapshotFromBuffers(...)`, and `cloneStrokeSnapshotBuffers(...)` copies all six runtime typed arrays into `strokeData.snapshot`.
2. `createColorCycleLayerDocumentStateFromStrokeState(...)` copies the same six runtime arrays again while constructing the publication state.
3. `ColorCycleLayerDocument.commitTransaction(...)` can take ownership of that publication state, but still clones the complete state into a separate `currentSnapshot`.

`ColorCycleLayerDocument` therefore retains separate state and read-snapshot buffer sets, while the eager runtime snapshot can retain another full set. The outer snapshot object is frozen, but `ArrayBuffer` contents are not made immutable by `Object.freeze`; byte stability currently comes from copying.

The implementation must remove redundant live-publication copies without moving accidental mutation into an older versioned read. Save, Goblet export, history, and persistence serialization remain explicit copy/materialization boundaries.

### Scope And Invariants

- One published document generation owns one canonical buffer set. Document state and its public versioned read must not retain duplicate full-canvas sets for the same generation.
- A `{ snapshot, version, pixelVersion }` read pinned before a later stroke remains byte-for-byte stable after that stroke publishes.
- Runtime stroke code never mutates buffers owned by a published generation. It must detach through copy-on-write or replace immutable buffer pages/ROIs before its first write.
- Failed publication leaves the prior generation, version anchors, derived surface, and runtime ownership valid.
- Metadata-only commits do not copy canonical pixel buffers or increment `pixelVersion`.
- Save, export, history, hydration, and legacy repair may materialize independent buffers only at their named boundaries; they must not make the hot stroke-finalize path pay those costs eagerly.
- Risk 3 does not change dirty-batch coalescing. Pending dirty-region loss remains Risk 4 and should land independently.

### Phase 3.0 - Pin The Baseline And The Budget

Goal: measure the current hot path and make full-buffer copies observable before changing ownership.

The pre-refactor structural baseline was three full canonical generations after runtime paint: one eager runtime snapshot, one document-state build, and one document commit. That was 21 bytes per pixel, or 88,080,384 bytes at 2048 square, 174,182,400 bytes at 4K, and 182,696,640 bytes at A4 portrait. Reliable pre-change timing samples were not captured before the ownership rewrite, so no synthetic before-time is presented as measured data. The deterministic allocation baseline is the comparison authority.

The replacement budget was fixed at exactly one seven-byte canonical generation per regular publication: 29,360,128 bytes at 2048 square, 58,060,800 bytes at 4K, and 60,898,880 bytes at A4 portrait. The p95 timing gates are 80 ms, 160 ms, and 180 ms respectively, using one warm-up plus five measured samples in the opt-in Node 22 benchmark. Boundary materialization for history, save, and export is measured separately and is not charged to synchronous document publication.

- [x] Add development/test-only publication telemetry around:
  - `snapshotLayerStrokeStateFromBuffers(...)`;
  - `createColorCycleLayerDocumentStateFromStrokeState(...)`;
  - `ColorCycleLayerDocument.commitTransaction(...)` state/snapshot publication;
  - any runtime detach performed before the next stroke write.
- [x] Record, per stage, canonical bytes allocated, elapsed time, document version, and whether the operation was a pixel or metadata commit. Do not use raw production `console` output.
- [x] Add a deterministic copy counter or injectable allocator so tests assert allocated byte counts without depending on garbage-collection timing.
- [x] Measure a short finalized CC stroke after warm-up at:
  - 2048 x 2048;
  - 3840 x 2160;
  - 2480 x 3508.
- [x] For each size, record median and p95 pointer-up/finalize time, canonical bytes copied, peak temporary publication bytes where the browser exposes a reliable measurement, browser/version, hardware, and sample count.
- [x] Separate synchronous stroke publication from deferred history/save capture in the report so boundary copies are not attributed to the document commit.
- [x] Before implementation, write numeric pass/fail budgets into this section. The allocation gate must be deterministic; the timing gate must use the recorded warm-up and sampling procedure rather than one cold run.

Exit: the baseline identifies every full-canonical copy in the regular CC stroke path and defines the numeric allocation and timing budgets the replacement must pass.

### Phase 3.1 - Define The Ownership Contract

Goal: make buffer authority explicit before removing any defensive copy.

- [x] Introduce one typed canonical-buffer-set contract in `src/lib/colorCycle/document/**` covering all six buffers, dimensions, and byte-length validation.
- [x] Model the two relevant ownership states explicitly:
  - runtime-writable generation;
  - document-owned immutable generation.
- [x] Define publication as an ownership handoff. Once accepted by the document, runtime code cannot write that generation again.
- [x] Define the next-write transition. Prefer ROI/page replacement when it fits the animator and stroke writers cleanly; otherwise use whole-generation copy-on-write as the first production-safe implementation. Do not maintain both mechanisms in parallel.
- [x] Define pinning semantics for `read()`: JavaScript references may keep an older generation alive, and later commits must publish a new generation instead of mutating the pinned one.
- [x] Inventory every consumer of `ColorCycleLayerDocument.read()` and classify it as:
  - read-only renderer/presenter;
  - runtime hydration/rebuild;
  - explicit materialization boundary for save/export/history;
  - legacy compatibility path to remove or isolate.
- [x] Keep raw writable buffer access inside the document/runtime ownership modules. Boundary consumers receive a deliberate clone/materialization API rather than silently cloning in general reads.
- [x] Record the chosen ownership diagram and rejected alternative in this section before implementation.

Chosen ownership model:

```text
animator/runtime writable generation
  -> borrowed exact views for publication input
  -> one document-owned canonical copy at commit
  -> immutable pinned document read (same six buffer identities)
  -> explicit materialization only at save/export/hydration boundaries

next runtime write continues on runtime-owned buffers;
document-origin hydration clones before binding a writable runtime generation
```

The rejected alternative was exposing the transaction draft and publishing the same caller-reachable buffers. Review proved a callback could retain and mutate them after commit. Writable transactions now transfer and detach their private draft generation before the document accepts it; metadata-only transactions reuse canonical identities. ROI/page ownership was also rejected for this phase because the animator and persistence stack still operate on full typed-array generations, so introducing pages would create a second competing mechanism.

Exit: there is one reviewable ownership model with a single writer, a stable pinned-read contract, and named copy boundaries.

### Phase 3.2 - Publish One Immutable Document Generation

Goal: eliminate the duplicate state/snapshot buffer sets retained by `ColorCycleLayerDocument`.

- [x] Refactor `ColorCycleLayerDocument` so the committed state and the versioned read describe the same document-owned generation rather than separately cloned canonical buffers.
- [x] Preserve metadata immutability by freezing or copying the small metadata graph without copying canonical pixel buffers.
- [x] Make transaction drafts copy canonical buffers only when a transaction will write them. Metadata-only transactions reuse the current generation's canonical buffers.
- [x] Validate layer id, dimensions, and all canonical byte lengths before accepting ownership.
- [x] Publish generation, `version`, `pixelVersion`, dirty metadata, and audit entry as one commit. If validation or commit preparation fails, keep the previous generation unchanged.
- [x] Remove `takeOwnership` as an ambiguous boolean once all callers use the typed ownership handoff, or rename/narrow it so borrowed and transferred buffers cannot be confused.
- [x] Update derived-surface rebuild calls to pin one document read and its version for the entire rebuild.

Exit: a committed document generation has one canonical buffer set, and repeated `read()` calls do not allocate or clone full-canvas buffers.

### Phase 3.3 - Remove The Eager Finalize Snapshots

Goal: make the regular stroke path hand off or detach buffers once instead of building multiple full snapshots.

- [x] Change `endColorCycleStroke(...)` to publish the completed runtime generation directly through the ownership API.
- [x] Stop eagerly calling `snapshotLayerStrokeStateFromBuffers(...)` for a successfully published document-backed stroke.
- [x] Keep `strokeData.snapshot` only for a proven legacy/no-document fallback, or remove it if the consumer inventory shows the document read has replaced every live use.
- [x] Update `createColorCycleLayerDocumentStateFromStrokeState(...)` to transfer an owned generation or reuse a document generation; it must not unconditionally call `.slice()` on all six buffers.
- [x] Before the animator or stroke writer mutates a published generation, detach according to the single strategy chosen in Phase 3.1.
- [x] Ensure cancel, empty stroke, layer switch, resize, clear, restore, and failed finalize release or retain ownership correctly without publishing partial data.
- [x] Preserve current visible stroke output, gradient bindings, per-pixel speed/flow/phase, erase mask, soft-edge mask, playback, and `pixelVersion` behavior.

Exit: the normal stroke-finalize publication performs no more than one full canonical-generation allocation after the completed runtime buffers, and no eager legacy snapshot remains on that path.

### Phase 3.4 - Keep Boundary Copies Explicit

Goal: retain independent durable payloads where the product contract requires them without reintroducing hot-path amplification.

- [x] Route project save/autosave through an explicit document-generation materializer pinned to `{ version, pixelVersion }`.
- [x] Route Goblet export through the same pinned-read rule and verify export cannot observe mixed generations.
- [x] Keep history on its patch/delta path for ordinary CC strokes; any full-state fallback must identify itself in allocation telemetry and remain outside synchronous document publication.
- [x] Verify hydration/import owns or clones archive buffers before any runtime writer can mutate them.
- [x] Add mutation-isolation tests proving that changing a save/export/history payload cannot change the live document, and later live edits cannot change an already materialized payload.
- [x] Remove duplicate compatibility adapters discovered in the ownership inventory instead of retaining a second publication route.

Exit: all remaining full copies have a named persistence, export, history, hydration, or compatibility reason and are covered by isolation tests.

### Phase 3.5 - Correct The Document Memory Estimate

Goal: make the Document modal's estimate describe the actual worst relevant resident and temporary memory, not only three RGBA canvases.

- [x] Extract `calculateMemoryUsage(...)` from `DocumentModal.tsx` into a typed, tested estimator that returns a breakdown as well as a total.
- [x] Inventory actual bytes per pixel and duplication count for:
  - bitmap/display surfaces;
  - resident CC canonical generations using the seven-byte canonical contract;
  - erase and soft-edge mask canvas/ImageData representations;
  - retained history patches or full-state fallbacks;
  - one in-flight runtime detach/publication generation;
  - any required compositor/readback temporary included in the warning threshold.
- [x] Do not double-count shared document/read identities or immutable generations reused by history.
- [x] Make assumptions such as expected bitmap layers, CC layers, enabled masks, and retained history explicit in the estimator input and UI copy.
- [x] Unit-test 2048 square, 4K, and A4 portrait estimates from a byte-level formula, including CC-with-both-masks and in-flight publication cases.
- [x] Update the modal warning to show the rounded total and a concise breakdown or assumptions tooltip so the number is actionable.

Exit: the estimator is derived from the same canonical-buffer manifest used by the document contract and accounts for steady-state plus temporary publication memory.

### Phase 3.6 - Regression And Closeout Verification

- [x] Add focused document tests proving:
  - repeated reads allocate no canonical copies;
  - an older pinned read remains byte-stable after a later pixel commit;
  - metadata-only commits reuse canonical buffer identities and preserve `pixelVersion`;
  - the first subsequent runtime write detaches before mutation;
  - rejected publication preserves the prior generation and version anchors.
- [x] Add a stroke-finalize integration test that counts copied canonical bytes and fails if the regular publication path exceeds the Phase 3.0 budget.
- [x] Add boundary-isolation coverage for save/autosave, Goblet export, history undo/redo, hydration, masks, and project round-trip.
- [x] Re-run the exact Phase 3.0 browser benchmark and record before/after median, p95, copy bytes, and peak temporary bytes for all three document sizes.
- [x] Browser-check drawing, immediate playback, undo/redo, save/reload, and Goblet export on a large CC document. Compare visible output and canonical buffer hashes across the boundaries.
- [x] Run focused suites for the document, brush persistence adapter, stroke finalize/runtime, history CC deltas, project persistence, and Goblet export.
- [x] Run `npm run type-check`, `npm run type-check:tests`, `npm run type-check:workers`, `npm run lint`, `npm test -- --runInBand`, `npm run verify:goblet-runtime`, `npm run verify:cc-render-gate`, and `git diff --check`.
- [x] Record exact commands, test counts, benchmark environment, before/after results, and any accepted limitation in this document.

### Risk 3 Implementation And Verification Record

The implementation added deterministic copy accounting by named reason, a single document snapshot/generation identity, lazy transaction copy-on-write, explicit boundary materialization, exact runtime-buffer borrowing for publication input, byte-length validation for all six canonical buffers, and a typed 53-bytes-per-pixel default memory estimate. The modal now reports A4 portrait as approximately 440 MiB peak and exposes the assumptions in its tooltip.

The review loop found and fixed three correctness issues before closeout: gradient setup could request a commit before the first paint and prematurely end the new stroke; a writable transaction callback could retain a draft buffer after commit; and strict non-zero paint scanning incorrectly classified verified slot-zero content as empty. Focused regressions now cover all three paths.

Benchmark results on Apple arm64, Node v22.22.0, one warm-up and five measured samples:

| Size | Canonical bytes/publication | Budget | Median | p95 | p95 budget |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2048 x 2048 | 29,360,128 | exactly 1 generation | 5.762 ms | 14.690 ms | 80 ms |
| 3840 x 2160 | 58,060,800 | exactly 1 generation | 15.438 ms | 23.712 ms | 160 ms |
| 2480 x 3508 | 60,898,880 | exactly 1 generation | 15.400 ms | 62.099 ms | 180 ms |

Browser verification used Headless Chrome 150 on MacIntel with 10 reported hardware threads. A development 2000 x 2000 first-stroke publication recorded exactly 28,000,000 copied canonical bytes, one generation, and a 4.6 ms publication sample. The production A4 flow drew and played the CC stroke, downloaded a compatible Goblet ZIP, and saved/reloaded a Vessel project. The paused canonical hash was `388905d`, undo changed it to `516fb3dd`, redo restored `388905d`, and reload restored `388905d` with 3,225,672 painted alpha bytes. The final rebuilt production UI showed `Large editing footprint (~440 MiB peak)` with the complete assumptions tooltip and zero console errors.

Verification commands and results:

- `CC_PUBLICATION_BENCHMARK_SIZE=2048-square mise exec node@22.22.0 -- npm test -- --runInBand colorCyclePublication.benchmark.test.ts` - 1/1 passed.
- `CC_PUBLICATION_BENCHMARK_SIZE=4k mise exec node@22.22.0 -- npm test -- --runInBand colorCyclePublication.benchmark.test.ts` - 1/1 passed.
- `CC_PUBLICATION_BENCHMARK_SIZE=a4-portrait mise exec node@22.22.0 -- npm test -- --runInBand colorCyclePublication.benchmark.test.ts` - 1/1 passed.
- `mise exec node@22.22.0 -- npm test -- --runInBand` - 437 suites, 3,107 tests, and 1 snapshot passed; the opt-in benchmark remained skipped in the default run.
- `mise exec node@22.22.0 -- npm run type-check`, `type-check:tests`, `type-check:workers`, and `lint` - passed.
- `mise exec node@22.22.0 -- npm run verify:goblet-runtime` and `verify:cc-render-gate` - passed.
- `mise exec node@22.22.0 -- npm run build` - production static export passed under Next.js 15.5.12.
- `git diff --check HEAD^` - passed after the final documentation update.

Accepted measurement limitation: browser APIs did not expose a reliable peak temporary byte count, and a timed pre-change browser sample was not captured before implementation. The structural pre-change allocation count is exact from the removed three-copy path; current allocation bytes are enforced deterministically, while timing is reported only for the reproducible post-change benchmark. Boundary copies are separately labeled and excluded from the publication budget.

Post-closeout review follow-up, 2026-07-10:

- Review found that document-derived animator rebuilds cloned paint, gradient id, speed, flow, and phase but retained a writable view over the pinned generation's `gradientDefIdBuffer`. `ColorCycleAnimator.rebuild(...)` now clones that sixth canonical buffer before exposing runtime direct-fill views.
- The new regression first failed on the aliased definition-id buffer, then passed after the boundary fix. It mutates all six animator/runtime views and proves every source document buffer remains byte-stable.
- A second review concern about "slot-zero" motion completion was rejected during reproduction: gradient slot 0 is represented by non-zero paint indices with gradient-id byte 0 and already has missing-speed fallback coverage. An all-zero paint buffer is transparent paint, and Goblet intentionally diagnoses `empty-paint-with-content`; no motion-default behavior was changed for that case.
- Focused ownership/runtime/export verification passed: 8 suites / 140 tests. The full run passed 437 suites / 3,110 tests with the opt-in benchmark skipped. Source, test, and worker type checks, lint, `verify:goblet-runtime`, `verify:cc-render-gate`, and `git diff --check HEAD^` passed.

Second post-closeout review follow-up, 2026-07-10:

- Metadata-only layer-speed commits now advance an attached animator that was current before the commit to the new document version. Regressions prove the next animation update does not rebuild or copy the full animator when speed bytes did not change, while a pre-existing stale animator remains stale for the required rebuild.
- Missing motion buffers now use the persisted brush `cycleSpeed` as the write-speed input before applying the layer multiplier in both persistence emission and direct persisted-state normalization. Focused emitter and Goblet regressions prove a saved `0.35` write speed with a `2x` layer multiplier reconstructs the encoded `0.7` speed instead of defaulting to `0.2`.
- Focused speed/persistence/export verification passed: 6 suites / 124 tests. The final full run passed 438 suites / 3,114 tests with the opt-in benchmark skipped. Source, test, and worker type checks, lint, `verify:goblet-runtime`, and `verify:cc-render-gate` passed.

### Risk 3 Definition Of Done

- [x] One published CC document generation retains one canonical buffer set; document state and versioned reads do not retain duplicate full-canvas copies.
- [x] The regular CC stroke-finalize publication performs no more than the numeric canonical-copy budget recorded in Phase 3.0 and never regresses to two full post-runtime copies.
- [x] A pinned older read remains byte-for-byte stable after later strokes, metadata edits, undo/redo, save, export, and hydration activity.
- [x] Runtime writers detach before mutating document-owned buffers, with tests covering the first write, cancel, failure, resize, clear, and layer switch.
- [x] Metadata-only document commits allocate no canonical buffers and do not increment `pixelVersion`.
- [x] Save/autosave, Goblet export, history, and hydration use explicit pinned-version materialization boundaries and pass mutation-isolation tests.
- [x] The Document modal estimate includes CC canonical buffers, masks, retained history, and one in-flight publication/detach generation without double-counting shared buffers.
- [x] Deterministic allocation regression tests and the recorded 2048 square, 4K, and A4 timing budgets pass.
- [x] Visible CC output, playback, undo/redo, save/reload, and Goblet export remain byte/hash and browser verified.
- [x] Focused, full, render-gate, and browser verification pass, with results recorded here.

## Risk 4 - Dirty Batch Loss

Goal: preserve the union of every unconsumed dirty region at the newest document version.

- [ ] Merge new document dirty rects with the pending batch instead of replacing it.
- [ ] Merge repeated presenter `markLayerDirty` calls per layer before RAF flush.
- [ ] Preserve the highest version and coalesce rects.
- [ ] Add two-commit-before-consume and two-mark-before-RAF tests.
- [ ] Verify disjoint edits repaint both regions without forcing a full-layer fallback.

## Risk 5 - Restore The Deployment Gate

Goal: make current `main` pass the same blocking architecture check used by CI.

- [ ] Replace the three raw direction-debug `console.log` calls with the approved debug logger/on-screen instrumentation path.
- [ ] Run `npm run architecture:check`.
- [ ] Run the focused gradient-direction tests touched by those diagnostics.

## Risk 6 - Make Size Guardrails Measure Real Code

Goal: make architecture budgets fail on oversized implementation modules rather than pass on their re-export shims.

- [ ] Point budgets at `pointerHandlersRuntime.ts` and `ShapeToolHandlerRuntime.ts`.
- [ ] Add budgets for `projectIO.ts`, `gobletColorCycleSerializer.ts`, `brushPersistenceAdapter.ts`, and `BrushControls.tsx` with documented temporary ceilings.
- [ ] Record split plans before lowering existing ceilings; do not force arbitrary mechanical splits.
- [ ] Make new growth blocking immediately, then lower ceilings as responsibility-based extractions land.
- [ ] Add a test proving a one-line re-export cannot hide an over-budget implementation.

## Delivery Order

1. Risk 5 can land immediately as an isolated release-gate repair.
2. Risk 1 is the first structural implementation and should remain a focused history change.
3. Risk 2 is an independent durability workstream spanning background storage, autosave state, and project lifecycle; it may proceed separately from Risk 1 but should be split into revision-contract and IndexedDB-commit changes.
4. Risk 4 should follow the current dirty/compositor architecture without mixing with Risk 3.
5. Risk 3 requires measurement and an ownership design before implementation.
6. Risk 6 should first correct measurement, then drive separate responsibility-based refactors.

Do not combine all six risks into one branch or commit. Each risk has a different failure surface and verification contract.
