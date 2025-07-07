# Drawing Tools

## Purpose
The Drawing Tools feature provides a comprehensive set of digital art tools for creating artwork and animations. Each tool is designed for specific drawing tasks with customizable settings and advanced features.

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
5. User draws with 60fps performance guarantee
6. Rendering mode applies only to new strokes

**Key Inputs**:
- **Mouse/Touch/Wacom**: Coordinates, pressure from Wacom tablets, drawing state
- **Brush Presets**: Pixel (1px, 3px, 5px), Soft Round, Hard Round, Textured
- **Modular Settings**: Size (1-1000px), opacity (0-100%), color, pressure sensitivity
- **Rendering Mode**: Pixel-perfect or antialiased per brush

**Key Outputs**:
- **Layer ImageData**: Modified pixel data with correct rendering mode
- **60fps Performance**: Guaranteed smooth drawing experience
- **Visual Feedback**: Real-time brush cursor, stroke preview
- **Wacom Integration**: Pressure-sensitive strokes from tablet input

**Dependencies**:
- P5.js rendering engine optimized for 60fps
- Wacom tablet pressure detection
- Modular brush settings system
- Layer management with rendering mode support

**Business Rules**:
- **60fps Requirement**: All brush operations must maintain 60fps
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
4. User drags to erase pixels with 60fps performance
5. Erased areas become transparent on target layers
6. Temporary mode: release E to return to previous tool

**Key Inputs**:
- **Mouse/Touch/Wacom**: Coordinates, pressure from tablets
- **Layer Target**: Selected layer only or all visible layers
- **Eraser Settings**: Size (inherited from brush), opacity, pressure sensitivity
- **Temporary Mode**: E key hold detection

**Key Outputs**:
- **Layer ImageData**: Pixels set to transparent on target layers
- **60fps Performance**: Smooth erasing without lag
- **Visual Feedback**: Eraser cursor, real-time erase preview
- **Tool State**: Automatic return to previous tool in temporary mode

**Dependencies**:
- Brush engine for consistent stroke behavior
- Layer management for multi-layer erasing
- Key state detection for temporary mode

**Business Rules**:
- **Layer Options**: Can target selected layer only or all visible layers
- **60fps Requirement**: All erase operations must maintain 60fps
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
6. Fill operation completes with 60fps performance

**Key Inputs**:
- **Click Position**: X, Y coordinates of fill start point
- **Fill Color**: Current selected color from color management system
- **Connected Mode**: On (connected pixels only) or Off (all similar colors)
- **Threshold**: Color similarity threshold (1=exact match, 256=fill all)
- **Layer Target**: Active layer for fill operation

**Key Outputs**:
- **Layer ImageData**: Filled pixels updated with new color
- **60fps Performance**: Smooth fill operation without UI lag
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
- **60fps Requirement**: Fill operations must not block interface

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
```typescript
interface BrushSettings {
  size: number;                  // 1-1000 pixels
  opacity: number;               // 0-1 (0% to 100%)
  spacing: number;               // 0.1-10 (spacing multiplier)
  color: string;                 // Hex color (#RRGGBB)
  blendMode: BlendMode;          // Layer blending mode
  rotation: number;              // 0-360 degrees
  
  // Pressure sensitivity
  pressureSettings: {
    enabled: boolean;
    sizeVariation: number;       // 0-1 pressure effect
    opacityVariation: number;    // 0-1 pressure effect
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