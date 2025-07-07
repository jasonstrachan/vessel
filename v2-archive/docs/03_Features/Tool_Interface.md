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

### Selection Tool
**Purpose**: Select rectangular areas of canvas with precise control and manipulation.

**Key Features**:
- **Square Selection**: Click and drag to create rectangular selection
- **Resize Handles**: Corner and edge handles for precise adjustment
- **Move Operation**: Drag selected pixels to new location
- **Enter to Confirm**: Press Enter key to fix selection in place
- **Delete Option**: Delete selected pixels (make transparent)

**Right Column Options**:
```
Selection Options
├── Move Selected Pixels
├── Resize Selection
├── Delete Selected Area
└── Enter: Fix in Place
```

**Core Flow**:
1. Click and drag to create initial selection rectangle
2. Use handles to adjust selection boundaries
3. Drag interior to move selected pixels
4. Press Enter to commit changes to canvas
5. Selection clears after confirmation

**Performance Requirements**:
- Real-time selection outline at 60fps
- Smooth handle dragging without lag
- Instant pixel movement feedback

### Brush Tool
**Purpose**: Primary drawing tool with dual rendering modes and modular settings.

**Dual Rendering System**:
- **Pixel Brushes**: Crisp, non-antialiased rendering for pixel art
- **Antialiased Brushes**: Smooth, traditional digital painting
- **Per-Brush Setting**: Applied at brush level, not global canvas
- **Non-Destructive**: Switch modes without affecting existing artwork

**Right Column Options**:
```
Brush Settings
├── Brush Presets
│   ├── Pixel Art (1px, 3px, 5px)
│   ├── Soft Round (various sizes)
│   ├── Hard Round (crisp edges)
│   └── Textured (chalk, marker, etc.)
├── Size: [1-1000px]
├── Opacity: [0-100%]
├── Rendering: [Pixel/Antialiased]
├── Pressure Sensitivity: [On/Off]
└── Modular Settings Transfer
```

**Modular Settings System**:
- Settings can be copied between brushes
- Save custom configurations as presets
- Import/export brush setting collections
- Real-time preview of setting changes

**Performance Requirements**:
- 60fps brush strokes regardless of size
- Instant rendering mode switching
- No lag during pressure-sensitive drawing

### Custom Brush Tool
**Purpose**: Create custom brushes from existing canvas artwork.

**Creation Process**:
1. Make selection on canvas using selection tool
2. Switch to Custom Brush tool
3. Choose layer options (selected layer or all layers)
4. Confirm to create new brush from selection
5. New brush appears in brush presets

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

**Layer Options**:
- **Selected Layer**: Capture only active layer content
- **All Layers**: Composite all visible layers for brush
- **Transparency Handling**: Preserve alpha channels
- **Size Constraints**: Limit brush size for performance

### Fill Tool
**Purpose**: Paint bucket tool for filling connected areas with precise control.

**Filling Algorithm**:
- **Connected Mode**: Fill only connected pixels of same/similar color
- **Threshold Control**: 1-256 color similarity range
- **Layer Awareness**: Respect layer boundaries and transparency
- **Performance Optimized**: Large area fills maintain 60fps

**Right Column Options**:
```
Fill Settings
├── Connected: [On/Off]
├── Threshold: [1-256]
│   ├── 1: Exact color match
│   ├── 128: Moderate similarity  
│   └── 256: Fill entire area
├── Fill Color
└── Target Layer
```

**Connected Mode**:
- **On**: Fill only pixels connected to click point
- **Off**: Fill all pixels of similar color on layer
- **Diagonal**: Include diagonal connections in fill area

### Eraser Tool
**Purpose**: Quick pixel erasing with layer-specific options and temporary activation.

**Erasing Modes**:
- **Selected Layer**: Erase only from active layer
- **All Layers**: Erase from all visible layers
- **Temporary Mode**: Hold E key for quick eraser access
- **Size Inheritance**: Uses current brush size settings

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

**Temporary Activation**:
- Hold E key to temporarily switch to eraser
- Release E to return to previous tool
- Maintains current tool settings
- Visual feedback shows temporary mode

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