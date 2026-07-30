# AGENTS.md — Vessel

## Scope

These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

Deliver complete, production-oriented work. Test doubles are acceptable at I/O boundaries, but runtime fixes require real integration or end-to-end validation on the reported path.

## Working Agreement

- Prefer direct execution when the task is clear. Ask before writing when requirements are materially ambiguous; when unattended, use the most reasonable interpretation and record it.
- Read the local implementation before making architectural assumptions. Use `rg` and `rg --files`; read files in chunks of at most 250 lines.
- Keep code changes minimal and scoped. Do not alter unrelated work; report nearby design problems separately.
- For plans and bug fixes, keep them scoped to the actual root cause. Treat 6 files as a strict scope guide, not a hard gate; if more files are directly required, explain the expansion before proceeding and keep every changed file necessary to the fix.
- Fix the source invariant first. Trace the real path; do not add wrappers, helper layers, or downstream compensation around a broken authority. Remove directly superseded workarounds when safe; otherwise explain why they remain or why the source cannot change.
- Prefer the simplest explicit solution that satisfies the requirement. Reuse existing seams before adding abstractions; suggest a better approach when it materially reduces lasting risk or churn.
- State uncertainty. A small, localized experiment is preferable to speculation.
- For significant work, follow: understand → design → implement → test → refine. Plans begin with clear outcome goals; those goals determine the non-goals, required scope, owners, expected files, verification, and stop conditions. Define clear, measurable exit criteria that prove the goals are met and state when the work is finished. Scope is tight when every included task directly advances or proves a goal—not when file count or patch size is minimized arbitrarily. Treat the file list as a hard boundary; explain before expanding it. Keep one plan step active. Document only when required by a project contract or durable behavior change.
- Preserve public contracts and call out breaking changes.
- Stay on the current branch unless the user requests otherwise. Never default to a `codex/` branch name.

## Project

- Next.js + TypeScript, statically exported for GitHub Pages.
- `next.config.ts` owns `basePath` and `assetPrefix`; preserve `/vessel` unless explicitly asked to change it.
- Preserve the build-injected `env.BUILD_TIMESTAMP`.
- `tsconfig.json` defines the `@/*` alias; use it instead of deep relative imports.
- App Router entrypoints: `src/app/layout.tsx` and `src/app/page.tsx`.
- `src/pages/**` contains legacy/auxiliary routes and requires default exports.
- Main domains:
  - UI and canvas: `src/components/**`
  - input and engine orchestration: `src/hooks/**`
  - brushes: `src/brushes/**`
  - Zustand state: `src/stores/**`
  - rendering and color-cycle logic: `src/lib/**`
  - utilities and services: `src/utils/**`
  - workers: `src/workers/**`
  - tests: `tests/**` and `src/**/__tests__/**`

Runtime flow: input hooks → store/engine → renderer. Keep heavy gradient computation in the worker where appropriate.

## Discovery and Design

- Read `README.md` and relevant `docs/**` before coding.
- For UI or canvas flows, begin at `src/app/page.tsx` and follow `@/*` imports through the execution path.
- Search for an existing component, hook, handler, service, utility, plugin, or test before creating one.
- Check nearby tests and fixtures in `assets/**` and `public/**`.
- For revived or removed features, also inspect `refactor/**`, `agents/**`, and `docs/**` for prior decisions.
- Extend established seams such as `retroui/ui`, `BrushRegistry`/`BrushPlugin`, `src/lib`, and `src/utils` before introducing a new boundary.
- If replacing a path, adapt or remove the old entrypoint in the same change.

## Implementation Conventions

- Use TypeScript; avoid `any`. Prefer explicit types, discriminated unions, and options objects for large signatures.
- Use named exports except where Next.js requires a default export.
- Import order: standard library, third-party, then `@/*`, separated by blank lines. Avoid deep barrel re-exports.
- Format with 2 spaces, semicolons, trailing commas where valid, and single quotes in TS/TSX.
- Naming: PascalCase for components/types, camelCase for hooks/utilities, `is`/`has`/`can`/`should` for booleans, and UPPER_SNAKE_CASE for constants.
- Keep modules single-purpose and pure by default. Extract on the third repetition or when logic cannot be tested without mounting broad UI state.
- Return new values rather than mutating inputs. Centralize side effects and clean them up.
- Add JSDoc only for non-obvious exports; comments explain why, not what.
- Avoid per-frame allocations. Reuse buffers, typed arrays, and canvas pools; memoize only where it provides a measured benefit.
- Fix lint warnings introduced by the change.

### React and UI

- Add `'use client'` only when required. Use functional components.
- Keep presentational components stateless and avoid duplicating global state locally.
- Pass narrow props; stabilize callbacks or derived values when it prevents meaningful downstream work.
- Effects must have complete dependency arrays; document deliberate stability.
- Prefer Tailwind for layout and utilities, CSS for complex editors, and inline styles only for dynamic or performance-critical values.
- Keep Vessel buttons square by default. Do not add border-radius styles or `rounded*` utilities to buttons unless the user explicitly requests an exception.
- Use `debugLog`/`devLog` and keep console noise low. Prefer visible in-app diagnostics for signals needed during interactive testing.
- Surface user-facing errors non-blockingly; fail fast on programmer errors.

