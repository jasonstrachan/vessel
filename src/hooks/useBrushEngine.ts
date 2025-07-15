'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType, BrushShape, CustomBrush } from '../types';

export interface StrokeInput {
  position: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  direction?: number; // Angle in radians from movement vector
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
  pattern?: ImageData;
  centerAlignment?: boolean;
}


export const useBrushEngine = () => {
  const { tools, activeBrushComponents, project, brushPresets } = useAppStore();
  
  // Pixel queue state for perfect pixel drawing with distance-based spacing
  const pixelQueueRef = useRef({
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    initialized: false,
    spacingCounter: 0,
    // Distance-based spacing state
    accumulatedDistance: 0,
    lastStrokePosition: { x: 0, y: 0 }
  });

  // Direction smoothing for rotation
  const directionHistoryRef = useRef<number[]>([]);
  const lastDirectionRef = useRef<number>(0);

  // Calculate and smooth direction from movement vector
  const calculateSmoothDirection = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): number => {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Get current pressure to detect stylus vs mouse input
    const cursorPressure = useAppStore.getState().canvas.cursor.pressure ?? 1.0;
    const isStylusInput = cursorPressure < 0.98; // Stylus typically has variable pressure
    
    // Adaptive smoothing based on input type
    const minDistance = isStylusInput ? 1.5 : 3; // Stylus: more responsive, Mouse: more filtered
    const historySize = isStylusInput ? 4 : 7; // Stylus: shorter history, Mouse: longer history
    
    // If movement is very small, keep last direction to avoid jitter
    if (distance < minDistance) {
      return lastDirectionRef.current;
    }
    
    // Calculate direction angle (radians)
    const direction = Math.atan2(deltaY, deltaX);
    
    // Add to history for smoothing
    directionHistoryRef.current.push(direction);
    
    // Keep adaptive history size
    if (directionHistoryRef.current.length > historySize) {
      directionHistoryRef.current.shift();
    }
    
    // Smooth direction using weighted average with adaptive weights
    let smoothedDirection = direction;
    if (directionHistoryRef.current.length > 1) {
      // Adaptive weight distribution based on input type
      const weights = isStylusInput 
        ? [0.45, 0.30, 0.20, 0.05] // Stylus: more emphasis on recent directions
        : [0.25, 0.20, 0.18, 0.15, 0.12, 0.07, 0.03]; // Mouse: gradual smoothing
      
      let weightSum = 0;
      let sinSum = 0;
      let cosSum = 0;
      
      // Use circular averaging to handle angle wraparound properly
      for (let i = 0; i < directionHistoryRef.current.length; i++) {
        const weight = weights[directionHistoryRef.current.length - 1 - i] || 0.02;
        const angle = directionHistoryRef.current[i];
        sinSum += Math.sin(angle) * weight;
        cosSum += Math.cos(angle) * weight;
        weightSum += weight;
      }
      
      // Convert back to angle using atan2 for proper quadrant
      smoothedDirection = Math.atan2(sinSum / weightSum, cosSum / weightSum);
    }
    
    // Apply adaptive final smoothing
    if (lastDirectionRef.current !== 0) {
      let angleDiff = smoothedDirection - lastDirectionRef.current;
      
      // Normalize angle difference to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      // Adaptive smoothing factor: stylus more responsive, mouse smoother
      const smoothingFactor = isStylusInput ? 0.35 : 0.15;
      smoothedDirection = lastDirectionRef.current + angleDiff * smoothingFactor;
    }
    
    lastDirectionRef.current = smoothedDirection;
    return smoothedDirection;
  }, []);

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
    antiAliasing: boolean,
    rotation: number = 0,
    pattern?: ImageData,
    centerAlignment?: boolean
  ) => {
    const halfSize = size / 2;
    
    ctx.save();
    
    if (!antiAliasing) {
      ctx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      x = Math.round(x);
      y = Math.round(y);
    }
    
    // Apply rotation if specified
    if (rotation !== 0) {
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.translate(-x, -y);
    }
    
    // Handle custom pattern rendering
    if (pattern && pattern.width > 0 && pattern.height > 0) {
      
      // Create temporary canvas for pattern
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pattern.width;
      tempCanvas.height = pattern.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (tempCtx) {
        try {
          tempCtx.putImageData(pattern, 0, 0);
          
          // Use pattern at original pixel size
          const scaledWidth = pattern.width;
          const scaledHeight = pattern.height;
          
          // Calculate position based on alignment
          let drawX = x;
          let drawY = y;
          
          if (centerAlignment) {
            drawX = x - scaledWidth / 2;
            drawY = y - scaledHeight / 2;
          }
          
          // Draw the pattern at original size
          ctx.drawImage(tempCanvas, drawX, drawY);
        } catch (error) {
          console.error('Pattern rendering failed:', error);
        }
      }
    } else {
      // Original shape rendering
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
            const pixelPattern = getPixelCirclePattern(size);
            const offsetX = x - Math.floor(size / 2);
            const offsetY = y - Math.floor(size / 2);
            
            pixelPattern.forEach(pixel => {
              ctx.fillRect(offsetX + pixel.x, offsetY + pixel.y, 1, 1);
            });
          } else {
            // Use pixel-perfect circle patterns for pixel mode
            const pixelPattern = getPixelCirclePattern(size);
            const offsetX = x - Math.floor(size / 2);
            const offsetY = y - Math.floor(size / 2);
            
            pixelPattern.forEach(pixel => {
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
        
      case ComponentType.PATTERN_RENDERER:
        const pattern = component.parameters.pattern as ImageData;
        const centerAlignment = component.parameters.centerAlignment as boolean;
        return {
          ...currentSettings,
          pattern,
          centerAlignment
        };
        
      case ComponentType.ROTATION_TRANSFORM:
        // Apply rotation based on movement direction if enabled
        const { brushSettings } = tools;
        if (!brushSettings.rotationEnabled || input.direction === undefined) {
          return currentSettings;
        }
        return {
          ...currentSettings,
          rotation: input.direction
        };
        
      default:
        return currentSettings;
    }
  }, [calculateSizeModification, calculateOpacityModification, calculatePressureEffects]);
  
  const executeComponents = useCallback((
    components: BrushComponent[], 
    input: StrokeInput
  ): RenderSettings => {
    const { brushSettings, currentTool } = tools;
    // Always use brush settings for both brush and eraser - eraser inherits brush properties
    const activeSettings = brushSettings;
    
    // Apply pressure-based size modification if enabled
    let finalSize = activeSettings.size;
    if (activeSettings.pressureEnabled) {
      // Map pressure (0.0-1.0) to size range based on maxPressure setting
      // maxPressure directly sets the max pixel size at full pressure
      const minSizePx = 1;
      const maxSizePx = activeSettings.maxPressure;
      finalSize = minSizePx + (input.pressure * (maxSizePx - minSizePx));
    }
    
    // Start with base settings
    let settings: RenderSettings = {
      size: finalSize,
      opacity: activeSettings.opacity,
      color: activeSettings.color,
      antiAliasing: activeSettings.antialiasing,
      pixelAlignment: !activeSettings.antialiasing,
      spacing: activeSettings.spacing,
      rotation: activeSettings.rotationEnabled && input.direction !== undefined ? input.direction : 0,
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
      spacingCounter: 0,
      // Reset distance-based spacing state
      accumulatedDistance: 0,
      lastStrokePosition: { x: 0, y: 0 }
    };
    // Reset direction history for rotation
    directionHistoryRef.current = [];
    lastDirectionRef.current = 0;
  }, []);


  const drawPixelPerfectLine = useCallback((
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    settings: RenderSettings
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines with distance-based spacing
    ctx.fillStyle = settings.color;
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    let lastX = x0;
    let lastY = y0;
    
    // Use queue's accumulated distance for consistent spacing
    const queue = pixelQueueRef.current;
    
    while (true) {
      // Calculate distance from last position
      const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
      queue.accumulatedDistance += distance;
      
      // Draw shape at position only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        drawShape(ctx, x, y, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
        queue.accumulatedDistance -= settings.spacing;
      }
      
      if (x === x1 && y === y1) break;
      
      lastX = x;
      lastY = y;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
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
      // First pixel - initialize queue with distance-based state
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      queue.spacingCounter = 0;
      queue.lastStrokePosition = { x: roundedX, y: roundedY };
      queue.accumulatedDistance = 0;
      
      // Draw the first shape
      drawShape(ctx, roundedX, roundedY, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
      return;
    }
    
    // Calculate distance from last stroke position to current position
    const distance = Math.sqrt(
      Math.pow(roundedX - queue.lastStrokePosition.x, 2) + 
      Math.pow(roundedY - queue.lastStrokePosition.y, 2)
    );
    queue.accumulatedDistance += distance;
    
    // If current pixel not neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        drawShape(ctx, queue.waitingPixelX, queue.waitingPixelY, settings.size, settings.shape, false, settings.rotation, settings.pattern, settings.centerAlignment);
        queue.accumulatedDistance -= settings.spacing;
        queue.lastStrokePosition = { x: queue.waitingPixelX, y: queue.waitingPixelY };
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
    
    // Update last stroke position for distance calculation
    queue.lastStrokePosition = { x: roundedX, y: roundedY };
  }, [drawShape]);

  // Reusable canvas for custom brush stamps to avoid creating new elements
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const getTempCanvas = useCallback((width: number, height: number) => {
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement('canvas');
    }
    const canvas = tempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas;
  }, []);

  // Custom brush drawing functions
  const drawCustomBrushStamp = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, customBrush: CustomBrush, scale: number = 1, rotation: number = 0) => {
    const canvas = getTempCanvas(customBrush.width, customBrush.height);
    const tempCtx = canvas.getContext('2d');
    if (!tempCtx) return;
    
    // Clear and set up canvas with brush dimensions
    tempCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Put the brush ImageData onto the temporary canvas
    tempCtx.putImageData(customBrush.imageData, 0, 0);
    
    // Calculate scaled dimensions and position
    const scaledWidth = customBrush.width * scale;
    const scaledHeight = customBrush.height * scale;
    const centerX = x - scaledWidth / 2;
    const centerY = y - scaledHeight / 2;
    
    // Draw the custom brush with rotation
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false; // Maintain pixel-perfect rendering
    
    // Apply rotation if specified
    if (rotation !== 0) {
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.translate(-x, -y);
    }
    
    ctx.drawImage(canvas, centerX, centerY, scaledWidth, scaledHeight);
    ctx.restore();
  }, [getTempCanvas]);

  const drawCustomBrushLine = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, customBrush: CustomBrush, scale: number = 1, rotation: number = 0) => {
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const spacing = Math.max(1, Math.min(customBrush.width, customBrush.height) * scale * 0.5);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      drawCustomBrushStamp(ctx, x, y, customBrush, scale, rotation);
    }
  }, [drawCustomBrushStamp]);

  const renderBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    components: BrushComponent[] = activeBrushComponents
  ) => {
    // Get actual pressure from cursor state in the store
    const cursorPressure = useAppStore.getState().canvas.cursor.pressure ?? 1.0;
    
    // Calculate smooth direction for rotation
    const direction = calculateSmoothDirection(from, to);
    
    const input: StrokeInput = {
      position: to,
      pressure: cursorPressure,
      velocity: Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2)),
      timestamp: Date.now(),
      direction
    };
    
    const settings = executeComponents(components, input);
    
    ctx.save();
    
    // Initialize distance tracking state if needed
    const queue = pixelQueueRef.current;
    if (!queue.initialized) {
      queue.lastStrokePosition = { x: from.x, y: from.y };
      queue.accumulatedDistance = 0;
      queue.initialized = true;
    }
    
    // Apply rendering settings
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = settings.opacity;
    ctx.lineWidth = settings.size;
    ctx.lineCap = settings.pixelAlignment ? 'butt' : 'round';
    ctx.lineJoin = settings.pixelAlignment ? 'miter' : 'round';
    
    // Check for custom brush before regular tool handling
    const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
    
    // Look for custom brush in project's custom brushes first
    let customBrush = isCustomBrush && tools.brushSettings.selectedCustomBrush && project
      ? project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush)
      : null;
    
    // If not found in project custom brushes, check brush presets for custom brush presets
    if (!customBrush && isCustomBrush && tools.brushSettings.selectedCustomBrush) {
      const customBrushPreset = brushPresets.find(p => 
        p.id === tools.brushSettings.selectedCustomBrush && p.isCustomBrush && p.customBrushData
      );
      if (customBrushPreset?.customBrushData) {
        // Convert preset to custom brush format
        customBrush = {
          id: customBrushPreset.id,
          name: customBrushPreset.name,
          imageData: customBrushPreset.customBrushData.imageData,
          thumbnail: customBrushPreset.thumbnail,
          width: customBrushPreset.customBrushData.width,
          height: customBrushPreset.customBrushData.height,
          createdAt: customBrushPreset.createdAt.getTime()
        };
      }
    }
    
    
    // Handle custom brush rendering with spacing support
    if (isCustomBrush && customBrush) {
      // Scale custom brush based on brush size setting as percentage
      // Size 100 = 100% (original size), Size 50 = 50%, Size 200 = 200%
      const scaleFactor = settings.size / 100;
      
      // Apply spacing system to custom brushes
      const distance = Math.sqrt(Math.pow(to.x - queue.lastStrokePosition.x, 2) + Math.pow(to.y - queue.lastStrokePosition.y, 2));
      queue.accumulatedDistance += distance;
      
      // Draw custom brush stamps along the path only when accumulated distance exceeds spacing
      while (queue.accumulatedDistance >= settings.spacing) {
        // Calculate the position where we should place the next stamp
        const remaining = queue.accumulatedDistance - settings.spacing;
        const progress = (distance - remaining) / distance;
        const x = queue.lastStrokePosition.x + (to.x - queue.lastStrokePosition.x) * progress;
        const y = queue.lastStrokePosition.y + (to.y - queue.lastStrokePosition.y) * progress;
        
        drawCustomBrushStamp(ctx, x, y, customBrush, scaleFactor, settings.rotation);
        
        queue.accumulatedDistance -= settings.spacing;
      }
      
      // Update last stroke position for next call
      queue.lastStrokePosition = { x: to.x, y: to.y };
      
      ctx.restore();
      return; // Exit early for custom brushes
    }
    
    // Handle tool-specific behavior for regular brushes
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
      // For antialiased drawing, use distance-based spacing with accumulated distance
      const distance = Math.sqrt(Math.pow(to.x - queue.lastStrokePosition.x, 2) + Math.pow(to.y - queue.lastStrokePosition.y, 2));
      queue.accumulatedDistance += distance;
      
      // Draw shapes along the path only when accumulated distance exceeds spacing
      while (queue.accumulatedDistance >= settings.spacing) {
        // Calculate the position where we should place the next shape
        const remaining = queue.accumulatedDistance - settings.spacing;
        const progress = (distance - remaining) / distance;
        const x = queue.lastStrokePosition.x + (to.x - queue.lastStrokePosition.x) * progress;
        const y = queue.lastStrokePosition.y + (to.y - queue.lastStrokePosition.y) * progress;
        
        ctx.fillStyle = settings.color;
        drawShape(ctx, x, y, settings.size, settings.shape, true, settings.rotation, settings.pattern, settings.centerAlignment);
        
        queue.accumulatedDistance -= settings.spacing;
      }
    }
    
    // Update last stroke position for next call
    queue.lastStrokePosition = { x: to.x, y: to.y };
    
    ctx.restore();
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine, drawShape, project, brushPresets, drawCustomBrushLine, drawCustomBrushStamp]);
  
  return {
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue
  };
};