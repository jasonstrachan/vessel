# Unresolve resolved states

Outcome: choose One state or Two states at the top of Effects → Unresolve.
Two states exposes State A and State B. Selecting a state pauses at its resolved
position and selects its editable CC drawing. B starts blank and can copy A.
One state retains B for later use.

Owner: private Studio `unresolve/UnresolveControls.tsx`, `unresolveStates.ts`,
`unresolveStateModel.ts`, and `unresolveClock.ts`. Each state is a native CC layer;
native stroke history, masks, and project persistence remain authoritative.

Public scope: `src/lib/colorCycle/playbackClock.ts` supplies a generic sampled
opacity curve; `src/lib/ColorCycleAnimator.ts` applies it only to presentation.
`src/utils/export/goblet/gobletTypes.ts`, both Goblet runtime sources and their
generated inline bundles retain the same clock and opacity semantics. Regression
coverage belongs beside Unresolve, the animator, and the Goblet runtime tests.
The artist guide records the resulting workflow.

Non-goals: geometric stroke correspondence, optical flow, more than two drawings,
or changes to ordinary CC playback. The transition blends independently cycling
drawings. Hidden or deleted native layers retain their normal layer semantics.

Verification: deterministic endpoint/motion tests; state selection, Copy A and
history tests; export opacity parity; Studio type check and lint; production
Studio painting, switching, playback, One/Two round trip, save/load and Goblet.
Complete when both drawings survive those interactions and both playback paths
resolve A and B at the same points in the cycle.

Verified on the production Studio service (17 September 2026): independently
painted A and B, resolved selection, all four motion endpoints, moving intermediate
frames, Copy A into both populated and blank B, undo, One/Two retention, deleting
and recreating B, and native `.vs` save/load. The two resolved drawings each
contained 5,704 painted pixels and retained identical pixel hashes after reload.
Goblet2 JSON was exported through the UI and reopened in the standalone viewer;
both endpoint hashes matched Studio exactly at native 768 × 960 resolution.

Review found that selecting B through the native layer list could leave it fully
transparent at A's cycle position. The shared-clock subscription now pauses and
seeks the selected paired drawing, with deterministic and production pixel proof.
The live B selection changed from zero alpha to the full authored drawing.

Commit scope also includes the existing Unresolve enable/source-control wiring
required to author the paired drawings. Motion-preference persistence and all
unrelated foreground, replay, and shape changes remain outside these commits.
The isolated commit copy passed 84 private Unresolve tests and 120 focused public
tests. Shared-worktree full tests encountered unrelated foreground/shape and
multiplayer test failures; verification of the isolated commit is recorded below.
The generated Goblet inline bundles were rebuilt. Evidence is in
`output/playwright/unresolve-two-states-{a,b,goblet}.png`,
`output/playwright/unresolve-two-states.vs`, and
`output/playwright/unresolve-two-states.json`.

Final isolated verification: production Studio build, public and Studio type-check,
lint, and 84 Unresolve tests passed. The full public run passed 555 suites and
4,585 tests; its sole failing test needed Git metadata absent from the temporary
copy. After supplying that metadata, the entire 20-test playback-gate suite
passed. The three shared-worktree failures passed in the isolated copy.
Direct layer selection and the full A/B copy/undo/motion workflow passed in the
isolated production build on port 3012. The test browser and temporary server
were closed afterward.
