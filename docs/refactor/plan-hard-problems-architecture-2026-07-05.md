# Vessel Hard Problems Architecture Plan

Date: 2026-07-05

Status: planned

## Purpose

This is the master plan for the six hardest structural problems in Vessel, ordered by depth:

1. Color-cycle source of truth (the deepest; most of this document)
2. Goblet export parity
3. Undo/redo without giant snapshots
4. Interactive performance on large canvases
5. Persistence and legacy repair
6. Keeping editor and runtime behavior aligned

These are not six independent problems. Problems 2, 3, 5, and 6 are all consumers of problem 1: if there is one canonical, versioned color-cycle document per layer, then export, history, persistence, and runtime parity all become "read the document, prove you read it correctly." Problem 4 is mostly independent but shares the same invalidation primitive (a document version counter) that problem 1 introduces.

This plan builds on completed prior work and does not re-litigate it. It states what exists, what is still open, and what to build next.

## Revision Note (same day, second pass)

After a full read of the engine, the export pipeline, and the prior plans, four corrections were applied to the first draft. The destination architecture is unchanged; these remove speculative infrastructure and duplicate concepts:

1. **No standalone `DerivedSurfaceRegistry` object.** The essential mechanism is the version counter plus a `builtFromVersion` field on each derived surface. A central registry is infrastructure with no second consumer until the composite scheduler exists — so Phase 1.3 now ships an interface + helper, and the only central list of surfaces is the compositor's rebuild scheduler introduced in Phase 4.1.
2. **One type spine, not three.** The document snapshot type, `ColorCycleLayerDocumentState` (persistence), and the Goblet payload schema describe the same data at three trust levels. Defining them independently recreates the scattered-authority problem at the type level. The executable contract (old Phase 2.2) moves up to run alongside Phase 1.1: one schema family in one module, with explicit narrowing mappers document → archive → payload.
3. **`version` supersedes `strokeCounter`, it does not join it.** Two monotonic counters with overlapping meaning is how drift starts. The document version becomes the only staleness/identity token in memory; `strokeCounter` survives only as a serialized archive-compatibility field derived at save time.
4. **Phase 1.6.7 scoped down.** Narrow `StrokeContext` interfaces are required only for controllers that mutate canonical state or shared caches. Pure-computation controllers (dither kernels, pressure curves, phase math) take plain data arguments — converting all ~70 to context interfaces was ceremony, not safety.

## Where We Already Are

A lot of the authority work is done. New work must extend these boundaries, not route around them:

| Prior plan | Status | What it gives us |
| --- | --- | --- |
| `plan-cc-persistence-single-authority-2026-04-28.md` | complete | One snapshot service (`src/lib/colorCycle/persistence/`) decides CC persistence authority for save/autosave/history. Metadata-only state cannot serialize as healthy animated CC. |
| `plan-cc-runtime-mutation-single-authority-2026-04-29.md` | complete | One runtime mutation boundary inside `ColorCycleBrushCanvas2D` (`mutateLayerStrokeState`). Populated-to-empty transitions are logged with reason/stack via `window.__VESSEL_GET_CC_MUTATION_LOG__?.()`. |
| `plan-cc-restore-single-source-of-truth-2026-04-27.md` | V1 complete; **V2.7 + manual validation open** | Import-only legacy repair; runtime/export/save may not invent paint from `canvasImageData`. |
| `plan-cc-runtime-source-warmup-policy-2026-06-20.md` | complete | `runtimeSourcePolicy.ts` centralizes editable/warmable/restorable/playback source decisions. |
| `plan-goblet-cc-export-contract-refactor-2026-05-06.md` | complete | Canonical CC export source resolver + payload builder + validation in `src/utils/export/goblet/`. Failed payloads fail visibly. |
| `undo-redo-architecture.md` | largely complete | `HistoryManager` with typed deltas, per-stroke CC undo, tile-based bitmap deltas, `COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS` buffer contract, 25/50 MB entry guardrails. |
| `docs/color-cycle-compatibility-contract.md` | living contract | Vessel<->Goblet CC payload semantics, golden fixtures in `tests/fixtures/cc/`. |

What the prior work deliberately did **not** do:

