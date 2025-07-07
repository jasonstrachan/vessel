# Animation Timeline

## Purpose
The Animation Timeline feature enables frame-by-frame animation creation with comprehensive playback controls, onion skinning, and frame management. It provides professional animation tools in a web-based interface.

## Core Animation Features

### Frame Management
**Purpose**: Create, organize, and manage individual animation frames.

**Core Flow**:
1. User creates new frame using frame controls
2. Frame appears in timeline with thumbnail preview
3. User draws on canvas for current frame
4. Frame thumbnail automatically updates
5. User navigates between frames to continue animation

**Key Inputs**:
- **Frame Duration**: Individual frame timing in milliseconds
- **Frame Content**: Layer data for each frame
- **Frame Order**: Sequence position in timeline
- **Thumbnail Settings**: Preview size and quality

**Key Outputs**:
- **Frame Array**: Ordered sequence of animation frames
- **Current Frame State**: Active frame for editing
- **Timeline UI**: Visual frame representation with thumbnails
- **Playback Data**: Frame sequence for animation preview

**Dependencies**:
- Layer management system for frame content
- Canvas rendering for thumbnail generation
- Project state for frame persistence

**Business Rules**:
- Maximum 1000 frames per project
- Frame duration must be 16ms minimum (60 FPS)
- Frame thumbnails generated at 64x64 resolution
- Frame order cannot have gaps (sequential indices)

### Timeline Playback
**Purpose**: Preview animations with accurate timing and smooth playback.

**Core Flow**:
1. User clicks play button or presses Enter
2. Timeline starts playback from current frame
3. Frames display in sequence according to timing
4. Playback loops automatically (if enabled)
5. User can pause, stop, or scrub timeline

**Key Inputs**:
- **Play State**: Play, pause, stop commands
- **FPS Setting**: Frames per second (1-60 FPS)
- **Loop Mode**: Loop animation or play once
- **Frame Range**: Start and end frames for playback

**Key Outputs**:
- **Canvas Display**: Sequential frame rendering
- **Timeline Cursor**: Current playback position indicator
- **Playback Controls**: Play/pause button states
- **Performance Metrics**: Actual vs. target FPS

**Dependencies**:
- Frame rendering system
- Timing utilities for accurate playback
- Canvas compositing for frame display

**Business Rules**:
- Playback limited to 60 FPS maximum
- Empty frames display as transparent
- Playback stops at project end unless looping
- Timeline cursor follows playback position

### Onion Skinning
**Purpose**: Show previous and next frames as translucent overlays for smooth animation workflow.

**Core Flow**:
1. User enables onion skinning in timeline controls
2. Previous/next frames rendered as translucent overlays
3. Opacity configurable for visibility preference
4. Onion skin layers update when frames change
5. Feature can be toggled on/off per frame

**Key Inputs**:
- **Onion Skin Enable**: Toggle onion skinning on/off
- **Previous Frames**: Number of previous frames to show (0-5)
- **Next Frames**: Number of next frames to show (0-5)
- **Opacity**: Onion skin transparency (0-1)
- **Color Tint**: Optional color tinting for frame identification

**Key Outputs**:
- **Overlay Rendering**: Translucent frame overlays on canvas
- **Visual Feedback**: Previous/next frame indication in timeline
- **Performance**: Efficient overlay compositing

**Dependencies**:
- Canvas compositing system
- Frame data access for overlay generation
- Blend mode rendering for transparency

**Business Rules**:
- Onion skin opacity must be 0.1-0.8 for visibility
- Maximum 5 frames shown in each direction
- Onion skin disabled during playback for performance
- First/last frames show only available adjacent frames

## Timeline Interface

### Frame Controls
**Purpose**: Direct manipulation of individual frames and playback state.

**Control Elements**:
- **Play/Pause Button**: Toggle animation playback (Enter key)
- **Stop Button**: Stop playback and return to start
- **Previous Frame**: Jump to previous frame (Left arrow)
- **Next Frame**: Jump to next frame (Right arrow)
- **Add Frame**: Create new frame after current (Shift+F)
- **Delete Frame**: Remove current frame (Delete key)
- **Duplicate Frame**: Copy current frame (Ctrl+D)

**Timeline Scrubbing**:
- **Scrub Bar**: Drag to navigate timeline position
- **Frame Thumbnails**: Click thumbnail to jump to frame
- **Keyboard Navigation**: Arrow keys for frame-by-frame navigation
- **Timeline Zoom**: Zoom timeline for detailed frame editing

### FPS Control
**Purpose**: Configure animation frame rate for different animation styles.

**Frame Rate Settings**:
- **12 FPS**: Traditional hand-drawn animation
- **24 FPS**: Film-standard frame rate
- **30 FPS**: Video-standard frame rate
- **60 FPS**: Smooth digital animation

**Implementation**:
- Frame rate affects playback timing only
- Individual frame durations calculated from FPS
- Real-time FPS adjustment during playback
- Performance monitoring ensures accurate timing

### Timeline Display
**Purpose**: Visual representation of animation sequence with editing capabilities.

**Display Elements**:
- **Frame Thumbnails**: 64x64 pixel previews of each frame
- **Frame Numbers**: Sequential frame identification
- **Duration Indicators**: Visual representation of frame timing
- **Current Frame Highlight**: Clear indication of active frame
- **Playback Cursor**: Red line showing playback position

