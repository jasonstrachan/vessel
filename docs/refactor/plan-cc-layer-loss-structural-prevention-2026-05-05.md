# CC Layer Loss Structural Prevention Plan

Date: 2026-05-05

Status: Phase 2 helper started; cold warmup atomicity patched

## Problem

Color Cycle layer loss is still possible enough that the app cannot be trusted for real work. The current protection is spread across runtime clear diagnostics, persistence guards, history fixes, selection transactions, export checks, and warmup restore behavior. Those fixes are useful, but they still leave the core risk: a populated committed CC layer can be replaced by an empty committed payload through a path that was not explicitly authorized as destructive.

This plan treats CC layer loss as an architecture failure, not as one more call-site bug. The goal is to make accidental CC data destruction structurally difficult, immediately visible, and recoverable.

## Core Invariant

A populated committed Color Cycle payload may only be replaced by an empty committed payload through an explicit, named, user-authorized destructive operation, or by undo/redo to a previously recorded empty canonical state.

Every other committed populated-to-empty replacement must be blocked, logged, and recoverable.

Runtime clears, preview clears, compositor rebuilds, export scratch-buffer resets, and warmup scratch-buffer resets do not need destructive authorization as long as they cannot replace committed canonical CC truth.

## Implementation Spine

This plan is broad, but the implementation must land through a narrow spine:

1. Define canonical payload and summary.
2. Force all canonical CC writes through one guarded helper.
3. Block unauthorized populated-to-empty committed replacements.
4. Split dangerous APIs so runtime clears cannot bypass the canonical helper.
5. Make save/autosave refuse suspicious canonical state.
6. Enforce copy-on-write transaction behavior.
7. Add the recovery vault only after the guard exists.
8. Add presentation/data split diagnostics.
9. Extend the rolling black box.
10. Add the destructive-path fuzzer last.

The named write boundary should be:

```ts
commitCanonicalCcPayload({
  layerId,
  source,
  transactionId,
  before,
  next,
  authorization,
});
```

The core rule is:

```ts
if (before.populated && next.empty && !authorization) {
  block();
  preserveBefore();
  logSuspiciousWrite();
}
```

## Scope

Apply the invariant to every path that can change, serialize, hydrate, export, or present CC layer data:

- write-side capture and stroke/finalize commit,
- runtime buffer clears and snapshot replacement,
- committed layer store sync,
- history undo/redo,
- save and autosave,
- warmup and restore,
- Goblet export,
- selection, marquee, floating paste, and move/cancel/commit,
- layer clear, layer delete, project reset, and project close,
- compositor/presentation refresh paths that can make valid CC data appear blank.

## Non-Goals

- Do not redesign Color Cycle rendering, dithering, playback, gradient semantics, or shape tools unless required to enforce the invariant.
- Do not treat rendered bitmap pixels as canonical CC paint except inside explicit legacy repair flows.
- Do not silently repair by inventing CC metadata from previews.
- Do not remove legitimate destructive actions such as explicit clear layer, delete layer, or undoing the first stroke.
- Do not hide the bug by making every empty state restore from backup. Recovery is an airbag, not the source of truth.

## Architecture Moves

### 1. Immutable Canonical CC Payload

Treat committed CC data as document truth, not as a mutable runtime canvas.

Runtime buffers, preview canvases, selection canvases, export surfaces, warmup buffers, and compositor outputs are disposable views. They may be cleared or rebuilt, but they cannot become canonical truth without going through a verified write boundary.

The write boundary must capture a complete canonical payload:

- paint,
- speed,
- flow,
- phase,
- gradient id,
- gradient def id,
- dimensions,
- layer id,
- content summary,
- stroke or transaction identity where available.

The payload summary must be concrete enough to compare states, not inferred from loose metadata:

```ts
type CcPayloadSummary = {
  width: number;
  height: number;
  paintNonZero: number;
  speedNonZero: number;
  flowNonZero: number;
  phaseNonZero: number;
  hasGradientBinding: boolean;
  hash: string;
};
```

`paintNonZero` is the primary proof of authored CC paint. Motion and gradient fields help classify partial/damaged payloads but must not alone turn a missing paint payload into valid populated paint.

### 2. Destructive Authorization Tokens

Introduce a typed authorization object for committed canonical writes that can replace a populated CC payload with an empty committed payload.

Do not require destructive tokens for runtime-only clears, preview clears, compositor rebuilds, export scratch buffers, or warmup scratch buffers. Those operations are allowed to clear freely, but they must not touch committed canonical state.

Example operation kinds:

```ts
type CcDestructiveOperation =
  | 'user-clear-layer'
  | 'user-delete-layer'
  | 'user-reset-project'
  | 'undo-to-empty'
  | 'redo-to-empty'
  | 'selection-explicit-delete'
  | 'selection-transaction-move-source'
  | 'project-close';
```

