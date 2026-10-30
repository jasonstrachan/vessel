# Color-cycle architecture implementation

Date: 2026-10-30
Status: complete — implementation, review and verification finished (2026-10-31)

## Outcome

Complete the existing document and playback boundaries without changing brush
appearance, indexed channel semantics, project archives, or Goblet schema 2.
Preserve the unrelated UI changes in the working tree and stay on this branch.

## Pre-change owning paths (baseline)

Input reaches `ColorCycleBrushCanvas2D` through canvas handlers. Mutable stroke
buffers and palette bindings are published to `ColorCycleLayerDocument`; history,
save and Goblet export already require that document. Brush playback currently
owns a RAF per controller, recolor owns another RAF, and presentation uses the
shared animation runtime. The compositor worker only acknowledges commands and
returns empty frames; fill workers perform real computation.

## Sequence and file boundaries

Only one step is active. Explain and record any expansion before editing files
outside the active boundary. Tests and generated Goblet assets are included only
when their owning source changes.

1. **Complete: shared playback scheduling.** Move the existing scheduling primitive
   to `src/runtime/playback/animationRuntime.ts`, preserving its old re-export.
   Register brush and recolor playback with that scheduler; pass elapsed time to
   brush animation instead of deriving real time from render count. Preserve
   explicit one-frame updates for callers that omit a delta. Files:
   `src/hooks/canvas/handlers/animation/animationRuntime.ts`, the new runtime module
   and its test, `src/hooks/brushEngine/colorCyclePlaybackController.ts` and its
   test, `src/lib/ColorCycleAnimator.ts`,
   `src/lib/colorCycle/RecolorAnimationController.ts` and its test,
   `tests/cc-runtime-parity.test.ts`, this plan.
   Exit: one RAF for registered playback consumers; pause/resume excludes paused
   time; delayed frames preserve elapsed playback time; editor/Goblet parity holds.
2. **Complete: runtime identity.** Remove the brush-map mirror in
   `src/stores/colorCycleBrushRegistry.ts`; retain independent cold documents and
   derive compatibility views. Update its integration tests. Document replacement
   must update the live runtime and attached brush together. Cleanup must remove
   cold/orphan documents as well as active renderers.
3. **Complete: remove inactive compositor wiring.** Remove the compositor worker
   hook and its configuration/ref plumbing from canvas setup builders/stages.
   Remove exclusively unused compositor client/worker/support modules and tests
   after searching references. Preserve fill workers and their tests. Update
   `docs/refactor/module-size-guardrails.md` if a composition boundary changes.
4. **Complete: edit and gradient ownership.** The document owns committed erase
   and soft-edge alpha alongside channels and bindings. Layer canvases and stroke
   buffers are mutable projections. Stroke finalization stages pixels/bindings,
   heals masks synchronously and publishes one generation. Failed or cancelled
   edits leave committed reads unchanged; rollback explicitly clears introduced
   projection fields. History/save/export use canonical masks, and archive-backed
   cold documents retain them without waking a renderer. Pure gradient preparation
   and atomic paired allocation remain at their existing seams. Exact boundaries
   and the failure/visibility contract are recorded below.
5. **Assessment complete; storage change deferred: publication cost.** Measure complete browser stroke finalization,
   alongside the existing document publication benchmark. Use the measurements
   to decide whether region/tile copy-on-write is justified. Do not substitute
   mutable shared generations for immutable history. List exact files if a
   performance patch is needed. Exit: measured decision recorded; any patch has
   before/after evidence and covers all six channels.
6. **Complete: final verification and code review; scoped commit authorized.** Run focused tests after each step, then type
   check, lint, architecture checks and relevant parity tests. Build with the
   production preview owner (no competing build). In one persistent background
   browser tab verify drawing, pause/resume, speed/FPS changes, masks, undo/redo,
   save/reload and exported playback. Close the named browser session. Record
   failures and limits accurately; review/fix the full scoped diff and commit it.

## Verification baseline

Read-only review: 175 focused tests passed across 14 suites. The 4K publication
microbenchmark copied 58,060,800 bytes per pixel-changing publication, median
6.443 ms and maximum 16.925 ms over five measured samples on Node 26.5.0 arm64.
This does not establish browser frame or interaction performance.

## Non-goals

No visual redesign, new brush modes, new dither algorithms, archive/schema
migration, generic plugin framework, WebGPU port, push, or deployment.

## First implementation evidence (2026-10-30)

