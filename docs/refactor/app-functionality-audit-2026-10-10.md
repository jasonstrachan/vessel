# Vessel functionality audit — 10 October 2026

## Session39 — 24 October 2026: reported selection and stroke regressions

The user resumed the whole-app audit with GPT-6.1 Sol subagents and prioritized
marquee/layer deletion/deselection plus strokes that disappear until Undo.
This supersedes the historical no-subagent/model notes below. The current branch
and all unrelated work remain preserved. Areas01–19 retain their prior area
signoffs; the follow-up defects below are repaired and locally committed in375d6480e.
Areas20–26 signoffs follow; Areas27–65 remain incomplete, with no whole-app completion claimed.

- S39-01: completed marquee Escape left its bounds/mask active. Raster previews
  appeared but canonical commits outside that selection were clipped; native
  Ctrl+Z removed the selection and the next stroke stuck. Explicit Escape now
  clears the completed selection through reversible history after passive
  finalization and pending history. In-flight cancellation keeps precedence;
  changing to Brush still intentionally retains the selection until deselected.
- S39-02: CC Delete → Undo → Delete was a silent no-op because replay discarded
  original selection intent. History keeps the original owner separately while
  retaining history-restored diagnostics. Exact replay source/bounds and existing
  canonical-payload, lock and full-content safeguards remain required.
- S39-03: a row click waiting for source finalization could be followed by Delete
  on the previous layer. Keyboard Delete/Backspace now awaits the existing flush
  and reads the current layer, selection and floating paste afterward. The native
  timing test uses an explicit slow-finalization callback in the real registry;
  it does not claim naturally pending history from the failed idle120 fixture.

Final production artifact `2619317771a0065b1c04d8fc9d610f22bb4e14691deb85dc450aa949ecd1472a`
passes51 native checks across rectangle/freehand selection, cross-layer deletion,
painting outside the old selection, partial/full/select-all CC re-deletion,
held layer activation, pending Escape and exact Undo/Redo. Fail-before receipts
and final proof are in `output/playwright/bugfix39-*-before*` and
`bugfix39-native-final.json`; source binding is `bugfix39-preview-final.json`.
Type-check/lint pass on the isolated task-only candidate. Final full gate:601 suites/5742 tests pass (one existing skipped suite/test, one passing snapshot); production build and diff review pass. Local commit receipt: `output/playwright/bugfix39-commit-receipt.json`.
Five source owners and six tests plus these two audit ledgers form the reviewed
scope; the mixed comprehensive-keyboard owner excludes the original six unrelated
lines from the candidate. Original three-file staged patch remains exact.

## Session39 — Area20 final software signoff

Area20 CC shared geometry is software-verified. Areas01–20 are complete;
Areas21–65 remain pending. Four native-proven application defects are repaired:

- A20-01: a distant native Poly double-click now completes through the real
  dblclick entrypoint; native pointer-up detail remains zero. Near-start closure
  keeps6screen pixels through zoom, deduplicates terminal repeats and preserves
  the Grad direction stage versus direct Stroke/Concentric finalization.
- A20-02: Line pointer-up updates the terminal endpoint without replacing its
  held width with zero release pressure. The existing latest pressure ref keeps
  the actual raw contact used by Line geometry, including varying pen pressure
  and differing normalized/raw mouse pressure. Freehand zero-pressure taper is
  preserved. Native pen .2→.8→.1→0 retains interior width and the8px terminal extension.
- A20-03: ellipse tessellation uses equal quadrant samples inside the existing
  12–48point budget, preserving all four requested cardinal bounds. The native
  40pxcontrol and32pxShift case pass in both presets. Raster isotropy is not asserted.
- A20-04: changing drawing geometry cancels an unfinished draft in the same CC
  context before fresh authoring. Old Poly vertices no longer expand the next
  Rect; a pending Grad rectangle no longer replaces the requested Line. Cleanup
  owns points/samples/geometry/direction/mark/history snapshot/preview/capture and
  its playback suspension. Same-shape fill-mode edits, explicit tool flushing,
  finalizing drafts, non-CC drafts and other playback holds retain their contracts.

A20-05 was a regression in the proposed helper extraction, not the original app:
the initial Shift guide resolved its centroid before removing the closing point.
Native four-case I/O observation proved3.656/3.958degree errors in both presets.
Direction now resolves after deduplication/trim, preserving original HEAD375
ordering. Four unit regressions fail against the proposed extraction and pass
after; the pointer suite passes165tests. Exact native after-proof measures the
actual rendered guide through call-through Canvas2D observers with identity
transform and a validated owning context. The stored direction ref is null at
this stage, so no Enter-axis regression is claimed.

Final production artifact `5c89255dc88a925a0c1ca252796b884a7862a5caaf21e54eba648b4199a0fe4a`
passes **112native configurations/752checks**: all7geometries ×3fill modes ×2presets,
shape-specific interior/exterior footprints, exact65536pixel coarse Oval masks,
mouse/varying-pen Line release, reverse/Shift/short/zero drags, direction Enter/
Escape, draft cancellation/fresh gestures, native double-click/near-start closure,
zoom.25/2, rapid completion and geometry/fill/tool transitions. Canonical six-plane
and RGBA Undo/Redo remain exact; rendered-ink checks pass. Rapid input is native;
no forced stalled-finalizer timing claim is made. Existing accepted Area18/19
sampling/selection/grid/lock evidence is reused only at unchanged shared owners;
`area20-draft-switch-coverage-session39.md` identifies the exact Rect grid/clip
receipts and limits. This does not claim physical-tablet, performance, custom
pattern library or global playback signoff.

Final isolated task-only gate passes type-check, lint and **601suites/5775tests**,
with one existing skipped suite/test and one passing snapshot. Production build,
diff review and independent source review pass. Source/test hashes bind the
preview and isolated candidate: `area20-preview-final-v3-session39.json`,
`area20-isolated-gate-v3-session39.json`, and `area20-native-final-session39.json`
under `output/playwright/`. The browser is closed with exact named-session cleanup;
the preview server and Studio watcher remain available.

Six existing source owners and four existing test files plus these two ledgers
are the completed-area scope. The mixed shapeDrawing candidate/commit excludes
five original staged background-colour additions. Original47dirty paths and
three-file staged edits remain preserved. A changed mixed-owner HEAD blob means
the raw staged-patch SHA changes after this commit; the original edits and working
bytes are verified unchanged, as recorded by `area20-commit-receipt-session39.json`.
No push, deployment, branch or worktree change.

Rejected fixtures remain explicit: Poly preview probes1–3 and the first Shift
probe failed prerequisites before the tested action; no app defect is inferred.
The original Oval raster-symmetry fixture failed its40pxpositive control. Six
smooth-circle corner assertions in the first42matrix were invalid for Res6/PxlEdge
whole-cell rendering. Source arithmetic predicts340cells ×36pixels =12240pixels,
and all six final Oval configurations match the full65536pixel mask exactly.
No dither/noise/algorithm workaround was added; all original receipts remain.

Area21 Checkered has a read-only owner inventory and a prepared23case native
starter; neither source changes nor Area21 acceptance have occurred. Continue
from `area21-owner-trace-session39.md`, refresh the baseline after the Area20
commit, then bind `area21-checkered-starter-prepared-session39.js` to the final
production SHA. All subagents use GPT-6.1Sol. Historical model/no-subagent notes
below are superseded by the current human instruction; continuation-chat creation
remains blocked and must not be retried without new direct authorization.


## Session39 — Area 21 final software signoff: Checkered

Area 21 is software-verified. Areas 01–21 are complete; Areas 22–65 remain pending.
Five reproduced owner defects are repaired:

- A21-01: Add CC Layer retains Checkered instead of changing to CC Tonal Dither.
  One entry in the existing preset allowlist repairs the owner. Checkered fails
  before while Stroke/Pixel fallback controls pass; all 62 panel tests pass after.
- A21-02: ordinary indexed paint resets prior phase before its same-index early
  return. Native blue Pickup previously inherited Bristle phase and rendered
  neutral ink despite the new blue palette. The two native after cases pass 20 checks.
- A21-03: Checkered enters the existing live CC material synchronization gate.
  Res/BG/algorithm/pattern edits formerly applied one interaction behind. Four
  native after cases pass 37 checks, with actual held settings and Stroke controls.
- A21-04: Direct Dither bypassed indexed phase authoring. Before, Bristle-seeded
  ordinary repaint retained phase on 3,120 BG-on / 1,612 BG-off admitted pixels. Fresh
  writes now use current flow and separate current-stroke phase intent; original
  paint/gid/def/speed/flow/phase are captured once per epoch and restored in holes.
  Current Bristles are prepared before material admission and survive both replay
  paths. The superseded post-dither Bristle pass is removed. Tests also reproduce
  old-speed corruption on accepted→hole replay and legacy flow4 reauthoring.
- A21-05: native pointerdown/movement eagerly changed the permanent erase mask
  before admission. Its quadrant checker disagreed with actual alternating cells,
  restoring 400 wrong pixels; empty Pencil restored 800 pixels and added history.
  Those eager calls and guessed native preview healing are retired. Existing
  finalized admitted/explicit-empty footprints now own healing. Native repaint
  stays masked until commit. Custom alpha/same-index healing retains its existing
  pending callback because custom stamps have a different finalized-mask contract.
  Typed legacy dispatch signatures remain only for composition compatibility.

Final production artifact `133ee37f16f456cd96d050b7061947d7b6016ae2c8ce3f5ed08925dccd8054ba` passes
**121 native configurations / 1179 checks** across 13 suites. These include:
all 11 algorithms / eight patterns, material Res1/4/64 and pressure links, independent
checker and rotated footprints, size/pressure extrema, spacing/dashes, Band/Speed
and measured velocity links, source/FG/seam controls, Pencil/Bristle/Lostedge/Pickup,
transparency lock and exact erased-pixel boundaries. Same/cross-layer marquee →
Delete → Undo → re-delete → Redo → Escape → fresh outside drawing passes. All
relevant canonical six-plane/layer RGBA history checks remain exact.

Direct Dither OFF controls and current Bristles Bayer/Sierra ×BGon/off pass with
independent material/phase arithmetic. Two varying-pressure native pen cases use
constant tip geometry and Pres Res changes with actual overlapping ownership;
accepted↔hole witnesses, old metadata restoration, current phase and exact final
RGBA/history pass. This is injected trusted pen input, not physical-tablet signoff.

Final task-only gate passes type-check, lint and **601 suites / 5,805 tests**,
with the existing skipped suite/test and passing snapshot. Source and independent
review cover all 17 source/test files; eleven runtime owners and six final test inputs
match the production build and isolated gate.
The clean candidate excludes the original sampling hunks in three mixed owners;
reviewed three-way resolutions retain HEAD's inline recording and the full phase
repair. V2 candidate patch-context failure and v3 fixture type error are preserved.
The v4 full gate caught 12 older-state preview phase failures, and a focused test
also reproduced uniform reverse-flow replacement. The preview constructor now
uses copied flow/phase write buffers, preserves canonical Bristle phase only for
older paired BG-on states without explicit intent, and infers uniform currently
owned flow only when no explicit scalar exists. Explicit phase/flow zero wins.
All six canonical planes and intent remain unchanged even when drawing throws.
The native Palette/Sample before control already passed 2 cases / 12 checks because
real Dither strokes supply intent; this is constructor compatibility, not a
claimed native preview bug. Three focused suites / 95 tests pass, and the final v5
full gate supersedes all failed candidates. No application workaround was added.

Rejected fixtures remain explicit. Older Ocean/neutral-workspace/history no-op
assumptions were corrected at their prerequisites. The first variable-pressure
probe wrapped the raw brush after a seed had cached a bound draw adapter, so it
observed no stamps; corrected v3 wraps the actual cached draw I/O and retains all
oracles. This was an invalid observation fixture, not an app defect. Palette paired
inks may share raw ownership indices while definitions distinguish colours; a
black-endpoint tap is not a valid two-ink witness. All original receipts remain.

Evidence: `area21-native-final-session39.json`, `area21-preview-final-v6-session39.json`,
`area21-isolated-gate-v5-session39.json` and independent owner/candidate
reviews under output/playwright. Named browser cleanup reports no matching daemon.
Commit guard preserves all 47 original working paths and the original three-file
staged edits; only 17 reviewed source/test files plus these two ledgers are committed.
Physical hardware, subjective appearance, performance, custom pattern authoring
and global playback retain their separate audit owners. No whole-app completion,
push, deployment, branch or worktree change is claimed.

Area 22 has native fail-before evidence for stale zero-move endpoints, Enter width
and an inert Lostedge control. Resolution's initial red→blue Bayer witness was
mathematically degenerate; corrected native Fire black→white witness passes.
These are pending Area 22 work, not repaired or accepted here. Continue 22–65 in this
chat with GPT-6.1 Sol subagents and a fresh post-commit preservation baseline.


## Session39 — Area22 final software signoff: Rectangle Gradient

Area 22 is software-verified. Areas 01–22 are complete; Areas 23–65 remain pending.
The guarded local commit is recorded in
`area22-commit-receipt-session39.json`. Seven owning issues are addressed:

- A22-01: fresh and post-gesture zero-move contacts no longer reuse a stale axis
  endpoint. Gesture start/reset owns its exact endpoint, current position and width.
- A22-02: Enter uses the gesture's world-space hover width instead of the screen
  cursor. Width updates arrive before either preview or general move RAF, so
  preview throttling cannot delay input state. The stale RAF state write is removed.
  Exact click/Enter output, reversed axes, Shift, cancellation and fresh drawing pass.
- A22-03: Lostedge now reaches the rectangle renderer through the live settings
  memo. The existing shared erosion helper runs once on the completed stroke
  overlay after Dither/Riso, using the actual oriented corners and resolved tile.
  Preview and zero settings preserve their paths; tiny Riso no longer bypasses
  the common final tail, and off-canvas readback is guarded. Old paint is retained.
- A22-04: Draw Test Swatches records an undoable edit through existing layer
  history, with the target's original pixels copied before capture.
- A22-05: the same action uses a transparent overlay instead of capturing the
  full composite. Native before evidence baked another visible layer's 400 pixels
  into the target; after evidence preserves that layer and the target exterior.
  The fixed 33-colour palette is documented accurately. No active-gradient palette
  behavior was invented.
- A22-06: Sierra Variety reaches the existing direct and coarse dither helpers.
  Explicit zero, default 100, the deterministic seed and custom resolver positions
  remain explicit. No algorithm, noise or palette math was changed.
- A22-07: Rectangle no longer exposes unsupported PresRes/Max/Smoosh, PigLift,
  Riso Hue or Edges controls. Valid native pen/older-paint/repeated-colour probes
  established their absent effects. Fixed Res remains enabled despite a retained
  hidden pressure preference; Riso Intensity remains functional. Visibility does
  not write preferences. Other brush defaults and Polygon controls are preserved.

Final production artifact `5404f77b804f56ac9a3a7fd8f9f285ed8acab7dfa06a2404070875cd040fe427` passes
**65 cases + 2 effect probes / 761 checks** across eight suites.
Coverage includes all eleven algorithms and eight built-in patterns with real
black/white spatial output, Variety 0/100 and stable repeated 0, fixed Res 1/4,
colours/source sampling, positive Riso Intensity, exact oriented raster support,
Lostedge smooth/rotated/dither/backdrop cases, tiny/off-canvas completion, native
preview compositing, both swatches contexts and exact raw/framebuffer Undo/Redo.
Supported native controls remain usable with all unsupported preferences retained.

The preview observer validates the two actual viewport canvas owners, camera,
CSS composition and their different backing resolutions before reading a detached
surface-plus-overlay composite. It requires positive overlay coverage. Non-Riso
geometry retains its one-pixel AA guard; transformed Riso uses its separately
traced effect envelope. Paired erosion assertions retain old-backdrop, retained
RGBA and no-added-support checks. Native Riso warm-up and repeated zero references
qualify its paired material comparison; first-use output variation is recorded
without a deterministic appearance or additional defect claim.

A smooth preview exact-hash comparison across separate new projects was invalid:
a same-setting native control also varied by one RGB byte with alpha unchanged.
That cross-project observation remains diagnostic. A separate predetermined
eight-stage comparator holds the project, gesture, backdrop, canvases, camera and
width fixed. It records early drift, then requires exact late same-setting control,
0→100 invariance, repeated 100 stability, return-to-0 and repeated-0 stability.
All 28 checks pass without tolerance or retries; final RGBA, backdrop preservation
and Undo/Redo remain strict. No preview source patch was justified or added.

Rapid-length controls pass four cases / 41 checks. Their immediate move→release
pairs took 1.9/1.8ms and each observed one RAF; they do not establish same-frame
input or physical-tablet acceptance. No speculative terminal-length patch was added.

Final task-only verification passes type-check, lint and **602 suites /
5,847 tests**, plus the existing passing snapshot and skipped suite/test.
The successful production build binds all nine runtime owners. A later test-only
fixture correction supplies its required populated framebuffer and typed mock;
all seven final test inputs bind the clean v2 gate. Independent reviews cover
endpoint/width, Lostedge, Variety, swatches, the fixture correction and UI policy.
Sixteen source/test files, one guide and these two ledgers form the 19-file scope.
All task owners began clean at HEAD; all 47 original working paths and the exact
three-file staged patch are preserved. No push, deployment or branch change.

Rejected evidence remains explicit. Hidden switch inputs are not visible labels;
the corrected pressure probe retains every native force/value/pixel/history oracle.
The first preview observer sampled only Drawing surface and omitted its overlay;
its failures establish no rendering defect. The first preset-return probe assumed
Riso Outline was saved, while the existing shared cache omits that field. Corrected
expectations capture actual cache/default values before navigation and retain all
strict in-session Rectangle preferences and supported-effect assertions.

The Outline persistence gap is a separate **Area 29** finding, observed on both
Pixel and Rectangle: toolsSlice's serializable/auto-save whitelist omits
`risographOutline`, so preset re-entry restores its default. No store change is
included in this area. The original native observation and deferred findings
remain in the policy receipts for the later shared-settings owner.

Evidence: `area22-native-final-session39.json`, `area22-preview-final-v2-session39.json`,
`area22-isolated-gate-v2-session39.json` and independent review notes under ignored
`output/playwright/`. Named-session cleanup confirms no matching daemon remains.
Physical hardware, subjective appearance, performance, custom pattern library
work and broader per-preset persistence retain their separate audit owners.
Continue with Area 23 Spam Text using the prepared native starter and a fresh
post-commit preservation baseline; Areas 24–25 also have read-only preparations.


## Session39 — Area23 final software signoff: Spam Text

Area 23 is software-verified. Areas 01–23 are complete; Areas 24–65 remain pending.
The guarded local commit is recorded in `area23-commit-receipt-session39.json`.
Two reproduced defects are repaired at their owners:

- A23-01: valid custom `A😀B` previously reached Canvas as `A`, two lone
  surrogates, then `B`. SpamTextSequence now caches Unicode code points during
  initialization and emits them intact, without per-stamp splitting. ASCII,
  whitespace, preset fallback, wrapping, reset and retained cursor behavior remain.
  Full grapheme grouping is explicitly outside this code-point contract.
- A23-02: grid traversal completed its cells but left stale pending coordinates.
  Release emitted an unrelated origin stamp, consumed an extra character and
  skipped the next visible character. A near-origin native case committed 34 extra
  pixels. The grid renderer now synchronizes pending coordinates to its completed
  endpoint; already drawn or deliberately rejected cells cannot become deferred
  stamps. Non-grid finalization remains unchanged. Regressions cover regular
  Square/Round, native Spam continuity, anisotropic custom snapping and rejection.

Production artifact `a5265c7f6aeda17f98eb910810bafcc89b4362149c65f92981a48cc6b0f3fc29` passes
**48 native cases / 400 checks** across seven suites. Coverage includes
all five Content choices, eight Font requests with positive native ink, Size 8–72,
Opacity 0/.4/1, Spacing 1/40, Grid 16 same-cell coalescing and adjacent cells, native
pen pressures .25/.75 at50–150%, measured velocity on/off controls, Lostedge 0/50/100,
AutoPick against an independently blue-start/red-end source, project-edge clipping,
CC rejection followed by normal-layer fresh ink, custom content replacement and
empty/whitespace fallback. Selection→paint→Delete→Undo/Redo→repeated Delete→Escape→
fresh ink, existing layer-row routing and locked-target rejection pass. Real
Unicode code-point output, no release-time ghost/character skip, exact bitmap
history and other-layer preservation are included.

Control prerequisites remain explicit. System font fallback can share raster
appearance; requests and actual ink are verified without invented uniqueness.
Velocity requires measured event-time separation and exact off-control centres.
Lostedge 50 proves positive retained pixels/holes;100 may remove the entire glyph
and produce an exact history no-op. AutoPick samples once at stroke start; native
Canvas accumulation independently reproduces every raw/final colour byte, including
ordinary overlap rounding. No arbitrary RGB tolerance or source compensation was
introduced. Independent glyph masks compare all 65,536 binary support pixels; isolated
reference-alpha differences remain diagnostic because that isolated drawing does
not reproduce the complete production compositing seam. Exact canonical RGBA,
normalized framebuffer and Undo/Redo remain strict.

Focused owner regressions fail before and pass after: Unicode: 7 semantic failures,
then 14 passing tests; grid: 5 semantic failures, then four suites / 62 passing tests
with existing finalizer/custom coverage. Independent reviews found no actionable
issues. Final task-only type-check, lint and **603 suites / 5,866 tests**
pass, together with the existing snapshot and skipped suite/test. The successful
production build binds both final runtime owners and all five task inputs.

The seven-file boundary contains two runtime files, two regression suites, the
artist guide and these two ledgers. All began clean at HEAD. All 47 original
working paths and the exact three-file staged patch remain preserved. No branch
change, push or deployment. Rejected observer assumptions and the superseded
gate remain in `area23-native-final-session39.json`; original evidence is retained.
Native font appearance is platform-specific; physical tablet, subjective visual
signoff and broad performance remain separate limits. Sequence rewind with bitmap
Undo and full grapheme grouping were not invented. The separate legacy
`spam-brush` phrase plugin is not this public character-stamp path.

Evidence: `area23-native-final-session39.json`,
`area23-preview-final-v1-session39.json`, `area23-isolated-gate-v2-session39.json`,
source freezes, before/after logs and review notes under ignored `output/playwright/`.
Named-session cleanup confirms no matching daemon remains. Continue with Area24
Resampler from its prepared native starter and a fresh post-commit baseline.


## Session39 — Area24 final software signoff: Resampler

Area 24 is software-verified. Areas 01–24 are complete; Areas 25–65 remain pending.
The guarded local commit is recorded in `area24-commit-receipt-session39.json`.
The public preset follows regular stroke sampling → custom-tip rendering/cache →
raster preview/commit/history. Five reproduced defects are repaired at that path:

- A24-01: fresh same-sized red/blue captures reused constant cache identities,
  so Continuous and consecutive strokes retained stale red material. Each successful
  new capture now gets one distinct stable revision on both cache aliases; skipped,
  failed and retained samples preserve identity. Shared bounded caches are unchanged.
- A24-02: Continuous ON skipped the initial composite sample and painted nothing
  on first contact. Both modes now seed the initial source through the existing
  capture seam. The subsequent processed-move interval counter remains unchanged.
- A24-03: unsupported Shape painted foreground colour instead of sampled material,
  and Riso controls could not affect final sampled pixels. Remove only those
  Resampler controls and guide claims. Real support needs a new alpha-preserving
  material pipeline and shape sample-lifetime policy; no substitute was invented.
- A24-04: effective unsupported Shape could return through settings, preset/tool
  changes and real startup hydration. Clamp effective Resampler mode at these
  existing admission owners while preserving raw per-brush maps, retained Riso
  preferences and other brushes' regular/Color Cycle shape memories.
- A24-05: retained Riso intensity darkened 1,024 held midtone pixels, then release
  restored the untouched sample. The ordinary Resampler preview now skips that
  unsupported overlay, matching raw and committed material. Other brushes retain it.

Production artifact `e5073a37fb8c1fe6ddb8d944866d6d4608a6e26902944abab840ddd626ad6916` passes
**43 native cases / 411 checks** across eleven suites. Positive source
fixtures establish native size/opacity/alpha transfer, same-sized fresh captures,
Continuous first taps and red→blue movement, Interval1/10 actual capture cadence,
Spacing1/40, Grid16 coalescing/adjacency, measured velocity controls, pressure
.25/.75 at50–150%, asymmetric rotation, dash L/G/V controls and speed response,
Size1/500, zero-opacity no-op and recovery, project-edge crop, CC rejection followed
by normal fresh ink, locked-target rejection and existing layer-row routing.
Selection→paint→Delete→Undo/Redo→repeated Delete→Escape→fresh capture passes.
Canonical RGBA and actual normalized framebuffer history remain exact, and other
layers are byte-preserved. Startup uses actual versionless localStorage plus real
reload before any store action; owned settings/session bytes are restored exactly,
with legitimate unrelated reload telemetry recorded. Hidden inputs use attached
readiness plus a separate visible label/control check.

Unsupported controls are absent in both continuous modes; direct Shape requests
and tool return stay disabled while raw memories/preferences remain. Held Riso0/100
actual raw/preview/display/final material is identical with positive coverage.
Cadence includes the intentional initial capture: Interval1 starts32 then40..224;
Interval10 captures32,112,192 for the declared24 native8px moves. Small dash gaps
may be bridged by the sampled tip; Gap2 and speed matrices require positive gaps
and independent density comparisons rather than an invented Gap1 blank-column rule.

Owner regressions fail semantically before and pass after. Two independent source
reviews found no actionable introduced issues. Task-only type-check, lint and
**606 suites / 5,897 tests** pass with the existing snapshot and skipped
suite/test. A successful production build binds all thirteen task inputs, including
six runtime owners, six test files and the guide. The complete commit boundary is
fifteen files with these two ledgers; every task owner began clean at HEAD.

All 47 original working paths and the exact three-file staged patch remain
preserved. No branch change, push or deployment. Physical tablet, subjective visual
signoff and broad performance remain separate limits. Unsupported retained Dither
branches and a new Riso/Shape feature implementation were not claimed. Invalid
fixture assumptions and before receipts are retained, not counted as acceptance.

Evidence: `area24-native-final-session39.json`,
`area24-preview-final-v1-session39.json`, `area24-isolated-gate-v2-session39.json`,
source freezes and independent reviews under ignored `output/playwright/`.
Named-session cleanup confirms no matching daemon remains. Continue with Area25
Mosaic from its prepared starter and a fresh post-commit preservation baseline.


## Session39 — Area25 final software signoff: Mosaic

Area 25 is software-verified. Areas 01–25 are complete; Areas 26–65 remain pending.
The guarded local commit is recorded in `area25-commit-receipt-session39.json`.
Three reproduced defects are repaired through existing owners:

- A25-01: Vel ignored the already computed shared spacing value, leaving all 17
  centres identical at measured slow/fast speeds. Route computed absolute spacing
  to Mosaic's interval renderer. Preserve its original rounded/default base,
  distance already travelled in a pending gap, segment/palette behavior and exact
  VelOFF output. Reset clears the per-stroke effective interval; invalid overrides
  fall back safely without compounding the base.
- A25-02: a restored Mosaic Shape preference entered generic polygon fill and
  painted 9,216 foreground pixels instead of Mosaic material. No Mode control or
  polygon Mosaic renderer exists. Keep effective Mosaic mode as Stroke at the
  existing settings/action/preset/tool/hydration admission seams, retaining raw
  saved maps and supported regular/CC shape memories. A polygon material policy
  was not invented. Earlier Area24 Mosaic-enabled memory controls are replaced
  with actually supported Soft controls; old artifact receipts remain unchanged.
- A25-03: the visible one-use Sample action disabled itself without capturing
  colours. Initialize/collect its path through existing refs, then use the existing
  reference-aware sampler before ordinary raster publication. It reads committed
  source layers separately from held Mosaic ink, applies stops through normal
  brush settings and disables one-use. Preserve the gesture's existing painting,
  bitmap history, repeated-palette commits and source layers. Empty/read-failure
  paths retain the palette and normal commit. Retained CC pickup/realtime settings
  do not block Mosaic sampling or activate CC preview/document/live branches.

The full gate also caught explicit CC classification losing priority to stale
Mosaic settings in the new condition. Preserve CC admission/pickup precedence
in initialization and collection. The new regression and existing pickup test
pass without changing that existing test's expectations.

Production artifact `655f6f1bdb055bfa9b7511d3e07d02cdf7b560ada9418c550623025844c9aa33` passes
**48 native cases / 538 checks** across seven suites. Coverage includes
independently configured palette material, Tile/Blocks/Palette/Size/Opacity,
Spacing and measured Vel response, actual pen pressures .25/.75 at 50–150% with off-controls,
rotation, Pixel smoothing, Segment and jitter, fixed-seed repetition, native Rand
and replay, and Dither at/beyond its 65,536-source-pixel cap. Above the existing
cap the positive flat fallback is verified, not mistaken for a dither effect.
Actual gradient choices/editor stop changes, one-use red/blue capture and the next
Mosaic material pass. Size 1/500, zero-opacity old-ink/no-history/recovery, CC-target
rejection→normal fresh ink, and actual new-layer rows/lock/unlock/routing pass.
Marquee paint→Delete→Undo/Redo→repeated/empty Delete→Escape→fresh outside ink
passes with explicit canvas/handle prerequisites. Old raw Shape false/true maps
both start as effective Stroke; direct denial, native tool return and supported
Soft shape-memory restoration pass. All accepted bitmap/framebuffer history is
exact and other layers/source remain byte-preserved.

Pressure is not an application clipping bug. Actual writer→preview→canonical→
framebuffer/history is exact. Independent captured-pixel Canvas references using
native translate→rotate operations match both fractional-pressure writers exactly;
setting a near-quarter-turn matrix directly can rasterize edge coverage differently.
No pixel tolerance, mask relaxation or rendering compensation was added. Newly
added regular layers legitimately start as null pixels plus a zero 1×1 framebuffer;
the observer preserves that representation and requires full project surfaces after
authoring. Generic CC GradientEditor presence is legitimate. An extra retained CC one-use
preference probe reproduces a separate stalled input-start/finalization contract.
It is outside Mosaic public controls and is recorded for immediate separate repair,
not counted as a passing preservation case. Its actual native failure and six-plane
readback remain intact. Dedicated CC has no Mosaic action dropdown. Owned storage bytes and
session packets are restored on real reload, with legitimate telemetry recorded.

Owner regressions fail before and pass after. Final independent reviews cover all
eleven source/test inputs. Task-only type-check, lint and **608 suites /
5,929 tests** pass with the existing snapshot and skipped suite/test. A final
production build binds seven runtime owners and four regression files. The complete
commit boundary is thirteen files with these two ledgers; all task owners began
clean at HEAD. The failed fixture gate, CC-regression gate and superseded build
remain recorded and are excluded from final acceptance.

All 47 original working paths and the exact three-file staged patch remain preserved.
No branch change, push or deployment. Physical tablet, subjective appearance,
broad performance and sequence materialization remain separate audit limits.
Sampling reset is covered deterministically; a new native mid-stroke Escape
cancellation policy was not invented. No unsupported polygon implementation or
unreachable dedicated CC action was silently marked passed.

Evidence: `area25-native-final-session39.json`,
`area25-preview-final-v2-session39.json`, `area25-isolated-gate-v3-session39.json`,
source freezes, before/after logs and independent reviews under ignored
`output/playwright/`. Named-session cleanup confirms no matching daemon remains.
Immediately repair the separately reproduced CC sampling-start contract, then
continue Area26 Shape Pattern from a fresh preservation baseline.


## Session39 — Reported CC sampling gesture final software signoff

The separately reproduced retained Color Cycle one-use sampling gesture is repaired.
Areas01–25 remain complete; Areas26–65 remain pending. The local commit is recorded
in `reported-cc-oneuse-commit-receipt-session39.json`.

The sampling initializer deliberately returns no painting context after starting a
palette-only preview. The stroke-start owner previously treated that as a rejected
start, so pointer routing cleared the gesture before movement and release could
sample and finalize it. Accept the initialized nonpainting CC brush gesture only
when an actual active Color Cycle layer matches the existing finalizer capability.
Earlier prelude/session rejection and unrelated missing contexts still reject.
Ordinary CC painting on supported sequential layers retains its existing context
path. No painter is invoked for a palette-only start.

Production artifact `97e654f1ead7d550b8fd60a45594971414e75cf8ed72b268a3c512c73725d532` passes
**11 native cases / 115 checks** across three suites. The exact declared
retained one-use preference on the real CC Palette source now captures the independently
verified red/blue committed composite, disables one-use, preserves the nonauthoring
contact's six canonical planes, actual RGBA and history, and paints the next gesture
with the captured binding without Undo. Its exact six-plane/RGBA Undo/Redo passes.
The dedicated CC interface has no Mosaic one-use action dropdown; that fixture is
explicit and does not claim a nonexistent UI control. Four Mosaic sampling cases
and six selection/Delete/layer/lock/recovery boundary cases remain passing on the
same artifact, including source-layer and bitmap/framebuffer history preservation.
Owned storage is restored exactly after real reload and no runtime errors occur.

Qualified before regressions fail and final seven focused suites/225tests pass.
The independent review is hash-bound to both final source/test inputs. Isolated
HEAD-plus-task type-check, lint and **608suites / 5,940tests** pass with the
existing snapshot and skipped suite/test. The production build and native scripts
are bound to the final two-file freeze. The complete commit boundary is these two
owners and the two audit ledgers. Original47working paths and the exact original
three-file staged patch remain preserved. No push, deployment or branch change.
Physical-tablet and subjective visual signoff remain separate audit limits.

Evidence: `reported-cc-oneuse-native-final-session39.json`, final production binding,
isolated gate, source-v2 freeze, independent review and native scripts/receipts under
ignored `output/playwright/`. Named-session cleanup confirms no matching daemon.
Continue Area26 Shape Pattern from a fresh preservation baseline.


## Session39 — Area26 final software signoff: Shape Pattern

Area 26 is software-verified. Areas 01–26 are complete; Areas 27–65 remain pending.
The guarded local commit is recorded in `area26-commit-receipt-session39.json`.
Four qualified native defects are repaired through the existing owners:

- A26-01: polygon release handed geometry to a fill session but left parallel store
  drawing state active. First Undo cancelled that stale state and left pixels/history
  unchanged. Clear completed store drawing/points alongside the existing local-ref
  handoff. First Undo now reaches bitmap history; active draft/session cancellation
  retains precedence and its existing reversible session delta.
- A26-02: Noise Speck Size changed stored values without changing generated material.
  Apply its existing .2–4 multiplier to final square size/radius after original
  randomness. Default 1 preserves the complete old output; centers, RNG, colours,
  sampling cadence, clip and cell budget remain unchanged.
- A26-03: after a released Hatch width edit with no canvas movement, Enter published
  exactly the old thin preview despite final parameters saying 4. Pointer confirmation
  recomputed the thick material. Enter now targets the existing Shape Fill finalizer;
  the duplicated colour/erosion/stale-canvas path is removed. A single-key operation
  on the existing registry avoids recursive broad flushing. The existing passive
  pending waiter remains unchanged; the new active registration is nonpassive.
  Missing owner leaves the draft untouched and target-task rejection propagates.
  Any current-parameter clamp occurs after successful common target validation.
- A26-04: native layer-menu lock reached an uncommitted adjusting session, but both
  confirmation paths could publish pixels while locked. Reject locked targets at
  the existing final-target validator before payload/rendering. Unsupported CC and
  missing/invalid-target contracts remain preserved; unlock permits a fresh shape.

Production artifact `1f1e2763f5b54d1f67cdfada9d0f26903f4e72250d42a933cd73b13fd9bb868f` passes
**76 native cases / 1,019 checks** across four suites. All eight public
strategies produce positive material with exact canonical/normalized-framebuffer
history. Starter strategy/Enter pairs require identical finite observed points;
native 6 px segments preserve actual rectangle corners/area before exact solid/cell
oracles. Noise's separate-channel field is source-bounded, not assumed monochrome.
Eight nondefault material profiles, 39 isolated numeric controls, five shared
variants, three exact seeded repeats and post-release session cancellation pass.
Sampled blue source, Background colour, Pixel, Lostedge and outline have positive
material witnesses; every source/other layer remains exact. Combined overlay
readback proves visible feedback, not isolated strategy-preview fidelity.

Marquee 40×60 clips to exactly 2,400 pixels; Delete/Undo/re-delete/Redo/empty Delete,
completed-selection Escape and fresh outside material pass. Outer 132 px geometry
clears actual handles without bypassing hit tests. Real new regular layers with sparse blank allocation,
normal rows/routing, both locked confirmation paths/unlock recovery, positive CC
seed/rejection→normal fresh, strategy and target changes during adjustment all pass.
A strategy switch retains the begun strategy; a target-row switch commits to the
original normal layer. Final material and history match those observed policies. Both post-release width 4 confirmation paths now publish exact
matching material without canvas movement, then first Undo/Redo replays exactly.
Owned storage restoration passes where explicitly managed; no runtime errors occur.

Before receipts and deterministic regressions fail at the owning seams. Final
independent reviews cover all ten source/test inputs. Task-only type-check, lint
and **609 suites / 5,962 tests** pass with both snapshots and the existing skipped
suite/test. The final production build binds five runtime owners and five tests.
The complete area commit is twelve files including these two ledgers, with no
mixed original owners. All 47 original working paths and the exact three-file staged
patch remain preserved. No push, deployment, branch or worktree change.

Initial probe failures caused by requested-box versus normalized geometry,
selection's legitimate history entry, live handle interception and inherited
Hatch organic width variation are retained as fixture exclusions. No tolerance,
geometry injection, shader workaround or generator clone was added. BG support
uses an independent observed-polygon Canvas reference: exact occupancy, opaque
interior, empty exterior and monotonic base alpha under source-over, rather than
an invalid exact partial-edge alpha assertion. A native diagnostic proves the single
right-edge pixel exactly matches its independent Canvas reference; Hatch alpha
legitimately mixes white primary into greys over black. The original BG requested-box
and saturated-white assertions are excluded fixture errors. The complete 56-case control
suite passed with qualified BG coverage and positive primary contribution; source,
full gate and production build remain unchanged. Earlier starter-v2 overwrite was
confined to ignored unexecuted preparation; root's merged/reviewed v3 and qualified
v4 retain the Noise contract and exact observed-geometry prerequisites.

Evidence: `area26-native-final-session39.json`, production binding, isolated gate,
source freezes, qualified before receipts, independent reviews and native scripts
under ignored `output/playwright/`. Exact named-session cleanup confirms no matching
daemon. Physical tablet, subjective visual signoff, exhaustive generator statistics,
all control extrema and broad performance remain separate limits. Continue Area27
Custom brush capture from a fresh preservation baseline.


## Session39 — Area27 final software signoff: Custom brush capture

Area27 is software-verified. Six reproduced capture/editor defects are repaired at
their owners; the completed-area local commit receipt follows. Areas 01–27 complete;
Area28 custom-brush painting/edit/removal is next,29–65 pending. Remain on main;
no push, deployment, branch or worktree change.

A27-01: clipping a CC Freehand region at the right/bottom edge cropped RGBA correctly
but retained requested-stride index rows. The positive native witness had348 index
mismatches,210 under visible alpha. Canonical indices now share the actual clamped
RGBA rectangle; the old prefix slice is removed. Impossible canonical/RGBA size
mismatches follow the existing fail-closed raster-fallback policy.

A27-02: All layers sampled the viewport static cache, omitting visible paused CC
material. Capture now uses the existing complete compositor on a private target.
The static cache remains static; normal+CC source contributions are independently
composed and compared exactly. All layers produces a raster tip without indexed
metadata; active CC retains schema 3 indexed-tip data.

A27-03: Save retained the selected temporary ID but did not retrigger editor
activation when that ID became a saved asset. A narrow saved-membership boolean
now participates in the existing activation effect. A27-04: the editor's adjusted
tip writer dropped CC metadata, including on zero-adjustment reload activation.
It now retains the matching saved asset metadata. Both duplicated update-action
declarations reuse the existing BrushSettings tip model; no runtime store wrapper.
Native Lightness 100, Hue 180 and Saturation 0 autosave exact expected RGB/alpha,
retain ID/count, and agree with the active tip.

A27-05: Escape cleared panel data but left the shared held Freehand runtime active;
mouse release created a new brush. The keyboard owner clears that object in place,
clears its preview/path and suppresses the old held-pointer restart. Real pointer
and keyboard integration verifies late moves/release and a fresh capture.
A27-06: selecting capture from a saved EDITING brush retained the old editor and
modal keyboard scope. Capture tool entry now uses existing editor cancellation,
as preset switching already does. No modal-scope bypass or extra save is introduced.
Saved pixels, source layers and history remain exact, with or without an offscreen
canvas; ordinary eraser editing remains supported.

Final production artifact: `03432e6d4fac11a481c41f81dabb48d054d7bd70ef9046696748671ed32e530e`.
All 19 native cases/255 checks pass across six suites on these same bytes, with zero
aborts/page errors and exact owned-storage restoration. Coverage includes Box/
Freehand alpha/crops, reverse/edge geometry, empty/minimum-width policy, source/
composite choice, Save/generated Custom N names/default/reload, editor HLS,
Recapture/Discard, held Escape/recovery and saved-editor capture entry. There is
no public Rename control. Box completion legitimately adds one selection-history
entry; Freehand adds none. Later library/editor actions preserve source/history.

CC acceptance uses current schema 3 indexed-tip: direct resident Uint16 indices,
captured alpha, one actual palette, finite source speed 0.17 where explicitly seeded,
global phase/jitter 0/cycle 256. Version 1 storage and its nested schema 3 payload are
independently decoded through real reload and actual current-tip restoration.
Six resident planes remain source-preservation witnesses; historical true-stroke
plans are not a different capture contract or a painting/replay acceptance claim.

Verification: isolated task-only candidate type-check/lint and 609
suites/5984 tests pass, with one existing skipped suite/test and two
snapshots. Production build, source review and mixed-owner isolation/replay pass.
Twelve source/test inputs plus these two ledgers are necessary for six owner repairs.
The original 47 work changes are retained; two mixed keyboard owners contribute
only reviewed audit deltas to the commit, and the original staged patch stays exact.

Earlier probe mistakes are excluded: pointer-up correctly targets the capturing
workspace; Lightness labels its Root, requiring the descendant slider; asynchronous
wait predicates were replaced by synchronous exact-byte autosave checks; Escape
is observed at early window capture before app propagation handlers. Failed and
superseded evidence remains available; no application patch was made for these
fixture corrections. Physical tablet/visual signoff, broad performance, project-file
roundtrip/quota/corruption and broader custom painting/removal remain outside Area27.

Receipts: `output/playwright/area27-preview-final-v2-session39.json`,
`area27-isolated-gate-v2-session39.json`, `area27-native-final-session39.json`,
`area27-source-freeze-final-v2-session39.json` and `area27-commit-receipt-session39.json`.

## Session39 — Area28 software-verified: Custom brush painting/edit/removal

Areas01–28 have complete software evidence. Area28 repairs five reproduced
contracts: colour edits retain custom size and separate regular-size memory;
pixel-mode custom strokes commit their active release pattern; pattern rotation
is applied once; sampled colour updates preserve the active engine instead of
stamping twice; pixel painting forwards the canonical tint policy.

The ten source/test files repair those five owning contracts, with independent
review and meaningful regressions that fail before each repair. Source capture,
metadata, library deletion policy and unrelated controls are not rewritten.
All 47 original work paths and the exact original staged patch remain preserved.
The complete-area local commit receipt is
`output/playwright/area28-commit-receipt-session39.json`.

Final production artifact: `ea36538ea874264b52193a773e1a6f816de4db7ef04a0d2bf6a02913509c15e8`.
**34 native cases / 956 checks across ten suites pass**, all on that artifact,
with no page errors or aborted cases and exact owned-storage restoration:

- Normal saved tips7: native size16/32/64, smooth spacing, partial alpha,
  zero/half opacity, recovery, edited asset's next mark and exact Undo/Redo.
- Separate colour-only size1 and public inherited-pixel/saved-smooth pair2:
  preserve32/global100 through Lightness; commit the independently requested
  release cap while retaining the distinct smooth spacing contract.
- Geometry8: native pen forces.25/.75 with pressure OFF/ON, rotation OFF/ON,
  aspect-based custom snapping and square-grid snapping; independent pixels.
- Sample4: public inherited pixel/saved smooth modes crossed with Sample OFF/ON;
  exact sampled/raw colour and fractional alpha, one stamp, source preservation.
- Library3 and default-reload painting1: inactive/active/default deletion,
  retained-tip continuation without resurrection, fresh Pixel recovery, default
  unset and a real restored default's next mark without row reselection.
- Captured CC4: real schema3 capture; OFF normal replay; indexed CC authoring;
  raster target rejection/recovery and accepted CC tip authoring. Independent
  map/support/semantic definition/slot/speed/flow/phase on all six planes;
  exact history and published alpha. Indexed RGB clock arithmetic is not claimed.
- Shared regressions4: ordinary Pixel sampling OFF/ON and fresh strokes retain
  exact half-opacity pixels; actual Resampler rotation OFF/ON satisfies analytic
  quarter-turn intent and complete independent quadrant pixels.

The isolated task-only candidate passes type-check, lint and full Jest:
`1 skipped, 609 passed, 609 of 610 total`; `1 skipped, 6006 passed, 6007 total`. The production build passes. Final
source/runtime review finds no remaining actionable issue in this enumerated
scope. All native cases use actual input, source-independent intended geometry,
canonical/framebuffer/source-plane preservation and exact Undo/Redo where applicable.

Earlier invalid setup/size explanations and failed before receipts remain
preserved separately. The Colour Cycle snapshot without a deferred-publication
fence is excluded; its replacement awaits exactly one natural source/target
history publication without flushing or changing production code. The old Resampler observed-angle proof did not establish
requested direction; the new independent quarter-turn regression supersedes it.
Shared exhaustive controls remain Area29; subsequent areas29–65 are pending.
Physical tablet feel and artistic visual signoff remain separate.
No push, deployment, branch or worktree change is included.

Receipts: `area28-source-freeze-final-v1-session39.json`,
`area28-preview-final-v1-session39.json`, `area28-isolated-gate-v1-session39.json`,
`area28-native-final-session39.json` and `area28-commit-receipt-session39.json`
under ignored `output/playwright/`.

## Session39 — Area29 software-verified: Shared brush controls and pattern library

Areas01–29 have complete software evidence. A29-01 repairs the supported Pixel
Riso Outline preference: native true survives preset reentry and real startup,
while explicit false remains saved and separate presets retain their own values.
Two existing whitelist fields in toolsSlice and three meaningful regressions in
its existing test file are the complete application/test scope, plus these two
ledgers. Defaults, renderer behavior and the current Rectangle Edges omission
policy are preserved. No Mosaic application repair was justified.

Final artifact: `8d9328c8eb487443dd6a40d94ed54398c7e6155bad06fe63d31e1cb832c4019d`.
**40 native cases / 1088 checks across six suites pass**, with no page errors
or aborted cases and exact owned preference/library restoration:

- Shared geometry12: Soft contour/filled Shape, actual held overlay Escape and
  fresh drawing; initial/mid/released Shift; Pixel/Soft grid and native16→32 cell
  change; V0 solid/dashed support, canonical/framebuffer and first Undo/Redo.
- Composition/preferences12: real L/G endpoints and draft Escape, independently
  modeled V0/V10 slow/fast dashes with measured timing, Mosaic Pixel OFF/ON with
  fractional41px geometry, preset/tool round trips, real saved startup and the
  effective clamp of an explicitly declared historical unsupported Shape bit.
- Pattern lifecycle10: PNG preview/Cancel, Save/new/existing pack/scaled tiles,
  exact authored normal and CC support, valid/malformed private import, reload,
  byte-exact backup, owned removal/missing warning and fresh Pixel recovery.
- Outline/policy3: public true→preset reentry, genuine saved startup with ordinary
  preference/painting/history controls, and supported Rectangle Colors/Intensity
  persistence while Edges remains absent.
- CUSTOM Shape2: captured asymmetric tip; contour OFF versus source-qualified
  world-phase repeat ON, transparent/partial-alpha interior, preserved asset and
  source planes, exact whole-target history. Basic CC shapes retain their earlier
  completed owners; no generic Rect/Oval selector is invented.
- Project pack next-mark1: the actual UI-selected declared member authors the
  independently expected normal pattern. Normal per-stroke alternation is not
  claimed; CC per-stroke pack re-resolution is a separate contract.

The Mosaic reference correction is independently qualified, not a runtime fix or
pixel tolerance. Actual target history contains Pixel4 fill→clear→clear with no
intervening read before the41px smooth stamp. A detached Pixel4 fill→clear recipe
reproduces every native writer byte; adding a post-clear read returns the fresh
Canvas raster. Final acceptance uses one fixed matching-history reference and a
strict actual-history prerequisite, independent source/palette/geometry, exact
raw→canonical/framebuffer publication and history. No dual-hash/best-match gate
or production context normalization was added. Earlier surface-only preview,
missing Grid32 center, file chooser/option/VM/buffer observers, L/G area, timing
and startup-palette fixture failures remain preserved with their corrections.

The isolated task-only gate passes type-check, lint and full Jest:
`1 skipped, 609 passed, 609 of 610 total`; `1 skipped, 6009 passed, 6010 total`. Production build and final source review
pass. All47 original working paths and the original staged patch remain exact.
The complete-area commit receipt is `output/playwright/area29-commit-receipt-session39.json`.

File attachments use the actual hidden public input as a declared I/O boundary;
OS file/folder pickers and directory handles were not exercised. Every original
private-library record, typed threshold and archive byte is preserved. No public
Reset Brush or universal AA control exists on this path. Physical tablet feel,
other browsers, performance and artist visual signoff are not claimed.

Area30 Fill is next; Areas30–65 remain pending. No push, deployment, branch or
worktree change is included. Receipts under ignored `output/playwright/`:
`area29-source-freeze-final-v1-session39.json`, `area29-preview-final-v1-session39.json`,
`area29-isolated-gate-v1-session39.json`, `area29-native-final-session39.json`,
`area29-mosaic-canvas-history-qualified-reference-session39.json` and the commit receipt.

## Session39 — Area30 software-verified: Fill

Areas01–29 are committed complete. Area30 now passes all32 enumerated native cases
and926 checks across10 suites on one rebuilt production artifact,
`8cab65ac1ed545c5bd543916eeacdb468252df4faa2d6b6a6310bb7c3721bc5b`. A focused local commit follows;
Areas31–65 remain pending. Physical devices, other browsers, performance and artist
visual signoff are separate from this software proof.

Three independently reproduced owner defects are repaired:

- A30-01: Fill bypassed ordinary layer admission. Locked/hidden normal, CC and
  sequence layers accepted pixels or semantic events and history. An actual
  Adjustment target expanded its sparse1×1 allocation into a256×256 bitmap; Undo
  did not recover the allocation. Fill now rejects invisible, locked and adjustment
  targets before any capture, source read, allocation, authoring or history.
- A30-02: clipping a marquee moved its origin while retaining its original width.
  The genuine(-16,48)→(80,144) marquee selected7680 pixels, but normal/CC/sequence
  Fill authored9216. The shared ROI helper now intersects original floor/ceil edges
  with the image. Original mask origins remain intact. Explicit active selections
  wholly outside the image now reject Fill instead of falling back to an ordinary
  flood; native Escape clears ownership and fresh drawing works.
- A30-03: contiguous raster Fill used replacement colour as its only visited
  marker. A replacement inside seed tolerance revisited cells indefinitely. A
  bounded pure subprocess and a public native four-pixel case reproduced the
  freeze; a renderer-independent801ms watchdog interrupted it safely. A separate
  contiguous visited plane now guarantees progress. Global matching and the RGBA
  Euclidean metric remain unchanged. The repaired native path returns without the
  watchdog, replays exactly and permits a fresh ordinary Pixel stroke.

The necessary boundary is seven source/test files plus these two ledgers: Fill
entry/existing tests, shared selection ROI/existing tests and floodFill/new tests.
Two existing pointer-routing Fill fixtures also now explicitly declare their
required visible/unlocked target flags; assertions and runtime behavior are unchanged.
The initial full gate exposed those missing flags and its failure log is retained.
The corrected pointer suite passed before the clean full gate was repeated.
Each isolated repair candidate has fail-before evidence and independent source/test
review. The clean archived commit candidate excludes all47 original unrelated
changes. Its type-check and lint pass; full Jest reports:
Test Suites: 1 skipped, 610 passed, 610 of 611 total; Tests:       1 skipped, 6045 passed, 6046 total; Snapshots:   2 passed, 2 total.

Final native coverage uses actual F entry, Fill Threshold/Connected/Erase controls,
trusted contacts, independent masks/RGBA or canonical/event payloads, actual
publication, exact first Undo/Redo and source preservation. The32 cases cover
normal connected/global matching and tolerance4/5, alpha0/128/129, active BG,
Erase/no-op/recovery, the current opaque RGB palette contract, protected targets,
rectangle/freehand/inverted/clipped selections, wholly outside selections,
CC/sequence Fill and Erase, all layer admission guards, actual Adjustment,
near-replacement/fresh Pixel recovery and clipped CC/sequence deselect/fresh Fill.
Sequence assertions include the event prefix/chunks, all eight authored frames,
cursor and sparse bitmap authority; CC includes all six planes, definitions,
palettes and erase alpha. Every final suite restored its owned storage exactly.
No Fill opacity UI or private authoring path was invented; active positive mask
members retain the existing binary selection-fill contract.

Fixture errors remain preserved separately: the initial watchdog assumed CLI VM
global timers; V2 uses Playwright server deadlines. Animated setup initially
expected unqualified reverse flow and empty chunk allocation, then included the
RecordOFF toolbar pointer-up in the source receipt; final fixtures qualify forward
flow, retain real chunks and freeze the genuine source contact before that toggle.
The Adjustment row was scoped to the actual layers panel to avoid its same-name
settings heading. None of those fixture corrections is claimed as an app repair.

The original47 changes remain separate:46 owner-unrelated files are byte-exact,
and removing only the reviewed Fill entry delta restores the original mixed file.
Its previously staged BG addition stays staged and is excluded from the audit
commit. Before commit the original staged patch SHA is4324cf52…; committing this
same file necessarily changes Git's index hash metadata. The commit guard first
proves the rebased original three-file/seven-addition staged patch has byte-exact
hunks and context, allowing only index metadata to change, then verifies it again
after commit. The commit receipt records both hashes. No push, deployment, branch
or worktree change is included.

Evidence: `area30-source-freeze-final-v2-session39.json`,
`area30-preview-final-v2-session39.json`, `area30-isolated-gate-v2-session39.json`,
`area30-native-final-session39.json`, the three qualified-before receipts and the
focused commit receipt under ignored `output/playwright/`. Source and browser
ownership remain centralized. Continue with Area31 Eyedropper after the fresh
post-commit preservation baseline.

## Session39 — Area31 software-verified: Eyedropper

A31-01 is repaired at the Canvas sampling owner. With a transparent normal layer
active, genuine visible blue CC/sequence material previously sampled white.
Actual50% normal-red-over-blue displayed purple but sampled red; hiding that
normal target returned white. Source/view/history stayed exact, establishing a
sampling-authority error. Before receipts are
`area31-visible-animated-qualified-before-session39.json` and
`area31-supplement-qualified-before-v2-session39.json`. Earlier failed setup and
screen-render receipts remain immutable and are not accepted sampling proof.

The three-file repair is `useDrawingCanvasSampling.ts`, existing
`useDrawingCanvasRenderSetupBridge.ts` and existing sampler tests. The bridge
supplies the existing visible-layer compositor with actual segment/layer refs.
Sampling uses a reusable project-aligned region buffer (public fixed kernel at
most3x3), preserving the intentionally static compositor/cache. Mutable scratch
readback bypasses the stable-source batch cache, and visible sequence samples
refresh at the same coordinate. Blend/mask/frame algorithms, active-CC semantic
gradient sampling, public UI and source documents are unchanged.

Final production artifact `d04b4df40bbb2d22b3d2084a795d1a176dda8140c5f4d60926726a14269a68e5` passes **17 native cases / 391
checks** across five suites, with exact owned-storage restoration and no runtime
errors. `area31-native-final-session39.json` binds all prepared scripts, results,
source hashes and the new production artifact; static cache bytes also remain
exact around every animated-source sampling contact.

- Persistent click, actual held pointer drag and released hover; FG/BG isolation,
  opaque RGB conversion of partial source alpha, fixed Canvas3x3 highest-alpha
  versus Reference1px, actual source-toggle/row designation.
- Held-P/repeat/up from Brush and Eraser with exact geometry/preferences return;
  Escape while held, already-persistent picker, real rename-text suppression and
  fresh workspace recovery.
- Actual FG opacity37 to transparent-Canvas white fallback; real Pixel8 paint,
  same-coordinate sample, Undo/Redo/sample and fresh two-stamp publication/replay;
  hidden partial reference plus transparent-reference Canvas fallback.
- Two genuine occupied CC marks with distinct Uint16-bound definitions; exact
  source/runtime stops, seam, sampled motion, stable gradient IDs/dedup and
  unchanged FG/BG, six canonical planes, source rasters and history.
- Visible native CC/sequence blue with normal target; genuinely recorded blue0 /
  red1 / blue0 sampling; native normal occlusion, Layer Opacity50, Hide/Show and
  opacity100 recovery. Every displayed64-pixel region has an independent colour
  oracle and every pick preserves canonical sources/events/all8frames/history.

The same finalized tests fail8/pass5 on original runtime and pass13 repaired;
related focused tests total43 passes. Root fullgateV1 caught only two ambient
WebGPU overload errors in the test Canvas adapter; V1 log/candidate are retained.
The bounded type-only correction preserves emitted test JavaScript byte-for-byte
(`area31-test-type-only-v2-proof-session39.json`). Runtime source hashes remain
unchanged. Clean candidate fullgateV2 passes type-check, lint and full Jest:
Test Suites: 1 skipped, 610 passed, 610 of 611 total
Tests:       1 skipped, 6054 passed, 6055 total
Snapshots:   2 passed, 2 total
Production preview build exits0; final source binding is
`area31-source-freeze-final-v2-session39.json`. Independent runtime/test review is
`area31-sampling-independent-review-geometry39.md`; the current type/guard rebind
is separately recorded. No existing failing gate is silently relabelled green.

Original47 dirty/untracked paths and original staged3files/7additions remain
protected; staged patch SHA stays `df0184e4…` byte-exact because these three repair
owners do not overlap it. Only the three task source/test files and these two
ledgers belong to this area's focused commit. Commit proof is
`area31-commit-receipt-session39.json`, written by the root guard after success.
No push, deployment, branch or worktree change. Area32 is next; its prepared
fixtures require fresh activation/baseline and do not count as completion.

Limits: no sample-size/radius UI exists; do not infer it was tested. No OS-focus,
physical-device, reference-asset, cold/private-state or full adjusted/interlace /
display-filter acceptance is claimed by this area. Existing renderer policies
remain their owners' contracts.

Adjacent Area37 lead remains: genuine blue CC/sequence plus genuine red normal
above it, Layer Opacity50 and declared `blendMode: screen` displayed uniform
`[128,0,127,255]` instead of independently expected `[128,0,255,255]`. The screen
phase stopped at the display premise before sampling. Current panel has no blend
selector, so this is an I/O-setting presentation witness, not blend-UI acceptance.
Retain `area31-supplement-before-v1-classification-and-area37-lead-session39.json`
and investigate the rendering owner in Area37. The completed Eyedropper repair
includes no compositor change and does not claim that deferred finding is fixed.

## Session39 — Area32 final software signoff: Colour panel

Areas01–32 are software-verified; Areas33–65 remain pending. Area32 passes all
11 native cases/392 checks on production artifact `de048c0034d88571ec8ebca9d954fbcbe4be0e5ef239905585034f3cbd6dc91f`.
The full isolated task-only gate passes type-check, lint and610suites/6062tests,
with two passing snapshots and one existing skipped suite/test. Production build
and independent source/test/diff review pass. A focused local commit follows.

A32-01: trusted Delete at the two-stop minimum removed one visible local stop
while the palette, project and brush runtime retained both. The existing shared
GradientEditor now rejects Delete/Backspace at the minimum or an invalid index
before pushing local history. This preserves editor/material agreement, selected
stop and an existing Redo. Valid3→2 deletion and local Undo/Redo still work. Six
new semantic failures reproduced before the repair; all14 editor tests now pass.
The eight added regressions cover both keys, inline/external modes, callback and
global-key isolation, valid deletion/replay and rejected deletion retaining Redo.

Native coverage includes RGB endpoints, FG/BG and full-alpha X/ShiftX swap/copy,
selected-colour opacity, HSV hue/cells/white/black and retained hue, held RGB/HSV
clamps/release/hover, and actual Pixel colour-alpha0/50/100 with exact complete
bitmap/framebuffer, natural history publication, Undo/Redo and fresh strokes.
Shared ClassicRGB/Ocean selection survives real tool/preset/layer routing; external
stop RGB/opacity targets leave FG/BG and committed sources exact, then native
swatch selection returns editing to the intended slot. Gradient add/drag/local
UndoRedo/valid deletion, rejected minimum Delete and Backspace, and real rename
x/Escape/fresh workspace X all pass. Source rasters/framebuffers, resident six
planes/bindings and canvas history remain exact for colour-only editing.

The public main panel has RGB/HSV, without numeric HSL, Hex or Transparent;
recent swatches are shared CC gradients. Separate inline editor/storage and
broader propagation belong Area33. No unsupported control was invented. Native
RGB range input uses its actual18px thumb track: an independent pre-input plan
predicts197 at the tested point, and trusted input/up/change/material all agree.
The prior191 fullrect expectation and INPUT ownCapture flag were fixture errors,
not RGB app defects. Trusted same-pointer got/lost capture remains required.
Swatch checks await the unchanged exact CSS-transition endpoint. Gradient source
positions use a preplanned integer MouseEvent point; visible percentages use
independent CSSOM serialization. Original failed fixtures/receipts are retained.

Evidence under ignored output/playwright: area32-gradient-minimum-qualified-
before-session39.json; area32-rgb-native-range-before-v3-classification-session39.json;
area32-native-final-session39.json; area32-preview-final-v1-session39.json;
area32-source-freeze-final-v1-session39.json; area32-isolated-gate-v1-session39.json.
Native suites restore original owned storage after real startup persistence and
remove observers; the named browser session is closed. Physical-device input,
global palette save/load, playback/export and subjective visual signoff are not
claimed by this panel area. The separate Area37 blend lead remains deferred.

Scope is exactly GradientEditor, its existing test, and these two ledgers. All47
original working changes and the staged three-file/seven-addition patch remain
byte-exact at `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`. No mixed owner is involved. No push,
deployment, branch, worktree or chat creation. Area33 inventory/native preparation
and its baseline helper remain unrun/unactivated until this area is committed.

## Session39 — Area33 final software signoff: Gradients

Areas01–33 are software-verified; Areas34–65 remain pending. All 11 native cases /
506 checks pass on production artifact `f415a78ac0c00f7641f2b07b75f8874d65c58d9814896dd1498aeba4acc0055f`.
Type-check, lint, 610 suites / 6069 tests and two snapshots pass in the isolated
task-only gate, with one existing skipped suite/test. Production build and
independent source/test review pass. A focused local commit follows.

A33-01: captured custom-gradient row B-before-A left the customs unchanged and
swapped the first two defaults. Dropdown emitted filtered draggable slots while
its sole production reorder caller consumed full option indices. The source
callback now emits actual option indices; internal drag/drop, selection, actions
and persistence stay unchanged. Both index regressions failed before; all ten
component tests pass after. Seven added pointer tests cover both directions
past a fixed default prefix and action suffix, stationary default/custom
selection, actions, interactive children and cancellation. Native after-proof
requires the exact custom order, unchanged full default prefix and real reload.

Native coverage includes the actual Mosaic inline editor catalogue/defaults;
Hex/default fork/same-ID edits and reload; Transparent/opaque restoration;
integer add/drag/Delete and local Undo/Redo; native +Add/remove/no resurrection;
custom reorder and persistence. Positive inline uniform edits author two literal
8x32 opaque Mosaic marks with exact full bitmap/framebuffer and native replay.
Shared Classic RGB/Ocean future CC marks retain exact source/runtime/slot
bindings, old six-plane bytes/rendered material, and native Undo/Redo. Conditional
public recolor cases prove first-edit conversion, full source/index/palette,
literal uniform rendered/view output, parent publication, exit/reopen/Escape and
stored flow semantics. Recolor canvas history, animated timing and export remain
Area35 obligations; these bounded cases do not claim their correctness.

The CC before fixture initially used contrast0, which correctly collapses stops
to their mean. Source-preserving contrast70 fixes that test premise; unchanged
strict literal runtime/source/slot expectations pass. This was not an app defect.
Original failed receipts and the explicit independent-review correction remain.
Recolor Reverse/Pong describe flow, with no dedicated stop-order Reverse control.
Original dirty BrushLibrary source remains preserved and is included in the
working production preview; public entry reachability was proven natively.

Evidence under ignored `output/playwright/` includes
`area33-custom-reorder-qualified-before-session39.json`,
`area33-cc-future1-qualified-before-session39.json`,
`area33-recolor-parent2-qualified-before-session39.json`,
`area33-native-final-session39.json`, `area33-preview-final-v1-session39.json`,
`area33-source-freeze-final-v1-session39.json` and
`area33-isolated-gate-v1-session39.json`. Every suite restores its exact owned
storage/session packet after real startup persistence and removes observers.
The named headless browser session is closed. Physical-device and subjective
visual signoff are not established by these software checks.

Scope is exactly Dropdown, its existing test and these two ledgers. All47
original working changes and staged three-file/seven-addition patch remain
byte-exact at `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`. No mixed owner is involved. No push,
deployment, branch, worktree or chat creation. Area34 preparation is read-only;
it is not activated or signed off by this area.

## Session39 — Area34 final software signoff: Colour Adjust

Areas01–34 are software-verified; Areas35–65 remain pending. All30 native cases /
775 checks pass on production artifact `9b61f9a36b43b8a6d2f92f07cd01c950d4bd99d925214620b483fb9d48979daf`.
Type-check, lint, 611 suites / 6118 tests and two
snapshots pass in the isolated task-only gate, with one existing skipped
suite/test. Production build and independent source/test review pass. A focused
local commit follows. Current public panel has no Levels controls.

A34-01: native locked normal and CC targets could be edited and committed.
Shared eligibility/session capture now rejects locked targets before capture.
A captured target becoming locked cancels the complete shared-baseline session
and prevents either history publisher. This preserves the current lock flags
and avoids incorporating unrelated lock state into mixed CC Undo history.

A34-02: genuine negative-origin/project-edge marquees with zero intersection
fell through to whole-layer adjustments. Raster and CC preview now distinguish
explicit empty support from no selection and restore pristine material. CC
history excludes targets with explicit empty support, avoiding empty edit
entries. Actual native selection/mask state and outside material remain exact.

A34-03: consecutive whole CC previews requested/store/render Hue120 while the
canonical document retained Hue121. The current store/cache palette metadata
now precedes pristine paint snapshot publication at the existing runtime seam.
Literal used definition/sourceStops/slot colours match120 with original six
planes. Recolor retains its original publication order. Reset and positive
preview Cancel restore original material without an extra Cancel workaround.

A34-04: neutral selected CC entry/Reset remapped32slot and32definition IDs,
and no-input Apply published an edit. Selected cloning requires nonneutral
adjustments; scalar-neutral CC Apply creates no structure transaction. Positive
selected adjustment, Apply and natural Undo/Redo retain their strict oracles.

A34-05: mixed raster/CC Apply published a raster bitmap entry followed by a CC
structure entry whose whole-project baseline also rewound the raster pixels.
The first Undo restored raster canonical data too early and the next bitmap
Undo failed preparation, leaving its framebuffer adjusted. The CC history
baseline now contains completed raster target bitmap state; raster entries
retain sole ownership of their before/after pixels. The two-entry granularity
is retained. Real-history regressions prove repeated intermediate ownership;
native Undo/Redo restores exact original and committed material.

A34-06: raster Apply captured endpoint-only selection history. Native Undo
restored pixels while dropping the actual freehand mask, bounds, layer owner
and vector path for all480 completed observations over eight seconds. Raster
history now uses the existing full selection-state snapshot. Undo/Redo retains
the complete authored selection alongside exact pixels and history counts.

The user explicitly chose to keep greys neutral under positive Vibrance.
The math owner preserves zero saturation; coloured positive-Vibrance behaviour,
negative Vibrance, alpha and the existing adjustment ordering are retained.
Tests require literal grey values across alpha/strength, full desaturation
composition and an unchanged coloured result. Original CRLF/LF bytes were
preserved around the one-condition source edit.

Native coverage includes public U/toolbar entry; Hue/Saturation/Vibrance/
Lightness/Contrast/R/G/B and CC Ink Contrast; numeric draft Enter/Escape;
Reset/Cancel/Apply/Enter/Escape/tool switch; original composite picking and
hue wrap/S/L intersection/softness; genuine clipped, empty and freehand-masked
normal/CC selections; whole/selected CC used metadata, all six planes and
literal displayed marks; mixed targets; locked/hidden/blank/unsupported target
admission; natural history and positively witnessed pending-preview races.
Nonempty erase-mask authoring, full Recolor and export remain their own areas.

Failed fixture classifications remain explicit: project centering must settle
before a declared camera; vessel-settings is an owned/restored key; native
range checkboxes use visible labels; AdjustmentLayerPanel owns its colliding
slider labels; display probes avoid marquee ants. CC Undo can retain richer
unused runtime dictionaries under the existing persistence contract. Only
Undo permits recorded extra entries unreferenced by every restored raw ID
plane; used entries, pre-existing entries, all planes/render/store/masks remain
exact. Masked-normal Undo captures bytes synchronously and uses completed asynchronous
observations with a synchronous wait predicate; accepted observations require
consecutive exact source/history/selection/display samples. Earlier V4 async
predicate and cached-selection diagnostics were invalid and remain corrected
in the evidence record. These classifications do not
weaken positive preview/Apply/Cancel/Redo material checks. The failed V2/V3
checks preserve their new test-adapter type errors; V5 retains explicit typed metadata
serialization and reruns the complete gate.

Evidence in ignored output/playwright includes qualified locked/empty-selection,
CC document-lag and neutral-selected before receipts; final six-source freezeV4;
isolated gateV5; production previewV5; final native seven-suite manifest and
area34-native-final-session39.json. Every suite restores its owned storage and
session packet after real startup persistence and removes observers. The named
headless browser is closed. These software checks do not establish physical
tablet/device or subjective visual signoff.

Scope is exactly colorAdjustSession, colorAdjustSlice, imageProcessing, their
three tests and these two ledgers. All47 original working changes and staged
three-file/seven-addition patch remain byte-exact at
`df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`. No mixed owner, push, deployment, branch, worktree or
new chat is involved. Area35 preparation does not activate or sign off Recolor.

## Session39 — Area35 final software signoff: Recolor

Areas01–35 are software-verified. Area35 passes24 native cases / 2147 checks
across15 suites on production artifact `d368992571cc8a8c0d8caa11e28a8d74c474357098f26331ffac42addbf2b155`
(page-f07d52514b0e05f8.js). The full40-source isolated check candidate passes
type-check, lint, generated Goblet consistency and618 suites /6324 tests /
two snapshots, with one existing skipped suite/test. Production buildV5 passes
and preserves Studio. The focused42-file local commit is recorded by
`area35-commit-receipt-session39.json`; no push or deployment belongs to this area.

The repair preserves sparse painted source and0/128/255 alpha; publishes independent
per-layer GPU outputs; uses the same Recolor phase math in app CPU/GPU and both Goblet
players; and preserves all four flows, both mappings, palette index maps and source
alpha times stop opacity. Ordinary CC brush index/speed semantics remain unchanged.
Public conversion transfers all six planned controls. Gradient and control changes
produce bounded, immutable global history commands; FPS replay restores the actual
global scalar and affected timing metadata with failed-replay compensation. Conversion
replay hydrates only its target, retains untouched canonical sources and reconciles the
ephemeral playing flag to the actual controller. No clock or renderer forcing is used.

Public regular conversion bakes the current published frame through its layer owner;
subsequent genuine Pixel drawing and stroke Undo/Redo pass. The background monitor no
longer rewrites authored FPS. Actual Save.vs → New → fresh reload → Load → Play restores
saved consensus15 FPS and exact persisted source/settings, then produces at least three
successful GPU frames with exact material. PNG normalization of hidden zero-alpha RGB
and pre-Play lazy canonical state remain explicit representation boundaries. Mixed or
invalid legacy per-layer FPS is preserved without inventing a global target policy.

Public Goblet downloads retain requested flow; downloaded nonuniform initial output
matches independently predicted desired and serialized phase. Actual alpha composite
uses the independently decoded packaged backdrop as its I/O input. Both exported player
modules also pass deterministic phase/alpha/map/playback tests; generated outputs match
owners. This does not claim the complete export-format audit, which belongs to Area58.

Locked targets reject conversion and local edits before engine/history changes; native
disabled/inert controls reflect the same policy. Global cadence from an unlocked owner
remains global. Pending gradient changes flush to the old owner on tool/layer switches.
Escape cancels the layer edit and the editor's own queued/local draft, undo/redo stacks,
selection, picker and drag state through its existing handle. Identical unrelated props
continue to preserve a pending editor draft; no keyed remount or generic sync workaround.

Final evidence: `area35-source-freeze-v5-session39.json`,
`area35-final-gate-v1-session39.json`, `area35-preview-after-v5-session39.json`,
`area35-native-final-v2-session39.json`. The final receipt retains14 unchanged successful
V1 suites and the corrected lifecycle retest on the same exact build. The retained V1
lifecycle failure counted a cold lazy observer diagnostic toward its frame wait; V77
waits for three successful GPU receipts before Pause, with acceptance unchanged. No app
source or build changed for that fixture correction. All24 cases /2147 checks pass,
all owned storage is restored, no page errors occur, and both named-session cleanup
receipts confirm no matching daemon remains.

All47 original working files and the original staged three-file/seven-addition patch
remain byte-exact (`df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`).
The preview isolates artifacts while retaining the hash-pinned working baseline47 plus
owned40 files; the full check candidate contains HEAD plus owned source. Software proof
excludes physical stylus/device signoff and scheduler-specific wall-clock cadence claims.
Areas36–65 remain pending. Area36 read-only preparation does not activate it or capture
a baseline before this area's completed commit.

## Session39 — Area36 complete: basic layer operations

Areas01–36 are software-verified: **36/65 (about55%)**. Area36 passes **8 native
cases /717 checks /4 suites** on rebuilt production artifact `2bce364d`, bundle
`page-7671fbdb4fb2f5e1.js`, at `http://localhost:3001/vessel/`. Full isolated gateV3
passes type-check, lint and **618 suites /6331 tests /two snapshots**, with the existing
one skipped suite/test. Production build exits0; Studio output is preserved. The named
headless browser is closed with no matching daemon; all owned storage bytes are restored.

Qualified repair: native Enter/blur renamed the layer without adding a history command.
Actual global Undo therefore removed the previous red64 brush stroke and retained the
new name. The explicit `renameLayer` action now trims and validates against fresh state,
deduplicates Enter/blur, records one command, and leaves empty/unchanged/missing targets
alone. A small name-only delta changes only the target name through the existing exact
compensation seam. It does not clone raster/runtime/selection state or collect rehydration
targets. Generic `updateLayer` and full structural replay keep their existing contracts.

The final eight existing files are LayersPanel and its test; layerCollectionActions;
layersSliceTypes; layerStructureDelta; layersSlice.integration.test; one matching AppState
action declaration in useAppStore; and the isolated composite layersSlice.unit.test boundary.
The latter explicitly mocks the unused name-delta factory and throws if it is invoked;
actual rename/history/compensation integration tests stay unmocked. Before full approval,
the first type gate exposed the duplicated AppState declaration, and the next full suite
exposed that isolated unit's new history import boundary. Both failed receipts remain
retained; final V3 passes. All164 affected tests and scoped lint pass as well.

Native coverage: actual regular Add above active, blank-layer semantics, plain singleton
selection, and two exact Undo/Redo cycles (1/111); Enter trim and Tab blur each one command
with two name-only replay cycles plus Escape/empty/unchanged no-op and actual prior-brush
UndoBlank/RedoRed (3/195); Copy/Copy2 naming, copy-only blue64 over red64, independent
original/other-copy material, and two full paint/duplicate Undo/Redo cycles (1/195);
normal Delete middle/top, first surviving store-order fallback, exact source restoration,
public reduction to one, disabled last-layer protection, and repeated replay (3/216).
All commands use actual public controls/trusted input and real history IDs. Normal source
RGBA/framebuffers, masks/alignment/selection/reference/groups and full workspace output
are checked. Add/duplicate preserve the existing CC six canonical planes and source bindings.

Fixture qualification remains explicit: OffscreenCanvas reads and optional undefined-key
encoding were corrected; serialized brush caches retain raw evidence and validate five
redundant fields against canonical/store authority, keeping pixelVersion and every paint
plane strict while observing document revisions. Nine independent positive/negative controls
prove cache validation. The old Delete fixture also observed intentional250ms GC reclaiming
an unused numeric-definition slot lease: all paint/definition cells were zero and stops/
hash/material unchanged. No application patch or comparator relaxation was made for that.
Final ordinary-Delete cases publicly remove positively empty default CC setup layers before
creating their normal sources; specialized CC lifecycle/lease flows remain Area41 scope.

Final evidence: `area36-source-freeze-v3-session39.json`, `area36-final-gate-v3-session39.json`,
`area36-preview-build-v3-session39.json`, `area36-preview-after-v3-session39.json`, and
`area36-native-final-v1-session39.json` under ignored `output/playwright/`. The final native
plan binds all4 prepared/executed scripts, raw process exits/logs/results and cleanup. The
focused ten-file publication (eight source/tests plus these two ledgers) is recorded by
`area36-commit-receipt-session39.json`. Original47 working paths and staged three-file/
seven-addition patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`
remain exact. Stay on `main`; no push, deployment, branch/worktree/new chat.

Areas37–65 remain pending. Area37 ignored owner plans/selection-reorder fixture are prepared
and unrun; no fresh37 baseline or activation is implied. Reorder/multiselect/visibility/
lock/opacity/blend/merge belong37, groups38 and specialized CC lifecycle41. Subjective visual
signoff and physical pen/touch pressure are not supplied by this software-only proof.

## Session39 — Area37 complete: layer controls, selection and ordering

Areas01–37 are software-verified: **37/65 (about57%)**. Area37 passes **13 native
cases / 917 checks across 9 suites** on production artifact `ef1618d96fd9db217030f86579a7f52797180d829845933b3c203d35d602b519`.
Full isolated HEAD-plus-owned-source verification passes type-check, lint and Jest:
1 skipped, 619 passed, 619 of 620 total;       1 skipped, 6341 passed, 6342 total; snapshots   2 passed, 2 total. Production build preserves Studio.
The preview artifact retains the hash-bound working baseline47 plus owned source7;
it is not a source-isolated preview. A focused nine-file commit includes source7
and these two ledgers; its actual receipt is `area37-commit-receipt-session39.json`.

Public plain selection, Shift add-only multiselect, singleton restoration, trusted
HTML5 singleton/block reorder and selected-block same-boundary no-op pass. Actual
command IDs and two Undo/Redo cycles retain source/material/order and ownership.
Ordinary row drops use moveLayersToGroup with an undefined group; group-header and
membership behavior belongs Area38. No synthetic drag or private reorder is used.
Visibility Hide/Show covers singleton and selected sets with its existing no-history
contract. Lock and transparency-lock reject forbidden genuine Pixel contacts and
allow positive authoring/replay when admitted. Opacity100→50→100 covers singleton
and selected sets with exact pre-action literal Canvas composition references.
Lock/opacity history granularity and actual prior-command Undo/Redo are characterized;
no new history policy is inferred from command absence. The current panel exposes
no blend selector, so public blend-mode authoring is not claimed. Explicit existing
blend-setting I/O supplies the supplemental presentation witnesses below.

Normal selected merge passes literal source/composition and two replay cycles;
singleton merge is disabled. Incompatible adjustment/normal merge preserves the
document/history and publishes a warning. The qualified hidden-warning defect is
repaired at its display owner: AppNotifications presents actionable warnings/errors
and square accessible dismissal, while critical History recovery failed retains
priority and cannot be dismissed. Info/success remain hidden. Native warning display
and dismissal preserve the document/history and remove only the warning's ID.

The deferred Area31 Screen lead is resolved at its compositor owner. Current BEFORE
V8 (`area37-screen-cc-normal1-before-v8-session39.json`) retained genuine blue CC
and red normal source/sixplanes/history but displayed source-over-like [128,0,127]
instead of Screen [128,0,255]. The first direct-normal attempt was rejected because transparent artwork blended
with presentation checker colors; its BEFORE/AFTER receipts remain preserved in
`area37-screen-transparent-regression-qualified-after-v1-session39.json`. That attempt
was removed before replacement. The existing isolated ordered artwork composition
now retains normal blend relations across CC/sequence boundaries, and only then
places the artwork over presentation background. Transparent Screen100 stays literal
red and Screen50 matches independent artwork-alpha plus checker composition. Actual current
CC and sequence fixtures require Screen50 and Screen100, source-over100/50 reset
controls and repeated Screen50 with authored source/history unchanged. These are
explicit blend-setting I/O presentation proofs; there is no current blend selector.
No group/interlace or specialized CC ink acceptance is inferred.

Evidence: `area37-source-freeze-v4-session39.json`, `area37-final-gate-v4-session39.json`,
`area37-preview-after-v4-session39.json`, `area37-native-final-v3-session39.json`.
The canonical receipt binds every suite to its prepared hash and the same built
artifact; storage is restored, page errors are absent, and named-session cleanup
confirms no matching daemon. Earlier fixture failures remain retained separately;
no failed observer premise is promoted to a runtime defect. Software proof excludes
physical stylus/device and subjective visual signoff. Original47 working files and
staged three-file/seven-addition patch remain exact (`df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`).
Areas38–65 remain pending; Area38 requires its own exclusive baseline after commit.

## Session39 — Area38 complete: layer groups

Areas01–38 are software-verified: **38/65 (about58%)**. Area38 passes **12 native cases / 1016 checks across 7 suites** on production artifact `daa67a4923f595865989c50460b7bdfcd0a9a33b61aaa47e8d61152e57e46ef8`.
Full isolated HEAD-plus-owned-source verification passes type-check, lint and Jest:
1 skipped, 619 passed, 619 of 620 total;       1 skipped, 6345 passed, 6346 total; snapshots   2 passed, 2 total. Production build preserves Studio.
The preview retains hash-bound original47 plus owned source7; the focused nine-path
commit contains source7 and these two ledgers. Actual receipt: `area38-commit-receipt-session39.json`.

Public group creation covers noncontiguous selection, literal default Group 1,
contiguous membership/order, header selection, collapse/expand and source preservation.
Trusted native whole-group/member drag covers membership and order with real history
replay. Actual mixed-member Hide/Show restores prior individual visibility; Add from
a singleton grouped member inherits membership while Add from the full selected group
stays outside. Header context opacity100→50→100 changes selected member opacity only,
with exact pre-action literal CPU Canvas references; no separate group-alpha field.
Flat regroup creates Group 2, replaces old memberships and prunes empty Group 1;
this characterizes flat replacement, not nested group support. Actual Ungroup retains
all sources and real command replay; grouped Delete prunes an empty group naturally.

Two qualified history-owner defects are repaired. Grouped duplication retains its
existing per-copy two-command granularity and single-duplicate contract, but captures
the cumulative selected-copy set inside each command snapshot so complete Redo matches
the public result. Hidden group Delete/Undo restores hidden identities plus the
factory-owned per-member visibility memory; actual direct Show after Undo restores
the original mixed state without a recovery toggle. Full canonical/framebuffer,
selection, source, group/membership/order and actual command IDs are verified.

Earlier fixture-only failures remain preserved: outer ID-dictionary insertion order,
source-owned projectGroups replay projection, exact new blank canonical1px-zero
materialization, and unavailable diagnostic metadata were classified from full raw
receipts and source contracts. No broad material normalization or private state write
was used. Public group rename and explicit isolation controls are absent in the
inspected panel; generated names and flat behavior are characterized without inventing
those UI routes. Specialized interlace/adjustment/CC ink semantics are not inferred.

Evidence: `area38-source-freeze-v1-session39.json`, `area38-final-gate-v1-session39.json`,
`area38-preview-after-v1-session39.json`, `area38-native-final-v1-session39.json`.
Canonical native receipt binds all prepared scripts/raw logs/results to the same
artifact. All five owned storage keys restore exactly including collapsed groups;
page errors are absent and named-session cleanup confirms no daemon. Original47
working bytes and staged3files7additions remain exact (`df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`).
Software proof does not claim physical input devices or subjective visual signoff.
Areas39–65 remain pending; Area39 needs a fresh exclusive baseline after commit.

## Session39 — Area39 complete: adjustment layers

Areas01–39 are software-verified: **39/65 (60%)**. Area39 passes
**16 native cases / 2710 checks across 9 suites**
on rebuilt production artifact `08e7cb855c06b091af568059bbf1e200458c629152b456bb42fdb312bbf6fda4`. The source-isolated HEAD-plus-nine-file
gate passes type-check, lint and Jest: 1 skipped, 621 passed, 621 of 622 total;       1 skipped, 6356 passed, 6357 total; snapshots   2 passed, 2 total.
The production build retains hash-bound original47 plus owned source9, isolates its
artifact output and preserves Studio. The focused eleven-path commit contains these
nine source/test/generated files and both ledgers; receipt `area39-commit-receipt-session39.json`.

Actual public Add Adjustment/defaults and all four effects are exercised. Hue/Sat
covers Hue pointer120 and keyboard Home/End boundaries, both Saturation/Vibrance,
Lightness/Contrast and RGB channel directions with exact settings, Reset and real
Undo/Redo. Colour Grade covers brightness/contrast/saturation endpoints with
independent native CSS references. Pixelate Cell1/4/64 uses a nonuniform multiscale
source and complete independent backend tensors. Bloom Radius0/12 and Intensity0/2,
Reset defaults and history prove source identity versus spread above the intended
warm low-field floor; no exact vendor Gaussian/kernel claim is made.

Affects All/single/No layers, Strength50, lower-source Hide/Show, adjustment visibility,
trusted native reorder, group scope and eligible target options use spatially
observable sources. Pending Strength followed by a real layer switch commits exactly
once through the actual blur/cleanup route. Source canonical/framebuffer/masks,
owner metadata, membership/order, selection and actual command IDs remain strict.
Actual Save→New→Load restores durable adjustment/group/target/strength and sources;
public Goblet2 download and its existing preview iframe verify grouped Hue/Strength
and the changed Vibrance guard against complete independent input/output tensors.
Partial-alpha neutral and transparent pixels retain their pre-action display and
source bytes, alongside an independent opaque chromatic positive control.

Two qualified owner defects are repaired. Positive adjustment Vibrance previously
turned exact gray128 into255/1/1, including both Redos; the shared Hue/Sat pipeline
now raises saturation only when adjusted saturation is nonzero. Both Goblet module
copies and inline runtimes are regenerated from that owner. The actual exported
Vibrance100 runtime preserves achromatic codec inputs and applies full saturation
to chromatic inputs. Real Radix keyboard Hue changes previously updated live pixels
without an Undo command because onValueCommit precedes controlled onValueChange.
The panel now queues the commit in the same event turn for the captured edited ID,
after preview publication. Real Radix/store/history regressions fail before and
pass after, including old-owner cleanup deduplication and source preservation.

Preserved fixture-only findings: active-owner Add insertion, semantic dictionary
key order, duplicate trigger/option names, native CSS contrast rounding, Pixelate
CPU/GPU averaging and Bloom's source-defined warm floor. Finite whole-frame backend
references preserve exact spatial tensors; no per-pixel tolerance or private repair
is used. Actual Goblet texture encoding intentionally negotiates AVIF .6/WebP .75
before PNG. Independent native codec qualification proves actual decoded inputs
exactly match pre-action literal encoded references. Export expectations derive only
from those independent decoded inputs and declared effect/compositing math, preserving
the existing codec policy. Editor source bytes and editor view remain exact literals.

Evidence: `area39-source-freeze-v2-session39.json`, `area39-final-gate-v2-session39.json`,
`area39-preview-after-v2-session39.json`, `area39-native-final-v1-session39.json`.
Canonical receipt rehashes all raw CLI logs/results/prepared scripts against the same
artifact and frozen source. All five owned storage keys restore exactly; page errors
are absent and named-session cleanup confirms no daemon. Original47 working bytes
and staged3files7additions/raw patch remain exact (`df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`).
Unexposed hue-range controls, physical devices and subjective visual signoff are not
inferred. Areas40–65 remain pending; Area40 requires a fresh baseline after commit.

## Session39 — Area40 complete: alignment ownership and scaled anchor nudges

Areas01–40 are software-verified: **40/65 (61.5%)**. Final production proof passes
**10 native cases / 1581 checks across 7 suites** on artifact
`a005772150b786f8816b9f22160fad0982fd387e254103a8126e7eb76ccdb24b`. The source-isolated committed-HEAD-plus18 gate passes diff-check,
type-check, lint and full Jest: 1 skipped, 622 passed, 622 of 623 total;       1 skipped, 6375 passed, 6376 total;
snapshots   2 passed, 2 total. The production preview build uses the preserved
working original47 plus exact frozen18, isolates its output and preserves Studio;
it is not described as source-isolated. The focused local commit includes exactly
18 source/test/generated paths and these two ledgers; no push or deployment.

All nine public anchor controls have exact accessible names and boolean pressed
states, as do Auto and all five Fits. Metadata, signed X/Y, Auto and actual
Save→New→Load preserve complete asymmetric non-square RGBA sources, framebuffer,
other owners, groups and selection. Native selected-set X then Y retains each
layer's own fit/anchor and other axis. Alignment action history remains observed
at its real granularity; no synthetic alignment Undo command was introduced.

The user chose anchor-relative nudges scaled with artwork and zero nudges on
Auto→anchor. The owning normalized/exported field now survives to actual G1/G2
responsive placement. None/Contain use their actual artwork scale; Fill uses its
independent X/Y scale. Cover translates artwork inside the unchanged coverage
clip, preserving cropped margins. Tile keeps coverage fixed and quantizes authored
movement at the core boundary before subtracting it from pattern phase. Auto and
zero-offset behavior remain compatible. Anchor→anchor retains that owner's nudge;
each Auto→anchor starts0/0, with explicit requested offsets authoritative.

Actual public Default exports exercise all nine zero-offset None anchors, Auto,
five center fit modes and positive/negative nudge witnesses in both player versions.
Cover/Tile and qualified Fill/Contain complete-frame models are independently
frozen before export, using declared geometry and independently decoded literal
codec inputs. Fixed/Embed direct-placement policy stays unchanged and has separate
native controls. Whole source assets and whole rendered tensors remain exact;
there is no per-pixel tolerance, private renderer call, forced clock or output-derived
expected geometry. Native check counts above come from actual canonical receipts.

The earlier metadata clobber, unnamed buttons and dropped nonzero placement field
are repaired at their owners. Focused final regressions fail15/pass25 against
isolated pre-geometry production and pass40 in six suites after. Actual typed
artifact-builder tests verify metadata/layout/opx transport and clone ownership;
actual public module math/draw tests verify all nine origins, fixed Cover clip,
Tile phase and fractional rounding. Existing runtime mirrors are retained and only
four existing generated assets are regenerated; protected HtmlBuilder,
bundleContracts and global layer types remain untouched. Initial UI-only checks and
all rejected/failed fixture premises remain historical evidence, not final acceptance.

Evidence: `area40-source-freeze-v3-session39.json`, `area40-final-gate-v3-session39.json`,
`area40-preview-after-v3-session39.json`, `area40-native-final-v3-session39.json`.
The aggregate rehashes every prepared/compiled script, raw CLI log and parsed result
against this exact artifact and frozen source. All six owned storage keys restore
through two quiet fences, page errors are absent, and cleanup confirms the named
browser session has no matching daemon. Original47 bytes and original staged
three files/seven additions/raw patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact.

Area41 has preparation only and no native or app-source acceptance in this commit.
Its earlier49-file baseline is historical because it included the then-uncommitted
UI2; root must capture a fresh versioned bridge after this completed40 commit while
preserving original47. Future areas, hardware behavior and subjective visual
signoff remain unclaimed. Area40 completion does not activate another area.

## Session39 — Area41 complete: Color Cycle layer lifecycle

Areas01–41 are software-verified: **41/65 (63.1%)**. Actual final production proof passes **14 native cases / 855 checks across 14 suites** on artifact `b9f1f90a52c591506121628265bf3057ef7386790fe3f5dcf1bc6b8597de42a2`. Source-isolated HEAD plus only two resize-history files passes diff/type/lint/full Jest: 1 skipped, 623 passed, 623 of 624 total;       1 skipped, 6381 passed, 6382 total; snapshots   2 passed, 2 total. The full preserved working-tree preview build isolates its artifact and preserves Studio.

Public lifecycle coverage includes immediate empty Add, genuine occupied painting and replay, conversion, clear/repaint recovery, independent owners, visibility/lock/playback, identity and positive-mask resizing, and occupied duplicate/delete. Masks now join the original resize history transaction through existing erase/soft-edge mask delta owners, retaining dimensions, full alpha, enable/version and compensation. The causal final six tests fail three mask-dimension restoration cases before and pass after; final native checks above come from actual receipts. No private painting, rendering or history invocation substitutes for native input.

All final prepared/executed scripts, raw logs/results, actual command IDs, complete material/source/metadata and six-key restoration are bound to this artifact. Named session cleanup confirms no matching daemon; original47 and the staged three files/seven additions/raw patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact. Raw cache checkpoint/default-seam representation classifications remain explicit and narrowly source-qualified. Area40 and its committed placement policy remain unchanged. The focused local commit owns exactly two source/test paths and these two ledgers, with no push. Future areas and subjective visual signoff remain unclaimed.

Evidence: `area41-source-freeze-v2-session39.json`, `area41-final-gate-v2-session39.json`, `area41-preview-after-v2-session39.json`, `area41-native-final-v1-session39.json`.

## Session39 — Area42 complete: Interlace lifecycle

Areas01–42 are software-verified: **42/65 (64.6%)**. Actual final production proof passes **9 native cases / 838 checks across 9 suites** on artifact `876ce71d62e306f0fcf93280895aee1240e91acff2453fe0fdaf67fe5e38728f`. Source-isolated current HEAD plus six owned source/test files passes diff/type/lint/full Jest: 1 skipped, 623 passed, 623 of 624 total;       1 skipped, 6395 passed, 6396 total; snapshots   2 passed, 2 total. Full preserved working-tree preview build isolates the artifact and preserves Studio/public runtime assets.

Actual public creation/replay, settings with keyboard/pointer previews and one-command commits, membership Add/earlier/later/pose drag/remove/Release, unsupported layer eligibility, mixed normal/native-CC transparency, natural patterns/directions/rate/Pause, Save→New→Load and initial-frame Goblet1/2 parity with hidden-member omission all pass their bounded final fixtures. Full independently declared source/material/metadata/frame models and actual history IDs remain checked; motion timing limitations and supported I/O premises remain those explicitly declared in each final owner contract. No private clock advance, renderer or history action substitutes for native input.

A42-01 removes the incorrect contiguous-block early return so requested internal order is honored. A42-02 aligns Panel eligibility with existing action guards excluding adjustment/sequential. A42-03 invalidates recomposition and cached static segments after successful group Release. Native BEFORE findings and rejected fixture premises remain retained. Causal candidate regressions fail4/pass11, fail5/pass2 and fail2/pass1 before; combined126 tests pass after. The first full gate's test-only TypeScript union narrowing failure is retained, corrected without production change and superseded by the actual final gate above.

All nine raw CLI results/logs/exits and prepared/compiled scripts bind to the actual artifact/source freeze; every six- or seven-key quiet-fence restoration passes, errors are absent and named cleanup confirms no matching daemon. Original47 and raw staged three files/seven additions/patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact. Completed Area41 and prior sections remain unchanged. Focused local commit owns only six source/test paths plus these two ledgers, with no push. Future areas and subjective visual signoff remain unclaimed.

Evidence: `area42-source-freeze-v3-session39.json`, `area42-final-gate-v3-session39.json`, `area42-preview-after-v3-session39.json`, `area42-native-final-v2-session39.json`.

## Session39 — Area43 complete: Sequence layer lifecycle

Areas01–43 are software-verified: **43/65 (66.2%)**. Actual final production proof passes **7 native cases / 508 checks across 7 suites** on artifact `2761f66b3a94feb0e00096015d380e97c285e1e425ccfe5c2b5186c1b5c6b9e0`. Source-isolated HEAD plus six owned source/test files passes diff/type/full lint/full Jest: Test Suites: 1 skipped, 623 passed, 623 of 624 total; Tests:       1 skipped, 6436 passed, 6437 total; Snapshots:   2 passed, 2 total. Full preserved working-tree production preview build preserves Studio and all fifteen public runtime assets.

The seven mandatory public fixtures cover initial Sequence creation/recording, full Fill/Erase, CC blue Square capture, rectangle clipping, selection Delete/deselect/recovery, clipped Fill/Erase and natural multiframe recording/playback/history. Whole-frame independently declared source/material models, canonical event payloads, actual history commands and real Undo/Redo remain strict. All seven raw CLI outputs/exits/prepared+compiled scripts bind to this artifact and source freeze; all eight-key quiet-fence restorations pass, errors are absent and named cleanup confirms no matching daemon.

A43-01 permits CC brushes on Sequential targets in the existing local pointer compatibility authority while retaining normal/CC mismatch and eraser behavior. A43-02 permits canonical Sequence event-log finalization after the transient overlay is cleared between frames, retaining existing no-op guards. A43-03 records the actual CC stamp tip with existing dither precedence instead of defaulting Square to round. Qualified native BEFORE and intermediate failure evidence remains retained; causal candidate tests fail before and pass after. The first pointer-only interim preview was admission qualification and is superseded by the final six-source/full-gate/native proof above.

Original47 worktree bytes and raw staged three files/seven additions/patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact. Completed Area42 and prior sections remain unchanged. Focused local commit owns only six source/test paths plus these two ledgers; no push is claimed. CC gradient-phase fidelity and 96MB event-budget exhaustion were not established by these bounded fixtures. Detailed Sequence settings (Area44), global transport (Area45), history stress coverage (Area51), Save/Load (Area52) and Goblet export (Area58) remain deferred to their named areas; subjective visual signoff remains separate.

Evidence: `area43-source-freeze-v1-session39.json`, `area43-final-gate-v1-session39.json`, `area43-preview-after-v1-session39.json`, `area43-native-final-v1-session39.json`.

## Session39 — Area44 complete: Sequence controls

Areas01–44 are software-verified: **44/65 (67.7%)**. Actual production proof passes **6 native cases / 455 checks across 6 suites** on artifact `0971d6b2fa0033b57ec639a934ee2bc3c37e070d1b655bfb371a9681fada9fc8`. Source-isolated current HEAD plus four owned source/test files passes diff/type/full lint/full Jest: Test Suites: 1 skipped, 623 passed, 623 of 624 total; Tests:       1 skipped, 6450 passed, 6451 total; Snapshots:   2 passed, 2 total. The full preserved working-tree production preview build preserves Studio and all fifteen public runtime assets.

The six mandatory public fixtures prove FPS and Frames Preserve/Trim/Retime with independently authored frame0/frame3 data, hidden-mark retention/removal/retiming, exact immediate pixels and one real command per edit, then two complete settings Undo-all/Redo-all cycles preserving original paint. Capture/control limits, local preferences after reload and declared temporal spread/fade/burst/gap material are independently checked. Whole-frame/canonical event/chunk/metadata/source and unrelated-owner contracts remain strict; replay store currentFrame follows captured frame-policy normalization without private cursor seek/reset or transport mutation.

A44-01 repairs missing active-Sequence settings history at the record-slice/existing delta owners. FPS and Preserve store bounded scalar metadata and retain event/chunk identities; destructive Trim/Retime capture immutable event/typed nested brush/chunk data and clone each replay. Existing paint delta behavior, clamps, global-only preference behavior and raw chunk semantics remain unchanged. Qualified BEFORE Preserve/Trim/Retime evidence, initial draft candidates and nested-alias regression evidence remain retained. Native runtime AFTER above is required in addition to causal candidate tests and final full gate.

All six raw CLI logs/results/exits and prepared/compiled scripts bind to this artifact/source freeze. Every eight-key applied/consumed/restored quiet-fence receipt passes, errors are absent and exact named cleanup confirms no matching daemon. Original47 worktree bytes and raw staged three files/seven additions/patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact. Completed Area43 and prior sections remain unchanged. Focused local commit owns four source/test paths plus these two ledgers; no push is claimed. Global transport Area45, history stress Area51, project Save/Load Area52 and Goblet export Area58 remain separately scoped; 96MB exhaustion and subjective visual signoff are not claimed.

Evidence: `area44-source-freeze-v1-session39.json`, `area44-final-gate-v1-session39.json`, `area44-preview-after-v1-session39.json`, `area44-native-final-v1-session39.json`.

## Session39 — Area45 complete: Global playback and transport

Areas01–45 are software-verified: **45/65 (69.2%)**. Actual production proof passes **8 native cases / 746 checks across 8 suites** on artifact `82c7f1a1ae131a5c9d9e0442fec8818dea3f85479cddb26a2f64b4d1a2b455d7`. Source-isolated current HEAD plus seven owned source/test files passes diff/type/full lint/full Jest: Test Suites: 1 skipped, 624 passed, 624 of 625 total; Tests:       1 skipped, 6475 passed, 6476 total; Snapshots:   2 passed, 2 total. The full preserved working-tree production preview build preserves Studio and all fifteen public runtime assets.

The pinned native plan proves normal/Sequence Play/Pause continuity, trusted high-FPS Pause exact captured authored-frame projection, CC/Sequence mixed rate and ownership, normal edit-held playback, speed persistence after reload, public Resume/direction-draft Escape cancellation, live selection/visibility/removal, and completed-presentation CC/Sequence/Recolor/Interlace composition at the declared fixture contracts. Four-owner playing samples use bounded input-count acquisition: original phase minimum2300ms/1300ms remains, with an input-only coherent-count acquisition ceiling4500ms; there is no output-controlled stop or pixel fitting. Each phase requires at least four coherent samples and its original minimum elapsed time. Four-owner playing samples are admitted only by source-input acknowledgement captured BEFORE any pixel read: CC source-publication ordinal, Recolor tick, Sequence frame/FPS/count/time, Interlace elapsed input, active/visible/hidden ownership and desired playback must match the completed canvas-frame event. Pending producer-ahead receipts remain raw; each playing phase requires at least four coherent samples and positive visible-participant input progress, and EVERY coherent complete tensor must equal its independently constructed composition. Pause700ms remains fixed, ungated and whole-frame strict. The prior failed final-v1 evidence is retained; this fresh full-eight final-v2 confirmation reuses the unchanged source/gate/build and first seven prepared inputs. Published CC/Recolor canvases are explicitly upstream scene input; no pixel-match gating, tolerance or older RGBA model is used. This does not claim every producer frame is presented, standalone Recolor liveness, a presentation-latency SLA, independent palette phase or gradient-preview mathematics. No nonexistent scrub/global-zero control, hidden-clock policy, speed Cartesian matrix or arbitrary transport ratio is invented.

A45-01 freezes the latest active Sequence clip frame atomically on true-to-false playing intent using existing cursor time and clip-own FPS/count, without seek/reset/source/history changes. A45-02 repairs split-composite dependencies for every eligible visible/active Sequence clip, covering both edit-held playback and idle post-removal overlay rendering; the map is reused and updated only after successful rebuild. A45-03 preserves Recolor-owned presentation through the layer-activation owner. The owning seven-file releases, qualified BEFORE failures and rejected fixture prerequisites remain retained. Goblet player/viewer stop parity is tested through real extracted implementations; correct public assets remain unchanged. Causal tests supplement, and do not replace, the exact production AFTER proof.

All actual raw CLI exits/logs/results and prepared/compiled scripts match the same artifact/source freeze. Every declared eight/nine-key applied/consumed/restored quiet fence passes, no errors remain and exact named cleanup confirms no matching daemon. Original47 worktree bytes and raw staged three files/seven additions/patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact. Completed Area44 and prior sections remain unchanged. Focused local commit owns seven source/test paths plus these two ledgers; no push is claimed. Area46 remains pending; history stress Area51, Save/Load Area52 and Goblet export Area58 retain their separate scope. Subjective visual signoff remains separate.

Evidence: `area45-source-freeze-v3-session39.json`, `area45-final-gate-v3-session39.json`, `area45-preview-after-v3-session39.json`, `area45-native-final-v2-session39.json`.

## Session39 — Area46 complete: Display filters

Areas01–46 are software-verified: **46/65 (70.8%)**. Bounded production evidence totals **31 accepted cases / 4193 checks**, including **24 accepted HTML exports**. The 28 cases/3904 checks accepted on the initial and intermediate previews remain separately bound to those artifacts; the final source8 production artifact `843ea0e31ae40e9df682e0fd61f023672d241cf21dd5865e339e1f719ffc3427` passes three fresh cases/289 checks: live CC masked G1/G2 export, strict Grid depth and G1 Grid export. No claim moves earlier evidence onto the final artifact.

A46-01 repaired the dead CRT Grid scanline-depth formula in the display-filter owner and synchronized both Goblet pipeline/inline mirrors. A46-02 repaired missing positive soft-edge keep-alpha application in Goblet1 before first indexed-player render: the genuine live CC source keeps50/64 cells; BEFORE G1 restored14 holes (42 wrong RGB bytes) while G2 matched, and final G1/G2 now match the independently frozen red×mask compositor. Actual-player regressions cover binary/partial masks, erase×keep, absent/empty/short inputs and nearest full/half resize. The focused source boundary is eight files plus these two ledgers.

All eleven display filters have bounded public-control/enable/header and representative optical/backend evidence; declared order, viewport/crop, held normal-stroke bypass, local reload/VS SaveLoad, CC hard/soft mask and public G1/G2 transport/parity paths pass their named contracts. CRT/NTSE optical claims require positively consumed GPU4/GPU5 lineage. Noise/Film and Bloom use declared functional contracts rather than copied shader/Gaussian or arbitrary-seed RGBA oracles; source-qualified native Canvas/codec references retain their I/O boundary. No standalone Reset/reorder control, every-combination matrix, continuous RAF latency/visual-signoff claim, broad partial-alpha photometry or extra export-format coverage is invented. Area47 viewport breadth and Areas52/58 persistence/export breadth retain their separate scopes.

Settled HEAD+only8 source-isolated diff/type/full lint/full Jest passes: 624 suites,6495 tests,2 snapshots (one skipped suite/test). Production Build3 preserves Studio, original47, raw staged three files/seven additions and all15 public assets at their declared five-owned/ten-protected hashes. Final native raw CLI/process/script/result/quiet six-key restoration/cleanup/no-daemon/source continuity checks all pass. Earlier qualified failures and fixture-premise corrections remain preserved. Area47 is next and remains pending; subjective visual signoff is separate.

Evidence: `area46-accepted-coverage-closeout39.json`, `area46-source-freeze-v2-session39.json`, `area46-final-gate-v2-session39.json`, `area46-preview-build-v3-session39.json`, `area46-preview-after-v3-session39.json`, `area46-native-final-v1-session39.json`.


## Session39 — Area47 complete: Viewport controls

Areas01–47 are software-verified: **47/65 (72.3%)**. The final production artifact `0eef3ac314ada510d574902775586da0d411572487c29394e9c1da305402d3e8` passes **four fresh native cases / 237 checks**, with raw CLI/process/prepared/compiled/result continuity, exact six-key quiet restoration, cleanup/no-daemon and source-preservation guards. Earlier failed V1 and diagnostic receipts remain historical; none are promoted into final acceptance or its counts.

Three qualified defects are repaired at their owners. A47-01 moves context-menu prevention from the child canvas to the pointer-capture-owning workspace, covering the actual captured wrapper target while preserving child suppression and outside-page context menus. A47-02 connects the existing persisted Show Rulers flag to two pointer-transparent 20px viewport strips with bounded document-pixel ticks, adaptive integer 1/2/5 major steps, whole-pixel minor ticks, viewport/document clipping and a blank corner. A47-03 removes the live ruler dependency from initial settings hydration and compares the latest store flag during initialization, so an unsaved live OFF edit is not overwritten by stale saved ON settings; initialization and StrictMode idempotence remain tested.

Actual final proof covers off-center wheel anchors, minimum/maximum clamps and already-clamped no-ops, horizontal-wheel no-op, single-click reset no-op and double-click zoom1 with unchanged pan; interrupted Space release during left-down followed by one genuine fresh red64-pixel command; pixel-grid thresholds19/20/40, off, Settings save/reload and same-project CSS wrapper resize; exact ruler tick labels/coordinates at zoom1/2, native Space pan and resized strips, transparent hit-testing and one genuine64-pixel command beneath the horizontal ruler. SavedON→OFF is accepted only with a real trusted native label click, expected DOM AND store state after normal settling while savedON is still observed, then exact Settings OFF persistence and both ruler axes removed. Full source/framebuffer/normal version/masks/unknown metadata/history/preferences remain exact except each declared paint or Settings change. Middle/right outside Space/direction drafts remain source-backed no-ops, not an invented middle-pan feature. Ruler geometry is software-verified; subjective visual signoff remains separate.

The source boundary is eight files plus these two ledgers (ten commit paths), disjoint from the original47 and inherited46 owners. Isolated HEAD+only8 gate: Test Suites: 1 skipped, 625 passed, 625 of 626 total; Tests:       1 skipped, 6526 passed, 6527 total; Snapshots:   2 passed, 2 total. The actual sole production build preserves all15 public assets, Studio and the raw staged three-file/seven-addition patch. No unsaved-document restoration guarantee across reload, arbitrary DPR/navigation matrix, dormant Fit controls, general grid snapping or Area48 proof is claimed. Area48 remains pending.

Evidence: `area47-source-freeze-v2-session39.json`, `area47-final-gate-v2-session39.json`, `area47-preview-build-v2-session39.json`, `area47-preview-after-v2-session39.json`, `area47-native-final-v2-session39.json`. Qualified failed BEFORE receipts remain separate: captured context target `area47-navigation-before-v2-session39.json`, missing ruler renderer `area47-grid-settings-before-v2-session39.json`, and settled hydration rollback `area47-ruler-toggle-diagnostic-v1-session39.json`.


## Session39 — Area48 complete: Grid controls and remembered guide settings

Areas01–48 are complete: **48/65 (73.8%)**. Three final production cases passed 221 checks with no failures: toolbar/panel synchronization and exact SVG geometry; number boundaries, rounding, empty and invalid input; three exact pixel stamps proving guide dimensions/visibility remain independent of brush snapping; and header collapse/reopen plus real guide-settings reload. Seven owned storage keys were restored exactly and the named browser session closed with no daemon remaining.

A48-01: reload discarded guide visibility and dimensions. Under the stated default to remember settings after an unanswered optional preference question, the existing vessel-settings.canvas.guideGrid now stores the normalized triplet. UI actions preserve unknown settings fields and runtime behavior on storage failure. Home hydrates once through the existing action, with stable dependencies and latest-state comparison so later edits survive. This default is a root assumption, not a human response. Header storage, brush snap settings, project archives and unsaved-document restoration retain their separate contracts.

Source scope: five existing files (localSettings, UI slice, HomeClient and their two test files), plus these two audit records. Same regression tests: five failures before, all35 passing after. Final isolated gate: Test Suites: 1 skipped, 625 passed, 625 of 626 total; Tests:       1 skipped, 6535 passed, 6536 total; Snapshots:   2 passed, 2 total. Type checking, lint and diff checks passed. Final artifact: 12bfd66d42d6c7f884aa2b1d1845ffd09a91ea84a5a3c4176acf35e689922571. Evidence: area48-native-before-v3-session39.json; area48-final-gate-v1-session39.json; area48-preview-build-v1-session39.json; area48-native-final-v1-session39.json; area48-commit-receipt-session39.json. The original47 working paths and raw three-file/seven-addition staged patch remain exact. Local focused commit only; Areas49–65 remain pending.

## Session39 — Area49 complete: Keyboard routing and release ownership

Areas01–49 are complete: **49/65 (75.4%)**. Four final production cases passed 215 checks with no failures. Native bracket release over a number input now stops paced brush-size changes; held P and E restore the prior tool when released over an input or inside Settings; fresh subsequent gestures work. The routing case covers C/F/W/B/M/U, deliberate E tap and P hold, text/modal blocking, and native button Enter/Space activation. Prior per-edit history, held-picker and Space-interruption evidence remains scoped to its original cases; history breadth continues in Area51.

A49-01/02/03 share one owner: keyup returned at text/scope guards before releasing owned keys. The minimal handler change clears pressed-key/bracket ownership first and permits already-owned P/E release across those guards. Unowned text input, deliberate short E tap, held E threshold, tool-selection epochs and Space behavior retain their contracts. All ten new tests run on both bases: seven failures before;45 passing on clean commit bytes and47 with the protected edits after. Final isolated gate: Test Suites: 1 skipped, 625 passed, 625 of 626 total; Tests:       1 skipped, 6545 passed, 6546 total; Snapshots:   2 passed, 2 total. Type checking, lint and diff checks passed.

Source scope is two existing hook/test files plus these two audit records. Commit bytes are HEAD+task; working bytes retain the original +6/+15 hunks, proved by applying/reversing the original patches byte-exactly. The other45 original working paths and raw three-file/seven-addition staged patch remain exact. Final artifact: beb134a2db32f33cc07e52687c9ba3b5dfa3149c6955bd8d9050add94cd8e80f. Evidence: area49-native-before-v1-session39.json; area49-final-gate-v1-session39.json; area49-preview-build-v1-session39.json; area49-native-final-v1-session39.json; area49-commit-receipt-session39.json. Seven storage keys were restored and the named browser closed with no matching daemon. Local focused commit only; Areas50–65 remain pending.

## Session39 — Area50 complete: Document creation, drafts and resizing

Areas01–50 are software-verified: **50/65 (76.9%)**. Three native cases passed **151 checks**: Document draft/preset/validation/cancel (64); actual New replacement (22); and resize/no-op/history (65). All three completed with zero failures or errors and passed preservation and restoration checks.

Draft edits, presets, validation, Escape and backdrop cancellation preserve the existing document and history. Public New replaces the occupied scene with independent transparent128×96 normal/CC material, new IDs, Untitled/default palette, clean history and intentional custom-library carryover. Name/background editing and unsaved-confirmation controls are absent; existing literal defaults were verified, no missing UI was invented. Numeric controls were addressed by source-qualified ordinal/adjacent text because their labels are unassociated; proper accessible labeling remains an Area60 follow-up.

Public same-size Apply is an exact no-op. Resize320×192 and two real Undo/Redo cycles pass independent whole canonical/framebuffer/workspace pixel models, explicit normal versions, live versus legacy-project metadata ownership, document bounds/timestamps, history IDs and exact lastDocumentSize preference merges. All unknown source/settings fields and non-targets remain strict. Seven owned keys restore through both quiet fences; cleanup confirms no matching browser daemon.

Source boundary stayed empty: no app-code change, unit/full-suite rerun or new build was needed. These cases use the unchanged production artifact `beb134a2db32f33cc07e52687c9ba3b5dfa3149c6955bd8d9050add94cd8e80f`; the prior Area49 passing625-suite/6545-test gate and build remain provenance, not newly run Area50 checks. Only these two audit ledgers enter the local focused commit. Current Area50 baseline’s47 working paths, mixed keyboard+6/test+15 hunks, and raw staged three-file/seven-addition patch remain exact; no push.

Shape-specific breadth remains Area65, project archive round trips Area52, and broader history coverage Area51. Areas51–65 remain pending. Evidence: `area50-native-before-v1-session39.json` (Draft/New); area50-native-before-v4-session39.json (Resize). Earlier resize fixture-premise failures remain historical and do not count as app defects or accepted checks.

## Session39 — Area51 complete: History composition, limits and bounded recovery

Areas01–51 are complete: **51/65 (78.5%)**. Area51 closed with an empty app-source boundary on the existing production artifact: 4 native cases/456 checks. Accepted evidence is exclusively real IndexedDB spill (before-v3), scoped read-failure/retry recovery (before-v8), public history-limit/ring/redo invalidation (before-v9), and the final accepted mixed normal/Color Cycle/Sequence three-command Undo-all/Redo-all chain (before-v10).

The limit selection uses the actual mounted DOM SELECT input/change→React store/manager contract. Headless native keyboard menu behavior was independently characterized against a bare native SELECT and is not called a trusted keyboard-selection pass or an app defect. All paint contacts and Undo/Redo keystrokes in accepted functional cases are native. Real storage spill/readback and a single phase-scoped HistoryReplayPreparationError prove bounded preparation failure preserves source/stacks and the same native Undo succeeds after the I/O boundary is restored; this does not claim compensation-failure recovery, arbitrary fault safety or history persistence across reload. Per-edit CC material/cache, normal bitmap-version and Sequence chunk contracts reuse the named earlier authoritative proofs. Failed/diagnostic cohorts remain preserved and excluded from these totals.

The four accepted cases passed29 spill,36 read-failure/retry,231 limit/ring/branch, and160 mixed-chain checks. The mixed case positively observes patch, bitmap-tile and Sequence append delta tags and completes two Undo-all/Redo-all cycles with the same real command IDs. Whole independent published pixels, all six CC canonical planes, raw ID/slot references, masks, non-targets and every declared metadata owner remain strict. PATCH history preserves the separate null imageData/transparent framebuffer representation; its store metadata is checked against canonical pre-action inputs and the final store-update owner. Normal bitmap replay keeps the latest capture version, and the initially absent Sequence chunk field follows its established empty-array contract.

The unchanged production artifact is `beb134a2db32f33cc07e52687c9ba3b5dfa3149c6955bd8d9050add94cd8e80f`. Area49's625-suite/6545-test gate and build remain provenance; these are not new Area51 test or build runs.

No source change, new full gate or production rebuild was needed for this source-empty qualification. All47 protected working paths,57 clean inherited owners, two separately modeled mixed keyboard owners, raw staged patch, public/served15 assets, Studio and loaded production artifact remain exact. Only these two audit records enter the focused local commit; no push. Area52 is next and remains pending until its fresh baseline and activation; later capability inventories are inactive preparations.

## Session39 — Area52 complete: Save/load project serialization

**3 native cases/243 checks** accepted against unchanged production artifact `beb134a2…`: errors/cancellation/recovery44, mixed normal/CC/Sequence roundtrip89, captured-brush/mask/extension archive breadth110. Source boundary empty. Areas01–52 complete: **52/65 (80.0%)**. Area53 pending fresh baseline/activation.

- Actual public Save captured `.vs` bytes/name/SHA before public New/Load. Independent ZIP/PNG decoding and all six expanded CC planes match pre-save material; durable project/layer identity, metadata, Sequence stamp/quantization, history reset and clean replacement pass. Source-owned project-load GC retains every definition and unassigns only unused slots; protected palette0 and full resident definitions remain exact. Missing Sequence plugin configuration canonicalizes to null. Imported wire/base64 brush cache differs from runtime/history cache; raw observer diagnostics remain evidence, without a universal cache-format identity claim.
- Public file-picker abort, cancellation, empty/truncated/missing-manifest/missing-required-raster inputs preserve current document/history/preferences, expose appropriate errors, and recover through the same valid bytes. Only the green44-check error suite from partial native3 is accepted; its failed minimal fixture remains recorded and excluded. Native5 accepts mixed89; native8 accepts breadth110. Historical failed fixture premises and navigation mistakes remain preserved, without app-defect claims.
- Actual public Box capture creates/saves the literal16x16 custom asset and retains ID/date/natural size/material through the archive and loaded public brush selection. Actual Ordered radius1/size1 CC mask has50 kept/14 removed pixels; independently decoded saved PNG and loaded normalized raw/canvas bytes/flags/version match. Public visual group, BottomRight/None offsets(+7,-5), and representative Pixelate/Color Grade/LCD filter metadata roundtrip; disabling filters yields the complete independent masked-red scene. Small declared initial extension JSON with Unicode/null/booleans/finite numbers/nesting/repeated values survives an independently decoded primitive DAG. No extension editor, cycles/quotas, arbitrary unknown layer fields or all-feature Cartesian claim.

Compatible prior owner proofs reused explicitly: Area40 alignment195, Area46 enabled-filter `.vs`73 and Area42 group Save/Load36. They are provenance, not additional Area52 checks. Prior Area49 full gate625 suites/6545 tests plus2 snapshots and one existing skip/build is unchanged provenance; no new build or full-suite claim for this source-empty area. All three accepted cases restore exact seven/nine/seven preference keys after real startup persistence and two quiet fences; API/session/observer cleanup, no browser daemon, original47 working paths, original staged bytes,57 inherited clean owners plus two mixed owners,15 public/served assets and Studio fingerprints pass. Local documentation-only commit; no push/deploy/branch change.

## Session39 — Area53 complete: file browser, preview and safe repair export

Areas01–53 are complete: **53/65 (81.5%)**. Area54 remains pending and begins from a fresh source-empty capture after this focused local commit.

Production proof: **4 native cases/168 checks** (file preview36, repair copy38, real directory55, global drop39), zero failures/errors. Actual AFTER4 receipt `area53-native-after-v4-session39.json` is bound to artifact `896c46e414e6eca6b97306e6a2b758db63e208b58f795fa89cde09d49182b3a6`; prepared/compiled/log/result continuity, exact owned preference restoration, quiet fences, named-browser closure and repository preservation all pass.

The file preview case covers the public file input, fit capped at2x, centering, clamped pan, double-click recenter, resize, Cancel and Escape. The directory case uses a real isolated OPFS directory and native handle cloning/persistence, exact numeric sort, eight navigation keys, Refresh/reopen, stale-row Close admission and healthy double-click import; only owned directory records/files are removed. The drop case uses explicitly synthetic DragEvent/DataTransfer/File I/O through the mounted global handler, unsupported-file rejection, overlay/Escape and preview cancellation. Browser synthetic copy-cursor support and trusted OS dragging are excluded.

Two source defects are repaired. Repair export now checks actual archive payload availability even when the declared health manifest succeeds. Serialization copies the snapshot metadata it externalizes, preventing health reporting from rewriting loaded motion buffers into dangling ZIP refs before Save. The same final regression tests fail twice before and pass all7 after in both clean and protected-working projections, including repeated health reports/saves and unchanged source metadata/original archive.

The damaged-paint browser case proves actual repair-only controls, declared reversible confirmation I/O Cancel then Accept, one new repaired-copy write/close without overwriting the source, exact retained speed/flow/phase bytes, complete checksummed emitted ZIP refs and the independent literal red64 static preview. Existing canonical policy explicitly omits paint and orphan gradient bindings when paint is unavailable: hasContentfalse and missing-paint repairStatus remain accurate. This is a static compatibility copy; recovered animation or preservation of all orphan canonical planes is not claimed. The original archive remains unchanged. Native confirmation reach was observed separately; automated Cancel/Accept uses the declared I/O boundary, without an OS-dialog-click claim.

The isolated final gate passes type-check, lint and the full suite: 625 suites/6548 tests/2 snapshots, with one existing skipped suite/test. The working production-preview build and exact runtime interaction pass. Earlier interrupted/failed cohorts and the overbroad five-canonical-ref fixture failure remain immutable evidence and are excluded from acceptance; AFTER4 is the accepted four-case cohort.

The focused change comprises projectIO, projectRepairExport and its existing test plus these two audit records. The original protected projectIO +21 patch is preserved as a separate working projection, alongside the two earlier keyboard mixed owners; all other original working paths and the original staged patch remain intact. Public/served15 and Studio are unchanged. No push, deployment, branch change or new worktree. Areas54–65 remain incomplete.

## Session39 — Area54 complete: autosave, attached backup and reload flows

Areas01–54 are complete: **54/65 (83.1%)**. Area55 remains pending and starts from a fresh source-empty capture after this focused local commit.

Accepted production proof: **3 native cases/200 checks** (immediate/periodic65, attached-backup65, reload/New70), zero failures/errors. `area54-native-after-v1-session39.json` is bound to production artifact `d4cb87af88e083530d2abee0a3d78434b135b32c7f7bf88de525ec4e3e2e7deb`. All prepared/compiled/log/raw tuples, source hashes, exact restoration receipts, named-browser closure and repository post-guards pass. Diagnostic-only and failed BEFORE cohorts remain excluded.

Public Autosave enable produces an immediate atomic archive/session save. All exposed interval choices2/5/10/1 are admitted; a genuine60315.1ms interval produces a newer saved revision with independently decoded literal raster pixels, while disabling prevents archive writes during the bounded subsequent edit. Canonical pixels/framebuffer/version/history remain exact; autosave does not add paint history commands. Seven raw preferences and both IndexedDB stores return to their captured originals.

A public Save establishes a declared in-memory file-handle I/O boundary. Autosave updates the reachable attached-file backup with matching declared material. A subsequent denied permission query leaves the backup bytes/time unchanged, issues no permission request or replacement picker/write, preserves a newer primary IndexedDB save and exposes the specific warning. This is attached-handle behavior under an explicit I/O double; native OS permission dialogs and directory backup modes are not claimed.

Reload starts the source-defined transparent Untitled document/history0 while retaining the earlier archive and raw current-session, including a newer unsaved revision. No mounted recovery prompt/control is present; private recovery functions, real crashes and successful recovery UI are not claimed. Public New resets its current session/history and preserves prior archives. The reloaded file-handle baseline is null; this case does not prove detachment of a non-null saved handle. Durable raw backup, owned-record cleanup, exact two-store/preferences readback,365.3ms quiet with zero later writes/transactions, and deletion of only the UUID-owned backup all pass. Original stores were empty in this bounded case; arbitrary nonempty legacy records/handles/graphs are not claimed as positively exercised.

The qualified source defect was a stale Settings close timer: after a trusted Options click, its heading/tab appeared at441.3ms and vanished at456.1ms while the app still held settings=true and modal keyboard scope, without a close input. SettingsModal now cancels its effect-owned timeout on dependency changes/unmount. The existing10/300ms durations, normal closing transition, public Escape save and store/keyboard owners remain intact. Four actual-component regressions produce2fail/2pass before and4pass after; the fresh browser AFTER uses the unchanged functional actions and now completes storage restoration without added waits or forced clicks. The analogous DocumentModal pattern remains a separate Area60 follow-up.

The isolated full gate passes type-check, lint and626 suites/6552 tests/2 snapshots, with one existing skipped suite/test. The new working production-preview build and exact three browser flows pass. Earlier selector/cleanup failures and the timer diagnostic retain truthful unverified restoration results; later passing evidence does not rewrite those results.

Focused ownership is SettingsModal and its new adjacent regression test plus these two audit records. Original47 working paths, the existing staged patch,59 prior clean owners and three separate mixed owners remain intact; the two newly committed clean owners bring that map to61. The original backup map, public/served15 and Studio remain unchanged. No push, deployment, branch change or new worktree. Areas55–65 remain incomplete.

## Session39 — Area55 complete: PNG composition, transparency and recovery

Areas01–55 are complete: **55/65 (84.6%)**. Area56 remains pending and starts from a fresh source-empty capture after this focused local commit.

Two source-owned defects are repaired. PNG encoded a newly allocated canvas before the asynchronous compositor transferred its pixels; the mounted frame provider now uses the existing synchronous compositor and reports a failed composition explicitly. Composition also baked in the project background regardless of PNG's Include background setting. A default-true option at the existing drawing/compositor boundary lets PNG compose transparent layers first and add its selected background once in the export service. GIF/video retain their existing background choice; their native acceptance remains Areas56/57.

The actual BEFORE cohort retained three primary blank-image failures: normal PNG was fully transparent, normal+CC PNG was fully transparent, and the untouched retry after a controlled encoder failure contained only the background. The nine failed checks include first-failure/incomplete-case records; 70 checks passed and all restoration checks passed. The background defect was masked by the empty output and independently demonstrated by the owning deterministic regression. The encoder-error presentation/Close flow already worked and is not described as a new repair.

Production artifact `1704d94740e485bb0a3c9a389bf21f322226715bb904dc98f4193f6e325f364a` passes **3 native cases/115 checks**, with seven real PNG downloads and zero incorrect decoded RGBA bytes:

- Normal64×48 source: declared1×/3× transparent and2×/4× background-on exports, nearest-neighbour dimensions, opaque and alpha128 pixels, filename/signature/native MIME and quality-control endpoints. Source/version/project/preference bytes and history counts/top IDs/state remain exact.
- Mixed normal256×256 plate plus genuinely painted, paused CC red64 source: unmasked and public Sierra Lite edge-mask exports. The generated binary mask is positively admitted as renderer INPUT before export (50 kept, zero outside), then the whole PNG is independently composed from that input. All six canonical CC planes/material references and normal data remain exact; mask creation owns one separate history command. This does not independently certify the Sierra algorithm.
- One explicitly synthetic callback(null) at the eligible native PNG encoder I/O boundary: trusted Export click, exact detached target/type/quality, original descriptor restored before delivering the null callback. Public failed state/notification, zero failed-attempt downloads, Close/reopen and one untouched native retry pass. Encoder and URL descriptors restore exactly.

All three cases use the unchanged frozen A/B2/C2 fixtures, with seven owned preferences restored through the actual consumed/applied reload packet, more than350ms final quiet, zero later writes and the original packet restored. Named browser cleanup confirms closure and no matching daemon; post-run source/index/public/Studio and compiled/raw-log continuity checks pass. BEFORE evidence is retained and is not acceptance. Earlier unexecuted C locator preparations remain superseded; no failed restore is promoted.

The exact same final regression files fail5/pass29 before and pass34 afterward. The isolated task-only full gate passes type-check, lint, diff review, **626 suites/6559 tests/two snapshots**, with one existing skipped suite/test. One production-preview build succeeds. Actual receipts: `area55-native-before-v1-session39.json`, `area55-native-after-v1-session39.json`, `area55-source-freeze-v1-session39.json`, `area55-final-gate-v1-session39.json`, `area55-preview-build-v1-session39.json` and `area55-preview-after-v1-session39.json` under `output/playwright/`; frozen private author manifest `bf1dcb1b…` and independent source/proof reviews bind the seven task paths.

Scope is five existing implementation files and two existing regression files, plus these two audit records. Original47 working paths, the exact three-file staged patch,61 inherited clean owners, three separately modeled mixed owners, public/served15 and Studio remain preserved; after this commit the seven clean task owners join the inherited map. No push, deployment, branch/worktree change or new chat. No CanvasShape/filter/sequence PNG matrix, animation/video acceptance, performance, physical-device or OS-dialog success is claimed. CanvasShape export and video callback-failure cleanup remain explicit later-area leads.

## Session39 — Area56 complete: GIF transparency and cancellation

Areas01–56 are complete: **56/65 (86.2%)**. Area57 remains pending and starts from a fresh source-empty capture after this focused local commit.

Two defects are repaired in the GIF service. The encoder received a transparency index without its required boolean flag, making transparent pixels opaque. GIF frames now explicitly enable transparency when that index exists. Abort checks previously broke loops but still finalized and downloaded an incomplete file; they now reject with AbortError at analysis, encoding and pre-finalization checkpoints. The existing finally releases the animation session once. Existing modal error/Close handling is retained; no new cancellation UI policy is claimed.

The actual initial BEFORE cohort retained138 passing/11 failed checks with exact restoration. Transparent2-frame and retry8-frame files had2973 incorrect alpha bytes per frame; genuine positive-progress Cancel downloaded the one-byte GIF trailer59 and reported completion. The genuine two-frame Sequence file itself was correct: its only preservation mismatch was three intentionally changing renderer cache counters. A narrowly corrected fixture retains all raw telemetry, admits finite nonnegative integers and excludes only those three counters from semantic equality; unknown metrics and every other runtime field remain strict. It passed a fresh unchanged-build BEFORE control,1case/57checks. The original overbroad fixture remains excluded and no runtime counter workaround was added.

Production artifact `ad6e4541e84f3fc5e855f6f9fb89886b038be5045dce289bbfb70717fefd5588` passes **3 native cases/150 checks** (57+42+51), with three real GIF downloads and all12 decoded frames matching independently declared whole RGBA tensors:

- Genuine public Sequence authoring: two distinct Square8 red stamps over white256×256, native Play/Pause frame visit, Record and separate history commands. GIF1×/2FPS/1s/Once produces2frames with500ms delays; paused live cursor, source events/chunks/material/version/project/preferences and history counts/top IDs/state remain correct after export.
- Transparent64×48 normal red/blue source: GIF1×/2FPS/1s/Once/None/Auto produces2 exact transparent frames, explicit GCE flag and disposal2. Palette/dither selections and strength endpoints are control-setting coverage; no quantizer or general dither appearance claim.
- One genuine public Cancel during positive analysis progress produces zero downloads/Blob URLs, releases the session and reaches the existing failed/Close flow. Public Close/reopen and untouched same-settings retry produce8 exact transparent frames/4s with500ms delays and no loop extension. No private abort, fake clock or synthetic codec failure is used.

Independent hand-declared GIF/LZW growth/local-palette/transparency controls and native ImageDecoder agreement precede application outputs. All nine owned preferences restore through actual consumed/applied reload packets, final quiet intervals above350ms, zero later writes and original packet restoration; URL descriptors and listeners restore. Named browser cleanup, no matching daemon, source/index/public/Studio preservation and prepared/compiled/raw continuity pass. Runtime/source comparisons preserve all semantic fields; only the three positively admitted draw-cache counters are projected.

Same final11 service tests fail5/pass6 before and pass11 afterward, including the actual encoder flag/opaque control and pre-abort/analysis/encoding/final-await cleanup. Type-check, lint, diff review and isolated full gate pass **626 suites/6565 tests/two snapshots**, with one existing skipped suite/test. One production-preview build succeeds. Actual receipts under `output/playwright/`: `area56-native-before-v1-session39.json`, `area56-native-before-v2-session39.json`, `area56-native-after-v1-session39.json`, source-freeze/final-gate/preview-build/preview-after v1; private author manifest `8e9ed5fb…` and independent source/proof reviews bind the two task paths.

Scope is existing `src/utils/export/exportService.ts` and its existing service test, plus these two audit records: four committed paths. Original47 working paths/raw three-file staged patch,68 inherited clean owners, three mixed owners, backupMap53, public/served15 and Studio remain exact; the two clean task owners join the inherited map after this commit. No push, deployment, branch/worktree change or new chat. Native GIF checks are at1× with known lossless palettes; no arbitrary quantization/dither, CC/Recolor animation, video, Goblet, CanvasShape, physical-device or OS-dialog acceptance is inferred. Video callback/cancel ownership remains Area57.

## Session39 — Area57 complete: Video cancellation and capture-error cleanup

Areas01–57 are complete: **57/65 (87.7%)**. Area58 is pending and is the next audit area. The final production run completed **5 native cases/274 checks**, with no failed checks or page errors, on artifact `9512e7d6da012d7007865bca100d3f84806420bb775d9a101bcb373abbce4903`.

Two reproduced defects are repaired in the owning video export service. Cancel previously accepted a 482-byte partial WebM download. A scheduled frame-composition error escaped its export promise, leaving Exporting active with a recording recorder and live video track. The service now rejects cancellation before producing a result, rejects scheduled frame errors through the existing failed state, and owns timer, recorder, animation-session and capture-track cleanup from acquisition onward. Cleanup preserves an earlier export error. GIF behavior and all bytes outside the video function remain unchanged.

The public WebM and native MP4 exports decode the independently declared two-frame source at the specified temporal samples and fixed interior RGB/alpha predicates. Constructor-phase and final native MIME receipts are compared at their matching lifecycle phases. The fallback case explicitly forces only the two MP4 capability probes false, then records and decodes genuine WebM and shows its warning; it does not establish that this browser lacks MP4. Positive-progress Cancel produces no Blob URL or download, and the actual recorder and tracks end. A one-shot native canvas-context failure on the detached export target reaches Export failed without output or an uncaught page error; its resources and original source cursor are restored, and an untouched public retry decodes correctly. All three notifications are dismissed with their genuine button before Close. The five cases pass 52/52/54/56/60 checks.

All source pixels, versions, Sequence events, history IDs/counts, project/preferences and paused cursor remain exact across the named operations. Exactly three known renderer cache counters retain raw finite-integer receipts and are the sole runtime comparison projection. Each case restores all nine owned preference bytes, its session packet and descriptors, with zero late writes after 364.4–365.8ms quiet fences. Named browser cleanup confirms no matching daemon; original47 working paths, the raw three-file staged patch, backupMap53, other inherited owners, three mixed owners, public/served15 and Studio remain preserved.

The same final 13 video tests fail eight checks against the original service and pass all 13 after the fix; 11 existing GIF/service controls also pass. The settled isolated commit gate passes type-check, lint, 626 suites/6575 tests/two snapshots, with one existing skipped suite/test. One production build passed. Earlier failed decoder/MIME calibration, post-unmount format reads and notification selector runs remain retained as excluded harness evidence; no failed cohort is counted as acceptance. The final proof is `area57-native-after-v3-session39.json` (SHA256 `8a199502568431f9c8ed53e03b2f83a586c4f5731e9f43da871486cfd109b9e0`).

Scope is two existing source/test paths plus these two audit records, committed locally on main. The export-service overlap is updated in the inherited map and the video test adds one unique owner, yielding 71 clean inherited owners plus three separately modeled mixed owners. No push, deployment, branch/worktree change or new chat. These are bounded 1×, manual 4FPS, two-second native codec/interior-pixel checks (ten seconds for positive-progress cancellation); arbitrary shaders, encoded frame-count/bitrate quality, alpha-video, other browsers/hardware, Goblet and CanvasShape are not inferred. Area58 remains pending.

## Session39 — Area58 complete: Goblet packaging, runtime and lifecycle

Areas01–58 are complete: **58/65 (89.2%)**. The accepted production proof is **6 native cases/549 checks** on artifact `d8389d8e318084425d6a8ac1eecf5de957fbdfe399a82e2e1e6c18fcce04b180`. Five explicitly selected green AFTER2 suites contribute475 checks; the fresh blocked/recovery AFTER3 suite contributes74. The complete AFTER2 receipt remains failed (5 complete/545 passing/2 failing checks); its blockedV5 row remains excluded. No failed cohort has been relabeled green.

Two reproduced defects are repaired at their owners. Both Goblet decoders now restore every one of the162 canonical export aliases:18 missing Goblet1 mappings and9 missing Goblet2 mappings were added, preserving all existing entries and legacy `plc`. Their generated inline counterparts are explicit owned releases, produced and checked by the repository generator; the preview Next build does not regenerate them. The export-live document resolver now refuses `static-preview-only` placeholders alongside unresolved cold documents. It preserves genuinely empty resident documents and independently eligible archive data. A quarantined layer with only a retained preview now reports a caught missing-paint-source failure rather than producing blank canonical output; no new static-fallback behavior is introduced.

The six accepted native cases prove:

- Four public packaging/download formats, independent ZIP directory/CRC/ref checks and normal texture controls; three unmodified packaged players show the expected first frame.
- Goblet1 and Goblet2 participation for occupied Color Cycle paint, a positive binary keep mask and genuine Sequence frames, with full raw source/material checks, exact exported raster/frame-map semantics and independently computed first presentations.
- Advanced settings and two distinct SingleHTML artifacts: minification expands to the exact canonical metadata, hidden inclusion preserves source visibility, title/shell/fallback/diagnostics work, manual FPS/duration/PerfectLoop controls retain their declared behavior, Fixed200 matches the full independent2x tensor, and Embed-fit has the bounded metadata/DOM proof. Preview Hide/Show preserves the actual artifact, and displayed release bytes match downloaded bytes.
- Positive-progress native Cancel produces no artifact, followed by an unchanged successful retry with the complete16-frame red/blank map and first presentation.
- One exact same-origin runtime GET503 is caught, its owned notification is dismissed, and unchanged retry fetches the original runtime bytes and produces the independently validated ZIP/player.
- The exact repaired archive remains typed preview-only: blocked Back and Repair/Load-Cancel preserve source/history; Continue reports the caught CC-data failure without a blank artifact. Four real selection/hide actions follow the source-owned dirty-state and Sequence-control projections, then a healthy normal-only301587-byte HTML export has its complete256-square texture equal to the PRE native-codec control. Every other source/history/pref field stays exact; only the final export comparison projects the three recorded, finite renderer-cache counters.

All accepted actual prepared/compiled/log/result triples bind to the same source7 freeze and production artifact. Five suites prove their eight/ten-key CDP applied/consumed/restored packets; the blocked case proves same-page raw restoration of both IndexedDB stores and all eight keys with unused packet unchanged,361.2ms quiet and no post-restore writes or transactions. Both actual browser runs close with no matching daemon; source, descriptors, raw preferences, protected work and artifact continuity pass. AFTER2 receipt `d5098ca1c6067dbba4c1b0fec83d7de21eb76ff021f668025f3399fe6ee91201` and target receipt `953fdb5cb480f7054b0bc4c77c289f28bdeab4987e0ccd745a1d0ab58adb17f6` retain the explicit five-plus-one selection.

Same-final regression tests fail before and pass after both repairs. The settled isolated gate passes type-check, lint and all626 suites/6584 tests/two snapshots, plus the existing single skip. One production preview build passes; all four owned public runtime/inline files and the other11 public/served assets match their admitted hashes. Freeze `8cb1c2605dd66875ac4c395e7265e68088c65f051bc4fdc999d2afc88ecfd5aa`, gate `c70606c440b893b2c0db334665252aeb61cdfc9962c4b840b2eacde65ca691e8`, build `4712aefba499d936432ce9598de587aef91c35fadab5dfe5829175fd90c6afe1` and actual preview-after-v2 `5a949c3a11e4afb596d8711dac7046215cb57092e11655c26337482cda6b1339` are preserved.

This is bounded four-format packaging, positive-mask/static-Sequence initial presentation, mounted settings and lifecycle proof. It does not claim every format/runtime/setting combination, distinct-frame temporal or dynamic CC-phase fidelity, every Sequence brush, or a fresh group/fit matrix. Area40 fit, Area42 group and Area46 filter/zero-mask deterministic contracts retain their named original-artifact authority; all-zero-mask native export compatibility was not exercised here. The actual missing Design scale accessible name is explicitly deferred to Area60, with functional native Tab/value evidence retained. No external Publish/Test service, private Studio, OS-picker or physical-device capability is inferred.

The focused local commit owns seven source/test/generated paths and these two audit records. Four inherited public owners are replaced and three unique owners added, yielding74 unique clean inherited owners plus three separately modeled mixed owners. Original47 working bytes, backupMap53, raw staged three-file/seven-addition patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2`, other public assets and Studio remain exact. No push, deployment, branch/worktree change or new chat. Area59 Options is pending and next; Areas59–65 remain incomplete.

## Session39 — Area59 complete: Options display, performance and implementation controls

Areas01–59 are complete: **59/65 (90.8%)**. Area59 accepted **4 native cases/196 checks** on production artifact `89a83f7627503374416db2c9b660932b58c5e01fffe704a8144be601adb0321c`. Area60 remains pending until its separate fresh activation; Areas60–65 remain incomplete.

The qualified defect was Reset to Defaults restoring the UI and stored flags while an existing Color Cycle brush retained its previous Canvas2D configuration. The original production BEFORE packet completed four cases with192 passing checks and one failed backend requirement; it remains failed and is not counted as accepted AFTER evidence. The source owner `src/config/featureFlags.ts` now delegates each default key to the existing setter. This preserves changed-only notifications, default order, and stored string values while delivering both existing DOM events to existing consumers. The only other app-source path is the new `src/config/__tests__/featureFlags.test.ts`, whose preimage was absent (not empty). The same-final causal unit tests changed from four failures/two passes to six passes, covering the actual existing manager consumer, ordered events, hooks, idempotence, storage failure and SSR.

Accepted bounded production cases:

- Display (36 checks): public rulers, pixel-grid preference, live numeric FPS indicator, transparency checker/gray and frame-color presentation with independent source/scene samples; Escape saves unknown-preserving settings, reopen/reload hydrates preferences. Frame color uses declared DOM color-input I/O, without an OS picker claim. Reload does not claim to restore an unsaved document.
- Performance (28 checks): public history limits10/25/50/100 and manager/store agreement without history/source mutation; asynchronous save-size analysis returns a finite report, without a compression-ratio or speed target; reopen/reload preferences.
- Implementation (94 checks): eight visible flags, hidden logging preservation, exact ordinary setter events, two shortcuts, Reset and reload persistence. The independent PRE default-order oracle expects exactly four events for the two changed flags, Canvas2D and Worker, and no hidden logger storage change.
- Existing Color Cycle Reset (38 checks): one genuinely authored opaque-red64 source, the same brush identity, default positive GPU presentation, native toggle to positive CPU ImageData presentation, then native Reset back to positive GPU presentation. Completed draw lineage reaches the published CC surface and the latest main canvas; all three scene comparisons have zero wrong bytes. Six canonical planes, used definitions/slots/material/masks, normal-layer version, history counts/top IDs/state, project and other preferences remain exact. This is bounded execution evidence, not a worker-internal, animation-speed or performance claim.

The sole accepted AFTER packet is `output/playwright/area59-native-after-v1-session39.json` (SHA256 `2db181f07309b5bd23927fa653cbb3682c1d245b03fbd29529955b2fb7e494e7`), with raw CLI logs/JSON/compiled scripts and immutable four-case plan. All196 checks passed, four cases completed, errors were empty and the named browser session closed with no daemon. Original raw preference keys were restored exactly through actual consumed CDP packets:7/7/16/16 keys, each followed by more than350ms quiet and no post-restore writes. Original session packets and native descriptors/listeners were restored; root postguards passed.

One clean-HEAD-plus-source2 full gate passed diff check, type-check, lint,627 test suites/6590 tests and two snapshots, with the existing one skipped suite/test. One production preview build passed and preserved Studio and all15 working/served public assets unchanged. Proofs are `area59-source-freeze-v1-session39.json`, `area59-final-gate-v1-session39.json`, `area59-preview-build-v1-session39.json` and `area59-preview-after-v1-session39.json`, all under `output/playwright/`. Earlier areas retain their own named scope and artifact authority; no universal flag/backend or UI accessibility matrix is claimed.

Root reviewed the source owner, exact source2 candidate, actual four-case evidence and closeout path; independent GPT-6.1 Sol peers reviewed the candidate, runner, production evidence and commit/capture helpers. The focused local commit includes source2 plus these two audit records only. Original47 working paths, three mixed owners and the original raw staged patch `df0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2` remain exact; the clean inherited-owner union becomes76. BackupMap53, public/served15 and Studio remain exact. No push or deployment. Deferred Document/Settings/Design scale label and modal-lifecycle leads belong to Area60 and require fresh production qualification.

## Session39 — Area60 complete: Library/UI labels and Document modal lifecycle

Areas01–60 are complete: **60/65 (92.3%)**. Area60 accepted **4 native cases/95 checks**, plus a separate positive early-open qualification with one case/13 checks, on production artifact `27c921c453466224d29e849dd4e39701d0837ace43149fdda0fcb5c11824af0f`. Area61 remains pending until its fresh activation; Areas61–65 remain incomplete.

Two source-owned defects were repaired. The four New Document/Resize dimension fields, Save Interval, Undo History Size and Goblet Design scale lacked usable native label associations; genuine visible-label clicks did not focus their controls. Component-owned IDs/htmlFor now associate the unchanged visible labels with native inputs/selects, with contextual accessible names for dimensions and Design scale (%). Value domains, styles and callbacks remain unchanged. DocumentModal also retained old show10ms/close300ms callbacks across dependency changes; a genuine startup open could disappear while its open flag and modal keyboard scope stayed active. Its effect now cancels its own pending timeout on dependency change/unmount, preserving positions, durations, ordinary closing and Escape behavior. Existing Settings timer cleanup is unchanged.

The exact source boundary is six existing files: DocumentModal.tsx and DocumentModal.test.tsx, SettingsModal.tsx and SettingsModal.test.tsx, ExportSetupView.tsx and ExportModal.test.tsx. No shared Input/store/canvas workflow, export algorithm, setting or helper copy was added. The same final focused tests produced12 failures/37 passes against old runtime and49 passes across three suites against the candidate; all seven label/callback tests and six transition/ownership tests are retained. Scoped type-check and lint passed. The frozen author contract’s stale labels-only “or timer edits” phrase is explicitly corrected by its immutable scope addendum; the actual source diff includes the approved Document timeout cleanup.

Accepted production scope:

- Document visibility (13 checks): one hit-proven trusted native public open, positive modal/keyboard ownership and visible heading throughout natural700ms, no close input, exact full copied source/history representation, then Escape and storage cleanup. The main four-case run opened late (370ms after first toolbar), so it is not used as pending-timer challenge evidence.
- Document/Settings labels (45 checks): all six desired names are unique, each genuine visible-label click begins from different focus and focuses its actual control; Width/Height visible text remains unchanged. A New width draft is escaped without apply, source and history summary remain exact, and Save Interval is genuinely mounted through public Enable/Disable with both IndexedDB stores preserved. This does not claim an OS select-menu matrix or focus-trap certification.
- Library and panels (21 checks): genuine Brushes/Effects/All keyboard activation and intended tool states, Pixel Enter, Grid header Enter/Space and persisted collapse state; positively admitted nested native wheel44→344→44; exact literal256² normal source/framebuffer, history summary, camera and unknown raw preferences except the declared Grid header key. Setup warms Pixel’s existing per-preset cache with a second public activation before baseline. No app fix or relaxed unknown-field oracle is based on the earlier zero-scroll/first-cache assumptions.
- Design scale (16 checks): genuine public Export→Goblet→Fixed100, native Tab to the named Design scale (%) input, then a real visible-label click focuses it. Full source/project/history summary and the independently projected v2 settings payload remain exact apart from declared Fixed100 settings; no export/download action or new player-format claim occurs.

The separate early-open qualification uses the same source/visibility oracles and positively admitted native control, with measured startup delivery overhead removed from the harness. It opens at198.1ms after first toolbar, finishes source capture at210.4ms and delivers the trusted click/open modal scope at218.3ms, within the unchanged conservative250ms diagnostic and the source300ms close window. Document stays visibly mounted beyond700ms with exactly equal copied source/history and no closing input. All13 checks pass; the runner independently requires positiveEarlyAdmission=true. This closes the main run’s timing limitation. Earlier supplementary runs that arrived late remain unaccepted for early-timer qualification; no cutoff or source anchor was widened and no app timer/handler/store was substituted.

Core acceptance is `output/playwright/area60-native-after-v1-session39.json` (SHA256 `1132c157a8099e3f025200fa561bdc9f259e458cef7418a6e5f492a783c6f2a5`), with plan, manifest and exact prepared/compiled/raw CLI/JSON triples. The separate qualification is `output/playwright/area60-native-after-v4-session39.json` (SHA256 `23034df91872ddf62f7c4a9a1795bbf864952e8a903c2d0d953b00a843717746`). Core4/95 and supplemental1/13 remain separately counted. Both packets have empty errors and passed named-session close/no-daemon, compiled continuity and root preservation guards.

Original raw preferences restore exactly: core modes are CDP7/raw-DB7/CDP7/CDP8, with363/367.6/367.5/356ms final quiet and no writes; the supplement restores seven CDP keys with365.6ms quiet/no writes. Actual consumed CDP packets and original packet/native descriptor/listener restoration pass. The labels case restores both original typed/unknown IndexedDB stores through owned-project/current-session cleanup, retains the unused session packet truthfully and has zero post-cleanup transactions, with autosave runtime disabled. No unsaved user-document restoration is inferred from a preference reload.

One clean-HEAD-plus-six full gate passed diff check, type-check, lint,627 suites/6603 tests and two snapshots, with the existing one skipped suite/test. One production preview build passed; all15 working/served public assets and Studio were preserved. The freeze/gate/build/after proof files are the Area60 v1 receipts under output/playwright. Failed BEFORE cohorts, the initial automation-daemon OOM and unverified storage attempt, late qualification probes and pre-execution rejected fixtures remain immutable and are not relabeled green. Earlier audit areas retain their original scope/artifact authority.

Root and independent GPT-6.1 Sol peers reviewed source, causal tests, native evidence and closeout. The focused local commit contains source6 plus these two audit records only. Original47 working bytes, three mixed owners, original raw staged patchdf0184e4cfed84743065aaed4fda0b454781904568af19b8de746bdcb57dc4b2 and backupMap53 remain exact. Three inherited source overlaps are updated; the clean-owner union is79. Public/served15 and both Studio directories remain exact. No push or deployment. Area61’s public Reference Studio companion and blocked-popup path require their own fresh source-empty admission and production evidence.

## Session39 — Area61 complete: Reference Studio public companion and reference controls

Areas01–61 are complete: **61/65 (93.8%)**. Area61 closes with no app-source changes. The actual production cohort passed **3 native cases/187 checks** (89 controls/sampling, 79 transforms/Liquify, 19 blocked-popup), with no unexpected errors. Area62 remains pending.

The two genuine public-button companions loaded the same-origin `/vessel/reference-studio/` route and actual page chunk `b83a2a411cd8c60a16903c80b4c0b19502910f8a58434633bf76fed2118e346b`, paired with main artifact `27c921c453466224d29e849dd4e39701d0837ace43149fdda0fcb5c11824af0f` from the completed Area60 production build. Their native channel-ready publications and subsequent exact expected snapshots were fenced per action. Publications are state observations, not transactional acknowledgements. Only the owned companion was opened and closed; no foreground or screenshot tools were used.

Independent PNG inputs and literal geometry proved import, layer/asset sampling-source selection and Canvas fallback, red/blue colour sampling, Show, Lock, ordering, removal, shared 4×5 guide-grid controls, and controls Hide/Open. Lock testing positively admitted the exposed locked asset and its trusted pointerdown. Move, aspect-preserving resize, Fit, flip permutations, and opacity preview/commit passed. Liquify preserved no-motion input, positively changed the declared support region, and preserved independent guard stripes; this is bounded functional coverage, not an independent whole-algorithm pixel oracle. File delivery used the declared external File-input boundary, without an OS chooser claim.

The blocked-popup case temporarily returned null only for the exact trusted public-button window.open call, restored the native descriptor before returning, showed the actual blocked feedback, and opened no companion. Primary canonical/framebuffer material, metadata, selection and history counts/top IDs/state remained exact across declared reference projections. Reference actions preserved their source-owned timestamps and dirty-state policy; they do not create paint-history entries.

Both IndexedDB stores retained their exact original typed values after owned cleanup. All seven original raw preferences, the channel session key, unused fixture packets, and native observer descriptors were restored. Quiet intervals were 360.6/361.7/359.6ms with no later writes or transactions. Both owned companions and the named automation daemon were closed. Original47 working paths, the original staged patch, 79 inherited clean owners, three mixed owners, public/served15 assets, backupMap53 and Studio outputs remained exact.

Earlier failed cohorts remain excluded. Fixture corrections traced double reference dirty marks, nested palette-subscription suppression, overlapping-image hit testing, and prebaseline brush-cache materialization. The earlier missing preference baseline prevents an exact retrospective cache-delta claim; the accepted cohort retained full seven-key PRE/final witnesses and passed the unchanged strict oracle. No app defect was established in this area. No new build or full-suite run was needed for fixture/docs-only work; the settled Area60 gate remains 627 passing suites/6,603 tests/two snapshots, with one existing skipped test.

Wheel/pan, window reopening, invalid-image faults, private Studio capabilities, unsaved-document restoration, and new archive-roundtrip claims are outside this bounded closeout. The next focused local commit contains only the two audit records; no push or deployment is included.

Accepted receipt: `output/playwright/area61-native-before-v7-session39.json` (`a2c93acfde1d6382ce6f9c70cb74a5e8ac1467b37a9ff1c393e682e0e83284a9`). Plan: `376e927fd6a4c4ee6cb194c5832b4e1d988500117e8461688ea1c589dd129e4d`; manifest: `e7b71cd3e8086aa7e3a7337ac6c8e3a51d23ab2e1166a5fc3509a98f4aa6ed2a`. Parent HEAD: `b3f186cc19bd9e08781787bc16f63b6e2b41c5d1`.

## Session39 — Area62 complete: Multiplayer client finalization and lifecycle

Areas01–62 are complete: **62/65 (95.4%)**. The final production cohort passed **2 native cases/100 checks**: fresh unavailable-bridge18 and whole scripted-protocol82. Both ran against artifact `a98a04a8651356e016f0b33eeee927501fb9ca6b04ff883b9b45163a8cce7195`, with no unexpected errors and exact restoration. Area63 is next; Areas63–65 remain pending.

Actual native qualification exposed a committed human end event at revision14 while its same-gesture end frame reported15. The full normal drawing finalizer was tracked only locally, so the shared pending-history barrier could report idle before history registration. The four-file repair registers the complete existing finalizer synchronously with that barrier and makes registry cleanup handle both outcomes without producing an unhandled rejecting derivative. Existing passive tool flush and caller rejection semantics remain intact. The same six deterministic tests changed from four failures/two passes to six passes. The isolated clean-source gate passed diff/type/lint,629 suites and6609 tests (one suite/test skipped), plus two snapshots; one production preview build passed.

The actual public unavailable Start path preserves source, project, history, preferences and both database stores and returns its expected feedback. The separate owned loopback I/O double exercises actual protocol6 claim, Observe, stale-fence/parser rejection, public Start, separate AI and human ownership, native human input, public Stop and late-command rejection. Nine actual executor results and five finite test gates passed. Independent full64×64 pixel tensors prove disjoint Square8 red64 AI/human marks on the declared human plate, unchanged other source fields, exact layer-add/brush history prefixes and the live composite. The final committed human end and its same-gesture frame both report revision16; metadata and three actual native observation-frame files are retained. Scripted client integration does not establish real model efficacy, Color Cycle collaboration, multiple human clients or in-flight Stop behavior.

The final cases restore all seven owned raw preference values and both typed IndexedDB stores exactly, preserve unused session packets and native descriptors, and pass350ms quiet fences with zero post-restoration writes or transactions. The protocol case returns to a fresh no-config realm, verifies server pendingLongpollCount0, deletes only its proven owned UUID backup after exact restoration, and closes the owned service with exit0. Each named primary headless context closes with no matching daemon. Historical browser completion events remain distinct from semantic HTTP200 acknowledgements.

Earlier failed cohorts and the excluded ACK diagnostic remain excluded. In particular, the failed V3 test-context restoration remains false and unrecovered; closing its isolated disposable browser did not repair it. The earlier preparation-plan namespace collision and its exact reconstructed-copy provenance remain recorded in ignored evidence. Neither those failures nor the later success imply that an everyday browser profile participated. The V4 combined preservation failure was not reproduced by the retained V5 four-operand comparison and remains unclassified.

Root preserved the original47 working paths and raw staged patch, all83 inherited clean source owners after this commit, three mixed owners, all15 working/served public assets and Studio. The focused local commit contains four source/test files and these two audit records. No push, deployment, branch or worktree change.

## Session39 — Area63 complete: Public BASE extension capability boundary

Areas01–63 are complete: **63/65 (96.9%)**. The current public production build passed **1 native case/15 checks**, with no errors and exact source and storage preservation. Area64 is next; Areas64–65 remain pending. No application-source change was required.

The source active entry selects the no-op Studio extension, and the completed public static-build configuration rejects inclusion of private Studio extensions. The actual bound main artifact contains one empty-preset supporting literal. Native enabled Library controls and a trusted public All filter contact are positive premises; the retained public inventory has no Unresolve or Replay controls. This classifies the public BASE build. It does not establish private Studio runtime behavior or depend on an internal module export or a fabricated runtime object.

The case preserves complete source, project and autosave state; history counts, top IDs and state; seven raw preference values; and both typed IndexedDB stores. The original stores and unused session packet remain exact; native descriptors are restored, autosave remains disabled until the isolated test context closes, and the363.4ms final quiet fence records no writes or transactions. The named browser closes with no matching daemon. The inherited first diagnostic title mentions Area62, while its actual Area63 artifact and baseline bindings are correct; this cosmetic label adds no feature claim.

The unchanged artifact is `a98a04a8651356e016f0b33eeee927501fb9ca6b04ff883b9b45163a8cce7195`, from the completed Area62 production build. Its settled full gate remains629 passing suites/6609 passing tests, one suite/test skipped and two passing snapshots, with type-check and lint passed. No fixture/docs-only rebuild or repeated full suite was needed. Original47/raw staged patch,83 clean source owners, three mixed owners, public15 and Studio remain unchanged. Only the two audit records enter the focused local commit; no push, deployment, branch or worktree change.

## Session39 — Area64 complete: Public Triangle, legacy reachability and auxiliary UI

Areas01–64 are complete: **64/65 (98.5%)**. The accepted production cohort passed **2 native cases/55 checks**: auxiliary UI19 and public Triangle36. Both use the unchanged main artifact `a98a04a8651356e016f0b33eeee927501fb9ca6b04ff883b9b45163a8cce7195`. Area65 is next and remains pending. No application-source fix was needed.

Triangle is hidden in Library but publicly reachable through the Color Cycle controls. Native Stroke→Triangle→Square→Gradient selection works; returning through Library Stroke admits Triangle painting. Legacy Shape Gradient is defined but absent from the default preset catalog, with no alternative native selector established. That is a capability classification, not a compatibility pass or a claim that every programmatic route is unreachable. Earlier archive/player proofs do not establish legacy-preset semantics.

The Triangle case establishes explicit public Play→Pause intent, then a native size8 stroke. Positive paused global and brush state, the actual shared finalization barrier and adjacent stable live/phase samples qualify the checkpoints. Forty-one occupied canonical pixels stay inside a fixed conservative32-pixel support envelope. Native Undo restores all six full empty planes and live CC-canvas RGBA; Redo restores all six painted planes and the exact painted live hash using the same history command ID. Non-target source, project fields and seven raw preferences remain exact. History diagnostics and IDs are checked, without claiming opaque history-payload or all target-cache metadata identity. This is a control/commit/replay test, not an independent exact Triangle raster or gradient-color oracle; an elapsed animation-clock getter was unavailable.

The auxiliary route opens directly in a separate isolated primary context. All four themes—System1, System7, Windows3.1 and Windows95—pass bounded independent board/background/cell/material checks. Each real728×880 PNG download decodes to the complete PRE canvas RGBA exactly. This proves export fidelity and those layout/material premises, not an independent whole-glyph renderer or artistic antialiasing signoff.

Earlier Triangle failures remain excluded. Initial startup pause is intentionally eligible for first-stroke autoplay, so comparing its changing live image with Redo did not qualify a replay defect. The final case uses explicit toolbar pause and retains the original strict replay oracle. The palette difference was addition of an explicit hard default, not loss of seam metadata; no speculative palette or clock patch was made.

The auxiliary case preserves raw preferences and typed database presence or absence without writes or store creation. The Triangle case restores the original seven raw values and both typed stores through the owned same-page lifecycle. Quiet fences1088.3ms and357ms record no post-restoration writes or transactions; unused packets and native descriptors remain exact. Both named contexts close with no matching daemon. Original47/raw staged patch,83 clean source owners, three mixed owners, public15, Studio and both auxiliary route authorities remain unchanged. The settled Area62 gate/build is reused; no fixture/docs-only build or repeated full suite was run. Only these two audit records enter a focused local commit, with no push, deployment, branch or worktree change.

## Goal and method

Review every reachable user function, exercise its interaction and settings in the local production preview, repair reproduced defects at their owner, retest, review the resulting diff, and commit each completed area separately. A passing smoke check does not establish that every setting or hardware input works.

Use one isolated browser tab at `http://localhost:3001/vessel/`. Preserve the existing dirty/staged work and remain on `main`. No deployment or push is requested. Fixtures and browser evidence belong in ignored `output/playwright/`.

Status: **pending** = not checked; **active** = being reviewed/tested; **partial** = some checks pass but listed cases remain; **verified** = the listed cases passed, final review complete, commit recorded. Record unsupported/external interactions explicitly; never silently mark them passed.

For each area: trace UI → input handler → state/engine → renderer/persistence; enumerate controls; reproduce before changing; add meaningful regression coverage; repeat the exact interaction on the rebuilt production preview. Run affected tests first and type-check/lint/full Jest at the commit gate. Record failures from pre-existing work separately. Stop an area only when its enumerated checks pass and no actionable findings remain in that scope.

Initial scope: this ledger only, followed by the eraser owner and tests if evidence warrants changes. Expand the file boundary explicitly for each discovered issue. Existing edits in README, brush UI, input hooks, CC mark/commit paths, project IO, Goblet, and runtime logger predate this audit and must not be included in audit commits.

## Function inventory

This inventory follows `HomeClientMount` → `HomeClient`, toolbar, library, panels, modals and tool/store entrypoints. Hidden legacy presets are separately identified; settings must be expanded into per-control cases as each row is opened.

| ID | Function / required cases | Owners | Status |
| --- | --- | --- | --- |
| 01 | Eraser: tap/drag, size, opacity, tips, linked size, pressure bounds, raster/CC/sequence, selection clipping, undo/redo, held E, tool switching | `tools/EraserTool`, strategies, stamps, `eraserSettings`, drawing runtime | verified (software; see signoff/commit ledger) |
| 02 | Delete pixels: Delete/Backspace, no selection, masked/inverted selection, floating selection, locked/hidden/CC/sequence targets, undo/redo | selection slice/helpers, comprehensive keyboard | verified (software; see Session13 signoff/commit receipt) |
| 03 | Marquee: drag both directions, bounds, square constraint, dimensions, inset/expand, cancel | selection handlers, SelectionOptionsPanel | verified (software; square constraint unavailable; see Session13) |
| 04 | Freehand/lasso selection: finish, cancel, clipping, holes, edge cases | selection handlers, selection mask | verified (software; Session14 commit d5ab67b00) |
| 05 | Click-line/polygon selection: close/Enter/Escape, point editing, constraints | selection handlers | verified (software; Session15 exact66configs693checks, commit receipt below; point editing/constraints unavailable) |
| 06 | Magic wand: tolerance, contiguous/sample source, add/subtract, transparent/CC pixels | MagicWandControls, selection helpers | software-verified (Session16: 616 configurations/3,675 checks; local commit gate passed) |
| 07 | Selection: select all, deselect, invert, tool persistence, paint/fill/erase clipping | selection slice/ROI helpers | software-verified (Session18: 138configs/1905checks; focused local commit receipt below) |
| 08 | Move selected pixels: extract/drag, source clearing, commit/cancel, edges, CC metadata, history | selection handlers, selectionPaste | software-verified (Session23: final gate passed; local commit receipt below) |
| 09 | Copy/cut/paste/duplicate/paste in place: internal/external clipboard, scaling, alpha, cross-layer/CC, failures | selection slice, clipboard handlers, selectionPaste | software-verified (Session25: C01–C07 repaired; 47configs254checks; local commit receipt below) |
| 10 | Floating transform: resize, rotation, flip H/V, Enter/Escape/delete, layer switch | paste handlers/helpers, SelectionOptionsPanel | verified (software; Session27 signoff/local commit receipt) |
| 11 | Crop: selection crop, handles/dimensions, outside bounds, commit/cancel/history, CC/sequence | crop slice/handlers, CropOptionsPanel | software-verified (Session31; 300 native checks; completed-area local commit receipt) |
| 12 | Pixel brush: tap/drag, square/round tips, size, opacity, spacing, pressure, snap, shape mode | brush presets, brush engine/settings | software-verified (Session32; 351 native checks; shape mode intentionally unavailable) |
| 13 | Soft brush: edge/size/opacity, pressure, spacing, blend | brush engine/settings | software-verified (Session33; 336 native checks; final full gate passed) |
| 14 | Dither Stroke: algorithm, pattern, size, spacing, pressure, palette/alpha | strokeDitherRegion, brush controls | software-verified (Session34;192 native configurations/1,104checks; full gate passed) |
| 15 | Dither Shape: geometry, silhouette preview/final fill, dither settings, fill/cancel/history | shape handlers, brush engine | software-verified (Session34: A15-01 repaired;103 configurations/910checks; full gate passed) |
| 16 | Dither Grad: sampled/manual colours, gradient direction/range, geometry, dither settings | gradient shape runtime | software-verified (Session34: A16-01–03 repaired;108 configurations/905checks; full gate passed) |
| 17 | Color Cycle Stroke: tap/drag, palette, speed/flow, spacing, phase, line mode, pressure | CC stroke runtime, CC document | software-verified (Session36: A17-01–05 repaired; native/full gate pass; focused local commit receipt) |
| 18 | CC Tonal Dither: signal/ink mapping, sampling, dither settings, palette, playback | CC mark session, sampled path runtime | software-verified (Session38: A18-01–03 repaired; final native/full gate pass) |
| 19 | CC Fixed Dither: density/pattern, sampling, palette, size, playback | CC mark session, shape fill/dither runtime | software-verified (Session38: A19-01 repaired;116native cases/708checks; full gate pass) |
| 20 | CC shape/basic geometry: freehand/rectangle/ellipse/line/click-line, constraints, direction, preview/commit/cancel | CC gradient drawing runtime | software-verified (Session39;112native cases/752checks; final gate and local commit receipt) |
| 21 | Checkered brush: cell size, colours, spacing, opacity, shape/selection | brush engine/settings | software-verified (Session39;121native cases/1179checks; final gate/local receipt) |
| 22 | Rectangle Gradient: stops/direction, drag/constraint, commit/cancel | shape handlers, gradient brush | software-verified (Session39; 67 configurations/761 checks; full gate/local receipt) |
| 23 | Spam Text: content, font/size, spacing, colour, pressure, grid, selection/history | text brush/settings | software-verified (Session39; 48 native cases/400 checks; full gate/local receipt) |
| 24 | Resampler: source sampling, tap/drag, size, filtering, alpha, edges | resampler brush/runtime | software-verified (Session39; 43 native cases/411 checks; full gate/local receipt) |
| 25 | Mosaic: source/colour, tile settings, geometry, preview/commit | mosaic brush/runtime | software-verified (Session39; 48 native cases/538 checks; full gate/local receipt) |
| 26 | Shape Pattern: each exposed fill strategy and controls, boundaries, colour, preview/final | shapeFill, shape handlers/settings | software-verified (Session39; 76 native cases/1019 checks; full gate/local receipt) |
| 27 | Custom brush capture: region, alpha, normal/CC data, save/name/default, reload | custom tool, brush editor, project slice | software-verified (Session39; 19 native cases/255 checks; final gate/local receipt) |
| 28 | Custom brush painting/edit/removal: size/rotation/pressure/spacing, palette, defaults, library | BrushLibrary, custom presets, brush runtime | software-verified (Session39;34 native cases/956 checks;final gate/local receipt) |
| 29 | Shared brush controls: shape mode/basic shapes, constraints, grid snap, dashed strokes, antialiasing, custom pattern creation/import/local library, reset/per-preset persistence | BrushControls, tools slice | software-verified (Session39;40 native cases/1088 checks;final gate/local receipt) |
| 30 | Fill: tolerance/contiguous, alpha/colour, selection boundary, raster/CC/sequence, undo/redo | fillTool, tools slice | software-verified (Session39;32 native cases; focused local commit follows) |
| 31 | Eyedropper: click/held P, source/sample size, alpha, FG/BG, return to previous tool | color picker handlers/panel | software-verified (Session39;17native cases/391checks; full gate and focused local commit receipt) |
| 32 | Colour panel: RGB/HSV, FG/BG swap/copy, opacity, shared gradient swatches | ColorPickerPanel, palette slice | software-verified (Session39;11 native cases/392checks; focused local commit follows) |
| 33 | Gradients: inline stops/history/Hex/Transparent, saved presets/customs/persistence, CC propagation | gradient editor, saved brush gradients, palette/CC state | software-verified (Session39;11 native cases/506 checks; focused local commit follows) |
| 34 | Colour Adjust: scalar adjustments, ranges/pick, preview/cancel/apply, selection, CC data, history (Levels unavailable) | ColorAdjustToolPanel, colorAdjust slice | software-verified (Session39;30 native cases/775 checks; focused local commit follows) |
| 35 | Recolor: source modes, quantisation, palette/animation, layer conversion, history | recolor controls, RecolorManager | software-verified (Session39;24 native cases/2147 checks; full gate/local receipt) |
| 36 | Layers: add/rename/select/delete/duplicate, last layer, active fallback, history | LayersPanel, layers slice/services | verified (Session39; 8 native cases/717 checks; 618 suites/6331 tests; focused commit receipt) |
| 37 | Layers: reorder, multi-select, visibility/lock, opacity/blend, merge | LayersPanel, layer operations | verified (Session39;13 native cases/917 checks; full gate/local receipt) |
| 38 | Layer groups: create/name/collapse/reorder/visibility/opacity/delete, nested behavior | layer groups, LayersPanel | verified (Session39;12 native cases/1016 checks; full gate/local receipt) |
| 39 | Adjustment layers: all controls, ordering, groups, export parity | AdjustmentLayerPanel, compositing | verified (Session39;16 native cases/2710 checks; full gate/local receipt) |
| 40 | Alignment: all nine anchors, Auto, fit None/Contain/Cover/Fill/Tile, X/Y, save/load | AlignmentPanel, alignment rendering | verified (Session39;10 native cases/1581 checks; full gate/local receipt) |
| 41 | CC layers: creation/conversion, slot/palette ownership, visibility, playback, clear/resize/history | colorCycle slice/document/runtime | verified (Session39;14 native cases/855 checks; full gate/local receipt) |
| 42 | Interlace: group creation, source/phase/speed/settings, playback, export parity | InterlaceSettingsPanel, interlace runtime | verified (Session39;9 native cases/838 checks; full gate/local receipt) |
| 43 | Sequence layers: create, record strokes/fill/erase/selection, frame bounds, history | sequential slice/runtime | verified (Session39;7 native cases/508 checks; full gate/local receipt) |
| 44 | Sequence settings: FPS/frames, preserve/trim/retime, spread/fade/burst/gap, playback | SequentialControlsModule | verified (Session39; 6 native cases/455 checks; full gate/local receipt) |
| 45 | Playback: play/pause/scrub, global rate incl zero, mixed layer types, editing while playing | AnimationControlsPanel, runtime/playback | verified (Session39; 8 native cases/746 checks; full gate/local receipt) |
| 46 | Display filters: each exposed filter/control, order, enable/reset, viewport/export parity | DisplayFiltersSection, display filter runtime | verified (Session39;31 cases/4193 checks,24 HTML exports;A46-01/02 repaired) |
| 47 | Viewport: pan/Space/middle drag, zoom wheel/reset/anchor, resize, pixel grid/rulers | canvas view/input/render hooks | verified (Session39;4 native cases/237 checks; viewport context, rulers and settings hydration repaired) |
| 48 | Grid: toggle, rows/columns, snapping, invalid values, persistence | GridSettingsPanel, UI slice | verified (Session39;3 native cases/221 checks; guide settings remembered) |
| 49 | Keyboard: tool shortcuts, temporary tools, undo/redo, text/modal focus, interrupted strokes | comprehensive keyboard, canvas keyboard handlers | verified (Session39;4 native cases/215 checks; owned key release across focus and scope repaired) |
| 50 | Document: new/cancel, name/dimensions/background, validation, resize, unsaved work | DocumentModal, project slice | verified (Session39;3 native cases/151 checks; source-empty document lifecycle closeout) |
| 51 | History: all edit operations, redo invalidation, limits/spill/recovery, layer/runtime rehydration | history manager/slice/deltas | verified (Session39;4 native cases/456 checks; source-empty history closeout) |
| 52 | Save/load: .vs/archive round trip, raster/CC/sequence/custom brushes/filters/alignments, errors | projectIO, project slice | verified (Session39;3 native cases/243 checks; source-empty serialization closeout) |
| 53 | Load browser: file/folder/drop, preview/navigation/zoom, health/repair/export, cancellation | LoadProjectModal, directory/preview hooks | verified (Session39;4 native cases/168 checks; explicit repair copy) |
| 54 | Autosave/recovery/backups: enable/interval/status, failure, recovery/new-document behavior | autosave slice/services, SettingsModal | verified (Session39; 3 native cases/200 checks; Settings timer correction and autosave runtime proof) |
| 55 | PNG export: alpha/background, layer composition, bounds/size, download/errors | projectIO, ExportModal | verified (Session39; 3 native cases/115 checks; PNG synchronous composition and background ownership repaired) |
| 56 | GIF export: duration/FPS/size, palette/alpha, playback, progress/cancel/errors | exportService, ExportModal | verified (Session39; 3 native cases/150 checks; GIF transparency and cancellation repaired) |
| 57 | Video export: supported format/fallback, timing/size, progress/cancel/errors | exportService, ExportModal | verified (Session39; 5 native cases/274 checks; video cancellation and frame-error cleanup repaired) |
| 58 | Goblet: all formats, packaging/load, animation/filters/fit/masks/groups, progress/cancel/errors | goblet exporter, Goblet runtime | verified (Session39; 6 native cases/549 checks; decoder aliases and preview-only source handling repaired) |
| 59 | Options: display/background/rulers/FPS/pixel grid, history limit, persistence/reset | SettingsModal, localSettings | verified (Session39; 4 native cases/196 checks; Reset notifications repaired) |
| 60 | Library/UI: filters, active tool states, panel collapse/scroll, keyboard access, modals | BrushLibrary, toolbar, panels | verified (Session39; 4 native cases/95 checks; native labels and Document timer repaired) |
| 61 | Reference Studio: open/blocked popup, import/reference manipulation, lifecycle | referenceStudio, toolbar | verified (Session39; 3 native cases/187 checks; source-empty Reference Studio closeout) |
| 62 | Multiplayer: start/stop/failure, shared canvas/input/permissions, session lifecycle | collaboration runtime, toolbar | verified (Session39; 2 native cases/100 checks; source4 protocol-only client closeout) |
| 63 | Conditional Studio extension: enumerate visible controls only if build enables it | extensions/studioExtension | verified (Session39; 1 native case/15 checks; source-empty BASE capability classification) |
| 64 | Public CC Triangle, legacy Shape Gradient reachability and auxiliary UI Shape reference | presets, pages, extension entrypoints | verified (Session39; 2 native cases/55 checks; source-empty public Triangle and auxiliary route) |
| 65 | Canvas shape: rectangular/circle/freehand document bounds, Enter/Escape, clipping, persistence/export/history | DocumentModal, canvasShape slice/handlers | pending |

## Issue and evidence log — session 1 (historical; superseded below)

- Initial state: existing production preview responds at `/vessel/`; isolated managed Chromium opened without foregrounding the user's browser. The preview initially selected Mosaic with default raster and CC layers. Baseline source has pre-existing modifications; no audit source changes yet.
- Area 01 active: reviewing eraser strategy, stamp source, selection clip, settings and finalization contracts. Runtime cases and findings to follow.
- **A01 — fast taps fail to commit (reproduced):** painting and erasing with an immediate mouse down/up left layer pixels unchanged; holding down through one animation frame committed. `useCanvasInteraction` exposed React-rendered state to pointer handlers, so pointer-up could read `isDrawing=false` after pointer-down dispatched its start. Repair under test: update the interaction ref synchronously on dispatch and expose it through the existing state property. Regression checks cover immediate down/up and retained handler references across renders/reset.
- **A02 — stroke opacity applied twice (reproduced):** a 50% raster eraser tap on a fresh opaque red fixture produced alpha **191**, rather than approximately **127**. Canvas tracing recorded a `destination-out` preview blit at `globalAlpha=0.5` from a surface already containing 50% stamps. Repair under test: preview blits use alpha 1 and restore the caller's alpha; base restoration also uses alpha 1. Regression checks cover raw/dither/pressure-linked paths and both paint/erase composition.
- Scope expansion for A01/A02: `src/hooks/useCanvasInteraction.ts`, `src/hooks/__tests__/useCanvasInteraction.test.ts`, `src/hooks/brushEngine/liveStrokePreview.ts`, `src/hooks/brushEngine/__tests__/liveStrokePreview.test.ts`, plus this ledger. Existing pending edits to the preview scheduler and its tests remain untouched.
- First focused pass: **118 tests passed** across the two new suites, pointer-handler main flows, and EraserTool. Type-check passed. Lint passed after removing unused region coordinates. First preview build used an earlier source copy with those lint errors and failed; corrected build running. Runtime repair verification still pending.
- **Live verification rejected the attempted A01/A02 repair. All attempted runtime edits and their new tests were removed.** The corrected preview build succeeded and the full Jest gate passed (**562 suites / 4,748 tests; one suite/test skipped**), but the browser regression still failed 9 nonzero-opacity fast taps. A held 50% tap after switching tips produced alpha **0**, revealing that stamp-source overrides also affect opacity. Automated results above apply to the discarded attempt and do not prove a fix.
- At the end of session 1, source was back to its pre-audit state and the preview artifact still contained the discarded attempt: **rebuild before further baseline verification**. No runtime repair or audit commit is complete. Follow `app-functionality-audit-handover-2026-10-10.md` for the exact continuation state.

## Commit ledger

Area01 software scope: **db72ad87d7445c5e7c240cce8c4b46777d62ea2f** — `fix: make eraser strokes and history consistent across layer types` (Session12). Original staged and unrelated working changes are excluded. Area02 committed31f545ab5; Area03 signoff below. Physical/device/focus/performance exceptions remain unverified.

## Continuation evidence — session 2

User explicitly authorized subagents during this continuation. Bounded agents reviewed eraser/deletion independently and edited separate owners/tests; one managed browser session and integration remained centrally owned. Companion matrices: [remaining eraser cases](app-audit-eraser-cases-2026-10-10.md), [deletion review](app-audit-delete-review-2026-10-10.md).

- **A01 source repaired, exact raster cases passed:** the buffered stamp never flushed before raster capture. `BrushStampSource.end` now flushes before strategy/context/selection restoration, and `useDrawingHandlersEngineRuntimes` forwards the required engine operation. The first integration retest still failed because that narrowed adapter omitted the method; it was corrected before acceptance. No interaction-ref workaround was restored.
- **A02 source repaired, exact opacity cases passed:** eraser settings now resolve consistently for raw stamping and the engine's pressure/dither/preview/finalization helpers; raster composition uses alpha 1 because raw stamps contain opacity. Base restoration prevents cumulative preview masks being reapplied to already-erased pixels. Native Canvas2D experiment proved `copy` clears outside its destination region, so every affected base copy now clips its bounds and uses alpha 1. An explicit translucent eraser-tint fixture initially produced alpha242 at opacity0.5; an opaque mask color in the shared resolver corrected that case.
- **Production raster evidence:** `output/playwright/eraser-regression.results.txt`: 15/15 assertions passed, covering three tips × opacity0/0.25/0.5/1, held0.5, undo/redo, and outside pixels. Slider fixtures now press Tab to commit before starting strokes; rerun this script after final integration. `eraser-raster-matrix.results.txt` additionally passed the twelve tip/size center checks (1/5/20/500) and translucent-tint check. These are center/outside pixel checks, not full outline or hardware acceptance.
- **Production CC evidence:** `eraser-cc-matrix.results.txt`: 12/12 fast-tap mask checks passed on authentic UI-painted CC strokes, three tips × opacity0/0.25/0.5/1. Center coverage matches opacity, outside mask stays zero, and CC content remains present. Remaining settings, selection, history, playback and physical stylus cases are pending.
- **A03 locked eraser (reproduced, integration pending):** locked raster was erased. A start guard alone still erased it: pointer-down marked drawing active after start was refused, then pointer-up captured an empty overlay. The start callback is being changed to return acceptance, with pointer routing honoring rejection for both direct and bootstrap starts. Exact retest pending.
- **A04 preset panel routing (reproduced and retested):** Eraser after Dither Grad or Shape Pattern omitted its tip controls. Brush-only panel branches now require brush tool; both browser cases passed after rebuild.
- **A05 interrupted held E (reproduced and retested with explicit I/O boundary):** blur/hidden/pointerleave release temporary ownership and restore the previous tool through the existing finalization path. Browser integration uses a synthetic blur with `document.hasFocus()` temporarily returning false; a synthetic blur while the headless page actually has focus correctly does not satisfy that condition. Native external-window focus changes remain untested. Deliberate tap eraser stays selected; focused tests cover interruptions and overlapping releases.
- **A06 selection handle interception (reproduced, integration pending):** a real eraser click hit `[data-handle="right"]`, extracted selection into floating pixels, and cleared the selection. The resulting floating state invalidated later cases in that same matrix. Isolated evidence: `eraser-selection-probe.results.txt`. Handle input is being disabled for eraser specifically, preserving the explicit existing brush-handle contract. Rerun the rectangle/mask/corner/history matrix after rebuild; do not treat its previous failures as independently proven eraser-render defects.
- The source-review suspicion about CC preset → raster eraser did **not reproduce** in the browser fixture; no speculative repair was made.

Current completion status: area 01 remains active/partial, all other areas pending, no audit commits. Passing cases above do not establish the remaining matrix. Production build/type/lint and focused test logs are in ignored `output/playwright/`; rerun the settled-source checks before an area commit. Existing staged/unrelated work remains preserved.

### Final integration evidence and current state

The session-2 production artifact finished successfully at **2026-10-09 21:09:04 UTC**. This section supersedes earlier integration-pending statements above.

- **A03 verified for the raster fixture:** the rejected-start result now reaches pointer routing; locked erasing leaves the fixture unchanged. Shared guard and pointer tests cover normal/CC/sequence lock restrictions and rejected bootstrap starts. Locked CC/sequence exact browser interactions remain pending. The four repeated refusal cleanups use one local function. `pointerHandlersRuntime.ts` is 4,939 lines under its existing documented exception.
- **A06 verified:** eraser input no longer activates selection handles. Final raster matrix passes **19/19**, including normal/reversed rectangles, a mask with an excluded hole, tip/size center checks, edge history, and translucent tint. Existing brush-handle and floating handoff behavior is retained and tested.
- **A07 — CC preset compatibility (reproduced and verified):** honoring rejected starts exposed an existing eraser rejection after a CC preset. Earlier apparent success came from finalizing an empty overlay after the guard rejected the start. Ordinary Pixel setup still passed 15/15, proving the new start ordering itself was not broken. `strokeStartLayerGuards.ts` now permits erasers on valid unlocked paint targets before brush-only CC compatibility and gradient initialization. `eraser-additional-leads.results.txt` passed **6/6**, including CC preset → raster erase, locked raster, both panel routes and held-E blur software path. The original regression script now explicitly selects Pixel so retained presets cannot contaminate its fixture.
- **A08 — corner undo clears distant pixels (reproduced and verified):** a negative eraser ROI was passed unchanged into before-image capture, whose clamped origin and original width produced a cropped snapshot inconsistent with history's normalized ROI. Undo treated it as a full image and cleared outside pixels. `strokeCapture.ts` normalizes the override through the existing rectangle-to-capture conversion before snapshot capture. New tests exercise real bitmap history at all four corners. Production `eraser-corners.results.txt` passes **12/12** (four corners × erase/undo/redo), retaining distant opaque pixels; final raster matrix is 19/19.
- **A09 — snapped eraser ROI clips correct stamps (reproduced, UNFIXED):** advanced raster script passes 21/22 assertions; spacing, dashed length/gap, rotation, Lost Edge and Riso comparisons pass. Grid16/size4 at raw(37,117) should snap to(32,112), a 4×4 square x30–33/y110–113. Independent `eraser-grid-probe.results.txt` instead erases only pixel(33,113); aligned raw(32,112) correctly erases 16 pixels. The grid renderer snaps correctly; `EraserTool.recordROI` tracks raw pointer coordinates with only radius+2 padding, so canonical capture crops the shifted stamp. Repair the ROI authority using actual authored coordinates/bounds; do not enlarge downstream history to hide the missing capture contract. Check raster and sequence; CC grid parity remains pending.
- **Cancellation remains under review:** `eraser-cancel-probe.results.txt` uses a synthetic pointercancel during a real selected raster stroke. Canonical data is unchanged immediately after cancel. A subsequent mouseup commits the partial stroke with valid history, then an unselected erase works. An assumption that cancellation must discard therefore was not accepted as a proven defect. Source still leaves eraser interaction/tool context active on cancel, and CC masks mutate before finalization. Exercise cancellation without a subsequent canvas mouseup and CC mask/history explicitly before selecting commit-versus-rollback semantics. This probe does not establish native device interruption acceptance.

Settled checks: **13 focused suites / 236 tests passed**, full type-check passed (`--incremental false`), full lint passed, production preview build passed, whitespace review passed. Logs: `output/playwright/audit-eraser-{focused,typecheck,lint,build}.log`. A one-line nullability error in the new corner test was corrected before the final type-check. The earlier full-suite result applies only to the discarded session-1 attempt; run the required full gate before an area commit.

Audit-owned file scope expanded only for reproduced source contracts: eraser settings/stamp/finalization and bounded preview copies; the engine runtime adapter; layer guards/start result/pointer routing; eraser panel selection; held-E lifecycle; selection-handle gating; normalized stroke capture; their direct tests and these audit/guardrail documents. The exact file list and overlapping pre-existing keyboard hunks are recorded in the handover. No area is complete and no audit commit has been made; area 01 remains partial while A09 and the remaining matrix are addressed.


## Continuation evidence — session 3

- **A09 verified:** EraserTool bounds follow the renderer's shared snapped coordinate/initial pressure-spacing contract; settings getter uses the shared eraser resolver. Grid16 raw/aligned tap probe3/3, advanced raster22/22, snapped tap/drag/history/sequence11/11.
- **A10 reproduced and verified:** grid128/size4 raw(81,81) produced0 pixels while aligned(128,128) produced16. Engine bounds now include the configured maximum half-cell snap displacement. Large-grid exact retest3/3; owner tests cover falling pressure after the spacing was latched.
- **A11 reproduced, open:** advanced CC settings matrix14/22: all14 fixture strokes commit, all8 advanced comparisons fail identically. Spacing/dashes/grid/rotation/Lost Edge/Riso are bypassed by CCMaskEraseStrategy. Shared source-over cumulative-mask composition requires a designed owner repair; no speculative branch-only patch applied.
- **A12 verified software lifecycle:** pointercancel now commits visible partial eraser strokes through the established finalization path without a later mouseup, retains overlay/session while capture is pending, restores selection clip, and preserves one commit on later events. Production raster3/3, CC5/5, sequence12/12 (includes grid prerequisites). Native device cancellation remains unverified.
- **A13 source lead, unverified:** eraser batching drops computed velocity/timestamps before BrushStampSource. Equivalent-geometry timed inputs remain required to reproduce.
- Latest production artifact:2026-10-09 21:17:48 UTC. Current check gate:18 focused suites/294 tests, full type-check, full lint, production build and whitespace review pass. No completed area or audit commit; full suite remains required before completed-area commit. Browser explicitly cleaned with no daemon. Session3 in handover records exact extra owner files, tests, evidence and next steps.


## Continuation evidence — session 4 (in progress)

- **A11 production-verified:** CC erasing uses the shared BrushStampSource once on the canonical mask, alpha1; an explicit latched `target: 'erase-mask'` requests original-mask restoration before cumulative previews/finalization. Removed CC's duplicated geometry/spacing/pressure and empty overlay draw. CC now follows shared linear pressure sizing instead of the previous S-curve. Advanced CC exact retest22/22, basic tip/opacity12/12, cancellation/history5/5 on production artifact2026-10-09 21:23:30 UTC. Prior8 advanced failures were identical masks. Full pressure coverage follows below; no hardware acceptance claimed.
- **A13 reproduced, source repaired; combined production retest pending:** trusted CDP input delivered identical49points at200ms/4ms intervals. All8 input-evidence checks and8stroke commits pass; enabled spacing/dashV10 comparisons fail identically (18/20), disabled controls correctly match. Batching's existing speed/time now pass through tool/strategy/source without changing engine math. Deterministic real batching→tool→strategy→source→draw-entry test failed4/7 before,7/7 after.
- **A14 reproduced, source repaired; combined production retest pending:** three half-opacity CC taps (center, distant, center) yield192 at overlap; undo restores128 but redo rejects with mask-patch `document-version-mismatch`, expected4 actual5. Both document/pixel anchors stayed5/4 after undo instead of4/3. Mask-only delta now restores captured anchors; history construction assigns this responsibility only when no indexed patch exists. Drift guards remain. Real evolving-document/adjacent-indexed/combined-manager/late-failure-compensation tests pass. Baseline retention8/9; canonical buffers, selection clipping and repaint healing pass.
- **A15 reproduced, source repaired; combined production retest pending:** Square64, rotation on, diagonal(90,90)→(166,166) produces raster bounds56..199 versus canonical CC47..209; CC undo leaves279 mask pixels. Resolved rotation reaches EraserTool, whose ROI now includes the quantized/pressure-scaled tip's geometric rotated support. Round and unrotated bounds stay as established. Full pixel parity/undo script is ready.
- Selected A11 owner gate8suites/39tests, full type-check/lint/build pass. Combined settled gate/build/retests pending; no completed area or audit commit. Full Jest remains required only at completed-area commit gate.
- Remaining source lead: scheduled preview callbacks share mutable buffers and are not generation-invalidated on reset; reproduce rapid cross-target strokes before proposing a repair. Normal async capture may prevent the suspected ordering. No speculative patch added.

Session4 handoff gate: combined source11suites/62tests, full type-check/lint, diff check and production build pass. Latest artifact2026-10-09 21:34:16 UTC includes A13/A14/A15 repairs; their exact browser retests are still pending. First build copy raced a generated Studio file; retry passed without altering Studio. Browser cleaned with no daemon. Original3stagedfiles/7lines remain; no audit staging or commits. Final Session4 handover records immediate sequential probes and file ownership.


## Session-5 production evidence (in progress)

On the combined artifact **2026-10-09 21:34:16 UTC**, exact retests now pass:

- A13 raster velocity **20/20** and CC velocity **20/20**: trusted native CDP input evidence confirms identical geometry and distinct requested event timing; enabled spacing/dash speed effects differ, disabled controls match.
- A14 CC retention **9/9**: overlapping erase undo/redo, unchanged indexed/motion buffers, selection clipping and repaint healing. No nested replay failures.
- A15 full rotation outline **5/5**: complete raster/CC alpha-plane equality and zero residual mask/pixels after undo.
- Pressure **60/60**: fixed50/100/200 ranges and verified software-pen pressures.25/.75 author10/20/40/16/34pixel square sizes; whole-plane undo/redo and error checks pass for raster/CC. The first pressure script failed on duplicate labels for one checkbox; selector now deduplicates control IDs. No application change was made for that fixture error. CDP input does not establish physical stylus acceptance.

All65 areas remain in scope. Area01 is still partial: remaining cases and final review/full commit gate are pending. No audit staging, commit or push.

- Expanded tip/size outlines **216/216**: raster/CC, Square/Round/Diamond5 ×1/5/20/500 ×tap/drag, complete plane undo/redo and raster/CC equality. Square/Diamond taps also match complete geometric coverage; Round checks bounded opaque footprint/centerline and complete raster/CC parity.
- **A16 reproduced, open:** held-E release during pointer-down restores Brush before finalizing. Raster erase is lost; CC retains1020changed canonical mask pixels with no undo entry even after mouseup. E during active painting also changes tool without a history entry. Probe12checks4pass (history checks skipped when no entry); baseline saved `eraser-held-lifecycle-before.results.txt`. Production canvas keyboard adapter never supplies existing eraser callbacks. Repair is confined to adapter, two keyboard composition builders and a new direct test, forwarding existing interaction/pointer suppression refs rather than adding a second pointer policy.
- **A17 reproduced, source repaired; production retest pending:** API-only unlinked eraser40/brush12 actually erases40square and brackets independently reach41, but visible slider stays12; setting slider50 changes brush/global50. Baseline7checks4pass saved `eraser-unlinked-size-before.results.txt`. BrushControls now chooses independent eraser size for display and skips global-size writes while unlinked. New direct regression failed before and passes after; toolbar owner suite11/11. Linked sizing and exact production behavior still need retesting after the next artifact.
- Prepared sequence235check and protection14check scripts initially failed fixture setup due stale store snapshots after newProject/group creation. These are probe errors, not runtime defects; fix fixtures before interpreting dependent cases.


Session5 settled update: A17 exactproduction16/16 on21:43:39UTC; linked/unlinked display, sizechanges, brackets, fulltapfootprints andbrushsizeownership pass. Sequence corrected235/235 andprotection14/14 pass. A16firstattempt rejected12/16 andcompletelyremoved fromsource; ignoredtest archived. Sourceinvariant hasduplicatedsuppressionrefs inpointeraugmentation; earlyCCcanUndo=false alone isintentionalenqueue timing, notindependentlosthistory. Strongerisolatedhistorycountprobe precedesnextrepair. Fulltrace/ownership inSession5handover. Area01stillpartial; noauditstagingorcommit.

Final Session5: settled rebuild21:47:30UTC passes andcontainsno rejectedA16attempt. Stronger held-isolated baseline36checks12pass proves no-history release withstationarypointer aswellasmovement; CC1020maskpixels remainunhistoried andrastererase islost. A16 remainsopen. Namedbrowser cleaned/no daemon; originalindex preserved. Nextsource repair mustusecanonicalref throughaugmentation andrealintegration proof.


## Session-6 A16 production evidence

- **A16 repaired and exact retest36/36** on production artifact2026-10-09 21:52:04UTC. Held E release during stationary/moved pointer-down finalizes exactly one raster/CC eraser entry before tool restoration; subsequent held movement/mouseup leaves canonical content/history unchanged. E during painting preserves actual raster RGB/CC index content in one brush entry. Complete undo/redo and no replay/runtime errors pass.
- Source boundary: existing `useDrawingCanvasKeyboard.ts`, two keyboard composition builders, `useCanvasAugmentedEventHandlerDeps.ts`, `useCanvasEventHandlerRefs.ts`. The duplicate internal suppression ref was removed; augmentation uses the canonical supplied static ref. Existing E callbacks finalize through the normal handler and wait the existing pending-history barrier before changing tools. No history scheduler policy change.
- New real composition identity regression failed before repair and passes after. New real keyboard/store/event integration tests3/3 cover paint→eraser, held eraser→brush, real queued-history wait, repeated event protection and idle behavior. Existing Escape/undo tests also pass. Full type-check/lint/build pass; final completed-area gate still pending.
- Initial production run34/36: two redo comparisons counted unused CC mask RGB255→0 normalization as a failure. Source confirms mask history stores alpha only; direct per-channel inspection proved zero alpha differences. Probe now compares mask alpha and complete indexed/motion buffers, with first output retained as `eraser-held-isolated-mask-rgb-probe.results.txt`; corrected exact36/36 passes. No application change for this probe error.
- Area01 remains partial; preset/visible-control/selection-preview/rapid-target matrix continues. No audit commit/staging/push. Physical pen, native external focus and device interruption remain unverified.


## Session-6 continuation findings

- **A18 pending-press release repaired and exact9/9** on2026-10-09 21:56:38UTC artifact. Production idle-scheduler completion was explicitly held at the I/O boundary while real paint/finalization/history/key handlers ran; raster baseline8/9 left Eraser selected after held release during pending paint. Temporary ownership is now recorded before awaiting the press callback, allowing keyup/blur to see it. Real keyboard integration regression failed before,4/4 after. No native slow-device timing acceptance inferred.
- **A19 Rectangle Gradient ownership reproduced, source repaired; exact retest pending.** Preset matrix111/113 before failure: Rectangle Gradient→eraser toolbar shows controls but authors0pixels/history0. `useToolStateMachine.ts` flags used retained brushShape regardless of current tool; pointer routing intercepted eraser as rectangle workflow. Four special brush flags now require the Brush tool. New real store/hook tests5/5 fail before and pass after, including eraser/selection and return-to-brush. Build/retest underway; no downstream pointer guard added. Initial probe timeout lost per-case data; corrected runner catches script failures, uses actual immediate E tap rather than waiting for tool before keyup, and preserves results.
- Visible-control matrix102checks94pass: raster/CC Riso/history/metadata and sequence advanced spacing/dashes/grid/rotation/LostEdge/Riso with event+renderer+other-frame undo/redo pass. Four failures are real dither findings below; four are PigLift duplicate-label probe failures, now corrected for separate characterization. This is selected coverage, not all algorithm/extrema combinations.
- **A20 reproduced, open:** Pixel eraser opacity0.5/spacing40/size20, Dither off versus UI-on/BGFilloff/resolution4 produces identical complete raster/CC alpha planes. Shared resolver intentionally uses opaque white mask ink; `strokeDitherRegion` quantizes RGB and restores source alpha, so white ink produces no color error. Proposed explicit ephemeral alpha-coverage dither signal should use existing selected algorithms/resolution and black/white endpoints; no runtime patch yet. Keep paint-color dithering unchanged, preserve zero-alpha geometry, and define BG Fill semantics before implementation. Read-only trace in ignored `eraser-dither-source-session6.md`.
- **A21 reproduced, open:** underlying Dither Stroke hides eraser toggle and shows forced-on resolution although actual eraser ditherEnabled=false. Eraser UI capabilities inherit the underlying brush preset. No UI repair yet; eraser should have its own capability/control authority, not silently inherit forced dither.
- Prepared general B-during-erase probe `eraser-tool-switch-session6.js` is not executed. Remaining live selection preview, rapid target transitions, settings extrema/algorithm matrix and sequence pressure/velocity remain pending. Area01 partial; no audit staging/commit/push.


## Session-6 final coverage update

- **A19 exactly verified:** Rectangle Gradient toolbar/tap-E/held-E cases all12checks pass on2026-10-09 21:58:49UTC artifact; full20px half-opacity footprint, one erase entry, brush setting/shape restoration and complete undo. Same artifact passes the60checks across Rectangle Gradient, Spam Text, Resampler, Mosaic and Shape Pattern; the first9presets had108functionalchecks pass before A19.
- Custom toolbar entry passes4checks. Remaining custom keyboard entry is **unverified**: selecting a custom tip activates BrushEditor statusEDITING and its modal keyboard scope; delivered native E down/up were0.7ms apart, but neither switches because the scope intentionally blocks tool keys. Initial duplicate custom rows were fixture persistence, corrected by replacing the fixture ID. Do not misclassify this as a timing bug or bypass modal scope to claim UI coverage. Establish proper custom-editor exit/painting flow under area28 before completing this case. Evidence `eraser-custom-key-probe-session6.results.txt`; source lead BrushEditorUI auto-start effect has no currentTool guard, not patched.
- PigLift corrected characterization15/15: visible switch/strength/feather/texture settings change and history/undo/redo work, but full rasterRGBA/CCmaskalpha are identical off/on. `strokePigmentLift` explicitly skips destination-out; whether eraser UI should hide these unsupported controls remains open. No PigLift application patch.
- Settled6suites181tests, fulltype-check, fulllint, productionbuild and whitespace pass for retained Session6owners. FullJest still required before the completed-area commit; no area complete, no audit staging/commit/push.


## Session 7 — dither coverage and active-tool transitions

Area 01 remains partial; no area complete, no audit staging/commit/push. Original three staged paths/seven added lines remain unchanged. All 65 areas, bounded subagents, owner repairs, exact production checks and local continuation chats remain authorized. Shared main and existing preview server preserved.

- Reproduced Session6 control baseline again: **106 checks / 102 pass**, four actual A20/A21 failures. Corrected PigLift characterization prerequisites pass; no fixture issues classified as app defects.
- A20 initial alpha seam retained in `useBrushEngineSimplified.ts` → `strokeDitherController.ts` → `strokeDitherRegion.ts`: eraser uses alpha as the selected dither algorithm signal with fixed black/white inks, emits white binary masks for BG-off, keeps original zero-alpha geometry, never reapplies opacity to binary output, and replaces the cumulative region. Color brush default behavior stays unchanged. BG Fill on is explicitly interpreted from visible label as solid continuous-opacity background. Direct math regressions initially5fail/8pass, after13/13.
- A21 UI owner repaired: eraser dither capability is independent of painting preset forcing/hiding. A22 unsupported PigLift controls hidden for Eraser because runtime explicitly skips destination-out; painting availability/settings preserved. Existing BrushControls suite now20/20; meaningful regressions failed before each repair. Spread remains visible pending no-op characterization/contract.
- Exact production `eraser-visible-controls-session7.js` **100/100** on **22:07:02 UTC** artifact: independent toggle off/on under Pixel/Dither Stroke, full raster/CC bytes+history, unsupported PigLift absent, selected Riso and sequence advanced controls/event+render+other-frame replay. The case count differs from106 baseline because unsupported PigLift editing cases were replaced by absence checks.
- Expanded dither matrix `eraser-dither-matrix-session7.js` **250/250** on same artifact: eleven UI algorithm selections at opacity.5, Sierra resolutions1/4/8/64, opacity.25/.5/.75/1, BG Fill on/off, Variety0/100, full canonical undo/redo, CC metadata and raster/CC/sequence alpha equality. Spread100 is a proven color-only no-op against0. This selected midpoint matrix does NOT establish all-algorithm opacity response or all built-in patterns.
- **A20 remains open:** independent real math review found existing color algorithms attenuate thresholds/diffusion and max-alpha coarse sampling. Exact production `eraser-dither-ordered-opacity-session7.js` **13 checks / 7 pass**, all six Bayer strength assertions fail across raster/CC/sequence: opacity.25 gives0changed/history0, opacity.75 gives2400fullyerasedpixels/history1. Metadata/noerror/empty-history prerequisites pass. Owner expansion into `dithering.ts` + `ditherAlgorithms.ts` is necessary; do not claim complete dither repair. Read ignored `eraser-alpha-dither-review-session7.md` for detailed math, supported-pixel mean sampling and native nonuniform pattern-CDF caveat. Bounded agent implementation underway; main must test/review/build/exactly retest after settlement.
- **A23 active tool-switch loss reproduced:** `eraser-tool-switch-session6.js`24checks8pass. B during an active erase loses raster commit or leaves1020CCmaskpixels without history. Shared registry was called correctly but only waited finalization already started. `useDrawingCanvasKeyboard.ts` now registers the existing A16 operation as active tool flush, current callback ref+cleanup, normal stamp-brush classification/shape ownership, canonical pointer suppression, single shared promise and pending-history barrier even after pointerup. No downstream tool/pointer/scheduler patch.
- A23 exact native B **24/24**, actual toolbar Brush focus+Enter **24/24** on **22:10:37 UTC** artifact, including stationary/moved held pointer, exactly one eraser entry, complete undo/redo and unchanged CC metadata. CC history comparison intentionally uses mask alpha; unused mask RGB is not canonical. Direct lifecycle16/16; selected settled9suites104tests + actual toolSwitch1/1 pass. Full type-check/lint/build pass after explicit optional-shape guard. First type/build attempt failed on that optional parameter and was corrected; failure log retained.
- A24 candidate: direct overlapping pending E-release + later explicit Selection integration can end on Brush. No application patch; prepared exact production `eraser-held-selection-pending-session7.js` controls native idle completion and actual toolbar input before claiming a runtime bug.
- Custom-tip keyboard source flow identified: custom selection starts modal editor; actual Library Filters unmounts editor and releases keyboard scope while retaining custom identity. Prepared `eraser-custom-filters-session7.js` uses that visible flow, not a store bypass. Runtime pending.
- Prepared/running additional exact scripts: `brush-tool-switch-session7.js`, `eraser-dither-preview-session7.js`, existing held-isolated36 and held-pending-press9. Record results before acceptance. Remaining selection preview/rapid target/history/sequence pressure+velocity/all extrema and every later area stay pending. Physical stylus/native focus/device interruption remain unverified.

Session7 file boundary additions clean before audit: `src/hooks/brushEngine/strokeDitherController.ts`, `strokeDitherRegion.ts`, existing `__tests__/strokeDitherRegion.test.ts`; proposed necessary `dithering.ts`, `src/utils/ditherAlgorithms.ts`, existing utils algorithm tests. Other changes are in already audit-owned engine/UI/keyboard paths and their tests. Preserve mixed keyboard native-button hunks and all original unrelated dirty work. No partial-area commit merely for handoff.


## Session 7 final verification update

This supersedes the in-progress Session 7 rows. Area01 remains partial; no completed area, audit staging, audit commit or push. Original staged three files/seven lines preserved.

- Combined production artifact **2026-10-09 22:19:19 UTC** contains retained A20 alpha/math/non-pressure preview, A21 independent dither controls, A22 unsupported PigLift/Spread removal, A23 active tool finalization and A24 temporary-E selection precedence. Source and artifact agree; no subsequent runtime edits.
- Exact Bayer25/75% retest **13/13** (baseline13/7), non-pressure raster/CC/sequence × none/rect/hole preview **46/46** (baseline46/37), pending-release toolbar Selection **16/16** (baseline16/12), native M variant **16/16**. Earlier held-E regression **36/36** and pending-press **9/9** remain passing. Complete canonical undo/redo, CC metadata and one original history entry are asserted. Logs use `output/playwright/audit-session7-*` names; handover lists each.
- Selected source gate **199 tests across11suites**, plus the actual Pattern suite4/4, passes. Full type-check/lint/build/whitespace pass. Default-color golden hashes retain26exactcomparisons. Full Jest remains a completed-area commit gate; no partial commit for handoff.
- Earlier A23 actual B24/24, toolbar Brush24/24, ordinary paint→M12/12, and custom-tip Filters→tap/heldE10/10 pass on22:10:37UTC artifact. Custom Filters is the real UI exit from editor keyboard scope; no app patch for that fixture flow.
- **A20 finite-support strength remains open:** extended ordinary-algorithm opacity matrix **121/109**. JJN mean39.95/215.05 and Burkes43.35/211.65 at25/75%, requested63.75/191.25, on narrow20px-square separated stamps/res4, identical acrossall3targets. Twelve mean assertions fail; all metadata/noerror checks and eight other algorithms pass. Investigate kernel error lost outside supported geometry before deciding whether/how to repair; no tolerance relaxation or new compensation applied.
- **A25 reproduced/open, ASCII opacity reverses strength:** real visible Pattern→ASCII Cells at25/50/75% erases1152/856/288pixels identically on raster/CC/sequence. Exact baseline **34/28**; all27edit/replay and noerror checks pass, six monotonic checks fail. Evidence `eraser-dither-ascii-opacity-session7-before.results.txt` and `audit-session7-ascii-opacity-before.log`. One-line polarity flip is known insufficient because existing glyph buckets are not density-ordered. An alpha-only glyph-density selection proposal and significant coarse-crop limitation are recorded in ignored `eraser-pattern-contract-session7.md`; not implemented/accepted. Keep color glyph behavior unchanged; do not normalize native/custom CDFs speculatively.
- **A26 reproduced/open, pressure-linked preview changes on release:** actual PresRes checkbox, visible Max4, Smoosh off; raster-none mouse stroke produces **8/7**, with740renderedpixels changing at mouse-up. Seven controls/engine-path/stablepreview/binarycoverage/fullundo/fullredo/noerror checks pass. Engine sizes1.1568/1.8148/1.9703 confirm neutralmouse warm-up; this is not a constant4px pen case. Before-result retained under `eraser-pressure-dither-preview-smoke-session7-before.results.txt`; source/probe plan `eraser-pressure-dither-review-session7.md`. No source patch yet. Isolate fixednativepen1/Max4 crop diffusion before deciding Smoosh-changing-size semantics.
- Native decorative Pattern styles have valid empty/full endpoints and nonuniform CDFs; endpoint equality alone is not a no-op control. Custom tile fixed/local-tone/mark-tone-map/Infinity policies need separate declared-contract verification. Remaining eraser pressure/velocity/overlap, selection extrema, rapid layer/target/history, sequence and hardware limitations remain explicit.

See the handover's final Session7 section for source boundaries, exact logs, remaining probes and browser cleanup. Continue all65areas; do not mark area01 complete from these selected passing cases.


### Final settled matrix and A26 isolation

- Consolidated settled dither/settings/history/parity matrix **241 checks/238 pass**, `audit-session7-dither-matrix-settled.log`. All edit/fullundo/fullredo/CCmetadata/sequenceevent+render/otherframe/raster-CC-sequenceparity/Spread-absence assertions pass. The three failed assertions compare Sierra Variety100 versus0 at the uniform50% isolated-stamp fixture; canonical alpha is identical after the new Variety0 canonical-diffusion repair. This selected midpoint no-effect is open characterization, not proof the control never works. Investigate25/75% and nonuniform fields before changing existing Sierra variety authority; do not relax or silently drop the recorded assertion.
- **A26 constant-pressure isolation:** `eraser-pressure-dither-preview-pen-session7.js` **9 checks/8 pass**, `audit-session7-pressure-dither-pen-before.log`. Trusted native CDP pen events reach real pointer handlers at force1; engine trace shows onlypixelSize4. Preview-final still swaps **1000pixels** with Max4/Smoosh off, while controls/pressurepreconditions/stablepreview/binarycanonical/fullundo/fullredo/noerror pass. This separates fixed-size crop/diffusion from mouse warm-up. Before-result preserved under the same script's `-before.results.txt`. Software-native pen dispatch does not establish physical stylus acceptance. No A26 patch.
- Read-only A23/A24 final review found no actionable regressions; original native-button source/test hunks are verbatim. Shape tests establish stroke-finalizer abstention but do not mount the separate shape-completion owner; no unsupported patch or scope expansion for that omission.
- Thin-support source experiment (ignored pattern note): normalizing alpha diffusion by eligible forward supported-neighbor weights preserves selectedtaps/traversal and changes5×5JJN64/192 means30.6/224.4→61.2/193.8; Burkes51/214.2→61.2/193.8. No runtime patch yet; sourcecontract/test/build/exact121retest required.

Immediate continuation: repair and exactly retest thin-support alpha diffusion at its genericowner; settle A25ASCII glyph selection with explicit cropped-cell limitations; repair A26fixed-pressure localcrop authority then verify variablepressure/Smoosh distinction. Recheck selected Variety across non-midpoint/mixed fields and native/custom Pattern contracts. Finish remaining area01 matrix, final review/fullJest/completed-area scopedcommit, thenareas02–65. No partialarea commit for handoff, no push.


## Session 8 — retained repairs and rejected pressure attempt

Area01 remains partial; all65areas remain authorized. No audit staging, commit or push. Original mainHEAD7d587b744 and three staged paths/seven added lines are preserved.

- A20 finite-support alpha diffusion now normalizes only eligible supported forward taps, preserving selected kernels and color behavior. Thin/disconnected/edge tests pass; exact extended opacity production probe **121/121**, previously109/121. Utility81/81 includes26unchanged color golden comparisons.
- A25 alpha ASCII now selects unchanged native glyphs by their actual rendered5×7coverage, including empty/full endpoints and deterministic equal-density variation. Pattern7/7, a dedicated complete ASCII color golden, and exact25/50/75% raster/CC/sequence production probe **34/34** pass (previous28/34). Decorative/cropped glyph coverage is not pointwise monotonic; representative coarse runtime characterization remains pending.
- A27 first actual pressure-resolution commitment is initialized, retaining immediate shrink and70msgrowth stabilization. Two fresh-state tests fail before and pass after. Independent retained-path native probe remains pending.
- A26 rectangle-run candidate was rejected and completely removed. Fixed-pen/mouse candidate passes do not establish acceptance: actual source experiment shows a U-shaped/disconnected current run's bounding box wrongly changes an untouched older island. Next design needs exact positive authored support from the single native stamp draw; raw-alpha deltas cannot distinguish saturated overlaps. No rejected source remains in pressure pass/controller/finalizer.
- Retained source **128selected tests**, full type-check without incremental cache, lint, production build and whitespace pass. Latest matching artifact **2026-10-09 22:46:53UTC**. The stale hook fixture now supplies standard beginPath/rect/clip Canvas2Dmethods; no runtime fallback added. Full Jest remains the completed-area gate.
- First Pattern/Variety consolidated probe was interrupted by the CLI native file chooser boundary; no completed result accepted. Retry uses the real import input and its unchanged production handler. Sequencevelocity, rapidtarget/history, independentA27 and coarseASCII probes are prepared; results are recorded in the handover when completed.

The final Session8 handover section owns current evidence and next actions; older candidate/pending statements are historical. Preserve the existing production server and use one centrally managed isolated browser tab.


### Final Session8 evidence and continuation

- Native/custom Pattern and Variety **360/360**: eight nativepatterns/endpoints, declared fixed/local-tone/mark-tone-map/Infinity import-handler policies, completehistory/parity. Variety changes448alpha pixels at25/75% on eachtarget and106on mixedoverlap; previous uniform50% no-effect is fixture-specific characterization.
- Sequencevelocity **37/37**, representative coarseASCII **97/97**, independent actual pressurecommit refs **16/16**. Nativehardware remains unverified.
- **A28 mixed-target history-order bug repaired:** sequence commits now use the existing registered '__history__' lane behind older raster/CC erase commits. Exactly3sourcefiles+1test. Baseline native raster→sequence28/26, after exactinteraction+ raster→CCcontrol **55/55** on artifact **2026-10-09 23:03:18UTC**. Complete canonical chronologicalundo/redo, freshadmission/targetownership/otherframe/readyfollowup pass. Gate4suites15tests, fulltype-check/lint/build/whitespace pass.
- **A26 pressure preview remains open.** Rejected rectangle-run candidate and rejected temporary-stamp materialization are absent. Isolated Chromium actual-source primitive-output experiment27/27 preservesrawRGBA/saturatedsupport/U-island; this is feasibility evidence, not a runtimefix. Implement nativeexactsupport+spatialrunownership next.
- MainHEAD7d587b744, original3file/7lineindex preserved; noarea complete/auditstaging/commit/push. Managed audit browser cleaned withno matchingdaemon; previewserverPID14471 retained. No pendingbrowser/build/testprocess. Final Session8 handover contains precise sources/logs/nextscope. Continue all65areas and use the authorized newlocalcontinuation before contextlimits.

## Session 9 — exact native support and pressure runs

A26 now has an explicit native support output and a separate pressure-run owner.
Native raw drawing remains direct and single-invocation; already-produced final
rectangles/images/circles also author a transparent support surface. Cumulative
raw supplies complete diffusion/coarse-cell context. Smoosh off writes only
positive support from the current committed-resolution run; Smoosh on writes the
whole stroke. Throttled pending work closes before the next run changes raw, and
the final callback emits the buffered tail through the same output and flushes it
at the last accepted size. Finalization commits that prepared alpha mask.

The corrected before probe froze its early ROI immediately before the observed
first committed8→lower event and failed37/32:41early pixels changed with Smoosh
off, and781/180preview pixels changed at release with Smoosh off/on. The exact
retest passes37/37. The three-target variable1→.25→1/Smoosh matrix passes109/109,
fixed native pen1/Max4 × raster/CC/sequence × none/rect/hole passes73/73, and the
original mouse-pressure case passes8/8. Native actual-source Chromium checks
pass34/34 (exact fullRGBA, saturated support, single renderer/resource/random
consumption, U-island0ownership). Native full-path ownership/overlap and project
RGBA pattern checks remain pending at this entry; do not mark area01 complete.

The bounded repair spans14source files: new `alphaPressureDither.ts` and
`nativeShapeSupport.ts`; `BrushEngineFacade.ts`, `brushEngineFacadeTypes.ts`,
`shapes.ts`, `shapeStandardRenderer.ts`, `shapePixelBrush.ts`,
`shapeRisographEffect.ts`, `strokeDitherRegion.ts`, the4existing
`strokeFinalize*.ts` forwarding/commit owners, and `useBrushEngineSimplified.ts`.
Five direct test files are added/updated: alpha pressure/support/native tests,
`strokeFinalizeEntryController.test.ts` and `eraserStrokeComposition.test.ts`.
The native facade getter only supplies support for the active raw eraser surface;
unsupported shapes fail before authoring. Ordinary painting uses its existing path.

Gate:10focused suites/70tests, fulltype-check, fulllint, productionbuild and
whitespace pass. Artifact2026-10-09 23:11:32UTC. Original3-file/7-line index remains
byte-identical; no audit staging, commit, push or completed area. Physical hardware,
focus and performance acceptance remain unverified. Logs/probes use
`output/playwright/audit-session9-*` and `eraser-*-session9.*`.


### Session9 A26 settled on pending-preview rebuild

Explicit native positive authored support now owns current pressure-resolution run writes while sampling full cumulative raw. Native renderer/resources/random are consumed once; support includes saturated overlaps. A further exact dashed U-run probe found102late old-run pixel changes despite0new-run support; pending accepted work is now flushed by its owner before preview publication. Deterministic regression included; no tolerance relaxation.

Latest artifact2026-10-09 23:21:11UTC passes native runtime73/73 (U/disconnectedisland, saturation/nonuniformneighbors, tips/rotation/riso, rectangle/fractionalhole, fullhistory) and three-target variablepressure/Smoosh109/109. Gate10suites71tests, fulltype-check/lint/build/whitespace pass. Previous nativeemitter parity34/34 and fixedpen73/73/mouse8/8 remain recorded separately. See final Session9 handover for precise source boundaries/logs. Area01 stays partial; projectRGBA smoke is being corrected for source-confirmed fixture alignment normalization, with strict metadata comparisons preserved. No audit staging/commit/push or completed area; no fullJest partial-area gate.


### Session9 project RGBA pattern acceptance

Corrected fixture smoke9/9 and complete projectRGBA tile matrix **126/126** pass on23:21:11UTC artifact (`audit-session9-project-rgba-normalized.log`). Real named projectasset selection/opacity across raster/CC/sequence; independent sourcecoverage/alpha-luminance threshold oracle, endpoints, mixedoverlap, complete canonical metadata/assets/buffers/events/otherframe/history andfulltargetalpha parity pass. The prior smoke4metadata failures came only from injected raster auto-alignment normalization; fixture now goes through the existing capture owner before baseline. Strict comparisons preserved, no application fix. Runtime tileScale/invert/cutoff/offset fields have no visible controls and are not claimed as UI coverage. Area01 remains partial; final Session9 handover owns remaining scope and process/index state.


## Session 10 — selection/extrema and remaining controls

Area01 remains partial; no completed area, audit staging, commit or push. Initial production artifact was 2026-10-09 23:21:11 UTC.

- Selection/extrema initial matrix: **521 checks / 401 pass** (`eraser-selection-extrema-session10-initial.results.txt`). All non-CC exact clipped footprints and full target parity pass. 27 CC seed prerequisites failed before erasing because authentic 500px CC taps did not commit; dependent parity cases are not eraser failures. 42 raster/sequence preview-final comparisons fail, and 12 raster edge undo metadata comparisons expose stale derived alignment. Edit alignment changes themselves are required by the existing capture contract; the original unchanged-edit-metadata oracle was invalid.
- **A29 open — held tap publication and buffered drag tail.** Native seam probe **25 / 21** (`eraser-preview-native-seam-session10.results.txt`) proves raw and overlay already equal the final result for the three taps (0 differing pixels), while held Drawing surface changes 0 pixels and release changes 1/121/62750. Sequence drag raw/overlay/display contains 980 pixels versus final985, with native queue waiting224/lastDrawn223. These are distinct publication and buffered-endpoint paths. No source repair yet; do not call finalizer during preview or duplicate renderer/random/resource work. Source design in `eraser-preview-native-seam-session10.md`.
- **A30 — pressure maximum display.** Controls matrix **194 / 191**: only three copies of maximum display incoherence fail (minimum=maximum1000, enter max0, store1000/1000 but display1000/1). Dash1/20, pressure50/100/200 and software-native pen .1/.5/1, exact canonical history/otherframe/parity pass. Shared `PressureRangeInputs` maximum now clamps with `minPressure`, matching its existing store callback. Two brush/eraser regressions fail before and pass after; complete BrushControls test23/23. Exact production retest pending at this entry.
- **A31 — bitmap history derived alignment.** Edge capture legitimately recomputes auto offsets from remaining content, but bitmap undo restored pixels without refreshing those offsets. Existing unchanged capture helper is exported and reused by bitmap replay before state publication. Four edge regressions plus manual metadata and compensation tests: 5fail/13pass before, affected3suites123tests pass after. Full type-check and lint pass; production retest pending. Three necessary files: `layerCaptureActions.ts`, `bitmapDelta.ts`, `brushHistory.test.ts`.
- **Adjacent area17 — authentic CC tap missing commit.** Diagnostic17/17 characterization checks distinguish this from eraser behavior: 500/240px center taps are admitted but end with no history; a 500px short drag and two240px drags commit full65536 indexed pixels/all corners. The initial CC owner enqueues the down stamp, so unsupported-tap behavior is not assumed. No CC painting patch. For the selection fixture, use the proven full-project500px short drag, preserve the failing tap evidence and strict comparisons.
- CC pending probe first attempt stopped at fixture setup (Opacity slider missing because restored CC layer reselected brush/preset), before idle hold or destination input. Its2/1 result is not lost-stroke evidence. Corrected `cc-source-pending-finalization-session10-fixture.js` and `eraser-held-layer-switch-session10-fixture.js` normalize layers before final real UI Pixel/E selection and explicitly check readiness; syntax only at this entry.

All initial outputs are retained. No tolerance was relaxed. Prepared redo-branch, lifecycle completion, shape-origin, hidden protection, Riso characterization and held-layer-switch probes remain runtime-unverified. Final Session10 handover below owns settled repair/build/retest state.


### Session10 A31 production acceptance

A31 passes **61/61** focused production checks on artifact2026-10-09 23:46:16UTC (`audit-session10-raster-edge-alignment-after.log`): all12original raster edge drags, exact full footprints, independent complete derived edit alignment, canonical baseline undo/authored redo and no errors. Source/fulltype/lint/build and3suite123test direct gate pass. A29 remains open; area01 remains partial. No audit staging/commit/push.


### Final Session10 controls acceptance and handoff

A30 exact same controls probe improves194/191→**194/194** on23:46:16UTC artifact (`audit-session10-controls-extrema-after.log`). Originalbefore results remain preserved. A31 exact61/61 also passes. Fulltype/lint/build/whitespace and focused owner gates pass. A29 tap publication and separate bufferedtail remain open; CC seed taps are adjacent area17, not eraser failure. Corrected CC pending and remaining prepared probes are unverified. Original index preserved; noarea complete/auditstaging/commit/push. Managed browser closed/no matchingdaemon; existing previewserver retained. FinalSession10 handover owns exact nextscope.


### Session11 progress (current combined artifact00:06:26UTC)

A29 held-tap publication and deterministic native endpoint now pass exact seam25/25 plus turns/backtracking/spacing/dashes73/73. Corrected endpoint gate has7suites69direct tests; tap scheduler/consumer tests included. Fulltype/lint/isolatedbuild pass. Eligibility excludes dither/Riso/LostEdge/AA/custom; effects/fullselection remain pending.

Remaining checks pass: CC pending-finalization31/31, redo branch165/165, software lifecycle59/59, SoftShape-origin23/23, missing protection22/22. Riso characterization88/88 proves intensity works and Hue/Edges have0canonical effect. A32 hides those unsupported eraser-only details, preserving intensity/savedvalues/painting; direct26tests pass, production UI after-probe pending.

A33 actual held-pen row switch is reproduced55/50: destination misattribution or source mask without history/lost stroke. Existing flush-before-activation two-file repair is in progress; no acceptance yet. Details/log names/bounded owners in Session11 handover. Area02 has44prepared configurations, runtime unverified. All65areas scope persists. No area complete, auditstaging/commit/push; originalindex preserved.


Session11 further evidence: corrected fullselection/extrema **709/709**; A32 actualUI/content/history **76/76**. Combined rowrepair artifact00:17:03UTC. A33 after54/52 repairs all3sourceownership/held-contact boundaries but CCundo exposes A34idle-deactivation forced versionpublish (expected5→actual6); safe existing finalization-seam repair is in progress, no overallA33acceptance yet. Effects **82/73**, all9strictheld/final cases fail (Riso1648/206/1754; LostEdge14each; regularSierra9each), canonicalhistory/stability/errors pass. Exact evidence, bounded source design and four prepared remaining input/overlap/playback scripts are in finalSession11 handover. No effect/RNGpatch, noarea complete/auditcommit.


Session11 settled A33/A34: safe CC idle-finalization seam plus explicit raw-endStroke consumers routed to existing lifecycle facade (sixfiles). Before4fail→direct5suites118pass; corrected fulltype/lint/build pass, artifact00:24:26UTC. Exact strict held-row-switch after **64/64** sourceownership/admission/completecanonicalhistory/followup checks; previous54/52 preserved. Modifiers **117/117** settled. Original Space140/134 observer failures corrected in versioned capture probe, rerun pending. Overlap44/40: rasterpass, sequence literalcanonical/historypass but displayed400/400/800/400 differingRGBA bytes; premultiplication boundary hypothesis pending versioned literal diagnostic. Playback unrun. A29 effects82/73 remains unpatched. FinalSession11 handover owns exact queue/evidence. Noarea complete/auditcommit; all65scope persists.


Session11 corrected native input transitions **173/173** on00:24:26UTC (`audit-session11-input-transitions-capture-production.log`, `eraser-input-transitions-session11-capture.results.txt`). Window-capture observer sees actual trusted Space down/up before the owning handler stops propagation; all six Space/activeUndo configurations retain complete canonical/history/admission assertions. Original140/134 diagnostic-only failures remain preserved. Modifier117/117 remains settled; no input-owner app patch was needed.


Session11 final: playback **23/23** actualtransport/admission/history passes on00:24:26UTC. Versioned overlapdiagnostic **44/40** confirms **A35sequence Canvas2D premultiplication boundary**: canonical/nativeoracleRGBA identical, all4actualdisplayplanes exactlymatch independentpremultiplied-as-straightdiagnostic (0bytediff). Literalred127alpha displays[191,128,128,255] overwhite vsrequired[255,128,128,255]; originalstrictassertions/evidencepreserved. CPUtilecontractvalid; renderer andlivepreview handpremultipliedbytes tostraightRGBA ImageData. NoA35patch yet; minimal source design/nextownerverification in finalSession11handover and ignoredoverlap/playbacknote. Remainingarea01blockersA35and9A29effects; correctedinput173/173/modifiers117/117/playback23/23 settled. Area02Delete44configs unrun; all65scope/noarea/auditcommit persists.


CCpending owner integration rerun on00:24:26UTC **31/29** (`audit-session11-cc-pending-after-activation.log`). Previous31/31results/run preserved with before-cc-activation suffix. Two failures are immediate visible-row activation and dependent destination-only authoring: this old probe deliberately holds the source history idle callback yet assumes immediate row activation, while A33 now correctly waits for source/history flush before activation. Actual A33/A34strict64/64 already proves the new order. Versioned probe correction is being prepared: prove activation stays on source while idle isheld, release realidleboundary, wait requestedactualdestination then issue freshlyadmittedgesture; retain literal canonical/sourcehistory/replay. Do not call old31/29 a newlyaccepted contract or silently overwrite evidence; correctedresult pending at thisentry. Noappchange based on this probe.


FinalSession11 corrected actual pending-history/row contract **35/35** on00:24:26UTC (`audit-session11-cc-pending-after-row.log`): sourceheldhistoryblocksactualactivation, nativeidledrainsettlessource1history, requestedsequenceactivation thenfreshsource-onlydestination2history, completecanonicalchronologicalreplay/followup. Prior31/29obsoleteimmediateactivationoracle preserved. Noappworkaround. CurrentqueueA35sixfileCanvas2Dconversionowner/live/exporttests then9A29effects; source/designnotes in finalhandover. Fulltype/lint/build/direct118testgate/whitespace pass, originalindex preserved, noarea/auditcommit, Delete44runtimeunrun/all65scope.

### Session12 current verification

A35 sequence partial-alpha presentation repair is production verified: unchanged overlap44/44, diagnostic44/44, playback23/23 on00:37:56UTC, with direct conversion/live/export31/31 and CPU/worker27/27. Six existing source/test owners, canonical premultiplied bytes unchanged. Exact original failing evidence remains.

A29 deterministic LostEdge and regular Sierra endpoint sampling repairs pass focused53/53. Riso eraser overlay and forkable native RNG repairs pass direct tests but initially leave small endpoint differences. CC refresh double masking is repaired at the current-frame render owner (two files, real presenter/compositor regression36/36); exact effects now **82/79** on00:47:54UTC. All LostEdge and regular Sierra cases pass; three Riso cases remain. Native raw context uses willReadFrequently:true and preview false. Isolated copy-and-cap experiment reproduces differences only with differing context settings. Two-file preview context repair passes68/68; production retest pending. Combined Riso+LostEdge/dither coverage is being prepared. Area01 remains partial.

Area02 relative-count Delete probe executes **238/196** across44 configurations on00:37:56UTC. Original160/90 probe with invalid selection-history counts is preserved. Reproduced failures: locked targets3, masked selection Undo10, sequence selection Undo8, rename-focused floating Delete1, strict metadata replay20. Canonical deletion oracle and all prerequisites/errors pass. Bounded source fixes have direct failing-before/passing-after evidence for locks46/46, full selection/queued sequence history56/56, panel propagation59/59, and raster replacement alignment45/45. CC pixel-patch metadata/clone repair is in progress. Exact production Delete retest remains pending; no fields or tolerances excluded.

Session12 handover records source boundaries, context/RNG compatibility tradeoff, logs and latest artifact. Main/HEAD and original index remain unchanged. No completed area, full-Jest area gate, audit staging/commit or push. All65 areas remain scope.


Session12 settled artifact **2026-10-10 00:58:30.599UTC** includes all stable context, metadata, alignment and selection-history repairs. Unchanged strict original effects probe `eraser-tail-effects-session12-settled.js` passes **82/82** (`audit-session12-settled-effects-production.log`): all three Riso held/final endpoint comparisons now exactly match, as do LostEdge and regular Sierra, full canonical Undo/Redo and runtime-error checks. Original82/79 and diagnostic evidence remain preserved. Combined effects, broader Riso turns/pressure and Delete retests are still pending at this entry. No area complete or audit staging/commit/push.


Session12 combined-effect production probe on00:58:30UTC executes **82/79** (`audit-session12-combined-effects-before-production.log`, `eraser-combined-effects-session12-v1.results.txt`). Only nondither Riso100+LostEdge100 strict held/final fails: raster36,CC40,sequence28 displayed pixels. Both Riso+regularSierra and Riso+LostEdge+Sierra pass, as do all canonical/history/stability/error prerequisites. Source matches: live preview excludes Riso from nondither LostEdge, release applies LostEdge. Two-file repair announced before editing: `liveStrokePreview.ts` plus existing `eraserStrokeComposition.test.ts`, remove only stale Riso predicate, preserve original cases and add nonuniform-alpha completed-cap/edge/no-cap/repeated/immutability regressions with fail-before evidence. Repair/rebuild/exact retest pending at this entry.


Session12 exact Delete post-fix probe **238/238** on artifact00:58:30.599UTC (`audit-session12-delete-after-production.log`, `delete-functionality-session12-after.results.txt`). All44native configurations pass actualselection/key prerequisites, canonical deletion, full mask/owner/vector replay, locks, D04rename-floating, CC complete metadata and independently derived raster edit alignment. Undo/Redo remains literal, original238/196 and initial160/90 retained. This closes reproduced D01–D04 plus metadata/alignment within this subset, not the whole area02matrix. Prepared continuation21configs and playback/transformed-floating follow-ups remain pending.

Riso+LostEdge two-file preview repair stable: onlystale Riso exclusion removed,8new nonuniform-alpha rows fail-before and76/76after (composition27/facade28/hook21); original9effectrows preserved,3publications/edge/interior/cap/no-cap/sample+blitbytes/raw+completedimmutability verified. Evidence `a29-riso-lostedge-session12-*`. Root read incrementalpatch; no further issue identified. New isolated build begun after exactDelete script finished; production combo after pending at this entry.


### Session12 combined acceptance and native Riso footprint reproduction

Artifact **2026-10-10 01:03:43.262UTC** passes exact unchanged combined effects **82/82** (`audit-session12-combined-effects-after-production.log`, `eraser-combined-effects-session12-after.results.txt`). Previous82/79 remains preserved. Full type-check/lint pass after settled two-file repair (`audit-session12-combined-settled-{typecheck,lint}.log`). Original effects82/82 on priorartifact remains valid; no new source elsewhere.

Broader native Riso turns18configs **145/138** (`audit-session12-riso-turns-production.log`, `eraser-riso-turns-session12.results.txt`): seven failures, all controls/trusted ownership/positive erasure/stability/Redo/runtime prerequisites pass. Raster+sequence backtracking Round20 held/final differs160/146pixels; spacing40 Diamond5 differs46/45. Size500 edge0→1 raster Undo leaves1527RGBA/alpha pixels and CC Undo511maskalpha pixels; sequence held/final differs1527pixels. Strict comparisons retained.

Independent source traces converge on EraserTool ROI, not native RNG/cap or engine preview bounds. Tool uses halfsize+2, whereas native Riso's un-clipped texture scale1.1 plusjitter extends farther. Raster/sequence capture uses ROI exclusively; CC direct canonical authoring retains those pixels but history ROI omits them. Read-only actual native geometry diagnostic confirms size100 misses1284authoredpixels and size500 misses48484 on an interior1024surface (`area01-riso-roi-review-session12.*`); this is supporting source-geometry evidence, not replacement production acceptance.

FOUR-file repair announced before editing: `src/tools/EraserTool.ts`, its existingtest, `colorCycleEraserSettings.ts`, its existingtest. Forward resolved optional risographIntensity and reuse existing getNativeRisographStampRadius in the ROI owner afterpressure/rotation sizing. Preserve existing noRiso bounds and actual geometry; no capture/finalizer/preview source edits indicated. Failing-before nativegeometry/provider regressions, exact145check retest and affected bounds/pressure follow-ups pending. Do not mark area01 complete or run full-Jest area gate yet.

The pressure-support74prepared probe specifically tests pressure-linked ditherresolution with pressureEnabled=false; it must not be described as size-pressure or physicalstylus evidence. Separate18config nativeCDPpen size-pressure Riso100 rising/falling endpoint probe is being prepared; actual sizepressureUI50→200,3native tips×3targets, full held/final planes and canonicalhistory, opacitypressurefalse current exposedcontract. Both are unverified at this entry.


Session12 pressure-linked ditherresolution native support probe **74/74** on01:03:43.262UTC (`audit-session12-pressure-support-production.log`, `eraser-pressure-support-runtime-session12-v1.results.txt`). All unchanged73Session9 authored-support/U-island/saturation/native-tip/Riso/selection/history assertions and new strict whole256² held-stable/final Riso display comparison pass. This is software CDP pressure-resolution evidence with size-pressure disabled; separate variable-size-pressure18configs remain preparation. Original Session9 evidence and previous source versions retained.


**A36 — native Riso footprint/capture ROI repaired and production verified.** Artifact **2026-10-10 01:10:39.823UTC** passes the unchanged strict turns/spacing/dashes/size1/size500edge probe **145/145** (`audit-session12-riso-turns-after-production.log`, `eraser-riso-turns-session12-after.results.txt`), improving145/138. All seven held/final and incomplete Undo failures are closed without changing the oracle or downstream capture/history consumers. Four-file source/test boundary above; before7fail/28pass →35/35 owner tests plus62/62 direct integration. Full type-check, four-file lint, subsequent root full lint and isolated build pass; original test-only optional-shape type failure retained, fixed in harness with explicit fallback. Task diff/backups `area01-riso-roi-session12-*`. No further source edit after this build. Separate18config size-pressure Riso probe currently executing; final full-Jest area gate and commit remain pending.

Bounded final source reviews cover UI/keyboard/held-E/shapecontrols/handles/rowactivation, nativealpha/dither/support/pressure/RNG/preview, bitmap/maskanchors/queuedsequence/A34lifecycle/startacceptance/capture/strategies. No further actionable introduced bug was found beyond A36. Existing meaningful tests were inspected; this does not replace the pending final full gate or remaining runtime probes. Source review summaries and provenance are in ignored `area01-source-review-session12.txt`, `area01-commit-provenance-session12.txt`.

Concrete area01-only draft110paths is prepared, not staged:99area01-only +4initialmixed +5area01/02shared +2umbrellaDocs. Exactinitialnative-button/context-restoration hunks and allarea02source are excluded; currentfullworktree remains unchanged. Explicitly include global inventory/handover and eraser/guardrail docs; excludeDelete-specificreview. `area01-only-draft-session12.generate.py` regenerates patch/manifest/remainder plan after docs settle; verify SHA/source/index before use. Original index remains byte-identical. A standalone temporary archive candidate is being type-checked separately; no index mutation/commit/gate claim. Native toolbar Enter proof belongs to the combined working base's initial keyboard guard, not the isolated audit commit.


### Session12 final variable-size pressure acceptance and isolated candidate gate

The trusted native-CDP pen variable-size pressure Riso probe passes **163/163** across18 configurations on artifact **2026-10-10 01:10:39.823UTC** (`audit-session12-size-pressure-riso-production.log`, `eraser-size-pressure-riso-session12-v1.results.txt`). Actual Pressure UI is enabled with50–200% bounds, base size20 and opacity0.5; three native tips across raster/CC/sequence and rising/falling endpoints. Assertions include emitted size chronology, trusted pressure ownership, positive authoring, full256² held-stable/final equality, complete canonical Undo/Redo and no runtime errors. Pressure-opacity and pressure-linked dither are disabled and asserted as the current exposed contract. Physical stylus, tilt, native device interruption and external-focus acceptance remain unverified.

The110-path area01-only draft was materialized in a separate temporary HEAD archive, without changing the real worktree/index. Full candidate type-check (`--incremental false`) and full lint pass (`audit-session12-area01-candidate-{typecheck,lint}.log`). Full Jest is running (`audit-session12-area01-candidate-full-jest.log`); do not mark its result passed until completion. Candidate excludes all initial unrelated hunks and area02 repairs. Production interactions exercise the preserved combined working base; native toolbar Enter acceptance depends on the initial keyboard guard and is not claimed as an independently supplied change in this candidate. No audit staging, commit or push yet.


### Session12 full-gate findings and Delete follow-ups

The first isolated candidate full Jest gate completed **570 suites passed,2 failed,1 skipped;5,037 tests passed,2 failed,1 skipped**. Original log `audit-session12-area01-candidate-full-jest.log` retained. One failure is the archive fixture lacking Git metadata; initialize Git only in the temporary candidate, no root branch/index mutation. Its unchanged Git-aware gate suite then passes20/20 (`audit-session12-area01-candidate-git-fixture-retest.log`). The other is the older `src/hooks/__tests__/useBrushEngineSimplified.test.ts` facade test double lacking the now-required `beginStroke` seam. Announced one-file scope expansion; add only `beginStroke: jest.fn()` to that mock, preserving real runtime owners and existing meaningful facade-target integration coverage. Include this additional audit-only file in the exact candidate/draft (111paths now); repeat the full gate after the test-only correction. No full gate pass/commit claimed yet.

Area02 production continuation21configs initially134/132 (`delete-continuation-session12.results.txt`). The sequence negative-start native marquee renders and replays exactly; its canonical event legitimately retains full off-project selection rectangle stamps. The oracle wrongly expected project-only stamp coordinates, yielding5761 serialized differences despite alphaMismatch0. Preserve that result and correct the oracle to native full selection geometry while retaining exact clipped rendered-pixel equality. The adjustment case is a first-prerequisite ambiguous Hue/Sat1 locator; scope it to the actual layers panel. Corrected follow-up remains unrun.

Area02 transformed-floating/playback9configs pass **68/68** on01:10:39.823UTC (`audit-session12-delete-playback-floating-production.log`, `delete-playback-floating-session12.results.txt`). Actual raster move/resize/90degree rotate, CC move/resize, extracted source ownership after active-row switch+Backspace, full payload/selection Undo/Redo, pre-existing CC mask+actual Play/Pause and complete paused composition, and event-tagged literal sequence frame playback pass. No physical device/clipboard/forced pending-history or sequence extraction policy claim; area02 remains active.


Session12 Delete continuation corrected evidence: `delete-continuation-session12-v2.results.txt` executes134/133; all non-adjustment paths, including the exact full8448-cell off-project sequence event and5760 rendered project pixels, pass. Its only remaining failure is a first-prerequisite absent Marquee control after adjustment activation, not a deletion defect. The reachable adjustment-only route acquires a native raster selection before actual Add Adjustment and row activation, then Backspace; **4/4** pass (`delete-adjustment-session12-v3.results.txt`, `audit-session12-delete-adjustment-v3-production.log`). Full canonical bytes, selection and relative history are preserved. Original v1/v2 results remain; no oracle tolerance or app source change. Together with44configs238/238 and9floating/playback68/68, these close the tested native paths. Final missing-payload/persisted-mask/pending-boundary probes remain preparation; area02 is active, no area02 commit yet.

The final candidate test-only correction passes its two affected suites22/22 (`audit-session12-area01-candidate-gate-repairs-retest.log`); final full candidate type-check and lint also pass (`audit-session12-area01-candidate-final-{typecheck,lint}.log`). Corrected full Jest is running in the same isolated Git-aware candidate (`audit-session12-area01-candidate-full-jest-git-aware.log`). A read-only review caught and closed a post-commit logging/verification failure gap in the ignored temporary-index procedure; recovery now installs the precomputed preserved index for the expected commit even if post-commit verification raises, and retains recovery files on unexpected state. A tiny isolated real-Git fixture confirms separate temporary-index commit plus actual-index lock and post-commit recovery preserve the exact unrelated staged diff and working bytes. No root audit commit/index mutation yet.


### Session12 area01 software signoff and completed full gate

The exact isolated area01 source/test candidate passes the corrected full gate: **572 suites /5,039 tests passed;1 suite/test skipped;1 snapshot passed** in223.01s (`audit-session12-area01-candidate-full-jest-git-aware.log`). Final full type-check and lint pass in `audit-session12-area01-candidate-final-{typecheck,lint}.log`. Original failed archive/mock run and targeted22/22 repair retest remain preserved. Final reviews found no remaining actionable introduced issue in the enumerated area01 software scope. Runtime production evidence includes strict Riso turns145/145, variable-size native-CDP pressure163/163, original+combined effects82/82 each, pressure-resolution support74/74, and the other settled matrices above. No app source changed after artifact01:10:39.823UTC; only the older hook test double was completed for the final gate.

Area01 software scope is verified by the local focused commit containing this signoff, contingent on its successful creation. The111-path candidate excludes initial unrelated edits and all area02 repairs; the original three staged hunks and every working-file byte must remain preserved. The resulting commit hash is appended immediately after creation. Physical stylus/tilt, native device interruption, external focus and hardware performance acceptance remain explicitly unverified. Native toolbar Enter behavior was exercised on the preserved initial working base and is not newly supplied by this isolated audit commit. Area02 remains active; areas03–65 pending. No push or deployment.


### Session12 area01 local commit complete

Area01 software scope committed locally onmain as **db72ad87d7445c5e7c240cce8c4b46777d62ea2f** — `fix: make eraser strokes and history consistent across layer types`.111explicitly reviewed area01 paths, parent7d587b744; no push/deployment. Temporary-index commit verified intended tree/blobs, all working-file bytes unchanged, and original three-file/seven-addition staged patch byte-identical (SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7). Evidence `area01-commit-verification-session12.json`, `area01-commit-session12.log`. All initial unrelated work, four mixed initial remainders and five shared area02 remainders remain in the working tree.68initial/area02 paths remained immediately after commit; these post-commit ledger/handover updates add documentation dirtiness intentionally. Do not rerun the old111-path generator/commit script: both deliberately assert the original parent HEAD and are now historical evidence.

Area01 is verified for the enumerated software matrix with the explicitly recorded physical/device/focus/hardware and initial toolbar-Enter dependency limits. Area02 remains active with44configs238/238,20other continuation paths passing, correction-only adjustment4/4 and9floating/playback68/68. Continue final rejection/persisted-mask/pending-boundary probes and final area02 review/fullgate/focused local commit, then areas03–65. A separate area02 candidate must use currentHEAD and preserve all initial hunks; do not apply old pre-area01 complete-file baselines to the current worktree.


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


### Session13 Area02 local commit complete; Area03 active

Area02 software scope committed locally on main as **31f545ab50cb44ea7356917af816bc3dae3325b1** — `fix: preserve selection deletion and pending history across layers`; parentdb72ad87d.26reviewed paths, full572suites/5,091tests plus type/lint, exact production acceptance recorded above. Temporary-index receipt verifies intended tree, every working byte unchanged, all47initial paths preserved, original staged patch byte-identical SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7. Evidence `area02-commit-verification-session13.json`, `area02-commit-session13.log`; no push/deployment. Area02 candidate/procedure asserts31f's parent and is now historical, not reusable for the next area.

Area03's first native matrix executes39configurations232checks/215pass on artifact01:35:11.625UTC. Corrected v2 retains the valid assertions and changes only the pan observer to actual Drawing-surface blue-marker translation plus explicit end-event Shift semantics:39configs255checks/240pass (`audit-session13-marquee-v2-before-production.log`, `marquee-functionality-session13-v2-before.results.json`). Four initial M32 store-offset failures were invalid observations because silent pan updates view refs; corrected rendered movement/stopping allpass. M28 proves rendered pan continues after Escape. No oracle tolerance was introduced.

Reproduced Area03 findings: Shift append discards prior rectangle1024cells or holemask768cells; replacement Undo loses previous selection; Shift pressed during drag has same final loss; negative-start Inset uses raw bounds instead of displayed clipped region (45wrongcells,23×23vs22×22); Escape and software pointercancel leave stale selection movement/release/history and Escape leaves pan alive; Inset/Expand produce no selection history. Actual geometry/dimensions/canonical preservation and other listed cases pass. Square constraint is unavailable in traced UI/source; Shift explicitly appends, not square. No new feature is inferred from inventory wording.

Announced Area03 boundary: selectionHandlers+existing tests; pointerHandlersRuntime+existing main integration tests for current Shift forwarding/live preview; selectionSlice+existing bounds tests for adjustments. Root's adjustment owner is settled: same UI clamp helper for visible base rectangle, complete synchronous selection-history commit (no-op equality creates no entry). Before8fail/14pass; after slice/alpha/panel3suites37pass (`audit-session13-marquee-adjust-{before,after}.log`). No Area03 production after or full gate/commit yet. Append/replacement agent is implementing with the admitted immutable pending-history baseline. Cancellation requires explicit keyboard/pointer runtime wiring, still design-only at this entry. Source inventory and26grouped lasso cases are preparation only in ignored `lasso-source-review-session13.md`.

Area03 initial ownership baseline:47initial files copied as .txt into ignored `area03-initial-baseline-session13/`, hashes in matching.json, against31fHEAD. Before touching keyboardHandlers or its existing test, preserve/exclude their original initial hunks using that baseline. Original staged patch still unchanged. Post-commit updates deliberately dirty only this ledger/handover until Area03 files are changed. Staymain; no push/deploy; continueall65areas.


### Session13 Area03 owner repairs in progress

Stronger native baseline42configs295checks/265pass retains v2 geometry/renderedpan oracles and additionally proves heldShift previews lose originalA, cancellation fails exact pregesture rollback, and freshgesture replay is polluted. Separate unequal imported-image probe2configs15checks/11pass proves Expand60×60→17×17 instead of62×62 (3,555mismatchedcells) because action uses image dimensions while panel uses document dimensions.

Append/replacement four-file owner tests pass170/170. Root adjustment two-file owner now uses same projectclipped visible rectangle and document limits, commits complete selectionhistory, and preserves no-op suppression; unequal-size4cases failbefore, bounds+panel38pass after plus separatealpha suite. Cancellation adds only existing keyboardowner/test to selection/pointer boundary and is under integration review. No Area03 productionafter/fullgate/commit yet. Square constraint remains unavailable; Shift appends. All65areas remain authorized; Area04 inventory/probe is preparationonly.


### Session13 Area03 exact production acceptance; final gate underway

Combined settled source built successfully at **2026-10-10 01:50:03.423UTC**. Exact unchanged marquee v3 passes **42configurations305/305checks** (`audit-session13-marquee-v3-after-production.log`, `marquee-functionality-session13-v3-after.results.json`); same strict before run was295/265, differing check count because replay prerequisites now succeed. No assertions were relaxed. LiveShift append expansion/shrink/turn, originalrect/hole preservation, finalmodifier semantics, replacement completeUndoRedo, empty/priorselection Escape/softwarepointercancel rollback, ignoredlateevents/freshgesture, visibleclippedgeometry, fourdirections actualrenderedpan/stopping, input lifecycle and CC/sequence smoke allpass. Squareconstraint remains unavailable; no feature invented.

Exact unequal96image/256document Inset/Expand probe also passes **2configs19/19checks**, before15/11 (`audit-session13-marquee-unequal-after-production.log`, matchingafter.results.json). Fullcanonicalbytes preserved; completed adjustment has onehistoryentry and exactUndoRedo. Root bounds+panel2suites38tests +selectionAlpha1suite3tests pass. Six sharedselection/inputowner files pass5suites204tests and affectedlint/diffcheck. Independent final review finds no introduced actionable issue.

Fresh10-path candidate excludes initial buttonSpace/Enter guard and threeinitialtests from mixed keyboardfiles, and excludes everyotherinitialpath. Isolation reviewer confirms8nonmixedcandidatefiles matchworking; native marquee Escape/replay keys focusworkspace and do not depend on excludedbutton guards. Initial45nonmixedfiles and original3file7additionstagedpatch remainbyteidentical. First candidate typecheck caught broadnewtestfixture spread replacing required canvasadapter with AppState.canvas; corrected only existingtest to explicitSelectionRuntimeDynamicDeps and properbaseDynamic.canvas, affected18/18. Appsource/prodartifactunchanged. FirstfullJest was deliberatelyinterrupted, notpassed. Freshfinalcandidate typecheck/lint pass; fullJest running. No Area03 commit/fullgatepass claimed yet.

Area04 native baseline is preparation while Area03 gate runs:40configs268checks233pass. Meaningful selectiontransaction/queue leads are underread-onlydesign; fractionalalpha differences at correctliteralvector/bounds require a localizedCanvasbackend/oraclediagnosis before appdefectclaims. No Area04 sourceedit.


### Session13 Area03 software signoff and completed final gate

Final isolated10-path Area03 candidate passes full typecheck, full lint and **572suites/5,125tests** (one suite/test skipped; one snapshot) in222.455s. Evidence `audit-session13-area03-candidate-{typecheck,lint,full_jest}.log`, `area03-final-gate-session13.json`. Final source is unchanged from exact production acceptance **44configs324/324checks** on01:50:03.423UTC: marquee42/305 plus unequal importedimage2/19. Original pre-repair42/295/265 and unequal15/11 evidence retained. Initial typefixture correction affects only testadapter; initial GitHEAD fixture failure was confined to temporary checkout and20/20retestpass before final fullgate. No runtime source patch was needed for either fixture correction.

Completed marquee software scope repairs originaladmission snapshot, baseline-derived append preview/finalunion, live/finalShift semantics, replacement UndoRedo, clipped/document-size InsetExpand with complete history, and shared Escape/softwarepointercancel transaction rollback/lateevent suppression/autopanstopping. Realstore and realpointeradapter tests retain immutable masks/vectors/provenance and canonical pixels/documents. Final independent source and candidate-isolation reviews found no introduced actionable defect. Eightapp/testfiles+twoexistingauditdocs only; original10linekeyboardbutton guard and47lineinitialtests remain excluded/preserved. All47initial paths and staged3file7additionpatch are preserved.

Squareconstraint is unavailable; no feature invented. M14 'fractional-zoom' actually proves fractionalworld-coordinate rounding at2xzoom, not actualfractionalzoom. Physicaldevice/focus/hardwareperformance remain unverified. Pointercancel and pendingRAF controls are explicitly software seams. No whole-app completion is claimed. Area03 software signoff is contingent on successful focusedlocalcommit and receipt appendednext; main/no push/deployment.

Area04 correctednativebaseline40configs273checks243pass on sameartifact (`audit-session13-lasso-v2-before-production.log`, matching-before.results.json), still noappedit. DetachedCanvasexperiment proves all9first-run alpha-only differences were oraclecontext mismatch: full256 willReadFrequently:true matches every actual retained alpha/RGBA byte exactly. V2 only fixes contextflag and adds5clippingwitnesschecks; all originalstrictassertions retained. Remaining30failures comprise25interaction/history plusrawclosureoracle and4strictinterior255expected/0actual witnesses; purewinding/distanceprerequisitepasses. Read-only owner/lifecycle/terminal designs and rootrefinements in ignored `area04-continuation-facts-session13.md` guide nextrepair. Browsermanagedsession explicitlyclosed/no daemon; previewserver retained.


### Session13 Area03 local commit complete; final handoff to authorized Session14

CurrentHEAD **186296de17f45b38415cd38ba451094be8d79d5c** — `fix: preserve marquee selections and adjustment history`, parent31f545ab5, main.10explicitpaths, source-isolatedkeyboardinitialhunks excluded. Receipt `area03-commit-verification-session13.json` confirms intendedtree, allworkingbytesunchanged, all47initialpaths preserved and original staged3files7additions SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7 unchanged. Finalgate572suites5,125tests/one skip and type/lint; exactproduction44configs324checks. No push/deploy/branchchange. Area03 generator/commit script nowhistorical, asserts31fparent; doNOTrerun againstnewHEAD. Postcommitledger/handoverreceipt updates are intentionallydirty.

Area04 active, noapp/testsourcepatch yet. Correctedv2 baseline40configs273checks243pass retains all originalchecks and independentclippingwitness; original40/268/233+localized rasterexperiment preserved. Read `output/playwright/area04-continuation-facts-session13.md` FIRST for rootdecisions/sourceinvariant and protectedshell refinements that supersede read-onlyagentdesign. Then `lasso-source-review-session13.md`, `area04-lasso-owner-design-session13.md`, `lasso-terminal-lifecycle-design-session13.md`, exactrunner/result/log. Nineoriginalalpha-only falsefailures resolved solelyby independentlyproved contextflag; no appsource workaround. Remaining30checks fail25interaction/history+rawclosureoracle/four255expected0actualinteriorcells.

Minimum anticipatedsourcefiles are selectionHandlers+test, pointerHandlersRuntime+main.test, existing useCanvasEventHandlers wiring. Announce exactboundarybeforewriting. Keep composition shell wiring-only; workflowinhandlerauthority. Its lifecycleboundarychange requires wc plus module-size-guardrails.md andactiveauditplan updates, announce directlyrequired docs too. Correct sourceinvalidclear contract before callercompensation: scopedfreehandinvalidappendno-op, invalidreplacementreversibleexistingclear. Preservebaselinebeforeoutsidehitclear, allinputvertices atadmission/schedulerowner, rawterminal reachesexistingprojectclipping unchanged, immediateactualtool/mode transition cleanup+staleeventdefense throughsharedcancellation. No newbaseline/queue/dither/noise/alpha-threshold workaround. Currentindependentfullvector/alpha/canonical/history strictoracles remain mandatory. Physicaldevice/focus/hardwareperformance unverified.

Freshownership baseline `area04-initial-baseline-session13.json` +matching ignored .txt directory records47initialpaths against186HEAD. Bothkeyboardfiles nowincludecommittedArea03+retainedinitialhunks; old31f fullbaseline mustNOT overwrite newlycommitted cancellation. No Area04need toeditkeyboardcurrently. All45otherinitialhashes unchanged. Finalworkingstatus should47initial+2postcommitauditdocs=49paths.

All3boundedagents completed; no app/sourcewriter, build, browsercommand or testprocess remains. Managed `vessel-whole-app-audit` explicitlyclosed, cleanupreportsno matchingdaemon and independentps confirmsnone (`audit-session13-final-browser-cleanup.log`). ExistingpreviewserverPID14471 retained, latestartifact **2026-10-10 01:50:03.423UTC** remainscurrent. Nextcontinuation inspectsessions thenreopen SAME stableheadlessmanagedsession once, reuseonepage; no foreground/duplicatewindow/server. Node22.22.0 through mise. Root aloneowns sequentialbrowser/build; preview:prod:build onlyafterownerstable. Continue all65areas autonomously with alreadyauthorized boundedsubagents andfurtherlocalcontinuationsbeforecontext70%. No permissionrenewal needed.

## Session14 Area04 owner repair boundary

Outcome: preserve original lasso selection through admission, append/replacement history and cancellation; retain each delivered vertex; close raw outside terminal to the original first point before project clipping; cancel immediately on tool/mode transition with no stale resume. Non-goals: new selection features, changes to native nonzero fill, brush scheduling, renderer tolerances, physical-device/focus/performance acceptance, and downstream clipboard/paint behavior.

Announced source/test boundary: `selectionHandlers.ts` + existing test, `pointerHandlersRuntime.ts` + existing main test, and wiring-only `useCanvasEventHandlers.ts`; required docs are this active ledger, handover and `module-size-guardrails.md`. Existing selection cancellation, immutable snapshot, mask visibility and clipping authorities are reused; no new baseline or queue. Protected shells are 79/44/70 lines respectively. Bounded agents own separate selection/pointer files; root owns the one managed headless browser and retained production server.

Corrected unchanged native baseline remains40configs273checks243pass on01:50:03.423UTC. Deterministic fail-before evidence: selection owner23fail23pass after correcting its Canvas2D I/O seam; pointer/composition4new tests fail. These tests do not claim native rasterization acceptance. Owner fixes and exact production retest are pending at this entry. Stop condition: strict original v2 geometry/canonical/history/replay plus added invalid-replacement/away-back/mirrored-terminal/shared-hole interactions pass, final review, isolated type/lint/full Jest, focused local commit excluding all47 initial paths and original3-file staged patch. Continue Area05 and remaining inventory after completion.

Session14 final review found and reproduced a queued-hover event crossing a new freehand admission, including an older React handler closure. Native software-I/O2configs15checks11pass before and deterministic same/recreated-handler failures prove the boundary corruption. The scheduler now compares its existing freehand points-array identity with the admitted session before processing a queued event; the superseded down-only cancellation was removed. No new queue/session baseline. Exact unchanged after retests remain pending. Additional native followup before12configs84checks63pass retains reversible invalidreplacement, away/back and mirroredclipping failures.

Final settled source: owner/pointer174/174, shared keyboard19/19, scoped and full lint pass; working type-check retry passes. Independent final source/test review records no remaining actionable defect in the five-file boundary (`area04-final-source-review-session14.md`). Exact production and isolated commit gate remain pending.

Session14 exact production on02:12:07.853UTC: unchanged v2 **40configs282/282**, addedfollowup **12configs104/104**, queuedhover same/recreated **2configs15/15**, screenshot probe **4configs33/33**; total58configs434/434. Initial isolated8-path candidate type/lint/fullJest **572suites/5,160tests** passes (one skip), but is superseded by the presentation finding below. Original results/logs and screenshots preserved with pre-outline names; no final signoff yet.

Native screenshot inspection confirms completed freehand ants draw a retraced internal bridge (hole case) and omit mask boundaries synthesized by document clipping (outside-terminal case). Read-only reviewer agrees the mask's occupied-alpha boundary is authoritative; no contour utility defect. Announced expansion: `src/components/canvas/drawingCanvasSelection.ts` + existing test. Reuse cached mask contour for completed freehand masks while preserving vector metadata/history and Click Line vectors/anchors. Scope now10paths total (seven source/test + three required docs); final settled rebuild/exact retest/review/isolated gate required before commit.

Outline owner regression-before2fail/3pass; after7/7 (render owner5 + existing contour utility2), scoped lint/diff pass. Two real-mask fixtures prove hole loops/no retraced diagonal and synthesized top/right clip edges, mask-local/view transforms and byte/vector immutability. Existing Click Line vector+anchors and no-mask rectangle remain covered. Only a two-line rendering predicate change is needed; input/mask raster/history code is unchanged from434/434 acceptance. Final source rebuild and exact rechecks pending.

## Session14 Area04 software signoff and final gate

Final settled artifact **2026-10-10 02:17:43.408UTC** passes the exact unchanged corrected-v2 **40configs282/282**, followup **12configs104/104**, pendinghover-v2 **2configs15/15**, and screenshot/canonical probe **4configs33/33**: **58configurations434/434checks**. Root inspected all four final screenshots: triangle/concavity follow occupied mask edges, hole has both loops without the internal bridge, and clipped polygon includes project top/right boundary. Pre-outline screenshots and all fail-before records retained. Original geometry/alpha/vector/canonical/history/replay assertions remain literal; no tolerances or rasterization workaround.

Final independent source/test review finds no remaining actionable defect in seven source/test files. Final isolated10-path candidate full type-check, lint and **572suites/5,164tests** pass (one suite/test skipped; one snapshot) in143.411s. Original47dirtypaths and staged3-file7-addition patch are preserved; no initial keyboard/button hunks included. Native mode-button Enter interaction occurs on the preserved combined working base; direct composition tests independently prove the Area04 cleanup owner. No new button-keyboard contract is claimed from this commit.

Completed software scope: original admission/snapshot, final Shift union/replacement and exact UndoRedo, invalid append no-op and reversible replacement clear, raw outside closure/project clipping, every delivered freehand vertex, pregesture queued-event rejection across React recreation, immediate tool/mode cancellation/stale suppression/fresh gestures, raster/CC/sequence canonical preservation, and visible hole/clipped contours. Missing square/subtract/fill-rule/point-edit controls remain unavailable. L05 uses fractionalworld coordinates at2xzoom; actualfractionalzoom remains47. Software pointercancel/RAF/contact-order seams do not prove physicaldevice, externalfocus or hardwareperformance acceptance. Local commit receipt follows; whole-app audit remains open and Area05 next.

### Session14 Area04 local commit receipt; Area05 active

**d5ab67b001fcdeb5ec2a043800763593ae1df90d** — `fix: preserve lasso geometry and reversible selection history`, parent186296de1, main.10explicitpaths. `area04-commit-verification-session14.json` confirms intendedtree6508ea9e84e07ffc857117249f2e4502fa67e45f, allworktreebytes preserved, all47initialpaths excluded/preserved, originalstagedpatchSHA4d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7 unchanged. No push/deploy/branchchange. Postcommit receipt docs intentionallydirty. Area05 starts originalprepared56config ClickLine nativebaseline on same02:17:43artifact; no Area05 app/test source edit. Fresh ownership baseline `area05-initial-baseline-session14.json` +matching backups derives from currentd5abHEAD, not oldarea03/04scripts. ExistingKeyboard initialhunks must remain excluded from futureArea05mixedowner commit.


### Session14 Area05 corrected native baseline

Area05 remains active; no source/test edits. The retained original runner executed56configurations503checks444pass. Its document-only dblclick filter missed trusted workspace-targeted events, and aborted cases left drafts for later fixtures. V2 fixes the routed observation target, sends Escape before each newProject, exercises real P01 mode buttons, and uses a keyboard prerequisite for deliberately pointer-free P20. V2 executes all56cases540checks478pass. Two modifier witnesses still miss Enter because canvas keyboard owns window capture and stops propagation there; v3 moves the observer to that same capture target.

Final v3 baseline on unchanged artifact2026-10-10 02:17:43.408UTC: **56configurations540checks480pass60fail**, all cases executed, no prerequisite/runner abort and no runtime/replay errors. Every original exact geometry, alpha, vector/bounds, canonical bytes and history/replay assertion remains. Independent review confirms observation/isolation corrections only. Original v1/v2 results are retained; final evidence is `clickline-functionality-session14-v3-before.results.json` and its matching production log under output/playwright.

The remaining assertions demonstrate native double-click failing to complete, Shift+Enter/NumpadEnter dropping append, admission losing the previous selection before its history snapshot, invalid append/replacement policy gaps, and tool/mode away-back preserving stale draft vertices. Root trace identifies existing selection, keyboard, pointer and lifecycle owners; the next continuation must announce its concrete boundary, add failing owner/direct-integration regressions, repair those source contracts, rebuild once stable and rerun this exact corrected baseline before review/full gate/focused local commit.60failed checks are not60 independent defects. Conditional active-vertex extraction, near-start double-click tails and native presentation probes run separately before any justified expansion. No whole-app completion, Area05 fix or commit is claimed.


### Session14 Area05 supplemental proof and final handoff

Separate supplement7configs57checks49pass8fail (no runtime/replay errors) reproduces active-session extraction: native Shift admission retains A, then a later non-Shift vertex within A extracts canonical pixels to floating paste. Its dependent completion abort is deliberate, not another defect. Initial selected-alpha extraction characterization passes exact crop/source-clear/history3checks and must be preserved. Native screenshots for hole/concave/triangle pass all exact geometry/canonical/history prerequisites and replay checks; root inspected all three. Hole presentation includes a retraced internal bridge, despite the correct mask. Preserve vector metadata and point circles, but completed mask contour is the outline authority. Announce drawingCanvasSelection.ts/existing-test expansion before this minimal source repair; contour utility has no demonstrated defect. Original screenshots retained as *-completed-before.png.

Original near-start supplement cases fail strict canvas dblclick prerequisite because the second press changes to an unlabeled target after first-down closure. Transform handles are plausible but not proven by that trace. Corrected fixture moves first vertex away from handles to(60,80), with other vertices(128,32),(32,32). Both exact-start and3pxoutside-alpha gestures now deliver two trusted canvas pointerdowns(detail0) and workspace dblclick(detail2); all final/tail/fresh assertions execute. **2configs43checks29pass14fail**, no runtime errors, proves near-start first-down closure followed by second-down selection loss/stale draft. Evidence `clickline-near-double-session14-v2-before.results.json` and matching production log. A late dblclick finalizer alone cannot prevent the earlier mutation. Read conditional native-click-authority note, establish source intake design and actual mousedown delivery if relevant, then announce justified adapter/wiring/type expansion; no timer, fake event or downstream rollback.

Read `output/playwright/area05-root-facts-session14.md` first in next continuation. Final corrected main baseline56configs540checks480pass60fail; supplemental extraction/visual and corrected near-double evidence above. No Area05 source/test edit, no test/build/browser command or agent writer remains. All47initial work hashes and original stagedpatch unchanged;49statuspaths. Main/d5abHEAD, no push/deployment/branch change. Exact managed browser session vessel-whole-app-audit cleaned, cleanup confirms no daemon; existing previewPID14471 retained on unchanged02:17:43.408UTC artifact. Next continuation inspects then reopens SAME headless session once, onepage, noforeground/duplicatebrowser/server. User already authorized all65areas, boundedsubagents and further localcontinuations before70%context; continue without permission renewal.


## Session15 — Area05 source repair and native authority

Area05 remains active pending exact production acceptance and isolated final gate/commit. All65areas and further continuation remain authorized; no push/deployment/branch change.

Native event-delivery experiment confirms prevented pointerdown suppresses mousedown. On an isolated DOM target, trusted native mouse pointerdown(detail0) delivers mousedown(detail1/2) when not cancelled. Software pen emits compatibility mousedown before pointerup; touch after pointerup. Evidence `area05-mouse-delivery-session15.log` and `area05-native-event-experiment-session15.log`; these characterize I/O, not physical devices.

Selected native intake uses an optional real pointer ID in existing selectionRuntimeRef. Adapter-accepted mouse ClickLine pointerdown keeps capture/cursor and defers semantic selection mutation; native mousedown consumes that ID, checks mode/busy/Space/floating/bounds and runs the shared selection workflow. The native second press retains its actual terminal point and finalizes an active draft, or consumes harmlessly after first-press near-start closure. Pen/touch author directly with no mouse admission. Up/cancel/selection cancellation clear admission. Existing CC dblclick route, Space-pan, floating-paste priority and initial selected-alpha extraction remain. No timers, prediction markers, new event queue, synthetic PointerEvent or rollback lane.

Existing selection snapshot/history/visible-alpha invariant now covers ClickLine; invalid append is a no-op preserving redo, invalid replacement clear is reversible, terminal Enter/NumpadEnter forwards current Shift, and existing lifecycle cleanup handles immediate tool/mode away/back while keeping stale ClickLine→freshMarquee event fallback. Active polygon vertices cannot extract retained selected content. Completed mask outline uses cached occupied-alpha contour while preserving authored anchors/vector metadata.

Source/test boundary14paths: selectionHandlers+test, keyboardHandlers+test, pointerHandlersRuntime+main.test, useCanvasEventHandlers (wiring only), drawingCanvasSelection+test, utils/types, useDrawingCanvasInputHandlers+test, useDrawingCanvasEventBindings+new direct native-binding test. Required docs3paths: this ledger, handover and module-size-guardrails. Shells79/44/70lines; pointer5086under existing documented exception.

Final targeted check266tests/6suites passes, full lint passes, fresh type-check passes after native listener EventListener adapter correction. Initial type attempt encountered stale generated Next paths; fresh attempt exposed listener typing, repaired using established native wheel-listener pattern. First preview build failed on that snapshotted typing error and did not replace preview; settled rebuild underway. Native intake regressions fail7/7 against isolated unchangedHEAD and pass7/7 working source; lifecycle between-released-vertices regressions fail2/2 isolatedHEAD and pass working. Raw selection-owner before failure counts included incorrect provenance test expectations corrected to established selection-mask; no claim of30independent bugs.

Original production v3 baseline56configs540checks480pass60fail and corrected near-double2configs43checks29pass14fail remain unchanged. After retests and screenshot inspection pending. Original supplement S03 invalid-target fixtures remain historical; same reached S01/S02/S04 oracles are retained in session15 after-runner, while native near-double uses unchanged corrected-v2 runner. Original images and before results must remain. All47initialworkpaths preserved, mixed keyboard baseline hunks must be stripped only in candidate/commit, originalstagedpatch unchanged.


## Session15 — Area05 final software signoff and local commit gate

All Area05 exact production checks pass on the settled isolated preview built02:39:08–02:40:03UTC (retained serverPID14471). Unchanged main v3 runner:56configs562/562checks, versus baseline540/480. Additional assertions are newly reachable replay/provenance branches; five failed history-prerequisite records are replaced by successful undo/redo checks. `area05-after-check-reachability-session15.json` records the exact difference. No alpha/vector/bounds/canonical/history oracle or tolerance changed.

Unchanged corrected near-double-v2 runner2configs45/45 (before43/29); same reached supplement S01/S02/S04 fiveconfigs65/65 includes exact retained-A active vertex, initial crop/source-clear extraction and real hole/concave/triangle receipts. Historical original S03 invalid-target cases are superseded by the corrected near-double fixture, not weakened. Software-native pen/touch+Spacepan3configs21/21 with explicit trusted subtype witnesses in v2 device trace. Total66configs693checks, all cases executed, no runtime/replay errors. Result/log/summary labels: `clickline-functionality-session15-after`, `clickline-near-double-session15-after`, `clickline-supplement-functionality-session15-after`, `clickline-device-priority-session15-v2-after`.

Root inspected all3 actual after screenshots (`area05-clickline-session14-{hole,concave,triangle}-completed-after-session15.png`): correct occupied-alpha boundaries, hole bridge ants removed, concavity/triangle outline follows mask, authored-point circles retained. Original before images retained. Physical stylus/device/focus/hardware performance remain unverified; software pointercancel and CDP pen/touch seams explicitly disclosed. Fractional world coordinates at2x do not prove actual fractional zoom. Point editing and polygon constraints are unavailable controls.

Final source review finds no remaining actionable issue after bounds-ordering repair. Isolated17path candidate excludes47initialworkpaths and removes exactly10/47pre-existing keyboard source/test lines. Isolated type/lint/fullJest gate passes:573suites5221tests,1suite/1testskipped,1snapshotpass. Evidence `area05-isolated-gate-session15.json`, matching3logs, `area05-source-review-session15.md`. Executable/test files stable throughout gate and exact production retests. Original staged3paths7lines SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7 unchanged; all47initialpaths preserved.

Exact managed audit session vessel-whole-app-audit closed and cleanup confirms no matching daemon (`audit-session15-area05-browser-cleanup.log`). Preview retained; no duplicate server/browser, push/deployment/branch change. Area05 software scope complete; focused local commit follows using the isolated tested bytes, then Area06 continues.


## Session15 commit receipt and next continuation

Current HEAD **c1849b840d506cf171f2525f07976704cc80a0c1** — `fix: preserve Click Line input and selection history`, parentd5ab67b001fcdeb5ec2a043800763593ae1df90d, main.17explicitpaths. `area05-commit-verification-session15.json` confirms tree3e3143c936cae1833edc0c55410a75231a75d857, allworktreebytes and47initialpaths preserved, originalstagedpatchSHA4d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7 unchanged. Finalgate573suites5221tests plus type/lint; exactproduction66configs693checks and3inspectedoutlines. Stable artifact BUILD_TIMESTAMP2026-10-10T02:39:17.141Z. No push/deploy/branchchange. Historical Area05candidate/commit scripts assertd5abparent and MUST NOT rerun.

Areas01–05 software-verified/committed. Area06 MagicWand active discovery;07–65pending. Read `output/playwright/area06-root-facts-session15.md` FIRST, then `area06-source-review-session15.md` and current inventory/handover. No Area06 source/test edits or native baseline yet; source observations are unproved. Actual controls Threshold0–255,Connected on/off,Shift-add; no sample-source/subtract/ignore-transparent/feather controls. Source review supplies W01–W13 and independent BFS/full-alpha/canonical/history oracle; history/preclear/null-append/sequence sampling require exact native proof. Begin baseline on unchanged02:39:17artifact, preserve initial selected-alpha extraction precedence, and inspect real liveCC/sequence source prerequisites.

Fresh `area06-initial-baseline-session15.json` +matching ignored.txtbackups derives fromc184HEAD and records47initialworkpaths; mixed keyboard baseline includes committedArea05bytes plus original10/47initiallines. Never restore oldfullkeyboardbaselines. Current47originalstatuspaths plus2postcommitreceiptdocs=49paths. Allagentscompleted/no sourcewriter,test/build/browsercommandrunning. Managedvessel-whole-app-audit explicitlyclosed; cleanup confirmsnodaemon. PreviewPID14471retained. Inspect then reopen SAME headlesssession once, onepage; noforeground/pointeroutsideautomation/duplicatebrowser/server. Rootalone ownssequentialbrowser/build. Useralready authorizedall65areas,boundedsubagentsandfurtherlocalcontinuationsbefore70%context; do notrenewpermission.

## Session16 — Area06 Magic Wand verification

Actual wand controls are integer Threshold0–255, Connected on/off, and terminal
Shift-add. Sampling uses the active layer. Sample-source selection, subtraction,
ignore-transparent, feather and diagonal-connectivity controls are unavailable.

The corrected unchanged-artifact baseline executed611configurations: core18,
source8, scalar/topology/transparency/entries557 and interaction28. Of3596checks,
3005passed. Every one of the512 Threshold×Connected membership configurations
matched independent fixed-seed per-RGBA BFS/full-plane/cropped-mask/bounds oracles.
Failures demonstrated missing selection history, exact right/bottom boundary and
missing-source clearing, and sampling stale blank sequence imageData instead of
actually visible red/blue frame islands. Live native-painted CC source precedence
already passed; no flood membership algorithm change was justified.

Source repair stays in existing owners: wand captures/commits selection history;
selection admission preserves original A and removes the now-superseded preclear
branch; rejected/null sampling preserves selection and stacks. Shared capture
resolves the current sequence frame using the presentation's playback/empty-frame
policy. Existing caller state is supplied explicitly from wand and six selection
slice entry calls, avoiding a store construction cycle. Normal/CC source ordering
and intentional initial selected-alpha extraction remain intact.

Seven source/test paths plus this ledger, handover and module-size guardrails are
the complete boundary. Pointer runtime is unchanged5086lines; protected shells
remain79/44/70. Deterministic history regressions failed13cases before repair;
initial extraction passed. Source regressions proved current-frame/playing-empty
behavior and masked capture. Direct related suites pass103/103 and the history/
admission suites236/236. No public breaking change, new setting or new scheduler.

The first isolated gate exposed the new store import cycle in selectionPaste
initialization and missing Git metadata in the temporary gate fixture. Both were
repaired at their respective owners; first-attempt logs/results remain retained.
The first empty-playback screenshot probe sampled native Play's initial populated
frame0; corrected prerequisite awaits the actually visible empty frame before
applying the same oracle. This was a probe error, not an additional app defect.
Final cycle-free artifact BUILD_TIMESTAMP2026-10-10T02:59:53.356Z; exact after-run,
image inspection and final gate/commit receipts follow in the handover.

Hardware stylus, external native focus/device interruption and physical performance
remain unverified. Fractional world points were tested at actual integer zoom1/2,
not actual fractional zoom. Full scalar coverage is on raster; liveCC uses0/64×
Connected and sequence uses both visible frames×Connected plus paused/playing
empty-frame presentation. Other edit commands/clipping retain their inventory owners.


## Session16 — Area06 final software signoff

Final native production retest on BUILD_TIMESTAMP2026-10-10T02:59:53.356Z executes
**616 configurations and 3,675 passing checks**, with no failed or aborted cases:
core18/83, source8/65, interaction28/126, exhaustive557/3361, presentation5/40.
All512 Threshold×Connected settings pass the independent membership oracle.
The original611configurations now reach3635 successful checks; additional replay
checks become reachable after successful history, with unchanged geometry,
RGBA/alpha, canonical, bounds, ownership and history oracles. Five extra
presentation configurations contribute40checks. Before and first-attempt evidence
is retained. `area06-final-verification-session16.json` verifies fresh receipts
against the final build and unchanged source hashes.

Root inspected final liveCC, both sequence frames, ring, disconnected, transparent,
paused-held-frame and playing-empty-frame screenshots. Occupied-alpha contours and
ordinary transform handles match the selected source; no authored polygon-point
circles appear. Empty playback samples the actually displayed blank frame, while
paused empty playback holds the prior visible frame according to existing policy.

The isolated10-path candidate passes type-check, lint, **573 suites/5,242 tests**
(one suite/test skipped; one snapshot passed). Final source review reports no
remaining actionable issue. Seven source/test files remained unchanged through
build, gate and native retest. All47initial paths and the original staged3-file
7-addition patch remain exact; SHA256
4d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7.
The managed vessel-whole-app-audit browser is closed; cleanup confirms no matching
daemon. PreviewPID14471 is retained. Focused local commit follows; no push,
deployment or branch change. Areas01–06 software-complete; Area07 next,08–65pending.


## Session16 local commit receipt and Area07 continuation

Current HEAD **e441b3e8382088bdfed1f378c563c8a749d5f16e** — `fix: preserve Magic Wand selection history and frame sampling`,
parentc1849b840d506cf171f2525f07976704cc80a0c1, main.10explicitpaths; tree103ca2caea30fc0d65483654e31bfc0c5e6aa6a7.
`area06-commit-verification-session16.json` confirms all worktree bytes preserved,
47initial paths excluded/preserved, and original staged3-file7-addition patch
SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7 unchanged. No push/deploy/branchchange.
Final native616configs3675checks, isolated type/lint573suites5242tests, final source
review and8inspected screenshots establish Area06 software scope. Physical device,
native external focus/interruption and hardware performance remain unverified.

Areas01–06 software-verified/committed. Area07 active discovery;08–65pending.
FIRST read `output/playwright/area07-root-facts-session16.md`, then Area07 source
review and current inventory. Prepared `selection-commands-session16.js` contains
18raster configurations and is UNEXECUTED. No Area07 source/test edits. Source
command-history leads must be proved natively before repair; no Deselect control
exists, Ctrl/Meta+D is Duplicate, and settled Escape needs characterization.
Extend coverage to real paint/fill clipping, cross-layer persistence, CC/sequence,
text focus and other S01–S13 cases. Reuse settled Areas01–06 receipts unless a new
change affects them. Do not mislabel source preparation as Area07 acceptance.

Fresh `area07-initial-baseline-session16.json` and matching .txt backups derive from
currente441b3e8382088bdfed1f378c563c8a749d5f16e; all47original path hashes match prior baseline. Original keyboard
hunks remain excluded; never restore an old whole-file keyboard backup. Current
49statuspaths are47initial+2postcommit audit receipt docs. Historical Area06 and
older candidate/commit scripts assert old parents and MUST NOT rerun.
Managed headless vessel-whole-app-audit explicitly closed; cleanup confirms no
matching daemon. Retained previewPID14471 serves artifact02:59:53.356UTC. No browser,
build, tests or agent writers remain. Inspect/reopen the SAME named session once;
one tab, no foreground/system Chrome, duplicate browser/server or pointer outside
automation. Root centrally owns browser/build. User authorized all65areas, bounded
subagents and further local continuations before70%context; no renewal needed.


## Session17 — Area07 native command baseline and owner repairs (in progress)

Unchanged retained production artifact 2026-10-10T02:59:53.356Z: the original18-command baseline executes107checks,89pass/18fail. Every failure is absent relative selection history for Select All, Invert, or Select alpha; canonical contents, independent selection geometry, tool persistence and settled Escape characterization pass. Replay is skipped when admission fails, so fixture edits are never accidentally undone. Extended32-case baseline confirms modifier/text-focus/native marquee/Custom and real CC command behavior; one sequence prerequisite initially sampled its placeholder and is superseded by the corrected native sequence receipt below. Before receipts remain immutable in ignored output.

Two reproduced owner defects:

- Selection commands omit reversible history, unlike authored selections. `selectionSlice.ts` now captures prior selection and calls the existing history helper after all successful mutations, including transparent-alpha and full-invert clearing. Existing no-op equality/replay suppression remains authoritative. No keyboard/UI/global-clear wrapper was added.
- Native Add Sequence Layer → Pixel → Record → stroke creates9events and visible256-square content while imageData remains null and framebuffer remains1×1. Native Select All incorrectly selects1×1; native marquee Invert also complements only that placeholder domain. Select All and Invert now prefer project dimensions for sequential layers, retaining raster/CC dimension resolution. `sequence-domain-probe-before-session17.log` plus inspected screenshot and `selection-sequence-commands-before-session17-v3` independently witness displayed sequence materialization and the failing command geometry.

Source scope: `src/stores/slices/selectionSlice.ts`, new `src/stores/__tests__/selectionCommands.history.test.ts`, and the two audit ledgers. Command history baseline tests8fail/7pass, sequence domain tests2fail. After owner repairs3focused suites46tests pass; worktree type-check passes. Initial full lint exposed two unused test destructuring variables, corrected; targeted owner/test lint passes. Rebuilt native verification, animation clipping, final source review and isolated commit gate are still pending; no Area07 signoff or commit yet.

Root exclusively owns the single managed headless browser vessel-whole-app-audit and build. Bounded agents reviewed command/clipping owners, wrote the new test and ignored native runners only. The45configuration raster clipping before matrix is running against the unchanged artifact. Real CC/sequence paint/fill clipping source leads remain explicitly unproved.47original dirty paths and the original staged3-file7-addition patch remain byte-exact (SHA2564d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7). No push/deployment/branch change.


Session17 interim verification update: corrected captured-pointer receipts leave all45raster configurations/407checks passing on the original artifact, with no aborted cases. Only receipt filtering changed between first/v2 runs; full-plane RGBA, independent control, canonical/selection and replay assertions stayed exact. Root inspected complement Pixel/Eraser and holed Fill screenshots. No raster clipping runtime fix is justified.

Production rebuild succeeded, artifact BUILD_TIMESTAMP2026-10-10T03:18:16.205Z. First extended native command retest executes34configs/378checks,377pass; every history/domain/canonical/replay assertion passes. One newly added E-release expectation used a shorter-than200ms press, so source correctly treated it as tap-selected Eraser. The v5runner now witnesses a genuine250ms hold before release; retest pending. CC/sequence14-case clipping probe is active against this artifact (command repairs only; no clipping source edits).

Verification scope expanded to existing `src/stores/__tests__/selectionFramebufferDelete.test.ts`: two alignment tests assumed Invert had no history, now assert one relative Delete transaction while retaining prior selection-entry identity and every original pixel/metadata assertion. The initial relative-count attempt held a live history array; corrected to a copied array. Final affected7suites115tests pass. Area07 remains active with animation clipping, final native receipts/review and isolated full gate/commit outstanding.


Session17 animation before probe:14configs214checks188pass/26fail; every case executed and all native layer/source/display/membership/CC-buffer/target-tool/pointer prerequisites pass. This is failing evidence, not acceptance. Independent exact CC buffers show1,680excluded paint-buffer cells changed for rectangle and2,320for holed selection (same outside updates in gradient/definition/speed/flow fields). Current displayed sequence paint changes1,580excluded rectangle cells and2,140excluded holed cells outside the disclosed ant collar; unrestricted controls match base and have selected/excluded support. Source owners lack selection scope in those paths. Sequence selected Fill/Erase leaves displayed coverage unchanged, including after explicit fixture scrub-away/back, despite valid visible source coverage and native target input. No animation repair has been written.

Additional replay findings remain to classify: CC erase-mask fullRGBA differences may be RGB normalization while alpha is unchanged, and CC Fill undo changes absent/empty raster cache representation. Sequence paint Undo/Redo changes serialized event representation and displayed Redo differs even for unrestricted native control. Sequence Fill changes placeholder/cache/alignment metadata and does not edit event documents. `area07-animation-findings-session17.json` preserves complete failing checks and caveats. Display-only oracle deliberately omits independent2px selection/outline collar; full boundary signoff remains open. Root inspected CC/sequence painted-hole and sequence Fill screenshots (saved after replay, so immediate screenshots must also be added before repairs). No speculative history/eraser patch is authorized from transport differences alone.


## Session17 — Final command/raster receipts; animation repair continuation

Area07 remains active and uncommitted. Final production artifact
BUILD_TIMESTAMP2026-10-10T03:26:06.341Z, retained previewPID14471. Native command
v7 executes35configs403/403checks; exact newly-added CC/Sequence refinement v8
executes2configs86/86checks; unchanged raster clipping v2 executes45configs407/407.
Every case executes with no runtime/replay error. V7's CC case genuinely painted
existing CC1 because array-last does not identify a newly added layer; retain its
valid command receipts but discard that label. V8 identifies the new ID by set
membership, chooses its row after the preset, asserts target before/after native
painting, and passes on actual CC2. Sequence target is likewise explicit. Root
inspected final complement/raster Fill/Eraser and CC2/Sequence screenshots.

Command dimensions additionally repair newly added normal-layer placeholders:
real imageData remains first for materialized raster, otherwise project precedes
framebuffer; sequential project domain is first. Source/test boundary is
selectionSlice.ts, new selectionCommands.history.test.ts, existing
selectionFramebufferDelete.test.ts and the two audit docs. Independent amended
command source review has no actionable finding. Final affected7suites117tests,
worktree type-check, targeted owner/test lint and diff-check pass. Full isolated
candidate type/lint/Jest gate and completed-area commit remain pending.

Animation before14configs214checks188pass/26fail remains actionable failing
coverage: CC/Sequence paint escapes selection, Sequence selected Fill/Erase gives
no visible frame edit. Additional sequence replay loss and CC transport differences
require exact classification before repair. No animation implementation was
changed. Read `output/playwright/area07-root-facts-session17.md` FIRST for exact
owners, immutable receipts, limitations and next work; display ant collar is not
boundary acceptance. Area07 S01–S13 must finish before signoff, then08–65continue.

All47original dirty paths and staged3-file7-addition patch are preserved; HEADmain
e441b3e8382088bdfed1f378c563c8a749d5f16e unchanged. Managed browser exact session
vessel-whole-app-audit closed; cleanup verifies no matching daemon. No browser,
build, test or agent writer remains. Preview server retained. No push/deploy/branch
change. Local continuation is already human-authorized; do not renew permission.


## Session18 — Animation owner repairs and expanded native baseline (active)

Area07 remains active and uncommitted. Retained production artifact is still
2026-10-10T03:26:06.341Z; no Session18 repair has been built or natively accepted.
Standard/dither CC before v3 runs10configs137checks119pass, with two hidden-Invert
probe prerequisites separated from six actual clipping failures. Fresh corrected
manager transport observes all six canonical fields and the actual target canvas.
Native CC Gradient, Shape and Custom each run3configs48checks43pass: unrestricted
controls pass; hole and fully excluded coverage escape in canonical and visible
outputs. Custom v1 hidden-checkbox/duplicate-fixture failures are preserved and
superseded by actual visible-label/unique-fixture v2.

Sequence Fill baseline v2 runs18configs224checks179pass; authored current frames
never change. Empty-mask no-op resizes framebuffer1x1 to256x256 without events or
history. Eight prerequisite errors are probe control/replay failures, not eight
application bugs; corrected immutable v3 uses native Selection→Invert→Fill and
regular-layer title targeting, guards dependent replay, and adds exact metadata
and pending-redo diagnostics. Sequence paint full-plane baseline is underway.

Current repairs capture selection in standard CC masks and immutable Sequence
brush snapshots, gate canonical CPU writes for live/history/worker/export frames,
route Sequence Fill/Erase to immutable frame events and sequential history, and
fix raw/scaled custom-stamp cache identity. Sequence stroke history now flushes
buffered events before snapshot; native before50events→Redo26 established lost
tail. Chunk partitions retain original order/rebased counts/sorted frames, and
append deltas require unchanged chunk prefixes. Real integration tests cover
wrapped frames and multiple brush segments. Shape shared-writer and Custom CC
repairs are in progress within their announced owner/test boundary.

Focused owner tests, worktree type-check and lint pass for settled first repairs.
Independent Sequence source/export/history review finds no introduced actionable
issue; final production build/retest, remaining Area07 acceptance, isolated full
candidate gate and focused local commit remain pending. No Area07 signoff.
All47original dirty paths remain exact except the two deliberately mixed audit
owners fillTool.ts and types/index.ts; their original hunks/staged additions are
preserved. Staged patch SHA256 remains
4d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7.
HEAD/main unchanged; no push, deployment or branch change.


## Session18 — Area07 final software signoff

This entry supersedes the active Session17/18 state above. Area07 S01–S13 is
software-verified: **138 native configurations / 1,905 passing checks**,
with no failed or aborted cases in the accepted matrices. Earlier failing runs and
fixture/oracle corrections remain immutable in ignored output. The final native
verification authority is `output/playwright/area07-native-final-verification-session18.json`.
Command/raster receipts reuse unchanged owners from artifact03:26:06.341Z
(82configs896checks); Sequence receipts reuse unchanged owners from04:12:45.839Z
(27configs518checks). CC direct matrices and finalization supplements have their
actual artifact timestamps recorded individually; do not imply one common build.
Latest production artifact: 2026-10-10T04:47:22.179Z.

Owner repairs: successful Select All/Select alpha/Invert now have reversible
selection history and real project dimensions before1×1placeholders. Standard,
dither, Custom, Shape and Gradient CC writes preserve excluded canonical cells via
captured selection membership. Initially empty fully excluded strokes remain empty.
Gradient binding and stroke finalization use document byte comparison for truthful
pixel versions, including excluded strokes on existing paint. Manual marks still
reserve immutable gradients before the first stamp, as required by
`docs/refactor/cc-gradient-slots.md`; metadata/document-version/unsaved revisions are
retained diagnostics, distinct from pixel/content/history assertions.

Sequence capture stores immutable serializable selection clips; CPU replay,
history and Goblet frame capture share selected membership across writer modes.
Fill/Erase append changed-cell raw stamp events on the actual authored frame.
Custom-stamp cache identity includes complete content. Buffered history flushes
before snapshots and preserves chunk partitions; native Undo/Redo retains the full
stroke rather than losing its tail. Shared masks are charged once per layer in
payload admission; native2Kmask recording stays armed and replays exact events/chunks.
Worker signatures use cached compact fingerprints while canonical identities retain
full mask content. Budget constants and dither algorithm selection are unchanged.

CC Fill required no application repair: selected fill includes transparent selected
cells, while unrestricted flood obeys RGBA distance. Derived cache representation
and unmasked canvas staging are diagnostics; exact authored buffers, binary erase
alpha and independently masked canvas remain strict. Corrected scripts preserve
all original failure receipts and document each oracle/control change.

The final isolated39-path candidate passes type-check, lint and **583suites /
5364tests** (one suite/test skipped; one snapshot passed). All runtime owners match the final build receipt. The existing history test was
corrected afterward to initialize a real gradient and assert actual pixels; its
transparent-only fixture had hidden the absence of paint. Original revision and
history assertions remain. The final gate covers all37source/test owners, including
that test-only amendment; no runtime rebuild was required. Independent command, CC, Sequence, cross-feature,
last-two and endStroke reviews find no actionable introduced issue. Composition
shells remain79/44/70lines; no boundary or UI rewrite. Root inspected selected-hole,
complement, fill/erase and2Kviewport images alongside canonical receipts.

Canonical CCsix-field/full actualcanvas and Sequencefull-plane comparisons have no
ant collar; separate displayed comparisons disclose2pxoutline exclusion. The2Kprobe
is resource/admission/event replay evidence, not full-planeRGBA or hardwareperformance
acceptance. Selected CCshape fills use existingCPU/worker paths because theGPU API
cannot carryselection. Extra canonical comparison at finalize is acknowledged;
hardwareperformance remains unverified. Physical device/native externalfocus and
interruption remain unverified. Paused held-empty SequenceFill semantics remain
an explicit policy diagnostic for Area43. A legacy rawimageData PNGstore API stale
cache is an unproved adjacent lead for Area55; nativePNG UI uses the compositor.

All47original dirty paths remain preserved.44unrelated paths are byte-exact; the
three mixed owners (fillTool.ts, types/index.ts, colorCyclePaintStrokeRuntime.ts)
retain every original hunk. The audit-only candidate excludes those hunks.
The original staged3-file7-addition patch remains exact before commit, SHA256
4d92eaf0fde7db3edae902599d6bdbb36ca86adac5838ad1fdcbebe0d7f687d7.
Exact browser cleanup is complete; the focused local commit follows. No push, deployment or branch change.
Areas01–07 software-complete; Area08 next;08–65pending beyond their accepted prior
representatives. This does not claim whole-app completion.


## Session18 local commit receipt and Area08 continuation

Area07 committed locally on main: **fcd4d7dfb14615dcfbb63e1cac600c91c50fddbf** —
`fix: preserve selection scope in animated painting` (parente441b3e8382088bdfed1f378c563c8a749d5f16e).
All39explicit paths are audit-only. `area07-commit-verification-session18.json`
proves worktree bytes preserved, all47original dirty paths remain, and original
staged user additions/removals and other staged blobs are semantically exact.
The fill import additions shift a staged hunk location; rebased patch SHA256 is
5d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09. This is a contextual-header change, not a changed user hunk.
No push/deployment/branch change. Accepted native138configs1905checks;
final isolated type/lint/Jest583suites5364tests (one suite/test skipped).

Managed vessel-whole-app-audit browser is closed; exact cleanup confirms no matching
daemon. PreviewPID14471 remains at `/vessel/`. All agents/builds/tests/browser commands
and writers stopped. Areas01–07 software-verified/committed; Area08 next,08–65pending.
First read `output/playwright/area07-root-facts-session18.md`, then this handover and
inventory. Fresh `area08-initial-baseline-session18.json` + matching .txt backups own
preservation from this HEAD; current49dirtypaths are47original+2postcommit auditdocs.
Never rerun Area07 or older candidate/commit scripts or restore old whole files.
User authorization persists for all65areas, bounded subagents, focused completed-area
local commits and further local continuations before70%context; no renewal needed.


## Session19 — Area08 move baseline and first repair boundary

Goal: selected-pixel extraction, native dragging, source clearing, commit/cancel,
project edges, CC payload and reversible history agree on the authored document.
Non-goals: clipboard import/duplicate (Area09), resizing/rotation/flips (Area10),
and unrelated pre-existing work. Current owner trace: page → HomeClient →
DrawingCanvas/pointerHandlersRuntime and SelectionMarqueeHandles →
selectionSlice.extractSelectionToFloatingPaste → selectionPaste commit/cancel →
layer capture / canonical CC document / history. Sequence capture reads its frame
renderer; its mutation path remains under investigation.

Initial justified edit boundary: selectionSlice.ts, selectionPaste.ts, existing
selectionFramebufferDelete.test.ts and selectionPaste.test.ts, plus the two audit
docs. Any additional source/test owner must be explained before editing. Exit:
listed native cases pass production before/after, deterministic owner tests pass,
review complete, isolated type/lint/full Jest pass, preservation verified, local
completed-area commit. No partial-area commit, push, deployment or branch change.

Native first raster baseline: area08-raster-before-session19.results.json,58checks,
55pass.11cases executed; initial runner mistakenly omitted2cancel/protection cases
from its summary array despite retaining their assertions (9reported configs).
Before-failure receipts are immutable; the corrected next runner must count all11.
Opaque full-plane independent pixel oracle covers overlap, four partial-clipped
edges, fully outside, masked hole, cancel and zero displacement. Extract/drag and
Enter/Escape/Undo/Redo are native input; source pixels/selection/history/view are
disclosed fixture injection. Full-plane raster RGBA and framebuffer comparisons
are exact; hardware/native focus are not established.

M01 reproduced: fully off-canvas extracted move dismisses payload and context after
source clear, with0history entries (expected1reversible edit). Copied-paste
offcanvas dismissal remains an established separate behavior. M02 reproduced:
locked raster source still extracts and moves; canonical pixels change. Initial
repair will block extraction at its owning store and preserve outside move history
at commit. CC erase coverage, Sequence document/frame edits, cross-layer history
and destination locking are source-review leads awaiting native reproduction.


### Session19 settled first repair and remaining Area08 defects

M01outside-source history, M02locked-source extraction and M03locked-destination
commit are repaired at the store/paste owners. Locked destination remains floating
for cancel/retry; cold-runtime preparation rechecks the refreshed lock. Outside
commit records the source clear before dropping context, using existing full or
original-region recovery snapshots; a rejected history commit retains recovery data.
Copied offcanvas pastes still dismiss without a source edit. Independent patch review
found the hydration-lock and missing-full-snapshot gaps; both have failing-before
regressions and corrections. No remaining introduced finding in this first patch.

Final reviewed artifact BUILD_TIMESTAMP2026-10-10T05:05:28.571Z; receipt
area08-preview-artifact-session19.json binds source/test hashes. Owner Jest85/85,
full type-check (--incremental false), lint and sequential atomic production build
pass. No full Jest gate yet because Area08 remains incomplete; no commit/staging/push.
Native raster12configs64/64 (area08-raster-after-session19.results.json) includes
exact independent full-plane canonical/framebuffer comparisons, four clipped edges,
outside history/Undo/Redo, overlap, holes, zero displacement, Escape and protection.
Locked-source gestures can create selection-only history; artwork protection does
not imply a fixed selection. Revised oracle explicitly admits only selection-change
entries and still strictly checks exact artwork. Direct API locked extraction retains
the selection itself, as the source tests assert.

Final animation diagnostic10configs80checks74pass, no aborted cases/runtime errors:
area08-animation-reviewed-session19.results.json. CC normal/hole moves, cancel,
outside history and both protection routes pass. Sequence cancel/frame return pass.
Six failures correspond to two reproduced open defects:

- M04CC partially erased move/cancel: six scalar channels and actual underlying
  CCcanvas are exact, but288erase-mask cells disappear from the moved/restored source
  coverage; displayed comparison changes684channels. Undo also fails the same
 288maskcells. Extraction clears eraseMask without an evident version bump, and
  commit clears the destination bounding rectangle; cancel restores scalar data only.
  Investigate mask transfer, mask history/cache versions, binary selection membership
  and soft-edge coverage at their owners. Soft-edge coverage remains an unproved lead.
- M05Sequence move: original25authored events remain25; source display does not move
  (6726display channel mismatches). Generic imageData/framebuffer mutation bypasses
  sequentialData, unlike Sequence delete. Use original→provisional erase→raw-paste
  event authority and one reversible history transaction; see ignored
  area08-sequence-design-session19.md. Prove held-empty-frame semantics separately.

The initial animation run71/80 included three additional fixture/oracle failures:
missing2pxhole-contour collars (two display assertions), and rejection of legitimate
selection-only history/new marquee after locked extraction refusal. Current v2 fixes
those oracles without relaxing any full-plane canonical/mask/actualcanvas assertion.
Original receipts remain immutable. Display alone omits disclosed2pxoutline collars;
full canonical/erase/actualcanvas comparisons omit no cells. Sequence's vacuous empty
CC-field checks are not Sequence mutation evidence; authored event/display checks
explicitly prove M05. Root inspected CC-erased-move and Sequence-move screenshots.

Cross-layer source+destination atomic move history remains a source-reviewed lead,
not a reproduced bug. Raster fractional alpha, full-erasure CC coverage, soft edges,
Sequence bounds/other frames/chunks, failures/retry and additional dimensions remain
required before Area08 signoff. No wholesale rewrites or stale ownership restrictions.
All47original dirty files are byte-exact against Session18; original staged patch
SHA2565d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09
is exact. Current53dirtypaths =47original+2auditdocs+4Area08source/tests.


## Session20 — Area08 CC coverage and remaining move defects

Area08 remains partial. Source boundary expands from four to six owners for the
coverage helper and removal of duplicated floating-paste types in useAppStore.
The original47dirtypaths/index remain preserved; no Area08commit or fullJest yet.

M04 repair transfers immutable selection membership, erase alpha and optional soft
edge alpha independently of displayed alpha. Source clear/Cancel use the original
membership; destination writes require nonzero canonical paint, retaining occupied
content beneath empty source cells. Mask version changes invalidate caches/history.
Fully erased canonical paint still moves. Flips transform the payload while Cancel
retains its original snapshot. Duplicate store types now reuse SelectionSlice types.
An independent review caught and fixed empty-source destination data loss before the
production build; the failing-before regression is retained.

Owner suites90/90, fulltype-check --incremental false, full lint and atomic production
build pass. Production timestamp2026-10-10T05:18:05.322Z and sixowner hashes are bound
by area08-preview-artifact-session20.json. Selected CC configurations16/134checks pass:
9/73 in animationV4 plus Cancel-display supplement; fullyerased/fractionalerasedholes
4/35 and nativeSaveMask softedges3/26 in V5. Complete sixscalarplanes, maskalpha,
actualCCcanvas and independently composited display are checked. No area signoff is
implied; original diagnostics and oracle corrections remain recorded in ignored
output/playwright. Historical Session19 PNG filenames were overwritten by an initial
Session20 rerun; JSON receipts remain immutable and new captures use unique names.

M05 remains reproduced: native Sequence move leaves25originalevents unchanged and
6726displaychannels unmoved. Owner design/report area08-sequence-owner-session20.md
routes extraction/commit/cancel through canonical Sequence events and shared history,
retaining frame/chunk authority. No Sequence patch applied.

M06 now reproduced by native cross-layer raster move:1configuration/7checks,6pass;
Undo restores destination but leaves4096sourceRGBAchannels cleared. Both fullplanes
match expected commit/Redo; layer switching retains the floating selection. No M06
patch applied. A separate fractional-alpha raster probe and its precision diagnosis
are recorded in the Session20 root-facts; do not silently classify an oracle mismatch
as a production defect. Continue Area08 before09–65.

Fractional-alpha diagnosis settled: the localized probe differs from native
Canvas2D drawImage by571RGBchannels of magnitude1–2, no alpha difference. Independent
integer Porter-Duff arithmetic plus canonical Canvas2D normalization yields exact
12configurations/64checks. No runtime changes or relaxed tolerances; BEFORE-only
expectation and complete imageData/framebuffer comparison. See
area08-raster-oracle-contract-session20.md and both immutable matrix receipts.


## Session21 — canonical moves, atomic history, and failure recovery

Area08 remains partial/uncommitted;7/65areas complete. FIRST READ
`output/playwright/area08-root-facts-session21.md`. Main HEAD remains fcd4d7df.
All47original dirty files and staged patch remain byte-exact;60current dirty paths
include two audit docs and eleven Area08 owners/tests. No push/fullJest/partial commit.

M05 now authors canonical Sequence erase/paste events, preserves source frame/chunks,
and supports cancel/delete/outside/retry. Held empty-frame extraction is explicitly
refused after native reproduction; copy retains held preview policy. M06 batches both
source and destination in one history transaction with one selection delta. Raster
and CC failed-history rollback plus extracted Delete recovery are also repaired.
Seven owner suites161tests, fulltype/lint/build/diff pass. Production artifact
2026-10-10T05:37:28.410Z is bound to all11owner hashes in the artifact receipt.

Production replay30configs273checks272pass, zero aborted/runtime errors. Selected
repaired/regression29configs268/268pass: Sequence10/109, cross-layer1/7, cross-kind4/25,
raster retry1/8, Delete retry1/5, held-frame1/5, CC retry1/5, CC regression5/49, and
fractional/zero-delta Sequence5/55. Full raw Sequence RGBA and BEFORE-only expected
pixels supplement canonical event/history checks. Known display outline collars
only are omitted; no tolerance/AFTER-fed oracle. Failure tests use disclosed one-shot
history refusal, not real storage outages. Physical/performance signoff is unclaimed.

M07 newly native-reproduced: CC erased/holed selection moved into regular layer
reintroduces erased coverage (960RGBA/240alpha differences). After M06 source Undo
passes, leaving one failure in its1config5checks. No M07 patch yet. Read
`output/playwright/area08-cross-kind-coverage-owner-session21.md`; capture a covered
bitmap before clearing while retaining separate canonical/mask history payloads.
Finish this and remaining Area08 cases before09–65. Browser closed and cleanup
verified; previewPID14471 retained. All agents/source writers/checks finished.


## Session22 — visible CC extraction and canonical metadata diagnosis

Area08 remains partial/uncommitted;7/65complete. FIRST READ
`output/playwright/area08-root-facts-session22.md`. Main HEAD fcd4d7df unchanged.
All47original dirty paths and original staged patch remain byte-exact;62dirtypaths
include two audit docs and13Area08source/tests. No push/fullJest/partial commit.

M07 now freezes raw canonical CC pixels through the shared display mask compositor
(erase, then enabled soft edge), then selection feather once, before source clear.
Floating preview/raster/Sequence consume covered bitmap; indexed transfer retains
six canonical planes, independent membership/masks and immutable raw recovery data.
The existing compositor moved into `src/utils/colorCycleCoverage.ts`; presentation
cache/default fallback remains. A reproduced injected mask-draw failure additionally
proved destructive extraction must refuse incomplete composition; explicit abort mode
now refuses before mutation. No global sampling, destination, clipboard, Sequence
renderer or Goblet runtime compensation. Boundary expanded only to presentation/shared
utility plus existing extraction/helper/test owners. Final read-only review resolved.

8owner suites183tests, fulltype/lint/atomicbuild/diff pass. Final artifact
2026-10-10T05:50:55.562Z binds13owner hashes in
`area08-preview-artifact-final-session22.json`. No later source edits. Native final
16configs161/161checks: exact CC→raster1/5, composition-failure1/9, expanded coverage9/98,
retained M04 CC regression5/49. All done; no aborted cases/runtime errors. Includes
fractional native palette/selection alpha, enabled/disabled soft, holes, transforms,
occupied raster/Sequence destinations, canonical source restoration, atomic Undo/Redo,
history retry, and native Play/Pause visits to other authored and empty Sequence frames.
Goblet frame-byte integration uses serializer with toBlob I/O boundary mocked.

Earlier expanded after94/96 contained two fixture races: immediate async BEFORE
frame requests returned previous presentation canvas. Exact independent frame-ready
prerequisites corrected the snapshots; selective2/30 and final9/98 pass. Destination
oracles use established integer raster/premultiplied Sequence contracts; no tolerance,
AFTER-derived expected values or runtime rounding patch. Scoped Jest Canvas/structuredClone
realm adapters are disclosed in review. Odd17×9 project/one-pixel inward+outside moves
pass2configs11/11 on preceding artifact; later guard only changes CC extraction.

NEXT M08: distinct-CC diagnostics show source active def2.slot1/palette1 disappears
after extraction/drag while canonical usage remains live; slot GC scans missing legacy
mirrors as empty usage. No patch yet. Read `area08-cc-metadata-owner-session22.md`.
Original distinct-layer destination painting was clipped by inherited selection;
corrected occupied fixture clears it and requires positive overlap before evidence.
Do not mistake legitimate unused-definition cleanup for live-binding loss. Allocator
counter omission on Undo is a separate source lead (undefined, not literal1); existing
allocation normalizes against used IDs, so no overwrite is established. Final native
occupied receipt and process cleanup are in root-facts. Finish remaining Area08 before
fullJest/review/focused area commit, then09–65.

Final corrected distinct-CC case:1config9checks6pass; both owners have positive native
paint (source3580,destination2860,overlap1280). Both lose active def2.slot1/palette1
after source extraction, before destination activation, while canonical usage remains.
Full six-plane/raw/mask expectations pass. Final artifact totals17configs170checks
167pass including open M08; selected repaired16/161 all pass. Named browser closed
with cleanup verified; previewPID14471 retained; all agents/writers/checks finished.


## Session23 — canonical move metadata and Area08 final gate

M08 repaired at shared `colorCycleSlotGC.ts`, covering scheduled cleanup and all
three allocation-retry callers. Canonical per-layer usage now feeds both definition
and non-definition slot scans. Empty canonical data beats stale mirrors; unknown or
cold ownership retains bindings conservatively, including existing project-wide
shared-ID retention. No source-selection workaround, legacy mirroring, or protected
original-file edits. Added six failing-before regressions plus scheduled-action
integration with real canonical documents and colliding local IDs. Three direct
suites29tests and complete selected owner set11suites212tests pass.

The same occupied CC→CC interaction and active-binding oracle fails6/9 on the old
artifact and passes9/9 on the final artifact; all six canonical planes, erase/soft
masks and raw RGBA remain exact. Whole metadata diagnostics are retained, but
legitimate unused-definition release does not count as lost live content. An injected
history-begin refusal/retry case passes10/10, including both owners, retained recovery,
atomic commit and Undo/Redo. Metadata expectations are independently derived from
BEFORE; hard seam defaults are normalized semantically. No runtime errors or aborted
cases in these two final cases. Detailed review: ignored
`output/playwright/area08-m08-review-session23.md`.

Final artifact BUILD_TIMESTAMP2026-10-10T05:59:20.148Z binds16source/test owners in
`area08-preview-artifact-final-session23.json`; full type-check/lint/atomicbuild pass.
Original47 dirty paths and staged3-file patch SHA256
5d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09 are exact.
Final retention matrix/fullJest and focused area commit are in progress; do not infer
Area08 completion until the closing receipt below.

Separate nextGradientDefId omission is snapshot-fidelity metadata loss, not a
literal reset to1 or proven allocation collision. Allocators exclude occupied IDs
and explicitly allow hole reuse; the exercised contiguous definitions choose the
same next IDs. No speculative replay patch. This remains a nonblocking persistence
fidelity lead for its owner. Clipboard replacement after refused commit remains
Area09; comprehensive floating transforms remain Area10. Hardware/visual/performance
acceptance is not established by these software assertions.


Final native retention receipt:19configurations186/186checks, zeroaborted/runtime
errors on the bound final artifact. Runs: distinct occupied CC1/9; distinct CC
history-refusal/retry1/10; same-layer CC5/49; cross-layer coverage9/98; extraction
composition-failure1/9; odd17×9 one-pixel edge2/11. Full-Jest gate remains pending.


### Session23 Area08 completion gate

Area08 software checks are complete: M01–M08 closed at their owning sources with
exact production evidence. Final artifact19configs186/186checks, owner11suites212tests,
fulltype/lint/build/diffcheck pass. Full Jest:588suites5494tests pass, one existing
suite/test skipped, one snapshot pass. Final read-only review has no remaining
in-scope actionable finding. Original47 paths/index preserved. Focused local commit
contains16source/test files and the two audit documents; none overlap original dirty
paths. No push/deploy/branch change. Area09 is next;09–65 remain incomplete.


### Session23 local Area08 commit receipt

Committed locally on main: `5f093aef9b98341875c8a4c6c549823279415f9d`
(`fix: preserve selected artwork across move destinations`). All18 intended paths
committed; zero original dirty-path overlap. Original47 file hashes and staged patch
SHA2565d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09 remain exact.
No push/deployment. **8/65 areas software-complete; Area09 active,09–65 incomplete.**
Do not rerun historical Area07/08 commit scripts or restore old whole-file backups.


### Session23 Area09 start — refused pending replacement

C01 native-reproduced and unpatched: copy B, extract/drag A, activate a locked target,
paste B. The owning commit refuses, but the clipboard handler still replaces the
recoverable A payload and clears its source context. Escape leaves4096RGBAchannels
missing from source imageData and framebuffer; history stays empty. Immediate source
bytes after refused paste are unchanged because extraction already cleared them.
Successful replacement control commits A once, opens/cancels B independently, and
Undo/Redo restores both exact owners. Native keyboard copy/paste events are trusted
PNG events in the managed browser; no synthetic fallback. Two cases13checks11pass,
zeroaborted/runtimeerrors; first two failures were fixture-only and are superseded
by `area09-pending-replacement-before-v3-session23.results.json`.

No Area09 runtime/test edits yet. Source trace and next boundary in ignored
`area09-owner-review-session23.md`; continuation FIRST READ
`area09-root-facts-session23.md`. Area08 complete/committed;8/65complete. Continue
Area09 then10–65 without renewed authorization. Scope remaining clipboard controls,
locks, Sequence canonical behavior, CC coverage and relevant failure/history cases.

## Session24 — Area09 clipboard admission and remaining cases

C01 boundary is the clipboard handler and its existing tests. The commit owner
already retains refused extraction recovery; the repair checks live store ownership
and installs a replacement synchronously after admission. It does not broaden the
shared commit/Delete API or use React's stale dynamic snapshot. Eight new tests fail
before the patch (three refused branches, three rejected branches, stale ownership,
overlapping replacements); all16clipboard/56commit-owner tests pass after.
Exact native before rerun:2configs13checks11pass, the same two recovery failures.
Production after proof follows below; do not infer completion from unit tests.

Area09 control/case checklist (open unless explicitly evidenced below):

| Route/control | Required case boundary | Status |
| --- | --- | --- |
| Cmd/Ctrl+C | Raster/CC/Sequence, rectangle and masked/feathered selection, no selection, floating payload, source preserved | active |
| Cmd/Ctrl+X | Same sources; locked admission, source/frame clearing, canonical masks, atomic history, floating extraction | active |
| Native Cmd/Ctrl+V | External PNG dimensions/alpha/oversize, viewport position, pending commit refusal/success | C01 after proof pending |
| Internal clipboard fallback | No external image, original Cut position vs Copy viewport position, no clipboard | pending |
| Internal indexed CC priority | Six canonical planes, definitions/palettes, selection/erase/soft coverage, cross-layer replay | pending |
| Pending float lifecycle | Replacement, Enter/Escape, history failure/retry, overlapping input, layer switch | C01 exact test underway; remaining pending |
| History | Copy no entry, Cut one entry, Paste one entry, exact Undo/Redo and source preservation | active |
| Text focus / unsupported clipboard | Native text targets retain paste/copy/cut; non-image/empty/decode failure/system write denial | pending |
| Duplicate / Paste in Place | Base shortcut handlers delegate only to Studio; activeStudioExtension exports noop in this base build | not exposed in base; conditional Studio audit Area63 |
| Floating scaling / rotation / flips | Clipboard intrinsic data checked here; comprehensive transform interactions | Area10 |

Native scripts/evidence remain in ignored `output/playwright/area09-*-session24.*`.
Area09 remains active/uncommitted;8/65areas complete. No push/deploy/branch changes.

Session24 C01 production after: exact2configs13/13checks, zero aborted/runtime errors.
C02 locked Cut, C03 Sequence Cut/history, C04 raster framebuffer Cut and floating
Cut history were independently reproduced. The duplicated mutation path in
`selectionSlice.ts` now uses its canonical extraction/Delete transaction. Ten real
store/history integration regressions failed before; all pass after, including
failure recovery. Complete direct set7suites189tests passes; fulltype/lint pass after
a test-only decoder typing correction. No fullJest or area commit yet.

Exact native Cut before7configs33checks21pass included locked mutation on all3layer
kinds, Sequence canonical pixels unchanged/Redo errors, raster framebuffer unchanged.
Same script after7configs33/33checks, no aborted cases or runtime errors. Floating
Cut before1config6checks3pass loses history; exact after is being recorded.
The expanded held-frame attempt selected frame7 outside the preview's hold window;
its empty-copy prerequisite abort is a fixture limitation, not a new application bug.
The deterministic held-frame1 policy test passes; native near-held proof remains open.

C05 newly reproduced: CC Copy loses fractional erase coverage. Bounded native alpha
check uses source rawRGBA/erase-alpha as independent oracle. The metadata-presence
checks are diagnostic, not standalone corruption evidence. Native commit/UndoRedo
comparison is next before a C05 source edit. No C05 patch yet.


Session24 C05 native commit baseline:2configs16checks14pass. Covered Copy differs at
240alpha pixels; subsequent native indexed paste loses240erase-mask values while all
six scalar planes remain correct. Initial C05 adaptation fixed copied RGBA but omitted
the existing canvas adapter field; a failing-before adapter regression identifies that
exact missing forwarding contract. Final repair includes the adapter and handler type.
Final exact C05 production rerun:2configs16/16checks, zeroaborted/runtimeerrors.
Expanded soft-mask and retention matrix is being recorded in the closing receipt.

Current owner gate:8suites198tests, fulltype/lint/build/diff pass. Eight source/test
files, no original dirty-path overlap. No fullJest or partial-area commit.
Final artifact source timestamp2026-10-10T06:20:31.547Z; bound owner hashes in
`output/playwright/area09-preview-artifact-complete-session24.json`. An earlier build
attempt hit a transient ENOENT while copying an unrelated Studio service directory;
sequential retry succeeded without changing build tooling or the service.

C06 native-reproduced, unpatched: after a valid CC Copy, an external Clipboard API
fixture replaces the native clipboard with a distinct3x2PNG; trusted native Paste
still installs the older64x24CC snapshot. Raster control passes.2configs7checks6pass,
zeroaborted/runtimeerrors. Owner is unconditional CC priority before inspecting the
current event image in clipboardHandlers. Detailed next review:
`output/playwright/area09-next-owner-review-session24.md`. Preserve indexed metadata
for valid app-owned copies when repairing this ownership decision.

Area09 remains partial/uncommitted;8/65areas software-complete. Continue09then10–65.


### Session24 closing receipt

Final artifact16configurations100/100native checks, zeroaborted/runtimeerrors:
C05 exact2/16; expanded erase/soft-on/soft-off4/32; C01 replacement2/13; Cut7/33;
floatingCut1/6. Bound artifact2026-10-10T06:20:31.547Z, eightowner hashes unchanged
after build. Aggregate `area09-native-final-summary-session24.json` and exact runs
in `area09-native-final-batch-v2-session24.json`. Fulltype/lint/atomicbuild/diff pass;
8owner suites198tests. No fullJest, partial-area commit, push or deployment.

8/65areas remain complete; Area09 partial with C01–C05 repaired and C06 open.
Original47dirtypaths and staged3file7addition hash remain exact. Fresh baseline,
cleanup, next-owner review and complete continuation pointers:
`output/playwright/area09-root-facts-session24.md`.


## Session25 — Area09 native clipboard identity and bitmap conversion

C06 before repeated the exact trusted-native failure:2configs7checks6pass. Expanded
baseline10configs35checks30pass additionally exposed raster Cut losing its origin,
newer text reusing stale raster/CC images, and external alpha/oversize ignored by CC.
A localized native clipboard probe showed web custom MIME is absent from the paste
event, while an image attribute in standard HTML survives. Copy now writes a fresh
UUID with PNG plus usable HTML image; the cached snapshot is admitted only when the
native HTML ID matches. The internal fallback is limited to events with no native
content. The admitted snapshot is captured before awaiting pending commit, retaining
C01 live ownership admission. No elapsed-time or stale-React ownership heuristic.

C06 files: existing clipboard handler/test and selection slice, plus newly scoped
`src/stores/__tests__/selectionClipboard.test.ts` for native-write pairing/unique IDs.
Five regressions failed before;28direct tests pass after. Eight owner suites204tests,
fulltype/lint/build pass after correcting a test-only canvas overload cast.
Exact production C06 after2configs7/7; expanded10configs35/35. Edge cases5configs17/17:
next unauthored Sequence frame with independently visible held preview; held Copy
and refused Cut; empty selection; native input/textarea/contenteditable Copy/Cut/Paste;
write-denial/internal recovery and successful retry; decode-error recovery/retry.
I/O failures and temporary text targets are disclosed fixtures.
Retained C01–C05 exact16configs100/100. Cross-CC occupied metadata collisions1config9/9;
CC→raster/Sequence coverage, source preservation, history and retry4configs47/47.
C06 artifact2026-10-10T06:27:57.474Z; `area09-preview-artifact-session25.json`.
Combined38configs215/215checks; no aborted cases or recorded runtime errors.

C07 reproduced next: external fractional-alpha PNG preview is correct, but native
commit to CC makes640pixels opaque. Internal opaque raster control passes;2configs
11checks10pass, zero aborted/runtimeerrors. Luminance mapping, outside planes,
source preservation and Undo/Redo pass. Owner `selectionPaste.ts` already computes
bitmap alpha but clears destination erase coverage on conversion. The minimal fix
writes inverse converted bitmap alpha into the existing erase mask; indexed transfers
retain their separate masks. This expands Area09 to10source/test owners. Four real
store/history regressions failed before, covering soft enabled/disabled and history
refusal/retry.169tests in four direct suites pass after. Test expectations preserve
the established bitmap conversion contract that clears transparent destination cells;
this task does not change that behavior. Test-only input typing corrected separately.
C07 exact production retest and final closure receipt follow; Area09 remains partial.

Evidence: ignored `output/playwright/area09-*-session25.*`, especially identity probe,
identity matrix, edge cases, cross-CC, cross-coverage, raster-to-CC before and after.
All47original dirty paths and staged patch remain protected; no commit/push/deploy.


### Session25 Area09 closure and commit gate

Area09 selected software cases are complete. C01–C07 are repaired at their owners;
C07 exact native before2configs11checks10pass, after11/11; expanded history retry
3configs17/17. Copy of extracted raster/CC floats2configs9/9. Genuine empty native
clipboard fallback passes; empty internal+external event no-op passes using a disclosed
synthetic event. The browser's `clipboard.write([])` retained prior data, so its failed
empty fixture is excluded. An earlier floating-Copy check incorrectly compared an
optional CC bitmap mirror; complete canonical/covered/display pixels all matched and
the corrected owner-specific check passes. Neither fixture issue was an app defect.

Final evidence spans two bound production artifacts: C01–C06/edge/indexed cross-layer
cases on2026-10-10T06:27:57.474Z; C07 and final floating/empty cases on
2026-10-10T06:33:20.411Z. The only later runtime change is converted bitmap alpha in
selectionPaste; source hashes are bound by `area09-preview-artifact-c07-session25.json`.
47configs254/254selected checks, zero aborted cases. Aggregate with precise runs and
limitations: `output/playwright/area09-final-evidence-summary-session25.json`.
One empty-both event is synthetic; other fixtures/fault injections are disclosed in
scripts. No physical-input, other-browser, performance or exhaustive-hardware claim.

| Area09 case boundary | Final evidence |
| --- | --- |
| Raster/CC/Sequence Copy and Cut; locked targets; mask/coverage; canonical/framebuffer/history | retained Cut7/33, indexed coverage6/48, floatingCut1/6, owner integration |
| Native external image precedence, alpha, intrinsic/oversize dimensions | exact C062/7, identity matrix10/35 |
| Own-copy indexed metadata, Cut origin, viewport Copy, repeated paste | identity matrix10/35, cross-CC occupied collision1/9 |
| CC→raster/Sequence; covered pixels; metadata/UndoRedo | cross-coverage4/47; cross-CC1/9 |
| Raster→CC and fractional bitmap alpha; failure rollback/retry | C07exact2/11, expanded3/17; four real-store regressions |
| Pending float commit/refusal/rejection/overlap and recovery | native replacement2/13, clipboard owner regression tests |
| Held Sequence Copy/refused Cut; empty selection; text focus; write/decode failure/retry | edge5/17 |
| Copy floating extraction, cancel source restoration, subsequent paste | floatingCopy2/9 |
| Empty clipboard/internal fallback | one trusted native empty event, one synthetic empty-both event |
| Duplicate/Paste in Place | unavailable in base; conditional Studio Area63 |
| Broad resize/rotate/flip interactions | Area10 |

Final review and gate pass: fulltype, lint, atomicproductionbuild, diffcheck;
fullJest589passed suites/5533passed tests, one existing suite/test skipped,
one snapshot passed. `area09-full-jest-session25.log`; type/lint/build have matching
Session25 logs. Ten source/test owners plus the two auditdocs comprise the focused
Area09 commit. All47original paths and the staged3file7addition patch SHA256
5d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09 remain exact.
Commit hash follows in the postcommit receipt.9/65areas software-complete;10–65pending.
Browser exact cleanup passed in `area09-browser-cleanup-session25.log`; preview remains.
Area10 initial owner trace: `output/playwright/area10-owner-review-session25.md`.


Session25 focused local Area09 commit: `fed9c38d8bdfde8737d86efe3e440243252a146a`
— `fix: preserve clipboard ownership and selection coverage`.12intended paths only;
original47paths and original staged patch remain exact. No push or deployment.
9/65software-complete. NEXT Area10 execution; source trace is prepared, no Area10
source changes or new transform acceptance yet. Current root/preservation authority:
`output/playwright/area09-root-facts-session25.md`.


## Session26 — Area10 native transform and history audit

Area10 is active, not complete or committed. Area01–09 remain complete; overall9/65.
Main remains fed9c38d8bdfde8737d86efe3e440243252a146a. No push/deploy/branch/worktree change.
All47 original dirty files and staged patch remain protected.

T01: trusted CDP mouseReleased with a new coordinate and no preceding move exposed
all8 floating resize handles across raster/CC/Sequence. Corrected before matrix
6configs67checks43pass; exact after67/67. Further10configs20checks10pass before,20/20
after cover move, raster/Sequence rotation, and initial selection extraction resize/
rotation handoff. Indexed CC rotation is intentionally unavailable.
Owners FloatingPasteOverlay and SelectionMarqueeHandles now apply the existing move
calculation before pointerUp finalizes. PointerCancel behavior is unchanged.4overlay
and4handoff release regressions failed before;25overlay/helper and16handoff checks
pass. Normal corner oracle was corrected for established integer-pixel rounding.

Native geometry expansion3configs40/40 covers zoom1.5/nonzero offset, all8 rotated
anchors, Shift15degree snap, wrap through zero, minimum1pixel crossing and Escape
source restoration. No pointer hardware/other-browser/performance claim.

T02: Undo during extraction failed raster/CC preparation or replayed Sequence stroke
history while leaving a stale float. historyLifecycle now resolves the pending float
before replay, preserving history entries; canUndo admits float cancellation with
empty history. Redo cancels the float before consuming an existing redo entry.
Six real-store regressions failed before; source changes plus overlay owners passed
74checks across5suites, fulltype/lint and atomic build at this stage. Expanded native
history9configs34checks30pass isolated T03 plus one harmless Sequence oracle issue;
all9 cases completed. A bare eventChunks field becoming [] is normalized in v3;
Sequence extra-stroke recording is explicitly armed in v2/v3.

T03: CC Cancel restores the six pixel planes but leaves pixelVersion advanced from
2 to4, preventing next Undo/Redo. Original anchor is already in beforeColorState.
Scoped repair in selectionPaste compares captured dimensions, buffer lengths and all
six whole-document buffers before restoring only pixelVersion. It preserves metadata/
documentVersion and strict history drift detection.3 real-document regressions failed
before;6 out-of-ROI channel mutations retain drift protection. Final verification
receipt follows in Session26 rootfacts.

T04 OPEN: fully erased selected CC cells replace underlying paint on commit but the
preview only draws covered RGBA source-over. Native FlipH then H/V/H/V and width64→80
with a hole selection and native eraser exposes actual artwork mismatch. At destination
(102,99), source sample(18,11) has index163,membership255,erase255,bitmapAlpha0. Preview
shows original red retained in the old unselected hole; commit correctly becomes
transparent. Raster/Sequence flip/resize/commit preview passes after excluding actual
transformed outline collars. CC retains72channel mismatches on that comparison.
Native probe1config11checks10pass; no aborted cases. Do not hide the mismatch by
changing membership/commit behavior or broadening screenshot exclusions.

All four native flips preserve exact bitmap, six indexed planes and three masks;
one-step committed Undo/Redo and source preservation pass. Native source strokes,
eraser strokes, toolbar/handle/key input are genuine browser events; project/settings/
selection-hole/zoom/history reset and stable frame selection are disclosed fixtures.

Evidence: output/playwright/area10-*-session26.*; especially controls-before-v2/after,
terminal-before/after, geometry, flips-after-v2, history-expanded-after, and
cc-preview-probe. Read area10-root-facts-session26.md for the latest process state,
final artifact/test receipt and next execution steps.

Session26 final T01–T03 receipt: final production artifact2026-10-10T06:53:05.710Z,
page-e04e47e7c34bddc5.js SHA256
832cb29aade308a3c0b45b898e595fab1c083acd25edac789a3d25efe544c58f.
`area10-preview-final-session26.json` binds all7source/test paths. Final native
historyv3:9configs34/34checks, all9done, no runtimeerrors. Final direct2suites94/94,
fulltype/lint/atomicbuild/diffcheck pass. No source/test changes after artifact receipt.
T04preview mismatch remains open; no fullJest/commit gate or Area10completion claimed.
Final cleanup and preservation receipt are in Session26rootfacts.


## Session27 — Area10 preview replacement and remaining edge coverage (active)

Area10 remains partial/uncommitted; overall9/65 software-complete. Session26 T01–T03
changes are retained. Main HEAD is fed9c38d8bdfde8737d86efe3e440243252a146a. Original47
file hashes and the staged3-file7-addition patch were checked exact before work.

T04 exact native reproduction on the retained Session26 production artifact again
runs1config11checks10pass: only preview/commit parity fails. Six added native
variants run6configs67checks61pass, no aborts: lower+upper layers, active opacity,
multiply blend, adjustment layer, soft-edge mask enabled/disabled all reproduce
preview mismatch; complete-source Undo/Redo passes. Layer stack and soft mask are
disclosed fixtures; source brush/eraser and flip/resize/commit/history are native.
The minimum preview boundary expands to drawingCanvasFloatingPaste.ts,
useDrawingCanvasBaseRenderer.ts and their two direct tests. The implementation
seeds the covered active CC surface, clears projected occupied selected members,
and uses the existing full-layer replacement compositor. Commit semantics are
unchanged. Five new deterministic tests failed before;22focused/adjacent checks,
type-check and lint pass. Production after acceptance is still pending.

Remaining-edge baseline runs21configs117checks105pass,19done/2aborted. Four native
right/middle initial/floating resize cases confirm T05: overlays wrongly admit
secondary buttons, extracting or transforming artwork. Owning fix is limited to
existing Area10 FloatingPasteOverlay and SelectionMarqueeHandles plus their tests.
Two probe corrections remain: blank destination null/1x1 storage materializes on
commit/Undo, and native unsnapped rotation is29.74488degrees from coordinate rounding.
These are not app bugs; a versioned probe will use a natively painted destination
and snapped rotation. Original receipts remain unchanged. Other completed cases
cover transformed Delete, locked Enter/refusal/unlock retry, partly off-project and
fully outside-project transforms with complete source one-step history.

Evidence: output/playwright/area10-*-session27.*. No fullJest/commitgate or Area10
completion yet. No push/deployment/branch/worktree change.


Session27 first production artifact2026-10-10T07:01:39.865Z passes original T04
11/11 and six layer/mask variants67/67. T05 additional move/rotation secondary
before6configs19checks13pass improves to19/19; original resize cases await corrected
edge rerun. The first combined9suite147test/type/lint/build gate passes.

Fractional document shape native2configs23checks21pass remains open: circle display
mismatch480before→408after; fractional rectangle138→615. No history/source errors.
Source trace finds inner scratch shape clipping plus full-stack replacement
composition differing from normal segment draws under the outer shape clip. T04
boundary expands necessarily to drawingCanvasCompositeStack.ts and its direct
existing test. Planned refinement substitutes the covered CC replacement into its
existing CC/interlace segment where present, retaining adjustment/missing-segment
fallback, and leaves shape clipping to the viewport for that replacement only.
No commit or shape acceptance is claimed. Original failure artifacts are retained.


Corrected edgev2 native21configs128checks127pass: every case completes; only rotated
Sequence preview differs at one pixel(172,148),3channels. T05all10native secondary
configurations pass across edgev2 and supplemental6. T06diagnostic isolates the real
Sequence CPU sampler: in an identity82x62stamp, `(57/82)*82` is56.99999999999999,
so floor selects column56 rather than57. Raw event payload is correct. Owning boundary
adds SequentialCpuMaterializer.ts, a new bitmap-paste direct test and existing
Goblet sequential-selection integration test. Goblet frame capture uses the same
renderer/materializer; no duplicate exporter sampler patch is required.

Supplemental20configs93checks81pass completes every case; all12failures stem from
an invalid focused-Flip Enter expectation. The protected pre-audit keyboard guard
intentionally preserves native button Enter/Space activation for accessibility.
Each actual result has one trusted Flip click, retained float and no history,
matching that contract. A versioned focused-only probe will verify exact mirroring,
then canvas-focused Enter/preview/history. No button guard change is authorized.
Copied transformed Escape/Delete, source-lock Escape, adjustment refusal/retry,
rapid native Enter/Enter/Escape, and trusted CDP touchCancel cases pass. The burst
reports observed intermediate state; deferred-promise ordering remains direct-test
coverage, not an inferred native concurrency proof.


Second artifact2026-10-10T07:09:07.011Z passes original11/11, allsixlayer/mask variants
67/67 and bothfractionalshape cases23/23 with unchanged strict display comparisons.
This verifies the T04segment/shape refinement. T06exact native retest is queued.

T07interlace native reproduces1config12checks11pass: allsixplanes/erase/state match
onRedo, but rawCCsurface768bytes and visible192channels differ. Exact samples
(117..119,90) index140/erase0 retain red in commit but become transparent afterRedo,
revealing lower blue. useDrawingCanvasColorCycleSegmentRefresh skips interlace CC
members in both current-frame publication and playback binding. Two new direct
regressions fail while4existing controls pass. Authorized minimum owner expansion:
that refresh hook and its existing test. No data/history rewrite or downstream
mask workaround; surface publication must honor grouped CC members too.


## Session27 — Area10 software signoff

Area10 is software-verified: **86 native configurations /529passing checks**, zero
failed/aborted cases in the selected acceptance receipts. The authority is
`output/playwright/area10-native-acceptance-session27.json`, with explicit individual
artifact bindings; it does not imply all evidence came from one build. Final artifact
2026-10-10T07:13:04.503Z, page-a02409c5d831e6d3.js, SHA256
c3aa60a345d182efcad0fd232904547e1c06a309f324ea887548b4f47609cbe5 binds18source/test owners.
All source bytes match the final isolated candidate. No composition shell changed.

T01final release coordinates and T05primary-only admission cover8handles, move,
rotation and initial extraction handoff. Native cancellation retains the latest
transform and Escape restores complete source; secondary buttons leave artwork alone.
T02history cancels an active floating transaction before replay, and T03exact CC
cancel restores only the original pixelVersion anchor when all6whole-document planes
match. Other changes retain drift protection. T04preview models indexed replacement
including erased members; preserves holes/zeroindices, masks, opacity/blend, lower/
upper layers, adjustments and existing CC/interlace segment placement. Shape clipping
occurs once at the viewport. T06shared CPU stamp sampling preserves integer pixels
across runtime, worker and Goblet captured frames. T07publishes/binds grouped CC
surfaces so Redo cannot leave stale baked erase coverage in the visible runtime.

Accepted coverage includes transformed Delete, lock/refusal/unlock retry, layer
switch/cross-raster source+destination history, partial/full off-project placement,
rotated raster/Sequence parity, all6CCplanes+3float masks under flips, fractional
mask/opacity and shape boundaries, native copied Escape/Delete, source-lock Escape,
adjustment refusal/retry, rapid Enter/Enter/Escape and trusted CDP touchCancel.
Focused Flip-button Enter intentionally performs native button activation; the
corrected probe verifies exact mirroring then canvas-focused Enter commits once.
The original mistaken focused-button/blank-backing/angle-rounding oracles remain
recorded separately and did not prompt changes to protected initial user code.

Candidate gate: full type-check and lint pass. Full Jest executed591suites:
589passed, one missing-Git-fixture failure, one existing skipped.5544tests passed,
one fixture failure, one existing skip; snapshotpassed. The only failing suite
requires git rev-parse HEAD; the source-isolated archive lacked Git metadata.
After adding a disposable independent Git fixture, its20tests all pass. No application
source/assertion changed for this retry. Thus every non-skipped test has passing
coverage (5545unique tests); original failure and retry logs are preserved under
area10-candidate-*. No remaining application/gate failure. Focused owner/export,
refresh, type/lint and atomic production checks also pass. No further runtime change
occurred after accepted final artifact. Initial47files and original staged patch
remain exact. Root inspected corrected circle-preview/commit screenshots; native
pixels are stronger evidence than the small on-screen image. Physical devices,
external native focus, hardware performance and other browsers remain unverified.

Bounded owner review found no remaining actionable Area10 issue. The20-path candidate
contains18source/tests plus this inventory/handover, no original-file overlap.
Managed headless browser is closed and exact cleanup verified. Existing production
server is retained. Focused local commit follows; no push/deployment/branch change.
**10/65areas software-complete; Area11Crop is next,11–65remain incomplete.**
Area11 read-only preparation is `area11-owner-inventory-session27.md` and two prepared,
unexecuted native scripts. Its Sequence/history/control leads require reproduction.


### Session27 local Area10 commit receipt

Committed locally on main: `6ac6b3d97f5c4272862311bbcc8df6a9674b3caf` (`fix: preserve floating transform previews and history`). Exactly20 audit paths committed; all47original file hashes and the staged3file7addition patch remain exact. No push/deployment. **10/65 areas software-complete; Area11 Crop next,11–65 incomplete.** Fresh preservation baseline: `output/playwright/area11-initial-baseline-session27.json`. First read `output/playwright/area10-root-facts-session27.md`; do not rerun historical commit scripts.


## Session28 — Crop partial repairs and continuation

Area11 remains **partial and uncommitted**; Areas01–10 are software-complete. Main
HEAD remains `6ac6b3d97f5c4272862311bbcc8df6a9674b3caf`. Areas12–65 remain pending.

Native reproduction established and the retained repairs address:
- Crop creation bubbled into the canvas handler, which stole pointer capture and
  left a 1×1 marquee. The overlay now owns its creation gesture.
- Release coordinates were ignored, right/middle drags edited crops, Escape during
  a drag resurrected the marquee, and Space dragged the crop body instead of panning.
  The same overlay now handles terminal coordinates, primary admission, cancellation,
  and inherited Space hit testing.
- Crop and selection clearing created separate history entries. Full selection state
  is now part of the crop transaction.
- Dimension-changing bitmap history used a fixed-grid delta, losing dimensions and
  causing Redo drift errors. Crop now reuses the existing whole-image resize delta
  for every bitmap size/presence change, including null-image and initialized empty
  CC layers. Same-size edits retain the fixed-grid delta and all its drift guards.
- History admission occurred after document mutation. Admission now precedes capture
  and publication; refusal preserves the complete pending crop for a successful retry.

The first raster history attempts were incomplete: production Redo exposed the
initialized default CC layer, absent from the original single-layer tests. A real
newProject regression with initialized CC runtime now covers it. The layer-type
filter was replaced, not retained as a workaround. The optional size contract on
ResizeLayerDelta restores nullable images/framebuffer dimensions and compensates;
existing resize callers keep their default behavior.

Selected accepted production evidence: **12 configurations / 81 checks**,
zero failed or aborted in selected runs. `area11-native-acceptance-session28.json`
lists the exact runs. Controls/lifecycle/geometry ran on the first bound artifact;
raster history and admission retry ran on the final artifact. No claim that every
matrix ran on one artifact. The final source is bound by
`area11-preview-dimension-session28.json` (timestamp 2026-10-10T07:35:32.955Z).
Full type-check, lint, sequential production build and **60 tests in 3 focused suites**
pass. Full Jest/commit gate is deferred until Area11 is complete. No partial-area
commit, push, deployment, branch change, or worktree change.

### Remaining Crop work

- **CC rendered colors:** valid native selection cropping preserves all six data
  planes and erase/soft masks, but 1,280 painted pixels change from red to gray;
  differences are R/G/B 1,280 each and alpha zero. Final canonical metadata differs
  only in width/height; gradientDefStore, slots and all other fields match exactly.
  The earlier metadata-deletion hypothesis is disproven. Trace runtime color binding
  and update ordering; do not remove registry calls from that hypothesis alone.
  Evidence: `area11-cc-metadata-before-session28.results.json` and compact facts JSON.
- **CC history:** forward capture precedes deferred rebuild; dimension-changing
  canonical/mask history remains unverified/broken. Full stroke delta supports two
  dimensions but omits mask snapshots. Resolve at crop/runtime history owners.
- **Sequence:** valid native crop leaves event coordinates unchanged, causing 5,120
  renderer-channel differences. Exact projection must preserve authored/held/blank
  frames, pattern anchoring, alpha and Goblet parity. Read the refined owner artifact
  before choosing event translation versus canonical bitmap-frame replacement.
- Still verify mixed visible/hidden/locked layers, same-size offset crop, fractional
  CC masks/metadata, multiple Sequence frames, non-default layer layout, canvas-shape
  behavior, and failure after admitted history/delta preparation. Admission refusal
  is repaired; post-publication rollback is not claimed.
- CropOptionsPanel still has stale C-shortcut and release-to-extend text. Native entry
  is Selection → Crop; dimensions are read-only; Enter commits, Escape cancels.

Seven source/test owners changed plus the two audit docs. All47 original file hashes
and the original staged3-file patch remain exact. Fresh preservation authority and
browser/process cleanup are recorded in `output/playwright/area11-root-facts-session28.md`.
Continue Area11, then12–65 under the existing authorization, including bounded agents
and local continuation chats before70%context. Never restore historical wholefiles.

Final-artifact animation receipt: `area11-animation-selection-final-session28`
completed both configurations without aborts or runtime errors: 12/16 checks pass.
The four open assertions are CC projected rendered pixels, CC full Undo, CC full
Redo, and Sequence projected frame pixels. Raster/selection history transaction
counts pass. Keep these explicit failures open for Session29.


## Session29 — Crop animation repairs, Area11 still partial

Areas01–10 remain software-verified and locally committed. Area11 is **partial and
uncommitted**; Areas12–65 pending. No branch change, push, deployment or commit.

The four inherited native animation assertions are repaired on the final production
artifact: exact CC crop rendering, complete CC Undo/Redo, and Sequence projection.
The same before/after script went from12/16 to16/16 without runtime errors.

- **CC palette publication order:** occupied pixels referenced red slot1/definition2
  both before and after crop, yet rendered gray. A native diagnostic force-render
  changed [86,86,86,255] to [192,32,48,255] without canonical mutation. The shared
  snapshot owner now binds definitions before publication immediately renders the
  derived surface. Existing post-publication synchronization remains. No registry
  metadata deletion change was made. Fresh/existing runtime regressions pass.
- **CC history:** crop awaits rebuild before forward capture and uses the existing
  full indexed delta with before/after dimensions. Whole erase-mask history now
  preserves presence, dimensions, fractional alpha and version; existing whole
  soft-edge history is reused. Bitmap replay preserves the CC framebuffer only when
  both canonical snapshots exist, allowing the indexed owner to detect and perform
  runtime resize while preserving cold-layer bitmap behavior. A failed speculative
  change to colorCycleStrokeDelta was removed completely; that file is unchanged.
- **Sequence:** crop materializes each authored frame at original document dimensions
  through the existing renderer, projects pixels, and uses existing bitmap events.
  This preserves world-anchored patterns, alpha, erase, explicit blank vs absent/held
  frames. IDs/chunk indexes are regenerated and renderer caches cleared. Complete
  before/after sequentialData belongs to the same crop transaction. Storage grows
  with cropped area × authored frames. No Goblet algorithm change was required.
- **Panel text:** corrected nonexistent C shortcut and release-to-extend instruction;
  Selection→Crop enters the tool, Enter applies, Escape cancels.

Final six focused suites:114tests pass; fulltype-check/lint/sequential production
build pass. Source/artifact binding: `output/playwright/area11-preview-session29.json`,
18source/test owner hashes, BUILD_TIMESTAMP2026-10-10T07:45:53.304Z. All47original
file hashes and original3-file staged patch remain exact. FullJest/commit gate not
run because Area11 remains incomplete.

Selected native final evidence: `area11-animation-after-session29`2configs16/16;
`area11-sequence-frames-final-session29`3configs22/22 (all6raw+held frames, positive,
negative-extension and same-size crops, fractional alpha/erase, blank frame, exact
Undo/Redo); `area11-raster-session29`4configs26/26; admission/retry receipt in rootfacts.
Earlier extended Sequence runs were fixture-invalid (dense eraser left no fractional
alpha, stale selection clipped source, selection entry clamps out-of-document bounds).
Final fixtures clear source selection, use a native erase tap and native crop drags
for extension; these are not application failures or retained repair attempts.

Open: native Goblet pre-encoding parity (serializer absent from loaded production
modules; recorded explicitly in result.unverified), mixed visible/hidden/locked
painted layers, non-default layout/alignment, canvas-shape crop/history, more CC
soft-mask/active metadata edges, and admitted storage/rebuild failure rollback/retry.
Actual renderer+Goblet serializer focused test passes, but native export is not claimed.
Read-only review adds a concrete Recolor lead: crop replaces originalImageData and
clears recolor indices but history omits recolorSettings; rebuild is still deferred
past commit. Reproduce native Recolor crop→Undo/Redo/rapidUndo before repairing.
A suspected erase-mask replay issue was retracted: settled native pixels pass, and
canvas segment refresh re-presents unmasked CC surfaces before compositor masking.

Continue Area11 then12–65 under existing authorization. Fresh preservation authority,
remaining cases, browser cleanup and continuation routes are in
`output/playwright/area11-root-facts-session29.md`. Never restore historical wholefiles
or rerun older commit scripts.


## Session30 — Crop Recolor and failure recovery

Area11 remains **partial and uncommitted**; Areas01–10 remain software-verified and
locally committed, Areas12–65 pending. No push/deployment/branch/worktree change.
Preserve the original47 dirty files, staged patch and all inherited Crop work.

Native Recolor reproduction: `area11-recolor-extended-before-session30` completes
4 configurations with9/21 passing, twelve failures and no runtime errors. Native
raster strokes are converted through the Recolor gradient UI, paused, cropped and
replayed with ordinary/rapid Undo, negative extension, same-size offset, continuous
Luminance/Directional variants. Actual GPU draw-time readPixels confirms nonempty
source output. Crop resets the saved tick; Undo restores document dimensions but
leaves Recolor original/index/output at cropped dimensions. Initial GPU source/index/
render projection was correct; do not claim derived-source replacement was reproduced
there. The distinct 2D readback case has focused source-vs-output regression coverage.

Retained Recolor repair stores complete deep settings in a dedicated history delta,
spatially projects original/index/phase data without requantization, preserves palette/
map/gradient/tick, and awaits runtime restoration before forward history capture.
Recolor replay goes through its restoration owner before brush runtime initialization.
Six focused suites initially63/63; exact native after gate follows in the final receipt.

Admitted storage reproduction: `area11-failure-resident-before-session30` completes
one configuration6/12, six failures. A one-shot resident history blob insertion
failure occurs after native Enter admission. Crop leaves changed artwork/view and
loses its marquee, making retry ineffective. The probe intercepts only a precisely
identified Map entry while Crop is in flight, restores the prototype in finally,
and changes no pixels. Earlier IndexedDB probe could not find tree-shaken production
configuration exports and is not product evidence. Recovery now belongs to Crop's
scoped rollback helper; canonical resident/cold CC and Recolor restoration are tested.
Independent review required preserving concurrent unrelated layer/playback edits;
that correction is included before final production validation.

Native Goblet pre-encoding parity is now proved on the inherited Session29 artifact:
`area11-goblet-frames-session30`,3configs25/25. The actual Export→Goblet→JSON→Export→
Download flow observes all six timeline frame encodes and compares every channel to
the independently cropped source frames. The leading layer texture and trailing
preview encode are separately counted according to the exporter call order. Lossy
encoding delegates unchanged. Earlier attempts omitted Download or counted the two
preview encodes as timeline frames; those fixture failures are not product defects.

Mixed-layer matrix `area11-mixed-canonical-session30` completes4configs36/45 on the
inherited artifact. Actual raster/CC/Sequence source planes and rendered timeline
frames project correctly, including hidden/locked layers. Auto-alignment percentages
and canvasShape history have remaining exact replay differences. Four additional
assertions demand a1×1 disposable CC/Sequence framebuffer return to1×1 after Undo;
authored/raw output is exact and these require source-contract classification, not
automatic pixel-loss fixes. Noncanonical anchor offsetPercent fixtures were removed;
native anchor setup clears that field. Initial disabled Crop and canvas-vs-overlay
hit-test failures were probe prerequisites, corrected before valid evidence.

Remaining: resolve shape/auto-alignment history and classify disposable framebuffer/
CC metadata differences; expand CC soft-edge/active-metadata coverage; test required
runtime rebuild failure recovery and later preparation failures. Full Jest and the
completed-area local commit remain deferred until Area11 is complete. Final source
binding, settled gates, native after results and continuation are in Session30 root facts.

### Session30 final validation receipt

Final artifact `area11-preview-session30.json` binds all26 accumulated Crop source/test
owners to BUILD_TIMESTAMP2026-10-10T08:06:34.360Z; no later source changes. Final
10 focused suites151/151, fulltype-check/lint, sequential production build and diff
check pass. No fullJest/commit gate because Area11 remains incomplete.

Final selected native repairs:10configs74/74 in `area11-native-acceptance-session30.json`:
Recolor4/21, admitted storage failure+retry1/12, inherited CC/Sequence2/16, actual
Goblet frame export3/25. Exact Recolor baseline9/21 becomes21/21; storage6/12 becomes
12/12. Zero aborted cases/page/unhandled errors. New rollback regression preserves
concurrent name/visibility/opacity, layer membership/order, playback speed and Recolor
nonspatial controls. No registry/shape/alignment source change in this session.

Final mixed matrix `area11-mixed-final-session30` is4configs40/45, zeroaborts/errors.
The five remaining failures are two auto-alignment Undo metadata checks and three
canvasShape Redo metadata checks; the freehand Undo case also appends closure. Native
CC/Sequence transparent1×1 placeholder framebuffers legitimately hydrate to document
size on replay, as confirmed at their layer-creation/composition owners. The oracle
now permits only that exact placeholder case, retaining all authoritative pixel,
canonical plane, mask and frame checks. No framebuffer source repair was warranted.
CC metadata aggregate differences remain diagnostic only; inspect concrete fields
before inferring a defect. Root facts preserve final sources, process state, cleanup,
and the next owning scope. All47original files/staged patch remain exact;10/65complete.


## Session31 — Crop geometry, runtime failure, and history allocation ownership

Area11 remains uncommitted pending the completed-area gate; Areas01–10 remain committed.
The requested gpt-6.2-sol model is unavailable; no substitute-model agents were launched.
All47 original file hashes and the original three-file staged patch remain exact.

Native mixed-layer reproduction is40/45, with the same five shape/auto-alignment
replay failures from Session30. Crop now captures raw canvasShape including optional
property presence and exact alignment percentages. A prepared-history completion
step restores these after all deltas/runtime work; compensation covers failures.
The delta preserves unrelated fit/anchor/offset edits and replacement projects.
Initial Crop shape behavior and global alignment math are unchanged. Native geometry
after is45/45 on the first Session31 artifact. Focused lifecycle/store tests also
cover absent/undefined/rectangle/circle/closed-freehand shapes and repeated replay.

Native required CC creation null/throw failures previously committed128×128 crops
with no runtime and no retry marquee (7/9). ccRebuild now rejects missing brushes,
missing snapshot restoration adapters, and thrown canonical restoration so Crop's
existing rollback can recover. Native after29/29 proves exact planes/metadata,
restored marquee, retry, and Undo/Redo for both creation failures.

A second raster blob failure rolled back content but leaked an earlier allocation
(12/13). Bitmap delta preparation now records each successful reference before
starting the next allocation and releases all owned references on rejection.
Native after13/13. CC preparation has the same leak under second/fifth allocation
failures; its factory now tracks all allocation promises, drains pending siblings
and releases each acquired reference when preparation rejects. Native after31/31.
A tenth-allocation probe never reached injection; it is fixture-invalid and excluded.
Deterministic tests cover dedupe against another live history owner, forward/backward
preparation, late completion, retry/dispose, and zero leaked references.

Native CC soft-edge creation and enabled/disabled Crop replay pass2configs25/25.
Playing Recolor passes4configs29/29 for canonical original/index/phase/non-clock
settings and playback flags; moving-frame pixel equality is not claimed. Paused
Recolor's existing GPU oracle retains its stricter exact rendered comparisons.

CC metadata classification: compatibility slot palettes gain the default hard seam;
nextGradientDefId is a derived allocation hint, with allocation scanning used IDs.
The expanded canonical observer's eight initial failures concern only the native
unpainted default CC document (zero paint; prior metadata only flowMode=forward),
which hydrates default palette/active slot/speed fields. All painted canonical
metadata is exact. The corrected oracle permits only that explicit unpainted-default
case; field-level diagnostics remain. No metadata source repair was justified.

Latest targeted gate before the final alignment-ownership refinement:8suites109tests.
Refinement retest:2suites72tests. Full type-check/lint/build and final native artifact
receipt are recorded in the final Session31 root facts; do not infer completion from
this intermediate entry. Full Jest/local commit follow only after Area11 native gates.


### Session31 Area11 final software signoff

Area11 Crop is software-verified and ready for its focused local commit:11/65 areas
complete;12–65 pending. Final selected native matrix:31 configurations,300/300 checks,
no aborted cases or page/unhandled errors. The final soft-mask run adds explicit
active-layer and enabled/disabled toggle replay checks (2configs31/31), superseding
its earlier25-check variant. Detailed runs/limitations are in
`output/playwright/area11-native-acceptance-session31.json`.

All34 Crop source/test owners bind to `area11-preview-session31.json`, timestamp
2026-10-10T11:39:03.524Z, page-730f02662a337a9e.js, SHA256
fc6af4395c494d3a450630af502c96f57bcf0c0cb98abb31b846fc4abcff04ac. The browser resource
timing entry and fetched byte digest match that artifact in
`area11-loaded-artifact-session31.json`. An earlier DOM-script locator returned no
match and cleaned the session; its failure log remains, and the corrected resource
observer supplies the successful receipt. Exact final browser cleanup passes.

Final native coverage: mixed shapes/layout/hidden/locked layers and authored CC
metadata4/57; soft masks/active ownership2/31; required CC creation failure recovery
2/29; later raster blob failure1/13; later CC allocation failures2/31; paused GPU
Recolor4/21; playing Recolor canonical state4/29; native Goblet timeline download
3/25; inherited CC/Sequence2/16; complete raw/held Sequence timeline3/22; raster
planes/history4/26. Earlier unchanged pointer/handles/lifecycle/admission cases retain
their bound Session28–30 evidence. Physical input, other browsers, performance, and
a new initial canvas-shape Crop policy are not claimed.

Completed-area candidate is HEAD plus only36 audit paths (34 owners and2 audit docs);
all47 original paths/staged patch are excluded. Candidate fulltype/lint pass and
fullJest passes595suites/5634tests, one existing suite/test skipped, one snapshot
passed (`area11-candidate-full-jest-session31.log`). Settled worktree type/lint,
production build and diff check also pass. Source hashes remain unchanged since
final build. No remaining actionable finding in the enumerated Area11 software scope.

Local commit hash/preservation receipt: `output/playwright/area11-commit-receipt-session31.json`.
Next: Area12 Pixel, then13–65. Initial owner trace is
`output/playwright/area12-owner-trace-session31.md`. No push/deployment/branch/worktree
change; original47 file hashes and staged3-file patch remain protected.

## Session32 — Area12 Pixel in progress

Areas01–11 remain complete; Crop is not reopened. Original47 dirty paths and the
three-file staged patch matched Session31 preservation hashes before edits.
Native Pixel matrices are in `output/playwright/area12-pixel-*-session32.{js,json,log}`.
Square/Round geometry, zero opacity, spacing response, and Undo/Redo pass initial
checks. Shape mode is deliberately unavailable for Pixel (`hideShapeToggle` plus
`setShapeMode`/preset policy); shared advanced controls remain Area29.

Reproduced: held25%/50% taps publish alpha112/192 instead of64/128. Fast taps can
avoid the second application. Cumulative ordinary paint previews/finalization blit
onto earlier previews without base restoration. Repair under test in
`useBrushEngineSimplified.ts`, `brushEngine/liveStrokePreview.ts`, and
`brushEngine/strokeFinalizeController.ts`, with the existing composition test plus
these two ledgers (six files). Capture the original base for nondithered strokes,
then restore before preview/finalization. No completion/commit claim yet.

Fixture corrections: selecting the already selected Pixel preset preserves controls,
so pressure/snap must explicitly reset between cases. `setSelection` owns the canvas
selection display; clipping fixtures must use `setSelectionBounds`. Earlier selection
failures are fixture-invalid. Native pen input uses CDP pen/force events, not physical
stylus acceptance. Tiny canonical/framebuffer RGB differences disappear after the
same browser's ImageData→Canvas roundtrip, proving premultiplied-alpha quantization;
alpha and geometry are exact. Drag overlap alpha is not expected to stay uniform.

Second reproduced Pixel defect: capture stores premultiplied RGB in straight-alpha
ImageData (50% red becomes96/16/24 instead of192/32/48). Scope expanded to8 files
with `stores/layers/layerCanvasCapture.ts` and its new regression suite. Source-over
now weights destination colour by destination alpha and divides RGB by output alpha.
Unit cases cover transparent/translucent/opaque destinations, zero/opaque source,
selection scope, exact replacement and input immutability. Native retest pending.

Pixel core native after first artifact passed160/160, eraser direct integration30/30.
Overpaint native32/40 exposed the deeper capture contract: `commitRasterOverlay`
already combines base+stroke but requested alpha capture for an unseeded overlay,
compositing the base twice. This also explains the Pixel straight-RGB failure.
The temporary `layerCanvasCapture.ts` change and its new test were COMPLETELY REMOVED.
Replacement is the owning one-line capture-mode correction in
`canvas/handlers/colorCycle/colorCycleCommit.ts` plus its existing test. This file's
original sampled-stroke hunks remain protected; exclude them from the audit commit.
Eight-file boundary remains (three preview owners, commit owner, two owner tests,
two ledgers). Native overpaint must pass on the next artifact before signoff. The
unmodified alpha-only capture helper's straight-RGB issue is an adjacent finding to
reproduce on its remaining callers in later audit areas, not a Pixel workaround.

Final Pixel native artifact passed61configs/351checks: core28/160, geometry/spacing13/79,
translucent/opaque overpainting8/40, direct eraser integration6/30, displayed canvas
composition6/42. No aborted cases or pageerrors. Final artifact
`area12-preview-final-session32.json` binds source and browser-loaded bytes
`page-433d52a69b98380a.js`, SHA256a6a78a0aa66e8da3880ce0f7f27725908e8b67eda2c5840f25f459de5418da0e.
Native pen force is software input; physical devices/browser/performance acceptance
is not claimed. Pixel shape mode unavailable; shared advanced controls remain Area29.

The isolated full gate found one incomplete Canvas mock in
`hooks/__tests__/useBrushEngineSimplified.harness.test.tsx`; its non-dither context
omitted beginPath/rect/clip. Scope expands to9 files for this required test fixture.
Corrected harness21/21 passes. The initial final-candidate full run had594 passing
suites/5635 passing tests plus this one failure (one existing skipped suite/test);
a complete rerun with the repaired fixture is pending. No runtime change followed
native acceptance. Earlier candidate containing the discarded alpha-compositor
attempt was terminated and is not final evidence.

Area13 read-only/native baseline preparation: `area13-owner-trace-session32.md` and
`area13-soft-baseline-session32.json`. Soft native taps are empty for both tips ×
size1/3/16 × opacity.5/1; nonzero-opacity drags draw. No Area13 source edit yet.

### Session32 Area12 final software signoff

Area12 Pixel is software-verified:12/65 complete,13–65 pending. Final native evidence
is61 case executions/351 passing checks, zero failures/aborts/pageerrors, in
`output/playwright/area12-native-acceptance-session32.json`. Exact loaded artifact and
runtime source hashes match `area12-preview-final-session32.json`; only a Canvas mock
was corrected afterward. The isolated9-file candidate excludes original47 user paths
and the sampled-stroke hunks in `colorCycleCommit.ts`. Final candidate full type-check,
lint and full Jest PASS:595suites/5636tests, one existing suite/test skipped, one
snapshot (`area12-candidate-*-gate-session32.log`). Production build and diff check
pass; browser exact-session cleanup is complete.

Final repair: capture the base of ordinary nondithered strokes, restore it before
cumulative preview/final publication, then replace the already composed raster
commit instead of compositing its base again. Native tests prove correct25%/50%
fast/held tap opacity and RGB, translucent/opaque overpainting without outside damage,
geometry/spacing, size extrema, software pen pressure bounds, snap/selection clipping,
Undo/Redo, displayed canvas composition, and shared eraser compatibility.

Physical input/other browsers/performance remain unverified. Pixel shape mode is
intentionally unavailable; shared advanced controls remain Area29. Alpha-only capture
helper math is a recorded adjacent finding for remaining callers, not modified here.
Focused local commit receipt: `output/playwright/area12-commit-receipt-session32.json`.
Continue Area13 from `output/playwright/area13-owner-trace-session32.md`; native missing
Soft taps are reproduced. No Area13 source edit is included in this commit.


## Session33 — Area13 Soft in progress

Areas01–12 remain complete. Before edits, original47 hashes and original staged
patch matched Session32 authority. One owner repair in smoothStrokeRenderer.ts now
emits the initial smooth stamp once, with zero dash-distance advance, and skips
stationary repeats. A dedicated smoothStrokeRenderer.test.ts covers both tips,
spacing across segments, first moving segment, dash phase, admission, and captured
custom colour replay. Boundary: these two files and the two audit ledgers.
No UI/state/composition-shell changes. Shared advanced controls remain Area29.

Fresh native before proof reproduces18configs68/92 with24 missing-tap failures and
no errors. After production build, native44configs240/240 pass: both tips, sizes
1/2/3/16/500, opacity0/.5/1, fast/held taps, drags, pressure, spacing, canvas edges,
selection, Soft shape fill, framebuffer normalization, and Undo/Redo. Pixel analysis
adds14 checks: edge falloff, opacity scaling, exact fast/held equality, pressure
widths4/10/16, and exact10/40px stamp spacing. The original spacing-count assertion
was reversed (11 stamps at10px versus3 at40px); original failed oracle retained and
corrected from recorded native rows, with no runtime change. Overpaint8configs40/40
passes native translucent/opaque Soft bases, full-pixel source-over composition,
outside preservation and exact history. Display checks and final gate pending.

Production receipt: area13-preview-session33.json; page-f422f15038628d06.js SHA256
cc71f6138f0fd73d0f1ab69d9b32fa01b579560bbac125dc1200b61b68595fa8,
BUILD_TIMESTAMP2026-10-10T12:09:59.937Z. Focused4suites30tests, worktree type/lint,
production build and diff check pass. Isolated candidate full gate underway,
excluding all original dirty/staged work. No Area13 completion/commit claim yet.

There is no exposed brush blend-mode control in the owning UI; Soft blend coverage
uses its actual source-over path. Shape Square is an antialiased rectangular stamp;
Round uses radial falloff above size2. Physical stylus, other browsers/performance
are unverified. Software pen force only. Deeper shared dash behavior remains Area29.


### Session33 Area13 final software signoff

Area13 Soft is software-verified:13/65 complete,14–65 pending.58 native configurations,
336 passing checks, zero failures/aborts/pageerrors (area13-native-acceptance-session33.json).
Initial smooth strokes now paint their starting point once; stationary repeats do
not add paint or advance dash distance. Native before proof had24 empty-tap failures.
After proof includes Square/Round taps/drags, sizes1/2/3/16/500, opacity0/.25/.5/1,
fast/held equivalence, exact4/10/16px software pen widths,10/40px spacing, Round radial
falloff, Square geometry, canvas edge/selection clipping, Soft Shape fills,
translucent/opaque overpainting, outside preservation, displayed composition, and
Undo/Redo. Shared advanced controls remain Area29; no physical/browser/performance
acceptance is claimed. No exposed brush blend-mode selector; source-over is verified.

One existing terminal custom-stamp expectation assumed the missing initial stamp.
It now expects the initial and spaced stamps, still excluding the near-duplicate
terminal point. This adds BrushEngineFacade.gridSnap.test.ts to the five-file scope.
No runtime change followed the native artifact. The initial full gate failed only
that expectation; corrected focused14tests and final full gate pass596suites5643tests,
one existing suite/test skipped and one snapshot passed. Final isolated candidate
also passes type-check/lint and excludes all original edits. Production build and
diff check pass. Exact loaded-byte hash matches area13-preview-session33.json;
post-build test-only expectation change is recorded separately. Full logs:
area13-candidate-{typecheck,lint,jest}-final-session33.log.

Original47 paths and three-file staged patch remain protected. Focused local commit
receipt: output/playwright/area13-commit-receipt-session33.json. Dither Area14 source
work is separate and excluded. Area14 already reproduces lost BG-off drag density;
its native baseline/owner trace and in-progress repair remain unverified until the
rebuilt preview passes exact checks. No push/deployment/branch/worktree change.


## Session33 — Area14 Dither Stroke in progress

No Area14 completion/commit claim. Native baseline20configs has80 passing checks
and five invalid center-opacity assertions (a dither hole may occupy the center).
All seven tips paint, but BG-off drags lose most pixels. Follow-up16configs proves
Bayer/Bayer4x4 only20 painted pixels instead of1044; Sierra223 and Floyd95 versus
roughly900–1200 expected. Clamping pressure-linked resolution to1 produces1044 Bayer
and1021 Sierra with otherwise identical native input. Fixed resolution ignores its
mergeExisting:false request and reuses accumulated historical holes.

Owning repair in strokeDitherRegion.ts honors replacement requests and writes direct
copy with putImageData so old holes disappear while pixels outside the ROI survive.
Existing strokeDitherRegion.test.ts adds two deterministic contract regressions.
Focused3suites57tests and production build pass. Exact retest16configs96/96 passes
(area14-density-retest-session33.json). This repair is effective and retained.
Initial file boundary: owner/test and these two ledgers.

Broader preview check reproduces another defect: all four Bayer BG on/off ×
opacity.5/1 cases change thousands of interior displayed channels on release
(area14-preview-parity-session33.json), excluding the terminal cap. Source trace:
nonpressure previews dither moving dirty regions rather than the cumulative effect
domain; BG-on paint also lacks base capture/restore. Native opacity/control checks
are in progress before a further owner repair. Do not confuse these pending checks
with the accepted density repair. Shared advanced controls remain Area29.

Raster Dither Stroke follows strokeDitherController/strokeDitherRegion/dithering/
enginePalette, not principally CC strokeStampDither (which has original edits).
UI/owner enumeration: area14-owner-trace-session33.md. Preview first-repair artifact:
area14-preview-session33.json, page-e44e19264b457e3d.js,
SHA2564b93b5b0705b56f0722f025a52670278b8865a66f646ed35311fdd24c56876ec,
BUILD_TIMESTAMP2026-10-10T12:18:21.322Z. Areas01–13 remain locally committed.


### Session33 Area14 checkpoint — pressure and publication repairs verified, coverage open

Areas01–13 are locally committed; Area14 remains active and uncommitted. Areas15–65
remain pending. Do not mark Area14 complete from these targeted repair proofs.

The accepted density repair is retained. Further native proof found fixed-resolution
preview/release differences and doubled BG-on50% taps (alpha192 instead of128).
useBrushEngineSimplified now captures every stroke base; liveStrokePreview restores
that base and uses cumulative stroke bounds for nonpressure dithering. Shared final
blitting restores the base for BG-on and BG-off; strokeFinalizeController delegates
dither restoration to that owner exactly once. Native fixed-preview4cases24/24 and
tap-opacity8cases48/48 pass on area14-preview-publication-session33.json. All eight
built-in pattern styles also passed16cases96/96 on that intermediate artifact.

Pressure-linked color painting used a separate moving-region renderer and rebuilt
all old paint at the last resolution on release. Constant Max1 BG/opacity matrix had
four preview failures; variable8->2->8 BG/Smoosh matrix had10 failures in50 checks,
including completed-region mutation with Smoosh off. The variable baseline freezes
its reference immediately before the actual committed8->lower transition, observed
read-only; desired pressure is not substituted for committed-resolution evidence.

Dither Stroke's seven native tips now reuse the existing authored-support pressure
run lifecycle from alphaPressureDither. Color quantization samples cumulative raw,
but strokeDitherRegion writes only the current run's positive native support unless
Smoosh is on. Square/rotated Diamond/Triangle support is emitted from the same native
geometry/resources as painting; shapes.ts admits all seven supported tips. The
existing run owner flushes old runs before new geometry and final buffered caps
before commit. No duplicated temporary-stamp pipeline or raw-alpha differencing.
Legacy checkered and antialiased painting keep their existing pressure path; they
are not newly admitted or claimed fixed. The first pressure native attempt exposed
an outdated eraser-only admission guard; its errors are retained and superseded by
the corrected guard and passing native runs, not counted as successful evidence.

Current boundary is15 files, all necessary owners/tests and these two ledgers,
enumerated in output/playwright/area14-candidate-session33.json. Adds
nativeShapeSupport.ts, shapePixelBrush.ts, shapes.ts and their two tests to the prior
10-file publication boundary. All47 original dirty hashes and the original3-file
staged patch remain exact. HEAD remains2fb9e04a6 (Area13 Soft); nothing pushed.

Current production receipt: area14-preview-pressure-admission-session33.json,
page-55f22b46135aa926.js, SHA25645b473b65cf7515743edacb6b6301c7622cf8d38bef0df3c6fb8465c37352f11,
BUILD_TIMESTAMP2026-10-10T12:37:30.100Z. Passing native evidence on this artifact:
- Constant pressure Max1 preview/release:4cases24checks.
- Native software pen8->2->8, BG on/off and Smoosh on/off:4cases50checks.
- All7 tips fixed1px versus pressure1px, taps/drags/opacity/history:40cases190checks.
- Shared ordinary/dither eraser over native-painted bases:14cases70checks.
- All11 algorithms through real controls, BG on/off:22cases132checks.
- All8 built-in patterns through real controls, BG on/off:16cases96checks.
The current artifact therefore has100 native configurations and562 passing checks.
Actual browser-loaded bytes match its receipt (area14-loaded-pressure-artifact-session33.log).
All completed runs above have zero failures, aborted cases and page errors. Physical
stylus, other browsers and performance remain unverified. Full logs/JSON use
area14-pressure-preview-admission-retest, area14-variable-pressure-retest,
area14-tips-pressure-parity, area14-eraser-integration, area14-algorithms-final,
area14-patterns-final, all suffixed-session33 under output/playwright.

Isolated15-file candidate type-check/lint PASS;8 owner/hook suites121 tests PASS
(area14-admission-candidate-{typecheck,lint}-session33.log and
area14-pressure-integration-candidate-session33.log). Full Jest commit gate has NOT
run for Area14. Earlier worktree type errors were in existing selection-test Canvas
contexts; the isolated candidate excludes original edits. One preview build failed
because audit backup .ts copies entered TypeScript scanning; all those copies now
use .bak extensions, and the corrected production build passes. No runtime source
changed after the accepted pressure artifact; later edits are audit documentation.

Next: finish size1/2/500, spacing1/10/40, clipping/edges, overall size-pressure bounds,
fixed Res1/4/64 and PresRes Max1/8/999, palette spread/canvas sampling, translucent and
opaque overpainting, outside preservation and displayed composition. Do not assume
a dither center or extremely coarse cell must paint. Custom pattern creation/import/
local-library management is explicitly tracked in shared-controls Area29. Read
area14-remaining-cases-session33.md and area14-pressure-owner-trace-session33.md before
continuing. Complete native coverage, final isolated full gate, source/artifact and
original-work preservation checks, then commit only Area14 files. Continue Areas15–65.


### Session34 — Area14 Dither Stroke final software signoff

Area14 software coverage is complete. Retains the Session33 density, publication,
and authored pressure-run repairs. Adds two reproduced owner fixes:1–2px Triangle
paths no longer collapse to zero area; fractional half-extents are shared with native
support. The support canvas now requests the same CPU rasterization as raw strokes.
A native Canvas experiment proved GPU/CPU tiny-path coverage differed; before-fix
pressure support dropped a16-alpha edge pixel despite identical raw bytes and bounds.
No threshold, dilation, palette, noise, or algorithm workaround was introduced.

Boundary expanded explicitly from15 to17 paths for alphaPressureDither.ts and its
existing test. The tiny Triangle owner/test were already in scope. Exact file list:
output/playwright/area14-candidate-session34.json. All47 original dirty file hashes
and the original3-file staged patch remain exact; original patch SHA256 is
5d9562a4725a7c54ef4e97e2927ad3df5a2cd656663c2749fc9ca72dfd924c09.

Native coverage receipt: output/playwright/area14-native-coverage-session34.json,
192 configurations /1,104 passing checks, zero failures/aborts/page errors in accepted
runs. This combines accepted artifacts with carryover for unchanged nonpressure and
Square branches; it is not a claim that every run used the final build. Earlier
fixed preview/tap-opacity12configs72checks remain separate supporting evidence.
Remaining coverage now includes all size1/2/500 tips, spacing1/10/40, canvas edges,
selection clipping, size pressure independently of cell resolution and1–1000% UI
bounds, fixed Res1/4/64, actual committed software-pen Max1/8/999, palette spread,
Variety, native canvas sampling, opaque/translucent overpaint, BG holes, display
composition, and exact history. Shared pattern creation/import/local library,
rotation/dash/artistic controls remain explicitly Area29. Dither Stroke exposes no
Shape or Pxl Edge toggle. Physical stylus, other browsers and performance unverified.

Final artifact: page-86ce50a2c65743a6.js, SHA256
f356609af692ea748718309ff008a7712d24a93808246146c3bc5b714ae8f49d,
BUILD_TIMESTAMP2026-10-10T12:56:24.512Z. Receipt area14-preview-final-session34.json;
actual loaded bytes verified by area14-loaded-final-session34.log. Final native
support gate66configs354checks passes: tiny fixed/pressure parity8/44,8->2->8 BG/
Smoosh4/50, all7 tip fixed/pressure parity40/190, and shared eraser14/70. All source
hashes still match. Accepted preceding boundary sweep43/212 and palette/variety/
sampling/overpaint21/164 apply to unchanged branches of the final source.

Verification: isolated17-file candidate type-check/lint PASS; focused3suites42tests
PASS; final full Jest596suites5,665tests PASS, existing1suite/test skipped,1snapshot
PASS (area14-candidate-full-jest-session34.log). Production build and diff check PASS.
The exploratory count>=0 tiny-tip sweep and duplicate-label sampling abort were
superseded by explicit nonempty opaque-tip and corrected sampling checks. Failed
native and unit evidence is retained; no signoff derives from those failed runs.

Focused local commit receipt: output/playwright/area14-commit-receipt-session34.json.
Remain on main; no push/deployment. Next active area is15 Dither Shape;16–65 pending.


### Session34 — Area15 Dither Shape, A15-01 under verification

Trace: shapeDitherPreset -> ShapeToolHandlerRuntime/shapeDrawing ->
finalizeRasterShapeFill -> commitRasterShapeFill -> captureCanvasToActiveLayer.
The preset has no tip selector. Its preview is a separate translucent overlay at
60% display alpha; the guide now states that and removes the stale tip row.
Initial main-canvas and triangle/concave ROI preview mismatches were invalid audit
oracles, corrected against the actual overlay. Corrected geometry2/18 passes.

The simple-preview owner is pointerHandlersRuntime.drawSimpleShapePreviewOnOverlay,
which dithers buffered content. The earlier advanced-polygon silhouette-only source
trace was incorrect; final opacity and preview display alpha intentionally differ.

All11 algorithms x BG22/198,8 built-in patterns x BG16/144, software-pen resolution
and selection clipping16/156, and diagonal Pxl Edge4/40 pass. Geometry/opacity/Enter/
Escape/degenerate/edge/size/spacing workflow24 cases had202 passes and2 invalid preview
assertions, both superseded by corrected geometry. Palette21 cases established
A15-01: half-alpha underpaint128 becomes192 in dither gaps and capture padding;
50% fill reaches224 instead of192. This persists after Canvas premultiplication
normalization, disproving an initial RGB-rounding-only hypothesis. Before evidence:
area15-{palette,translucent-underpaint}-session34.{log,json} under output/playwright.

A15-01 owner: commitRasterShapeFill adds the backdrop before capture, then default
alpha capture adds it again. It now uses existing replace mode for the already
composed image. Boundary is five paths: ShapeFinalizeHandler.ts, its existing test,
artist-guide/dither-shape.md, and these two ledgers. Original staged shapeDrawing.ts
remains untouched. Regression before fails128->192/192->224; after passes. Four
owner/integration suites33tests pass. Candidate final type-check and lint pass;
full Jest and rebuilt native after-proof are still pending. Area15 is not complete.

Shared custom-pattern library, artistic effects, rotation/snap and per-preset
persistence remain Area29. Physical stylus, other browsers and performance unverified.
Area16 controls have only been inspected; no Area16 signoff follows from that.


### Session34 — Area15 final software signoff

A15-01 passes the exact rebuilt native interaction: half-alpha underpaint stays128
outside the shape and in BG-off holes; 50% fill composes once. Opaque/translucent
underpaint, displayed composition, opacity, sampling/spread/Variety, exact Undo/Redo,
geometry/Enter/Escape, bounds/clipping, software pressure and Pxl Edge pass. Selected
coverage is103 configurations/910checks; receipt area15-native-coverage-session34.json
states the unchanged algorithm/pattern/empty-base pressure carryover explicitly.
Native final-artifact evidence: palette21/168, workflow23 accepted cases plus corrected
edge1 (combined24/204), pressure/clipping8/76, Pxl Edge4/40. Exact defect4/30 and shared
Dither Grad Free/Rect/Oval/Tri4/28 are additional supporting passes, not double-counted.

Preview review correction: the simple preview can dither its buffer, with a fixed
0.6 display alpha. BG-on field comparison matched immediately; one initial fixture
BG-off comparison was solid. It did not recur in10 follow-up cases: reordered3/30,
explicit preset switches3/30, and entirely native brush-settings4/40. Retain the
isolated mismatch in area15-preview-field-diagnose-session34.json; no speculative
runtime patch follows from it. The native-settings run is the accepted preview-field
proof. The final sweep's edge-preview colour-count failure was a sampling ROI crossing
the boundary, superseded by area15-edge-preview-after-session34 (1/9).

Final bundle page-259cb60c8dd71797.js, SHA256
2d656fdff12db9101d676ba71751019668521b026286ed65cab10c5f5fbe0746.
Each final native script asserts the actual browser-loaded resource hash. Source and
artifact receipt: area15-preview-final-session34.json. No runtime edits after build.
Five-path isolated candidate type-check PASS; final worktree lint PASS; focused
owner/integration4suites33tests PASS; full isolated Jest596suites5,666tests PASS,
existing1suite/test skipped,1snapshot PASS. Production build and diff check PASS.
Full log area15-candidate-full-jest-session34.log; only the5 scoped files are committed.
Original47 path hashes and the3-file staged patch remain exact. No push/deployment.

Commit receipt: output/playwright/area15-commit-receipt-session34.json. Area16 now
active,17–65 pending. Shared artistic/pattern-library/rotation/snap/preset-persistence
work remains Area29. Hardware, other browsers and performance remain unverified.

## Session34 — Area16 Dither Grad in progress

A16-01: Sierra Lite produced a flat50/50 distribution for both opaque and
transparent gradients. The scalar gradient coverage grid now uses Sierra's existing
alpha-density signal. Cell sizes1/4 failed before and pass the owner regression.
A16-02: Rect/Oval/Tri sampling retained only the initial color. Basic geometry now
samples its existing drag endpoints, and pointer-up flushes sampling past the120ms
preview throttle. Free and degenerate contracts remain covered; focused41tests pass.
Scope is10paths (receipt area16-candidate-session34.json), including this ledger,
handover and artist guide. Native final verification and full commit gates remain
pending. Original47dirty paths and original3-file staged patch remain protected.
Lost Edge needs no repair: native0/50/100 settings progressively erode coverage.

A16-03: pressure-linked Max8 produced identical low/high pen commits even with
explicit Bayer and sustained strokes. The direction-confirmation owner was
starting another shape pressure sample from the click. Dither Grad now sets the
selected direction and directly finalizes the existing shape. The boundary grows
to12files: pointerHandlersRuntime and its existing main test. This preserves the
original staged shapeDrawing source. Regression failed before;184direct tests pass
after. New live pressure proof/full gates pending. The earlier596suite/5670test
pass predates this third repair and is not its final gate.

## Session34 — Area16 final signoff

A16-01 routes Sierra Lite's scalar gradient through existing density diffusion;
A16-02 samples basic geometry along drag endpoints and flushes the final sample;
A16-03 confirms Dither Grad direction without taking another pressure sample.
Final runtime review covers12scoped files; original47paths and original3-file
staged patch are exact. No other pending user work is included.

Selected native evidence:108configurations/905checks, zero browser errors/aborts.
The first66configs (sampling16/112checks, algorithms and built-in patterns38/361,
extremes12/91) verified the density/sampling owners. After the confirmation repair,
final artifact42configs/341checks reverified pressure6/53, sustained preview/commit
pressure2/19, explicit Bayer length3/25, displayed preview4/42, curved Pixel Edge
4/32, degenerate/canvas-edge3/17, core workflow16/125, fast6-color sampling4/28.
The renderer/sampling owners are unchanged between these two artifacts. Exact
run names and bundle hashes: output/playwright/area16-native-coverage-session34.json.
Final bundle receipt: area16-preview-pressure-final-session34.json.

Final isolated12-file candidate gate:596suites/5670tests pass; one existing suite
and test skipped, one snapshot pass. Type-check/lint/production build/diff check
pass. Hardware pen behavior, performance and other browsers remain unverified.
Custom pattern management belongs to Area29. Prior failed Enter/transparent-color,
inherited-pattern contrast, and empty-vector-overlay preview assertions were test
oracle errors; retained evidence explains corrections. Native pressure failures
were real and passed only after A16-03. Lost Edge needed no change.

Focused local commit receipt: output/playwright/area16-commit-receipt-session34.json.
Area17 discovery begins: actual Color Cycle Stroke controls inventoried, including
reachable Bristles/Pencil; no17runtime signoff or fixes. Continue17–65. Browser
closed with exact-session cleanup; existing watcher/server retained.


## Session35 — Area17 partial, first-stamp repair verified

A17-01: first held/fast tap on a fresh CC layer was overwritten when the stale
animator rebuilt from the empty committed document during presentation. The stroke
start owner now restores that committed base before authoring. The real animator/
presenter integration failed before and passes after; four tip variants retain
visible indexed pixels and one exact Undo/Redo entry. Five source/test files only,
plus these two audit ledgers; original47paths and staged patch remain exact.

Current proof:126completed native cases /802basic interaction and history checks
pass on the same production artifact.16additional control-effect comparisons pass;
five fail across two open defects: A17-02 directional-tip Rotation is ignored and
A17-03 Lost Edge0/50/100 is identical. Area17 is NOT complete and is not committed.
Details and corrected oracle exclusions are in
`output/playwright/area17-native-coverage-session35.json` and
`output/playwright/area17-owner-trace-session35.md`.

Type-check/lint/build/diff checks and4focused suites86tests pass. FullJest and the
isolated completed-area commit gate remain pending. Native evidence covers first
taps/drags, all4tips, normal/locked rejection, clipping, size/pressure limits, all11
stamp-dither algorithms/8patterns, Res/Variety/BGFill/Spread, Palette/FG/Sample,
source freezing, Reset, Band/Spacing/Speed/velocity, Bristles/Pencil, grid/rounded/
dashes, Pickup and ordinary Play/Pause. Hardware pressure/performance is not claimed.
Control geometry/contour repairs and remaining cancellation/contact cases still need
owner regressions and exact native proof. Continue17then18–65 without renewed
permission; preserve original work; no partial-area commit/push/branch change.

## Session36 — Area17 owner repairs and native acceptance

A17-01 restores the committed animator base before the first write, so fresh taps
survive presentation. A17-02 forwards Rotation through the shared native footprint
for paint, metadata, dither membership, selection and erase healing. A17-03 applies
Lost Edge to the current admitted stroke and restores all six prior canonical
channels at rejected pixels. No playback/export format changes are involved.

A17-04 replaces sampled fallback history bounds with exact bounds across all six
canonical planes. Sparse Pencil/Triangle contours now undo completely. A17-05
replaces pending full-tip healing with the final native write footprint through the
existing brush commit registry contract. Dither gaps retain prior erased coverage.
A zero-coverage Pencil contact supplies an explicit empty footprint, cancels pending
healing and creates no mask-version change or history entry. Shape authoring resets
the ephemeral stroke masks. Before-image copies are only allocated for Lost Edge.

The first mask handoff failed because the registry did not forward its getter. It
was removed, the missing contract was reproduced, and the connected replacement
was verified. Lost Edge off and zero-coverage contacts then exposed the remaining
shared healing cases; those were repaired at the same owner. Historical failed
runs and superseded/cancelled test runs remain in ignored evidence. An early core
script sampled history before asynchronous finalization; its corrected rerun waits
for the exact history count without changing runtime code.

Session36 follow-up proof: 107 executed native cases and 743 interaction/history
checks, plus 15 explicit Rotation/Lost Edge effect comparisons. These include
deliberate retests, not 107 unique configurations. Earlier broad Area17 settings
coverage remains in the Session35 receipt. The final artifact verifies all 13
erased-stroke cases (142 checks), including empty gestures, with Lost Edge off/on.
Other checks cover four tips, clipping, Pencil/Bristles/dither combinations, tiny
stamps, canvas edges, native touch cancellation/retry, frozen older ink, and exact
Undo/Redo. Physical tablet hardware and performance acceptance are not claimed.

The scoped candidate contains 27 source/test files plus these two ledgers. Three
original dirty owners retain their earlier hunks outside the candidate; the other
44 original paths and original three-file staged patch remain byte-exact. Current
type-check, lint, production build and focused regressions pass. The final isolated
full suite passes599suites/5708tests with one existing skipped suite/test and one
passing snapshot. Final diff review found no remaining actionable Area17 issue.
The focused local commit is recorded in `output/playwright/area17-commit-receipt-session36.json`. See
`output/playwright/area17-native-coverage-session36.json`,
`area17-preview-empty-session36.json`, and `area17-isolated-empty-gate-session36.json`.

Area18 discovery only: CC Tonal Dither is preset `color-cycle-gradient`; its actual
Palette/FG Grad/Sample controls are captured in `area18-controls-session36.json`.
Painting has not been verified. Continue with `area18-owner-trace-session36.md`
as Area18 begins. The audit remains authorized through Area65.

## Session37 — Area18 partial: Concentric and locked-layer repairs

Area18 remains **partial and uncommitted**. Areas01–17 are complete; continue18,
then19–65. No partial-area commit, push, deployment, branch or worktree change.

**A18-01 repaired and native verified:** Concentric used the generic GPU fill,
which has no inputs for the selected dither algorithm, ink count, pattern or
background behavior. It returned before the existing dither implementation.
CC dither fills now reach that implementation; supported ordinary/non-dither GPU
fills remain unchanged. Before, Ink Colors1/2/8/16 all wrote19 indices and four
algorithms had identical paint buffers. After, selected8/16 counts write8/16
indices and the algorithms produce distinct patterns. Twelve native cases and
60 history checks pass. The new real-brush/document regression fails before and
passes after, with a successful GPU boundary double exposing the wrong dispatch.

**A18-02 repaired and native verified:** locked CC shapes still painted and added
history. Five native reproductions cover initially locked Grad/Concentric/Stroke
and a layer locked during direction preview, confirmed by click or Enter.
The shape owner now rejects locked initial authoring and rechecks the captured
layer when queued finalization begins, cancelling its draft when locked.
The final production artifact passes all five cases/18 checks, including cleared
shape state. Four direct suites/61 tests, type-check, lint and production build pass.
The pre-existing staged additions in shapeDrawing.ts remain preserved.

**A18-03 open:** Spacing and both Velocity toggles are exposed for Tonal Dither,
but the shape workflow does not consume these settings. Identical native Stroke
paths at approximately0.7s and4.3s produce identical paint/RGBA hashes and speed
byte49 with either velocity link off/on. Spacing1/64 also produced identical
free-shape output. Source trace and exact data are in the Session37 owner trace
and area18-velocity-probe-final-session37.json. No UI repair has been attempted.
Finish the trace and prefer restricting unsupported controls to the paths that
implement them, rather than inventing new velocity-shape behavior. Review other
conditional controls before declaring the area complete.

Additional proof: the grayscale settings matrix passes34 cases/204 checks;
all11 algorithms and8 built-in patterns have distinct visible output. Fourteen
explicit effect checks cover settings, ink counts, pressure, grid and speed.
Sampling, foreground tones, playback/pause, frozen older ink, erased coverage,
alpha and exact Undo/Redo were exercised. Fixtures were corrected for ambiguous
Soft selectors, an unavailable Rounded control, animated selection outlines,
sample-count reset at commit, and a second gesture's baseline; these are not
application defects. The corrected runs and exclusions are in the coverage receipt.
Physical tablet, performance, custom pattern-library management and full shared
geometry acceptance are not claimed; later owning areas remain open.

The first isolated candidate passes600 suites/5711 tests, with one existing skip,
plus type-check/lint. **That candidate predates A18-02 and is not the final area
gate.** Prepare a fresh candidate after the remaining control repair, excluding
all original dirty/staged hunks, then review and run the completed-area gate.
Current scope is four source/test files and these two ledgers. All other original
paths and the original three-file staged patch remain exact. Read
`output/playwright/area18-root-facts-session37.md` first for continuation.

## Session38 — Area18 final software signoff

Area18 is software-verified; completed-area local commit follows. Areas01–18 are
complete; Area19 CC Fixed Dither is next, with its initial native matrix running.
No push, deployment, branch or worktree changes.

A18-03 repaired at BrushControls: CC shape fills no longer expose Spacing,
velocity spacing, velocity animation speed, Rotation or raster-only Smoosh.
Static Speed, pressure size and pressure-linked resolution remain available on
supported paths. Switching to Color Cycle Stroke restores its stamp controls.
Stored settings are preserved. Native before/after evidence confirms the issue:
Rotation on/off gives identical paint/RGBA; Smoosh does too with pressure resolution
enabled and native pen pressure changing .1→1. Session37 already proved inert
Spacing and Velocity links. Six source/test owners plus these two ledgers are
necessary for the three Area18 repairs; no rendering semantics were invented.

Final bundle b773c989dfe9a9e32aff60c1583ba4d9d5d688f064c442fe0bc5c6bff5279f2b
passes79 control/sampling checks: all21 shape/mode control states, a return to
CC Stroke, and five sampled fill cases with exact Undo/Redo. Sampled Concentric
Bayer/Sierra/Pattern produce the selected8/16/8 indices, visible colour and
canonical gradient definitions. All five locked-layer cases/18 checks also pass
on that final artifact. The initial final script used an incorrect short brush
label; its locator abort was corrected without application changes.

Selected evidence totals117 executed painting/history cases,737 checks plus the
14 earlier positive effect comparisons;22 control states are included in checks
but counted separately from painting cases. Counts include retests. Prior fixture
exclusions remain in area18-native-coverage-session38.json. Physical tablet,
performance, custom pattern-library management and later shared-geometry/playback
areas remain outside this software signoff.

Before/after UI regressions fail4 and then pass;74 focused UI tests pass.
Fresh isolated task-only candidate passes type-check, lint and600 suites/5717tests,
with one existing skipped suite/test and one passing snapshot. Production build
and diff review pass. The candidate excludes all original staged shapeDrawing
additions and all unrelated dirty files; source hashes bind it to the preview.
Receipts: area18-preview-session38.json, area18-isolated-gate-session38.json,
area18-native-coverage-session38.json and area18-owner-trace-session38.md.

The pre-existing dirty CC Tonal Dither artist guide describes unsupported controls;
its wording is preserved as unrelated work and this discrepancy is recorded here.
Original47paths and staged3-file patch are preserved before the local commit.

Area18 local commit receipt: `54f63a899a5730d0d343c5f334a024065ed0c2b2` on main,
`fix: honor tonal dither controls and locked shape layers`. Eight intended files
only. All47 original paths preserved; original3-file staged patch contents remain
exact (new blob IDs/hunk offsets reflect the committed shape guard). Fresh Area19
baseline is `output/playwright/area19-initial-baseline-session38.json`. The commit
succeeded before index reconciliation needed --add for the new test; reconciliation
completed and was verified without a second commit. No push/deployment.

## Session38 — Area19 in progress: hidden size closes polygons early

Initial35native cases/204checks and separated-ink32cases/192checks pass;25explicit
effect comparisons cover canonical weave, Banding, Spread, resolution, Variety,
Contrast and SampleColors. The initial Contrast200 boundary was an invalid fixture
(maximum100); the corrected tail passes. Zero-spread algorithm cases are basic
history coverage, not proof that every weave is visibly distinguishable.

A19-01 is reproduced: choosing Stroke size500 then Poly allows a corner120px away
to close the polygon. Size is hidden in Poly. Its pointer-up owner used size/2 as
closure tolerance, causing premature triangular paint and a later incorrect Undo
anchor. Size20 control passes; size500 fails direction-uncommitted and Undo checks.
The owner now uses6screen pixels divided by zoom. Scope expanded only to
pointerHandlersRuntime.ts and pointerHandlers.main.test.ts, plus the two ledgers.
Four new tests across both gradient presets and zoom1/2/.25 fail before and pass
after.176direct tests pass; after type corrections154pointer tests pass again.

First preview build/type-check caught nullable canvas and typed-fixture issues;
corrected source passes isolated type/lint. Corrected preview, full isolated Jest
and native runtime proof are pending. No Area19 commit or acceptance yet. Preserve
original47paths/staged3-file contents against area19-initial-baseline-session38.json.
Further playback/sampling/reset/pickup/selection/erase/alpha and final review remain.

## Session38 — Area19 final software signoff

Area19 CC Fixed Dither is software-verified. A19-01 repairs polygon closure at the
pointer owner: the hidden stamp size no longer determines whether a vertex closes
the shape. Closure uses6screen pixels through current zoom. Before, native Stroke
size500→Poly painted early and Undo retained pixels; size20 control passed. Final
previewf854ade1c84a85f6df334efd1fc0581a7d034372f421ea83682586446f296ef0 passes
sizes1/20/500, zoom.25/2 and the shared Tonal path:6cases36checks, no premature
commit, and exact canonical/RGBA Undo/Redo. Existing close/double-click behavior
remains covered by the pointer suite.

Selected native coverage is116executed cases/708checks and31positive effects:
three sources/fill modes, all11algorithms/eight builtin patterns, Banding/Spread/
resolution/Variety/Contrast/SampleColors/FG controls/Speed/pressure/grid, direction
confirm/cancel, selection/edges, locks, playback/pause, frozen older ink, sampling
reset/pickup, erased coverage, alpha and exact history. Counts include retests;
source snapshots and exclusions are in area19-native-coverage-session38.json.
Fixed pattern differences live in pair/definition buffers even when paint indices
match. Some algorithms share a constant50%checker; per-mark Sierra phase variation
is intentional and is not a failed determinism test.

Two fixtures were corrected without application patches: Contrast200 exceeds its
native100limit; Tonal's opaque-background assertion does not apply to Fixed Dither.
Fixed paired palettes retain source alpha128, with BGFill toggling low-ink coverage
(14400pixels on versus7344off in the half-alpha fixture). Owner code and existing
alpha tests establish that contract, and the corrected native checks pass.
The pre-fix polygon case is excluded and replaced by exact final reproduction.

Four new tests fail before and pass after;176direct tests pass and154pointer tests
pass again after typed-fixture corrections. Initial type/build errors are superseded
by corrected preview build and isolated type/lint/fullJest:600suites5721tests,
one existing skipped suite/test, one passing snapshot. Final source hashes match
the production receipt and clean candidate. Two source/test owners plus two ledgers
are the completed-area scope. Original47paths and original staged3-file additions
remain exact. No physical tablet/performance/custom library/global playback signoff
is implied. Local commit receipt follows; continue20–65 without renewed permission.

Session38 local Area19 commit: `401f76a47f70f7cff42beb05fb1bb176555e4d72` on main,
`fix: close CC polygons independently of hidden brush size`. Four intended files
only; original47paths and staged3-file SHA remain exact. Areas01–19 complete;20–65
pending. Browser closed with exact cleanup. Read `output/playwright/area20-root-facts-session38.md`
and fresh `area20-initial-baseline-session38.json`; never rerun historical commit scripts.

## Continuation dispatch blocked by automatic approval review

No Area20 continuation chat was created. Both create_thread attempts were rejected.
The first rejection requested trusted human authorization in the current transcript.
A read_thread lookup then verified direct human replies in chat
01a124ca-e991-7372-88ec-a6fa3d93c8e2 to the explicit question about creating Session31:
userMessage01a1258d-0290-7a33-92f3-a24adffd3e66: "yes dont stop untol it all done";
userMessage01a1258d-ec89-7c83-b94f-3af91b846cdb repeated not to stop and requested6.2Sol.
The retry cited this evidence but automatic review still rejected it because prior
approval retrieved through tool output could not establish authorization. No
workaround or alternate chat-launch path was used. Direct user approval in this
chat is now required for the next create_thread action. Areas20–65 remain pending;
all completed work, final receipts and closed-browser/process state above remain valid.
