# Plan: Close Problem 1 — Color-Cycle Source of Truth

Date: 2026-07-09
Status: ready to execute
Parent: `docs/refactor/plan-hard-problems-architecture-2026-07-05.md` (Problem 1)
Scope: finish Problem 1 only — not Goblet parity, not two-tier composite, not new CC features

---

## 0. Goal

Make color-cycle layer state **owned, versioned, and unforgeable**:

- One document per CC layer is the only canonical source of paint/buffer truth.
- Every mutation goes through one transaction path and bumps `version` once.
- Derived surfaces (animator, previews, composites, thumbnails) carry `builtFromVersion` and never promote themselves to document data.
- Save / export / history / hydration all pin `{ snapshot, version }` and fail closed on mismatch or missing document.
- The runtime host is a thin factory composition root, not a god class that still *looks* like ownership.

When this plan is done, Problem 1 is closed. Problems 2–6 may still be open; they consume this foundation.

---

## 1. Current state (honest baseline, 2026-07-09)

### Already done (do not re-litigate)

| Area | Status | Evidence |
| --- | --- | --- |
| Document object + transactions | done (1.1) | `ColorCycleLayerDocument`, `CCDocumentTransaction` |
| Residency / runtime policy | done (1.2) | document-first `runtimeSourcePolicy` |
| Derived-surface versioning | done (1.3) | `builtFromVersion` on animator, compositor, previews |
| Boundary re-point (persist/export/history/hydrate) | done (1.4) | document-first snapshot + export source |
| Old layer buffer mirrors unrepresentable | done (1.5) | ESLint restricted access; buffers only via document modules |
| Settings single object | done (1.6.1) | `applySettings` / `CCBrushSettings` |
| Persistence adapter extraction | done (1.6.2 checkbox marked) | `brushPersistenceAdapter.ts` owns plans/execution; external callers use document facades |
| Playback / presenter / slots / shape fill / stroke roles | done (1.6.3–1.6.7 checkboxes marked) | services + `*ApiRuntime` modules |
| Characterization fixture | done (1.6.0) | `pins 1.6.0` in `ColorCycleBrushCanvas2D.test.ts` |

### Still open (this plan)

| Gap | Why it still matters |
| --- | --- |
| **1.6.8 class → factory** | Production still constructs `new ColorCycleBrushCanvas2D(...)` via manager dynamic require + migration + testing harnesses. Class identity still signals "god object ownership." |
| **Public engine persistence shims** | Class still exposes `serialize` / snapshot apply wrappers that delegate into adapter. External callers are mostly migrated; **internal class surface still pretends to own persistence.** |
| **Ownership audit incomplete** | Mutable fields / service caches need a frozen classification table (canonical vs derived vs stroke-local vs wiring). |
| **Controller context residue** | Full-engine `brushEngine:` context is largely gone from `brushEngine/`, but a few regular-brush / UI sites still pass `brushEngine` objects; CC path needs a final zero-context proof. |
| **Version diagnostics completeness** | Export/hydration already log `documentVersion` in places; save/history need a uniform "pinned version at boundary" assertion pattern so drift is loud. |
| **Composition shell still a class** | `ColorCycleBrushCanvas2D.ts` (~700 LOC) is already mostly method delegation to `*ApiRuntime` modules — good structure trapped in wrong packaging. |

### Live inventory (commands that define "current")

```bash
# Production class construction (must go to zero outside factory/shim)
rg -n "new ColorCycleBrushCanvas2D|class ColorCycleBrushCanvas2D|ColorCycleBrushCanvas2D\\.deserialize" src \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/__tests__/**'

# Manager still dynamically requires the class
rg -n "ColorCycleBrushCanvas2D|getBrushClass|require\\(.*ColorCycleBrushCanvas2D" \
  src/stores/colorCycleBrushManager.ts src/stores/colorCycleBrushRegistry.ts

# Engine-as-context residue (target: zero in brushEngine production)
rg -n "brushEngine\\s*:|brushEngine," src/hooks/brushEngine \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx'

# Direct persistence method names outside document adapter
rg -n "\\.getLayerSnapshot\\(|\\.applyLayerSnapshot\\(|\\.applyPaintPatch\\(|\\.restoreFullState\\(|\\.serialize\\(" \
  src/history src/stores src/utils src/hooks/canvas src/lib/colorCycle src/testing \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/__tests__/**'
```