### State

- Keep persisted Zustand state serializable; explicitly mark ephemeral state and do not persist it.
- Use selectors to limit re-renders. Avoid `getState()` in components; reserve it for utilities and effects.
- Never mutate arrays or objects in place. Name actions imperatively.
- Put state and actions in `src/stores/slices/**`, compose them in `useAppStore.ts`, and keep initial state in its slice.
- Export the slice interface and factory; place shared helpers in `src/stores/helpers/**`.
- Prefer injected dependencies in slice factories and update `src/stores/__tests__/**` for behavior changes.

### Brushes and Workers

- Brushes implement `BrushPlugin` and must not access the store directly.
- Share brush helpers through `src/utils` or `src/lib`.
- Define typed worker messages and responses; keep messages small and use transferable objects where possible.

## Canvas Architecture Guardrails

The following orchestration files are composition shells, not homes for workflow logic:

- `src/hooks/useDrawingHandlers.ts`
- `src/components/canvas/DrawingCanvas.tsx`
- `src/hooks/canvas/useCanvasEventHandlers.ts`

For these files:

- Move workflow logic to `src/hooks/canvas/handlers/**` and pure computation to `src/hooks/canvas/utils/**`.
- Soft limit: 400 lines. Hard limit: 700 lines; exceeding it requires a documented exception and split follow-up in `docs/refactor/**`.
- Extract when a file owns three independent concerns, a pattern repeats three times, or logic cannot be tested without broad UI setup.
- New canvas features must follow components → hooks → handlers/utils → store/lib. Define a small boundary module first if the feature does not fit cleanly.
- When touched, check line count with `wc -l`, add targeted tests, and update `docs/refactor/module-size-guardrails.md` plus the active plan when boundaries change.

Keep Vessel runtime and Goblet export behavior synchronized for animation and playback changes; update both implementations and their tests together.

For color-cycle flat-fill fixes, repair signal mapping or ink selection only. Do not inject jitter/noise or change dither algorithm selection as a workaround.

## WebGPU Guardrails

- Use one coordinate space per buffer. Store XY in world/pixel space; normalize in the vertex shader: `uv=(pos-min)/size`, `ndc=uv*2-1`, `ndc.y*=-1`.
- Match buffer layouts to shaders. XY-only data uses stride 8 and `float32x2 @location(0)`.
- During bring-up, disable depth/blend, use fragment alpha 1, draw a small point-list first, then an even-count line-list.
- Bounds must never be zero; default to the render target and clamp with `max(size, 1e-6)`.
- Set viewport and scissor explicitly. Cache pipelines by shaders, layout, format, topology, depth, and blend.
- Validate with WebGPU error scopes, `getCompilationInfo()`, and `naga validate` in CI.
- For readback, use 256-byte-aligned `bytesPerRow` and repack rows. Compute passes must write XY only and correctly reset/read counter buffers.
- Common failure modes: shader/layout mismatch, zero bounds, odd line counts, hidden output from depth/blend, misaligned readback, and mixed coordinate spaces.

## Evidence and Verification

- Prove the failing path before patching and the same path after patching. A build, unit test, or review alone does not prove a runtime fix.
- Do not claim, commit, or push a runtime fix until the exact reported interaction passes in the live production preview. If that proof is unavailable, label it unverified.
- If an attempt is rejected or ineffective, remove it completely before trying another approach. Do not stack speculative patches.
- Add or update deterministic tests for logic changes. Use Testing Library for React and mock canvas APIs only where necessary.
- Run the smallest meaningful check first, then broaden according to risk. Before a PR, run:
  - `npm run type-check`
  - `npm run lint`
  - `npm test`
- Keep implementation feedback fast by default: run affected test files during iteration, then run type-check and lint once after the code settles. Reserve the full test suite for the PR/commit gate, an explicit request, or a change whose risk requires it.
- For production-preview verification, exercise the exact reported interaction with one consolidated browser script where practical. Avoid repeated snapshots, fixed waits, and broad diagnostic dumps unless a failure needs investigation.
- Run `npm run build` when build/static-export behavior is affected, and manually verify `/vessel` URLs when routes or assets change.
- `npm run preview:prod:watch` owns the production build while active. Do not run a separate build in parallel; use its output or stop it first.

## Git and Secrets

- Preserve the dirty worktree and stage only task files. Use Conventional Commit prefixes, keep commits focused, and do not add license/header boilerplate.
- Never print or quote real secrets from `.env*`, the shell, logs, screenshots, or configuration.
- Exclude `.env*` from broad searches. Inspect it only when required and redact values in output.
- Keep `.env*` ignored; use placeholders in `.env.example`.
- If a secret appears in output or history, identify the exposed key without repeating its value, recommend immediate revocation, and remove the local copy.
- Before committing, avoid secret-bearing files and use `gitleaks` or `detect-secrets` when exposure is plausible.

## Commands and Troubleshooting

- Development: `npm run dev` or `npm run dev:raw`
- Production: `npm run build`, then `npm start`
- Checks: `npm run type-check`, `npm run lint`, `npm test`
- Cleanup: `npm run clean`, then `npm run cache:clear`
- Dev defaults to port 3000. If behavior is stale, ensure there is only one server before clearing caches.
