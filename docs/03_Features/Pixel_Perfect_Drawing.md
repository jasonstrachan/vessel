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

### Sub-Pixel Animation

For smooth animation while maintaining pixel-perfect rendering:

```javascript
let subPixelX = 0;

function animate() {
  subPixelX += 0.1; // Smooth sub-pixel movement
  
  // Snap to pixel for rendering
  const renderX = Math.floor(subPixelX) + 0.5;
  
  drawPixelPerfectSprite(renderX, y);
  requestAnimationFrame(animate);
}
```

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