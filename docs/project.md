# TinyBrush Consolidated Documentation

## Recent Updates

### Dynamic Canvas Size (2025-01-13)
- **Removed hardcoded 2000x2000 canvas limit**: Canvas can now be any custom size
- **New default dimensions**: 1920x1080 (HD resolution) for better performance
- **Canvas size presets added to Document Modal**:
  - HD (1920×1080)
  - Full HD (1920×1200) 
  - 4K (3840×2160)
  - Square formats (1024×1024, 2048×2048)
  - A4 Portrait (2480×3508) and Landscape (3508×2480)
  - Mobile (1080×1920) and Tablet (1536×2048) sizes
- **Memory usage warnings**: Displays estimated memory usage and warns when >500MB
- **Resize existing canvas**: Maintains content centered when resizing
- **Custom dimensions**: Full support for any width/height via input fields

### Enhanced Dithering Algorithms (2025-01-12)
- **Added three new dithering algorithms** to expand artistic options beyond Floyd-Steinberg, Bayer, and Sierra Lite
- **Atkinson Dithering**: 
  - Classic Macintosh algorithm that only diffuses 75% of error for higher contrast
  - Creates distinctive vintage computer graphics look
  - Excellent for high-contrast artwork and text-heavy images
- **Blue Noise Dithering**:
  - Uses pre-computed 16x16 blue noise matrix for organic-looking patterns
  - No directional artifacts or visible patterns
  - Superior for smooth gradients and photographic content
- **Pattern Dithering**:
  - Six geometric styles: dots, diagonal lines, vertical lines, horizontal lines, crosshatch, diamond
  - Creates texture-like effects reminiscent of halftone printing
  - Each pattern style creates unique artistic effects
- **UI Updates**: Algorithm dropdown now includes all six algorithms with pattern style selector appearing for Pattern algorithm

### Dithering Palette Fix (2025-01-08)
- **Fixed dithering color selection and numColors slider**: Now intelligently selects the best N colors from palette based on image content
- **Problem**: Previous implementations either ignored numColors or selected wrong colors for the content
- **Solution**: 
  - Both dithering functions now sample the image to find which palette colors best represent the content
  - Scores each of the 20 palette colors based on how well they match the sampled pixels
  - Selects the top N colors based on numColors slider setting
  - These selected colors are then used for the dithering process
- **Result**: Dithering now:
  - Respects the numColors slider (2-20 colors)
  - Intelligently picks the best colors from the palette for the actual content
  - Orange gradients will select browns/tans when available
  - Black/white gradients will select grays
  - Full 20-color palette includes: Black, White, grays, Saddle, Sienna, Peru, Tan, Burlywood, Wheat, Bisque, Russet, Coffee, Rosy, Sandy, Peach, Antique, Beige

### Color Cycling Performance Optimization (2025-01-04)
- **Optimized color cycling system**: Implemented pre-computed index maps and RGB caching to eliminate repeated hex conversions during animation
- **New optimized functions**: `buildLayerColorIndexMap()`, `applyCycleToLayer_Optimized()`, `buildShiftedColors()`, `applyCycleToLayers_Optimized()`
- **State management updates**: Added `selectedColorsRGB` and `layerColorIndexMaps` fields to ColorCycleState
- **Dynamic layer updates**: Fixed issue where color cycling would revert to old layer state - now automatically refreshes maps when layers are modified during animation
- **Smart map refreshing**: Added `refreshColorCycleMapsIfNeeded()` with debouncing to efficiently rebuild maps when layer content changes
- **Simplified color matching**: All pixels on selected layers are mapped to the nearest cycling color - no thresholds or complex detection
- **Universal pixel support**: Works with all effects (polygon fills, risograph, dither, gradients) by simply mapping whatever pixels exist
- **Fallback handling**: On-the-fly map building when pre-computed maps are missing or stale
- **Backward compatibility**: Legacy functions marked as deprecated but kept functional for gradual migration
- **Animation integration**: Updated DrawingCanvas and compositeLayersToCanvas to use optimized path when pre-computed maps are available

## Table of Contents