- There is still no single owned document object for a CC layer. Canonical state is still assembled from scattered fields (`colorCycleData.brushState`, top-level buffers, manager-owned runtime, deferred archive refs) at each boundary. The boundaries are guarded, but every guard re-derives "what is the truth" from the same scattered inputs.
- There is no document-wide change/version signal. Derived surfaces (composite canvases, animator GPU textures, worker composites, thumbnails, previews) each maintain their own ad-hoc staleness flags; dirty-region tracking exists only inside the brush engine.
- `ColorCycleBrushCanvas2D.ts` (~8,500 lines) and `projectIO.ts` (~6,400 lines) still combine document ownership, runtime execution, and orchestration in single modules.

The strategy of this plan: **stop adding guards around scattered state, and make the scattered state impossible** by introducing an owned, versioned CC document object, then re-pointing every existing boundary (persistence snapshot service, runtime mutation boundary, export source resolver, history deltas) at it.

---

## Problem 1: Color-Cycle Source Of Truth (deepest)

### Diagnosis

Today the authority chain is enforced procedurally, at boundaries, over shared mutable fields:

```text
layer.colorCycleData.{brushState, gradient buffers, masks, slot metadata, preview pixels}
  + colorCycleBrushManager runtime instances
  + deferred archive refs
  + animator GPU state
        ^                ^               ^              ^
   save snapshot    runtime mutation   export source   warmup policy
     service          boundary           resolver        policy
```

Each of the four guards independently answers "which of these fields is the truth right now?" That question is answered correctly today because each guard was audited. It will be answered incorrectly the first time a new feature adds a fifth field or a fifth reader, because nothing in the type system or module graph prevents it. That is the C3 incident pattern waiting to recur in a new costume.

### Target Architecture

One owned object per brush-mode CC layer, one write path, one version counter, and derived surfaces that subscribe rather than poll:

```text
ColorCycleLayerDocument (owned, versioned)
  ├── canonical buffers: paint, gradientId, gradientDefId, speed, flow, phase
  ├── masks: eraseMask, softEdgeMask
  ├── slot/gradient metadata: slotPalettes, gradientDefs, gradientDefStore, paintSlot, flowMode, layerBaseSpeedCps
  ├── residency: 'resident' | 'cold-archive-ref' | 'static-preview-only'
  └── version: monotonically increasing per committed mutation

writes:  only via CCDocumentTransaction (wraps existing mutateLayerStrokeState reasons)
reads:   only via accessor API (readers receive { snapshot, version })
derived: each derived surface carries builtFromVersion; stale ⇔ builtFromVersion !== document.version
schema:  document snapshot type = the executable contract type family; archive and Goblet payload
         shapes are explicit narrowings of it, never independent definitions
```

Key decisions:

- **The document is a new home for existing state, not a new schema.** Buffer semantics, the compatibility contract, and the `.vs` archive format do not change. `ColorCycleLayerDocumentState` (already defined in `src/lib/colorCycle/documentState.ts`) becomes the serialized form of this object rather than a shape assembled on demand.
- **Residency is a document property, not a guard-time inference.** `runtimeSourcePolicy.ts`'s four concepts (editable / recoverable / restorable / playback-warmable) become derived getters on the document instead of functions over scattered fields. Cold layers hold archive refs inside the document; warming replaces refs with buffers under a transaction; `static-preview-only` is a terminal residency set only by import repair.
- **The version counter is the universal invalidation currency.** History entries, export snapshots, autosave, previews, and the compositor all record the document version they consumed. "Is X stale?" becomes an integer comparison everywhere. This is also what problem 4 (performance) and problem 3 (undo validation) consume. It supersedes `strokeCounter` as the in-memory staleness/identity token; `strokeCounter` remains only as an archive-compatibility field derived at serialize time.
- **One schema family.** The document's snapshot type is defined in the executable contract module shared with export validation and the Goblet loader. `ColorCycleLayerDocumentState` and the Goblet payload become explicit narrowings (mappers) of that type, so a field added to the document cannot silently miss persistence or export — the compiler flags the unmapped field.
- **The existing boundaries survive as the document's internals.** `mutateLayerStrokeState` reasons/audit become the transaction API's audit log. The persistence snapshot service's validation becomes the document's own `serialize()` validation. Source-priority resolution shrinks to "resident buffers, else archive refs, else fail" because there are no longer competing field sets to arbitrate.