The authorization should include:

- operation kind,
- layer id,
- transaction id or history id,
- source module,
- whether the action came from explicit user intent,
- before summary,
- expected after summary.

Any committed populated-to-empty canonical replacement without this authorization must fail closed.

### 3. Copy-On-Write Transactions

Selection, export, warmup, save, and history paths should operate on copies first. They should only swap into committed state after the replacement CC payload is verified.

This is especially important for:

- extract selection to floating paste,
- cancel floating paste,
- commit floating paste,
- Goblet export serialization,
- save/autosave during an active transaction,
- warm restore from cold archive state.

Mid-transaction empty source states must not become serializable document truth.

### 4. Dangerous API Split

Replace generic clear/replace APIs with names that make authority explicit.

Examples:

```ts
clearRuntimePreviewOnly(...)
replaceRuntimeSurfaceFromCanonical(...)
replaceCanonicalCcPayloadFromVerifiedCommit(...)
clearCanonicalCcPayloadWithAuthorization(...)
```

Generic helpers such as `clearPaintBuffer` or unconstrained snapshot replacement should not be callable from arbitrary code if they can affect committed CC truth.

Runtime clear APIs should remain cheap and direct. Canonical replacement APIs must route through `commitCanonicalCcPayload(...)`.

### 5. Autosave Fail-Closed Behavior

Autosave must skip rather than serialize suspicious CC state.

Autosave should refuse to write when:

- any CC layer has an unauthorized populated-to-empty transition,
- a CC selection/floating-paste transaction has modified canonical-adjacent CC state and has not produced a verified snapshot,
- a warmup/hydration transaction is unresolved,
- a layer has canonical CC metadata but only partial buffers,
- presentation/runtime state is blank while canonical payload still exists.

The skipped autosave should emit a compact diagnostic with layer id, reason, and transaction id.

### 6. CC Recovery Vault

Store the last known good canonical CC payload beside each populated CC layer.

The vault is used only for recovery and diagnosis:

- keep the most recent verified non-empty payload,
- preserve layer id, dimensions, and compact summaries,
- update only after a verified successful canonical commit,
- never update from an unauthorized empty state.

If active CC data becomes suspiciously empty, Vessel should block the write and keep the vault available for a repair action.

The vault may preserve or restore data only after a blocked suspicious write, never as part of normal canonical write success. It must not mask a successful write path that is producing the wrong payload.

### 7. Blank Presentation Detection

Separate data loss from display loss.

If canonical CC data exists but the displayed surface is empty, the app should identify that as a presentation/render rebuild problem, not as a clear. The app should rebuild the runtime/compositor surface from canonical data and emit a diagnostic such as:

```text
cc-presentation-empty-with-canonical-data
```

### 8. Rolling CC Black Box

Keep a compact rolling event log for destructive and suspicious CC transitions.

Each entry should include:

- event name,
- timestamp,
- URL,
- layer id,
- operation kind,
- transaction id,
- before summary,
- after summary,
- source module,
- stack trace for suspicious writes,
- whether the event was blocked, allowed, restored, or informational.

This must be available from the browser without DevTools-only hunting. Existing mutation log helpers should be extended rather than replaced.

### 9. Cold-Layer Unknown State

Loaded or lazy-hydrated CC layers must not be classified as empty until hydration proves they are empty.

Use a state distinction:

- `populated`,
- `empty`,
- `unknown-unhydrated`,
- `damaged-partial`.

`unknown-unhydrated` and `damaged-partial` must block destructive serialization and prompt repair/diagnostics instead of being treated as empty.

### 10. Destructive-Path Fuzzer

Add an automated integration-style test harness that performs real workflow sequences:

- draw CC content,
- save,
- autosave,
- undo,
- redo,
- marquee delete,
- marquee move,
- floating paste cancel,
- floating paste commit,
- layer switch,
- warm restore,
- Goblet export,
- reload,
- clear non-CC layer,
- delete unrelated layer,
- project close/reset.

After every step, assert that the canonical CC payload remains present unless the test explicitly performed an authorized destructive action.

## Relationship To Existing Plans

This plan sits above the existing seam-specific plans:

- `docs/refactor/plan-cc-persistence-single-authority-2026-04-28.md`
  - owns save/autosave/history persistence authority.
- `docs/refactor/plan-cc-runtime-mutation-single-authority-2026-04-29.md`
  - owns runtime populated-to-empty audit boundaries.
- `docs/refactor/plan-selection-delete-authorization-2026-05-01.md`
  - owns explicit delete authorization behavior.
- `docs/refactor/plan-cc-selection-transaction-refactor-2026-05-04.md`
  - owns selection/floating-paste transaction safety.
- `docs/refactor/plan-cc-undo-history-cleanup-2026-05-04.md`
  - owns missing-before-state and undo/redo integrity.