1. [Project Fundamentals](#project-fundamentals)
   - [Vision & Goals](#vision--goals)
   - [Core Tech Stack](#core-tech-stack)
2. [System Architecture](#system-architecture)
   - [Overall System Design](#overall-system-design)
   - [Data Model](#data-model)
3. [Features](#features)
   - [Drawing Tools](#drawing-tools)
   - [Color Cycle Feature](#color-cycle-feature)
   - [Risograph Effect](#risograph-effect)
   - [Modular Brush Engine](#modular-brush-engine)
   - [Pixel-Perfect Drawing](#pixel-perfect-drawing)
   - [Tool Interface](#tool-interface)
4. [Canvas Interaction Improvements](#canvas-interaction-improvements)
   - [Cursor-Centered Zooming Fix](#cursor-centered-zooming-fix-2025-07-07)
   - [Pixel Brush Implementation](#pixel-brush-implementation-2025-07-08)
   - [Enhanced Pixel-Perfect Drawing Algorithm](#enhanced-pixel-perfect-drawing-algorithm-2025-07-08)
   - [Canvas Display Mode Architecture](#canvas-display-mode-architecture-2025-07-08)
   - [Image Paste with Marching Ants Selection](#image-paste-with-marching-ants-selection-2025-07-10)
5. [Custom Brush System](#custom-brush-system)
   - [Overview](#overview-1)
   - [Custom Brush Workflow](#custom-brush-workflow)
   - [ID Management and Brush Selection](#id-management-and-brush-selection)
   - [Brush Data Storage](#brush-data-storage)
   - [Brush Tip Display Flow](#brush-tip-display-flow)
6. [MiniCanvas System](#minicanvas-system)
   - [Overview](#overview-2)
   - [Purpose](#purpose-1)
   - [Architecture](#architecture)
   - [Rendering Pipeline](#rendering-pipeline)
   - [Performance Optimizations](#performance-optimizations)
   - [Integration Points](#integration-points)
   - [Debugging Features](#debugging-features)
   - [Edge Cases Handled](#edge-cases-handled)
   - [Future Enhancements](#future-enhancements)
7. [Layer System](#layer-system)
   - [Layer Architecture](#layer-architecture)
   - [Layer Operations](#layer-operations)
   - [Layer Controls](#layer-controls)
   - [Drawing on Layers](#drawing-on-layers)
   - [Layer Composition](#layer-composition)
   - [Best Practices](#best-practices)
   - [Technical Details](#technical-details)
   - [Troubleshooting](#troubleshooting)

---

# Project Fundamentals

# Vision & Goals

## Project Vision

TinyBrush is a versatile web-based drawing application designed for creating high-quality digital artwork. It provides an intuitive, browser-based platform supporting both pixel-perfect artwork and smooth antialiased drawing with professional tools and modular brush system.

## Core Purpose

Enable artists, designers, and creative professionals to create high-quality digital artwork directly in their web browser without requiring software installation or complex setup procedures.

## Primary Objectives

### 1. Professional Drawing Experience
- The artists can make crisp pixel art alongside regular antialiased art by selecting different brushes. This is applied at the brush level and not to all pixels already on screen. Artists can easily switch between pixel brushes and antialiased brushes without effecting what has already been drawn
- Every new feature we roll out must be optimised for User Experience and smooth performance
- Offer comprehensive color management with color picker, last used colours and save to favourites
- Enable pressure-sensitive drawing simulation for wacom tablets
- Toolbar on the left has options for Selection, Brush, Custom Brush, Fill and Eraser. Once a tool is selected options for the tool appear in the right hand column
- Selection: this tool lets the user select an area of the canvas using a square selection tool with handles to resize. Selected content can be deleted, moved, or used for image paste operations. Supports cut/paste of images with drag and resize functionality. Use Enter key to fix in place. Also supports pasting images from system clipboard (Ctrl+V) with automatic marching ants selection
- Brush: Provide a comprehensive library of brushes including hard pixel brushes and smooth antialiased brushes. Settings within brushes are modular components (spacing, color, size, shape, dashed patterns) that can be reused across different brush types
- Custom brush: creation by making a selection of pixels on canvas. Options include all layers, selected layer. Supports both pixel and antialiased brush creation
- Fill: this paint bucket tool fills an area of connected pixel. Options include connected (on/off), threshhold (1-256). 
- Erase: this is a quick way to erase pixels on the canvas. Temporray shortcut while hoilding down the E key. Options selected layer, all layers  

### 2. Seamless User Experience
- Responsive, modern dark theme interface
- Comprehensive keyboard shortcuts for efficient workflow
- Real-time canvas manipulation (zoom, pan, rotate)
- System clipboard integration for external content
- Undo/redo functionality for mistake recovery

## Target Audience

### Primary Users
- **Digital Artists**: Creating illustrations, concept art, and digital paintings
- **Pixel Artists**: Crafting pixel art with precision tools and pixel-perfect rendering
- **Hobbyists**: Casual drawing and creative expression

### Secondary Users
- **Educators**: Teaching digital art concepts
- **Students**: Learning digital art techniques
- **Game Developers**: Creating sprites, pixel art, and digital assets

## Success Metrics

### Technical Performance
- Smooth canvas rendering during active drawing (targeting 60 FPS)
- Load time under 3 seconds on modern browsers
- Support for canvases up to 4K resolution
- Smooth operation with 20+ layers

### User Experience
- Intuitive tool discovery and usage
- Efficient workflow with keyboard shortcuts
- Reliable save/export functionality
- Cross-browser compatibility

### Feature Completeness
- Complete drawing tool suite (brush, eraser, fill, selection)
- Advanced brush customization options
- Professional export capabilities (PNG)

## Design Philosophy

### Simplicity First
- Clean, uncluttered interface that focuses on the creative process
- Logical tool organization and discoverable features
- Minimal learning curve for basic functionality

### Performance Oriented
- Optimized canvas rendering using native Canvas API
- Efficient memory management for large projects
- Responsive interface that doesn't block creative flow

### Accessibility
- Keyboard-accessible interface for all major functions
- Clear visual feedback for all user actions
- Consistent interaction patterns throughout the application

### Extensibility
- Modular architecture supporting future feature additions
- Plugin-ready design for custom brush types
- API-ready structure for potential integrations

---

*This vision guides all development decisions and feature prioritization for TinyBrush.*

# Core Tech Stack

## Frontend Framework & Runtime

### Next.js 15.3.4
- **Purpose**: React framework providing SSR, routing, and build optimization
- **Key Features Used**:
  - App Router for modern routing architecture
  - Server-side rendering for initial page load
  - Automatic code splitting and optimization
  - Built-in TypeScript support
- **Configuration**: Uses app directory structure with optimized Canvas API components

### React 18+
- **Purpose**: UI library for component-based interface
- **Key Features Used**:
  - Hooks for state management and side effects
  - Context API for theme and settings
  - Suspense for dynamic component loading
  - Concurrent rendering for smooth performance

## Canvas & Graphics

### HTML5 Canvas API (Native)
- **Purpose**: High-performance native canvas rendering
- **Key Features Used**:
  - Hardware-accelerated 2D rendering context
  - Direct pixel manipulation with ImageData
  - OffscreenCanvas for layer management
  - Native image processing and transformations
- **Integration**: Direct integration with React components for optimal performance

### WebGL Context (Optional)
- **Purpose**: Hardware-accelerated rendering for complex operations
- **Usage**: High-performance brush effects, real-time filters, large canvas operations

## State Management

### Zustand 5.0.6
- **Purpose**: Lightweight state management for application state
- **Key Features Used**:
  - Immutable state updates
  - Computed values and derived state
  - Persistence for user preferences
  - DevTools integration for debugging
- **Store Structure**: Single store with sliced state management

## Styling & Design

### Tailwind CSS 4
- **Purpose**: Utility-first CSS framework for responsive design
- **Key Features Used**:
  - Custom color palette for dark theme
  - Responsive design utilities
  - Component-level styling
  - Custom CSS integration
- **Configuration**: Extended with custom colors, fonts, and animations

### CSS3 (Custom)
- **Purpose**: Custom styles for canvas interactions and animations
- **Key Features**:
  - Custom scrollbar styling
  - Smooth transitions and animations
  - Grid and flexbox layouts
  - Custom font integration (Meksans)

## Language & Type Safety

### TypeScript 5
- **Purpose**: Static type checking and enhanced developer experience
- **Key Features Used**:
  - Strict type checking
  - Interface definitions for all data structures
  - Generic types for reusable components
  - IDE integration for autocomplete and error detection
- **Configuration**: Strict mode enabled with comprehensive type coverage

## Build & Development Tools

### npm
- **Purpose**: Package management and script runner
- **Key Scripts**:
  - `npm run dev`: Development server with hot reload
  - `npm run build`: Production build with optimization
  - `npm run start`: Production server startup

### ESLint
- **Purpose**: Code linting and style enforcement
- **Configuration**: Extended with React, TypeScript, and Next.js rules

## Export Libraries

### Canvas2Image (Custom)
- **Purpose**: Canvas-to-image conversion for artwork export
- **Features**: PNG/JPEG export with quality control

## Runtime Environment

### Node.js 18+
- **Purpose**: JavaScript runtime for development and build processes
- **Requirements**: Modern ES modules support, npm 8+

### Modern Web Browsers
- **Target Browsers**:
  - Chrome 90+
  - Firefox 88+ 
  - Safari 14+
  - Edge 90+
- **Required Features**:
  - WebGL 2.0 support
  - ES2020 JavaScript features
  - Canvas API with ImageData support
  - Web Workers for background processing

## Key Dependencies

### Production Dependencies
```json
{
  "next": "15.3.4",
  "react": "18+",
  "react-dom": "18+",
  "zustand": "5.0.6",
  "tailwindcss": "4.0.0"
}
```

### Development Dependencies
```json
{
  "typescript": "5.0.0",
  "eslint": "8.0.0",
  "eslint-config-next": "15.3.4",
  "@types/react": "18.0.0",
}
```

## Architecture Decisions

### Why Native Canvas API over P5.js?
- **Performance**: Direct access to browser's native rendering without abstraction layer
- **Bundle Size**: Zero external dependencies for core drawing functionality
- **Control**: Complete control over rendering pipeline and optimization
- **Compatibility**: Native browser support without additional library dependencies

### Why Zustand over Redux?
- **Simplicity**: Minimal boilerplate and setup
- **Performance**: Optimized re-renders and subscription model
- **Bundle Size**: Significantly smaller than Redux toolkit
- **TypeScript**: Excellent TypeScript integration

### Why Next.js over Create React App?
- **Performance**: Built-in optimization and code splitting
- **SEO**: Server-side rendering capabilities
- **Routing**: Built-in routing with file-based structure
- **Deployment**: Optimized for modern deployment platforms

### Why Tailwind over CSS-in-JS?
- **Performance**: No runtime CSS generation
- **Consistency**: Utility-first approach ensures design consistency
- **Maintainability**: Easier to maintain and update styles
- **Bundle Size**: Purged CSS reduces final bundle size

## Environment Configuration

### Development Environment
- **Server**: Next.js development server with hot reload
- **Port**: 3000 (configurable)
- **Host**: 0.0.0.0 for WSL2 compatibility
- **Source Maps**: Enabled for debugging

### Production Environment
- **Build**: Optimized production build with code splitting
- **Deployment**: Static export or server-side rendering
- **CDN**: Optimized for CDN deployment
- **Performance**: Automatic performance optimizations

---

*This tech stack provides a robust foundation for TinyBrush's drawing and animation capabilities while maintaining excellent performance and developer experience.*

# System Architecture

# Overall System Design

## High-Level Architecture

TinyBrush follows a component-based architecture with clear separation of concerns between rendering, state management, and user interface components.

```
┌─────────────────────────────────────────────────────────────┐
│                     TinyBrush Application                    │
├─────────────────────────────────────────────────────────────┤
│  Next.js App Router (SSR + Client-side Routing)             │
├─────────────────────────────────────────────────────────────┤
│                    UI Layer (React)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Left        │  │ Canvas      │  │ Right       │         │
│  │ Toolbar     │  │ Area        │  │ Toolbar     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Layer Controls                        │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                 State Management (Zustand)                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Project │ │ Canvas  │ │ Tools   │ │ UI      │           │
│  │ State   │ │ State   │ │ State   │ │ State   │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────────────────┤
│                 Rendering Engine (Canvas API)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Main Canvas │  │ Layer       │  │ Brush       │         │
│  │ Manager     │  │ Manager     │  │ Engine      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
├─────────────────────────────────────────────────────────────┤
│                    Browser APIs                             │
│  Canvas 2D/WebGL │ Clipboard API │ File System │ Keyboard  │
└─────────────────────────────────────────────────────────────┘
```

## Core System Components

### 1. Application Layer (Next.js)
- **Entry Point**: `src/app/page.tsx`
- **Responsibilities**:
  - Application bootstrap and initial loading
  - SSR handling for Canvas components
  - Global event handling (keyboard, clipboard)
  - Layout management and responsive design

### 2. UI Components (React)
- **Location**: `src/components/`
- **Key Components**:
  - **LeftToolbar**: Tool selection and primary controls
  - **Toolbar**: Brush settings and advanced options
  - **Canvas Area**: Drawing surface and viewport controls
  - **LayerPanel**: Layer visibility and organization

### 3. State Management (Zustand)
- **Location**: `src/stores/useAppStore.ts`
- **State Slices**:
  - **Project State**: Layers, dimensions, export settings
  - **Canvas State**: Zoom, pan, selection, clipboard data
  - **Tool State**: Current tool, brush settings, color
  - **UI State**: Panel visibility, modal states, notifications

### 4. Rendering Engine (Canvas API)
- **Location**: `src/components/canvas/DrawingCanvas.tsx`
- **Core Systems**:
  - **Canvas Manager**: Main rendering loop and viewport
  - **Layer Manager**: Individual layer rendering with framebuffers
  - **Modular Brush Engine**: Component-based brush system with 60fps performance
  - **Transform System**: Zoom, pan, and rotation handling

## Data Flow Architecture

### 1. User Input Flow
```
User Action → Event Handler → State Update → Component Re-render → Canvas Update
```

**Example - Brush Stroke**:
1. Mouse down event captured by Canvas component
2. Event handler extracts coordinates and pressure
3. Brush settings retrieved from Zustand store
4. Drawing action dispatched to current layer
5. Canvas API renders stroke to layer framebuffer
6. Main canvas composites all layers
7. UI updates to reflect changes

### 2. State Update Flow
```
Action → Store Mutation → Derived State → Component Subscription → Re-render
```

**Example - Tool Change**:
1. User clicks tool button
2. Store updates current tool state
3. Derived state updates available tool options
4. Subscribed components re-render with new tool
5. Canvas updates cursor and interaction mode

### 3. Rendering Pipeline
```
Animation Frame → Layer Composition → Canvas Render → UI Overlay
```

**Rendering Cycle**:
1. Canvas API requests animation frame
2. Each layer renders to its framebuffer
3. Layer manager composites all visible layers
4. Main canvas displays composite result
5. UI overlays (selection, guides) rendered on top

## Component Communication

### 1. Parent-Child Communication
- **Props**: Configuration and callback functions
- **Refs**: Direct access to Canvas contexts
- **Context**: Theme and global settings

### 2. State Synchronization
- **Zustand Subscriptions**: Components subscribe to relevant store slices
- **Event Emitters**: Canvas events propagated to UI components
- **Derived State**: Computed values automatically update dependents

### 3. Cross-Component Communication
- **Global Store**: Shared state accessible by all components
- **Custom Hooks**: Reusable logic for common operations
- **Event System**: Custom events for complex interactions

## Performance Optimizations

### 1. Rendering Optimizations
- **Layer Caching**: Unchanged layers cached in framebuffers
- **Selective Updates**: Only modified regions re-rendered
- **Animation Throttling**: Drawing operations limited to 60 FPS
- **Canvas Pooling**: Reusable canvas elements for brush rendering

### 2. Memory Management
- **Lazy Loading**: Components loaded only when needed
- **Resource Cleanup**: Proper cleanup of Canvas contexts
- **State Pruning**: Unused state automatically garbage collected
- **Asset Optimization**: Images and brushes optimized for memory usage

### 3. Update Batching
- **State Batching**: Multiple state updates combined
- **Render Batching**: Multiple render operations batched per frame
- **Event Debouncing**: Rapid events (resize, scroll) debounced

## Security Considerations

### 1. Input Validation
- **Canvas Bounds**: All drawing operations validated within canvas
- **File Uploads**: Image imports validated for type and size
- **State Validation**: Store updates validated against schemas

### 2. Resource Limits
- **Canvas Size**: Maximum canvas dimensions enforced
- **Memory Limits**: Project size limits to prevent memory exhaustion
- **Export Limits**: Image export size and quality limits

### 3. Browser APIs
- **Clipboard Access**: Proper permission handling
- **File System**: Secure file operations with user consent
- **Local Storage**: Sensitive data encrypted or excluded

## Scalability Design

### 1. Component Architecture
- **Modular Design**: Components can be developed independently
- **Plugin System**: Ready for future brush plugins
- **Theme System**: Easily extensible for new themes

### 2. State Management
- **Slice-based Store**: Store can be extended with new slices
- **Action System**: New actions easily added without conflicts
- **Persistence**: State persistence handles schema migrations

### 3. Rendering Pipeline
- **Layer System**: Unlimited layers with efficient compositing
- **Brush System**: Extensible brush architecture
- **Export System**: Multiple export formats supported


## Development Architecture

### 1. Hot Module Replacement
- **Component Updates**: React components hot-reload
- **State Preservation**: Store state maintained across updates
- **Canvas Persistence**: Canvas contexts properly reinitialized

### 2. Error Boundaries
- **Component Isolation**: Errors isolated to failing components
- **Graceful Degradation**: Fallback UI for rendering failures
- **Error Reporting**: Comprehensive error tracking

### 3. Development Tools
- **Redux DevTools**: Store state inspection and time travel
- **React DevTools**: Component hierarchy and props inspection
- **Performance Monitoring**: Built-in performance metrics

---

*This architecture provides a robust foundation for TinyBrush's drawing capabilities while maintaining clean separation of concerns and excellent performance.*

# Data Model

## Core Data Entities

### Project Entity
The top-level container for all artwork data.

```typescript
interface Project {
  id: string;                    // Unique project identifier
  name: string;                  // User-defined project name
  width: number;                 // Canvas width in pixels
  height: number;                // Canvas height in pixels
  layers: Layer[];               // Array of layer objects
  backgroundColor: string;       // Project background color (hex)
  createdAt: Date;              // Project creation timestamp
  updatedAt: Date;              // Last modification timestamp
}
```

**Relationships:**
- One-to-many with Layer (a project contains multiple layers)

### Layer Entity
Individual drawing layers with independent content and settings.

```typescript
interface Layer {
  id: string;                    // Unique layer identifier
  name: string;                  // User-defined layer name
  visible: boolean;              // Layer visibility state
  opacity: number;               // Layer opacity (0-1)
  blendMode: BlendMode;          // Layer blending mode
  locked: boolean;               // Layer editing lock state
  order: number;                 // Layer z-order (higher = front)
  imageData: ImageData | null;   // Layer pixel data
  framebuffer: OffscreenCanvas;   // Canvas API framebuffer reference
}
```

**Relationships:**
- Many-to-one with Project (multiple layers belong to one project)
- One-to-many with DrawingAction (layer contains drawing history)

### BrushPreset Entity
Modular brush configuration with component-based architecture.

```typescript
interface BrushPreset {
  id: string;                    // Unique brush identifier
  name: string;                  // User-defined brush name
  category: string;              // Brush category (Pixel, Digital, Traditional)
  components: BrushComponent[];  // Modular component configuration
  thumbnail: string;             // Base64 encoded thumbnail
  tags: string[];                // Search tags for organization
  isDefault: boolean;            // System default brush flag
  createdAt: Date;              // Brush creation timestamp
  modifiedAt: Date;             // Last modification timestamp
}

interface BrushComponent {
  id: string;                    // Unique component identifier
  type: ComponentType;           // Component function type
  parameters: ComponentParams;   // Component-specific settings
  priority: number;              // Execution order (0-100)
  enabled: boolean;              // Component active state
}

enum ComponentType {
  SIZE_MODIFIER = 'size',        // Size calculation and variation
  OPACITY_MODIFIER = 'opacity',  // Opacity and transparency effects
  PATTERN_RENDERER = 'pattern',  // Brush pattern and texture
  SPACING_CONTROLLER = 'spacing', // Stroke spacing and distribution
  PRESSURE_HANDLER = 'pressure', // Pressure sensitivity simulation
  ANTI_ALIASING = 'antialiasing', // Pixel vs antialiased rendering
  COLOR_BLENDING = 'blending',   // Color mixing and blend modes
  ROTATION_TRANSFORM = 'rotation' // Brush rotation and orientation
}
```

**Relationships:**
- One-to-many with BrushComponent (brush contains multiple components)
- Many-to-one with BrushCategory (multiple brushes belong to categories)
- One-to-many with ComponentTransfer (components can be shared between brushes)

### CustomBrush Entity
User-created brush patterns and configurations.

```typescript
interface CustomBrush {
  id: string;                    // Unique brush identifier
  name: string;                  // User-defined brush name
  pattern: ImageData;            // Brush pattern pixel data
  thumbnail: string;             // Base64 encoded thumbnail
  settings: BrushSettings;       // Default brush settings
  createdAt: Date;              // Brush creation timestamp
  isDefault: boolean;            // System default brush flag
  tags: string[];               // User-defined tags for organization
}
```

**Relationships:**
- One-to-many with BrushSettings (brush can be used with different settings)
- Many-to-one with User (multiple brushes belong to one user)

## State Management Entities

### CanvasState
Current canvas view and interaction state.

```typescript
interface CanvasState {
  zoom: number;                  // Canvas zoom level (0.1-10)
  panX: number;                  // Horizontal pan offset
  panY: number;                  // Vertical pan offset
  rotation: number;              // Canvas rotation angle
  showGrid: boolean;             // Grid visibility toggle
  gridSize: number;              // Grid cell size in pixels
  showRulers: boolean;           // Ruler visibility toggle
  selection: {
    active: boolean;             // Selection tool active
    bounds: Rectangle;           // Selection rectangle
    pixels: ImageData;           // Selected pixel data
  };
  cursor: {
    x: number;                   // Current cursor X position
    y: number;                   // Current cursor Y position
    pressure: number;            // Current pressure value
  };
}
```

### ToolState
Current tool and its configuration.

```typescript
interface ToolState {
  currentTool: Tool;             // Active drawing tool
  previousTool: Tool;            // Previously used tool
  brushSettings: BrushSettings;  // Current brush configuration
  eraserSettings: BrushSettings; // Current eraser configuration
  fillSettings: {
    tolerance: number;           // Fill tolerance (0-255)
    contiguous: boolean;         // Contiguous fill toggle
    allLayers: boolean;          // Fill all layers toggle
  };
}
```

### UIState
User interface state and preferences.

```typescript
interface UIState {
  panels: {
    leftToolbar: boolean;        // Left toolbar visibility
    rightToolbar: boolean;       // Right toolbar visibility
    timeline: boolean;           // Timeline visibility
    layerPanel: boolean;         // Layer panel visibility
    brushPanel: boolean;         // Brush panel visibility
  };
  modals: {
    export: boolean;             // Export modal visibility
    settings: boolean;           // Settings modal visibility
    help: boolean;               // Help modal visibility
  };
  theme: 'dark' | 'light';       // UI theme preference
  notifications: Notification[]; // Active notifications
}
```

## Derived State Patterns

### Computed Values
Values automatically calculated from base state.

```typescript
interface DerivedState {
  // Canvas calculations
  canvasToScreenRatio: number;   // Canvas to screen coordinate ratio
  visibleCanvasBounds: Rectangle; // Currently visible canvas area
  
  // Layer calculations
  visibleLayers: Layer[];        // Currently visible layers
  activeLayer: Layer;            // Currently selected layer
  layerCount: number;            // Total number of layers
  
  
  // Tool calculations
  effectiveBrushSize: number;    // Brush size with pressure applied
  toolCursor: string;            // CSS cursor for current tool
}
```

### State Validation Rules

#### Project Validation
- **Width/Height**: Must be between 1-8192 pixels
- **Layers**: Maximum 100 layers per project
- **Name**: Must be 1-100 characters, no special characters

#### Layer Validation
- **Opacity**: Must be between 0-1
- **Order**: Must be unique within project
- **Name**: Must be 1-50 characters
- **ImageData**: Must match project dimensions

#### Brush Validation
> **Note**: See [Brush Settings Reference](../03_Features/Modular_Brush_Engine.md#brush-settings-reference) for parameter ranges.

- **Color**: Must be valid hex color
- **BlendMode**: Must be valid Canvas blend mode

## Data Persistence

### Local Storage Schema
```typescript
interface LocalStorageData {
  projects: Project[];           // Saved projects
  customBrushes: CustomBrush[];  // User created brushes
  userPreferences: {
    theme: string;               // UI theme preference
    defaultBrushSettings: BrushSettings;
    keyboardShortcuts: Record<string, string>;
    autoSave: boolean;           // Auto-save toggle
    autoSaveInterval: number;    // Auto-save interval in minutes
  };
  recentFiles: {
    path: string;                // File path
    name: string;                // File name
    timestamp: Date;             // Last accessed
  }[];
}
```

### Session Storage Schema
```typescript
interface SessionStorageData {
  currentProject: Project;       // Active project
  undoHistory: DrawingAction[];  // Undo/redo history
  clipboardData: {
    type: 'image' | 'layer';     // Clipboard content type
    data: ImageData;             // Clipboard image data
    timestamp: Date;             // Clipboard timestamp
  };
  temporaryCanvases: {
    [key: string]: HTMLCanvasElement; // Temporary canvas references
  };
}
```

## Export Data Formats

### PNG Export
```typescript
interface PNGExport {
  format: 'png';
  quality: number;               // PNG compression quality
  includeBackground: boolean;    // Include background layer
  layers: string[];              // Layer IDs to export
  scale: number;                 // Export scale multiplier
}
```

## Performance Considerations

### Memory Management
- **Layer Framebuffers**: Automatically garbage collected when unused
- **Undo History**: Limited to 50 actions to prevent memory exhaustion
- **Image Data**: Compressed when stored in local storage
- **Thumbnails**: Generated at low resolution for performance

### State Update Optimization
- **Batch Updates**: Multiple state changes batched into single update
- **Selective Updates**: Only affected components re-render
- **Debounced Actions**: Rapid actions (brush strokes) debounced
- **Lazy Computation**: Derived state computed only when needed

---

*This data model provides a comprehensive foundation for TinyBrush's drawing capabilities while maintaining data integrity and performance.*

# Features

# Drawing Tools

## Purpose
The Drawing Tools feature provides a comprehensive set of digital art tools for creating artwork. Each tool is designed for specific drawing tasks with customizable settings and advanced features.

## Core Drawing Tools

### Brush Tool
**Purpose**: Primary drawing tool with dual rendering modes for both pixel art and antialiased artwork.

**Dual Rendering System**:
- **Pixel Mode**: Crisp, non-antialiased rendering for pixel art
- **Antialiased Mode**: Smooth, traditional digital painting
- **Per-Brush Setting**: Applied at brush level, not affecting existing artwork
- **Real-time Switching**: Artists can switch modes without affecting drawn pixels

**Core Flow**:
1. User selects Brush tool (B key or toolbar click)
2. Right column displays brush presets and settings
3. User selects pixel or antialiased brush from presets
4. User configures size, opacity, and pressure sensitivity
5. User draws with smooth, responsive performance
6. Rendering mode applies only to new strokes

**Brush-Aware Shape Edges** (2025-07-29):
- **Shape Mode Integration**: When shape mode is enabled, shape edges now reflect the selected brush type
- **Pixel Brush Shapes**: Create hard, pixel-perfect edges with no antialiasing
- **Soft Brush Shapes**: Maintain smooth, antialiased edges
- **Visual Consistency**: Shape appearance matches stroke appearance for unified artwork
- **Preview Accuracy**: Shape preview shows exact final rendering result

**Key Inputs**:
- **Mouse/Touch/Wacom**: Coordinates, pressure from Wacom tablets, drawing state
- **Brush Presets**: Pixel (1px, 3px, 5px), Soft Round, Hard Round, Textured
- **Modular Settings**: Size (1-1000px), opacity (0-100%), color, pressure sensitivity
- **Rendering Mode**: Pixel-perfect or antialiased per brush

**Key Outputs**:
- **Layer ImageData**: Modified pixel data with correct rendering mode
- **Smooth Performance**: Optimized for responsive drawing experience
- **Visual Feedback**: Real-time brush cursor, stroke preview
- **Wacom Integration**: Pressure-sensitive strokes from tablet input

**Dependencies**:
- Canvas API rendering optimized for 60fps
- Wacom tablet pressure detection
- Modular brush settings system
- Layer management with rendering mode support

**Business Rules**:
- **Performance**: All brush operations optimized for smooth interaction
- **Non-destructive Mode Switching**: Changing brush mode doesn't affect existing pixels
- **Wacom Pressure**: Full pressure sensitivity support for professional tablets
- **Modular Settings**: Brush settings can be transferred between different brushes

### Special Brushes

#### Rectangle Gradient Brush (Updated 2025-08-02)
**Purpose**: Create gradient-filled rectangles with simplified controls for artistic effects.

**Simplified Settings**:
- **Colors Slider (1-10)**: Single control replacing all previous settings
- **Default**: 2 colors (simple gradient from start to end)
- **Multi-stop**: 3-10 colors create evenly distributed gradient stops
- **Color Interpolation**: Smooth transitions between sampled colors

**Core Flow**:
1. User selects Rectangle Gradient brush from Special category
2. Settings panel shows only Colors slider (1-10)
3. User drags to define rectangle start and end points
4. System samples colors from canvas at evenly spaced points along the path
5. Gradient renders with specified number of color stops

**Key Features**:
- **Simplified UI**: Single slider replaces Size, Opacity, Spacing, etc.
- **Path-Based Sampling**: Samples colors along the entire gradient path, not just endpoints
- **Live Preview**: Real-time gradient preview while dragging with sampled colors
- **Multi-Stop Gradients**: Creates smooth transitions between all sampled points

#### Polygon Gradient Brush (Updated 2025-08-02)
**Purpose**: Create gradient-filled polygons by drawing points, with simplified controls.

**Simplified Settings**:
- **Colors Slider (1-10)**: Single control replacing all previous settings
- **Default**: 2 colors (simple gradient from top to bottom)
- **Multi-stop**: 3-10 colors create evenly distributed gradient stops
- **Automatic Sampling**: Colors sampled from underlying canvas artwork

**Core Flow**:
1. User selects Polygon Gradient brush from Special category
2. Settings panel shows only Colors slider (1-10)
3. User clicks/drags to place polygon points (minimum 3 points)
4. System samples colors from canvas based on polygon vertex positions
5. Gradient renders with specified number of color stops when polygon is completed

**Key Features**:
- **Simplified UI**: Single slider replaces Size, Opacity, Spacing, etc.
- **Vertex-Based Sampling**: Samples colors from canvas at polygon vertex locations
- **Live Preview**: Real-time gradient preview while drawing polygon
- **Flexible Shapes**: Create any polygon shape for custom gradient areas

### Eraser Tool
**Purpose**: Quick pixel erasing with layer-specific options and temporary E-key activation.

**Temporary Activation**:
- **Hold E Key**: Temporarily switch to eraser while drawing
- **Release E**: Return to previous tool automatically
- **Visual Feedback**: Clear indication of temporary eraser mode
- **Settings Preservation**: Maintains current tool settings during temporary use

**Core Flow**:
1. User selects Eraser tool (E key click) or holds E for temporary mode
2. Right column shows layer target options (selected layer, all layers)
3. Tool inherits current brush size and settings
4. User drags to erase pixels with smooth performance
5. Erased areas become transparent on target layers
6. Temporary mode: release E to return to previous tool

**Key Inputs**:
- **Mouse/Touch/Wacom**: Coordinates, pressure from tablets
- **Layer Target**: Selected layer only or all visible layers
- **Eraser Settings**: Size (inherited from brush), opacity, pressure sensitivity
- **Temporary Mode**: E key hold detection

**Key Outputs**:
- **Layer ImageData**: Pixels set to transparent on target layers
- **Smooth Performance**: Responsive erasing without lag
- **Visual Feedback**: Eraser cursor, real-time erase preview
- **Tool State**: Automatic return to previous tool in temporary mode

**Dependencies**:
- Brush engine for consistent stroke behavior
- Layer management for multi-layer erasing
- Key state detection for temporary mode

**Business Rules**:
- **Layer Options**: Can target selected layer only or all visible layers
- **Performance**: All erase operations optimized for responsiveness
- **Temporary Mode**: E key provides quick access without tool switching
- **Pressure Sensitivity**: Full Wacom tablet support for natural erasing

### Fill Tool
**Purpose**: Paint bucket tool that fills connected pixel areas with precise threshold control.

**Connected Fill System**:
- **Connected Mode**: On/Off toggle for connectivity-based filling
- **Threshold Range**: 1-256 color similarity control
- **Performance Optimized**: Large area fills maintain 60fps
- **Layer Awareness**: Respects layer boundaries and transparency

**Core Flow**:
1. User selects Fill tool (G key or toolbar click)
2. Right column shows Connected toggle and Threshold slider (1-256)
3. User configures connected mode and threshold level
4. User clicks on canvas area to fill
5. Algorithm fills based on connectivity and threshold settings
6. Fill operation completes with smooth performance

**Key Inputs**:
- **Click Position**: X, Y coordinates of fill start point
- **Fill Color**: Current selected color from color management system
- **Connected Mode**: On (connected pixels only) or Off (all similar colors)
- **Threshold**: Color similarity threshold (1=exact match, 256=fill all)
- **Layer Target**: Active layer for fill operation

**Key Outputs**:
- **Layer ImageData**: Filled pixels updated with new color
- **Smooth Performance**: Responsive fill operation without UI lag
- **Visual Feedback**: Immediate fill result with undo capability
- **Undo Action**: Fill operation added to history

**Dependencies**:
- Optimized flood fill algorithm for 60fps performance
- Color comparison utilities with threshold support
- Layer pixel data access and modification

**Business Rules**:
- **Connected On**: Fill only pixels connected to click point
- **Connected Off**: Fill all pixels matching threshold on layer
- **Threshold 1**: Exact color match only
- **Threshold 256**: Fill entire area regardless of color
- **Performance**: Fill operations optimized to maintain interface responsiveness

### Selection Tool
**Purpose**: Create square selections with resize handles for precise pixel manipulation and movement.

**Square Selection System**:
- **Click and Drag**: Create initial rectangular selection area
- **Resize Handles**: Corner and edge handles for precise adjustment
- **Move Selected Pixels**: Drag interior to move selected content
- **Enter to Confirm**: Press Enter key to fix selection in place
- **Delete Option**: Remove selected pixels (make transparent)

**Core Flow**:
1. User selects Selection tool (V key or toolbar click)
2. User clicks and drags to create square/rectangular selection
3. Resize handles appear on selection boundaries
4. User can drag handles to adjust selection size
5. User can drag interior to move selected pixels around canvas
6. Press Enter to fix selection in place or delete to remove pixels

**Key Inputs**:
- **Click and Drag**: Initial selection creation coordinates
- **Handle Manipulation**: Resize handle dragging for precise adjustment
- **Interior Drag**: Move selected pixels to new location
- **Enter Key**: Confirm and fix selection in place
- **Delete Key**: Remove selected pixels

**Key Outputs**:
- **Selection Bounds**: Precise rectangular selection area
- **Resize Handles**: Visual handles for boundary adjustment
- **Pixel Movement**: Real-time movement of selected content
- **60fps Performance**: Smooth selection manipulation
- **Fixed Placement**: Enter key commits changes to canvas

**Dependencies**:
- Selection rendering system with handle display
- Pixel manipulation for movement operations
- Keyboard input detection for Enter/Delete
- Layer pixel data access and modification

**Business Rules**:
- **Square Selection Only**: Rectangular selections with resize handles
- **Real-time Movement**: Selected pixels move smoothly during drag
- **Enter to Confirm**: Selection must be confirmed to commit changes
- **60fps Requirement**: All selection operations maintain smooth performance
- **Non-destructive Preview**: Movement shows preview before confirmation
- **Image Paste Support**: Paste images from clipboard with automatic selection
- **Drag and Resize**: Pasted images can be dragged and resized with handles

### Image Paste & Resize
**Purpose**: Seamlessly integrate external images into the canvas with full manipulation controls.

**Paste Workflow**:
1. Copy image to system clipboard (Ctrl+C from external source)
2. Paste into TinyBrush (Ctrl+V)
3. Image appears with animated marching ants selection border
4. Drag to reposition image anywhere on canvas
5. Press Enter to commit image to current layer
6. Press Escape to cancel and remove the pasted image

**Key Features**:
- **Automatic Selection**: Pasted images automatically become active selections with marching ants
- **Marching Ants**: Animated black/white dashed border for clear selection visibility
- **Drag-to-Move**: Click and drag the selected image to move it around
- **Layer Integration**: Images paste onto the currently active layer
- **Real-time Preview**: See image position update as you drag
- **Keyboard Controls**: Enter to commit, Escape to cancel
- **Undo Support**: Full undo/redo support for paste operations

**Supported Formats**: PNG, JPEG, GIF, WebP, BMP

**Implementation Details**:
- Clipboard event listeners detect paste operations (Ctrl+V)
- Images are converted to ImageData for canvas compatibility
- Selection state includes bounds and pixel data
- Marching ants animation runs at 60fps using requestAnimationFrame
- Drag operations update selection bounds in real-time

### Clear Tool
**Purpose**: Quickly clear the active layer or selected area.

**Core Flow**:
1. User selects Clear tool (C key or toolbar click)
2. If selection exists, clear selected area only
3. If no selection, clear entire active layer
4. Cleared pixels set to transparent
5. Undo action recorded for clear operation

**Key Inputs**:
- **Clear Target**: Active layer or current selection
- **Confirmation**: Optional confirmation for layer clear

**Key Outputs**:
- **Layer ImageData**: Cleared pixels set to transparent
- **Undo Action**: Clear operation added to history

**Dependencies**:
- Layer management system
- Selection system (if applicable)

**Business Rules**:
- Cannot clear background layer (protected)
- Clear selection only affects selected pixels
- Layer clear removes all pixel data

### Shape Brush Mode
**Purpose**: Transform any brush into a shape-drawing tool that creates filled polygons with live preview.

**Shape Creation System**:
- **Universal Compatibility**: Works with all brush types (default brushes and custom brushes)
- **Hold-to-Draw**: Continuous shape creation while mouse button is held down
- **Live Preview**: Real-time preview that matches the final result exactly
- **Smart Filling**: Default brushes use solid colors, custom brushes use tiled patterns
- **Mouse-Up Completion**: Shape is finalized and baked when mouse button is released

**Core Flow**:
1. User toggles Shape mode in brush controls (above Pressure setting)
2. User selects any brush (default or custom) with Shape mode enabled
3. User presses and holds mouse button to start shape creation
4. System continuously collects points as user drags mouse
5. Live preview shows filled shape in real-time during drawing
6. User releases mouse button to finalize and bake the shape
7. Shape is permanently added to the active layer with no transparency

**Key Inputs**:
- **Shape Toggle**: Boolean setting in brush controls above Pressure
- **Mouse Hold**: Continuous mouse button press to collect shape points
- **Mouse Movement**: Path coordinates collected during mouse hold
- **Mouse Release**: Triggers shape completion and baking
- **Brush Settings**: Current brush color, opacity, and brush type
- **Canvas Position**: All shape points relative to canvas coordinates

**Key Outputs**:
- **Live Preview**: Real-time filled shape preview during drawing
- **Baked Shape**: Permanent filled polygon added to layer on mouse release
- **Layer ImageData**: Modified pixel data with filled shape
- **Shape Path**: Closed Path2D object for efficient rendering
- **Visual Feedback**: Preview matches final result exactly (no transparency difference)

**Shape Filling Behavior**:
- **Default Brushes**: Filled with solid brush color respecting opacity settings
- **Custom Brushes**: Filled with repeating tiled pattern from custom brush image
- **Opacity Handling**: Shape respects brush opacity settings for both preview and final result
- **No Transparency Issues**: Both preview and final shapes are solid, no disappearing

**Dependencies**:
- Path2D API for efficient shape path creation and rendering
- Canvas composition operations for preview and baking
- Shape utilities (createShapePath, renderShape, renderShapePreview)
- Point collection and path simplification algorithms
- Layer management system for baking final shapes
- Mouse event handling for continuous point collection

**Technical Implementation**:
- **ShapePoint Interface**: `{ x: number, y: number }` for coordinate storage
- **ShapeState Management**: Zustand store handles drawing state and point collection
- **Path Simplification**: Removes redundant points within tolerance (2px default)
- **Preview Rendering**: Uses same render function as final shape for consistency
- **Async Baking**: Proper timing to prevent shape disappearing on mouse release
- **Canvas Layers**: Preview on main canvas, baking to offscreen canvas with recomposition

**Performance Optimizations**:
- **Point Tolerance**: Path simplification reduces redundant points for smoother performance
- **Efficient Rendering**: Path2D objects provide optimal canvas performance
- **Preview Caching**: Shape path cached and reused until mouse release
- **Minimal Redraws**: Only affected canvas areas updated during preview

**Integration Points**:
- **BrushSettings Interface**: `shapeEnabled: boolean` added to all brush settings
- **BrushControls Component**: Shape toggle positioned above Pressure toggle
- **DrawingCanvas Component**: Integrated into pointer event handlers
- **Brush Presets**: All preset brushes default to `shapeEnabled: false`
- **Store Management**: Shape state managed alongside other brush states

**Business Rules**:
- **Universal Tool**: Shape mode works with every brush type without exception
- **Hold-to-Draw**: Shape collection only occurs while mouse button is held down
- **Instant Baking**: Shape is immediately permanent when mouse button is released
- **No Pressure Interaction**: Shape mode bypasses pressure sensitivity (shapes are solid fills)
- **Preview Accuracy**: Live preview must look identical to final baked result
- **Performance Requirement**: Smooth 60fps preview during shape creation
- **Layer Respect**: Shapes are drawn to currently active layer only
- **Color Consistency**: Shape color matches current brush color/pattern settings

## Advanced Tool Features

### Pressure Sensitivity Simulation
**Purpose**: Simulate pressure-sensitive drawing for natural brush behavior.

**Implementation**:
- Mouse velocity determines simulated pressure
- Pressure affects brush size and opacity
- Configurable sensitivity settings
- Real-time pressure visualization

**Settings**:
- **Enable Pressure**: Toggle pressure sensitivity
- **Size Variation**: Pressure effect on brush size (0-1)
- **Opacity Variation**: Pressure effect on opacity (0-1)
- **Sensitivity**: Pressure calculation sensitivity

### Dotted Brush Patterns
**Purpose**: Create dashed or dotted brush strokes for artistic effects.

**Implementation**:
- Configurable dash and gap lengths
- Pattern repeats along stroke path
- Works with all brush settings
- Maintains pattern consistency

**Settings**:
- **Enable Dotted**: Toggle dotted pattern
- **Dash Length**: Length of dash segments (pixels)
- **Gap Length**: Length of gap segments (pixels)
- **Pattern Offset**: Starting offset in pattern

### Pixel-Perfect Mode
**Purpose**: Ensure crisp, pixel-perfect artwork for pixel art creation.

**Implementation**:
- Overrides brush spacing for 1:1 pixel rendering
- Disables anti-aliasing for sharp edges
- Optimized for low-resolution artwork
- Maintains pixel alignment during zoom

**Settings**:
- **Enable Pixel-Perfect**: Toggle pixel-perfect rendering
- **Snap to Pixel Grid**: Align brush to pixel boundaries
- **Disable Anti-aliasing**: Sharp pixel edges

### Risograph Effect
**Purpose**: Add realistic film grain texture to brush strokes for enhanced artistic expression and traditional medium emulation.

**Implementation**:
- GPU-accelerated noise texture application using `source-atop` composite operation
- Single cached 256x256 noise texture reused across all strokes for optimal performance
- Intensity-based opacity control for subtle to pronounced grain effects
- Compatible with all brush shapes and custom brushes

**Core Flow**:
1. User adjusts Film Grain slider (0-100%) for desired grain strength
2. During drawing, noise pattern applies only to drawn pixels using `source-atop`
3. Grain texture tiles seamlessly across brush strokes
4. Setting 0 = no grain, values above 0 enable the effect

**Key Features**:
- **Performance Optimized**: Single cached noise texture with GPU pattern filling
- **Universal Compatibility**: Works with round, square, pixel, triangle brushes and custom brushes
- **Intensity Control**: 0-100% opacity blending for precise grain strength
- **Memory Efficient**: ~256KB texture cache, no per-stroke allocation
- **Real-time Application**: No performance impact when disabled

**Settings**:
- **Film Grain**: Single slider 0-100% controls grain visibility (0 = disabled, 100 = maximum grain)

**Technical Details**:
- Uses `createPattern('repeat')` for seamless tiling
- `globalCompositeOperation = 'source-atop'` ensures grain only appears on existing pixels
- Noise generation creates random grayscale values for authentic film grain appearance
- Zero overhead when disabled (risographIntensity = 0)

## Tool Settings API

### BrushSettings Interface
> **Note**: For complete brush settings reference, see [Modular Brush Engine](./Modular_Brush_Engine.md#brush-settings-reference)

```typescript
interface BrushSettings {
  // Core settings - see Brush Settings Reference for ranges
  size: number;
  opacity: number;
  spacing: number;
  color: string;                 // Hex color (#RRGGBB)
  blendMode: BlendMode;          // Layer blending mode
  rotation: number;
  
  // Pressure sensitivity
  pressureSettings: {
    enabled: boolean;
    sizeVariation: number;
    opacityVariation: number;
  };
  
  // Dotted patterns
  dottedStyle: {
    enabled: boolean;
    dashLength: number;          // Pixels
    gapLength: number;           // Pixels
  };
  
  // Risograph texture effect
  risographIntensity: number;    // 0-100 risograph dissolve intensity (0 = disabled)
  
  // Pixel-perfect mode
  pixelPerfect: boolean;
}
```

### Tool State Management
```typescript
interface ToolState {
  currentTool: Tool;             // BRUSH | ERASER | FILL | SELECT | CLEAR
  brushSettings: BrushSettings;
  fillSettings: {
    tolerance: number;           // 0-255 color tolerance
    contiguous: boolean;         // Contiguous fill only
    allLayers: boolean;          // Use all layers for boundary
  };
  selectionState: {
    active: boolean;             // Selection exists
    bounds: Rectangle;           // Selection rectangle
    mode: 'rectangle' | 'brush'; // Selection mode
  };
}
```

## Keyboard Shortcuts

### Primary Tools
- **B**: Brush tool
- **E**: Eraser tool  
- **G**: Fill tool
- **S**: Selection tool
- **C**: Clear tool

### Brush Size
- **[**: Decrease brush size
- **]**: Increase brush size
- **Shift + [**: Decrease brush size by 10
- **Shift + ]**: Increase brush size by 10

### Tool Modifiers
- **Shift**: Constrain (straight lines, perfect circles)
- **Alt**: Eyedropper (temporary color picker)
- **Ctrl**: Precision mode (slower, more accurate)
- **Ctrl+V**: Paste image from clipboard
- **Enter**: Commit selection/pasted image
- **Escape**: Cancel selection/pasted image

## Performance Considerations

### Rendering Optimization
- **Stroke Batching**: Multiple stroke points batched per frame
- **Dirty Region Tracking**: Only modified areas re-rendered
- **Canvas Caching**: Unchanged layers cached in framebuffers
- **Brush Caching**: Rotated brush patterns cached for reuse

### Memory Management
- **Undo History**: Limited to 50 actions to prevent memory exhaustion
- **Temporary Canvases**: Pooled canvas elements for brush rendering
- **ImageData Pooling**: Reused ImageData objects for performance

### User Experience
- **Responsive Feedback**: Tool cursor updates immediately
- **Smooth Strokes**: Interpolated points for smooth brush strokes
- **Real-time Preview**: Live preview of tool effects
- **Performance Monitoring**: FPS tracking and optimization alerts

---

*The Drawing Tools provide a comprehensive foundation for digital art creation with professional-grade features and performance optimization.*

# Color Cycle Feature

## Purpose
The Color Cycle feature enables palette animation effects by dynamically shifting colors through a selected set, creating the illusion of movement without modifying pixel data. This classic palette cycling technique is perfect for animating backgrounds, water, fire, and other dynamic elements in pixel art and digital artwork.

## Core Functionality

### Animation System
**Real-time Color Shifting**: Uses `requestAnimationFrame` with FPS control (1-60 FPS, default 18) for smooth palette animation.

**Non-destructive Preview**: Original layer data remains unchanged - color cycling is applied only during rendering composition.

**Layer-specific Application**: Artists can select which layers to apply color cycling to, allowing fine control over animated elements.

### Color Selection Tools

**Manual Color Picker**: Advanced color picker modal with HSV wheel for precise color selection.

**Current Brush Color**: One-click addition of the currently selected brush color to the cycle palette.

**Auto-extraction**: "Extract from Canvas" button analyzes selected layers (or all visible layers) to automatically detect and add dominant colors to the cycle.

**Smart Deduplication**: Prevents duplicate colors from being added to the cycle palette.

### User Interface

**Play/Pause Controls**: Large, prominent controls with visual icons for starting and stopping animation.

**Color Swatches Grid**: Visual grid showing all selected colors with click-to-remove functionality.

**FPS Slider**: Real-time control of animation speed from 1-60 FPS with visual feedback.

**Layer Selection**: Individual checkboxes for each layer to control which layers participate in cycling.

**Reset Function**: One-click reset to clear all colors and settings.

## Core Flow

1. **Tool Selection**: User selects Color Cycle tool from left toolbar (circular arrows icon)
2. **Color Addition**: User adds colors via:
   - "Current" button (adds brush color)
   - "Pick" button (opens color picker modal)  
   - "Extract" button (auto-detects colors from layers)
3. **Layer Selection**: User selects which layers to apply cycling to via checkboxes
4. **Speed Control**: User adjusts FPS via slider for desired animation speed
5. **Animation Control**: User clicks Play to start animation, Pause to stop and examine current state
6. **Real-time Preview**: Colors cycle through the palette, shifting all selected colors in sequence

## Implementation Architecture

### State Management
```typescript
interface ColorCycleState {
  isActive: boolean;           // Tool is selected
  isPlaying: boolean;          // Animation is running
  selectedColors: string[];    // Color palette to cycle through
  fps: number;                 // Animation speed (default 18)
  selectedLayers: string[];    // Layer IDs to apply cycling to
  currentColorIndex: number;   // Current position in cycle
  colorMap: Map<string, string>; // Original to current color mapping
}
```

### Animation Loop
- Uses `requestAnimationFrame` for smooth animation
- Respects FPS setting with frame timing control
- Triggers layer recomposition to show updated colors
- Automatically advances through color palette indices

### Color Mapping Algorithm
```typescript
// Build color mapping for current cycle position
const colorMap = buildColorMapping(selectedColors, cycleIndex);

// Apply to layer during composition
const cycledImageData = applyCycleToLayer(layer, colorMap, selectedColors);
```

### Canvas Integration
- Integrates with existing `compositeLayersToCanvas` function
- Applied during layer composition, not stored in layer data
- Uses color distance matching to find pixels to cycle
- Maintains layer blend modes and opacity settings

## Technical Features

**Performance Optimized**: 
- Single cached color mappings
- GPU-accelerated canvas operations
- Efficient color matching algorithms
- Memory-conscious ImageData handling

**Color Matching**:
- Uses Euclidean distance in RGB space
- Configurable threshold for color similarity
- Handles color variations and slight differences

**UI Integration**:
- Conditional panel display when tool is active
- Modal color picker with proper z-index layering
- Responsive grid layout for color swatches
- Accessible controls with tooltips

## Key Features

- **Non-destructive**: Original artwork remains unchanged
- **Layer-specific**: Apply to selected layers only
- **Real-time control**: Adjust speed and colors while animating
- **Professional tools**: Advanced color picker and auto-extraction
- **Performance optimized**: 60fps smooth animation capability
- **Memory efficient**: Minimal memory overhead during animation

## Use Cases

- **Animated Backgrounds**: Create flowing water, moving clouds, shifting gradients
- **Dynamic Elements**: Animate fire, energy effects, magical auras
- **Retro Aesthetics**: Classic 80s/90s palette cycling effects
- **Interactive Art**: Real-time color shifting for dynamic presentations
- **Game Development**: Animated tiles, environmental effects, UI elements

---

*The Color Cycle feature brings classic palette animation techniques to modern digital art creation with professional controls and smooth performance.*

# Modular Brush Engine

## Purpose
The Modular Brush Engine provides a sophisticated, performance-optimized system for creating, managing, and applying brush effects. The engine separates brush behavior into modular components that can be mixed, matched, and reused across different brush types while maintaining 60fps performance.

## Engine Architecture

### Brush Component System
**Purpose**: Break down brush behavior into independent, reusable modules.

```typescript
interface BrushComponent {
  id: string;                    // Unique component identifier
  type: ComponentType;           // Size, opacity, pattern, spacing, etc.
  parameters: ComponentParams;   // Component-specific settings
  priority: number;              // Execution order (0-100)
  enabled: boolean;              // Component active state
}

enum ComponentType {
  SIZE_MODIFIER = 'size',        // Size calculation and variation
  OPACITY_MODIFIER = 'opacity',  // Opacity and transparency effects
  PATTERN_RENDERER = 'pattern',  // Brush pattern and texture
  SPACING_CONTROLLER = 'spacing', // Stroke spacing and distribution
  PRESSURE_HANDLER = 'pressure', // Pressure sensitivity simulation
  ANTI_ALIASING = 'antialiasing', // Pixel vs antialiased rendering
  COLOR_BLENDING = 'blending',   // Color mixing and blend modes
  ROTATION_TRANSFORM = 'rotation' // Brush rotation and orientation
}
```

### Brush Settings Reference
**Core Settings**: Definitive parameters for all brush configurations.

| Setting | Range | Unit | Description |
|---------|-------|------|-------------|
| Size | 1-1000 | pixels | Brush diameter |
| Opacity | 0-1 | decimal | Transparency (0=transparent, 1=opaque) |
| Spacing | 0.1-10 | multiplier | Distance between brush stamps |
| Pressure Size | 0-1 | decimal | Size variation from pressure |
| Pressure Opacity | 0-1 | decimal | Opacity variation from pressure |
| Rotation | 0-360 | degrees | Brush orientation |
| Pixel Perfect | boolean | flag | Integer positioning mode |

### Component Composition Pipeline
**Execution Flow**: Components execute in priority order to build final brush behavior.

```
Input (Mouse/Tablet) → Component Pipeline → Final Brush Stroke
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Component Execution Pipeline (Priority Order)          │
├─────────────────────────────────────────────────────────┤
│  1. Pressure Handler (Read tablet/mouse input)          │
│  2. Size Modifier (Calculate final brush size)          │
│  3. Opacity Modifier (Apply transparency effects)       │
│  4. Spacing Controller (Determine stroke distribution)  │
│  5. Anti-aliasing (Set pixel/smooth rendering mode)     │
│  6. Pattern Renderer (Apply brush texture/pattern)      │
│  7. Rotation Transform (Apply brush orientation)        │
│  8. Color Blending (Final color mixing and output)      │
└─────────────────────────────────────────────────────────┘
                           ↓
                   Rendered Stroke
```

## Core Brush Components

### Size Modifier Component
**Purpose**: Calculate final brush size with pressure sensitivity and variation.

```typescript
interface SizeModifierParams {
  baseSize: number;              // Base brush size (1-1000px)
  pressureInfluence: number;     // Pressure effect on size (0-1)
  minSize: number;               // Minimum size limit
  maxSize: number;               // Maximum size limit
  variationAmount: number;       // Random size variation (0-1)
  variationSeed: number;         // Random seed for consistency
}

class SizeModifierComponent implements BrushComponent {
  execute(input: StrokeInput): number {
    const pressure = input.pressure || 0.5;
    const variation = this.calculateVariation(input.position);
    
    return Math.max(
      this.params.minSize,
      Math.min(
        this.params.maxSize,
        this.params.baseSize * 
        (1 + (pressure - 0.5) * this.params.pressureInfluence) *
        (1 + variation * this.params.variationAmount)
      )
    );
  }
}
```

### Anti-aliasing Component
**Purpose**: Control pixel-perfect vs antialiased rendering per brush.

```typescript
interface AntiAliasingParams {
  mode: 'pixel' | 'antialiased'; // Rendering mode
  pixelAlignment: boolean;        // Snap to pixel grid
  edgeSharpness: number;         // Edge sharpness control (0-1)
  subpixelPrecision: boolean;    // Subpixel positioning
}

class AntiAliasingComponent implements BrushComponent {
  execute(input: StrokeInput): RenderSettings {
    if (this.params.mode === 'pixel') {
      return {
        antiAliasing: false,
        pixelAlignment: true,
        smoothing: false,
        snapToGrid: true
      };
    } else {
      return {
        antiAliasing: true,
        pixelAlignment: false,
        smoothing: true,
        edgeSharpness: this.params.edgeSharpness
      };
    }
  }
}
```

### Pressure Handler Component
**Purpose**: Process tablet/mouse input and simulate natural pressure curves.

```typescript
interface PressureHandlerParams {
  inputSource: 'mouse' | 'tablet'; // Input device type
  pressureCurve: number[];          // Pressure response curve
  velocityInfluence: number;        // Mouse velocity to pressure (0-1)
  smoothing: number;                // Pressure smoothing factor (0-1)
  minimumPressure: number;          // Minimum pressure value
}

class PressureHandlerComponent implements BrushComponent {
  private pressureHistory: number[] = [];
  
  execute(input: StrokeInput): number {
    let pressure = input.pressure;
    
    if (this.params.inputSource === 'mouse') {
      // Simulate pressure from mouse velocity
      pressure = this.calculateVelocityPressure(input.velocity);
    }
    
    // Apply pressure curve
    pressure = this.applyPressureCurve(pressure);
    
    // Smooth pressure changes
    pressure = this.smoothPressure(pressure);
    
    return Math.max(this.params.minimumPressure, pressure);
  }
}
```

### Pattern Renderer Component
**Purpose**: Apply brush textures, patterns, and custom brush stamps.

```typescript
interface PatternRendererParams {
  patternType: 'solid' | 'texture' | 'custom'; // Pattern type
  patternData: ImageData | null;               // Custom pattern data
  patternScale: number;                        // Pattern scale factor
  patternRotation: number;                     // Pattern rotation angle
  patternOpacity: number;                      // Pattern opacity
  blendMode: string;                           // Pattern blend mode
}

class PatternRendererComponent implements BrushComponent {
  private patternCache: Map<string, HTMLCanvasElement> = new Map();
  
  execute(input: StrokeInput): PatternResult {
    if (this.params.patternType === 'custom' && this.params.patternData) {
      const cachedPattern = this.getCachedPattern(
        this.params.patternData,
        this.params.patternScale,
        this.params.patternRotation
      );
      
      return {
        pattern: cachedPattern,
        opacity: this.params.patternOpacity,
        blendMode: this.params.blendMode
      };
    }
    
    return { pattern: null, opacity: 1, blendMode: 'normal' };
  }
}
```

## Brush Preset System

### Preset Management
**Purpose**: Organize and manage collections of brush components as reusable presets.

```typescript
interface BrushPreset {
  id: string;                    // Unique preset identifier
  name: string;                  // Display name
  category: string;              // Preset category (Pixel, Digital, Traditional)
  components: BrushComponent[];  // Component configuration
  thumbnail: string;             // Base64 thumbnail preview
  tags: string[];                // Search tags
  isDefault: boolean;            // System default preset
  createdAt: Date;               // Creation timestamp
  modifiedAt: Date;              // Last modification
}

// Example brush presets
const PRESET_PIXEL_1PX: BrushPreset = {
  id: 'pixel-1px',
  name: '1px Pixel Brush',
  category: 'Pixel Art',
  components: [
    { type: 'size', params: { baseSize: 1, pressureInfluence: 0 } },
    { type: 'antialiasing', params: { mode: 'pixel', pixelAlignment: true } },
    { type: 'spacing', params: { spacingMode: 'pixel-perfect' } },
    { type: 'opacity', params: { baseOpacity: 1, pressureInfluence: 0 } }
  ],
  tags: ['pixel', 'precise', '1px'],
  isDefault: true
};

const PRESET_SOFT_ROUND: BrushPreset = {
  id: 'soft-round',
  name: 'Soft Round Brush',
  category: 'Digital Painting',
  components: [
    { type: 'size', params: { baseSize: 20, pressureInfluence: 0.8 } },
    { type: 'antialiasing', params: { mode: 'antialiased', edgeSharpness: 0.3 } },
    { type: 'pressure', params: { pressureCurve: [0, 0.2, 0.8, 1] } },
    { type: 'opacity', params: { baseOpacity: 0.8, pressureInfluence: 0.6 } }
  ],
  tags: ['soft', 'painting', 'pressure'],
  isDefault: true
};
```

### Component Transfer System
**Purpose**: Allow users to copy components between brushes for rapid customization.

```typescript
class ComponentTransferSystem {
  // Copy specific components from one brush to another
  transferComponents(
    sourceBrush: BrushPreset,
    targetBrush: BrushPreset,
    componentTypes: ComponentType[]
  ): BrushPreset {
    const newComponents = [...targetBrush.components];
    
    componentTypes.forEach(type => {
      const sourceComponent = sourceBrush.components.find(c => c.type === type);
      if (sourceComponent) {
        // Remove existing component of same type
        const existingIndex = newComponents.findIndex(c => c.type === type);
        if (existingIndex >= 0) {
          newComponents[existingIndex] = { ...sourceComponent };
        } else {
          newComponents.push({ ...sourceComponent });
        }
      }
    });
    
    return {
      ...targetBrush,
      components: newComponents,
      modifiedAt: new Date()
    };
  }
  
  // Create brush template from component selection
  createTemplate(components: BrushComponent[]): BrushTemplate {
    return {
      id: generateId(),
      name: 'Custom Template',
      components: components.map(c => ({ ...c })),
      isTemplate: true
    };
  }
}
```

## Performance Optimization

### Component Caching
**Purpose**: Cache expensive component calculations for 60fps performance.

```typescript
class ComponentCache {
  private cache: Map<string, any> = new Map();
  private maxCacheSize = 1000;
  
  getCached<T>(key: string, calculator: () => T): T {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    const result = calculator();
    
    // Manage cache size
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, result);
    return result;
  }
  
  // Cache pattern rotations for performance
  getCachedRotation(pattern: ImageData, angle: number): HTMLCanvasElement {
    const key = `rotation-${pattern.width}x${pattern.height}-${angle}`;
    return this.getCached(key, () => this.rotatePattern(pattern, angle));
  }
}
```

### Execution Pipeline Optimization
**Purpose**: Optimize component execution order for maximum performance.

```typescript
class BrushExecutionEngine {
  private componentCache = new ComponentCache();
  
  execute(brush: BrushPreset, input: StrokeInput): BrushStroke {
    // Sort components by priority for optimal execution order
    const sortedComponents = brush.components
      .filter(c => c.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    let strokeData: any = { input };
    
    // Execute components in pipeline
    for (const component of sortedComponents) {
      const startTime = performance.now();
      
      strokeData = this.executeComponent(component, strokeData);
      
      // Monitor component performance
      const executionTime = performance.now() - startTime;
      if (executionTime > 1) { // >1ms is concerning for 60fps
        console.warn(`Component ${component.type} took ${executionTime}ms`);
      }
    }
    
    return strokeData;
  }
  
  private executeComponent(component: BrushComponent, data: any): any {
    // Use caching for expensive operations
    const cacheKey = `${component.type}-${JSON.stringify(component.parameters)}`;
    
    if (component.type === 'pattern' || component.type === 'rotation') {
      return this.componentCache.getCached(cacheKey, () => 
        component.execute(data)
      );
    }
    
    return component.execute(data);
  }
}
```

## Custom Brush Creation

### Canvas Selection to Brush
**Purpose**: Create custom brushes from canvas selections with layer options.

```typescript
interface CustomBrushCreation {
  sourceSelection: SelectionArea;     // Canvas selection area
  layerSource: 'selected' | 'all';   // Layer inclusion mode
  brushSize: number;                  // Final brush size
  centerPoint: { x: number; y: number }; // Brush center point
  autoTrim: boolean;                  // Remove transparent edges
}

class CustomBrushFactory {
  createFromSelection(params: CustomBrushCreation): BrushPreset {
    // Extract pixel data from selection
    const pixelData = this.extractSelectionData(
      params.sourceSelection,
      params.layerSource
    );
    
    // Process brush pattern
    const processedPattern = this.processBrushPattern(pixelData, {
      autoTrim: params.autoTrim,
      centerPoint: params.centerPoint,
      targetSize: params.brushSize
    });
    
    // Create brush components
    const components: BrushComponent[] = [
      {
        type: 'pattern',
        params: {
          patternType: 'custom',
          patternData: processedPattern,
          patternScale: 1,
          patternRotation: 0
        },
        priority: 60,
        enabled: true
      },
      {
        type: 'size',
        params: {
          baseSize: params.brushSize,
          pressureInfluence: 0.5
        },
        priority: 20,
        enabled: true
      }
    ];
    
    return {
      id: generateId(),
      name: 'Custom Brush',
      category: 'Custom',
      components,
      thumbnail: this.generateThumbnail(processedPattern),
      tags: ['custom'],
      isDefault: false,
      createdAt: new Date(),
      modifiedAt: new Date()
    };
  }
}
```

## Brush Library Management

### Organization System
**Purpose**: Efficiently organize and search extensive brush collections.

```typescript
interface BrushLibrary {
  categories: BrushCategory[];       // Organized categories
  searchIndex: Map<string, string[]>; // Tag-based search
  recentBrushes: string[];          // Recently used brush IDs
  favorites: string[];              // Favorite brush IDs
  customBrushes: string[];          // User-created brushes
}

class BrushLibraryManager {
  private library: BrushLibrary;
  
  // Organize brushes into categories
  organizeByCategory(): BrushCategory[] {
    return [
      { name: 'Pixel Art', brushes: this.getPixelBrushes() },
      { name: 'Digital Painting', brushes: this.getDigitalBrushes() },
      { name: 'Traditional Media', brushes: this.getTraditionalBrushes() },
      { name: 'Custom', brushes: this.getCustomBrushes() },
      { name: 'Recent', brushes: this.getRecentBrushes() },
      { name: 'Favorites', brushes: this.getFavoriteBrushes() }
    ];
  }
  
  // Search brushes by tags and properties
  searchBrushes(query: string): BrushPreset[] {
    const searchTerms = query.toLowerCase().split(' ');
    const results: Set<string> = new Set();
    
    searchTerms.forEach(term => {
      const matches = this.library.searchIndex.get(term) || [];
      matches.forEach(id => results.add(id));
    });
    
    return Array.from(results).map(id => this.getBrushById(id));
  }
  
  // Performance monitoring for brush operations
  measureBrushPerformance(brushId: string): PerformanceMetrics {
    const brush = this.getBrushById(brushId);
    const metrics = {
      componentCount: brush.components.length,
      estimatedExecutionTime: this.estimateExecutionTime(brush),
      memoryUsage: this.estimateMemoryUsage(brush),
      cacheHitRate: this.getCacheHitRate(brushId)
    };
    
    return metrics;
  }
}
```

## Integration with Drawing System

### Real-time Brush Application
**Purpose**: Apply modular brush effects during drawing with 60fps performance.

```typescript
class DrawingIntegration {
  private brushEngine = new BrushExecutionEngine();
  private activePreset: BrushPreset;
  
  // Apply brush during stroke
  applyBrushStroke(points: StrokePoint[]): void {
    const batchSize = 10; // Process points in batches for 60fps
    
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      
      requestAnimationFrame(() => {
        batch.forEach(point => {
          const strokeResult = this.brushEngine.execute(
            this.activePreset,
            point
          );
          this.renderStrokePoint(strokeResult);
        });
      });
    }
  }
  
  // Switch brush presets without affecting existing strokes
  switchBrush(newPreset: BrushPreset): void {
    this.activePreset = newPreset;
    // No effect on already-drawn pixels
    this.updateBrushCursor(newPreset);
  }
}
```

---

*The Modular Brush Engine provides a sophisticated foundation for TinyBrush's extensive brush system while maintaining 60fps performance through optimized component architecture and intelligent caching strategies.*

# Pixel-Perfect Drawing

> Achieving crisp, pixel-aligned artwork in TinyBrush

## Overview

Pixel-perfect drawing ensures that lines and shapes align precisely with the pixel grid, eliminating anti-aliasing blur for sharp, retro-style artwork. This is essential for pixel art, technical drawings, and any artwork requiring precise control.

## The Half-Pixel Problem

### Understanding Canvas Coordinates

HTML Canvas uses a coordinate system where pixel boundaries fall on integer values, but the coordinate system itself is continuous. This creates a common issue:

- A line drawn from (10, 10) to (20, 10) with width 1px actually spans from 9.5 to 10.5 vertically
- This causes the line to cover parts of two pixel rows, resulting in anti-aliasing blur

### The Solution: Half-Pixel Offset

```javascript
// Blurry line
ctx.moveTo(10, 10);
ctx.lineTo(20, 10);

// Crisp line
ctx.moveTo(10.5, 10.5);
ctx.lineTo(20.5, 10.5);
```

## TinyBrush Implementation

### Enabling Pixel-Perfect Mode

TinyBrush provides a pixel-perfect toggle in the brush settings that:
1. Snaps coordinates to pixel boundaries
2. Disables anti-aliasing
3. Adjusts line positioning automatically

### How It Works

```javascript
// Pixel snapping function
function snapToPixel(coord) {
  return Math.floor(coord) + 0.5;
}

// Apply to drawing operations
if (pixelPerfectMode) {
  x = snapToPixel(x);
  y = snapToPixel(y);
}
```

## Best Practices

### 1. Use Integer Brush Sizes

- 1px, 2px, 3px, etc. work best
- Avoid fractional sizes (1.5px, 2.7px)
- Even-width lines need different handling than odd-width

### 2. Coordinate Adjustment Rules

For different line widths:
- **Odd widths (1px, 3px, 5px)**: Add 0.5 to coordinates
- **Even widths (2px, 4px, 6px)**: Use integer coordinates

```javascript
function getPixelPerfectCoord(coord, lineWidth) {
  if (lineWidth % 2 === 1) {
    // Odd width: offset by 0.5
    return Math.floor(coord) + 0.5;
  } else {
    // Even width: round to integer
    return Math.round(coord);
  }
}
```

### 3. Disable Image Smoothing

```javascript
// For pixel art and sharp edges
ctx.imageSmoothingEnabled = false;
ctx.webkitImageSmoothingEnabled = false;
ctx.mozImageSmoothingEnabled = false;
ctx.msImageSmoothingEnabled = false;
```

### 4. Handle Retina Displays

High-DPI displays require special consideration:

```javascript
// Get device pixel ratio
const dpr = window.devicePixelRatio || 1;

// Scale canvas for retina
canvas.width = width * dpr;
canvas.height = height * dpr;
canvas.style.width = width + 'px';
canvas.style.height = height + 'px';

// Scale context
ctx.scale(dpr, dpr);
```

## Common Patterns

### Drawing Pixel-Perfect Rectangles

```javascript
function drawPixelPerfectRect(x, y, width, height, lineWidth) {
  ctx.lineWidth = lineWidth;
  
  if (lineWidth % 2 === 1) {
    // Odd line width: offset by 0.5
    ctx.strokeRect(
      Math.floor(x) + 0.5,
      Math.floor(y) + 0.5,
      Math.floor(width),
      Math.floor(height)
    );
  } else {
    // Even line width: use integers
    ctx.strokeRect(
      Math.round(x),
      Math.round(y),
      Math.round(width),
      Math.round(height)
    );
  }
}
```

### Drawing Pixel-Perfect Lines

```javascript
function drawPixelPerfectLine(x1, y1, x2, y2, lineWidth) {
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  
  if (lineWidth % 2 === 1) {
    // Odd line width
    ctx.moveTo(Math.floor(x1) + 0.5, Math.floor(y1) + 0.5);
    ctx.lineTo(Math.floor(x2) + 0.5, Math.floor(y2) + 0.5);
  } else {
    // Even line width
    ctx.moveTo(Math.round(x1), Math.round(y1));
    ctx.lineTo(Math.round(x2), Math.round(y2));
  }
  
  ctx.stroke();
}
```

### Pixel Grid Overlay

For precise work, TinyBrush can display a pixel grid:

```javascript
function drawPixelGrid(ctx, width, height, scale) {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  
  // Vertical lines
  for (let x = 0; x <= width; x += scale) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  
  // Horizontal lines
  for (let y = 0; y <= height; y += scale) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}
```

## Performance Considerations

### Caching Pixel-Perfect Paths

Pre-calculate common shapes to avoid repeated coordinate snapping:

```javascript
const pixelPerfectCache = new Map();

function getPixelPerfectPath(points, lineWidth) {
  const key = JSON.stringify({ points, lineWidth });
  
  if (!pixelPerfectCache.has(key)) {
    const snappedPoints = points.map(([x, y]) => [
      getPixelPerfectCoord(x, lineWidth),
      getPixelPerfectCoord(y, lineWidth)
    ]);
    pixelPerfectCache.set(key, snappedPoints);
  }
  
  return pixelPerfectCache.get(key);
}
```

### Batch Operations

Minimize state changes for better performance:

```javascript
// Good: batch similar operations
ctx.save();
ctx.imageSmoothingEnabled = false;
ctx.lineWidth = 1;

// Draw all 1px lines
drawAllPixelPerfectLines();

ctx.restore();

// Bad: changing settings for each line
lines.forEach(line => {
  ctx.imageSmoothingEnabled = false; // Redundant
  ctx.lineWidth = 1; // Redundant
  drawLine(line);
});
```

## Integration with TinyBrush

### Pixel-Perfect Brush Component

TinyBrush implements pixel-perfect drawing through:

1. **AntiAliasingComponent**: Controls image smoothing and pixel alignment
2. **Coordinate snapping**: Applied before brush stroke rendering
3. **Brush size constraints**: Limits to integer values in pixel-perfect mode

### Usage Tips

1. **Enable pixel-perfect mode** when starting pixel art projects
2. **Use the grid overlay** for precise placement
3. **Zoom in** to work at the pixel level (8x or 16x recommended)
4. **Save as PNG** to preserve sharp pixels without compression

## Troubleshooting

### Blurry Lines Despite Pixel-Perfect Mode

**Causes:**
- Fractional coordinates from mouse input
- Transform scaling applied to context
- Browser zoom not at 100%

**Solutions:**
```javascript
// Ensure integer coordinates
x = Math.floor(mouseX);
y = Math.floor(mouseY);

// Reset transforms
ctx.setTransform(1, 0, 0, 1, 0, 0);

// Check browser zoom
if (window.devicePixelRatio !== 1) {
  console.warn('Browser zoom may affect pixel-perfect rendering');
}
```

### Lines Disappearing at Certain Positions

This occurs when coordinates fall exactly between pixels:

```javascript
// Problem: line at y=10.0 might disappear
ctx.moveTo(0, 10);
ctx.lineTo(100, 10);

// Solution: always use half-pixel offset
ctx.moveTo(0, 10.5);
ctx.lineTo(100, 10.5);
```

## Advanced Techniques

### Pixel-Perfect Scaling

Scale artwork while preserving sharp pixels:

```javascript
function scalePixelArt(source, scale) {
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = source.width * scale;
  scaledCanvas.height = source.height * scale;
  
  const ctx = scaledCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  
  // Use nearest-neighbor scaling
  ctx.drawImage(
    source,
    0, 0, source.width, source.height,
    0, 0, scaledCanvas.width, scaledCanvas.height
  );
  
  return scaledCanvas;
}
```

## Conclusion

Pixel-perfect drawing in TinyBrush combines mathematical precision with artistic control. By understanding the half-pixel offset issue and applying the appropriate techniques, you can create crisp, professional pixel art and technical drawings.

Remember: the key to pixel-perfect drawing is consistency. Always apply the same rules throughout your project, and test your work at 100% zoom to ensure pixels align correctly.

# Tool Interface

## Purpose
The Tool Interface provides a streamlined, performance-optimized drawing experience with tools organized for maximum efficiency. The interface ensures 60fps performance while providing comprehensive tool options and settings.

## Interface Layout

### Left Toolbar - Primary Tools
**Purpose**: Main tool selection with immediate access to core drawing functions.

**Tool Organization**:
```
┌─────────────────┐
│   Selection     │  ← Square selection with resize handles
│   Brush         │  ← Premade brushes with modular settings  
│   Custom Brush  │  ← Create brushes from canvas selections
│   Fill          │  ← Paint bucket with connectivity options
│   Eraser        │  ← Quick pixel erasing with layer options
└─────────────────┘
```

**Core Flow**:
1. User clicks tool in left toolbar
2. Tool becomes active with visual feedback
3. Right column displays tool-specific options
4. Canvas interaction mode updates immediately
5. All operations maintain 60fps performance

### Right Column - Tool Options
**Purpose**: Context-sensitive options that appear when tools are selected.

**Dynamic Content**:
- **Selection Tool**: Resize handles, move options, Enter to confirm
- **Brush Tool**: Size, opacity, brush presets, pixel/antialiased mode
- **Custom Brush Tool**: Layer selection, capture area, brush settings
- **Fill Tool**: Connected toggle, threshold slider (1-256)
- **Eraser Tool**: Layer target, size settings, temporary E-key mode

## Core Tools Specification

### Selection Tool Interface
> **Note**: For tool functionality, see [Drawing Tools](./Drawing_Tools.md#selection-tool)

**Right Column Options**:
```
Selection Options
├── Move Selected Pixels
├── Resize Selection  
├── Delete Selected Area
└── Enter: Fix in Place
```
- Instant pixel movement feedback

### Brush Tool Interface
> **Note**: For tool functionality, see [Drawing Tools](./Drawing_Tools.md#brush-tool)

**Right Column Options**:
> **Note**: For parameter ranges, see [Brush Settings Reference](./Modular_Brush_Engine.md#brush-settings-reference)

```
Brush Settings
├── Brush Presets
│   ├── Rendering: [Pixel/Antialiased]
│   ├── Default size (1px, 3px, 5px)
│   ├── Soft Round (various sizes)
│   ├── Hard Round (crisp edges)
│   └── Textured (chalk, marker, etc.)
├── Size: [configurable range]
├── Opacity: [configurable range]
├── Pressure Sensitivity: [On/Off]
└── Modular Settings Transfer
```

**UI Features**:
- Real-time preview of setting changes
- Settings transfer between brushes

### Custom Brush Tool Interface
> **Note**: For tool functionality, see [Drawing Tools](./Drawing_Tools.md#custom-brush-tool)

**Right Column Options**:
```
Custom Brush Creation
├── Source Selection
│   ├── Selected Layer Only
│   └── All Visible Layers
├── Brush Preview
├── Size Adjustment
├── Save to Presets
└── Name Custom Brush
```

### Fill Tool Interface
> **Note**: For tool functionality, see [Drawing Tools](./Drawing_Tools.md#fill-tool)

**Right Column Options**:
```
Fill Settings
├── Connected: [On/Off]
├── Threshold: [1-256]
├── Fill Color
└── Target Layer
```

### Eraser Tool Interface
> **Note**: For tool functionality, see [Drawing Tools](./Drawing_Tools.md#eraser-tool)

**Right Column Options**:
```
Eraser Settings
├── Target Layers
│   ├── Selected Layer Only
│   └── All Visible Layers
├── Size: [Inherit from Brush]
├── Opacity: [0-100%]
└── E Key: Temporary Mode
```

## Color Management System

### Color Picker Interface
**Purpose**: Comprehensive color selection with professional tools and workflow optimization.

**Color Selection Methods**:
```
Color Picker
├── Color Wheel
├── RGB Sliders
├── HSB Sliders  
├── Hex Input
├── Eyedropper Tool
└── Swatches Panel
```

### Last Used Colors
**Purpose**: Quick access to recently selected colors for efficient workflow.

**Features**:
- **Recent Colors**: Last 10 used colors in chronological order
- **Quick Access**: Click to immediately select recent color
- **Visual History**: Color swatches with usage timestamps
- **Auto-Update**: List updates automatically with each color selection

### Favorite Colors
**Purpose**: Save and organize frequently used colors for projects and workflows.

**Organization**:
```
Favorites Panel
├── Save Current Color
├── Organized Swatches
├── Color Collections
│   ├── Project Palettes
│   ├── Skin Tones
│   └── Custom Sets
├── Import/Export
└── Delete/Reorder
```

**Management Features**:
- **Save to Favorites**: One-click save of current color
- **Collections**: Organize colors into named groups
- **Import/Export**: Share color palettes as files
- **Drag Reorder**: Reorganize favorites by dragging

## Performance Requirements

### 60 FPS Guarantee
**Core Performance Standards**:
- **Tool Switching**: Instant tool activation (<16ms)
- **Option Updates**: Real-time option panel updates
- **Canvas Interaction**: Smooth tool operation at 60fps
- **UI Responsiveness**: No blocking operations during drawing

### Optimization Strategies
**Interface Performance**:
- **Lazy Loading**: Options load only when tool selected
- **Event Debouncing**: Rapid setting changes debounced
- **Virtual Scrolling**: Large brush lists virtualized
- **Memory Management**: Unused tool data garbage collected

### Performance Monitoring
```typescript
interface PerformanceMetrics {
  toolSwitchTime: number;    // Tool activation latency
  optionUpdateTime: number;  // Settings panel update time
  canvasFrameRate: number;   // Actual drawing FPS
  memoryUsage: number;       // Tool interface memory
}
```

## Keyboard Shortcuts

### Tool Selection
- **V**: Selection tool
- **B**: Brush tool  
- **U**: Custom Brush tool
- **G**: Fill tool
- **E**: Eraser tool (hold for temporary)

### Tool Modifiers
- **Enter**: Confirm selection (Selection tool)
- **Shift**: Constrain proportions (Selection tool)
- **Alt**: Eyedropper (temporary color picker)
- **Ctrl**: Precision mode (slower, more accurate)

### Interface Navigation
- **Tab**: Cycle through tool options
- **Space**: Pan canvas (temporary)
- **[/]**: Adjust brush size
- **Shift + [/]**: Adjust in larger increments

## Accessibility Features

### Visual Feedback
- **Tool Highlights**: Clear indication of active tool
- **Cursor Changes**: Tool-specific cursor shapes
- **Status Updates**: Real-time status information
- **Color Indicators**: Current color clearly displayed

### Keyboard Navigation
- **Tab Order**: Logical navigation through interface
- **Arrow Keys**: Navigate tool options
- **Enter/Space**: Activate buttons and options
- **Escape**: Cancel operations

---

*The Tool Interface provides a streamlined, performance-first approach to digital art creation with comprehensive tools organized for maximum creative efficiency.*

## Canvas Interaction Improvements

### Cursor-Centered Zooming Fix (2025-07-07)

**Problem**: Mouse wheel zooming was not centered on the cursor position due to coordinate space mixing in the zoom calculation.

**Root Cause**: The `handleWheel` function was mixing screen coordinates with canvas coordinates in the pan calculation:
```typescript
// Problematic code (mixing coordinate spaces)
const newPanX = cursorX - canvasPointX * newZoom;
const newPanY = cursorY - canvasPointY * newZoom;
```

**Solution**: Fixed coordinate space consistency by converting everything to canvas coordinate space:
```typescript
// Corrected implementation (consistent coordinate space)
const newPanX = cursorX / newZoom - canvasPointX;
const newPanY = cursorY / newZoom - canvasPointY;
```

**Technical Details**:
- `cursorX / newZoom` converts screen coordinate to canvas coordinate space at the new zoom level
- `canvasPointX` is already in canvas coordinates 
- Result `newPanX` is in canvas coordinates, matching `setPan` expectations
- Maintains consistency with existing `screenToCanvas` function coordinate transformations

**Result**: Mouse wheel zooming now properly centers on the cursor position at all zoom levels and canvas positions, providing the expected user experience for precise artwork manipulation.

**Performance**: Fix maintains 60fps zoom performance with no additional computational overhead.

### Pixel Brush Implementation (2025-07-08)

**Feature**: Added a proper pixel brush to the brush library with 1px size, hard edges, and pixel-perfect drawing.

**Implementation**: 
- **Brush Preset System**: Created a comprehensive modular system for managing brush presets with component-based configuration
- **Pixel Brush Preset**: Configured specifically for 1px size, hard edges, and pixel-perfect drawing with the following components:
  - Size Modifier: Fixed 1px size with no pressure variation
  - Opacity Modifier: Full opacity (1.0) with no pressure variation  
  - Anti-aliasing Component: Pixel-perfect mode with disabled smoothing
- **Store Integration**: Added brush preset management to the app store with `setBrushPreset`, `currentBrushPreset`, and `activeBrushComponents`
- **Library Integration**: Updated BrushLibrary component to use real brush presets instead of dummy data
- **Engine Integration**: Modified brush engine to use active brush components from store

**Technical Details**:
```typescript
// Pixel brush configuration
const pixelBrushComponents: BrushComponent[] = [
  {
    id: 'pixel-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: { minSize: 1, maxSize: 1, pressureInfluence: 0 },
    priority: 10,
    enabled: true
  },
  {
    id: 'pixel-antialiasing', 
    type: ComponentType.ANTI_ALIASING,
    parameters: { mode: 'pixel' },
    priority: 30,
    enabled: true
  }
];
```

**Files Modified**:
- `/src/presets/brushPresets.ts` (NEW): Brush preset definitions and management
- `/src/stores/useAppStore.ts`: Added brush preset state management
- `/src/components/BrushLibrary.tsx`: Updated to use real brush presets
- `/src/hooks/useBrushEngine.ts`: Integration with active brush components

**User Experience**: Users can now select between "Pixel Brush" and "Default Brush" in the brush library, with the pixel brush providing crisp 1px drawing perfect for pixel art creation. The pixel brush is set as the default to support pixel-perfect artwork from the start.

**Performance**: Implementation maintains 60fps performance through optimized component caching and efficient brush switching without affecting existing strokes on canvas.

### Enhanced Pixel-Perfect Drawing Algorithm (2025-07-08)

**Feature**: Implemented Tom Cantwell's advanced pixel-perfect drawing algorithm for gap-free freehand pixel art at any cursor speed.

**Problem Solved**: 
- Fast cursor movement created dotted lines due to browser refresh rate limitations
- Simple coordinate rounding resulted in gaps between pixels
- Existing implementation only worked well for slow, deliberate drawing

**Implementation**: 
- **Hybrid Speed Detection**: Movement >1 pixel uses Bresenham's line algorithm, ≤1 pixel uses pixel queue
- **Pixel Queue System**: Tracks lastDrawn, waiting, and current pixels to ensure smooth connections
- **Bresenham's Line Algorithm**: Draws individual pixels along line path for perfect antialiasing-free lines
- **Stroke Reset**: Queue resets on mousedown/touchstart for clean stroke starts

**Technical Details**:
```typescript
// Speed detection logic (exact from Tom Cantwell's algorithm)
if (Math.abs(roundedToX - roundedFromX) > 1 || Math.abs(roundedToY - roundedFromY) > 1) {
  // Fast movement - use Bresenham's line algorithm
  drawPixelPerfectLine(ctx, roundedFromX, roundedFromY, roundedToX, roundedToY, settings.color);
} else {
  // Slow movement - use perfect pixel queue
  perfectPixels(ctx, to.x, to.y, settings);
}

// Pixel queue algorithm
if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
  // Draw waiting pixel when current is no longer neighbor
  ctx.fillRect(queue.waitingPixelX, queue.waitingPixelY, 1, 1);
  // Update queue state
  queue.lastDrawnX = queue.waitingPixelX;
  queue.lastDrawnY = queue.waitingPixelY;
}
```

**Files Modified**:
- `/src/hooks/useBrushEngine.ts`: Added pixel queue state, perfectPixels(), drawPixelPerfectLine()
- `/src/components/canvas/DrawingCanvas.tsx`: Added resetPixelQueue() on stroke start

**Result**: Pixel brush now produces smooth, gap-free lines at any drawing speed with true pixel-perfect accuracy and no antialiasing artifacts.

### Canvas Display Mode Architecture (2025-07-08)

**Issue Fixed**: Switching brushes would change the appearance of ALL existing strokes on canvas.

**Root Cause**: CSS `imageRendering` property was dynamically applied based on current brush settings, affecting the entire canvas display rather than individual strokes.

**Solution Architecture**:
- **Separated Concerns**: Canvas display mode now independent from brush rendering settings
- **New State**: Added `canvas.displayMode: 'pixelated' | 'smooth'` to control overall canvas appearance
- **User Control**: Canvas Display toggle in toolbar allows users to control how ALL content appears
- **Persistent Strokes**: Each stroke retains its original rendering (pixel or antialiased) regardless of display mode

**Technical Implementation**:
```typescript
// Before (BROKEN) - tied to brush settings
imageRendering: tools.brushSettings.antialiasing ? 'auto' : 'pixelated'

// After (FIXED) - independent canvas display
imageRendering: canvas.displayMode === 'smooth' ? 'auto' : 'pixelated'
```

**Files Modified**:
- `/src/types/index.ts`: Added displayMode to CanvasState interface
- `/src/stores/useAppStore.ts`: Added displayMode state and setDisplayMode()
- `/src/components/canvas/DrawingCanvas.tsx`: Fixed imageRendering logic
- `/src/components/toolbar/BrushControls.tsx`: Added Canvas Display UI toggle

**User Experience**: Artists can now freely switch between pixel and antialiased brushes without affecting existing artwork. The Canvas Display toggle provides control over how the entire canvas appears (pixelated vs smooth) without modifying the actual stroke data.

**Architecture Principle**: Drawing behavior (per-stroke) is separate from display behavior (global canvas).

### Image Paste with Marching Ants Selection (2025-07-10)

**Feature**: Added ability to paste images from system clipboard with animated marching ants selection and drag-to-move functionality.

**Problem Solved**:
- No way to import external images into the canvas
- Difficult to position pasted content precisely
- No visual feedback for selected/pasted content

**Implementation**:
- **Clipboard Integration**: Added paste event listener to detect Ctrl+V operations
- **Image Processing**: Convert clipboard images to ImageData for canvas compatibility
- **Marching Ants Animation**: Animated selection border using alternating black/white dashes
- **Drag-to-Move**: Click and drag selected images to reposition them
- **Keyboard Controls**: Enter to commit, Escape to cancel
- **Selection State**: Extended existing selection system to handle pasted images

**Technical Details**:
```typescript
// Clipboard event handling
window.addEventListener('paste', async (e) => {
  const imageItem = Array.from(e.clipboardData?.items || [])
    .find(item => item.type.startsWith('image/'));
  
  if (imageItem) {
    const file = imageItem.getAsFile();
    // Convert to ImageData and create selection
  }
});

// Marching ants rendering with animation
ctx.setLineDash([4 / canvas.zoom, 4 / canvas.zoom]);
ctx.lineDashOffset = -(Date.now() * 0.01) % (8 / canvas.zoom);

// Animation loop for smooth marching effect
requestAnimationFrame(() => renderView());
```

**Files Modified**:
- `/src/components/canvas/DrawingCanvas.tsx`: Added clipboard handlers, selection rendering, drag logic
- `/src/stores/useAppStore.ts`: Selection state already supported image data
- `/src/types/index.ts`: No changes needed - selection types already sufficient

**User Experience**: 
1. Copy any image to clipboard from external source
2. Press Ctrl+V while TinyBrush is focused
3. Image appears with animated marching ants border
4. Drag to position, Enter to commit, Escape to cancel
5. Committed images become part of the active layer

**Final Implementation Status**: ✅ **WORKING**
- **Event Listener Issue Fixed**: Resolved event listener thrashing caused by unstable callback dependencies
- **Modern API Fallback**: Implemented both traditional paste events and modern Clipboard API
- **Stable Performance**: No console spam or listener conflicts
- **Full Feature Support**: All documented functionality working correctly

**Performance**: Maintains 60fps through efficient animation loop and optimized selection rendering. Marching ants only animate when selection is active.

## Custom Brush System

### Overview

TinyBrush features a sophisticated custom brush creation and editing system that allows users to create brushes from canvas selections and modify them with advanced color adjustments.

### Custom Brush Workflow

#### 1. Creating a Custom Brush

Custom brushes are created from canvas selections:
1. User selects an area with the selection tool
2. Creates a custom brush via context menu or keyboard shortcut (Ctrl+B)
3. Brush is stored as `temporaryCustomBrush` with ID format: `temp_brush_{timestamp}`
4. The `addCustomBrush` action automatically selects the new brush

#### 2. Custom Brush Editor

The brush editor provides a powerful interface for modifying custom brushes with real-time preview and color adjustments.

**Editor Features:**
- **Draggable Modal**: Click and drag the top bar (::::::::) to reposition the editor window
- **Zoom Controls**: Scroll wheel to zoom in/out, with zoom-to-cursor functionality
- **Pan Controls**: Hold spacebar and drag to pan around the canvas
- **Drawing Tools**: Draw directly on the brush with selected color and size
- **Fill Tool**: Fill areas with the selected color

**Color Adjustment System:**

The editor uses a sophisticated three-layer pixel management system:

1. **basePixelsForShift**: Stores pixels that should receive color adjustments
2. **originalBrushPixels**: Contains all drawn pixels including new additions
3. **brushPixels**: Final display with adjustments applied

**Adjustment Sliders:**
- **Hue Shift** (-180° to +180°): Rotates colors around the color wheel
- **Lightness** (-100 to +100): Brightens or darkens the brush
- **Saturation** (0% to 200%): Adjusts color intensity

**Color Behavior:**
- Original brush pixels and previously drawn pixels get color shifts applied
- Newly drawn pixels use the exact color from the color picker (no shift)
- When sliders are adjusted, all existing pixels (including newly drawn) become part of the base and will be shifted
- This allows for precise color control while editing

**Technical Implementation:**
```typescript
// Color adjustment logic
for each pixel:
  if pixel exists in basePixelsForShift:
    apply HSL adjustments
  else:
    keep original color from drawing
```

**Zoom-to-Cursor Implementation:**
The editor implements smooth zoom-to-cursor functionality:
```typescript
const canvasX = (mouseX - pan.x) / zoom;
const canvasY = (mouseY - pan.y) / zoom;
const newZoom = zoom * delta;
const newPanX = mouseX - canvasX * newZoom;
const newPanY = mouseY - canvasY * newZoom;
```

#### 3. Temporary vs Saved Brushes

**Temporary Custom Brushes:**
- Created from canvas selection
- Stored in `temporaryCustomBrush` state
- ID format: `temp_brush_{timestamp}`
- Cleared when saved to library or when creating a new custom brush

**Saved Custom Brushes (Presets):**
- Created when user clicks "+" in Brush Library
- Stored in `brushPresets` array
- ID format: `preset_temp_brush_{timestamp}`
- Persist across sessions

**Project Custom Brushes:**
- Loaded from saved project files
- Stored in `project.customBrushes`
- ID format: `custom_{originalBrushId}`
- Part of the project data

### ID Management and Brush Selection

The system uses different ID formats to track brush origins:

```typescript
// Temporary brush created from selection
selectedCustomBrush: "temp_brush_1234"

// After saving to library
selectedCustomBrush: "preset_temp_brush_1234"  

// Loaded from project file
selectedCustomBrush: "brush_id_from_file"
```

#### Key Components

**BrushLibrary.tsx:**
- `handlePresetClick`: Sets `selectedCustomBrush` based on preset type
  - For `custom_` prefix: strips prefix to get original ID
  - For `preset_` prefix: uses full preset ID
- `isPresetActive`: Determines which brush is highlighted
  - Uses same logic to match selected brush with preset

**MiniCanvas.tsx:**
- Looks up brush data in this order:
  1. `temporaryCustomBrush` (if ID matches)
  2. `project.customBrushes` (for project brushes)
  3. `brushPresets` (for saved presets with `customBrushData`)

**useAppStore.ts:**
- `addCustomBrush`: Automatically selects newly created brush
- `saveCustomBrushAsPreset`: 
  - Creates preset with ID `preset_{originalBrushId}`
  - Sets `selectedCustomBrush` to the preset ID
  - Clears `temporaryCustomBrush`

### Brush Data Storage

Custom brushes store their pixel data differently based on type:

**Temporary/Project Brushes:**
```typescript
{
  id: string,
  name: string,
  imageData: ImageData,
  width: number,
  height: number,
  thumbnail: string,
  createdAt: number
}
```

**Brush Presets:**
```typescript
{
  id: string,
  name: string,
  isCustomBrush: true,
  customBrushData: {
    imageData: ImageData,
    width: number,
    height: number
  },
  thumbnail: string,
  // ... other preset fields
}
```

### Brush Tip Display Flow

1. **Brush Creation**: MiniCanvas displays from `temporaryCustomBrush`
2. **Save to Library**: 
   - `temporaryCustomBrush` cleared
   - Brush data moved to preset's `customBrushData`
   - `selectedCustomBrush` updated to preset ID
3. **MiniCanvas Lookup**:
   - Detects `preset_` prefix
   - Finds matching preset in `brushPresets`
   - Extracts `customBrushData` for display

This architecture ensures custom brushes maintain their visual representation throughout their lifecycle, from creation to persistent storage.

## MiniCanvas System

### Overview

The MiniCanvas is a specialized component that provides real-time brush tip preview and visual feedback for the current brush settings. It displays a small, interactive preview of how the brush will appear when drawing on the main canvas.

### Purpose

- **Visual Feedback**: Shows users exactly what their brush strokes will look like
- **Brush Preview**: Displays custom brush patterns, size, and rendering mode
- **Interactive Updates**: Responds to brush setting changes in real-time
- **Performance Optimized**: Maintains 60fps with efficient rendering

### Architecture

#### Component Structure

```typescript
interface MiniCanvasProps {
  width: number;              // Canvas width (default: 64px)
  height: number;             // Canvas height (default: 64px)
  brushSettings: BrushSettings;
  customBrush?: CustomBrush | null;
  temporaryCustomBrush?: CustomBrush | null;
  isPixelCanvas?: boolean;
  onBrushIDChange?: (brushId: string) => void;
}
```

#### Key Features

1. **Brush Tip Rendering**
   - Displays brush shape at current size
   - Shows pixel vs antialiased rendering mode
   - Handles both standard and custom brushes

2. **Custom Brush Support**
   - Renders custom brush patterns from ImageData
   - Scales patterns to fit brush size
   - Maintains aspect ratio of custom brushes

3. **Real-time Updates**
   - Responds to brush size changes
   - Updates on brush type changes
   - Reflects opacity and color settings

### Rendering Pipeline

#### 1. Brush Tip Initialization

```typescript
const initializeBrushTip = useCallback(() => {
  const canvas = canvasRef.current;
  const ctx = canvas?.getContext('2d');
  
  // Clear previous tip
  ctx.clearRect(0, 0, width, height);
  
  // Determine brush type and size
  const brushId = generateBrushId();
  const size = getBrushTipSize();
  
  // Render appropriate brush tip
  if (brushSettings.brushShape === BrushShape.CUSTOM) {
    renderCustomBrush(ctx, customBrush, size);
  } else {
    renderStandardBrush(ctx, brushSettings.brushShape, size);
  }
}, [brushSettings, customBrush]);
```

#### 2. Custom Brush Rendering

For custom brushes, the MiniCanvas:

1. **Loads brush data** from appropriate source:
   - `temporaryCustomBrush` for newly created brushes
   - `project.customBrushes` for project brushes
   - `brushPresets` for saved brush presets

2. **Scales to fit** the canvas while maintaining aspect ratio:
   ```typescript
   const scale = Math.min(
     canvasSize / customBrush.width,
     canvasSize / customBrush.height
   );
   const scaledWidth = customBrush.width * scale;
   const scaledHeight = customBrush.height * scale;
   ```

3. **Centers the brush** in the display area:
   ```typescript
   const offsetX = (width - scaledWidth) / 2;
   const offsetY = (height - scaledHeight) / 2;
   ```

#### 3. Standard Brush Rendering

For standard brushes (Round, Square, etc.):

1. **Calculates display size** based on brush settings
2. **Applies rendering mode** (pixel vs antialiased)
3. **Draws appropriate shape** centered in canvas

### Performance Optimizations

#### 1. Selective Re-rendering

The MiniCanvas only re-renders when relevant props change:

```typescript
useEffect(() => {
  initializeBrushTip();
}, [
  brushSettings.brushShape,
  brushSettings.size,
  brushSettings.selectedCustomBrush,
  temporaryCustomBrush,
  project?.customBrushes,
  brushPresets
]);
```

#### 2. Canvas Reuse

- Single canvas element reused for all brush previews
- Avoids creating new canvases for each update
- Reduces memory allocation and garbage collection

#### 3. Efficient Custom Brush Lookup

Uses a hierarchical lookup strategy to find brush data:

```typescript
// 1. Check temporary brush first (most likely)
if (temporaryCustomBrush?.id === brushId) {
  return temporaryCustomBrush;
}

// 2. Check project brushes
const projectBrush = project?.customBrushes.find(b => b.id === brushId);
if (projectBrush) {
  return projectBrush;
}

// 3. Check saved presets (with prefix handling)
const preset = brushPresets.find(p => 
  p.id === brushId && 
  p.isCustomBrush && 
  p.customBrushData
);
```

### Integration Points

#### 1. Brush Controls

The MiniCanvas is embedded in the BrushControls component:

```typescript
<MiniCanvas
  width={64}
  height={64}
  brushSettings={brushSettings}
  customBrush={activeCustomBrush}
  temporaryCustomBrush={temporaryCustomBrush}
  isPixelCanvas={false}
  onBrushIDChange={(brushId) => 
    console.log(`Brush tip changed to: ${brushId}`)
  }
/>
```

#### 2. State Management

Connects to the app store for:
- Current brush settings
- Custom brush data
- Brush presets
- Project state

#### 3. Brush Engine Coordination

Works in tandem with the main brush engine to ensure preview matches actual drawing behavior.

### Debugging Features

The MiniCanvas includes comprehensive debugging output:

```typescript
console.log('MiniCanvas: Loading custom brush', {
  brushId,
  customBrush,
  canvasSize
});

console.log('MiniCanvas: Pixel analysis', {
  totalPixels,
  visiblePixels,
  averageAlpha,
  firstFewPixels
});
```

This helps diagnose issues with:
- Brush loading failures
- Rendering problems
- Performance bottlenecks

### Edge Cases Handled

1. **Missing Brush Data**: Gracefully falls back to standard brush display
2. **Invalid ImageData**: Catches and logs errors without crashing
3. **Zero-size Brushes**: Ensures minimum visible size
4. **Memory Leaks**: Proper cleanup of canvas contexts
5. **Rapid Updates**: Debounced rendering for performance

### Future Enhancements

- **Animated Preview**: Show brush dynamics (pressure, rotation)
- **Stroke Preview**: Display sample stroke instead of static tip
- **Multi-brush Preview**: Compare multiple brushes side-by-side
- **Export Preview**: Save brush tip as image for documentation

---

# Layer System

TinyBrush features a sophisticated layer system that allows you to organize your artwork on separate drawing sheets. This section explains the core concepts and implementation details of the layer system.

## Layer Architecture

### The Core Concept

The fundamental concept behind layers in a canvas drawing application is to use multiple hidden canvases for drawing, and then combine them onto a single visible canvas for display.

TinyBrush uses a **hidden canvas composition system**:
- Each layer is its own offscreen canvas (invisible drawing sheet)
- When you draw, strokes are applied only to the currently active layer
- The main canvas combines all visible layers for final display

### Implementation Architecture

```
Mouse Events (Screen) → Active Layer Selection → Hidden Drawing Canvas → Composition → Main Display Canvas
                    ↓                       ↓                      ↓                ↓
              Layer Management        Individual Layer Data    Layer Blending    Final Visual Output
```

#### Hidden Drawing Sheets (Offscreen Canvases)

Each "layer" is its own `<canvas>` element that exists in memory but isn't directly shown on the webpage. When you draw, your strokes are applied only to the currently active hidden canvas.

**Code Example (Creating Hidden Canvases)**:
```javascript
// Create separate, hidden drawing sheets (offscreen canvases)
const layer1Canvas = document.createElement('canvas');
const layer2Canvas = document.createElement('canvas');

// Ensure hidden canvases match main canvas dimensions
layer1Canvas.width = mainCanvas.width;
layer1Canvas.height = mainCanvas.height;
layer2Canvas.width = mainCanvas.width;
layer2Canvas.height = mainCanvas.height;

// Get their drawing contexts (the tools to draw on them)
const layer1Ctx = layer1Canvas.getContext('2d');
const layer2Ctx = layer2Canvas.getContext('2d');
```

- `document.createElement('canvas')`: Creates a canvas element in browser memory, not attached to the visible webpage
- `layer1Ctx`, `layer2Ctx`: These are the "drawing tools" for each hidden canvas

#### Drawing on Specific Hidden Sheets

When you interact with the app, drawing commands are sent only to the context of the currently selected hidden layer.

**Code Example (Drawing on a Layer)**:
```javascript
function drawOnLayer1() {
    // Draw a red rectangle on Layer 1's hidden canvas
    layer1Ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
    layer1Ctx.fillRect(50, 50, 100, 100);
    layer1Ctx.font = '20px Inter';
    layer1Ctx.fillStyle = 'red';
    layer1Ctx.fillText('Layer 1', 60, 110);
    compositeLayers(); // Important: Update the main canvas after drawing
}

function drawOnLayer2() {
    // Draw a blue circle on Layer 2's hidden canvas
    layer2Ctx.fillStyle = 'rgba(0, 0, 255, 0.6)';
    layer2Ctx.beginPath();
    layer2Ctx.arc(mainCanvas.width - 100, mainCanvas.height - 100, 50, 0, Math.PI * 2);
    layer2Ctx.fill();
    layer2Ctx.font = '20px Inter';
    layer2Ctx.fillStyle = 'blue';
    layer2Ctx.fillText('Layer 2', mainCanvas.width - 130, mainCanvas.height - 90);
    compositeLayers(); // Important: Update the main canvas after drawing
}
```

Notice `layer1Ctx.fillRect()` and `layer2Ctx.arc()` specifically target `layer1Canvas` and `layer2Canvas` respectively. `compositeLayers()` is called immediately after drawing to make changes visible.

#### Main Screen Combination (Composition)

The single visible `<canvas>` (mainCanvas) acts as a display. It clears itself and then copies content from all hidden layers onto itself, in correct order (bottom layers first, then top layers).

**Code Example (Compositing Layers)**:
```javascript
function compositeLayers() {
    // Clear the main visible canvas
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

    // Draw Layer 1 (bottom layer)
    mainCtx.drawImage(layer1Canvas, 0, 0);

    // Draw Layer 2 (top layer) if it's visible
    if (isLayer2Visible) { // This allows toggling visibility
        mainCtx.drawImage(layer2Canvas, 0, 0);
    }
}
```

- `mainCtx.clearRect()`: Wipes the visible canvas clean before redrawing
- `mainCtx.drawImage(layerXCanvas, 0, 0)`: Takes content of a hidden canvas and draws it onto mainCanvas. The order of these `drawImage` calls determines visual stacking order.

#### Why This Architecture Works

This approach is powerful because:

- **Isolation**: Drawing on one layer doesn't accidentally affect another
- **Flexibility**: You can easily hide/show layers, reorder them, or clear individual layers without touching others
- **Efficiency**: Browsers are highly optimized for `drawImage()`, making composition very fast

This core pattern allows for complex drawing applications where different elements can be managed independently.

## Layer Operations

### Layer Panel Location

The Layer Panel is located in the **right column (RHC1)** of the interface, below the Mini Canvas.

### Creating Layers
- Click the **+ button** in the layer panel header
- New layers are automatically named "Layer X" (where X is the layer number)
- The new layer automatically becomes the active drawing layer

### Deleting Layers
- Click the **X button** next to any layer
- You cannot delete the last remaining layer (minimum of 1 layer required)
- If you delete the active layer, another layer automatically becomes active

### Layer Selection
- Click on any layer in the panel to make it the **active layer**
- The active layer is highlighted in the panel
- All drawing operations target the active layer

### Layer Reordering
- **Drag and drop** layers to reorder them
- Layers are displayed in **reverse order** (top layer in panel = top visual layer)
- Layer stacking affects how they appear in the final composition

## Layer Controls

### Visibility Toggle
- Click the **eye icon** to show/hide layers
- Open eye = visible layer
- Closed eye = hidden layer
- Hidden layers don't appear in final composition but preserve their content

### Layer Locking
- Click the **lock icon** to lock/unlock layers
- Locked layers cannot be drawn on or modified
- Lock icon shows when layer is locked
- Unlock icon shows when layer is editable

### Opacity Control
- Click the **slider icon** to open opacity controls
- Use the slider to adjust layer opacity from 0% to 100%
- Changes are applied in real-time
- Click outside the popover to close it

## Drawing on Layers

### Active Layer Drawing
- All drawing operations (brush, eraser, fill) target the **active layer** only
- The active layer is highlighted in the layer panel
- Switch active layers by clicking on different layers

### Layer Isolation
- Drawing on one layer never affects other layers
- You can safely experiment on new layers without affecting existing work
- Use separate layers for different elements (background, characters, effects, etc.)

## Layer Composition

### Blend Modes
- Each layer has a blend mode that determines how it combines with layers below
- Default blend mode is "source-over" (normal blending)
- Blend modes affect the final visual appearance

### Layer Order
- Layers are composited from bottom to top
- Higher layers in the visual stack appear on top
- Use drag and drop to change layer order

## Best Practices

### Organization
- Use descriptive layer names for complex artwork
- Keep related elements on separate layers (background, characters, effects)
- Use layer visibility to focus on specific parts of your artwork

### Performance
- More layers use more memory
- Each layer stores its own image data
- Delete unused layers to optimize performance

### Workflow Tips
- Create a new layer before trying experimental techniques
- Use layer opacity to create subtle effects
- Lock background layers to prevent accidental modification
- Toggle layer visibility to compare different versions

## Technical Details

### Layer Data Structure
```typescript
interface Layer {
  id: string;           // Unique identifier
  name: string;         // Display name
  visible: boolean;     // Visibility state
  opacity: number;      // 0.0 to 1.0
  blendMode: BlendMode; // How layer combines with others
  locked: boolean;      // Edit protection
  order: number;        // Z-index for stacking
  imageData: ImageData | null; // Pixel data
  framebuffer: OffscreenCanvas; // Hidden drawing surface
}
```

### Auto-Initialization
- When you create a new project, a "Background" layer is automatically created
- This ensures you always have at least one layer to draw on
- The background layer starts active and ready for drawing

## Troubleshooting

### Layer Not Visible
- Check if the layer visibility (eye icon) is enabled
- Verify the layer opacity is above 0%
- Ensure the layer isn't behind other opaque layers

### Can't Draw on Layer
- Make sure the layer is selected (active)
- Check if the layer is locked (unlock it if needed)
- Verify you have a drawing tool selected

### Layer Panel Not Showing
- The layer panel is in the right column (RHC1)
- It should always be visible below the Mini Canvas
- Try refreshing the page if the UI seems broken