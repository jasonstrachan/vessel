# Mini Canvas for Brush Tip Editing - Implementation Plan

## Overview
Add a mini canvas component to the right column between brush library and brush settings for editing brush tips. This mini canvas will provide:
- Live preview of brush tips with transparency support
- Same drawing features as main canvas (zoom, pan, flood fill, erase, drawing tools)
- Hue adjustment slider beneath for color manipulation
- Pin functionality so we can selct a different brush to paint in the mini canvas, as soon as you unpin the selcted brush tip is shown
- Undo/redo support for brush tip modifications
- Reset icon so you can restet to state it was first created (defauly state for default brushed like pixel brush)
- Live preview, as you edit brush tips you can test them out on the main canvas 

## Current Architecture Analysis

### Canvas System
- **Main Canvas**: `/src/components/canvas/DrawingCanvas.tsx` - Large, complex component handling drawing, zoom/pan, and interactions
- **Canvas Architecture**: Uses offscreen canvas for drawing data + display canvas with zoom/pan transformations
- **Existing Zoom/Pan**: Already implemented with `calculateZoomIncrement`, pan controls, and cursor-centered zoom
- **Coordinate System**: Well-established screen-to-canvas coordinate transformation functions

### Brush System
- **Brush Engine**: `/src/hooks/useBrushEngine.ts` - Sophisticated brush rendering with pressure, spacing, shapes
- **Custom Brushes**: Support for ImageData-based custom brushes with scaling, rotation
- **Brush Library**: `/src/components/BrushLibrary.tsx` - Manages custom and preset brushes
- **Brush Controls**: `/src/components/toolbar/BrushControls.tsx` - Settings panel for brush properties

### Component Structure
- **Layout**: Left toolbar + Main canvas + Right panel (240px width)
- **Right Panel**: Split between BrushLibrary (flex-2) and ControlsPanel (flex-3)
- **Controls Panel**: Context-sensitive - shows different controls based on current tool
- **UI State**: Well-managed through Zustand store with proper state management

### Color System
- **Color Picker**: `/src/components/toolbar/ColorPicker.tsx` - Sophisticated HSL-based color picker with hue/saturation interface
- **Color Manipulation**: Already has RGB↔HSL conversion, hex handling, and interactive color selection

## Implementation Plan

### Phase 1: Core Mini Canvas Component

Create a reusable `MiniCanvas` component that can be embedded anywhere in the UI:

```typescript
interface MiniCanvasProps {
  width: number;
  height: number;
  imageData?: ImageData;
  onImageDataChange?: (imageData: ImageData) => void;
  zoom?: number;
  pan?: { x: number; y: number };
  tools?: {
    currentTool: 'brush' | 'eraser' | 'eyedropper';
    brushSize: number;
    brushColor: string;
  };
  showGrid?: boolean;
  backgroundColor?: string;
}
```

**Key Features:**
- Self-contained canvas with its own coordinate system
- Zoom/pan controls (reuse existing zoom utilities)
- Basic drawing tools (brush, eraser, eyedropper)

### Phase 2: Integration Points

**A. Add to BrushControls (Primary Location)**
- Add mini canvas section when any brush is selected (minio canvas is alwys there)
- Position below existing controls in the scrollable area
- Show current brush tip for editing


### Phase 3: Mini Canvas Implementation Details

**A. Canvas Setup**
```typescript
// Reuse existing patterns from DrawingCanvas.tsx
const canvasRef = useRef<HTMLCanvasElement>(null);
const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);

// Simplified zoom/pan (no complex transformations needed)
const [miniZoom, setMiniZoom] = useState(4); // 4x zoom for pixel editing
const [miniPan, setMiniPan] = useState({ x: 0, y: 0 });
```

**B. Drawing System Integration**
- Reuse brush engine for consistent drawing behavior
- used sa,e toold as main canvas (by selecting any tool in the toolbar)
- Direct pixel manipulation for precision editing

**C. Zoom/Pan Controls**
```typescript
// Compact zoom controls for mini canvas
<div className="flex items-center gap-1 mb-2">
  <button onClick={() => setMiniZoom(Math.max(1, miniZoom - 1))}>-</button>
  <span className="text-xs">{miniZoom}x</span>
  <button onClick={() => setMiniZoom(Math.min(16, miniZoom + 1))}>+</button>
</div>
```

### Phase 4: Enhanced Color Manipulation

**A. Hue Shifting**
- Add hue shift slider to mini canvas controls
- Apply HSL transformation to entire brush ImageData
- Real-time preview of hue changes

### Phase 5: Advanced Features

**C. Import/Export**
- Import image files as brush tips
- Export current brush as PNG
- Copy/paste integration

## Technical Implementation Strategy

### 1. Component Architecture
```
/src/components/canvas/
├── MiniCanvas.tsx          # Core mini canvas component
├── MiniCanvasControls.tsx  # Zoom, pan, tool controls
└── BrushEditor.tsx         # Full brush editing interface

/src/hooks/
└── useMiniCanvas.ts        # Canvas logic, drawing, state management

/src/utils/
├── miniCanvasUtils.ts      # Coordinate transforms, utilities
└── imageProcessing.ts      # Hue shift, color manipulation
```

### 2. State Management
- Self-contained state for each mini canvas instance
- Integration with main app store for brush updates
- Efficient ImageData handling and updates

### 3. Performance Considerations
- Small canvas sizes but can be as large as the user likes (typically 16x16 to 128x128)
- Efficient pixel manipulation using ImageData
- Debounced updates to prevent excessive re-renders
- Memory management for multiple mini canvas instances

### 4. Integration Points
- **Primary**: Add section to BrushControls when custom brush active
- **Future**: Modal-based editor for advanced editing

## Next Steps
1. Create MiniCanvas component with basic functionality
2. Integrate into right panel layout
3. Add brush tip editing capabilities
4. Implement hue adjustment slider
5. Add advanced features incrementally

This plan reuses the existing well-architected systems (zoom/pan, brush engine, color picker) while adding the focused mini canvas functionality for brush tip editing. The implementation will be modular and can be incrementally deployed.