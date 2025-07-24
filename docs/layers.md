The Core Idea of Layers in Canvas Drawing Apps (with Code)
The fundamental concept behind layers in a canvas drawing application is to use multiple hidden canvases for drawing, and then combine them onto a single visible canvas for display.

1. Hidden Drawing Sheets (Offscreen Canvases)
Each "layer" is its own <canvas> element that exists in memory but isn't directly shown on the webpage. When you draw, your strokes are applied only to the currently active hidden canvas.

Code Example (Creating Hidden Canvases):

// From core-layers-demo.html:
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

document.createElement('canvas'): This creates a canvas element in your browser's memory. It's not attached to the visible webpage.

layer1Ctx, layer2Ctx: These are the "drawing tools" for each hidden canvas. You use them to draw shapes, lines, etc., on that specific hidden canvas.

2. Drawing on a Specific Hidden Sheet
When you interact with the app (e.g., click a "Draw" button), the drawing commands are sent only to the context of the currently selected hidden layer.

Code Example (Drawing on a Layer):

// From core-layers-demo.html:
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

Notice layer1Ctx.fillRect() and layer2Ctx.arc(). These commands specifically target layer1Canvas and layer2Canvas respectively.

compositeLayers() is called immediately after drawing to make the changes visible.

3. The Main Screen Combines Them (Composition)
Your single visible <canvas> (e.g., mainCanvas) acts as a display. It clears itself and then copies the content from all the hidden layers onto itself, in the correct order (bottom layers first, then top layers).

Code Example (Compositing Layers):

// From core-layers-demo.html:
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

mainCtx.clearRect(): Wipes the visible canvas clean before redrawing.

mainCtx.drawImage(layerXCanvas, 0, 0): This is the key. It takes the content of a hidden canvas (layer1Canvas or layer2Canvas) and draws it onto the mainCanvas. The order of these drawImage calls determines the visual stacking order.

Why This Works
This approach is powerful because:

Isolation: Drawing on one layer doesn't accidentally affect another.

Flexibility: You can easily hide/show layers, reorder them, or clear individual layers without touching the others.

Efficiency: Browsers are highly optimized for drawImage(), making the composition process very fast.

This core pattern allows for complex drawing applications where different elements can be managed independently.


# Layer System Guide

TinyBrush features a sophisticated layer system that allows you to organize your artwork on separate drawing sheets. This guide explains how to use the layer system effectively.

## Layer Architecture

TinyBrush uses a **hidden canvas composition system**:
- Each layer is its own offscreen canvas (invisible drawing sheet)
- When you draw, strokes are applied only to the currently active layer
- The main canvas combines all visible layers for final display

## Layer Panel Location

The Layer Panel is located in the **right column (RHC1)** of the interface, below the Mini Canvas.

## Layer Operations

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