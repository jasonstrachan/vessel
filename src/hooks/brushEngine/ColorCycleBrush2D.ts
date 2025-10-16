/**
 * ColorCycleBrush2D - Canvas 2D implementation of color cycling
 * Provides gradient-based color cycling without WebGL
 */

import type { Point } from './types';

/**
 * Color cycle layer for multi-layer gradient support
 */
interface ColorCycleLayer {
  layerId?: string;
  gradientStops: Array<{ position: number; color: string }>;
  indexBuffer: Uint8Array; // Index buffer for this layer (0-255 mapping)
  hasContent: boolean;
  globalAlpha: number;
}

/**
 * Stroke state tracking
 */
interface StrokeState {
  strokeCounter: number;
  strokeLength: number;
  lastPoint: Point | null;
  currentLayerIndex: number;
  gradientLayerIndices: number[]; // Track which gradient layers are used
}

/**
 * Animation state
 */
interface AnimationState {
  cycleOffset: number;
  cycleSpeed: number;
  fps: number;
  frameInterval: number;
  lastFrameTime: number;
  isAnimating: boolean;
  isPaused: boolean;
  animationFrameId?: number;
}

/**
 * Cached gradient data for performance
 */
interface CachedGradient {
  stops: Array<{ position: number; color: string }>;
  colorLUT: Uint8Array; // Pre-computed color lookup table (256 * 3 for RGB)
  lastCycleOffset: number;
}

/**
 * Canvas 2D implementation of color cycling brush
 */
