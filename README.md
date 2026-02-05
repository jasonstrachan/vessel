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
  - Terminal B (static preview): `npm run build` then `npm run preview:prod` → `http://localhost:3001`
  - Use `npm run preview` to serve `out/` on port 4000 for GH Pages parity.

### Build & Deploy

```bash
# Build for production
npm run build

# Preview production build alongside dev (port 3001, static export)
npm run preview:prod

# Preview static export (serves /out on port 4000)
npm run preview
```

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
