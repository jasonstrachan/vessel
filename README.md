# Vessel

A sophisticated web-based drawing application with animation capabilities, advanced brush tools, and layer management.

## Overview

Vessel is built with Next.js 15 and P5.js, providing a high-performance drawing experience with pixel-perfect rendering, custom brushes, and comprehensive animation tools. The application features a dark theme design with professional-grade drawing capabilities.

## Key Features

### Drawing Tools
- **Brush Tool**: Advanced brush system with pressure sensitivity simulation
- **Eraser Tool**: Precision erasing with configurable brush settings
- **Fill Tool**: Intelligent flood fill with tolerance controls
- **Selection Tool**: Rectangle and brush selection modes
- **Clear Tool**: Quick layer clearing functionality

### Brush System
- **Preset Brushes**: Pixel art, soft brush, chalk, and specialized brushes
- **Custom Brushes**: User-created brushes with thumbnail generation
- **Dotted Patterns**: Configurable dash patterns for artistic effects
- **Pixel-Perfect Mode**: Ensures crisp pixel art with spacing control
- **Distance-Based Spacing**: Intelligent brush stroke spacing for natural drawing

### Animation & Layers
- **Layer Management**: Multiple layers with visibility controls and reordering
- **Frame-Based Animation**: Timeline with play/pause and frame navigation
- **Onion Skinning**: Previous/next frame visualization for smooth animation
- **FPS Control**: Configurable frame rate for animation playback

### Advanced Features
- **Clipboard Integration**: System clipboard support with image paste
- **Zoom & Pan**: Smooth canvas navigation with mouse wheel support
- **Keyboard Shortcuts**: Comprehensive hotkey system for efficient workflow
- **Export Options**: GIF animation and PNG frame export
- **Undo/Redo**: Frame-based history with 5-action limit

## Architecture

### Core Components

#### Canvas System (`/src/components/canvas/`)
- **DrawingCanvas.tsx**: Core P5.js-based drawing engine with performance optimizations
- **ClientOnlyCanvas.tsx**: SSR-safe wrapper for dynamic loading

#### Toolbar System (`/src/components/toolbar/`)
- **LeftToolbar.tsx**: Tool selection interface
- **Toolbar.tsx**: Comprehensive brush settings and controls
- **CustomBrushPanel.tsx**: Custom brush creation and management
- **ColorPicker.tsx**: Color selection with hex input support

#### Timeline System (`/src/components/timeline/`)
- **Timeline.tsx**: Animation timeline with frame visualization
- **LayerPanel.tsx**: Layer management interface
- **FrameControls.tsx**: Animation playback controls

#### State Management (`/src/stores/`)
- **useAppStore.ts**: Centralized Zustand store managing project state, tools, and canvas interactions

### Technical Stack

- **Next.js 15.3.4**: React framework with SSR support
- **P5.js 2.0.3**: High-performance canvas rendering engine
- **Zustand 5.0.6**: Lightweight state management
- **Tailwind CSS 4**: Utility-first styling framework
- **TypeScript 5**: Type safety and development experience
- **gif.js 0.2.0**: GIF export functionality

## Development

### Prerequisites
- Node.js 18+ with npm
- Modern web browser with HTML5 Canvas support

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/vessel.git
   cd vessel
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npx next dev
   ```

4. **Open in browser**
   ```
   http://localhost:3000
   ```

### WSL2 Development Notes
For WSL2 environments, use explicit hostname binding:
```bash
npx next dev --hostname 0.0.0.0
```

Test connectivity with:
```bash
curl -I http://127.0.0.1:3000
```

### Build & Deploy

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Usage

### Basic Drawing
1. Select the Brush tool (B key)
2. Choose brush size and color
3. Click and drag to draw on the canvas
4. Use zoom controls or mouse wheel to navigate

### Animation Workflow
1. Create multiple layers for different elements
2. Use frame controls to navigate through animation
3. Enable onion skinning to see previous/next frames
4. Export as GIF when animation is complete

### Keyboard Shortcuts
- **B**: Brush tool
- **E**: Eraser tool
- **G**: Fill tool
- **S**: Selection tool
- **C**: Clear tool
- **[/]**: Decrease/increase brush size
- **Enter**: Play/pause animation
- **Arrow Keys**: Navigate frames
- **Ctrl+C/V/X**: Copy/paste/cut
- **Ctrl+Z/Y**: Undo/redo

### Custom Brushes
1. Open the custom brush panel
2. Create or import brush patterns
3. Configure brush settings (size, spacing, rotation)
4. Save to brush library for reuse

## Project Structure

```
src/
├── app/                  # Next.js app directory
│   ├── page.tsx         # Main application entry point
│   ├── layout.tsx       # Root layout with font loading
│   └── globals.css      # Global styles and design system
├── components/          # React components
│   ├── canvas/          # Drawing canvas system
│   ├── toolbar/         # Tool and brush controls
│   ├── timeline/        # Animation timeline
│   └── ui/              # Shared UI components
├── hooks/               # Custom React hooks
│   ├── useKeyboardShortcuts.ts
│   ├── useP5.ts
│   └── useToast.ts
├── stores/              # Zustand state management
│   └── useAppStore.ts   # Centralized application state
├── types/               # TypeScript type definitions
│   └── index.ts         # Core types and interfaces
└── utils/               # Utility functions
    └── export.ts        # Export functionality
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Performance Optimizations

- **Canvas Pooling**: Reuses canvases for custom brush rendering
- **Rotation Caching**: Caches rotated brush patterns to avoid recalculation
- **Frame-based Rendering**: Throttles drawing to 60 FPS
- **Dynamic Loading**: Canvas components load client-side only
- **P5 Framebuffer Integration**: Each layer uses P5 framebuffers for optimal performance

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open an issue on GitHub.