### Hard Rules (target end state)

- No module outside `src/lib/colorCycle/document/` may hold a direct reference to a canonical CC buffer.
- Every mutation carries a reason code and bumps `version` exactly once per committed transaction (a stroke = one transaction, matching per-stroke undo).
- A derived surface may never be promoted to document data. (Already the V2 rule; the document makes it structural — the `DerivedSurface` interface has no write path into the document.)
- Save/export/history APIs accept a `ColorCycleLayerDocument`, never a `Layer` with loose fields.
- Dev builds assert on version mismatches at consumption points (export reads version N, packages payload, re-reads version — mismatch means a mutation raced the export).

### Phases

#### Phase 1.0: Close out prior-plan debt

- [ ] Complete V2.7 runtime/presentation boundary cleanup from `plan-cc-restore-single-source-of-truth-2026-04-27.md`.
- [ ] Run the outstanding manual old-project restore/export validation pass and record evidence.
- [ ] Confirm no new direct CC buffer writers appeared since the 2026-04-29 inventory (re-run the writer grep audit; update the inventory table).

Exit: prior CC plans are all status `complete` with no open checkboxes.

#### Phase 1.1: Introduce the document object (no behavior change)

- [ ] Create `src/lib/colorCycle/document/ColorCycleLayerDocument.ts` wrapping the existing per-layer stroke state (buffers, masks, metadata, residency) with a `version` counter. `version` is the only new counter; `strokeCounter` is derived at serialize time for archive compatibility and is no longer read as an in-memory staleness signal.
- [ ] Define the document snapshot type in the executable contract module (see 2.2, co-timed with this phase): one schema family with explicit narrowing mappers to `ColorCycleLayerDocumentState` (archive) and the Goblet payload shape. Exhaustive-mapping tests fail when a document field is added without a mapper decision (persisted / export-only / runtime-only — the decision must be explicit).
- [ ] Implement `CCDocumentTransaction` by delegating to `mutateLayerStrokeState(...)`; every existing reason code maps 1:1. Version bump on commit.
- [ ] The document is instantiated and owned by `colorCycleBrushManager` (one per CC layer), replacing the loose brush-instance map entry as the identity object.
- [ ] Add read accessor returning `{ snapshot, version }`; snapshots are read-only views (no copying of buffers in the hot path — freeze/`DataView` discipline, copies only at persistence/export boundaries where they already happen).
- [ ] Unit tests: version bumps once per transaction; concurrent read-during-transaction sees pre-commit state; audit log parity with the existing mutation log.

Exit: document exists and is authoritative for layers touched by the brush engine, with all existing tests green and zero rendering change.

#### Phase 1.2: Residency into the document

- [ ] Move deferred-archive refs and warm/cold state from `createLayersSlice` + layer fields into `document.residency`.
- [ ] Reimplement `runtimeSourcePolicy` predicates as document getters; keep the module as a thin re-export so call sites migrate incrementally.
- [ ] Warm restore becomes a `project-load-restore` transaction that swaps refs for buffers; import repair is the only producer of `static-preview-only`.
- [ ] Tests: cold save without warming still copies archive refs; warming bumps version; static-preview layers refuse edit/playback/animated-export transactions with typed errors.

#### Phase 1.3: Derived surfaces carry versions

Deliberately minimal: no central registry object. The mechanism is a `DerivedSurface` interface (`builtFromVersion`, `rebuild(snapshot, version)`) plus an `isStale(doc, surface)` helper. The only central list of surfaces is the compositor rebuild scheduler, and that belongs to Phase 4.1 — build it there, once, with a real consumer.

- [ ] Add the `DerivedSurface` interface + staleness helper in the document module.
- [ ] Migrate, in order: animator GPU textures (`ColorCycleAnimator`), worker compositor inputs (`colorCycleCompositor.worker`), layer preview canvas / `canvasImageData`, thumbnails, shape-preview overlays.
- [ ] Delete the corresponding ad-hoc staleness flags as each surface migrates.
- [ ] Dev assert: rendering from a stale surface without a scheduled rebuild logs a diagnostic (throttled).

#### Phase 1.4: Re-point the four boundaries