- Plan saved before implementation; existing runtime and persistence owners traced.
- Playback regression tests reproduced multiple RAFs, paused scheduling and FPS
  changes dropping elapsed time. The old production preview reproduced two RAF
  requests and both paused controllers remaining scheduled. Shared scheduling,
  delayed-frame/resume tests, and elapsed-time editor/Goblet pixel parity now pass.
- Registry regressions reproduced stale runtime document replacement and cold
  orphan leakage; all 26 registry tests pass after using the document map as
  authority, deriving the brush compatibility view from runtimes, and including
  cold documents in cleanup.
- Step 3 exact boundary: canvas setup/visual bridges, core refs, visual options
  builder and visual stage; the worker-init hook; compositor worker, URL, types,
  client, mock and two obsolete tests; worker tsconfig and Jest mapper;
  feature flag source/test and debug toggle; canvas smoke test; README and module
  guardrail documentation. This is required removal of one unused pipeline,
  not changes to the fill-worker implementation or brush algorithms.
- Step 4 exact boundary so far: `src/utils/colorCycleGradientDefs.ts` and its test,
  `colorCycleGradientSourceContract.ts` and its existing test,
  `ColorCycleLayerDocument.ts` and its test,
  `colorCycleRuntimeDocumentState.ts` and its test,
  `ColorCycleBrushCanvas2D.ts`, and removal of the metadata API forwarding class.
  Fixed dither ink pairs now prepare both bindings before publishing once.
  Regressions prove no partial binding on capacity failure, stale transactions
  cannot overwrite newer generations, sampled-path metadata is cloned/frozen and
  compared for versioning, and invalid runtime publication is rejected before
  installing replacement stroke state. These changes do not yet move masks into
  the canonical document or make every stroke-side mutation a document transaction.
- Playback scope expanded to `SimplifiedColorCycleManager.ts` and the shared
  scheduling test: the canvas presentation manager was another active continuous
  RAF owner. It now subscribes to the same runtime. Composition shells stay at
  79/44/70 lines for drawing handlers/canvas/event handlers.
- `PlaybackRuntimeController.ts` imports the scheduler from its runtime owner;
  the old hook module remains a compatibility re-export for existing consumers.
  Updated `colorCyclePlayback.sharedRuntime.test.ts` to inject its scheduler mock
  at that new owning module rather than at the legacy event-hook facade.
- Preliminary checks: 182 targeted tests passed; lint and architecture checks
  passed. Production preview build passed. A concurrent Studio build removed
  generated type files during the initial type check; nonincremental recheck
  passed. Worker type check found existing `Object.hasOwn` calls outside its
  ES2020 library declaration; investigate separately from runtime changes.
- The first detached 4K brush timing probe yielded zero paint and is excluded from
  performance evidence. Browser measurement must use initialized real layer input.

## Production verification and measured decision

- Real pointer strokes at 3840 x 2160 produced 14,865 canonical painted pixels.
  Four completed instrumented finalizations measured 75.8, 76.7, 80.4 and 75.4 ms;
  document publication inside them measured 9.9, 10.4, 10.8 and 10.3 ms. The fifth
  gesture was not included because its asynchronous finalization had not completed
  when instrumentation was removed. These are local headless-browser samples,
  not general device budgets or before/after performance claims.
- Keep existing immutable full generations for now. Publication accounted for
  roughly one seventh of measured finalization; isolate the remaining finalizer
  work before introducing tiled ownership across history, selection and export.
  A tile migration remains an independently measured follow-up, not implemented.
- In the final production preview, real pointer drawing produced 4,224 painted
  pixels. Undo cleared them; redo restored identical hashes for all six channels.
  Playback paused and resumed, and speed/FPS changes remained functional.
- Applied a soft-edge mask and used the real eraser tool. Undo restored the blank
  erase mask and redo restored erased coverage. Saving 17,925 bytes and loading
  through the actual file-input UI preserved all six channel hashes and exact
  erase/soft-edge mask hashes. Load correctly rebased the document to version 0.
- The consolidated final-build rerun also passed drawing, playback, mask editing,
  undo/redo and save/reload. Its saved archive was 17,913 bytes; all six channel
  hashes plus both mask hashes matched the committed state after reload. Browser
  input uses the real mask version to observe commits; the legacy store history
  stack is not used as a completion signal.
- Exported Single HTML through the modal. The exact artifact preview retained
  76,800 visible pixels and changed frame hash from 1604715928 to 3264466949 over
  60 animation frames. Export left all editor channels, masks and document version
  unchanged. Download was written locally; nothing was published externally.