**Interaction Features**:
- **Drag Reordering**: Drag frames to reorder sequence
- **Multi-selection**: Select multiple frames for bulk operations
- **Context Menu**: Right-click for frame operations
- **Thumbnail Regeneration**: Force thumbnail updates

## Layer Timeline Integration

### Layer Visibility Per Frame
**Purpose**: Configure layer visibility and opacity for each animation frame.

**Core Flow**:
1. User selects frame in timeline
2. Layer panel shows layer states for current frame
3. User adjusts layer visibility/opacity
4. Changes apply only to current frame
5. Layer states saved with frame data

**Key Inputs**:
- **Frame Selection**: Target frame for layer configuration
- **Layer Visibility**: Show/hide layers per frame
- **Layer Opacity**: Opacity adjustment per frame
- **Layer Effects**: Blend modes and effects per frame

**Key Outputs**:
- **Frame Layer State**: Layer configuration per frame
- **Visual Feedback**: Layer panel updates for current frame
- **Render Configuration**: Layer compositing settings

**Dependencies**:
- Layer management system
- Frame data persistence
- Canvas rendering pipeline

**Business Rules**:
- Layer states independent per frame
- Hidden layers not rendered in frame
- Layer opacity multiplied with base layer opacity
- Layer order consistent across all frames

### Layer Keyframes
**Purpose**: Define key points for layer property animations between frames.

**Implementation**:
- **Property Keyframes**: Position, opacity, rotation keyframes
- **Interpolation**: Smooth transitions between keyframes
- **Easing Functions**: Configurable animation curves
- **Visual Indicators**: Keyframe markers in timeline

## Animation Export

### GIF Export Configuration
**Purpose**: Export animations as optimized GIF files with quality controls.

**Export Settings**:
```typescript
interface GIFExportSettings {
  fps: number;                   // 1-60 frames per second
  quality: number;               // 1-20 (higher = better quality)
  width: number;                 // Output width in pixels
  height: number;                // Output height in pixels
  loop: boolean;                 // Loop animation
  delay: number;                 // Frame delay override (ms)
  dither: boolean;               // Color dithering for quality
  palette: 'global' | 'frame';   // Color palette mode
}
```

**Export Process**:
1. User configures export settings
2. Each frame rendered at target resolution
3. Color palette optimized for file size
4. GIF assembly with proper timing
5. Progress tracking during export

### Frame Sequence Export
**Purpose**: Export individual frames as PNG files for external editing.

**Export Options**:
- **Individual Frames**: Each frame as separate PNG
- **Sprite Sheet**: All frames in single image grid
- **Custom Range**: Export specific frame range
- **Naming Convention**: Sequential file naming

## Animation Performance

### Rendering Optimization
**Purpose**: Maintain smooth animation playback and responsive editing.

**Optimization Techniques**:
- **Frame Caching**: Rendered frames cached for playback
- **Dirty Frame Tracking**: Only modified frames re-rendered
- **Background Rendering**: Non-visible frames rendered in background
- **Memory Management**: Frame cache size limited to prevent memory issues

**Performance Monitoring**:
- **FPS Counter**: Real-time playback frame rate
- **Memory Usage**: Frame cache memory consumption
- **Render Time**: Per-frame rendering performance
- **Optimization Alerts**: Performance degradation warnings

### Timeline Responsiveness
**Purpose**: Ensure timeline remains responsive during complex animations.

**Optimization Features**:
- **Thumbnail Lazy Loading**: Thumbnails generated on demand
- **Timeline Virtualization**: Only visible frames rendered in UI
- **Interaction Debouncing**: Rapid user inputs debounced
- **Background Processing**: Thumbnail generation in background

## API Reference

### Frame Data Structure
```typescript
interface AnimationFrame {
  id: string;                    // Unique frame identifier
  index: number;                 // Frame position in sequence
  duration: number;              // Frame duration in milliseconds
  layers: LayerState[];          // Layer visibility/opacity states
  thumbnail: string;             // Base64 encoded thumbnail
  metadata: {
    createdAt: Date;             // Frame creation time
    modifiedAt: Date;            // Last modification time
    notes: string;               // User notes for frame
  };
}
```

### Timeline State
```typescript
interface TimelineState {
  frames: AnimationFrame[];      // Array of animation frames
  currentFrame: number;          // Active frame index
  isPlaying: boolean;            // Playback state
  fps: number;                   // Frames per second
  loop: boolean;                 // Loop playback
  onionSkin: {
    enabled: boolean;            // Onion skinning toggle
    previous: number;            // Previous frames to show
    next: number;                // Next frames to show
    opacity: number;             // Onion skin opacity
  };
  selection: number[];           // Selected frame indices
}
```

## Keyboard Shortcuts

### Playback Controls
- **Enter**: Play/pause animation
- **Space**: Play/pause (alternative)
- **Home**: Jump to first frame
- **End**: Jump to last frame
- **Left Arrow**: Previous frame
- **Right Arrow**: Next frame

### Frame Management
- **Shift+F**: Add new frame
- **Delete**: Delete current frame
- **Ctrl+D**: Duplicate current frame
- **Ctrl+Shift+D**: Duplicate frame range

### Timeline Navigation
- **Page Up**: Jump 10 frames back
- **Page Down**: Jump 10 frames forward
- **Ctrl+Home**: Start of timeline
- **Ctrl+End**: End of timeline

---

*The Animation Timeline provides professional-grade animation tools with optimized performance for smooth creative workflows.*