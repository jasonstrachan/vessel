# TinyBrush Consolidated Documentation

## Table of Contents

1. [Project Fundamentals](#project-fundamentals)
   - [Vision & Goals](#vision--goals)
   - [Core Tech Stack](#core-tech-stack)
2. [System Architecture](#system-architecture)
   - [Overall System Design](#overall-system-design)
   - [Data Model](#data-model)
3. [Features](#features)
   - [Drawing Tools](#drawing-tools)
   - [Modular Brush Engine](#modular-brush-engine)
   - [Pixel-Perfect Drawing](#pixel-perfect-drawing)
   - [Tool Interface](#tool-interface)

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

**Performance**: Maintains 60fps through efficient animation loop and optimized selection rendering. Marching ants only animate when selection is active.