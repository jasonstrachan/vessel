# Vessel

A browser-based drawing application with advanced brush tooling, color-cycle animation, and layered compositing.

## Overview

Vessel is built with Next.js (App Router) and a custom Canvas2D rendering pipeline, with optional WebGL acceleration for color-cycle layers. It combines a modern panel-based workspace with a plugin-friendly brush system, gradient tooling, and export formats tuned for animated artwork. The project ships as a static export for GitHub Pages, using a `/vessel` basePath and assetPrefix.

## Key Features

### Drawing Tools
- **Brush / Eraser / Fill**: Standard tools with pressure-aware stroke controls
- **Selection / Crop**: Marquee selection and crop overlays with handle UI
- **Eyedropper / Zoom**: Sampling and navigation helpers
- **Color Cycle + Recolor**: Animated gradient layers and recolor workflows
- **Color Adjust**: Dedicated panel for per-layer color adjustments

### Brush System
- **Preset + Custom Brushes**: Presets, user-defined brushes, and thumbnail generation
- **Brush Plugins**: Plugin registry for discoverable brush implementations
- **Spacing & Patterns**: Distance-based spacing, dotted/dash patterns, and pixel-perfect modes
- **Pressure Handling**: Pointer-pressure mapping via `pressureOptimizer`
- **Settings Persistence**: Brush-specific slider/toggle values are saved between sessions

### Layers & Animation
- **Layer Stack**: Visibility, ordering, alignment controls, and layer metadata
- **Color Cycle Animation**: Per-layer animation speed/FPS controls with playback panel
- **Recolor Mode**: Extract palettes from existing artwork and animate recolor layers
- **Undo/Redo**: History snapshots with configurable limits

### Advanced Features
- **Autosave & Recovery**: Background autosave service with restore flow
- **Export Modal**: PNG, GIF, MP4/WebM, and WebGL “Goblet” bundles
- **Keyboard Shortcuts**: Centralized shortcut scope management
- **Clipboard Paste**: Floating paste overlay support

## Architecture

### Core Components

#### Canvas Suite (`/src/components/canvas/`)
- **DrawingCanvas.tsx**: Core rendering surface and input bridge
- **BrushCursor.tsx**: Brush cursor overlay
- **CropOverlay.tsx** / **SelectionMarqueeHandles.tsx**: Editing overlays
- **SimplifiedColorCycleManager.ts**: Color-cycle layer management

#### Panels & UI (`/src/components/panels/`)
- **LayersPanel**, **AlignmentPanel**, **AnimationControlsPanel**
- **ColorPickerPanel**, **BrushLibraryPanel**, **BrushSettingsPanel**
- **ColorAdjustmentsPanel**, **CropOptionsPanel**, **ColorSlidersPanel**

#### Modals (`/src/components/modals/`)
- **DocumentModal**, **ExportModal**, **SettingsModal**, **LoadProjectModal**

#### State Management (`/src/stores/`)
- **useAppStore.ts**: Centralized Zustand store (project, layers, tools, history, autosave)

#### Rendering & Color Cycle (`/src/lib/`)
- **IndexBuffer**, **GradientPalette**, **AnimationController**, **ColorCycleAnimator**
- Optional WebGL renderer in `src/lib/colorCycle/rendering` with Canvas2D fallback

### Refactor Notes
- `docs/refactor/cc-gradient-slots.md` — Slot/def binding rules and reservations

### Project Docs
- `docs/project.md` — Consolidated architecture notes and recent updates

### Recent Updates (from `docs/project.md`)
- **Display Filters (2026-04-13):** runtime-only artwork post-processing with persisted filter presets in the brush settings panel
- **Canvas Shape Masks (2026-01-03):** non-rectangular canvas bounds, clipped draw/selection, export masking
- **Color Cycle + Recolor (2025-12-31):** recolor mode with palette extraction and deterministic export
- **Color Cycle Brush System (2025-08-27):** Canvas2D-first indexed pipeline with optional WebGL accel

