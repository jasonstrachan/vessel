# Vessel functionality audit — 10 October 2026

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
| 07 | Selection: select all, deselect, invert, tool persistence, paint/fill/erase clipping | selection slice/ROI helpers | active discovery (Session17 continuation; prepared native runner unexecuted) |
| 08 | Move selected pixels: extract/drag, source clearing, commit/cancel, edges, CC metadata, history | selection handlers, selectionPaste | pending |
| 09 | Copy/cut/paste/duplicate/paste in place: internal/external clipboard, scaling, alpha, cross-layer/CC, failures | selection slice, clipboard handlers, selectionPaste | pending |
| 10 | Floating transform: resize, rotation, flip H/V, Enter/Escape/delete, layer switch | paste handlers/helpers, SelectionOptionsPanel | pending |
| 11 | Crop: selection crop, handles/dimensions, outside bounds, commit/cancel/history, CC/sequence | crop slice/handlers, CropOptionsPanel | pending |
| 12 | Pixel brush: tap/drag, square/round tips, size, opacity, spacing, pressure, snap, shape mode | brush presets, brush engine/settings | pending |
| 13 | Soft brush: edge/size/opacity, pressure, spacing, blend | brush engine/settings | pending |
| 14 | Dither Stroke: algorithm, pattern, size, spacing, pressure, palette/alpha | strokeStampDither, brush controls | pending |
| 15 | Dither Shape: geometry, preview/final parity, dither settings, fill/cancel/history | shape handlers, brush engine | pending |
| 16 | Dither Grad: sampled/manual colours, gradient direction/range, geometry, dither settings | gradient shape runtime | pending |
| 17 | Color Cycle Stroke: tap/drag, palette, speed/flow, spacing, phase, line mode, pressure | CC stroke runtime, CC document | pending |
| 18 | CC Tonal Dither: signal/ink mapping, sampling, dither settings, palette, playback | CC mark session, sampled path runtime | pending |
| 19 | CC Fixed Dither: density/pattern, sampling, palette, size, playback | CC mark session, strokeStampDither | pending |
| 20 | CC shape/basic geometry: freehand/rectangle/ellipse/line/click-line, constraints, direction, preview/commit/cancel | CC gradient drawing runtime | pending |
| 21 | Checkered brush: cell size, colours, spacing, opacity, shape/selection | brush engine/settings | pending |
| 22 | Rectangle Gradient: stops/direction, drag/constraint, commit/cancel | shape handlers, gradient brush | pending |
| 23 | Spam Text: content, font/size, spacing, colour, pressure, rotation | text brush/settings | pending |
| 24 | Resampler: source sampling, tap/drag, size, filtering, alpha, edges | resampler brush/runtime | pending |
| 25 | Mosaic: source/colour, tile settings, geometry, preview/commit | mosaic brush/runtime | pending |
| 26 | Shape Pattern: each exposed fill strategy and controls, boundaries, colour, preview/final | shapeFill, shape handlers/settings | pending |
| 27 | Custom brush capture: region, alpha, normal/CC data, save/name/default, reload | custom tool, brush editor, project slice | pending |
| 28 | Custom brush painting/edit/removal: size/rotation/pressure/spacing, palette, defaults, library | BrushLibrary, custom presets, brush runtime | pending |
| 29 | Shared brush controls: shape mode/basic shapes, constraints, grid snap, dashed strokes, antialiasing, reset/per-preset persistence | BrushControls, tools slice | pending |
| 30 | Fill: tolerance/contiguous, alpha/colour, selection boundary, raster/CC/sequence, undo/redo | fillTool, tools slice | pending |
| 31 | Eyedropper: click/held P, source/sample size, alpha, FG/BG, return to previous tool | color picker handlers/panel | pending |
| 32 | Colour panel: RGB/HSL, FG/BG swap, opacity, swatches/recent palettes | ColorPickerPanel, palette slice | pending |
| 33 | Gradients: edit/add/remove/move stops, presets, reverse, recent/custom palette, CC propagation | gradient editor, palette/CC state | pending |
| 34 | Colour Adjust: hue/saturation/lightness/levels, preview/cancel/apply, selection, CC data, history | ColorAdjustToolPanel, colorAdjust slice | pending |
| 35 | Recolor: source modes, quantisation, palette/animation, layer conversion, history | recolor controls, RecolorManager | pending |
| 36 | Layers: add/rename/select/delete/duplicate, last layer, active fallback, history | LayersPanel, layers slice/services | pending |
| 37 | Layers: reorder, multi-select, visibility/lock, opacity/blend, merge | LayersPanel, layer operations | pending |
| 38 | Layer groups: create/name/collapse/reorder/visibility/opacity/delete, nested behavior | layer groups, LayersPanel | pending |
| 39 | Adjustment layers: all controls, ordering, groups, export parity | AdjustmentLayerPanel, compositing | pending |
| 40 | Alignment: all nine anchors, Auto, fit None/Contain/Cover/Fill/Tile, X/Y, save/load | AlignmentPanel, alignment rendering | pending |
| 41 | CC layers: creation/conversion, slot/palette ownership, visibility, playback, clear/resize/history | colorCycle slice/document/runtime | pending |
| 42 | Interlace: group creation, source/phase/speed/settings, playback, export parity | InterlaceSettingsPanel, interlace runtime | pending |
| 43 | Sequence layers: create, record strokes/fill/erase/selection, frame bounds, history | sequential slice/runtime | pending |
| 44 | Sequence settings: FPS/frames, preserve/trim/retime, spread/fade/burst/gap, playback | SequentialControlsModule | pending |
| 45 | Playback: play/pause/scrub, global rate incl zero, mixed layer types, editing while playing | AnimationControlsPanel, runtime/playback | pending |
| 46 | Display filters: each exposed filter/control, order, enable/reset, viewport/export parity | DisplayFiltersSection, display filter runtime | pending |
| 47 | Viewport: pan/Space/middle drag, zoom wheel/reset/anchor, resize, pixel grid/rulers | canvas view/input/render hooks | pending |
| 48 | Grid: toggle, rows/columns, snapping, invalid values, persistence | GridSettingsPanel, UI slice | pending |
| 49 | Keyboard: tool shortcuts, temporary tools, undo/redo, text/modal focus, interrupted strokes | comprehensive keyboard, canvas keyboard handlers | pending |
| 50 | Document: new/cancel, name/dimensions/background, validation, resize, unsaved work | DocumentModal, project slice | pending |
| 51 | History: all edit operations, redo invalidation, limits/spill/recovery, layer/runtime rehydration | history manager/slice/deltas | pending |
| 52 | Save/load: .vs/archive round trip, raster/CC/sequence/custom brushes/filters/alignments, errors | projectIO, project slice | pending |
| 53 | Load browser: file/folder/drop, preview/navigation/zoom, health/repair/export, cancellation | LoadProjectModal, directory/preview hooks | pending |
| 54 | Autosave/recovery/backups: enable/interval/status, failure, recovery/new-document behavior | autosave slice/services, SettingsModal | pending |
| 55 | PNG export: alpha/background, layer composition, bounds/size, download/errors | projectIO, ExportModal | pending |
| 56 | GIF export: duration/FPS/size, palette/alpha, playback, progress/cancel/errors | exportService, ExportModal | pending |
| 57 | Video export: supported format/fallback, timing/size, progress/cancel/errors | exportService, ExportModal | pending |
| 58 | Goblet: all formats, packaging/load, animation/filters/fit/masks/groups, progress/cancel/errors | goblet exporter, Goblet runtime | pending |
| 59 | Options: display/background/rulers/FPS/pixel grid, history limit, persistence/reset | SettingsModal, localSettings | pending |
| 60 | Library/UI: filters, active tool states, panel collapse/scroll, keyboard access, modals | BrushLibrary, toolbar, panels | pending |
| 61 | Reference Studio: open/blocked popup, import/reference manipulation, lifecycle | referenceStudio, toolbar | pending |
| 62 | Multiplayer: start/stop/failure, shared canvas/input/permissions, session lifecycle | collaboration runtime, toolbar | pending |
| 63 | Conditional Studio extension: enumerate visible controls only if build enables it | extensions/studioExtension | pending |
| 64 | Hidden/legacy entrypoints: CC triangle/shape-gradient, auxiliary pages; establish reachability before scope | presets, pages, extension entrypoints | pending |
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