Known production constructors today:

- `ColorCycleBrushCanvas2D.deserialize` → `new ColorCycleBrushCanvas2D`
- `ColorCycleBrushMigration.ts` → `new ColorCycleBrushCanvas2D`
- `colorCycleBrushManager` → dynamic `require(...ColorCycleBrushCanvas2D)` as `getBrushClass`
- `src/testing/*` benchmarks/parity harnesses (migrate last; not product path)

---

## 2. Definition of Done (Problem 1 closed)

All must be true:

1. **Factory is the only production constructor**
   - `createColorCycleEngine(canvas, options): ColorCycleBrushRuntimeHost`
   - `deserializeColorCycleEngine(data, canvas): ColorCycleBrushRuntimeHost`
   - Production `rg` for `new ColorCycleBrushCanvas2D` / `class ColorCycleBrushCanvas2D` is empty outside an optional temporary re-export shim.

2. **Document is sole canonical authority**
   - No module outside `src/lib/colorCycle/document/**` holds direct refs to canonical CC buffers.
   - Save / autosave / history / export require a document source (`missing-document-source` / `missing-color-cycle-document` on failure).
   - Import repair remains the only path that may invent `static-preview-only` residency.

3. **Version is universal invalidation currency**
   - Every boundary that consumes document state records `documentVersion` in diagnostics.
   - History apply asserts expected `beforeVersion` / `afterVersion` (already present; must stay green).
   - Derived surfaces rebuild or refuse render when `builtFromVersion !== document.version` (dev assert stays).

4. **Runtime host is composition-only**
   - Host implements `ColorCycleBrushRuntimeHost` from contracts.
   - Host owns **no** canonical buffers and **no** persistence decision logic.
   - Persistence decisions live in `brushPersistenceAdapter` (+ document); host only supplies side-effect callbacks (animator upload, dirty mark, store patch).

5. **Ownership table is complete and checked in**
   - Every former class field is classified: `document | derived-cache+version | stroke-local | composition-wiring`.
   - Any field still misclassified is fixed before closeout.

6. **Gates green**
   - `npm run type-check`
   - `npm run lint`
   - Characterization: `npm test -- --runInBand src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts -t "pins 1.6.0"`
   - Full engine suite + manager integration + projectIO focused CC restore
   - `npm test -- --runInBand tests/cc-runtime-parity.test.ts`
   - `npm test -- --runInBand tests/cc-layer-wipe-scenario-matrix.test.ts`
   - Playwright: `tests/cc-restore-browser-validation.spec.ts` (local dev server)
   - Optional but preferred: full `npm test -- --runInBand`

7. **Docs closed**
   - This plan and parent hard-problems doc mark Problem 1 / 1.6.8 complete with evidence links.
   - No open checkbox under Problem 1 that is required for "source of truth."

---

## 3. Non-goals (explicit)

Do **not** expand scope into:

- Problem 4 two-tier composite / DirtyTracker (use document version only as input later)
- New CC drawing features, gradient modes, dither algorithms
- Rewriting Goblet runtimes
- Generic LOC splits that do not remove an ownership blocker
- Migrating regular (non-CC) brush engine architecture
- Changing `.vs` archive binary layout or schema version (unless a bug forces a schema bump — then stop and open a separate contract change)

Rules of engagement (carry forward):

