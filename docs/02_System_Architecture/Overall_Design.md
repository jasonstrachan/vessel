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
│  │              Timeline & Layer Controls                   │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                 State Management (Zustand)                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Project │ │ Canvas  │ │ Tools   │ │ UI      │           │
│  │ State   │ │ State   │ │ State   │ │ State   │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────────────────┤
│                 Rendering Engine (P5.js)                   │
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
  - SSR handling for P5.js components
  - Global event handling (keyboard, clipboard)
  - Layout management and responsive design

### 2. UI Components (React)
- **Location**: `src/components/`
- **Key Components**:
  - **LeftToolbar**: Tool selection and primary controls
  - **Toolbar**: Brush settings and advanced options
  - **Canvas Area**: Drawing surface and viewport controls
  - **Timeline**: Animation controls and frame management
  - **LayerPanel**: Layer visibility and organization

### 3. State Management (Zustand)
- **Location**: `src/stores/useAppStore.ts`
- **State Slices**:
  - **Project State**: Layers, frames, dimensions, export settings
  - **Canvas State**: Zoom, pan, selection, clipboard data
  - **Tool State**: Current tool, brush settings, color
  - **UI State**: Panel visibility, modal states, notifications

### 4. Rendering Engine (P5.js)
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
5. P5.js renders stroke to layer framebuffer
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
1. P5.js requests animation frame
2. Each layer renders to its framebuffer
3. Layer manager composites all visible layers
4. Main canvas displays composite result
5. UI overlays (selection, guides) rendered on top

## Component Communication

### 1. Parent-Child Communication
- **Props**: Configuration and callback functions
- **Refs**: Direct access to P5.js instances
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
- **Resource Cleanup**: Proper cleanup of P5.js instances
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
- **Export Limits**: Animation export size and duration limits

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
- **Canvas Persistence**: P5.js instances properly reinitialized

### 2. Error Boundaries
- **Component Isolation**: Errors isolated to failing components
- **Graceful Degradation**: Fallback UI for rendering failures
- **Error Reporting**: Comprehensive error tracking

### 3. Development Tools
- **Redux DevTools**: Store state inspection and time travel
- **React DevTools**: Component hierarchy and props inspection
- **Performance Monitoring**: Built-in performance metrics

---

*This architecture provides a robust foundation for TinyBrush's complex drawing and animation capabilities while maintaining clean separation of concerns and excellent performance.*