- Final-build artifact recheck likewise passed: 76,800 visible pixels with frame
  hashes 3608728567 then 81529671 over 60 animation frames, unchanged editor
  channels/masks/version, and no extra RAF for two probe brushes; both paused
  probe registrations were removed.
- Closed the named `vessel-cc-architecture` Playwright session; cleanup confirmed
  that no matching daemon remained.
- The old production scheduling probe requested two native RAFs and retained both
  paused registrations. The rebuilt preview requested zero additional RAFs for two
  probe brushes because the shared scheduler was already running; both brushes
  unregistered on pause. Deterministic tests also verify one native RAF when
  starting from an idle scheduler, including canvas presentation consumers.
- Registry `brushes` is now a read-only compatibility snapshot derived from runtime
  entries. Internal callers must register restored brushes through the manager,
  rather than insert into a second mutable brush map. No production callers wrote
  that mirror. The independently retained document map supports cold layers.

## First implementation checks and then-open work

- Full Jest run: 629 suites / 6,715 tests passed, one suite/test skipped. One
  unrelated UI test failed: `src/app/__tests__/page.ssr.test.tsx:259` expects
  `min-h-48`, while the pre-existing `HomeClient.tsx` changes use `min-h-[40%]`.
  That UI work was preserved. The subsequent canvas-presentation scheduler change
  passed its four scheduling tests plus the affected renderer/shared-runtime tests
  (43 tests across three suites).
- Final scheduler mock migration check: 42 tests across five suites passed,
  including shared-runtime integration, brush/recolor scheduling and editor/Goblet
  rendered parity. Whitespace checks passed; no commit or push was made.
- Type-check (nonincremental), test type-check, lint, architecture guardrails,
  production-preview build, playback-change gate and generated Goblet runtime
  freshness checks passed. Worker type-check reports unchanged `Object.hasOwn`
  uses in `jsonArchive.ts:123` and `projectIO.ts:5810` against its ES2020 library
  declaration. This existing compiler-library mismatch is outside the runtime fix.
- Full mask ownership and a transaction encompassing pixels, bindings and masks
  remain open. Masks still have a separate layer/MaskManager owner, and live stroke
  buffers still mutate before publication. Do not describe this pass as completing
  the entire architecture migration. The snapshot/transaction and paired-binding
  defects above are fixed without a file-format or brush-algorithm change.

## Astra review: revised edit contract (2026-10-31)

Step 4 established the following contract. The document owns committed pixels, gradient bindings, erase
alpha and soft-edge alpha/enabled state. Canvas masks and stroke buffers are
mutable editing/presentation projections. History, save and export pin one
committed read; while finalization is pending they see the previous generation.
A successful edit publishes all channels and masks together. Cancellation or a
failed preparation/validation publishes nothing. Concurrent edit admission fails;
a baseline replacement invalidates outstanding edits, whose completion must not
overwrite the replacement. Old generations remain independent of mutable inputs.

Next source boundary (and their colocated tests): document contract/state/document
and mask conversion helper; runtime document state and stroke commit/commit helpers;
layer update and mask edit actions; erase/soft mask history deltas and history
capture; project serialization and Goblet source resolution. Changes to the
brush persistence adapter are limited to explicit preview reads for finalization.
Additional writers discovered while tracing will be recorded before editing.

Completion requires tests for rejected/stale/cancelled edits, reads during an
unfinished finalization, and immutable prior masks; no persistence reader may
capture live mask canvases when a canonical document exists. Production checks
must cover drawing and mask healing, erase/soft-edge undo/redo, save/reload, and
exported fully erased and partially transparent pixels at matching phases.
Tiles remain deferred. Final review must address actionable issues in the scoped
implementation; commit only task files, preserving unrelated UI work.

Scope expansion during tracing: mask history uses existing version anchors, so
its patch delta and assertions must be updated for masks becoming canonical.
Restore rebase preserves canonical masks when rebuilding indexed runtime state.
Persistence snapshot cloning must clone mask alpha alongside the six channels;
its existing snapshot module is included for that ownership requirement.

Review follow-up boundary: export integration fixtures now construct canonical
mask fields; they must exercise the new document contract rather than rely on
live canvases outside it. The crop roundtrip regression exposed an incidental
playback update republishing restored metadata; layer updates now publish only
when authored metadata differs from the previous projection. Runtime scheduler
self-replacement also has a regression test and a single-callback fix.

Final review expansion: `document/hydration.ts` and its tests must initialize masks
for archive-backed cold documents. Cold persistence capture must merge those
canonical masks with archive pixel references, so a save before renderer activation
cannot omit masks. History capture tests now prove live projections are not read.

