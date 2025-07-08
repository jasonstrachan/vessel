'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType } from '../types';

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
}


export const useBrushEngine = () => {
  const { tools, activeBrushComponents } = useAppStore();
  
  // Pixel queue state for perfect pixel drawing
  const pixelQueueRef = useRef({
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    initialized: false
  });
  
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
      rotation: 0
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
      initialized: false
    };
  }, []);


  const drawPixelPerfectLine = useCallback((
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    size: number
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines
    ctx.fillStyle = color;
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    
    // Calculate offset to center the brush
    const offset = Math.floor(size / 2);
    
    while (true) {
      // Draw pixel with brush size, centered on position
      ctx.fillRect(x - offset, y - offset, size, size);
      
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
    }
  }, []);

  const perfectPixels = useCallback((
    ctx: CanvasRenderingContext2D,
    currentX: number,
    currentY: number,
    settings: RenderSettings
  ) => {
    const queue = pixelQueueRef.current;
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    
    // Calculate offset to center the brush
    const offset = Math.floor(settings.size / 2);
    
    if (!queue.initialized) {
      // First pixel - initialize queue
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      
      // Draw the first pixel with brush size, centered on position
      ctx.fillStyle = settings.color;
      ctx.fillRect(roundedX - offset, roundedY - offset, settings.size, settings.size);
      return;
    }
    
    // If current pixel not neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting pixel with brush size, centered on position
      ctx.fillStyle = settings.color;
      ctx.fillRect(queue.waitingPixelX - offset, queue.waitingPixelY - offset, settings.size, settings.size);
      
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
  }, []);

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
        // Fast movement - draw pixel-perfect line using individual pixels
        drawPixelPerfectLine(ctx, roundedFromX, roundedFromY, roundedToX, roundedToY, settings.color, settings.size);
      } else {
        // Slow movement - use perfect pixel queue algorithm
        perfectPixels(ctx, to.x, to.y, settings);
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    
    ctx.restore();
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine]);
  
  return {
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue
  };
};