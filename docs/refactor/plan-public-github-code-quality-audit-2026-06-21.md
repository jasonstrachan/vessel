# Public GitHub Code Quality Audit Plan

## Goal

Prepare Vessel for a public GitHub release by running a strict maintainability audit, cleaning high-confidence code-quality issues, and verifying the repo through production-like checks.

## Review Standard

Use the thermo-nuclear code quality bar:

- Prefer structural simplification over cosmetic cleanup.
- Delete complexity where possible instead of spreading it across more files.
- Treat ad-hoc branches, feature leakage, cast-heavy contracts, and thin wrappers as design smells.
- Keep runtime/export/persistence behavior aligned, especially for color-cycle and Goblet paths.
- Keep changes small, evidence-backed, and behavior-preserving unless a behavior change is explicitly approved.

## Phase 1: Baseline Inventory

- Confirm working tree, branch, and remote state.
- Snapshot `git status --short` before any edit.
- Classify every pre-existing dirty path as:
  - in scope for this audit,
  - unrelated user work to preserve,
  - generated/ignored output to ignore.
- Do not stage broad pathsets. Stage only explicit files for each cleanup commit.
- Read the current public-facing docs and repo config:
  - `README.md`
  - `docs/readme.md`
  - `package.json`
  - `next.config.ts`
  - `tsconfig.json`
  - relevant `docs/refactor/` guardrails
- Capture the command surface and release gates:
  - `npm run architecture:check`
  - `npm run type-check`
  - `npm run lint`
  - `npm test`
  - `npm run verify:goblet2-inline`
  - `mise exec node@18.20.8 -- npm run build:github`
- Produce a short risk map before edits.

## Phase 2: Codebase Audit

Audit the codebase for structural risks first, then smaller hygiene issues.

Primary targets:

- Oversized implementation files and orchestration shells.
- Runtime/export/persistence seams.
- Color-cycle document-state ownership.
- Goblet serializer/runtime parity.
- Store startup and persistence boundaries.
- UI components that mix presentation, storage, and workflow logic.
- Public-release hygiene issues in docs, scripts, tests, and config.

Known size hotspots to inspect:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
- `src/utils/projectIO.ts`
- `src/components/toolbar/BrushControls.tsx`
- `src/stores/useAppStore.ts`
- `src/hooks/canvas/handlers/pointerHandlersRuntime.ts`
- `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts`
- `src/utils/export/goblet/gobletColorCycleSerializer.ts`

Search patterns:

- `TODO`, `FIXME`, `HACK`, `XXX`
- raw `console.*`
- `debugger`
- `@ts-ignore`, `@ts-expect-error`
- broad `any`, `unknown`, and cast-heavy contracts
- stale debug globals or temporary diagnostics
- unreferenced modules and duplicate helpers

Required audit output before edits:

| Finding | Owner seam | Code-judo simplification | Blast radius | Verification path | Decision |
| --- | --- | --- | --- | --- | --- |
| Structural issue or release risk | File/module that should own it | How to delete branches, concepts, or indirection | Files and behavior that may be affected | Targeted test/command/manual check | Fix now, defer with reason, or leave with justification |

Do not start cleanup until this table exists for the first candidate batch.

Large-file classification:

- For every production file over 1000 LOC, classify it as `extract now`, `tracked debt`, or `leave`.
- `extract now` means there is a behavior-preserving simplification with a clear owner seam and targeted verification.
- `tracked debt` requires a concrete follow-up note explaining why it is too risky or too broad for this pass.
- `leave` requires a strong structural reason, not just "it works."
- Record at least one plausible simplification candidate for each oversized production file, even if deferred.
- Any touched production file that remains over 1000 LOC must include an explicit reason in the final report.

## Phase 1 and 2 Audit Update - 2026-06-21

Status: Phase 1 and Phase 2 complete. The first Phase 3/4 cleanup batch has also been implemented against the three release-gate blockers found during the audit.

