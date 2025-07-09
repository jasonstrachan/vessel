'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType, BrushShape } from '../types';

export interface StrokeInput {
  position: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
}

export interface RenderSettings {
  size: number;
  opacity: number;
  color: string;
  antiAliasing: boolean;
  pixelAlignment: boolean;
  spacing: number;
  rotation: number;
  shape: BrushShape;
}


export const useBrushEngine = () => {
  const { tools, activeBrushComponents } = useAppStore();
  
  // Pixel queue state for perfect pixel drawing
  const pixelQueueRef = useRef({
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    initialized: false,
    spacingCounter: 0
  });

  // Pixel-perfect circle patterns based on reference image
  const getPixelCirclePattern = useCallback((size: number): Array<{x: number, y: number}> => {
    const patterns: Record<number, Array<{x: number, y: number}>> = {
      1: [{x: 0, y: 0}],
      2: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}],
      3: [{x: 0, y: 1}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 1}],
      4: [
        {x: 0, y: 1}, {x: 0, y: 2},
        {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3},
        {x: 3, y: 1}, {x: 3, y: 2}
      ],
      5: [
        {x: 0, y: 2},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4},
        {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
        {x: 4, y: 2}
      ],
      6: [
        {x: 0, y: 2}, {x: 0, y: 3},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5},
        {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4},
        {x: 5, y: 2}, {x: 5, y: 3}
      ],
      7: [
        {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6},
        {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6},
        {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5},
        {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}
      ],
      8: [
        {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7},
        {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
        {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7},
        {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6},
        {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}
      ]
    };

    // For sizes larger than our predefined patterns, use a simple filled circle algorithm
    if (patterns[size]) {
      return patterns[size];
    }

    // Fallback to calculated circle for larger sizes
    const pixels: Array<{x: number, y: number}> = [];
    const radius = size / 2;
    const centerX = radius - 0.5;
    const centerY = radius - 0.5;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radius * radius) {
          pixels.push({x, y});
        }
      }
    }
    
    return pixels;
  }, []);
  
  const drawShape = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: BrushShape,
    antiAliasing: boolean
  ) => {
    const halfSize = size / 2;
    
    ctx.save();
    
    if (!antiAliasing) {
      ctx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      x = Math.round(x);
      y = Math.round(y);
    }
    
    switch (shape) {
      case BrushShape.SQUARE:
        if (antiAliasing) {
          ctx.fillRect(x - halfSize, y - halfSize, size, size);
        } else {
          // Pixel-perfect square
          const offset = Math.floor(size / 2);
          ctx.fillRect(x - offset, y - offset, size, size);
        }
        break;
        
      case BrushShape.ROUND:
        // Always use perfect circles for antialiased round brushes
        ctx.beginPath();
        ctx.arc(x, y, halfSize, 0, Math.PI * 2);
        ctx.fill();
        break;
        
      case BrushShape.PIXEL_ROUND:
        if (antiAliasing) {
          // Even for "antialiased" mode, use pixel patterns for pixel round brushes
          const pattern = getPixelCirclePattern(size);
          const offsetX = x - Math.floor(size / 2);
          const offsetY = y - Math.floor(size / 2);
          
          pattern.forEach(pixel => {
            ctx.fillRect(offsetX + pixel.x, offsetY + pixel.y, 1, 1);
          });
        } else {
          // Use pixel-perfect circle patterns for pixel mode
          const pattern = getPixelCirclePattern(size);
          const offsetX = x - Math.floor(size / 2);
          const offsetY = y - Math.floor(size / 2);
          
          pattern.forEach(pixel => {
            ctx.fillRect(offsetX + pixel.x, offsetY + pixel.y, 1, 1);
          });
        }
        break;
        
      case BrushShape.TRIANGLE:
        ctx.beginPath();
        if (antiAliasing) {
          ctx.moveTo(x, y - halfSize);
          ctx.lineTo(x - halfSize, y + halfSize);
          ctx.lineTo(x + halfSize, y + halfSize);
        } else {
          // Pixel-perfect triangle
          const height = Math.floor(size * 0.866); // sqrt(3)/2
          
          // Draw filled triangle pixel by pixel
          for (let row = 0; row < height; row++) {
            const width = Math.floor((row + 1) * size / height);
            const startX = x - Math.floor(width / 2);
            for (let col = 0; col < width; col++) {
              ctx.fillRect(startX + col, y - Math.floor(height / 2) + row, 1, 1);
            }
          }
        }
        if (antiAliasing) {
          ctx.closePath();
          ctx.fill();
        }
        break;
    }
    
    ctx.restore();
  }, [getPixelCirclePattern]);
  
  const calculateSizeModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseSize: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedSize = baseSize * (1 + pressureEffect);
    
    // Apply min/max constraints from component
    return Math.max(
      params.minSize || 1,
      Math.min(params.maxSize || 1000, modifiedSize)
    );
  }, []);
  
  const calculateOpacityModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseOpacity: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence to opacity
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedOpacity = baseOpacity * (1 + pressureEffect);
    
    return Math.max(0, Math.min(1, modifiedOpacity));
  }, []);
  
  const calculatePressureEffects = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    settings: RenderSettings
  ): RenderSettings => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    const newSettings = { ...settings };
    
    // Apply pressure to size if enabled
    if (params.sizeInfluence) {
      const sizeEffect = (pressure - 0.5) * params.sizeInfluence;
      newSettings.size = Math.max(1, settings.size * (1 + sizeEffect));
    }
    
    // Apply pressure to opacity if enabled
    if (params.opacityInfluence) {
      const opacityEffect = (pressure - 0.5) * params.opacityInfluence;
      newSettings.opacity = Math.max(0, Math.min(1, settings.opacity * (1 + opacityEffect)));
    }
    
    return newSettings;
  }, []);
  
  const executeComponent = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    currentSettings: RenderSettings
  ): RenderSettings => {
    switch (component.type) {
      case ComponentType.SIZE_MODIFIER:
        return {
          ...currentSettings,
          size: calculateSizeModification(component, input, currentSettings.size)
        };
        
      case ComponentType.OPACITY_MODIFIER:
        return {
          ...currentSettings,
          opacity: calculateOpacityModification(component, input, currentSettings.opacity)
        };
        
      case ComponentType.PRESSURE_HANDLER:
        return calculatePressureEffects(component, input, currentSettings);
        
      case ComponentType.ANTI_ALIASING:
        return {
          ...currentSettings,
          antiAliasing: component.parameters.mode === 'antialiased',
          pixelAlignment: component.parameters.mode === 'pixel'
        };
        
      case ComponentType.SHAPE_RENDERER:
        return {
          ...currentSettings,
          shape: component.parameters.shape as BrushShape
        };
        
      default:
        return currentSettings;
    }
  }, [calculateSizeModification, calculateOpacityModification, calculatePressureEffects]);
  
  const executeComponents = useCallback((
    components: BrushComponent[], 
    input: StrokeInput
  ): RenderSettings => {
    const { brushSettings } = tools;
    
    // Start with base settings
    let settings: RenderSettings = {
      size: brushSettings.size,
      opacity: brushSettings.opacity,
      color: brushSettings.color,
      antiAliasing: brushSettings.antialiasing,
      pixelAlignment: !brushSettings.antialiasing,
      spacing: brushSettings.spacing,
      rotation: 0,
      shape: BrushShape.SQUARE // Default shape, will be overridden by components
    };
    
    // Sort components by priority
    const sortedComponents = components
      .filter(comp => comp.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    // Execute each component in order
    for (const component of sortedComponents) {
      settings = executeComponent(component, input, settings);
    }
    
    return settings;
  }, [tools, executeComponent]);
  
  
  const resetPixelQueue = useCallback(() => {
    pixelQueueRef.current = {
      lastDrawnX: 0,
      lastDrawnY: 0,
      waitingPixelX: 0,
      waitingPixelY: 0,
      initialized: false,
      spacingCounter: 0
    };
  }, []);


  const drawPixelPerfectLine = useCallback((
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    settings: RenderSettings
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines with spacing
    ctx.fillStyle = settings.color;
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    let stepCount = 0;
    
    while (true) {
      // Draw shape at position only if spacing allows
      if (stepCount % settings.spacing === 0) {
        drawShape(ctx, x, y, settings.size, settings.shape, false);
      }
      
      if (x === x1 && y === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      
      stepCount++;
    }
  }, [drawShape]);

  const perfectPixels = useCallback((
    ctx: CanvasRenderingContext2D,
    currentX: number,
    currentY: number,
    settings: RenderSettings
  ) => {
    const queue = pixelQueueRef.current;
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    
    ctx.fillStyle = settings.color;
    
    if (!queue.initialized) {
      // First pixel - initialize queue
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      queue.spacingCounter = 0;
      
      // Draw the first shape
      drawShape(ctx, roundedX, roundedY, settings.size, settings.shape, false);
      return;
    }
    
    // Increment spacing counter
    queue.spacingCounter++;
    
    // If current pixel not neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if spacing allows
      if (queue.spacingCounter % settings.spacing === 0) {
        drawShape(ctx, queue.waitingPixelX, queue.waitingPixelY, settings.size, settings.shape, false);
      }
      
      // Update queue
      queue.lastDrawnX = queue.waitingPixelX;
      queue.lastDrawnY = queue.waitingPixelY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    } else {
      // Update waiting pixel to current position
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    }
  }, [drawShape]);

  const renderBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    components: BrushComponent[] = activeBrushComponents
  ) => {
    const input: StrokeInput = {
      position: to,
      pressure: 0.5, // TODO: Get actual pressure from input device
      velocity: Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2)),
      timestamp: Date.now()
    };
    
    const settings = executeComponents(components, input);
    
    ctx.save();
    
    // Apply rendering settings
    ctx.globalAlpha = settings.opacity;
    ctx.lineWidth = settings.size;
    ctx.lineCap = settings.pixelAlignment ? 'butt' : 'round';
    ctx.lineJoin = settings.pixelAlignment ? 'miter' : 'round';
    
    // Handle tool-specific behavior
    if (tools.currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = tools.brushSettings.blendMode;
      ctx.strokeStyle = settings.color;
    }
    
    // Handle antialiasing and pixel-perfect drawing
    if (settings.pixelAlignment) {
      ctx.imageSmoothingEnabled = false;
      
      // Follow Tom Cantwell's exact algorithm
      const roundedFromX = Math.round(from.x);
      const roundedFromY = Math.round(from.y);
      const roundedToX = Math.round(to.x);
      const roundedToY = Math.round(to.y);
      
      // If movement is > 1 pixel, use line drawing
      if (Math.abs(roundedToX - roundedFromX) > 1 || Math.abs(roundedToY - roundedFromY) > 1) {
        // Fast movement - draw pixel-perfect line using shapes
        drawPixelPerfectLine(ctx, roundedFromX, roundedFromY, roundedToX, roundedToY, settings);
      } else {
        // Slow movement - use perfect pixel queue algorithm
        perfectPixels(ctx, to.x, to.y, settings);
      }
    } else {
      // For antialiased drawing, we need to draw shapes along the stroke path
      const distance = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
      const steps = Math.max(1, Math.ceil(distance / settings.spacing));
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        
        ctx.fillStyle = settings.color;
        drawShape(ctx, x, y, settings.size, settings.shape, true);
      }
    }
    
    ctx.restore();
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine, drawShape]);
  
  return {
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue
  };
};