- One extraction/migration PR-sized step at a time; serial landings.
- Zero algorithm edits inside structure commits. Bugfix first, separate commit.
- Scoped freeze: while a CC ownership surface is mid-migration, no feature work on that surface.

---

## 4. Target architecture

```text
colorCycleBrushManager
  └── createColorCycleEngine(canvas, options)  →  ColorCycleBrushRuntimeHost
        ├── ColorCycleLayerDocument(s)     // canonical buffers + residency + version
        ├── settings service               // CCBrushSettings, applySettings
        ├── stroke authoring services      // paint / stamp / finalize (narrow contexts)
        ├── shape fill service             // worker jobs → document transactions
        ├── gradient / slot service        // derived caches + builtFromVersion
        ├── playback / presenter           // derived surfaces; no buffer ownership
        └── document facades               // serialize/snapshot/patch via brushPersistenceAdapter

Boundaries (always document-first):
  save/autosave  → captureColorCyclePersistenceSnapshot(documentReader)
  export         → resolveGobletColorCycleExportSource → document.snapshot @ version
  history        → capture before/after versions; refuse on mismatch
  hydration      → restoreColorCycleBrushesWithDocumentHydration
```

Host type stays `ColorCycleBrushRuntimeHost` in `colorCycleBrushContracts.ts`.
Class name `ColorCycleBrushCanvas2D` becomes a historical alias at most.

---

## 5. Execution phases

### Phase A — Freeze baseline & ownership audit (1–2 sessions)

**A1. Capture baseline hashes and gate results**

Run and record outputs in this plan’s Progress section:

```bash
npm run type-check
npm test -- --runInBand src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts -t "pins 1.6.0"
npm test -- --runInBand src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts
npm test -- --runInBand src/stores/__tests__/colorCycleBrushManager.integration.test.ts
npm test -- --runInBand tests/cc-layer-wipe-scenario-matrix.test.ts
npm test -- --runInBand tests/cc-runtime-parity.test.ts
```

If any fail, **stop**. Fix bugs before structure.

**A2. Mutable-state ownership table**

For every field/service currently wired by the host (start from `ColorCycleBrushCanvas2D` constructor + each `*ApiRuntime` private store), fill:

| Name | Module | Classification | Notes |
| --- | --- | --- | --- |
| paint/gradient/speed/flow/phase buffers | document | document | only via transactions |
| residency | document | document | cold-archive-ref / resident / static-preview-only |
| version | document | document | sole staleness token |
| animators map / RAF | presentation/playback | derived-cache+version | `builtFromVersion` |
| slot palette rows | gradient service | derived-cache+version | |
| stamp dither tile maps | strokeStampDither runtime | derived-cache+version | already partially versioned |
| concentricWorkerJobId | shape fill job state | stroke-local / job lifecycle | not document |
| activeLayerId / isolated | layer binding state | composition-wiring | not canonical paint |
| settings snapshot | settings service | composition-wiring | not document paint |
| committed-state caches | persistence adapter | derived or document-adjacent | must not outrank document |

Deliverable: checked-in table in this file under **Appendix A** (or a sibling `docs/refactor/cc-runtime-ownership-table.md`).
Any row classified wrong → fix in a **small ownership PR** before factory cutover if it can write paint without a transaction.

**A3. Controller-context audit**

```bash
rg -n "brushEngine\\s*:|brushEngine," src/hooks/brushEngine --glob '!**/*.test.ts'
rg -n "as ColorCycleBrushCanvas2D|instanceof ColorCycleBrushCanvas2D" src --glob '!**/*.test.ts'
```

Action:

- Production `brushEngine/` must not pass the host as opaque context.
- Prefer existing narrow interfaces already used by finalize/reset controllers.
- Tests may cast to host type for harnesses; production may not.

Exit A: baseline green + ownership table committed + zero full-engine context in `brushEngine/` production.

---

### Phase B — Factory cutover (1.6.8 core)

**B1. Introduce factory module (behavior-neutral)**

