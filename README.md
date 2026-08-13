# Vessel

Vessel is a browser-based drawing application for layered artwork, custom brushes, color-cycle animation, and Goblet exports.

The app is a Next.js App Router project that runs as a client-mounted workspace. The main drawing surface is Canvas2D. Color-cycle playback, Goblet runtime output, and animated export paths use WebGL-backed runtime code; browser WebGL support is part of the current app requirement.

## Current App Shape

- **Canvas workspace**: `src/app/page.tsx` mounts `HomeClientMount`, which initializes store runtime state and renders `HomeClient`.
- **Primary UI**: a left toolbar, central `DrawingCanvas`, a layer/alignment/animation column, and a brush/color/settings column.
- **State**: Zustand store in `src/stores/useAppStore.ts`, composed from slices for project, layers, tools, selection, crop, canvas, history, autosave, color-cycle, sequential recording, and UI.
- **Drawing engine**: Canvas input and rendering flow through `src/components/canvas/**`, `src/hooks/useDrawingHandlers.ts`, `src/hooks/canvas/**`, and `src/hooks/brushEngine/**`.
- **Export system**: PNG export lives in `src/utils/projectIO.ts`; GIF/video export lives in `src/utils/export/exportService.ts`; Goblet export is owned by `src/utils/export/goblet/**`.

## Features

### Drawing And Editing

- Brush, custom brush, eraser, fill, selection, magic wand, eyedropper, crop, Hue/Sat, grid, save/load, and export tools.
- Pressure-aware brush controls, spacing, dashed strokes, dither controls, shape mode, grid snapping, and custom brush capture.
- Selection, crop, paste overlay, alignment, layer ordering, visibility, opacity, blend mode, layer groups, and sequential animation layers.
- Display filters for the viewport/post-process stack, configured from the brush settings panel.

### Color Cycle

- Color-cycle brush layers with indexed color buffers, gradient/slot metadata, speed/flow/phase buffers, erase masks, soft-edge masks, and playback controls.
- Recolor layers and color-cycle/recolor controls through the brush library/settings flow.
- Worker-assisted color-cycle composition and WebGL-backed Goblet playback/export paths.

### Persistence

- Project save/load through `.vs`/archive payloads handled by `src/utils/projectIO.ts`.
- Load modal supports file and folder flows, preview manifests, project health reports, and repair/export paths.
- Autosave and backup state are managed by `src/utils/autosave.ts`, `src/utils/backgroundStorage.ts`, `src/utils/fileBackupService.ts`, and the autosave store slice.

### Export

- PNG export for static images.
- GIF export through `gifenc`.
- Video export through `MediaRecorder`, with WebM fallback when MP4 is unsupported by the browser.
- Goblet export formats:
  - smaller zip with sidecar JSON/binary buffers,
  - compatible zip with embedded metadata fallback,
  - single self-contained HTML,
  - JSON-only inspection/debug bundle.

See `docs/exporting.md` for Goblet packaging details.

## Technical Stack

- Next.js 15 App Router
- React 19
- TypeScript 5
- Zustand 5
- Tailwind CSS 4
- Canvas2D, WebGL, Web Workers
- `gifenc`, `fflate`, and `jszip` for export packaging

## Requirements

- Node.js `22.22.0` with npm. The repo includes `.nvmrc`.
- A modern browser with Canvas2D, WebGL, IndexedDB, Web Workers, and MediaRecorder support for the full feature set.

## Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful local commands:

```bash
# Raw Next dev server
npm run dev:raw

# Monitored dev server, default local workflow
npm run dev

# Isolated production preview build + server on /vessel/
npm run preview:prod

# Serve the current out/ static export on port 4000
npm run preview
```

`preview:prod` builds into `.next-preview` and serves on `http://localhost:3001/vessel/`, separate from the dev server's `.next` state.

## Build And Deploy

The public static export is wrapper-owned by `scripts/github-pages-build.mjs` and `scripts/prepare-github-pages.mjs`.

```bash
# Build the static export for /vessel/
npm run build:github

# Same command under the repo Node version when using mise
mise exec node@22 -- npm run build:github
```

Static export mode uses:

- `output: 'export'`
- `basePath: '/vessel'`
- `assetPrefix: '/vessel/'`
- output artifact: `out/`

The current public deployment target is `https://jasonstrachan.com/vessel/`.

### Website sync

Pushes to `main` build the static export and then dispatch the
`vessel-static-export` workflow in `jasonstrachan/jasonstrachan.com`. That
website workflow rebuilds this repo at the exact pushed SHA, runs the website
repo's `npm run vessel:sync`, verifies the website build, and commits only
`public/vessel`.

The playback guard compares `main` against the last successful Vessel export,
so changes from a failed deployment remain in scope on the next push. Install
the repository pre-push guard once per checkout to run the same contract check
against the remote branch before GitHub accepts the push:

```bash
npm run hooks:install
```

Required repository secret:

- `WEBSITE_DEPLOY_TOKEN` - token available to this repo's Actions workflow that
  can create `repository_dispatch` events in `jasonstrachan/jasonstrachan.com`.

## Verification

Common checks:

```bash
npm run audit:prod
npm run lint
npm run architecture:check
npm run type-check
npm run type-check:workers
npm run type-check:tests
npm test
npm run verify:goblet2-inline
```

Targeted checks:

```bash
npm run test:load-project-modal:guardrails
npm run test:e2e:load-project-modal
npm run test:goblet2:single-file-smoke
npm run test:goblet2:cc-gradient-shapes-perf
```

## Security And Audit Status

- `npm run audit:prod` is the production dependency release gate.
- Current accepted production exception: Next vendors nested `postcss@8.4.31`, which npm flags as `postcss <8.5.10`. Vessel publishes a static export with no production Next server runtime. See `docs/refactor/plan-next-audit-remediation-2026-06-21.md`.
- Full audit is report-only visibility:

```bash
npm run audit:full
npm run audit:full:json
npm run audit:full:summary
```

See `SECURITY.md` and `docs/security/dev-tooling-audit-remediation.md`.

## Project Structure

```text
src/
├── app/                  # Next app routes and client workspace mount
├── brushes/              # Brush plugin interface, registry, plugins, shapes
├── components/           # Toolbar, panels, canvas, modals, color-cycle UI
├── config/               # Feature flags
├── constants/            # Shared constants
├── history/              # History manager, deltas, runtime rehydration
├── hooks/                # Brush engine, canvas handlers, input/state machines
├── lib/                  # Rendering, color-cycle, sequential, display-filter libs
├── presets/              # Brush presets
├── stores/               # Zustand store, slices, selectors, layer services
├── styles/               # CSS beyond app globals
├── types/                # Shared TypeScript types
├── utils/                # Persistence, export, canvas, color, debug utilities
└── workers/              # Worker entry points
```

Other important paths:

- `tests/` and `src/**/__tests__/` for Jest and Playwright coverage.
- `scripts/` for build, preview, audit, and architecture guardrails.
- `docs/` for architecture notes, export docs, bug records, and refactor plans.
- `public/goblet/` and `public/goblet2/` for Goblet runtime assets.

## Notes For Public Consumers

This repository is public and licensed under the MIT License. It is still marked `"private": true` in `package.json` to prevent accidental npm publishing.