`layerColorCycleMaskState.ts` is included for the clear-mask history capture seam:
when a canonical read exists, capture its mask and version anchors rather than
reading the editing canvas. Canvas-only compatibility remains for legacy layers.

Rollback review boundary: `layersSliceTypes.ts` and the existing color-cycle layer
update tests are included. A failed finalizer must explicitly clear metadata and
mask fields introduced by its provisional work; default patch merging ignores
undefined fields. An opt-in field-clear option repairs that owning contract while
preserving the default patch behavior. Rollback also restores the previous def-ID
allocator hint and complete edit metadata.

## Final implementation and review (2026-10-31)

The first implementation's open mask ownership work is now implemented. The
canonical document stores both mask alpha channels and enabled/version metadata;
project archives and Goblet schema 2 keep their existing representation. Restore
and render surfaces are projections. Document reads during staged finalization
return the previous committed generation; runtime-only reads explicitly request
preview state. Replacing the baseline invalidates pending edits.

Review fixes include stale/overlapping edit rejection, atomic mask healing,
mask-copy isolation, crop/history anchor preservation, cold archive mask capture,
canonical clear-mask history capture, explicit rollback field removal, and avoiding
a second RAF when the final scheduler consumer replaces itself during a frame.
Legacy export fixture masks now enter through the canonical contract. A stale
cached canvas cannot override an explicitly absent canonical mask.

Production checks so far: pointer drawing and all-six-channel undo/redo; soft-mask
undo/redo; eraser undo/redo; exact channel and mask-alpha save/reload. A generated
partial-alpha fixture survived actual archive save/load and matched every one of
76,800 exported WebGL artwork alpha pixels at time 0 and 1.25 seconds, including
alpha 128 and fully erased pixels. The viewer adds an opaque checkerboard after
artwork composition; parity therefore reads the actual exported layer render
before that presentation background. No color/phase inference is made from alpha.

Verification is repeated on a task-only source snapshot: unrelated UI changes
cause an existing SSR assertion failure, and the concurrent Studio service can
remove generated files while the broad preview-copy script scans them. The
snapshot preserves the current branch and UI work while isolating the intended
commit. Final counts, build, browser rerun and commit outcome will be recorded
when complete. Tiled storage remains deliberately deferred based on the measured
publication/finalization cost; it is not unfinished scope in this implementation.

The lifecycle integration fixture is included: its mocked `ensureDocument` must
return a real document, as required by the manager contract now used to initialize
cold masks. Production behavior is verified through actual archive loading.

Final metadata review also reproduced opacity-only palette/definition changes
being treated as equal. The owning document comparator now includes stop opacity;
two regression cases prove version advancement and prior-generation isolation.

Runtime read/cache version review: internal runtime cache keys now use the same
preview version as their snapshot during staged finalization, reverting on cancel.
A regression test distinguishes that preview from the committed persistence read.

## Final acceptance

- Task-only full suite: **630 suites / 6,722 tests passed**, one suite/test skipped;
  both snapshots passed. This includes the baseline UI SSR test, which passes when
  unrelated UI changes are excluded from the intended commit.
- Nonincremental type-check, test type-check, lint, architecture checks, playback
  change gate, Goblet runtime freshness and isolated production build passed.
  Every task source file matched the verified snapshot before commit.
- The consolidated final-build browser check passed all six stages: drawing /
  playback / indexed undo-redo / mask undo-redo / save-reload; exported mask parity;
  1600 x 900 archive roundtrip; cold save without a brush; opacity-only edits; and
  soft-mask clear / undo / redo. The cold layer remained `cold` with no brush
  through loading and saving, and recovered exact channel/mask hashes on activation.
- Exported WebGL artwork matched all 76,800 alpha pixels at 0 and 1.25 seconds,
  including fully erased cells and alpha 128. Opacity edits advanced versions
  1 → 2 → 3 while reusing the unchanged paint buffer. Soft-mask clear history
  restored exact canonical alpha on undo and removed it again on redo.
- The browser harness waits for the load-modal heading before dispatching file
  input; otherwise its drop handler can race the modal's React open state. No
  product patch was made for that automation timing issue.
- The existing worker compiler check still reports `Object.hasOwn` against its
  ES2020 library in `jsonArchive.ts` / `projectIO.ts`; those calls and the worker
  library target predate this work. This is separate from the passing runtime,
  application, build and test gates.
- Review findings were fixed and rechecked. Commit scope is 74 task paths,
  including removal of the inactive worker pipeline. Unrelated UI work, icons,
  notices and UI documentation are excluded. No push or external publication.