### Baseline Inventory

- Branch: `main`.
- Remote: `origin https://github.com/jasonstrachan/vessel.git`.
- Remote state: `main...origin/main [ahead 6]`.
- Starting dirty tree: only `?? docs/refactor/plan-public-github-code-quality-audit-2026-06-21.md`.
- Dirty-path classification: this plan file is in scope for the audit and is untracked user/work-in-progress documentation. No unrelated user work was present in `git status --short --branch`.
- Read for public release context: `README.md`, `docs/readme.md`, `package.json`, `next.config.ts`, `tsconfig.json`, `docs/refactor/module-size-guardrails.md`, and `scripts/check-file-budgets.mjs`.
- Public static export contract confirmed: wrapper-owned static export uses `VESSEL_STATIC_EXPORT=1`, `basePath: '/vessel'`, `assetPrefix: '/vessel/'`, and the canonical GitHub Pages build gate remains `mise exec node@18.20.8 -- npm run build:github` with the `npx -p node@18.20.8` fallback documented below.

### Command Surface Snapshot

Package scripts expose the planned gates:

- `npm run architecture:check`
- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run verify:goblet2-inline`
- `mise exec node@18.20.8 -- npm run build:github`

Gate probes run during the initial audit:

- `npm run architecture:check` failed at `architecture:budgets`: `src/stores/layers/createLayersSlice.ts` is 4273/3500 LOC.
- `npm run architecture:console` failed: one production raw console call in `src/hooks/canvas/handlers/colorCycle/colorCycleCommit.ts:687`.
- `npm run architecture:store-access` failed: two direct `useAppStore.getState()` calls in `src/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup.ts:36` and `:74`.
- Full type-check, lint, test, Goblet inline verification, and Node 18 GitHub build were run after the first cleanup batch and are recorded below.

### Short Risk Map

- Release gate blockers: architecture budgets, raw console, and direct store-access checks currently fail before deeper release validation can be trusted.
- Highest structural risk: `createLayersSlice` exceeds a blocking budget and mixes layer CRUD, group operations, composite invalidation, color-cycle hydration/runtime publication, and sequential layer cache work.
- Highest behavioral-risk seams: color-cycle runtime/export/persistence and Goblet serializer parity. These are well-covered by tests, but the files are large and cast-heavy, so cleanup should be narrow and evidence-backed.
- Public hygiene risk: tracked diagnostic/debug artifacts exist under `docs/temp.md`, `src/debug/**`, and `scripts/perf/dist/**`. These are not necessarily wrong, but they need explicit public-release disposition in Phase 5.
- Documentation hygiene risk: `docs/readme.md` still says `Last Updated: February 2026`, while README content is newer and release-build guidance has continued to change.

### First Candidate Batch Audit Table

| Finding | Owner seam | Code-judo simplification | Blast radius | Verification path | Decision |
| --- | --- | --- | --- | --- | --- |
| `createLayersSlice.ts` violates the blocking architecture budget at 4273/3500 LOC. | `src/stores/layers/**` should own layer actions by concern, with `createLayersSlice.ts` as composition. | Extract one coherent concern instead of slicing randomly. Best first cut: move composite-segment/cache invalidation helpers or layer-group operations into a sibling module and keep the public slice API stable. | Layer CRUD, selection, groups, composite dirtying, sequential cache, color-cycle runtime hydration. | `npm run architecture:budgets`, focused layers-slice tests, then `npm run architecture:check`. | Fixed in Phase 3/4. |
| One raw production console call blocks `architecture:console`: `colorCycleCommit.ts:687`. | `src/hooks/canvas/handlers/colorCycle/colorCycleCommit.ts` plus existing `debugWarn`/overlay logging utilities. | Replace the direct `console.warn` parity warning with the existing debug logger path, preserving the message and payload. | Color-cycle commit diagnostics only. | `npm run architecture:console` and focused color-cycle commit tests if nearby coverage exists. | Fixed in Phase 3/4. |
| Two direct store reads block `architecture:store-access`: `colorCycleRuntimeWarmup.ts:36` and `:74`. | Warmup caller should inject the required store accessor/action, or a tiny store-adapter helper should own the direct read outside the React/canvas scan. | Collapse direct `useAppStore.getState()` use into an explicit dependency seam so warmup stays testable and policy-compliant. | Stroke-start/shape-start edit warmup for cold color-cycle layers and feedback messages. | `npm run architecture:store-access`, `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts`, and `tests/cc-layer-wipe-scenario-matrix.test.ts` if behavior changes. | Fixed in Phase 3/4. |
| Tracked public hygiene candidates include `docs/temp.md`, `src/debug/**`, and `scripts/perf/dist/**`. | Public docs/tooling ownership; perf generated output may belong under a generated-artifact policy. | Decide whether these are intentional public artifacts; delete, move, or document them rather than leaving ambiguous debug/temp names in a public repo. | Docs, dev diagnostics, perf scripts. | `git ls-files` hygiene scan, `npm run architecture:check`, focused tests only if code moves. | Defer to Phase 5 unless a file is clearly obsolete. |
| `docs/readme.md` stale date and docs index drift. | Docs hub. | Update only public-facing stale metadata/cross-links after cleanup decisions are known. | Docs only. | Markdown review. | Defer to Phase 5. |

### Large Production File Classification

Every production `src` file over 1000 LOC was classified from the current checkout. "Tracked debt" means do not touch in the first cleanup batch unless the selected fix enters that seam naturally.

| File | LOC | Classification | Plausible simplification candidate |
| --- | ---: | --- | --- |
| `src/stores/layers/createLayersSlice.ts` | 4274 | extract now | Move layer-group or composite invalidation workflow into `src/stores/layers/` helper/factory modules while preserving the slice API. |
| `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts` | 8534 | tracked debt | Split runtime mutation audit, gradient metadata/def-store merging, and snapshot restore into owned modules after current CC parity gates are green. |
| `src/utils/projectIO.ts` | 6429 | tracked debt | Move archive binary externalization/analysis and color-cycle restore/warmup materialization into focused utilities. |
| `src/hooks/canvas/handlers/pointerHandlersRuntime.ts` | 4609 | tracked debt | Extract contour debug bridge and pointer-mode dispatch tables without changing input semantics. |
| `src/components/toolbar/BrushControls.tsx` | 4506 | tracked debt | Extract brush-family control sections such as color-cycle, resampler, spam, polygon, and default brush controls. |
| `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts` | 4443 | tracked debt | Move contour debug, fill-history context, and preview/finalize helpers into shape handler modules. |
| `src/utils/export/goblet/gobletColorCycleSerializer.ts` | 3810 | tracked debt | Split source selection, persisted-document-state conversion, mask packing, coverage cropping, and speed export helpers. |
| `src/stores/slices/toolsSlice.ts` | 2764 | tracked debt | Extract brush-setting normalization and color-cycle tool-setting helpers. |
| `src/stores/slices/selectionSlice.ts` | 2663 | tracked debt | Continue moving paste/delete/transaction helpers into `src/stores/helpers/**`. |
| `src/lib/sequential/materializer/SequentialCpuMaterializer.ts` | 2534 | tracked debt | Split materializer scheduling from pixel operation kernels. |
| `src/hooks/useBrushEngineSimplified.ts` | 2073 | tracked debt | Continue extraction only when touching a proven brush-engine behavior path. |
| `src/components/modals/ExportModal.tsx` | 2014 | tracked debt | Extract export option sections and async export-flow hook. |
| `src/hooks/brushEngine/strokeStampDither/index.ts` | 1971 | tracked debt | Split pattern/tile resolution from stamp write loop. |
| `src/hooks/canvas/handlers/shapes/shapeDrawing.ts` | 1923 | tracked debt | Extract sampled-shape finalize branches and foreground-gradient resolution. |
| `src/hooks/canvas/handlers/shapes/ccShapePreviewDitherRuntime.ts` | 1782 | tracked debt | Split preview worker orchestration from dither preview computation. |
| `src/lib/ColorCycleAnimator.ts` | 1774 | tracked debt | Separate playback timing/control from buffer upload/render coordination. |
| `src/lib/IndexBuffer.ts` | 1705 | tracked debt | Finish `paintWithIndex` migration and delete legacy paint helpers. |
| `src/hooks/brushEngine/BrushEngineFacade.ts` | 1582 | tracked debt | Extract facade adapters by brush/runtime family. |
| `src/hooks/canvas/handlers/sequential/sequentialCapture.ts` | 1536 | tracked debt | Split capture session management from frame materialization. |
| `src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts` | 1529 | tracked debt | Split WebGL resource setup, shader programs, and draw passes. |
| `src/stores/helpers/selectionPaste.ts` | 1518 | tracked debt | Split paste preparation, warmup gating, and transaction commit helpers. |
| `src/stores/slices/colorAdjustSlice.ts` | 1450 | tracked debt | Move color-adjust session helpers to `src/stores/helpers/`. |
| `src/stores/slices/projectSlice.ts` | 1423 | tracked debt | Extract save/autosave/file-backup orchestration helpers. |
| `src/types/index.ts` | 1413 | leave | Central type surface is large but intentionally declarative; candidate is later domain type split only when imports can be updated safely. |
| `src/utils/ditherAlgorithms.ts` | 1373 | tracked debt | Split algorithms by kernel/family after golden dither tests are confirmed. |
| `src/presets/brushPresets.ts` | 1360 | leave | Static preset catalog; candidate is data-only partition by brush family if bundle or ownership pressure appears. |
| `src/utils/colorCycle/ccGradientDither.ts` | 1347 | tracked debt | Extract geometry/raster helpers from dither mapping. |
| `src/stores/useAppStore.ts` | 1318 | tracked debt | Continue moving residual compatibility actions into slices/helpers; avoid public store API churn. |
| `src/utils/export/goblet/gobletExporter.ts` | 1185 | tracked debt | Split package assembly from layer/source serialization orchestration. |
| `src/hooks/canvas/handlers/shapes/ShapeFinalizeHandler.ts` | 1181 | tracked debt | Split polygon/rectangle gradient finalize helpers. |
| `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts` | 1169 | tracked debt | Split fill option normalization from commit/history side effects. |
| `src/hooks/brushEngine/shapes.ts` | 1155 | tracked debt | Split shape geometry helpers by primitive. |
| `src/utils/contourLines.ts` | 1079 | tracked debt | Split contour tracing from simplification/smoothing helpers. |
| `src/components/panels/LayersPanel.tsx` | 1074 | tracked debt | Extract row/group controls and layer action hooks. |
| `src/lib/displayFilterPipeline.js` | 1064 | tracked debt | Convert to typed modules or split filter kernels when display-filter work resumes. |
| `src/lib/sequential/SequentialLayerRenderer.ts` | 1043 | tracked debt | Separate layer frame cache policy from render draw path. |
| `src/components/BrushEditorUI.tsx` | 1032 | tracked debt | Extract brush-tip editors and preview controls. |

### Search Pattern Results

- `TODO/FIXME/HACK/XXX/debugger/@ts-*` scan found production TODOs in `IndexBuffer`, `ColorQuantizer`, `scaledBrushCache`, `ZoomControls`, and `BrushEngineFacade`; explicit opt-in `debugger` branches exist in `createLayersSlice`.
- Raw console scan is already covered by the blocking architecture check; broader console usage in tests/scripts/dev tooling is expected but should remain outside production app paths.
- Cast-heavy/`unknown` usage is concentrated in debug tooling, project persistence, color-cycle document state, Goblet export, and large runtime handlers. These are expected at serialization/runtime boundaries but should be narrowed when those seams are touched.
- Debug-global search found intentional dev overlay and runtime diagnostic globals. Public-release decision is deferred to Phase 5 rather than deleting active diagnostics blindly.

## Phase 3: Cleanup Selection

Choose the first cleanup batch by impact and confidence.

Prioritize changes that:

- preserve behavior while removing branches or moving logic to the canonical owner;
- reduce public-release risk;
- improve testability at existing seams;
- remove stale diagnostics, dead code, or obsolete public docs;
- make large files smaller only when the extraction deletes complexity or creates a clearer boundary.

Avoid:

- broad rewrites without a failing path or clear maintainability win;
- speculative CC/export changes;
- public API or project-format changes unless required;
- formatting-only churn mixed with structural cleanup.

Selection gate:

- Pick only findings whose owner seam is clear.
- Prefer fixes that delete a branch, collapse duplicate flow, or move logic to an existing canonical module.
- Reject cleanup candidates that only move complexity around.
- If a finding needs product judgment, record it as deferred instead of guessing.

## Phase 4: Implementation Loop

### Phase 3/4 Implementation Update - 2026-06-21

First cleanup batch selected the three release-gate blockers from the audit table. The changes were behavior-preserving and kept the public slice APIs stable.

Implemented:

- Replaced the color-cycle commit parity `console.warn` with `debugWarn('raw-console', ...)` in `src/hooks/canvas/handlers/colorCycle/colorCycleCommit.ts`.
- Replaced direct `useAppStore.getState()` access in `src/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup.ts` with the existing `getAppStoreState()` adapter seam.
- Reduced `src/stores/layers/createLayersSlice.ts` from 4273/3500 LOC over budget to 3438/3500 LOC by extracting layer-owned concerns into sibling modules:
  - `src/stores/layers/layerCanvasCapture.ts` for capture ROI normalization and image-data compositing.
  - `src/stores/layers/layerColorCycleMaskState.ts` for erase-mask, soft-edge mask, and color-cycle composite-source helpers.
  - `src/stores/layers/layerGroupActions.ts` for layer-group create/remove/rename/visibility actions.
  - `src/stores/layers/layerCaptureActions.ts` for canvas-to-layer capture actions.

New helper file sizes:

| File | LOC | Guardrail result |
| --- | ---: | --- |
| `src/stores/layers/layerCanvasCapture.ts` | 119 | Under guardrail. |
| `src/stores/layers/layerColorCycleMaskState.ts` | 230 | Under guardrail. |
| `src/stores/layers/layerGroupActions.ts` | 288 | Under guardrail. |
| `src/stores/layers/layerCaptureActions.ts` | 350 | Under guardrail. |

Verification run after implementation:

- `npm run architecture:console` passed.
- `npm run architecture:store-access` passed.
- `npx jest --runInBand src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleRuntimeWarmup.test.ts` passed.
- `npm run architecture:budgets` passed.
- `npx jest --runInBand src/stores/layers/__tests__/layerGroupService.test.ts src/stores/layers/__tests__/layerCompositeInvalidation.test.ts src/stores/layers/__tests__/layerCompositeRenderer.test.ts src/stores/__tests__/layersSlice.integration.test.ts` passed.
- `npm test -- --runInBand` passed: 404 suites, 2703 tests, 1 snapshot.
- `npm run lint` passed.
- `npm run type-check` passed.
- `npm run architecture:check` passed, including `createLayersSlice.ts` at 3438/3500 LOC and zero raw console/direct store-access findings.
- `npm run verify:goblet2-inline` passed.
- `mise exec node@18.20.8 -- npm run build:github` is blocked by Next.js trace collection before static export writes `out`.

Build note:

- The first Node 18 GitHub build attempt failed after static generation with a missing `.next/server/pages/_app.js.nft.json` trace file. A later clean canonical run reproduced the blocker with a missing `.next/server/app/_not-found/page.js.nft.json` trace file. Running export mode without the destructive pre-clean reproduced the `_app.js.nft.json` variant again. A normal non-export Next build succeeds, so this is isolated to the wrapper-owned static export path and is now a Phase 5 release blocker rather than stale local build-state evidence.
- Direct test evidence: `NEXT_DIST_DIR=.next-build` writes static-export files into `.next-build` but fails because Next's exporter still reads `.next/build-manifest.json`; a pre-created `.next` symlink to `.next-build` gets past trace collection but fails during `/404` export with a missing `.next/server/pages-manifest.json`. Do not ship a symlink workaround without a cleaner wrapper or upstream-compatible fix.

For each cleanup batch:

1. Re-check `git status --short` and confirm unrelated dirty paths are still excluded.
2. State the exact issue and expected behavior-preserving change.
3. Patch the smallest coherent area.
4. Run the smallest meaningful targeted verification.
5. Back out any patch that does not fix the issue or clearly improve structure.
6. Re-audit the diff for accidental behavior changes, file-size regressions, and public-release risk.
7. Stage only explicit paths and inspect:
   - `git diff --cached --name-only`
   - `git diff --cached --stat`
   - `git diff --cached --check`
8. Commit when the batch is complete.

Expected commit shape:

- `refactor:` for structural cleanup.
- `test:` for focused regression or coverage additions.
- `docs:` for public-readiness/documentation changes.
- `chore:` for release hygiene that does not affect behavior.

## Phase 5: Public GitHub Hygiene

Check for:

- secret-bearing files or accidental env references;
- ignored local artifacts that should not be published;
- stale temp/debug docs that should be removed or moved out of the public tree;
- internal-only instructions in public docs;
- broken static-export assumptions for `/vessel`;
- GitHub Pages build output consistency;
- dependency audit issues relevant to production users.

Concrete hygiene commands:

```sh
git status --short
git ls-files | rg '(^|/)(\\.env|\\.local|\\.next|out|dist|coverage|tmp|temp|debug|secret|token|key)'
git check-ignore .env .env.local .next out coverage node_modules
rg -n "SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|BEGIN .*PRIVATE KEY|localhost|127\\.0\\.0\\.1" README.md docs src scripts --glob '!docs/temp/**' --glob '!docs/notes/**'
npm audit --omit=dev
```

If available, run one secret scanner and record the result:

```sh
gitleaks detect --no-git --redact
```

If `gitleaks` is unavailable, record that it was unavailable and rely on the explicit text scans above.

Commands:

```sh
git status --short
npm audit --omit=dev
npm run architecture:check
npm run type-check
npm run lint
npm test
npm run verify:goblet2-inline
mise exec node@18.20.8 -- npm run build:github
```

The Node 18 path is the canonical release build gate:

```sh
mise exec node@18.20.8 -- npm run build:github
```

If `mise` is unavailable, use the known fallback for this checkout:

```sh
npx -p node@18.20.8 -c 'node -v && npm run build:github'
```

## Definition of Done

- Working tree is clean except for intentional, reviewed changes.
- All cleanup commits are focused and evidence-backed.
- The first-batch audit table exists and each fixed item has an owner seam, simplification, blast radius, and verification path.
- Every production file over 1000 LOC touched or inspected has an `extract now`, `tracked debt`, or `leave` classification.
- No new file crosses a size guardrail without explicit justification.
- No new ad-hoc branches or feature checks are scattered through shared paths.
- Public docs/config do not expose secrets, local-only assumptions, or stale release instructions.
- Verification gates have been run and recorded with the canonical Node 18 build path or an explicit fallback reason.
- Remaining debt is listed as explicit follow-up, not hidden in the release.

## Final Report Template

- Summary of cleanup performed.
- Dirty-tree scope at start and end.
- First-batch audit table.
- Structural risks fixed.
- Large-file classifications and follow-ups.
- Public GitHub hygiene changes.
- Verification commands and results.
- Remaining non-blocking debt.
- Any release blockers still open.