## Technical Stack

- **Next.js 15 (App Router)** + **React 19**
- **Zustand 5** for state
- **Tailwind CSS 4** for styling
- **TypeScript 5**
- **gifenc** for GIF export

## Development

### Prerequisites
- Node.js 18+ with npm
- Modern browser with Canvas2D support (WebGL optional for color-cycle acceleration)
- Optional: `nvm use` (repo includes `.nvmrc`)

### Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Start development server**
   ```bash
   npm run dev
   ```

3. **Open in browser**
   ```
   http://localhost:3000
   ```

### Alternative Dev Modes
- **Raw Next.js dev**: `npm run dev:raw`
- **Monitored dev server**: `npm run dev` (default)

### Workflow
- Work directly on the `poc2` branch (no feature branches).
- Recommended local workflow:
  - Terminal A (dev): `npm run dev` → `http://localhost:3000`
  - Terminal B (isolated prod preview): `npm run preview:prod` → `http://localhost:3001/vessel/`
  - Use `npm run preview` to serve `out/` on port 4000 for GH Pages parity.

### Build & Deploy

```bash
# Build for production
npm run build

# Build an isolated prod preview artifact alongside dev
npm run preview:prod:build

# Serve the isolated prod preview artifact on port 3001
npm run preview:prod:serve

# Build + serve isolated production preview alongside dev (port 3001)
npm run preview:prod

# Preview static export (serves /out on port 4000)
npm run preview
```

`preview:prod` now uses a dedicated `.next-preview` output directory so it can be rebuilt and served without touching the dev server's `.next` state on port `3000`.
`preview:prod:serve` also uses a per-repo lock file in the system temp directory, so a second preview server instance fails cleanly instead of competing for port `3001`.
Runtime logs for dev and prod preview now persist under `logs/runtime/dev-server.log` and `logs/runtime/preview-server.log`, including child output, startup/shutdown events, and uncaught errors.
Those logs also include periodic heartbeats and simple event-loop lag warnings, so a lockup that does not crash still leaves evidence in the log timeline.
`preview:prod:build` now runs `next build` inside an isolated temp workspace before copying the `.next-preview` artifact back, which avoids the Next 15 dev/build conflict that can corrupt the live `.next` dev directory.

### Security Checks
- Production dependency audit (recommended gate): `npm run audit:prod`
- Full dependency audit (includes dev tooling): `npm run audit:full`
- Full dependency audit JSON export: `npm run audit:full:json` (writes `audit-full.json`)
- Full dependency audit summary export: `npm run audit:full:summary` (writes `audit-full-summary.md`)
- Dev-tooling remediation plan: `docs/security/dev-tooling-audit-remediation.md`

## Project Structure

```
src/
├── app/                  # Next.js app directory
│   ├── page.tsx         # Main application shell
│   ├── layout.tsx       # Root layout + global styles
│   └── globals.css      # Global styles
├── components/          # React components
│   ├── canvas/          # Drawing canvas system
│   ├── panels/          # Right-side panels
│   ├── toolbar/         # Toolbars and tool controls
│   ├── colorCycle/      # Color-cycle + recolor UI
│   └── modals/          # Modal dialogs
├── hooks/               # Custom React hooks (brush engine, input, state machines)
├── stores/              # Zustand state slices
├── lib/                 # Core rendering + animation libs
├── brushes/             # Brush plugins and shapes
├── utils/               # Utilities (autosave, export, canvas ops)
└── workers/             # Web workers (e.g., gradient worker)
```

## Performance Notes

- **Indexed color buffers** via `IndexBuffer` reduce memory pressure
- **Canvas pooling** and caching reduce per-stroke allocations
- **Gradient work offloaded** to `gradientWorker` when enabled
- **Optional WebGL** path for accelerated color-cycle rendering

## License

TBD

## Security

See `SECURITY.md` and `docs/security/dev-tooling-audit-remediation.md`.