export class ColorCycleBrush2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  
  // Brush settings
  private brushSize: number;
  
  // Multi-layer support
  private layers: ColorCycleLayer[] = [];
  private currentLayerIndex: number = -1;
  private layerIdToIndex: Map<string, number> = new Map();
  
  // Per-layer stroke tracking
  private layerStrokes: Map<string, StrokeState> = new Map();
  
  // Animation state
  private animationState: AnimationState;
  
  // Frame callback
  private onFrameRendered?: () => void;
  
  // Performance optimizations
  private gradientCache: Map<string, CachedGradient> = new Map();
  private needsRedraw: boolean = false;
  private compositeCanvas?: HTMLCanvasElement;
  private compositeCtx?: CanvasRenderingContext2D;
  
  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
  } = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { 
      alpha: true,
      willReadFrequently: true 
    });
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;
    
    // Create offscreen canvas for rendering
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = canvas.width;
    this.offscreenCanvas.height = canvas.height;
    const offCtx = this.offscreenCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: true
    });
    if (!offCtx) throw new Error('Could not get offscreen 2D context');
    this.offscreenCtx = offCtx;
    
    this.width = canvas.width;
    this.height = canvas.height;
    this.brushSize = options.brushSize || 20;
    
    // Initialize animation state
    this.animationState = {
      cycleOffset: 0,
      cycleSpeed: 1.0,
      fps: options.fps || 30,
      frameInterval: 1000 / (options.fps || 30),
      lastFrameTime: performance.now(),
      isAnimating: false,
      isPaused: true
    };
    
    // Create initial layer with default gradient
    this.addNewLayer(this.defaultGradient());
  }
  
  /**
   * Default rainbow gradient
   */
  private defaultGradient(): Array<{ position: number; color: string }> {
    return [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ];
  }
  
  /**
   * Add a new gradient layer
   */
  private addNewLayer(gradientStops: Array<{ position: number; color: string }>, layerId?: string) {
    // Create index buffer for this layer
    const indexBuffer = new Uint8Array(this.width * this.height);
    indexBuffer.fill(0);
    
    const newLayer: ColorCycleLayer = {
      layerId,
      gradientStops,
      indexBuffer,
      hasContent: false,
      globalAlpha: 1.0
    };
    
    const newIndex = this.layers.length;
    this.layers.push(newLayer);
    
    if (layerId) {
      this.layerIdToIndex.set(layerId, newIndex);
    }
    
    this.currentLayerIndex = newIndex;
    
    // Pre-cache gradient
    this.cacheGradient(gradientStops);
  }
  
  /**
   * Cache gradient for performance
   */
  private cacheGradient(stops: Array<{ position: number; color: string }>): CachedGradient {
    const key = this.getGradientKey(stops);
    
    if (this.gradientCache.has(key)) {
      return this.gradientCache.get(key)!;
    }
    
    // Create color lookup table
    const colorLUT = new Uint8Array(256 * 3); // RGB values for 256 positions
    
    for (let i = 0; i < 256; i++) {
      const position = i / 255;
      const color = this.interpolateGradientAtPosition(position, stops);
      colorLUT[i * 3] = color.r;
      colorLUT[i * 3 + 1] = color.g;
      colorLUT[i * 3 + 2] = color.b;
    }
    
    const cached: CachedGradient = {
      stops,
      colorLUT,
      lastCycleOffset: 0
    };
    
    this.gradientCache.set(key, cached);
    return cached;
  }
  
  /**
   * Generate unique key for gradient
   */
  private getGradientKey(stops: Array<{ position: number; color: string }>): string {
    return stops.map(s => `${s.position}:${s.color}`).join('|');
  }
  
  /**
   * Interpolate gradient at specific position (without cycle offset)
   */
  private interpolateGradientAtPosition(position: number, stops: Array<{ position: number; color: string }>): { r: number; g: number; b: number } {
    // Find surrounding stops
    let before = stops[0];
    let after = stops[stops.length - 1];
    
    for (let i = 0; i < stops.length - 1; i++) {
      if (position >= stops[i].position && position <= stops[i + 1].position) {
        before = stops[i];
        after = stops[i + 1];
        break;
      }
    }
    
    // Interpolate between colors
    const t = (position - before.position) / (after.position - before.position);
    const beforeRGB = this.hexToRgb(before.color);
    const afterRGB = this.hexToRgb(after.color);
    
    return {
      r: Math.round(beforeRGB.r + (afterRGB.r - beforeRGB.r) * t),
      g: Math.round(beforeRGB.g + (afterRGB.g - beforeRGB.g) * t),
      b: Math.round(beforeRGB.b + (afterRGB.b - beforeRGB.b) * t)
    };
  }
  
  /**
   * Create a gradient from stops
   */
  private createGradient(stops: Array<{ position: number; color: string }>, startX: number, startY: number, endX: number, endY: number): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(startX, startY, endX, endY);
    stops.forEach(stop => {
      gradient.addColorStop(stop.position, stop.color);
    });
    return gradient;
  }
  
  /**
   * Get color from index using cached LUT
   */
  private getColorFromIndex(index: number, stops: Array<{ position: number; color: string }>): string {
    const cached = this.cacheGradient(stops);
    
    // Apply cycle offset to index
    const cycledIndex = Math.floor((index + this.animationState.cycleOffset * 255) % 256);
    
    // Get RGB from LUT
    const r = cached.colorLUT[cycledIndex * 3];
    const g = cached.colorLUT[cycledIndex * 3 + 1];
    const b = cached.colorLUT[cycledIndex * 3 + 2];
    
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  /**
   * Convert hex color to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }
  
  /**
   * Get or create stroke state for a layer
   */
  private getOrCreateStrokeState(layerId: string): StrokeState {
    if (!this.layerStrokes.has(layerId)) {
      // Ensure we have a layer for this ID
      if (!this.layerIdToIndex.has(layerId)) {
        const currentGradient = this.currentLayerIndex >= 0
          ? this.layers[this.currentLayerIndex].gradientStops
          : this.defaultGradient();
        this.addNewLayer(currentGradient, layerId);
      }
      
      const layerIndex = this.layerIdToIndex.get(layerId)!;
      
      this.layerStrokes.set(layerId, {
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        currentLayerIndex: layerIndex,
        gradientLayerIndices: [layerIndex]
      });
    }
    return this.layerStrokes.get(layerId)!;
  }
  
  /**
   * Start a new stroke
   */
  startStroke(layerId?: string) {
    if (layerId) {
      const state = this.getOrCreateStrokeState(layerId);
      state.lastPoint = null;
      state.strokeCounter = 0;
      state.strokeLength = 0;
      this.currentLayerIndex = state.currentLayerIndex;
    } else {
      // Reset global stroke tracking
      this.layerStrokes.forEach(state => {
        state.lastPoint = null;
      });
    }
    
    this.animationState.isAnimating = true;
    this.animationState.isPaused = false;
  }
  
  /**
   * End the current stroke
   */
  endStroke(layerId?: string) {
    if (layerId && this.layerStrokes.has(layerId)) {
      const state = this.layerStrokes.get(layerId)!;
      state.lastPoint = null;
    }
  }
  
  /**
   * Paint at a position using index buffer system
   */
  paint(x: number, y: number, layerId?: string) {
    // Get appropriate stroke state
    const state = layerId ? this.getOrCreateStrokeState(layerId) : {
      strokeCounter: 0,
      strokeLength: 0,
      lastPoint: null,
      currentLayerIndex: this.currentLayerIndex,
      gradientLayerIndices: [this.currentLayerIndex]
    };
    
    if (state.currentLayerIndex < 0 || state.currentLayerIndex >= this.layers.length) {
      return;
    }
    
    const layer = this.layers[state.currentLayerIndex];
    
    // Calculate distance for gradient flow
    if (state.lastPoint) {
      const dx = x - state.lastPoint.x;
      const dy = y - state.lastPoint.y;
      state.strokeLength += Math.sqrt(dx * dx + dy * dy);
    } else {
      state.strokeCounter = 0;
      state.strokeLength = 0;
    }
    
    // Calculate index value (0-255) based on stroke length
    const gradientCycleLength = 200;
    const gradientPosition = 1.0 - ((state.strokeLength / gradientCycleLength) % 1.0);
    const indexValue = Math.floor(gradientPosition * 255);
    
    // Update index buffer for this position
    const halfSize = Math.floor(this.brushSize / 2);
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    
    // Write to index buffer (like WebGL paint buffer)
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = py * this.width + px;
        layer.indexBuffer[idx] = indexValue;
      }
    }
    
    // Mark layer as having content
    layer.hasContent = true;
    this.needsRedraw = true;
    
    // Update stroke state
    state.lastPoint = { x, y };
    
    if (layerId) {
      this.layerStrokes.set(layerId, state);
    }
    
    // Render immediately for responsive feedback
    this.renderLayer(state.currentLayerIndex);
  }
  
  /**
   * Render a specific layer using index buffer
   */
  private renderLayer(layerIndex: number) {
    if (layerIndex < 0 || layerIndex >= this.layers.length) return;
    
    const layer = this.layers[layerIndex];
    if (!layer.hasContent) return;
    
    // Create ImageData for this layer
    const imageData = this.offscreenCtx.createImageData(this.width, this.height);
    const data = imageData.data;
    
    // Use cached gradient LUT
    const cached = this.cacheGradient(layer.gradientStops);
    
    // Convert index buffer to RGB using LUT
    for (let i = 0; i < layer.indexBuffer.length; i++) {
      const index = layer.indexBuffer[i];
      if (index === 0) continue; // Skip empty pixels
      
      // Apply cycle offset to index
      const cycledIndex = Math.floor((index + this.animationState.cycleOffset * 255) % 256);
      
      // Get color from LUT
      const pixelIndex = i * 4;
      data[pixelIndex] = cached.colorLUT[cycledIndex * 3];
      data[pixelIndex + 1] = cached.colorLUT[cycledIndex * 3 + 1];
      data[pixelIndex + 2] = cached.colorLUT[cycledIndex * 3 + 2];
      data[pixelIndex + 3] = index > 0 ? 255 : 0; // Alpha based on whether pixel was painted
    }
    
    // Draw to offscreen canvas
    this.offscreenCtx.putImageData(imageData, 0, 0);
    
    // Composite to main canvas
    this.ctx.save();
    this.ctx.globalAlpha = layer.globalAlpha;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    this.ctx.restore();
  }
  
  /**
   * Fill a shape with gradient
   */
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string) {
    if (!vertices || vertices.length < 3) return;
    
    const state = layerId ? this.getOrCreateStrokeState(layerId) : {
      strokeCounter: 0,
      strokeLength: 0,
      lastPoint: null,
      currentLayerIndex: this.currentLayerIndex
    };
    
    if (state.currentLayerIndex < 0) return;
    
    const layer = this.layers[state.currentLayerIndex];
    
    // Calculate bounds and center
    let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
    vertices.forEach(v => {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const maxDistance = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2;
    
    // Create radial gradient from center to edges
    const gradient = this.ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, maxDistance
    );
    
    // Apply gradient stops with cycle offset
    layer.gradientStops.forEach(stop => {
      const position = (stop.position + this.animationState.cycleOffset) % 1.0;
      gradient.addColorStop(position, stop.color);
    });
    
    // Draw the filled shape
    this.ctx.save();
    this.ctx.globalAlpha = layer.globalAlpha;
    this.ctx.fillStyle = gradient;
    
    this.ctx.beginPath();
    this.ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      this.ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    this.ctx.closePath();
    this.ctx.fill();
    
    this.ctx.restore();
    
    layer.hasContent = true;
  }
  
  /**
   * Update animation with requestAnimationFrame
   */
  updateAnimation() {
    if (this.animationState.isAnimating && !this.animationState.isPaused) {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.animationState.lastFrameTime;
      
      if (deltaTime >= this.animationState.frameInterval) {
        // Update cycle offset
        this.animationState.cycleOffset += (deltaTime / 1000) * this.animationState.cycleSpeed * 0.2;
        this.animationState.cycleOffset = this.animationState.cycleOffset % 1.0;
        this.animationState.lastFrameTime = currentTime - (deltaTime % this.animationState.frameInterval);
        
        // Mark for redraw
        this.needsRedraw = true;
        
        // Render all layers with new cycle offset
        this.renderAllLayers();
        
        if (this.onFrameRendered) {
          this.onFrameRendered();
        }
      }
    }
  }
  
  /**
   * Start animation loop with requestAnimationFrame
   */
  private startAnimationLoop() {
    const animate = () => {
      this.updateAnimation();
      
      if (this.animationState.isAnimating && !this.animationState.isPaused) {
        this.animationState.animationFrameId = requestAnimationFrame(animate);
      }
    };
    
    this.animationState.animationFrameId = requestAnimationFrame(animate);
  }
  
  /**
   * Stop animation loop
   */
  private stopAnimationLoop() {
    if (this.animationState.animationFrameId) {
      cancelAnimationFrame(this.animationState.animationFrameId);
      this.animationState.animationFrameId = undefined;
    }
  }
  
  /**
   * Render all layers with current animation state
   */
  private renderAllLayers() {
    if (!this.needsRedraw) return;
    
    // Clear main canvas
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Render each layer
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer.hasContent) continue;
      
      // Render to offscreen canvas
      this.renderLayerToOffscreen(i);
      
      // Composite to main canvas
      this.ctx.save();
      this.ctx.globalAlpha = layer.globalAlpha;
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);
      this.ctx.restore();
    }
    
    this.needsRedraw = false;
  }
  
  /**
   * Render layer to offscreen canvas using index buffer
   */
  private renderLayerToOffscreen(layerIndex: number) {
    const layer = this.layers[layerIndex];
    if (!layer.hasContent) return;
    
    // Create ImageData
    const imageData = this.offscreenCtx.createImageData(this.width, this.height);
    const data = imageData.data;
    
    // Use cached gradient LUT
    const cached = this.cacheGradient(layer.gradientStops);
    
    // Process index buffer with cycle animation
    for (let i = 0; i < layer.indexBuffer.length; i++) {
      const index = layer.indexBuffer[i];
      if (index === 0) continue; // Skip unpainted pixels
      
      // Apply cycle offset for animation
      const cycledIndex = Math.floor((index + this.animationState.cycleOffset * 255) % 256);
      
      // Set pixel color from LUT
      const pixelIndex = i * 4;
      data[pixelIndex] = cached.colorLUT[cycledIndex * 3];
      data[pixelIndex + 1] = cached.colorLUT[cycledIndex * 3 + 1];
      data[pixelIndex + 2] = cached.colorLUT[cycledIndex * 3 + 2];
      data[pixelIndex + 3] = 255; // Full opacity for painted pixels
    }
    
    // Put image data to offscreen canvas
    this.offscreenCtx.putImageData(imageData, 0, 0);
  }
  
  /**
   * Render to target canvas
   */
  renderDirectToCanvas(targetCanvas: HTMLCanvasElement, layerId?: string) {
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) return;
    
    // Clear and render
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    
    if (layerId) {
      // Render specific layer
      const layerIndex = this.layerIdToIndex.get(layerId);
      if (layerIndex !== undefined) {
        const layer = this.layers[layerIndex];
        if (layer.hasContent) {
          targetCtx.drawImage(this.canvas, 0, 0);
        }
      }
    } else {
      // Render all layers
      targetCtx.drawImage(this.canvas, 0, 0);
    }
  }
  
  /**
   * Set gradient for current or new layer
   */
  setGradient(stops: Array<{ position: number; color: string }>, layerId?: string) {
    if (layerId) {
      const state = this.getOrCreateStrokeState(layerId);
      const layer = this.layers[state.currentLayerIndex];
      layer.gradientStops = stops;
    } else {
      // Check if we need a new layer
      if (this.currentLayerIndex >= 0) {
        const currentLayer = this.layers[this.currentLayerIndex];
        if (currentLayer.hasContent) {
          this.addNewLayer(stops);
        } else {
          currentLayer.gradientStops = stops;
        }
      } else {
        this.addNewLayer(stops);
      }
    }
  }
  
  /**
   * Animation control methods
   */
  startAnimation() {
    if (!this.animationState.isAnimating) {
      this.animationState.isAnimating = true;
      this.animationState.isPaused = false;
      this.animationState.lastFrameTime = performance.now();
      this.startAnimationLoop();
    }
  }
  
  stopAnimation() {
    this.animationState.isAnimating = false;
    this.animationState.isPaused = false;
    this.stopAnimationLoop();
  }
  
  pauseAnimation() {
    this.animationState.isPaused = true;
    this.stopAnimationLoop();
  }
  
  resumeAnimation() {
    if (this.animationState.isAnimating) {
      this.animationState.isPaused = false;
      this.animationState.lastFrameTime = performance.now();
      this.startAnimationLoop();
    }
  }
  
  isPlaying(): boolean {
    return this.animationState.isAnimating && !this.animationState.isPaused;
  }
  
  setPlaying(play: boolean) {
    if (play) {
      if (!this.animationState.isAnimating) {
        this.startAnimation();
      } else {
        this.resumeAnimation();
      }
    } else {
      this.pauseAnimation();
    }
  }
  
  /**
   * Force render without animation
   */
  render() {
    this.needsRedraw = true;
    this.renderAllLayers();
  }
  
  /**
   * Settings
   */
  setBrushSize(size: number) {
    this.brushSize = size;
  }
  
  setSpeed(speed: number) {
    this.animationState.cycleSpeed = speed;
  }
  
  setFPS(fps: number) {
    this.animationState.fps = fps;
    this.animationState.frameInterval = 1000 / fps;
  }
  
  setOnFrameRendered(callback: () => void) {
    this.onFrameRendered = callback;
  }
  
  /**
   * Clear operations
   */
  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.offscreenCtx.clearRect(0, 0, this.width, this.height);
    
    this.layers.forEach(layer => {
      layer.hasContent = false;
      layer.indexBuffer.fill(0);
    });
    
    this.layerStrokes.clear();
    this.needsRedraw = true;
  }
  
  clearLayer(layerId?: string) {
    if (!layerId) {
      this.clear();
      return;
    }
    
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex !== undefined && layerIndex < this.layers.length) {
      const layer = this.layers[layerIndex];
      layer.hasContent = false;
      layer.indexBuffer.fill(0);
    }
    
    this.layerStrokes.delete(layerId);
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * State management for undo/redo
   */
  createSnapshot(layerId: string): ArrayBuffer {
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex === undefined || layerIndex >= this.layers.length) {
      return new ArrayBuffer(0);
    }
    
    const layer = this.layers[layerIndex];
    
    // Create snapshot with metadata and index buffer
    const metadataSize = 32;
    const totalSize = metadataSize + layer.indexBuffer.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // Write metadata
    let offset = 0;
    const state = this.layerStrokes.get(layerId);
    if (state) {
      view.setUint32(offset, state.strokeCounter, true); offset += 4;
      view.setFloat32(offset, state.strokeLength, true); offset += 4;
      view.setUint32(offset, state.currentLayerIndex, true); offset += 4;
      view.setUint32(offset, state.gradientLayerIndices.length, true); offset += 4;
    } else {
      view.setUint32(offset, 0, true); offset += 4;
      view.setFloat32(offset, 0, true); offset += 4;
      view.setUint32(offset, layerIndex, true); offset += 4;
      view.setUint32(offset, 1, true); offset += 4;
    }
    
    // Copy index buffer
    const outputArray = new Uint8Array(buffer, metadataSize);
    outputArray.set(layer.indexBuffer);
    
    return buffer;
  }
  
  restoreSnapshot(layerId: string, snapshot: ArrayBuffer) {
    if (snapshot.byteLength === 0) {
      this.clearLayer(layerId);
      return;
    }
    
    const view = new DataView(snapshot);
    const metadataSize = 32;
    
    // Read metadata
    let offset = 0;
    const strokeCounter = view.getUint32(offset, true); offset += 4;
    const strokeLength = view.getFloat32(offset, true); offset += 4;
    const currentLayerIndex = view.getUint32(offset, true); offset += 4;
    const gradientLayerIndicesCount = view.getUint32(offset, true); offset += 4;
    
    // Ensure layer exists
    if (!this.layerIdToIndex.has(layerId)) {
      const currentGradient = this.currentLayerIndex >= 0
        ? this.layers[this.currentLayerIndex].gradientStops
        : this.defaultGradient();
      this.addNewLayer(currentGradient, layerId);
    }
    
    const layerIndex = this.layerIdToIndex.get(layerId)!;
    const layer = this.layers[layerIndex];
    
    // Restore stroke state
    this.layerStrokes.set(layerId, {
      strokeCounter,
      strokeLength,
      lastPoint: null,
      currentLayerIndex,
      gradientLayerIndices: Array(gradientLayerIndicesCount).fill(0).map((_, i) => currentLayerIndex + i)
    });
    
    // Restore index buffer
    const indexData = new Uint8Array(snapshot, metadataSize);
    if (indexData.length === layer.indexBuffer.length) {
      layer.indexBuffer.set(indexData);
      layer.hasContent = indexData.some(v => v > 0);
    }
    
    // Trigger redraw
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * Utility methods
   */
  resize(width: number, height: number) {
    const oldWidth = this.width;
    const oldHeight = this.height;
    
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    
    // Resize offscreen canvas
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    
    // Recreate index buffers with new size
    this.layers.forEach(layer => {
      const newBuffer = new Uint8Array(width * height);
      
      // Copy old data (preserve what fits)
      const copyWidth = Math.min(oldWidth, width);
      const copyHeight = Math.min(oldHeight, height);
      
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const oldIdx = y * oldWidth + x;
          const newIdx = y * width + x;
          newBuffer[newIdx] = layer.indexBuffer[oldIdx];
        }
      }
      
      layer.indexBuffer = newBuffer;
    });
    
    this.needsRedraw = true;
    this.render();
  }
  
  hasContent(): boolean {
    return this.layers.some(layer => layer.hasContent);
  }
  
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  
  destroy() {
    // Stop animation
    this.stopAnimation();
    
    // Clear canvases
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.offscreenCtx.clearRect(0, 0, this.width, this.height);
    
    // Clean up resources
    this.layers = [];
    this.layerStrokes.clear();
    this.layerIdToIndex.clear();
    this.gradientCache.clear();
    
    // Remove composite canvas if created
    if (this.compositeCanvas) {
      this.compositeCanvas = undefined;
      this.compositeCtx = undefined;
    }
  }
  
  /**
   * Get memory statistics
   */
  getMemoryStats(): {
    layerCount: number;
    totalIndexBufferSize: number;
    gradientCacheSize: number;
    estimatedTotalMemory: number;
  } {
    let totalIndexBufferSize = 0;
    
    // Calculate index buffer sizes
    this.layers.forEach(layer => {
      totalIndexBufferSize += layer.indexBuffer.byteLength;
    });
    
    // Calculate gradient cache size
    const gradientCacheSize = this.gradientCache.size * 256 * 3; // Each gradient has 256 * 3 bytes
    
    const estimatedTotalMemory = totalIndexBufferSize + gradientCacheSize;
    
    return {
      layerCount: this.layers.length,
      totalIndexBufferSize,
      gradientCacheSize,
      estimatedTotalMemory
    };
  }
}