Create:

- `src/hooks/brushEngine/createColorCycleEngine.ts`
  - `createColorCycleEngine(canvas, options): ColorCycleBrushRuntimeHost`
  - `deserializeColorCycleEngine(data, canvas): ColorCycleBrushRuntimeHost`

Implementation strategy (strangler, not rewrite):

1. Move constructor body + service wiring from `ColorCycleBrushCanvas2D` into factory closures **or** into a non-exported `createColorCycleEngineImpl` that returns a plain object implementing the host interface.
2. Prefer **object host** (methods as closures) over class. If intermediate step needs a private class, name it `ColorCycleBrushRuntimeImpl` and do not export it.
3. Reuse existing `*ApiRuntime` modules unchanged in the first PR.
4. Keep `ColorCycleBrushCanvas2D` temporarily as:

```ts
// temporary compatibility
export class ColorCycleBrushCanvas2D /* implements RuntimeHost */ {
  // either thin subclass/wrapper OR
}
// better: deprecate class, re-export factory for one PR if needed
export { createColorCycleEngine, deserializeColorCycleEngine };
```

First PR goal: factory exists and characterization suite can construct via factory **without** deleting the class yet.

**B2. Wire production constructors to factory**

| Call site | Change |
| --- | --- |
| `colorCycleBrushManager.ts` `getColorCycleBrushCanvas2D` | become `getCreateColorCycleEngine()` dynamic import of factory |
| `colorCycleBrushRegistry.ts` `getBrushClass` / `new BrushClass(...)` | call `createColorCycleEngine(...)` (deps type: factory, not constructor) |
| `ColorCycleBrushMigration.ts` | `createColorCycleEngine(...)` |
| `ColorCycleBrushCanvas2D.deserialize` | implement as thin call to `deserializeColorCycleEngine` then delete |
| Goblet / projectIO restore paths | already document-facade oriented; ensure no direct `new` |

Update `colorCycleBrushContracts.ts`:

- Keep `ColorCycleBrushRuntimeHost` as the public type.
- Replace any `typeof ColorCycleBrushCanvas2D` constructor types with:

```ts
export type CreateColorCycleEngine = (
  canvas: HTMLCanvasElement,
  options?: ColorCycleBrushCanvas2DOptions,
) => ColorCycleBrushRuntimeHost;
```

**B3. Migrate tests/harnesses**

Order:

1. Characterization + regression tests (must stay hash-identical).
2. Manager integration tests.
3. `src/testing/*` benchmarks (can lag one PR; not product path).

Rename test file only after class is gone:

- Keep filename `ColorCycleBrushCanvas2D.test.ts` during transition **or** rename to `colorCycleEngine.characterization.test.ts` in the same PR that deletes the class (avoid double churn).

**B4. Delete class / leave shim**

Preferred end state:

- Delete `ColorCycleBrushCanvas2D.ts` entirely.
- Optional one-release shim file that only re-exports factory + host type with `@deprecated` JSDoc.

Hard exit greps (must pass):

```bash
rg -n "class ColorCycleBrushCanvas2D|new ColorCycleBrushCanvas2D|ColorCycleBrushCanvas2D\\.deserialize" src \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
# allow zero hits, or only a documented deprecated re-export path
```

Exit B: factory is sole production construction path; characterization hashes unchanged.

---

### Phase C — Remove host persistence face completely

Even after factory, the host may still expose snapshot methods used only by adapter bridges.

**C1. Host stops being a persistence object**

- Public host surface for persistence is **only** whatever `ColorCycleBrushRuntimeHost` must expose for canvas/stroke/playback.
- Snapshot/serialize/restore live exclusively behind:

  - `readColorCycleBrush*FromRuntime`
  - `applyColorCycleBrush*ToRuntime`
  - `restoreColorCycleBrushSerializedStateToRuntime`

