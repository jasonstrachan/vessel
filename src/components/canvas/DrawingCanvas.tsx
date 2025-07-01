'use client';

import { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { useP5 } from '@/hooks/useP5';
import { useAppStore } from '@/stores/useAppStore';
import { Tool, CustomBrush } from '@/types';

export const DrawingCanvas = () => {
  const {
    project,
    currentTool,
    currentLayer,
    brushSettings,
    onionSkinSettings,
    isPlaying,
    setCurrentFrame,
    addUndoAction,
    zoom,
    panX,
    panY,
    setZoom,
    setPan,
    isSelecting,
    selectionStart,
    selectionEnd,
    setSelection,
    setIsSelecting,
    addCustomBrush,
    setCurrentTool,
    setBrushSettings,
  } = useAppStore();

  const p5InstanceRef = useRef<p5 | null>(null);
  const isDrawing = useRef(false);
  const isPanning = useRef(false);
  const isSpacePressed = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const lastPanPos = useRef<{ x: number; y: number } | null>(null);
  const canvasBuffer = useRef<any>(null);
  const layerBuffers = useRef<Map<string, any>>(new Map()); // Store P5 Graphics for each layer
  const [cursorUpdate, setCursorUpdate] = useState(0); // Force cursor updates
  const lastPanUpdate = useRef(0); // Throttle pan updates
  
  // Waiting pixel algorithm state (from reference implementation)
  const lastDrawnX = useRef(-1);
  const lastDrawnY = useRef(-1);
  const waitingPixelX = useRef(-1);
  const waitingPixelY = useRef(-1);

  // Brush rotation state for smooth angle transitions
  const lastBrushAngle = useRef(0);
  const isNewStroke = useRef(true);

  // Fast rotation cache for custom brushes
  const rotationCache = useRef<Map<string, Map<number, ImageData>>>(new Map());

  // Bresenham line algorithm from reference implementation
  const drawLineBresenham = (graphics: any, x0: number, y0: number, x1: number, y1: number, color: string) => {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;
    
    let currentX = x0;
    let currentY = y0;

    graphics.loadPixels();
    const fillColor = graphics.color(color);
    
    while (true) {
      // Draw pixel if within bounds
      if (currentX >= 0 && currentX < graphics.width && currentY >= 0 && currentY < graphics.height) {
        const index = (currentY * graphics.width + currentX) * 4;
        graphics.pixels[index] = graphics.red(fillColor);
        graphics.pixels[index + 1] = graphics.green(fillColor);
        graphics.pixels[index + 2] = graphics.blue(fillColor);
        graphics.pixels[index + 3] = graphics.alpha(fillColor);
      }

      if (currentX === x1 && currentY === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        currentX += sx;
      }
      if (e2 < dx) {
        err += dx;
        currentY += sy;
      }
    }
    
    graphics.updatePixels();
  };

  // Draw segment function from reference implementation
  const drawSegment = (graphics: any, x0: number, y0: number, x1: number, y1: number, color: string) => {
    if (x0 >= 0 && x0 < graphics.width && y0 >= 0 && y0 < graphics.height &&
        x1 >= 0 && x1 < graphics.width && y1 >= 0 && y1 < graphics.height) {
      drawLineBresenham(graphics, Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1), color);
    }
  };

  // Perfect pixels algorithm from reference implementation
  const perfectPixels = (graphics: any, currentX: number, currentY: number, color: string) => {
    const gridX = Math.floor(currentX);
    const gridY = Math.floor(currentY);
    
    // If this is the very first pixel of a new stroke
    if (lastDrawnX.current === -1) {
      lastDrawnX.current = gridX;
      lastDrawnY.current = gridY;
      waitingPixelX.current = gridX;
      waitingPixelY.current = gridY;
      // Draw the initial single pixel
      drawSegment(graphics, gridX, gridY, gridX, gridY, color);
      return;
    }

    // Check if the current pixel is NOT adjacent to the last drawn pixel
    if (Math.abs(gridX - lastDrawnX.current) > 1 || Math.abs(gridY - lastDrawnY.current) > 1) {
      // Draw a line from the last drawn pixel to the waiting pixel
      drawSegment(graphics, lastDrawnX.current, lastDrawnY.current, waitingPixelX.current, waitingPixelY.current, color);

      // Update the 'lastDrawn' to the pixel that was just committed
      lastDrawnX.current = waitingPixelX.current;
      lastDrawnY.current = waitingPixelY.current;

      // The current position becomes the new waiting pixel
      waitingPixelX.current = gridX;
      waitingPixelY.current = gridY;
    } else {
      // Just update the waiting pixel to the current position
      waitingPixelX.current = gridX;
      waitingPixelY.current = gridY;
    }
  };

  // Finalize waiting pixel on stroke end
  const finalizeWaitingPixel = (graphics: any, color: string) => {
    if (lastDrawnX.current !== -1 && waitingPixelX.current !== -1) {
      drawSegment(graphics, lastDrawnX.current, lastDrawnY.current, waitingPixelX.current, waitingPixelY.current, color);
    }
  };

  // Reset waiting pixel state for new stroke
  const resetWaitingPixelState = () => {
    lastDrawnX.current = -1;
    lastDrawnY.current = -1;
    waitingPixelX.current = -1;
    waitingPixelY.current = -1;
  };

  const setup = (p: p5) => {
    // PIXEL-PERFECT SETUP: Critical for crisp rendering
    p.pixelDensity(1); // Force 1:1 pixel mapping, ignore device pixel ratio
    p5InstanceRef.current = p;
    
    // PIXEL-PERFECT CANVAS SETUP
    const canvas = (p as any).canvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Disable ALL anti-aliasing and smoothing
        ctx.imageSmoothingEnabled = false;
        (ctx as any).webkitImageSmoothingEnabled = false;
        (ctx as any).mozImageSmoothingEnabled = false;
        (ctx as any).msImageSmoothingEnabled = false;
        (ctx as any).oImageSmoothingEnabled = false;
        
        // CRITICAL: Set pixel-perfect CSS properties
        ctx.imageSmoothingQuality = 'low'; // When smoothing is re-enabled
        
        // NOTE: No translate(0.5, 0.5) because we use direct ImageData manipulation
      }
      
      // CSS pixel-perfect rendering
      canvas.style.imageRendering = 'pixelated';
      canvas.style.imageRendering = '-moz-crisp-edges';
      canvas.style.imageRendering = '-webkit-crisp-edges';
      canvas.style.imageRendering = 'crisp-edges';
      
      // Ensure canvas is aligned to device pixels
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }
    
    // Initialize layer buffers for all layers
    project.layers.forEach(layer => {
      if (!layerBuffers.current.has(layer.id)) {
        const layerGraphics = p.createGraphics(project.width, project.height);
        layerGraphics.pixelDensity(1);
        
        // PIXEL-PERFECT LAYER SETUP: Apply same settings to layer graphics
        const layerCanvas = (layerGraphics as any).canvas;
        if (layerCanvas) {
          const layerCtx = layerCanvas.getContext('2d');
          if (layerCtx) {
            // Disable anti-aliasing for layer graphics
            layerCtx.imageSmoothingEnabled = false;
            (layerCtx as any).webkitImageSmoothingEnabled = false;
            (layerCtx as any).mozImageSmoothingEnabled = false;
            (layerCtx as any).msImageSmoothingEnabled = false;
            (layerCtx as any).oImageSmoothingEnabled = false;
            
            // NOTE: No translate(0.5, 0.5) because we use direct ImageData manipulation
          }
        }
        
        layerGraphics.background(0, 0, 0, 0); // Transparent background
        layerBuffers.current.set(layer.id, layerGraphics);
        // Created layer buffer
      }
    });
    
    // Set main canvas background
    p.background(240); // Light gray background for drawing
    
    // FORCE AUTO-CENTER: Trigger centering after canvas is created
    setTimeout(() => {
      const { zoom, panX, panY, setPan } = useAppStore.getState();
      if (panX === 0 && panY === 0 && zoom > 1) {
        const container = document.querySelector('[data-canvas-container]') as HTMLElement;
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const canvasWidth = project.width * zoom;
          const canvasHeight = project.height * zoom;
          const idealPanX = (containerRect.width - canvasWidth) / 2;
          const idealPanY = (containerRect.height - canvasHeight) / 2;
          
          console.log(`🚀 FORCED AUTO-CENTER: viewport(${containerRect.width.toFixed(0)}x${containerRect.height.toFixed(0)}) canvas(${canvasWidth.toFixed(0)}x${canvasHeight.toFixed(0)}) -> pan(${idealPanX.toFixed(1)}, ${idealPanY.toFixed(1)})`);
          setPan(idealPanX, idealPanY);
        }
      }
    }, 100);
    
    // P5 Setup complete
  };

  const draw = (p: p5) => {
    // Use noSmooth for canvas composition to preserve both pixel art and smooth art
    p.noSmooth();
    
    // Clear main canvas and composite all visible layers
    p.background(240); // Light gray background for drawing
    
    // Draw all visible layers in order
    project.layers.forEach((layer, index) => {
      if (layer.visible && layerBuffers.current.has(layer.id)) {
        const layerGraphics = layerBuffers.current.get(layer.id);
        // Use noSmooth for layer composition to avoid double-smoothing
        p.noSmooth();
        p.image(layerGraphics, 0, 0);
      }
    });
    
    // Draw selection rectangle overlay for brush selection ON TOP of everything
    if (selectionStart && selectionEnd) {
      p.push();
      
      // Create a semi-transparent overlay
      p.fill(255, 0, 0, 50); // Red with transparency
      p.stroke(255, 0, 0); // Bright red border
      p.strokeWeight(2); 
      p.rectMode(p.CORNERS);
      
      // Draw filled rectangle with border
      p.rect(selectionStart.x, selectionStart.y, selectionEnd.x, selectionEnd.y);
      
      // Add corner markers for visibility
      p.fill(255, 255, 0); // Yellow corners
      p.noStroke();
      const cornerSize = 6;
      p.rect(selectionStart.x - cornerSize/2, selectionStart.y - cornerSize/2, cornerSize, cornerSize);
      p.rect(selectionEnd.x - cornerSize/2, selectionStart.y - cornerSize/2, cornerSize, cornerSize);
      p.rect(selectionStart.x - cornerSize/2, selectionEnd.y - cornerSize/2, cornerSize, cornerSize);
      p.rect(selectionEnd.x - cornerSize/2, selectionEnd.y - cornerSize/2, cornerSize, cornerSize);
      
      p.pop();
    }
  };

  const drawOnionSkin = (p: p5, layer: any, currentFrame: number) => {
    // Draw previous frames
    for (let i = 1; i <= onionSkinSettings.framesBefore; i++) {
      const frameIndex = currentFrame - i;
      if (frameIndex >= 0 && layer.frames[frameIndex]) {
        const opacity = onionSkinSettings.opacity * (1 - (i - 1) / onionSkinSettings.framesBefore);
        p.push();
        p.tint(255, 0, 0, opacity * 255); // Red tint for previous frames
        p.image(layer.frames[frameIndex], 0, 0);
        p.pop();
      }
    }
    
    // Draw next frames
    for (let i = 1; i <= onionSkinSettings.framesAfter; i++) {
      const frameIndex = currentFrame + i;
      if (frameIndex < layer.frames.length && layer.frames[frameIndex]) {
        const opacity = onionSkinSettings.opacity * (1 - (i - 1) / onionSkinSettings.framesAfter);
        p.push();
        p.tint(0, 255, 0, opacity * 255); // Green tint for next frames
        p.image(layer.frames[frameIndex], 0, 0);
        p.pop();
      }
    }
  };


  // Disable p5 mouse events - using DOM events instead
  const mousePressed = undefined;
  const mouseDragged = undefined; 
  const mouseReleased = undefined;

  const floodFill = (graphics: any, x: number, y: number, fillColor: string) => {
    const targetColor = graphics.get(x, y);
    const fillColorArray = graphics.color(fillColor);
    
    // Don't fill if clicking on the same color
    if (colorsEqual(targetColor, fillColorArray)) return;
    
    const stack = [{x: Math.floor(x), y: Math.floor(y)}];
    const visited = new Set<string>();
    
    graphics.loadPixels();
    
    while (stack.length > 0) {
      const {x: currentX, y: currentY} = stack.pop()!;
      const key = `${currentX},${currentY}`;
      
      if (visited.has(key)) continue;
      if (currentX < 0 || currentX >= graphics.width || currentY < 0 || currentY >= graphics.height) continue;
      
      const currentColor = graphics.get(currentX, currentY);
      if (!colorsEqual(currentColor, targetColor)) continue;
      
      visited.add(key);
      
      // Set pixel color
      const index = (currentY * graphics.width + currentX) * 4;
      graphics.pixels[index] = graphics.red(fillColorArray);
      graphics.pixels[index + 1] = graphics.green(fillColorArray);
      graphics.pixels[index + 2] = graphics.blue(fillColorArray);
      graphics.pixels[index + 3] = 255;
      
      // Add adjacent pixels to stack
      stack.push({x: currentX + 1, y: currentY});
      stack.push({x: currentX - 1, y: currentY});
      stack.push({x: currentX, y: currentY + 1});
      stack.push({x: currentX, y: currentY - 1});
    }
    
    graphics.updatePixels();
  };

  const colorsEqual = (color1: any, color2: any) => {
    return p5InstanceRef.current?.red(color1) === p5InstanceRef.current?.red(color2) &&
           p5InstanceRef.current?.green(color1) === p5InstanceRef.current?.green(color2) &&
           p5InstanceRef.current?.blue(color1) === p5InstanceRef.current?.blue(color2);
  };

  // Create temporary custom brush from current selection
  const createTemporaryCustomBrush = () => {
    if (!selectionStart || !selectionEnd) return;
    
    // Get the active layer to capture from
    const activeLayer = project.layers[currentLayer];
    if (!activeLayer) return;
    
    // Calculate selection bounds
    const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
    const maxX = Math.ceil(Math.max(selectionStart.x, selectionEnd.x));
    const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
    const maxY = Math.ceil(Math.max(selectionStart.y, selectionEnd.y));
    const width = maxX - minX;
    const height = maxY - minY;
    
    if (width <= 0 || height <= 0) return;
    
    // Create temporary canvas to capture the selection
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const captureCtx = captureCanvas.getContext('2d');
    if (!captureCtx) return;
    
    // Get the P5 layer canvas
    const layerCanvas = document.querySelector('canvas');
    if (!layerCanvas) return;
    
    // Capture the selection area from the canvas
    captureCtx.drawImage(
      layerCanvas,
      minX, minY, width, height,
      0, 0, width, height
    );
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Create thumbnail for UI
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = 64;
    thumbnailCanvas.height = 64;
    const thumbnailCtx = thumbnailCanvas.getContext('2d');
    if (thumbnailCtx) {
      const scale = Math.min(64 / width, 64 / height);
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const offsetX = (64 - scaledWidth) / 2;
      const offsetY = (64 - scaledHeight) / 2;
      
      thumbnailCtx.drawImage(
        captureCanvas,
        0, 0, width, height,
        offsetX, offsetY, scaledWidth, scaledHeight
      );
    }
    
    // Create temporary custom brush
    const tempBrushId = 'temp_' + Date.now();
    const customBrush = {
      id: tempBrushId,
      name: `Custom Brush ${Date.now()}`,
      imageData,
      thumbnail: thumbnailCanvas.toDataURL(),
      width,
      height,
      createdAt: Date.now()
    };
    
    // Switch to brush tool and select the temporary custom brush
    setCurrentTool(Tool.BRUSH);
    setBrushSettings({ 
      brushShape: 'custom',
      selectedCustomBrush: tempBrushId 
    });
    
    // Add temporary brush to project (can be saved later with +)
    addCustomBrush(customBrush);
    
    console.log('✨ Created temporary custom brush:', tempBrushId);
  };

  // Calculate smooth brush rotation angle from movement direction
  const calculateSmoothBrushRotation = (x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Minimum movement threshold to update angle (prevents jitter on slow movement)
    const MIN_MOVEMENT = 2;
    
    // If movement is too small, use the last angle
    if (distance < MIN_MOVEMENT && !isNewStroke.current) {
      return lastBrushAngle.current;
    }
    
    // Calculate new angle in degrees (0 = right, 90 = down)
    const newAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // For new strokes, just use the new angle
    if (isNewStroke.current) {
      lastBrushAngle.current = newAngle;
      isNewStroke.current = false;
      return newAngle;
    }
    
    // Smooth angle transition for organic feel
    const SMOOTHING_FACTOR = 0.3; // Lower = smoother transitions
    const angleDiff = newAngle - lastBrushAngle.current;
    
    // Handle angle wrapping (e.g., -179° to 179° should interpolate through 180°, not 358°)
    let adjustedAngleDiff = angleDiff;
    if (adjustedAngleDiff > 180) {
      adjustedAngleDiff -= 360;
    } else if (adjustedAngleDiff < -180) {
      adjustedAngleDiff += 360;
    }
    
    // Apply smoothing
    const smoothedAngle = lastBrushAngle.current + (adjustedAngleDiff * SMOOTHING_FACTOR);
    lastBrushAngle.current = smoothedAngle;
    
    return smoothedAngle;
  };

  // Pixel-perfect coordinate snapping - ensures crisp integer coordinates
  const snapToPixel = (coord: number): number => {
    return Math.floor(coord) + 0.5; // Half-pixel offset for crisp 1px lines
  };
  
  const snapToPixelGrid = (coord: number): number => {
    // PIXEL-PERFECT: For direct ImageData manipulation, use precise integer coordinates
    return Math.round(coord);
  };

  // Grid snapping based on brush dimensions
  const snapToGrid = (x: number, y: number, gridWidth: number, gridHeight: number): { x: number, y: number } => {
    return {
      x: Math.round(x / gridWidth) * gridWidth,
      y: Math.round(y / gridHeight) * gridHeight
    };
  };

  // Get grid dimensions based on current brush
  const getGridDimensions = (): { width: number, height: number } => {
    if (brushSettings.brushShape === 'custom' && brushSettings.selectedCustomBrush) {
      const customBrush = project.customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      if (customBrush) {
        const scaleFactor = brushSettings.size;
        return {
          width: Math.max(1, customBrush.width * scaleFactor),
          height: Math.max(1, customBrush.height * scaleFactor)
        };
      }
    }
    // For square and circle brushes, use brush size for both dimensions
    // Ensure minimum grid size of 1
    const size = Math.max(1, brushSettings.size);
    return {
      width: size,
      height: size
    };
  };

  // Bresenham's Line Algorithm for pixel-perfect lines
  const bresenhamLine = (x0: number, y0: number, x1: number, y1: number): Array<{x: number, y: number}> => {
    const pixels: Array<{x: number, y: number}> = [];
    
    // Convert to integers for Bresenham - this is the key to pixel-perfect drawing
    x0 = snapToPixelGrid(x0);
    y0 = snapToPixelGrid(y0);
    x1 = snapToPixelGrid(x1);
    y1 = snapToPixelGrid(y1);
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let currentX = x0;
    let currentY = y0;
    
    while (true) {
      pixels.push({ x: currentX, y: currentY });
      
      if (currentX === x1 && currentY === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        currentX += sx;
      }
      if (e2 < dx) {
        err += dx;
        currentY += sy;
      }
    }
    
    return pixels;
  };

  // Pixel Perfect Algorithm - removes L-shaped artifacts (Aseprite-style)
  const pixelPerfectFilter = (pixels: Array<{x: number, y: number}>): Array<{x: number, y: number}> => {
    if (pixels.length <= 2) return pixels;
    
    const filtered: Array<{x: number, y: number}> = [pixels[0]]; // Always keep first pixel
    
    for (let i = 1; i < pixels.length - 1; i++) {
      const prev = pixels[i - 1];
      const curr = pixels[i];
      const next = pixels[i + 1];
      
      // Check if current pixel forms an L-shape
      const isLShape = (
        (prev.x !== next.x && prev.y !== next.y) && // Diagonal relationship between prev and next
        ((curr.x === prev.x && curr.y === next.y) || (curr.x === next.x && curr.y === prev.y)) // Current is the corner
      );
      
      // Keep pixel only if it's NOT part of an L-shape
      if (!isLShape) {
        filtered.push(curr);
      }
    }
    
    filtered.push(pixels[pixels.length - 1]); // Always keep last pixel
    return filtered;
  };

  // Custom brush drawing functions
  const drawCustomBrushStamp = (graphics: any, x: number, y: number, customBrush: CustomBrush, scale: number = 1, rotation: number = 0) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set up canvas with brush dimensions
    canvas.width = customBrush.width;
    canvas.height = customBrush.height;
    
    // Put the brush ImageData onto the temporary canvas
    ctx.putImageData(customBrush.imageData, 0, 0);
    
    // Calculate scaled dimensions and position
    const scaledWidth = customBrush.width * scale;
    const scaledHeight = customBrush.height * scale;
    
    // Get the P5 graphics context and draw the custom brush
    const p5Canvas = (graphics as any).canvas;
    const p5Ctx = p5Canvas.getContext('2d');
    if (p5Ctx) {
      p5Ctx.save();
      p5Ctx.globalCompositeOperation = 'source-over';
      
      // ALWAYS disable image smoothing for hard pixel edges
      p5Ctx.imageSmoothingEnabled = false;
      (p5Ctx as any).webkitImageSmoothingEnabled = false;
      (p5Ctx as any).mozImageSmoothingEnabled = false;
      (p5Ctx as any).msImageSmoothingEnabled = false;
      (p5Ctx as any).oImageSmoothingEnabled = false;
      
      // Apply rotation if enabled
      if (brushSettings.rotateEnabled && rotation !== 0) {
        p5Ctx.translate(x, y);
        p5Ctx.rotate(rotation * Math.PI / 180); // Convert degrees to radians
        p5Ctx.translate(-scaledWidth / 2, -scaledHeight / 2);
        p5Ctx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);
      } else {
        // No rotation - center the brush normally
        const centerX = x - scaledWidth / 2;
        const centerY = y - scaledHeight / 2;
        p5Ctx.drawImage(canvas, centerX, centerY, scaledWidth, scaledHeight);
      }
      
      p5Ctx.restore();
    }
  };

  const drawCustomBrushLine = (graphics: any, x1: number, y1: number, x2: number, y2: number, customBrush: CustomBrush, scale: number = 1) => {
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const spacing = Math.max(1, Math.min(customBrush.width, customBrush.height) * scale * 0.5);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    
    // Calculate smooth rotation angle from line direction
    const rotation = brushSettings.rotateEnabled ? calculateSmoothBrushRotation(x1, y1, x2, y2) : 0;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = x1 + (x2 - x1) * t;
      let y = y1 + (y2 - y1) * t;
      
      // Apply grid snapping to custom brush interpolated points if enabled
      if (brushSettings.gridSnap) {
        const gridDims = getGridDimensions();
        const snapped = snapToGrid(x, y, gridDims.width, gridDims.height);
        x = snapped.x;
        y = snapped.y;
      }
      
      drawCustomBrushStamp(graphics, x, y, customBrush, scale, rotation);
    }
  };

  // Dotted line drawing for custom brushes
  const drawDottedCustomBrushLine = (graphics: any, x1: number, y1: number, x2: number, y2: number, customBrush: CustomBrush, scale: number, spacing: number, dashLength: number, gap: number) => {
    const segmentDistance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    
    // Calculate actual pixel values from brush size units
    const brushSize = Math.max(customBrush.width, customBrush.height) * scale;
    const dashLengthPixels = dashLength * brushSize;
    const gapPixels = gap * brushSize;
    const patternLength = dashLengthPixels + gapPixels;
    
    // Calculate smooth rotation angle from line direction
    const rotation = brushSettings.rotateEnabled ? calculateSmoothBrushRotation(x1, y1, x2, y2) : 0;
    
    // Use fine-grained steps for smooth pattern sampling
    const stepDistance = Math.min(spacing / 8, brushSize / 4, 1);
    const steps = Math.max(1, Math.ceil(segmentDistance / stepDistance));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = x1 + (x2 - x1) * t;
      let y = y1 + (y2 - y1) * t;
      
      // Apply grid snapping to dotted custom brush interpolated points if enabled
      if (brushSettings.gridSnap) {
        const gridDims = getGridDimensions();
        const snapped = snapToGrid(x, y, gridDims.width, gridDims.height);
        x = snapped.x;
        y = snapped.y;
      }
      
      // Calculate position in dotted pattern
      const totalDistanceAtPoint = cumulativeDistance + (t * segmentDistance);
      const positionInPattern = totalDistanceAtPoint % patternLength;
      
      // Only draw if we're in a dash segment (not in gap)
      if (positionInPattern < dashLengthPixels) {
        drawCustomBrushStamp(graphics, x, y, customBrush, scale, rotation);
      }
    }
    
    // Update cumulative distance for next segment
    cumulativeDistance += segmentDistance;
  };

  // ULTRA-FAST pixel line drawing with direct ImageData manipulation
  const drawPixelPerfectLine = (graphics: any, x1: number, y1: number, x2: number, y2: number, color: any) => {
    // Get Bresenham pixels
    let pixels = bresenhamLine(x1, y1, x2, y2);
    
    // Apply pixel perfect filter if enabled
    if (brushSettings.pixelPerfect) {
      pixels = pixelPerfectFilter(pixels);
    }
    
    // PERFORMANCE OPTIMIZED: Direct ImageData manipulation
    graphics.loadPixels();
    const imageData = graphics.pixels;
    const width = graphics.width;
    
    // Extract color values safely - P5.js color objects may have different structures
    let r, g, b, a;
    if (color.levels) {
      r = color.levels[0];
      g = color.levels[1];
      b = color.levels[2];
      a = color.levels[3];
    } else {
      // Fallback: parse color string or use P5.js methods
      r = graphics.red(color);
      g = graphics.green(color);
      b = graphics.blue(color);
      a = graphics.alpha(color);
    }
    
    for (const pixel of pixels) {
      if (pixel.x >= 0 && pixel.x < width && pixel.y >= 0 && pixel.y < graphics.height) {
        const index = (pixel.y * width + pixel.x) * 4;
        imageData[index] = r;     // Red
        imageData[index + 1] = g; // Green
        imageData[index + 2] = b; // Blue
        imageData[index + 3] = a; // Alpha
      }
    }
    graphics.updatePixels();
  };

  // ULTRA-FAST pixel-perfect line drawing with batched operations
  const drawPixelPerfectBrushLine = (graphics: any, x1: number, y1: number, x2: number, y2: number, size: number, isSquare: boolean) => {
    // Get Bresenham pixels for the line path
    let pixels = bresenhamLine(x1, y1, x2, y2);
    
    // Apply pixel perfect filter to remove L-shapes
    pixels = pixelPerfectFilter(pixels);
    
    // PERFORMANCE CRITICAL: Single loadPixels for entire operation
    graphics.loadPixels();
    const fillColor = graphics.color(brushSettings.color);
    
    // Batch all pixel operations using appropriate shape function
    for (const pixel of pixels) {
      if (isSquare) {
        setPixelPerfectSquare(graphics, pixel.x, pixel.y, size, fillColor);
      } else {
        setPixelPerfectCircle(graphics, pixel.x, pixel.y, size, fillColor);
      }
    }
    
    // PERFORMANCE CRITICAL: Single updatePixels for entire operation
    graphics.updatePixels();
  };

  // OPTIMIZED: Single pixel square with direct ImageData manipulation
  const setPixelPerfectSquare = (graphics: any, centerX: number, centerY: number, size: number, fillColor: any) => {
    const pixelSize = Math.max(1, Math.floor(size));
    const halfSize = Math.floor(pixelSize / 2);
    // PIXEL-PERFECT: Use integer coordinates directly (no additional rounding)
    const startX = Math.floor(centerX) - halfSize;
    const startY = Math.floor(centerY) - halfSize;
    
    // PERFORMANCE OPTIMIZED: Direct ImageData manipulation (assumes loadPixels already called)
    const imageData = graphics.pixels;
    const width = graphics.width;
    const height = graphics.height;
    
    // Extract color values safely - P5.js color objects may have different structures
    let r, g, b, a;
    if (fillColor.levels) {
      r = fillColor.levels[0];
      g = fillColor.levels[1];
      b = fillColor.levels[2];
      a = fillColor.levels[3];
    } else {
      // Fallback: parse color string or use P5.js methods
      r = graphics.red(fillColor);
      g = graphics.green(fillColor);
      b = graphics.blue(fillColor);
      a = graphics.alpha(fillColor);
    }
    
    for (let y = 0; y < pixelSize; y++) {
      for (let x = 0; x < pixelSize; x++) {
        const pixelX = startX + x;
        const pixelY = startY + y;
        
        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
          const index = (pixelY * width + pixelX) * 4;
          imageData[index] = r;     // Red
          imageData[index + 1] = g; // Green
          imageData[index + 2] = b; // Blue
          imageData[index + 3] = a; // Alpha
        }
      }
    }
  };

  // OPTIMIZED: Single pixel circle with direct ImageData manipulation
  const setPixelPerfectCircle = (graphics: any, centerX: number, centerY: number, size: number, fillColor: any) => {
    // For very small brushes (1-2px), use square for simplicity and performance
    if (size <= 2) {
      setPixelPerfectSquare(graphics, centerX, centerY, size, fillColor);
      return;
    }
    
    // For larger brushes, draw a simple circle
    const radius = Math.max(1, Math.floor(size / 2));
    const pixelCenterX = Math.round(centerX);
    const pixelCenterY = Math.round(centerY);
    const radiusSquared = radius * radius;
    
    // PERFORMANCE OPTIMIZED: Direct ImageData manipulation
    const imageData = graphics.pixels;
    const width = graphics.width;
    const height = graphics.height;
    
    // Extract color values safely - P5.js color objects may have different structures
    let r, g, b, a;
    if (fillColor.levels) {
      r = fillColor.levels[0];
      g = fillColor.levels[1];
      b = fillColor.levels[2];
      a = fillColor.levels[3];
    } else {
      // Fallback: parse color string or use P5.js methods
      r = graphics.red(fillColor);
      g = graphics.green(fillColor);
      b = graphics.blue(fillColor);
      a = graphics.alpha(fillColor);
    }
    
    // Limit the search area to prevent excessive computation
    const maxRadius = Math.min(radius, 20); // Cap at 20px radius for safety
    
    for (let dy = -maxRadius; dy <= maxRadius; dy++) {
      for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= radiusSquared) {
          const x = pixelCenterX + dx;
          const y = pixelCenterY + dy;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const index = (y * width + x) * 4;
            imageData[index] = r;     // Red
            imageData[index + 1] = g; // Green
            imageData[index + 2] = b; // Blue
            imageData[index + 3] = a; // Alpha
          }
        }
      }
    }
  };
  
  // Standalone pixel square with its own loadPixels/updatePixels
  const drawPixelPerfectSquare = (graphics: any, centerX: number, centerY: number, size: number) => {
    graphics.loadPixels();
    const fillColor = graphics.color(brushSettings.color);
    setPixelPerfectSquare(graphics, centerX, centerY, size, fillColor);
    graphics.updatePixels();
  };

  // Standalone pixel circle with its own loadPixels/updatePixels
  const drawPixelPerfectCircle = (graphics: any, centerX: number, centerY: number, size: number) => {
    graphics.loadPixels();
    const fillColor = graphics.color(brushSettings.color);
    setPixelPerfectCircle(graphics, centerX, centerY, size, fillColor);
    graphics.updatePixels();
  };

  // Generic pixel-perfect shape function
  const drawPixelPerfectShape = (graphics: any, centerX: number, centerY: number, size: number, isSquare: boolean) => {
    if (isSquare) {
      drawPixelPerfectSquare(graphics, centerX, centerY, size);
    } else {
      drawPixelPerfectCircle(graphics, centerX, centerY, size);
    }
  };

  // FIXED: Cumulative distance tracking for consistent dotted patterns
  let cumulativeDistance = 0; // Track total distance across all segments
  
  const drawDottedLine = (graphics: any, x1: number, y1: number, x2: number, y2: number, size: number, spacing: number, dashLength: number, gap: number, isSquare: boolean, rotation: number = 0) => {
    const segmentDistance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    
    // Calculate actual pixel values from brush size units
    const dashLengthPixels = dashLength * size; // Length in brush size units
    const gapPixels = gap * size; // Gap in brush size units
    const patternLength = dashLengthPixels + gapPixels;
    
    // Use fine-grained steps for smooth pattern sampling
    const stepDistance = Math.min(spacing / 8, size / 4, 1); // Even finer steps
    const steps = Math.max(1, Math.ceil(segmentDistance / stepDistance));
    
    // Track distance for pattern consistency
    
    // Track dotted pattern rendering
    
    // UNIFIED: Dotted lines work for ALL brush sizes 
    setGraphicsMode(graphics, brushSettings.pixelPerfect);
    
    // Determine rendering path for dotted lines
    
    // For small brushes, use batched pixel operations for performance
    if (brushSettings.pixelPerfect && size <= PIXEL_PERFECT_THRESHOLD) {
      graphics.loadPixels();
      const fillColor = graphics.color(brushSettings.color);
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // PIXEL-PERFECT: Use consistent integer coordinates
        let x = Math.round(x1 + (x2 - x1) * t);
        let y = Math.round(y1 + (y2 - y1) * t);
        
        // Apply grid snapping to dotted line interpolated points if enabled
        if (brushSettings.gridSnap) {
          const gridDims = getGridDimensions();
          const snapped = snapToGrid(x, y, gridDims.width, gridDims.height);
          x = snapped.x;
          y = snapped.y;
        }
        
        // FIXED: Use cumulative distance + segment progress
        const totalDistanceAtPoint = cumulativeDistance + (t * segmentDistance);
        const positionInPattern = totalDistanceAtPoint % patternLength;
        
        // Minimal step logging
        
        // Only draw if we're in a dash segment (not in gap)
        if (positionInPattern < dashLengthPixels) {
          if (isSquare) {
            setPixelPerfectSquare(graphics, x, y, size, fillColor);
          } else {
            setPixelPerfectCircle(graphics, x, y, size, fillColor);
          }
          // Draw pixel
        } else {
          // Skip pixel (gap)
        }
      }
      
      graphics.updatePixels();
    } else {
      // Universal mode: Works for ALL brush sizes (small and large)
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let x = x1 + (x2 - x1) * t;
        let y = y1 + (y2 - y1) * t;
        
        // Apply grid snapping to dotted line interpolated points if enabled
        if (brushSettings.gridSnap) {
          const gridDims = getGridDimensions();
          const snapped = snapToGrid(x, y, gridDims.width, gridDims.height);
          x = snapped.x;
          y = snapped.y;
        }
        
        // FIXED: Use cumulative distance + segment progress
        const totalDistanceAtPoint = cumulativeDistance + (t * segmentDistance);
        const positionInPattern = totalDistanceAtPoint % patternLength;
        
        // Minimal step logging
        
        // Only draw if we're in a dash segment (not in gap)
        if (positionInPattern < dashLengthPixels) {
          drawShape(graphics, x, y, size, isSquare, true, rotation);
          // Draw pixel
        } else {
          // Skip pixel (gap)
        }
      }
    }
    
    // Update cumulative distance for next segment
    cumulativeDistance += segmentDistance;
    
    // Pattern complete
  };

  // PERFORMANCE: Size-based rendering strategy
  // Brushes ≤10px use pixel-perfect algorithms (Bresenham + batched operations)
  // Brushes >10px use fast P5.js native shapes with optional hard edges
  const PIXEL_PERFECT_THRESHOLD = 10;
  
  // ULTRA-FAST shape drawing with size-based optimization
  let currentSmoothMode: boolean | null = null;
  let cachedFillColor: any = null;
  
  const setGraphicsMode = (graphics: any, pixelPerfect: boolean) => {
    if (currentSmoothMode === pixelPerfect) return; // Skip if already set
    
    const layerCanvas = (graphics as any).canvas;
    if (layerCanvas) {
      const layerCtx = layerCanvas.getContext('2d');
      if (layerCtx) {
        if (pixelPerfect) {
          graphics.noSmooth();
          layerCtx.imageSmoothingEnabled = false;
        } else {
          graphics.smooth();
          layerCtx.imageSmoothingEnabled = true;
          layerCtx.imageSmoothingQuality = 'high';
        }
      }
    }
    currentSmoothMode = pixelPerfect;
  };
  
  const drawShape = (graphics: any, x: number, y: number, size: number, isSquare: boolean, withRotation: boolean = false, rotation: number = 0) => {
    // RENDERING STRATEGY: 
    // - Small brushes (≤10px) + Pixel ON = True pixel-perfect (Bresenham algorithm)
    // - Large brushes (>10px) + Pixel ON = Fast shapes with hard edges
    // - Any size + Pixel OFF = Smooth anti-aliased shapes
    const shouldUsePixelPerfect = brushSettings.pixelPerfect && size <= PIXEL_PERFECT_THRESHOLD;
    
    if (shouldUsePixelPerfect) {
      // PIXEL PERFECT MODE: Only for small brushes (fast)
      // For pixel brushes, rotation is applied differently to maintain hard edges
      if (withRotation && brushSettings.rotateEnabled && rotation !== 0 && isSquare) {
        // Rotated pixel squares need special handling to maintain hard edges
        graphics.push();
        graphics.translate(x, y);
        graphics.rotate(graphics.radians(rotation));
        graphics.noStroke();
        graphics.fill(graphics.color(brushSettings.color));
        graphics.rectMode(graphics.CENTER);
        graphics.rect(0, 0, Math.floor(size), Math.floor(size));
        graphics.pop();
      } else {
        // Regular pixel perfect shapes without rotation or circle shapes
        drawPixelPerfectShape(graphics, x, y, size, isSquare);
      }
      return;
    }
    
    // FAST NATIVE RENDERING: For large brushes use P5.js native shapes
    // BUT preserve hard edges when pixel toggle is ON
    setGraphicsMode(graphics, brushSettings.pixelPerfect); // Keep pixel mode for hard edges!
    
    graphics.push();
    
    if (withRotation && brushSettings.rotateEnabled && rotation !== 0) {
      graphics.translate(x, y);
      graphics.rotate(graphics.radians(rotation));
      x = 0;
      y = 0;
    }
    
    graphics.noStroke();
    
    // Reuse color object if unchanged
    if (!cachedFillColor || cachedFillColor._getRed() !== graphics.red(brushSettings.color)) {
      cachedFillColor = graphics.color(brushSettings.color);
    }
    graphics.fill(cachedFillColor);
    
    // Respect user's brush shape choice for all sizes and modes
    const finalShape = isSquare;
    
    if (finalShape) {
      graphics.rectMode(graphics.CENTER);
      // Snap large brush position to pixel grid when pixel mode is ON
      if (brushSettings.pixelPerfect) {
        graphics.rect(Math.floor(x), Math.floor(y), Math.floor(size), Math.floor(size));
      } else {
        graphics.rect(x, y, size, size);
      }
    } else {
      if (brushSettings.pixelPerfect) {
        graphics.circle(Math.floor(x), Math.floor(y), Math.floor(size));
      } else {
        graphics.circle(x, y, size);
      }
    }
    
    graphics.pop();
  };

  // OPTIMIZED: Pre-allocate coordinate variables to reduce GC pressure
  let mouseX: number, mouseY: number;
  
  const performDrawAction = (p: p5, isDragging: boolean, currentMouseX?: number, currentMouseY?: number) => {
    // FAST coordinate calculation with minimal allocation
    mouseX = currentMouseX !== undefined ? currentMouseX : (p.mouseX - panX) / zoom;
    mouseY = currentMouseY !== undefined ? currentMouseY : (p.mouseY - panY) / zoom;
    
    // Apply grid snapping if enabled
    if (brushSettings.gridSnap && currentMouseX === undefined && currentMouseY === undefined) {
      const gridDims = getGridDimensions();
      const snapped = snapToGrid(mouseX, mouseY, gridDims.width, gridDims.height);
      mouseX = snapped.x;
      mouseY = snapped.y;
    }
    
    // Get the active layer buffer
    const activeLayer = project.layers[currentLayer];
    if (!activeLayer || !layerBuffers.current.has(activeLayer.id)) {
      // No active layer buffer found
      return;
    }
    
    const layerGraphics = layerBuffers.current.get(activeLayer.id);
    
    // Apply pressure sensitivity if enabled
    let effectiveSize = brushSettings.size;
    let effectiveOpacity = brushSettings.opacity;
    
    if (brushSettings.pressureSettings.enabled) {
      // Simulate pressure variation (in real app, this would come from pointer events)
      const pressureFactor = (brushSettings.pressureSettings.minValue + brushSettings.pressureSettings.maxValue) / 2 / brushSettings.pressureSettings.maxValue;
      effectiveSize = brushSettings.size * pressureFactor;
      effectiveOpacity = brushSettings.opacity * pressureFactor;
    }
    
    // Determine brush shape and get custom brush if needed
    const isSquareShape = brushSettings.brushShape === 'square';
    const isCustomBrush = brushSettings.brushShape === 'custom';
    const customBrush = isCustomBrush && brushSettings.selectedCustomBrush 
      ? project.customBrushes.find(b => b.id === brushSettings.selectedCustomBrush)
      : null;
    
    switch (currentTool) {
      case Tool.BRUSH:
        if (isCustomBrush && customBrush) {
          // Handle custom brush drawing
          console.log('🎨 CUSTOM BRUSH DRAWING:', {
            customBrush: customBrush.id,
            effectiveSize,
            brushWidth: customBrush.width,
            brushHeight: customBrush.height
          });
          
          // Calculate scale factor: use brush size directly as scale
          // For custom brushes, treat the brush size as a multiplier (not target size)
          const scaleFactor = brushSettings.size;
          
          if (isDragging && lastPos.current !== null) {
            // Check if dotted style is enabled for custom brushes too
            if (brushSettings.dottedStyle.enabled) {
              // Use regular dotted line logic but with custom brush stamp
              const actualSpacing = brushSettings.dottedStyle.spacing;
              
              drawDottedCustomBrushLine(
                layerGraphics,
                lastPos.current.x, lastPos.current.y,
                mouseX, mouseY,
                customBrush,
                scaleFactor,
                actualSpacing,
                brushSettings.dottedStyle.dashLength,
                brushSettings.dottedStyle.gap
              );
            } else {
              drawCustomBrushLine(layerGraphics, lastPos.current.x, lastPos.current.y, mouseX, mouseY, customBrush, scaleFactor);
            }
          } else {
            // Single custom brush stamp (no rotation for single clicks)
            drawCustomBrushStamp(layerGraphics, mouseX, mouseY, customBrush, scaleFactor, 0);
          }
        } else {
          // Handle regular brushes (square/circle)
          layerGraphics.noStroke();
          const fillColor = layerGraphics.color(brushSettings.color);
          fillColor.setAlpha(effectiveOpacity * 255);
          layerGraphics.fill(fillColor);
          
          // Respect user's brush shape choice in both pixel and smooth modes
          const finalShape = isSquareShape;
        
          // Removed console.log for performance
        
          if (isDragging && lastPos.current !== null) {
          // Calculate smooth rotation angle from movement direction
          const rotation = brushSettings.rotateEnabled ? calculateSmoothBrushRotation(lastPos.current.x, lastPos.current.y, mouseX, mouseY) : 0;
          
          // Check if dotted style is enabled
          if (brushSettings.dottedStyle.enabled) {
            // DOTTED LINE DRAWING
            const actualSpacing = brushSettings.dottedStyle.spacing;
            
            // Drawing dotted stroke
            
            drawDottedLine(
              layerGraphics,
              lastPos.current.x, lastPos.current.y,
              mouseX, mouseY,
              effectiveSize,
              actualSpacing,
              brushSettings.dottedStyle.dashLength,
              brushSettings.dottedStyle.gap,
              finalShape,
              rotation
            );
          } else {
            // REGULAR LINE DRAWING
            const shouldUsePixelPerfect = brushSettings.pixelPerfect && effectiveSize <= PIXEL_PERFECT_THRESHOLD;
            
            if (shouldUsePixelPerfect && brushSettings.spacing <= 1 && effectiveSize === 1) {
              // WAITING PIXEL ALGORITHM: Perfect pixel-perfect drawing for 1px brushes
              perfectPixels(layerGraphics, mouseX, mouseY, brushSettings.color);
            } else if (shouldUsePixelPerfect && brushSettings.spacing <= 1) {
              // PIXEL PERFECT MODE: Only for small brushes with no spacing
              drawPixelPerfectBrushLine(
                layerGraphics,
                lastPos.current.x, lastPos.current.y,
                mouseX, mouseY,
                effectiveSize,
                finalShape
              );
            } else {
              // DIRECT POINT CALCULATION FOR SPACING
              const segmentDistance = Math.sqrt(
                Math.pow(mouseX - lastPos.current.x, 2) + 
                Math.pow(mouseY - lastPos.current.y, 2)
              );
              
              // Handle edge case for zero or negative spacing
              if (brushSettings.spacing <= 0) {
                // Continuous drawing - just draw at current position if we moved
                if (segmentDistance > 0) {
                  setGraphicsMode(layerGraphics, brushSettings.pixelPerfect);
                  // Note: mouseX, mouseY are already grid-snapped if gridSnap is enabled
                  drawShape(layerGraphics, mouseX, mouseY, effectiveSize, finalShape, true, rotation);
                }
              } else {
                // Calculate first point to draw in this segment
                const firstPointToDrawAbsolute = cumulativeDistance === 0 
                  ? 0 // Start immediately for first stroke to prevent orphan pixels
                  : Math.ceil(cumulativeDistance / brushSettings.spacing) * brushSettings.spacing;
                
                setGraphicsMode(layerGraphics, brushSettings.pixelPerfect);
                
                // Draw all points that fall within this segment
                let targetAbsoluteDistance = firstPointToDrawAbsolute;
                while (targetAbsoluteDistance <= cumulativeDistance + segmentDistance) {
                  // Calculate t (interpolation factor) for this target point
                  const distanceIntoSegment = targetAbsoluteDistance - cumulativeDistance;
                  const t = distanceIntoSegment / segmentDistance;
                  
                  // Calculate exact position
                  let x = lastPos.current.x + (mouseX - lastPos.current.x) * t;
                  let y = lastPos.current.y + (mouseY - lastPos.current.y) * t;
                  
                  // Apply grid snapping to interpolated points if enabled
                  if (brushSettings.gridSnap) {
                    const gridDims = getGridDimensions();
                    const snapped = snapToGrid(x, y, gridDims.width, gridDims.height);
                    x = snapped.x;
                    y = snapped.y;
                  }
                  
                  // Draw the shape at exact spacing interval with rotation
                  drawShape(layerGraphics, x, y, effectiveSize, finalShape, true, rotation);
                  
                  // Move to next spacing interval
                  targetAbsoluteDistance += brushSettings.spacing;
                }
              }
              
              // Update cumulative distance after processing segment
              cumulativeDistance += segmentDistance;
            }
          }
        } else {
          // Single dot - optimized for size
          const shouldUsePixelPerfect = brushSettings.pixelPerfect && effectiveSize <= PIXEL_PERFECT_THRESHOLD;
          
          let drawX = mouseX;
          let drawY = mouseY;
          
          // Snap to pixel grid only for small brushes in pixel perfect mode
          if (shouldUsePixelPerfect) {
            drawX = Math.floor(mouseX);
            drawY = Math.floor(mouseY);
          }
          
          // Drawing single dot (no rotation for single clicks)
          drawShape(layerGraphics, drawX, drawY, effectiveSize, finalShape, false, 0);
          }
        }
        break;
        
      case Tool.ERASER:
        layerGraphics.erase();
        
        // Optimized eraser with mode caching
        setGraphicsMode(layerGraphics, brushSettings.pixelPerfect);
        
        if (isDragging && lastPos.current !== null) {
          if (brushSettings.pixelPerfect) {
            // Pixel perfect eraser: optimized stepping
            const distance = Math.sqrt(
              Math.pow(mouseX - lastPos.current.x, 2) + 
              Math.pow(mouseY - lastPos.current.y, 2)
            );
            const steps = Math.max(1, Math.floor(distance));
            
            layerGraphics.noStroke();
            layerGraphics.fill(255);
            layerGraphics.rectMode(layerGraphics.CENTER);
            const flooredSize = Math.floor(effectiveSize);
            
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              const x = Math.floor(lastPos.current.x + (mouseX - lastPos.current.x) * t);
              const y = Math.floor(lastPos.current.y + (mouseY - lastPos.current.y) * t);
              
              layerGraphics.rect(x, y, flooredSize, flooredSize);
            }
          } else {
            // Smooth eraser: single optimized line
            layerGraphics.strokeWeight(effectiveSize);
            layerGraphics.strokeCap(layerGraphics.ROUND);
            layerGraphics.line(lastPos.current.x, lastPos.current.y, mouseX, mouseY);
          }
        } else {
          // Single erase dot - optimized
          layerGraphics.noStroke();
          layerGraphics.fill(255);
          
          if (brushSettings.pixelPerfect) {
            layerGraphics.rectMode(layerGraphics.CENTER);
            layerGraphics.rect(Math.floor(mouseX), Math.floor(mouseY), Math.floor(effectiveSize), Math.floor(effectiveSize));
          } else {
            layerGraphics.circle(mouseX, mouseY, effectiveSize);
          }
        }
        
        layerGraphics.noErase();
        break;
        
      case Tool.FILL:
        floodFill(layerGraphics, mouseX, mouseY, brushSettings.color);
        break;
        
      case Tool.CLEAR:
        layerGraphics.clear();
        layerGraphics.background(0, 0, 0, 0); // Reset to transparent
        break;
    }
  };


  // Keyboard events now handled globally

  // No longer needed - using DOM event handler instead
  const mouseWheel = undefined;

  // Use direct DOM event handling instead of p5 events
  const { containerRef, p5Instance } = useP5({
    setup,
    draw,
    mousePressed: undefined, // Using DOM events instead
    mouseDragged: undefined, // Using DOM events instead  
    mouseReleased: undefined, // Using DOM events instead
    keyPressed: undefined, // Using global keyboard events instead
    keyReleased: undefined, // Using global keyboard events instead
    mouseWheel: undefined, // Disable p5 mouseWheel to avoid conflicts
    width: project.width,
    height: project.height,
  });

  // Auto-center canvas on initial load and apply zoom/pan transforms
  useEffect(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) {
        // AUTO-CENTER: Calculate proper pan values to center canvas at current zoom
        const containerRect = containerRef.current.getBoundingClientRect();
        const canvasWidth = project.width * zoom;
        const canvasHeight = project.height * zoom;
        
        // Center the scaled canvas in the viewport
        const idealPanX = (containerRect.width - canvasWidth) / 2;
        const idealPanY = (containerRect.height - canvasHeight) / 2;
        
        // DEBUG: Check auto-centering conditions
        console.log(`🔍 AUTO-CENTER CHECK: panX=${panX}, panY=${panY}, zoom=${zoom}, shouldCenter=${panX === 0 && panY === 0 && zoom > 1}`);
        
        // Only auto-center if pan values are still at default (0,0)
        if (panX === 0 && panY === 0 && zoom > 1) {
          console.log(`🎯 AUTO-CENTERING: viewport(${containerRect.width.toFixed(0)}x${containerRect.height.toFixed(0)}) canvas(${canvasWidth.toFixed(0)}x${canvasHeight.toFixed(0)}) -> pan(${idealPanX.toFixed(1)}, ${idealPanY.toFixed(1)})`);
          setPan(idealPanX, idealPanY);
          return; // Skip transform this cycle, will re-run with new pan values
        }
        
        // Apply transform with translate first, then scale
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvas.style.transformOrigin = '0 0';
        
        // DEBUG: Verify actual canvas position
        const canvasRect = canvas.getBoundingClientRect();
        console.log(`🔄 CANVAS TRANSFORM: translate(${panX.toFixed(1)}, ${panY.toFixed(1)}) scale(${zoom.toFixed(2)})`);
        console.log(`  Canvas actual position: ${canvasRect.left.toFixed(1)}, ${canvasRect.top.toFixed(1)}, ${canvasRect.width.toFixed(1)}×${canvasRect.height.toFixed(1)}`);
        console.log(`  Container position: ${containerRect.left.toFixed(1)}, ${containerRect.top.toFixed(1)}, ${containerRect.width.toFixed(1)}×${containerRect.height.toFixed(1)}`);
      }
    }
  }, [zoom, panX, panY, project.width, project.height, setPan]);

  // Set canvas to use auto rendering to preserve both pixel art and smooth art
  useEffect(() => {
    if (containerRef.current) {
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        
        // Use auto rendering to let the browser handle mixed content appropriately
        canvas.style.imageRendering = 'auto';
        if (ctx) {
          ctx.imageSmoothingEnabled = false; // Disable to prevent double-smoothing during composition
          (ctx as any).webkitImageSmoothingEnabled = false;
          (ctx as any).mozImageSmoothingEnabled = false;
          (ctx as any).msImageSmoothingEnabled = false;
        }
        // Canvas set to auto rendering
      }
    }
  }, []); // Run once on mount

  // Add direct DOM event listener 
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelEvent = (event: WheelEvent) => {
      // Only handle wheel events on the canvas container
      if (!container.contains(event.target as Node)) return;
      
      event.preventDefault();
      event.stopPropagation();
      
      const zoomFactor = 0.15; // Larger increments for faster zooming
      const wheelDelta = event.deltaY;
      
      // Use a more reliable approach to get current zoom
      const state = useAppStore.getState();
      const currentZoom = state.zoom;
      const newZoom = currentZoom * (wheelDelta > 0 ? (1 - zoomFactor) : (1 + zoomFactor));
      const constrainedZoom = Math.max(0.1, Math.min(10, newZoom));
      
      // Reduced logging for performance
      // Zoom calculation optimized for performance
      
      if (Math.abs(constrainedZoom - currentZoom) > 0.001) {
        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        setZoom(constrainedZoom, mouseX, mouseY);
      }
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
    };
  }, [setZoom]);

  // Add global keyboard event listeners for spacebar
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!isSpacePressed.current) {
          isSpacePressed.current = true;
          setCursorUpdate(prev => prev + 1);
          // Spacebar pressed - pan mode enabled
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        isSpacePressed.current = false;
        isPanning.current = false;
        lastPanPos.current = null;
        setCursorUpdate(prev => prev + 1);
        // Spacebar released - pan mode disabled
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Add DOM mouse events for panning
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (isSpacePressed.current) {
        // Handle panning
        event.preventDefault();
        isPanning.current = true;
        lastPanPos.current = { x: event.clientX, y: event.clientY };
        setCursorUpdate(prev => prev + 1);
        // Started panning
      } else {
        // Handle drawing
        event.preventDefault();
        
        // Get coordinates relative to container (not transformed canvas)
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const rect = container.getBoundingClientRect();
        // DEBUG: Coordinate calculation with detailed logging
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        let mouseX = (rawX - panX) / zoom;
        let mouseY = (rawY - panY) / zoom;
        
        // Apply grid snapping if enabled
        if (brushSettings.gridSnap) {
          const gridDims = getGridDimensions();
          const snapped = snapToGrid(mouseX, mouseY, gridDims.width, gridDims.height);
          mouseX = snapped.x;
          mouseY = snapped.y;
        }
        
        // Coordinate transformation complete
        
        // Check bounds
        if (mouseX < 0 || mouseX > project.width || mouseY < 0 || mouseY > project.height) {
          // Mouse outside bounds - skip drawing
          return;
        }
        
        if (currentTool === Tool.BRUSH_SELECT) {
          // Handle brush selection
          console.log('🎯 Starting brush selection at:', mouseX, mouseY);
          setIsSelecting(true);
          setSelection({ x: mouseX, y: mouseY }, null);
        } else {
          // Handle regular drawing
          isDrawing.current = true;
          lastPos.current = { x: mouseX, y: mouseY };
          
          // Reset waiting pixel state for new stroke
          resetWaitingPixelState();
          
          // Reset cumulative distance for new drawing session
          cumulativeDistance = 0;
          
          // Reset rotation state for new stroke
          isNewStroke.current = true;
          
          // Don't draw initial dot - let the drag action handle the first stroke
          // This prevents orphan pixels when starting strokes
        }
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isPanning.current && lastPanPos.current && isSpacePressed.current) {
        // Handle panning
        event.preventDefault();
        
        // Throttle pan updates to every 16ms (~60fps max)
        const now = Date.now();
        if (now - lastPanUpdate.current < 16) return;
        lastPanUpdate.current = now;
        
        const deltaX = event.clientX - lastPanPos.current.x;
        const deltaY = event.clientY - lastPanPos.current.y;
        
        const newPanX = panX + deltaX;
        const newPanY = panY + deltaY;
        setPan(newPanX, newPanY);
        
        lastPanPos.current = { x: event.clientX, y: event.clientY };
      } else if (isSelecting && selectionStart && currentTool === Tool.BRUSH_SELECT) {
        // Handle brush selection dragging
        event.preventDefault();
        
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const rect = container.getBoundingClientRect();
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        const mouseX = (rawX - panX) / zoom;
        const mouseY = (rawY - panY) / zoom;
        
        // Update selection end position
        console.log('🔄 Updating selection to:', mouseX, mouseY);
        setSelection(selectionStart, { x: mouseX, y: mouseY });
      } else if (isDrawing.current && lastPos.current) {
        // Handle drawing
        event.preventDefault();
        
        const canvas = container.querySelector('canvas');
        if (!canvas) return;
        
        const rect = container.getBoundingClientRect();
        // DEBUG: Coordinate calculation during drag
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        let mouseX = (rawX - panX) / zoom;
        let mouseY = (rawY - panY) / zoom;
        
        // Apply grid snapping if enabled
        if (brushSettings.gridSnap) {
          const gridDims = getGridDimensions();
          const snapped = snapToGrid(mouseX, mouseY, gridDims.width, gridDims.height);
          mouseX = snapped.x;
          mouseY = snapped.y;
        }
        
        // DEBUG: Track coordinate transformation during drag
        // Mouse drag coordinates calculated
        
        // Draw line
        if (p5InstanceRef.current) {
          performDrawAction(p5InstanceRef.current, true, mouseX, mouseY);
        }
        
        lastPos.current = { x: mouseX, y: mouseY };
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (isPanning.current) {
        event.preventDefault();
        isPanning.current = false;
        lastPanPos.current = null;
        setCursorUpdate(prev => prev + 1);
        // Stopped panning
      } else if (isSelecting && currentTool === Tool.BRUSH_SELECT) {
        event.preventDefault();
        console.log('✅ Completed brush selection');
        setIsSelecting(false);
        setCursorUpdate(prev => prev + 1);
        
        // Auto-switch to brush tool and create temporary custom brush
        setTimeout(() => {
          createTemporaryCustomBrush();
        }, 100);
      } else if (isDrawing.current) {
        event.preventDefault();
        
        // Check if this was a single click (no drag movement)
        const wasSingleClick = cumulativeDistance === 0;
        
        if (wasSingleClick && p5InstanceRef.current && lastPos.current) {
          // Draw single dot for click without drag
          performDrawAction(p5InstanceRef.current, false, lastPos.current.x, lastPos.current.y);
        }
        
        isDrawing.current = false;
        lastPos.current = null;
        
        // Finalize waiting pixel for the current stroke
        const activeLayer = project.layers[currentLayer];
        if (activeLayer && layerBuffers.current.has(activeLayer.id)) {
          const layerGraphics = layerBuffers.current.get(activeLayer.id);
          finalizeWaitingPixel(layerGraphics, brushSettings.color);
        }
        
        setCursorUpdate(prev => prev + 1);
        // Stopped drawing
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panX, panY, setPan, zoom, project.width, project.height, currentTool, brushSettings, isSelecting, selectionStart, selectionEnd, setSelection, setIsSelecting]);

  // Canvas should be managed by useP5 hook only

  // Create layer buffers when layers are added
  useEffect(() => {
    if (!p5InstanceRef.current) return;
    
    project.layers.forEach(layer => {
      if (!layerBuffers.current.has(layer.id)) {
        const layerGraphics = p5InstanceRef.current!.createGraphics(project.width, project.height);
        layerGraphics.pixelDensity(1);
        layerGraphics.noSmooth();
        layerGraphics.background(0, 0, 0, 0); // Transparent background
        layerBuffers.current.set(layer.id, layerGraphics);
        // Created layer buffer for new layer
      }
    });
    
    // Remove buffers for deleted layers
    const existingLayerIds = new Set(project.layers.map(l => l.id));
    for (const [layerId, buffer] of layerBuffers.current.entries()) {
      if (!existingLayerIds.has(layerId)) {
        layerBuffers.current.delete(layerId);
        // Removed layer buffer for deleted layer
      }
    }
  }, [project.layers]);

  // Animation loop (simplified for now)
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      // Simple frame counter for now
      const currentFrame = useAppStore.getState().project.currentFrame;
      setCurrentFrame((currentFrame + 1) % 10);
    }, 1000 / project.fps);
    
    return () => clearInterval(interval);
  }, [isPlaying, project.fps, setCurrentFrame]);

  const getCursorStyle = () => {
    if (isSpacePressed.current) {
      return isPanning.current ? 'grabbing' : 'grab';
    }
    
    switch (currentTool) {
      case Tool.BRUSH:
        return 'crosshair';
      case Tool.BRUSH_SELECT:
        return 'crosshair';
      case Tool.ERASER:
        return 'grab';
      case Tool.FILL:
        return 'pointer';
      default:
        return 'default';
    }
  };

  const clearCanvas = () => {
    if (p5InstanceRef.current) {
      p5InstanceRef.current.clear();
      p5InstanceRef.current.background(240);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#2a2a2a]">
      {/* Canvas Container */}
      <div className="relative w-full h-full">
        {/* Canvas Border */}
        <div className="relative w-full h-full overflow-hidden bg-[#2a2a2a]">
          <div 
            ref={containerRef}
            data-canvas-container
            style={{
              cursor: getCursorStyle(),
            }}
            className="block"
          />
          
          {/* Canvas Info Overlay */}
          <div className="absolute top-2 left-2 bg-slate-900/80 backdrop-blur-sm text-slate-100 px-2 py-1 rounded text-xs font-mono">
            {project.width} × {project.height}
          </div>
          
          {/* Zoom Info */}
          <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-sm text-slate-100 px-2 py-1 rounded text-xs font-mono">
            {Math.round(zoom * 100)}%
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button 
            onClick={clearCanvas}
            className="px-3 py-2 bg-slate-800/90 hover:bg-slate-700/90 text-slate-100 rounded-lg text-sm font-medium transition-all duration-200 backdrop-blur-sm border border-slate-600"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};