The difference is that this plan makes the invariant global: every seam must prove it cannot serialize or commit accidental empty CC truth.

## Implementation Checklist

### Phase 1. Define The Global Contract And Summary

- [x] Add typed `CcDestructiveOperation` and authorization payloads.
- [x] Add typed CC content state: `populated`, `empty`, `unknown-unhydrated`, `damaged-partial`.
- [x] Add `CcPayloadSummary` with width, height, non-zero counts, gradient-binding presence, and hash.
- [x] Add one shared populated-to-empty classifier for canonical CC payload summaries.
- [x] Document the invariant in the relevant CC persistence/runtime modules.
- [x] Add tests for the classifier and authorization rules.

### Phase 2. Guard Canonical Writes

- [x] Add `commitCanonicalCcPayload(...)` as the named canonical write boundary.
- [ ] Route committed CC payload writes through `commitCanonicalCcPayload(...)`.
- [x] Block unauthorized populated-to-empty canonical writes.
- [x] Preserve the previous verified payload when a write is blocked.
- [ ] Emit diagnostics with operation, transaction id, and before/after summaries.
- [x] Add tests proving unauthorized empty writes cannot replace populated canonical data.

### Phase 3. Split Dangerous APIs

- [ ] Inventory CC clear/replace APIs.
- [ ] Split runtime-only clear APIs from canonical destructive APIs.
- [ ] Rename dangerous helpers to require authority in the call signature.
- [ ] Remove or isolate unconstrained clear helpers.
- [ ] Add compile-time tests or type-level constraints where practical.

### Phase 4. Autosave And Save Fail Closed

- [ ] Make manual save reject suspicious CC state with a visible reason.
- [ ] Make autosave skip suspicious CC state instead of serializing it.
- [ ] Block save/autosave when an active CC selection/floating-paste transaction has modified canonical-adjacent state without a verified snapshot.
- [ ] Block save/autosave during unresolved warmup/hydration transactions.
- [ ] Add regression tests for save/autosave skip behavior.

### Phase 5. Copy-On-Write Transaction Enforcement

- [ ] Confirm selection extract/move/cancel/commit never serializes a temporarily empty source.
- [ ] Confirm Goblet export reads a verified snapshot and cannot mutate canonical state.
- [x] Confirm warmup/restore cannot downgrade `unknown-unhydrated` to `empty`.
- [ ] Add transaction-level tests that fail if empty mid-states escape.

### Phase 6. Recovery Vault

- [ ] Store last verified non-empty canonical CC payload per CC layer.
- [ ] Update the vault only after verified canonical commits.
- [ ] Keep the vault unchanged on unauthorized empty writes.
- [ ] Add a repair path that restores from the vault only after a blocked suspicious write and explicit user action or blocked-write recovery.
- [ ] Prove the vault is never used to mask normal successful canonical writes.
- [ ] Add tests for vault update, blocked-write preservation, and restore behavior.

### Phase 7. Presentation/Data Split

- [ ] Detect canonical-populated-but-surface-empty cases.
- [ ] Rebuild runtime/compositor surfaces from canonical data when possible.
- [ ] Log `cc-presentation-empty-with-canonical-data`.
- [ ] Add tests for presentation rebuild without modifying canonical payload.

### Phase 8. Rolling Black Box

- [ ] Extend existing CC mutation log helpers with canonical write events.
- [ ] Include stack traces for blocked unauthorized populated-to-empty writes.
- [ ] Include save/autosave skip events.
- [ ] Include transaction ids for selection, history, export, and warmup operations.
- [ ] Keep a browser-accessible helper for retrieving the log.

### Phase 9. Destructive-Path Fuzzer

- [ ] Build a workflow test that starts from real CC content and performs destructive-adjacent actions.
- [ ] Assert canonical CC payload after every non-destructive step.
- [ ] Assert authorized destructive actions are the only way to reach canonical empty.
- [ ] Include save, autosave, warmup, selection, undo/redo, export, and layer actions.

## Definition Of Done

- A populated canonical CC payload cannot be replaced by an empty committed payload without an explicit authorization token or undo/redo to a previously recorded empty canonical state.
- All canonical CC writes route through `commitCanonicalCcPayload(...)`.
- Save and autosave fail closed instead of persisting suspicious empty CC state.
- Selection/floating-paste transactions cannot leak temporary empty source state into project truth.
- Warmup and cold restore distinguish unknown/damaged state from empty state.
- Goblet export cannot mutate committed CC data and must fail if it cannot serialize a verified complete CC payload.
- Presentation blanking is detected separately from data loss and can rebuild from canonical payload.
- A last-known-good CC vault is available for blocked-write recovery and never masks normal successful canonical writes.
- A rolling browser-accessible CC black box explains the next incident without relying on guesswork.
- Regression tests cover the destructive paths listed in this plan.