- Internal host methods used by those facades become package-private helpers or adapter-injected callbacks — not part of the public host type if avoidable.

**C2. Adapter no longer depends on class method names**

Today adapter bridges through runtime method names that mirror the old class API. Target:

- Runtime implements a small internal interface, e.g. `ColorCycleBrushPersistenceRuntimeHooks`, defined next to the adapter.
- Host provides hooks object at construction; adapter never calls `host.serialize()` by duck typing public product API.

**C3. Assert fail-closed document paths remain**

Re-run:

- `captureColorCyclePersistenceSnapshot` tests (missing document)
- Goblet export source resolver (missing document)
- history version mismatch tests

Exit C: `rg` for public host persistence methods in contracts is empty or clearly non-canonical; all boundaries use document facades.

---

### Phase D — Version diagnostics uniformity

**D1. Boundary checklist**

For each boundary, verify and log `documentVersion`:

| Boundary | Module | Required diagnostic field |
| --- | --- | --- |
| Canonical save | `captureColorCyclePersistenceSnapshot` | `documentVersion` |
| Autosave | same | `documentVersion` |
| History capture | `history/helpers/colorCycle` + deltas | `beforeVersion` / `afterVersion` |
| Goblet export | `colorCycleExportSourceResolver` | `documentVersion` (already) |
| Hydration/warmup | `document/hydration.ts` | `documentVersion` (already partial) |
| Layer wipe / clear audits | mutation audit | version after commit |

**D2. Dev asserts**

- When history apply sees version mismatch → refuse apply + diagnostic (exists; keep).
- When export pins version N and re-reads version M mid-export → fail export (add if missing).
- When presenter renders with stale `builtFromVersion` and no scheduled rebuild → throttled dev assert (exists; keep).

**D3. Tests**

Add/extend unit tests that:

1. Bump document via a transaction mid-flight and assert boundary sees either pinned old version or fails closed — never silently mixes versions.
2. Confirm save diagnostics include `documentVersion` for document-backed layers.

Exit D: every consumer path has a test that mentions version pinning or mismatch.

---

### Phase E — Guardrails so Problem 1 cannot regress

**E1. Lint / CI static checks**

Add or extend scripts (prefer `scripts/` + package.json script):

1. **No production class construction** of deleted god class (rg gate in CI).
2. **No direct buffer field access** outside document module (already ESLint; keep).
3. **No new `layer.colorCycleData.*Buffer` mirrors** (already).
4. Optional: fail if a new file under `brushEngine/` imports `useAppStore` directly for canonical paint mutation.

**E2. Module-size policy for brushEngine**

Apply soft/hard budgets only to **composition roots and new services**, not blind splits:

- Soft: 400 LOC
- Hard: 700 LOC for composition roots (`createColorCycleEngine.ts`, host impl)

Splits allowed only when they remove a listed blocker (engine context, unversioned cache, non-document buffer ownership).

**E3. Characterization is permanent contract**

- Keep 1.6.0 fixture forever (rename ok).
- Any intentional hash change requires a separate commit message explaining the semantic change + contract/doc update if export-visible.

**E4. Agent / PR checklist addition**

Add to PR notes when touching CC:

- [ ] Did this mutate canonical buffers only via document transactions?
- [ ] Did save/export/history still pin `documentVersion`?
- [ ] Did characterization still pass without hash edits?
- [ ] Was construction only via `createColorCycleEngine`?

Exit E: CI gates committed; checklist documented in this plan + short pointer from parent hard-problems doc.

---

### Phase F — Closeout proof pack

Run full closeout sequence and paste evidence into Progress:

