# Data Model

## Core Data Entities

### Project Entity
The top-level container for all artwork and animation data.

```typescript
interface Project {
  id: string;                    // Unique project identifier
  name: string;                  // User-defined project name
  width: number;                 // Canvas width in pixels
  height: number;                // Canvas height in pixels
  layers: Layer[];               // Array of layer objects
  frames: Frame[];               // Array of frame objects
  currentFrame: number;          // Active frame index
  backgroundColor: string;       // Project background color (hex)
  createdAt: Date;              // Project creation timestamp
  updatedAt: Date;              // Last modification timestamp
}
```

**Relationships:**
- One-to-many with Layer (a project contains multiple layers)
- One-to-many with Frame (a project contains multiple frames)

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
  framebuffer: p5.Framebuffer;   // P5.js framebuffer reference
}
```

**Relationships:**
- Many-to-one with Project (multiple layers belong to one project)
- One-to-many with DrawingAction (layer contains drawing history)

### Frame Entity
Individual frames for animation with timing and settings.

```typescript
interface Frame {
  id: string;                    // Unique frame identifier
  index: number;                 // Frame position in sequence
  duration: number;              // Frame duration in milliseconds
  layerStates: LayerState[];     // Layer visibility/opacity per frame
  thumbnail: string;             // Base64 encoded thumbnail
  onionSkin: {
    showPrevious: boolean;       // Show previous frame overlay
    showNext: boolean;           // Show next frame overlay
    opacity: number;             // Onion skin opacity (0-1)
  };
}
```

**Relationships:**
- Many-to-one with Project (multiple frames belong to one project)
- One-to-many with LayerState (frame contains layer states)

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
  
  // Frame calculations
  totalFrames: number;           // Total number of frames
  animationDuration: number;     // Total animation duration
  currentFrameTime: number;      // Current frame timestamp
  
  // Tool calculations
  effectiveBrushSize: number;    // Brush size with pressure applied
  toolCursor: string;            // CSS cursor for current tool
}
```

### State Validation Rules

#### Project Validation
- **Width/Height**: Must be between 1-8192 pixels
- **Layers**: Maximum 100 layers per project
- **Frames**: Maximum 1000 frames per project
- **Name**: Must be 1-100 characters, no special characters

#### Layer Validation
- **Opacity**: Must be between 0-1
- **Order**: Must be unique within project
- **Name**: Must be 1-50 characters
- **ImageData**: Must match project dimensions

#### Brush Validation
- **Size**: Must be between 1-1000 pixels
- **Opacity**: Must be between 0-1
- **Spacing**: Must be between 0.1-10
- **Color**: Must be valid hex color
- **Rotation**: Must be between 0-360 degrees

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

### GIF Export
```typescript
interface GIFExport {
  format: 'gif';
  fps: number;                   // Frames per second
  quality: number;               // GIF quality (1-20)
  loop: boolean;                 // Loop animation
  delay: number;                 // Frame delay in milliseconds
  dither: boolean;               // Color dithering
  frames: number[];              // Frame indices to export
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

*This data model provides a comprehensive foundation for TinyBrush's complex drawing and animation capabilities while maintaining data integrity and performance.*