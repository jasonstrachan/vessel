# Color Cycle Continuous Playback

Status: Completed (2026-04-08)

## Problem

CC playback visibly steps at slow speeds because every path floors the phase to an integer palette index before lookup.

## Solution

Keep indexed authoring/storage as the compact data format. Playback always interpolates continuously through gradient stops — phase stays float through the full render pipeline.

## Architecture

Three layers, already built:

1. **Canonical model** (`src/lib/colorCycle/playback/`) — owns behavior. One CPU sampler function (`sampleContinuousColor`) is the authority.
2. **Storage** — unchanged compact buffers (paint/index, gradientId, speed, flow, phase, defId). Byte speed is compatibility input; `speedCps` float is runtime authority for new content.
3. **Renderer** — consumes playback defs, renders continuous. GPU may approximate via LUT with linear sampling but must match CPU output.

## Rules

- Authoring, commit, undo/redo, save/load stay CPU-canonical
- GPU is an acceleration backend, never the behavior authority
- No `floor(phase * N)` in the playback path
- No per-frame mutation of stored buffers
- Seam handling is part of the canonical sampler, not a renderer post-process
- Pingpong/reverse flow transforms phase before sampling, not after
- Export explicitly rejects what it can't support — no silent corruption
- No new abstraction without a concrete bug or feature requiring it

## Finalize Contract

After finalize, the layer must render and play back from committed CC state only. Preview, overlay, drag, tool, and session state may affect authoring — they must not affect finalized playback.

Finalize is successful only if:

1. Authored inputs are frozen
2. Final bindings are resolved
3. Committed CC state is written
4. Committed redraw can be rebuilt from committed state alone
5. Subsequent playback reads committed state, not preview/session state

## Forbidden Post-Finalize Dependencies

After finalize, playback/render must not depend on:

- Active preview sessions
- Overlay state
- Drag/interact state
- Compositor preference flags
- Temporary live preview bindings
- Preview pause/resume behavior
- Tool-specific editor state

## Legacy Migration

- Old files: `speedCps` derived from byte speed on load — no destructive migration
- New files: `speedCps` is the authority, byte speed is derived compatibility data
- If authoritative `speedCps` is present, playback never reads byte speed directly

## Authoring Integrity Gate

**No playback change ships without passing these. Run before and after every change.**

1. Draw gradient CC stroke → finalize → stroke persists with correct colors
2. Undo → redo → colors and CC metadata intact
3. Save → close → reopen → CC strokes play back correctly
4. Export → explicit pass or explicit rejection, no silent remapping
5. Rebuild/redraw after finalize → committed CC still renders from committed state

If any break, revert.

## What's Done

- Playback runtime boundary under `src/lib/colorCycle/playback/`
- Canonical CPU continuous sampler
- `Renderer2D` continuous path
- GPU continuous path in `WebGLColorCycleRenderer`
- Per-def runtime playback flows through `ColorCycleAnimator`
- Export rejects unsupported continuous playback
- Save/load/history persists `playbackMode`
- Gradient editor preview deferred to editor commit boundary

## Remaining

- GPU shader duplicates TypeScript playback helpers — intentional, GLSL can't share TS
- Future: continuous-capable export format (versioned, not silent)

## Complexity Check

The architecture is built. Going forward:
- If GPU drifts from CPU, fix the GPU path
- If something breaks authoring, the gate catches it
- If it can't be grepped, it's too clever