```bash
# Structure greps
rg -n "class ColorCycleBrushCanvas2D|new ColorCycleBrushCanvas2D|ColorCycleBrushCanvas2D\\.deserialize" src \
  --glob '!**/__tests__/**' --glob '!**/*.test.ts' --glob '!**/*.test.tsx'

# Authority greps
rg -n "colorCycleData\\.(gradientIdBuffer|gradientDefIdBuffer|phaseBuffer|smoothPhaseBuffer)" src \
  --glob '!src/lib/colorCycle/document/**'

# Automated
npm run type-check
npm run lint
npm test -- --runInBand src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts
npm test -- --runInBand src/lib/colorCycle/document/__tests__/ColorCycleLayerDocument.test.ts
npm test -- --runInBand src/lib/colorCycle/document/__tests__/brushPersistenceAdapter.test.ts
npm test -- --runInBand src/lib/colorCycle/persistence/__tests__/captureColorCyclePersistenceSnapshot.test.ts
npm test -- --runInBand src/stores/__tests__/colorCycleBrushManager.integration.test.ts
npm test -- --runInBand src/history/deltas/__tests__/colorCycleStrokePatchDelta.test.ts
npm test -- --runInBand src/history/deltas/__tests__/colorCycleStrokeDelta.undo.test.ts
npm test -- --runInBand tests/cc-layer-wipe-scenario-matrix.test.ts
npm test -- --runInBand tests/cc-runtime-parity.test.ts
npm test -- --runInBand src/utils/__tests__/projectIO.test.ts

# Browser (dev server required)
npx playwright test tests/cc-restore-browser-validation.spec.ts --reporter=line
```

Manual smoke (short):

1. New CC brush stroke → animate → save → reload → still animates.
2. Undo/redo one CC stroke.
3. Shape fill finalize on CC layer.
4. Export Goblet2 → open → playback matches editor qualitatively.
5. Cold/legacy project path if a fixture is available (static-preview-only stays non-editable).

Mark parent plan Problem 1 complete only when F passes.

---

## 6. Suggested PR / commit breakdown

Keep each commit landable alone:

| Step | Commit intent | Approx files |
| --- | --- | --- |
| A | `docs: record CC runtime ownership audit for Problem 1 closeout` | this plan + ownership table |
| B1 | `refactor: add createColorCycleEngine factory without deleting class` | `createColorCycleEngine.ts`, class delegates or dual-path |
| B2 | `refactor: construct CC runtime via factory in manager/migration` | manager, registry, migration, contracts |
| B3 | `test: construct CC characterization host via factory` | tests |
| B4 | `refactor: remove ColorCycleBrushCanvas2D class` | delete/shim + import updates |
| C | `refactor: remove public CC host persistence surface` | contracts, adapter, host |
| D | `fix/test: pin documentVersion at all CC boundaries` | persistence/history/export diagnostics + tests |
| E | `chore: add CI gates for CC document authority` | scripts, package.json, eslint if needed |
| F | `docs: close Problem 1 source-of-truth plan` | this plan + hard-problems parent |

Do not squash B1–B4 into one mega-commit if anything fails mid-way; bisection matters.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Characterization hash drift from accidental algorithm touch | medium | high | zero algorithm edits; separate bugfix commits |
| Manager dynamic require race / circular import after factory move | medium | high | keep dynamic import; factory in brushEngine, manager stays store-side |
| Test doubles that stub class methods break | high | medium | update doubles to host interface / factory |
| Hidden production `instanceof ColorCycleBrushCanvas2D` | low | high | grep in Phase A/F |
| Persistence facade still needs host hooks → incomplete C | medium | medium | define explicit hooks interface; don't leave duck-typed serialize |
| Scope creep into performance composite | high (social) | high | non-goals section; refuse PRs that mix 4.x work |
| Temporary dual construction (class + factory) confuses agents | medium | medium | time-box dual path to one PR series; delete class quickly |

Rollback rule: if a step fails gates, **revert that step fully** before trying another approach (AGENTS.md evidence discipline).

---

## 8. Sequencing relative to other problems