- [ ] Persistence snapshot service: `captureColorCyclePersistenceSnapshot` gains a document-first path; source-priority arbitration collapses to residency inspection. Keep the old path behind the same API until Phase 1.5.
- [ ] Goblet export: `colorCycleExportSourceResolver` resolves to `document.snapshot()` at a pinned version; the payload builder records the version in export diagnostics.
- [ ] History: `ColorCycleStrokePatchDelta` / full-state deltas record `beforeVersion`/`afterVersion`; apply asserts the document is at the expected version before patching (detects divergence instead of silently layering patches on drifted state).
- [ ] Runtime hydration: `restoreColorCycleBrushes` orchestration moves out of `projectIO.ts` into `src/lib/colorCycle/document/hydration.ts` (this is the extraction already earmarked in the 2026-06-20 plan's "Next Refactor Steps").

#### Phase 1.5: Make the old paths unrepresentable

- [ ] Remove canonical buffers from `layer.colorCycleData` layer fields; the layer keeps only `documentId` + display metadata. Provide a migration shim for `.vs` load (archive format unchanged — this is an in-memory change only).
- [ ] ESLint `no-restricted-imports` / restricted-path rule: only `src/lib/colorCycle/document/**` may import buffer internals; CI fails on violation.
- [ ] Delete the pre-document code paths kept during 1.4.
- [ ] Regression: the full C3 scenario, the 2026-04-29 mutation-audit scenarios, and the golden CC fixtures all pass against the document-backed implementation.

#### Phase 1.6: Decompose the engine (`ColorCycleBrushCanvas2D`)

Only after 1.1–1.5: the document boundary must be stable and enforced before the engine is carved up, otherwise every extraction re-negotiates state ownership at the same time it moves code.

Diagnosis. The class is ~8,500 lines with ~163 members, but it is no longer a monolith of inline logic — roughly 70 controller modules have already been extracted into `src/hooks/brushEngine/` (stroke lifecycle, dither, pressure, shape gradients, finalize, live preview, …). The remaining problem is that those controllers all receive **the engine instance itself as their context**, so the state coupling of the god class is fully intact; extraction moved code without moving ownership. The class currently plays eight roles at once:

1. Per-layer canonical stroke state store (`layerStrokes`) — leaves in Phase 1.1 (becomes the document).
2. Stroke authoring pipeline — `paint`, `paintCustomStamp`, `startStroke`/`endStroke`/`finalizeCurrentStroke`, pressure/stamp/dither orchestration.
3. Shape fill service — `fillShape`, `fillShapeLinear`, `fillShapeDispatch`, worker job tracking.
4. Gradient/slot management — `setGradient*`, slot palette caches, def-palette caches, signatures, seam profiles, `bindGradientDefIdToSlot`, `syncGradientDefRuntime`.
5. Playback — the `animators` map, RAF loop, `startAnimation`/`stopAnimation`/pause/resume, FPS/speed/phase state.
6. Presentation — `render`, `renderDirectToCanvas`, `commitToLayer`, the composite canvas.
7. Persistence/history adapter — `serialize`, `getFullState`/`restoreFullState`, `getLayerSnapshot`/`applyLayerSnapshot`/`applyPaintPatch`, the committed-state cache, `persistedColorCycleMetaByLayer`.
8. Settings surface — ~40 individual setters mirroring brush settings (`setDitherEnabled`, `setStampDitherPatternTileSettings`, `setMinPressure`, …).

Strategy: **strangler extraction around the document — never a rewrite.** Algorithms (dither kernels, pressure curves, phase math) move verbatim; only ownership and wiring change. Extraction order is easiest/lowest-risk first so the safety net is proven before the dangerous parts move. The `createBrushEngineFacade(...)` factory pattern used by the regular brush engine is the precedent for the end state.

- [ ] **1.6.0 Characterization safety net.** Golden engine fixtures before anything moves: scripted sessions (stroke with pressure + dither, custom stamp stroke, shape fill per mode, slot rebind, playback N frames, snapshot/restore round-trip) that hash canonical buffers and rendered frames. Every extraction step below must leave these hashes identical (frame renders may use the existing channel-delta thresholds). These live next to the existing regression tests and stay after the refactor as the engine's contract tests.
- [ ] **1.6.1 Settings object.** Replace the ~40 setters with one typed `CCBrushSettings` value and a single `applySettings(patch)` that diffs internally and invalidates only affected caches. The store pushes one object; the class loses ~40 members and a whole class of store/engine drift bugs. (Lowest risk, immediately shrinks the surface.)
- [ ] **1.6.2 Persistence/history adapter out.** `serialize`/`getFullState`/`restoreFullState`/`getLayerSnapshot`/`applyLayerSnapshot`/`applyPaintPatch` and the committed-state + persisted-meta caches move to the document module. Phase 1.4 already re-pointed the callers; this deletes the class-side remnants so the engine no longer has a persistence face at all.
- [ ] **1.6.3 PlaybackController.** Owns the `animators` map, the RAF loop, play/pause/FPS/speed/phase state. Reads the document via versioned snapshots (Phase 1.3 `DerivedSurface` contract); the engine no longer schedules frames. Playback timing semantics (accumulator, speed scale) move verbatim — they are contract-relevant (Problem 2).
- [ ] **1.6.4 Presenter/compositor out.** `render`, `renderDirectToCanvas`, `commitToLayer`, and the composite canvas become a presenter consuming versioned `DerivedSurface`s via the Phase 4.1 rebuild scheduler. This is the same component Phase 4.2's two-tier composite needs — do 1.6.4 and 4.2 as one arc to avoid building the presenter twice.
- [ ] **1.6.5 GradientSlotService.** Slot palettes, def-palette caches, gradient signatures, seam profiles. The document owns bindings (which slot/def a pixel references); the service owns derived caches (resolved RGBA rows), registered as derived surfaces.
- [ ] **1.6.6 ShapeFillService.** Async fill dispatch and worker job lifecycle (`concentricWorkerJobId` and friends), writing results through document transactions with the existing fill reason codes.
- [ ] **1.6.7 Stroke authoring last.** The riskiest and largest role. Split the ~70 controllers by what they touch: controllers that **mutate canonical state or shared caches** get narrow `StrokeContext` interfaces declaring exactly what they read/write (settings slice, active transaction, stamp caches) instead of receiving the engine; **pure-computation controllers** (dither kernels, pressure curves, phase math) are converted to plain-data arguments only — no context interface ceremony. The compiler enforces shrinking context on the mutating set. The class ends as a thin composition root (`createColorCycleEngine()` factory wiring document + services), mirroring `createBrushEngineFacade`.
- [ ] **1.6.8 Delete or shim.** Remove the class, or leave a deprecated shim delegating to the factory for any stragglers; apply the repo's module-size guardrails to `src/hooks/brushEngine/` so no module regrows past the ceiling.

Rules of engagement for 1.6:

- One extraction per change, landed serially — no long-lived refactor branch.
- Zero algorithm edits inside an extraction commit. A bug found mid-extraction is fixed in a separate commit against the pre-extraction code first, so the fixture change is attributable.
- Feature work in `brushEngine/` pauses per-area while that area is mid-extraction (scoped freeze, not a repo freeze).

Exit criteria for 1.6:

- [ ] No controller or service receives the engine instance as context; every context interface is explicit and minimal.
- [ ] Engine state lives only in the document (canonical) and service-local caches (derived, version-tracked) — the composition root holds no mutable buffers.
- [ ] Golden engine fixtures unchanged end-to-end; CC parity matrix (2.3) green.
- [ ] No module in `src/hooks/brushEngine/` exceeds the size guardrail.

Exit criteria for Problem 1:

- [ ] Exactly one module owns CC canonical state; grep for `paintBuffer` outside `document/`, `persistence/`, import repair, and history deltas returns nothing.
- [ ] Every derived surface has a `builtFromVersion`; no ad-hoc CC staleness flags remain.
- [ ] Save, export, history, and hydration consume `{ snapshot, version }` and log the version in their diagnostics.
- [ ] The engine is a composition root over document + services (Phase 1.6), not a state owner.

### Risks

- **Biggest risk: a stealth rewrite of `ColorCycleBrushCanvas2D`.** Mitigation: Phase 1.1 wraps, it does not move code. Decomposition is deliberately deferred to Phase 1.6, after the document boundary is stable and characterization fixtures exist (same sequencing the 2026-06-20 plan chose).
- **1.6-specific: hidden coupling through the god-context.** Controllers may read engine fields nobody documented (order-dependent mutation, cache side effects). Mitigation: narrow `StrokeContext` interfaces make every dependency explicit at compile time, and the characterization fixtures catch behavioral drift the types can't.
- Version-counter granularity: bumping per pointer-move would thrash derived surfaces. The transaction = stroke rule keeps bump frequency at intent level; live in-stroke rendering stays inside the engine's existing incremental path and only the commit publishes a new version.
- Read-snapshot aliasing: readers holding buffer views across a transaction commit. Mitigation: dev-mode revocable proxies or debug canary bytes; production relies on the "consume within a task" convention already used by the exporter.

---

## Problem 2: Goblet Export Parity

### Diagnosis

The export contract work (2026-05-06) made packaging deterministic and validated. The remaining parity risk is **behavioral drift between two runtimes**: Vessel's editor renderer and Goblet's viewer implement the same semantics (speed decode, shift math, slot clamping, masks, fit modes, display filters, hidden-layer options) in separate code that can diverge silently.

### Plan

- [ ] **2.1 Expand the shared-source pattern.** `alignFitResolver` is already single-sourced and generated into the viewer (`scripts/build-align-fit.mjs`). Inventory every semantic both runtimes implement (speed decode, frame shift, palette row sampling, mask application, flow modes, fit math, display filters) and move each into a shared module under `src/lib/colorCycle/` compiled into `goblet.js` by the existing runtime build scripts. Hand-edited duplicates are deleted; the build check (`build-goblet-runtime.mjs --check`) fails if generated output drifts.
- [ ] **2.2 Executable contract.** Encode `docs/color-cycle-compatibility-contract.md`'s payload rules as a schema module (types + runtime validators) consumed by both `colorCyclePayloadValidation.ts` (export side) and the Goblet loader (import side). The prose doc stays, but the schema is the enforcement. **Timing: co-timed with Phase 1.1**, because the same schema family defines the document snapshot type — export/persistence/document must not define this shape three times.
- [ ] **2.3 Parity matrix in CI.** Extend the golden fixture set (`tests/fixtures/cc/`) and the artifact harness (`tests/helpers/gobletArtifactHarness.ts`) into an explicit matrix: {static/animated/mixed pixels} × {erase mask, soft-edge mask, none} × {hidden layers on/off} × {display filters on/off} × {fit/cover/fill/tile/none} × {slot clamp, palette fallback}. Each cell renders N frames in the Vessel reference path and the packaged Goblet artifact and asserts channel/alpha deltas. Target: every contract clause has at least one failing-test witness.
- [ ] **2.4 Legacy corpus.** Check in (or fetch as test assets) a small corpus of real old `.vs` archives — including a C3-style damaged one and a pre-schema-2 one — with expected outcomes: which layers export animated, which export as static-with-warning, which fail visibly. Run through export in CI.
- [ ] **2.5 Schema version discipline.** Written rule in the contract doc: any change to payload semantics bumps `colorCycle.schemaVersion`, adds a loader tolerance in Goblet for N-1, and adds a fixture pinned to the old version. No silent semantic changes under the same version.

Exit criteria: a rendering change that affects playback cannot land without either updating a shared module (both runtimes change together) or failing the parity matrix.

---

## Problem 3: Undo/Redo Without Giant Snapshots

### Diagnosis

The heavy lifting is done: `HistoryManager`, typed deltas, per-stroke CC patches over the centralized buffer contract, tile-based bitmap deltas, size guardrails. Remaining risks are memory policy (guardrails drop oversized entries rather than storing them cheaply), correctness under drift (patches applied to state that isn't what the patch expects), and coverage rot (new buffers/masks bypassing the contract).

### Plan

- [ ] **3.1 Version-anchored deltas** (delivered by Phase 1.4): every CC delta stores `beforeVersion`/`afterVersion`; apply asserts and refuses (with diagnostic) on mismatch instead of corrupting. Bitmap deltas for plain layers get an equivalent cheap content-hash anchor.
- [ ] **3.2 Blob tier.** Implement the `historyBlobs` service sketched in `undo-redo-architecture.md`: content-hashed, ref-counted payload storage with RAM + IndexedDB tiers. Full-state CC snapshots (layer switch, structural ops) store refs; identical buffers dedupe. This replaces "drop entries over 50 MB" with "spill entries over N MB", keeping deep undo on large canvases.
- [ ] **3.3 Memory budget policy.** One documented budget: total resident history bytes, per-entry spill threshold, trim order (oldest spilled first). Expose current usage in the existing profiling hooks (`src/history/profiling.ts`).
- [ ] **3.4 Contract guard.** Extend the `COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS` guard test to fail when the document object (Phase 1.1) declares a per-pixel buffer that history doesn't cover — the document becomes the enumeration source, so a new buffer cannot be added without history/persistence/export acknowledging it (this is the structural fix for the "add a buffer, forget a surface" class).
- [ ] **3.5 Intent audit.** One pass over tools verifying one intent = one entry: stroke, fill, shape commit, selection op, mask edit, layer structure op, project transform. Fix any tool still batching or splitting. Add integration tests per intent.

Exit criteria: undo depth ≥ 50 on a 4096² multi-CC-layer project stays within the documented budget; a synthetic "patch applied to drifted state" test fails safely with a typed error.

---

## Problem 4: Interactive Performance On Large Canvases

### Diagnosis

Dirty tracking exists only inside the brush engine; compositing is still driven by coarse signals; animated CC frames can trigger full recomposition; pointer-move work can touch store and derived surfaces more than necessary. The maintainability guide already names the right ideas (composite hash, overlay animated layers on a cached static composite, worker offload); what's missing is a single invalidation currency and budgets that hold in CI.

### Plan

- [ ] **4.1 Document-wide dirty contract.** Introduce a per-layer `DirtyTracker` (rect set, coalescing) fed by the same transactions that bump document versions (Phase 1.1) and by plain-layer mutators. The compositor consumes `{layerId, version, rects}` batches per RAF tick instead of booleans.
- [ ] **4.2 Two-tier composite.** Split the composite into a cached static tier (all non-animated content) and an animated overlay tier (CC playback frames). CC animation frames redraw only the overlay; the static tier rebuilds only when a static layer's version changes within the dirty rects. This is the single biggest win for "CC playback while editing."
- [ ] **4.3 Worker boundary policy.** Written rule for what runs where: fills and CC composition stay in workers (`colorCycleFill.worker`, `colorCycleCompositor.worker`); transfers use `ImageBitmap`/transferables; no worker round-trip may sit on the pointer-move critical path — pointer moves enqueue, RAF drains.
- [ ] **4.4 Preview budgets.** Shape/fill previews get an explicit budget: preview at reduced fidelity if predicted cost exceeds the frame budget (existing fast-mode work in `plan-cc-shape-preview-fast-mode` is the precedent — generalize the policy, don't re-derive it per tool).
- [ ] **4.5 Benchmarks in CI.** Extend the existing perf test surface with 3–4 pinned scenarios (large canvas stroke latency, CC playback + stroke, fill preview on 4096², layer reorder recomposite) measured via `performance.now()` deltas with generous regression thresholds — catching 2× regressions, not 5% noise.

Exit criteria: CC playback at 60fps target does not force static-tier recomposition (verified by counter assertions in tests); pointer-move handler does zero synchronous compositing.

---

## Problem 5: Persistence And Legacy Repair

### Diagnosis

The architecture is in place: snapshot service authority, import-only repair, typed damage, health reports. What remains is finishing validation, hardening the boundary against regression, and giving users an explicit path out of `static-preview-only`.

### Plan

- [ ] **5.1 Finish V2** (shared with Phase 1.0): V2.7 cleanup + the manual old-project restore/export pass.
- [ ] **5.2 Archive corpus tests** (shared with 2.4): healthy C2-style, damaged C3-style, legacy pre-schema archives round-trip through load → edit → save → reload in CI, asserting canonical buffers survive and damage stays typed.
- [ ] **5.3 Boundary lint.** Static check that `canvasImageData` / preview-pixel reads appear only under `legacyRepair`/`legacyCompatibilitySnapshotRepair` modules — the "repair at import only" line enforced by CI, not review vigilance.
- [ ] **5.4 Explicit repair tool.** A user-facing action on `static-preview-only` layers: "Convert preview to flat layer" (accepts data loss, becomes a normal raster layer) or "Keep as preview". No automatic promotion, ever. This closes the last temptation to blur the boundary "to be helpful."
- [ ] **5.5 Save health gate.** Elevate the existing save diagnostics: if a save would write fewer canonical CC layers than the previous save of the same project (regression signal), surface a blocking-with-override warning. Cheap tripwire for the next novel data-loss shape.

Exit criteria: the corpus passes in CI; no code outside import repair can read preview pixels as input; repair-failed layers have a user path forward.

---

## Problem 6: Keeping Editor And Runtime Behavior Aligned

### Diagnosis

This is the process/verification face of problems 1–2. Once semantics are single-sourced (2.1) and the parity matrix runs in CI (2.3), the remaining risk is human: a "small" rendering change that doesn't realize it's contract-relevant.

### Plan

- [ ] **6.1 Contract-touch checklist.** A short checklist in `AGENTS.md` + PR template: "Does this change affect playback, masking, CC output, alignment, or export? Then: update shared module (not a runtime copy), update contract doc/schema if semantics changed, add/refresh a parity fixture." Reviewers check the box, CI checks the substance.
- [ ] **6.2 Generated-code freshness gate.** CI runs the goblet runtime build in `--check` mode (already exists) plus the align-fit build; any drift between shared source and generated viewer code fails the build.
- [ ] **6.3 One reference renderer.** The parity tests' "Vessel reference path" should be the actual editor playback path, not a third implementation. Audit the current harness for reference-path drift and pin it to the production code path.
- [ ] **6.4 Feature flags for dual-runtime features.** New playback-affecting features land behind a flag that is only removed when the parity matrix has cells for it — makes "works in Vessel, silently absent in Goblet" a visible intermediate state instead of a bug report.

Exit criteria: it is procedurally impossible to change playback semantics in one runtime only without a red CI signal or an explicitly flagged, documented gap.

---

## Sequencing

```text
Phase 1.0 (close V2.7 + validation)        ── unblocks 1.1 and 5.1
Phase 1.1–1.2 (document object, residency) ── the keystone; do before anything else structural
Phase 2.1 + 6.2 (shared modules + build gates)   — parallel with 1.x, different files
Phase 1.3 (derived-surface versions)       ── enables 4.1/4.2
Phase 1.4 (re-point boundaries)            ── delivers 3.1; enables 1.5
Phase 2.3–2.4 + 5.2 (parity matrix + corpus)     — parallel once fixtures exist
Phase 1.5 (delete old paths + lint)        ── after 1.4 proves out
Phase 1.6 (engine decomposition)           ── after 1.5; 1.6.4 pairs with 4.2 (shared presenter)
Phase 3.2–3.5, 4.x, 5.3–5.5, 6.1/6.3/6.4   ── independent follow-ons (4.2 waits for 1.6.4)
```

Rules of engagement (consistent with prior plans):

- Each phase ships as an independently green change: type-check, lint, full Jest, and the relevant Playwright smoke suites.
- No phase changes rendering output, dither behavior, or archive format unless the phase explicitly says so (none currently do).
- If a phase exposes a bug in prior-plan guarantees, fix it under that plan's contract first; do not fold fixes into the structural change.

## Validation Matrix (per phase and at completion)

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build:goblet-inline` + `npm run verify:goblet2-inline` + `node scripts/build-goblet-runtime.mjs --check --target=all` (phases touching export/runtime)
- [ ] Playwright: goblet artifact/smoke suites (phases touching export/runtime)
- [ ] Manual: draw/undo/save/reload/export session on a large multi-CC-layer project (phases 1.4, 1.5, 3.x, 4.2)
- [ ] Manual: old-project restore/export pass against the legacy corpus (phases 1.0, 5.x)

## Success Criteria (whole plan)

- [ ] One module owns canonical CC state; every reader consumes versioned snapshots; ESLint enforces the boundary.
- [ ] The CC engine is decomposed into document + services behind a composition root; no god-context controllers remain and golden engine fixtures pin its behavior.
- [ ] Derived surfaces (canvases, GPU textures, previews, exports) are provably rebuilt-from-version, never promoted to document data.
- [ ] Vessel and Goblet share generated semantic modules, and a CI parity matrix covers every contract clause.
- [ ] History is intent-level, version-anchored, deduped, and budgeted — no dropped entries on large projects.
- [ ] CC playback and editing coexist without full recomposition; pointer path is composite-free.
- [ ] Legacy repair remains import-only by static enforcement, with a user-facing path for repair-failed layers.
