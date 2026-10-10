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
| 20 | CC shape/basic geometry: freehand/rectangle/ellipse/line/click-line, constraints, direction, preview/commit/cancel | CC gradient drawing runtime | pending |
| 21 | Checkered brush: cell size, colours, spacing, opacity, shape/selection | brush engine/settings | pending |
| 22 | Rectangle Gradient: stops/direction, drag/constraint, commit/cancel | shape handlers, gradient brush | pending |
| 23 | Spam Text: content, font/size, spacing, colour, pressure, rotation | text brush/settings | pending |
| 24 | Resampler: source sampling, tap/drag, size, filtering, alpha, edges | resampler brush/runtime | pending |
| 25 | Mosaic: source/colour, tile settings, geometry, preview/commit | mosaic brush/runtime | pending |
| 26 | Shape Pattern: each exposed fill strategy and controls, boundaries, colour, preview/final | shapeFill, shape handlers/settings | pending |
| 27 | Custom brush capture: region, alpha, normal/CC data, save/name/default, reload | custom tool, brush editor, project slice | pending |
| 28 | Custom brush painting/edit/removal: size/rotation/pressure/spacing, palette, defaults, library | BrushLibrary, custom presets, brush runtime | pending |
| 29 | Shared brush controls: shape mode/basic shapes, constraints, grid snap, dashed strokes, antialiasing, custom pattern creation/import/local library, reset/per-preset persistence | BrushControls, tools slice | pending |
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