```text
Problem 1 closeout (this plan)
   │
   ├─ unblocks cleaner Problem 3 history work (versions already there; host noise drops)
   ├─ unblocks Problem 5 boundary lint (document-only buffers are easier to enforce)
   └─ provides version currency for Problem 4 DirtyTracker / two-tier composite

Problem 2 Goblet parity: largely done; only consume document snapshots — do not reopen here
Problem 6 process gates: can land E-phase greps in parallel late in this plan
```

Do **not** start Problem 4 two-tier composite until Phase B factory cutover is green. Presenter already extracted; composite scheduling is a separate product of versions, not of the class shell.

---

## 9. Effort estimate (planning only)

| Phase | Effort (focused eng days) | Notes |
| --- | --- | --- |
| A audit | 0.5–1 | mostly greps + table |
| B factory cutover | 2–4 | riskiest import graph |
| C persistence face | 1–2 | careful type cleanup |
| D version diagnostics | 0.5–1 | mostly tests if code mostly done |
| E guardrails | 0.5 | scripts + CI |
| F proof pack | 0.5–1 | full suite + Playwright |

Total: roughly **5–10 focused days**, not calendar weeks of greenfield rewrite — most extraction already landed.

---

## 10. Immediate next action

Start **Phase A** only:

1. Run baseline gates; paste results under Progress.
2. Produce ownership table Appendix A from live host + `*ApiRuntime` fields.
3. Confirm controller-context greps are clean in `brushEngine/`.
4. Open PR `docs: CC Problem 1 closeout plan + ownership audit` — no runtime code yet.

Then execute B1.

---

## Progress

### 2026-07-09 — Plan authored

- Plan created from live codebase state + parent hard-problems doc.
- Open work identified as: 1.6.8 factory cutover, residual host persistence face, ownership audit formalization, version diagnostic uniformity, regression gates.
- Phases 1.1–1.5 and 1.6.0–1.6.7 treated as complete inputs, not redo targets.

### Baseline (to fill in Phase A)

- [ ] `npm run type-check`
- [ ] characterization `pins 1.6.0`
- [ ] full `ColorCycleBrushCanvas2D` test suite
- [ ] manager integration
- [ ] cc-layer-wipe matrix
- [ ] cc-runtime-parity
- [ ] ownership table Appendix A completed
- [ ] controller-context greps recorded

### Execution checkboxes

- [ ] A complete
- [ ] B1 factory exists
- [ ] B2 production uses factory
- [ ] B3 tests use factory
- [ ] B4 class deleted / shim-only
- [ ] C host persistence face removed
- [ ] D version diagnostics uniform + tested
- [ ] E CI gates landed
- [ ] F proof pack green
- [ ] Parent Problem 1 marked complete

---

## Appendix A — Ownership table (fill during Phase A)

| Name | Module | Classification | Notes |
| --- | --- | --- | --- |
| _TBD during A2_ | | | |

---

## Appendix B — Key file map

| Concern | Path |
| --- | --- |
| Document | `src/lib/colorCycle/document/ColorCycleLayerDocument.ts` |
| Contract / schema spine | `src/lib/colorCycle/document/colorCycleDocumentContract.ts` |
| Persistence adapter | `src/lib/colorCycle/document/brushPersistenceAdapter.ts` |
| Hydration | `src/lib/colorCycle/document/hydration.ts` |
| Snapshot service | `src/lib/colorCycle/persistence/captureColorCyclePersistenceSnapshot.ts` |
| Host contracts | `src/hooks/brushEngine/colorCycleBrushContracts.ts` |
| Current composition shell | `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` |
| Future factory | `src/hooks/brushEngine/createColorCycleEngine.ts` (to add) |
| Manager | `src/stores/colorCycleBrushManager.ts`, `colorCycleBrushRegistry.ts` |
| Export source | `src/utils/export/goblet/colorCycleExportSourceResolver.ts` |
| Characterization | `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts` |
| Parent plan | `docs/refactor/plan-hard-problems-architecture-2026-07-05.md` |
