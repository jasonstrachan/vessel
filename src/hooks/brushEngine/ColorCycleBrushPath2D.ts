/**
 * ColorCycleBrushPath2D - High-performance Canvas 2D Path API implementation
 * Uses Canvas 2D Path for optimized stroke rendering with color cycling
 */

import type { Point } from './types';

/**
 * Path segment with gradient info
 */
interface PathSegment {
  path: Path2D;
  gradientIndex: number; // Index into gradient (0-255)
  strokeWidth: number;
  points: Point[]; // Original points for re-rendering
}

/**
 * Color cycle layer with path-based rendering
 */
interface ColorCycleLayer {
  layerId?: string;
  gradientStops: Array<{ position: number; color: string }>;
  pathSegments: PathSegment[]; // Store paths instead of pixel buffer
  hasContent: boolean;
  globalAlpha: number;
  // Dirty region tracking
  dirtyBounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

/**
 * Stroke state for path building
 */
interface StrokeState {
  strokeLength: number;
  lastPoint: Point | null;
  currentPath: Path2D | null;
  currentPoints: Point[];
  currentLayerIndex: number;
  gradientLayerIndices: number[];
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
 * Gradient cache with pre-rendered canvases
 */
interface CachedGradient {
  stops: Array<{ position: number; color: string }>;
  colorLUT: Uint8Array; // Color lookup table
  patternCanvas?: HTMLCanvasElement; // Pre-rendered gradient pattern
  lastCycleOffset: number;
  canvasGradient?: CanvasGradient; // Cached CanvasGradient object
}

interface SerializedPathSegmentData {
  gradientIndex: number;
  strokeWidth: number;
  points: Point[];
}

interface SerializedLayerData {
  gradientStops: Array<{ position: number; color: string }>;
  pathSegments: SerializedPathSegmentData[];
}

/**
 * High-performance Canvas 2D Path implementation
 */
export class ColorCycleBrushPath2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  
  // Brush settings
  private brushSize: number;
  private strokeSmoothing: number = 0.5; // Path smoothing factor
  
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
  private frameThrottleTimer?: number;
  
  // Batch path operations
  private pathBatchTimer?: number;
  private pendingPaths: Array<{layerIndex: number; segment: PathSegment}> = [];
  
  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
  } = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { 
      alpha: true,
      desynchronized: true // Better performance for animations
    });
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;
    
    // Create offscreen canvas for compositing
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = canvas.width;
    this.offscreenCanvas.height = canvas.height;
    const offCtx = this.offscreenCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true
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
    
    // Create initial layer
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
    const newLayer: ColorCycleLayer = {
      layerId,
      gradientStops,
      pathSegments: [],
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
   * Cache gradient with pre-rendered canvas for performance
   */
  private cacheGradient(stops: Array<{ position: number; color: string }>): CachedGradient {
    const key = this.getGradientKey(stops);
    
    if (this.gradientCache.has(key)) {
      return this.gradientCache.get(key)!;
    }
    
    // Create color lookup table
    const colorLUT = new Uint8Array(256 * 3);
    
    for (let i = 0; i < 256; i++) {
      const position = i / 255;
      const color = this.interpolateGradientAtPosition(position, stops);
      colorLUT[i * 3] = color.r;
      colorLUT[i * 3 + 1] = color.g;
      colorLUT[i * 3 + 2] = color.b;
    }
    
    // Create pre-rendered gradient pattern canvas
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 256;
    patternCanvas.height = 1;
    const patternCtx = patternCanvas.getContext('2d');
    
    if (patternCtx) {
      const gradient = patternCtx.createLinearGradient(0, 0, 256, 0);
      stops.forEach(stop => {
        gradient.addColorStop(stop.position, stop.color);
      });
      patternCtx.fillStyle = gradient;
      patternCtx.fillRect(0, 0, 256, 1);
    }
    
    const cached: CachedGradient = {
      stops,
      colorLUT,
      patternCanvas,
      lastCycleOffset: 0
    };
    
    this.gradientCache.set(key, cached);
    return cached;
  }
  
  /**
   * Create canvas gradient for stroke
   */
  private createStrokeGradient(stops: Array<{ position: number; color: string }>, start: Point, end: Point): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    
    // Apply cycle offset to gradient stops
    stops.forEach(stop => {
      const position = (stop.position + this.animationState.cycleOffset) % 1.0;
      gradient.addColorStop(position, stop.color);
    });
    
    return gradient;
  }
  
  /**
   * Get color from gradient index
   */
  private getColorFromIndex(index: number, stops: Array<{ position: number; color: string }>): string {
    const cached = this.cacheGradient(stops);
    
    // Apply cycle offset
    const cycledIndex = Math.floor((index + this.animationState.cycleOffset * 255) % 256);
    
    const r = cached.colorLUT[cycledIndex * 3];
    const g = cached.colorLUT[cycledIndex * 3 + 1];
    const b = cached.colorLUT[cycledIndex * 3 + 2];
    
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  /**
   * Generate unique key for gradient
   */
  private getGradientKey(stops: Array<{ position: number; color: string }>): string {
    return stops.map(s => `${s.position}:${s.color}`).join('|');
  }
  
  /**
   * Interpolate gradient at position
   */
  private interpolateGradientAtPosition(position: number, stops: Array<{ position: number; color: string }>): { r: number; g: number; b: number } {
    let before = stops[0];
    let after = stops[stops.length - 1];
    
    for (let i = 0; i < stops.length - 1; i++) {
      if (position >= stops[i].position && position <= stops[i + 1].position) {
        before = stops[i];
        after = stops[i + 1];
        break;
      }
    }
    
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
   * Convert hex to RGB
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
   * Get or create stroke state
   */
  private getOrCreateStrokeState(layerId: string): StrokeState {
    if (!this.layerStrokes.has(layerId)) {
      if (!this.layerIdToIndex.has(layerId)) {
        const currentGradient = this.currentLayerIndex >= 0
          ? this.layers[this.currentLayerIndex].gradientStops
          : this.defaultGradient();
        this.addNewLayer(currentGradient, layerId);
      }
      
      const layerIndex = this.layerIdToIndex.get(layerId)!;
      
      this.layerStrokes.set(layerId, {
        strokeLength: 0,
        lastPoint: null,
        currentPath: null,
        currentPoints: [],
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
      state.strokeLength = 0;
      state.currentPath = new Path2D();
      state.currentPoints = [];
      this.currentLayerIndex = state.currentLayerIndex;
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
      
      // Save the completed path
      if (state.currentPath && state.currentPoints.length > 0) {
        const layer = this.layers[state.currentLayerIndex];
        
        // Calculate gradient index based on stroke length
        const gradientPosition = 1.0 - ((state.strokeLength / 200) % 1.0);
        const gradientIndex = Math.floor(gradientPosition * 255);
        
        // Store path segment
        layer.pathSegments.push({
          path: state.currentPath,
          gradientIndex,
          strokeWidth: this.brushSize,
          points: [...state.currentPoints]
        });
        
        layer.hasContent = true;
        
        // Update dirty bounds
        this.updateDirtyBounds(layer, state.currentPoints);
      }
      
      state.lastPoint = null;
      state.currentPath = null;
      state.currentPoints = [];
    }
    
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * Update dirty region bounds
   */
  private updateDirtyBounds(layer: ColorCycleLayer, points: Point[]) {
    if (points.length === 0) return;
    
    const bounds = layer.dirtyBounds || {
      minX: this.width,
      minY: this.height,
      maxX: 0,
      maxY: 0
    };
    
    points.forEach(p => {
      bounds.minX = Math.min(bounds.minX, p.x - this.brushSize);
      bounds.minY = Math.min(bounds.minY, p.y - this.brushSize);
      bounds.maxX = Math.max(bounds.maxX, p.x + this.brushSize);
      bounds.maxY = Math.max(bounds.maxY, p.y + this.brushSize);
    });
    
    layer.dirtyBounds = bounds;
  }
  
  /**
   * Paint using Path2D API with stroke smoothing
   */
  paint(x: number, y: number, layerId?: string) {
    const state = layerId ? this.getOrCreateStrokeState(layerId) : {
      strokeLength: 0,
      lastPoint: null,
      currentPath: new Path2D(),
      currentPoints: [],
      currentLayerIndex: this.currentLayerIndex,
      gradientLayerIndices: [this.currentLayerIndex]
    };
    
    if (state.currentLayerIndex < 0 || state.currentLayerIndex >= this.layers.length) {
      return;
    }
    
    const layer = this.layers[state.currentLayerIndex];
    
    // Initialize path if needed
    if (!state.currentPath) {
      state.currentPath = new Path2D();
      state.currentPoints = [];
    }
    
    // Add to path with optimized curve generation
    if (!state.lastPoint) {
      state.currentPath.moveTo(x, y);
    } else {
      // Calculate distance for gradient progression
      const dx = x - state.lastPoint.x;
      const dy = y - state.lastPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      state.strokeLength += distance;
      
      // Skip points that are too close (optimization)
      if (distance < 1) {
        return;
      }
      
      // Use bezier curves for smoother strokes
      if (state.currentPoints.length > 2) {
        const prevPoint = state.currentPoints[state.currentPoints.length - 2];
        const cp1x = state.lastPoint.x + (prevPoint.x - x) * this.strokeSmoothing;
        const cp1y = state.lastPoint.y + (prevPoint.y - y) * this.strokeSmoothing;
        const cp2x = x + (state.lastPoint.x - x) * this.strokeSmoothing;
        const cp2y = y + (state.lastPoint.y - y) * this.strokeSmoothing;
        
        state.currentPath.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
      } else {
        // Simple quadratic curve for start of stroke
        const midX = (state.lastPoint.x + x) / 2;
        const midY = (state.lastPoint.y + y) / 2;
        state.currentPath.quadraticCurveTo(state.lastPoint.x, state.lastPoint.y, midX, midY);
      }
    }
    
    state.currentPoints.push({ x, y });
    state.lastPoint = { x, y };
    
    if (layerId) {
      this.layerStrokes.set(layerId, state);
    }
    
    // Update dirty bounds immediately for responsive feedback
    this.updateDirtyBounds(layer, [{ x, y }]);
    
    // Batch render with frame throttling
    this.scheduleRender();
  }
  
  /**
   * Schedule batch render with FPS throttling
   */
  private scheduleRender() {
    if (this.pathBatchTimer) return;
    
    // Calculate delay based on target FPS
    const targetDelay = Math.max(16, this.animationState.frameInterval); // Min 60fps, max as configured
    const now = performance.now();
    const timeSinceLastFrame = now - this.animationState.lastFrameTime;
    const delay = Math.max(0, targetDelay - timeSinceLastFrame);
    
    this.pathBatchTimer = window.setTimeout(() => {
      this.pathBatchTimer = undefined;
      this.animationState.lastFrameTime = performance.now();
      this.render();
    }, delay);
  }
  
  /**
   * Fill shape using Path2D
   */
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string) {
    if (!vertices || vertices.length < 3) return;
    
    const state = layerId ? this.getOrCreateStrokeState(layerId) : {
      strokeLength: 0,
      lastPoint: null,
      currentPath: null,
      currentPoints: [],
      currentLayerIndex: this.currentLayerIndex,
      gradientLayerIndices: [this.currentLayerIndex]
    };
    
    if (state.currentLayerIndex < 0) return;
    
    const layer = this.layers[state.currentLayerIndex];
    
    // Create path for shape
    const shapePath = new Path2D();
    shapePath.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      shapePath.lineTo(vertices[i].x, vertices[i].y);
    }
    shapePath.closePath();
    
    // Store as path segment with gradient
    layer.pathSegments.push({
      path: shapePath,
      gradientIndex: 128, // Middle of gradient for shapes
      strokeWidth: 0, // 0 width means fill
      points: [...vertices]
    });
    
    layer.hasContent = true;
    this.updateDirtyBounds(layer, vertices);
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * Render all layers with dirty region optimization
   */
  private renderAllLayers() {
    // Calculate combined dirty region
    let dirtyMinX = this.width, dirtyMinY = this.height;
    let dirtyMaxX = 0, dirtyMaxY = 0;
    let hasDirtyRegion = false;
    
    for (const layer of this.layers) {
      if (layer.hasContent && layer.dirtyBounds) {
        dirtyMinX = Math.min(dirtyMinX, layer.dirtyBounds.minX);
        dirtyMinY = Math.min(dirtyMinY, layer.dirtyBounds.minY);
        dirtyMaxX = Math.max(dirtyMaxX, layer.dirtyBounds.maxX);
        dirtyMaxY = Math.max(dirtyMaxY, layer.dirtyBounds.maxY);
        hasDirtyRegion = true;
      }
    }
    
    // Clear only dirty region or full canvas if animating
    if (this.animationState.isAnimating && !this.animationState.isPaused) {
      // Full clear for animation
      this.ctx.clearRect(0, 0, this.width, this.height);
    } else if (hasDirtyRegion) {
      // Clear only dirty region for static content
      const clearX = Math.max(0, Math.floor(dirtyMinX));
      const clearY = Math.max(0, Math.floor(dirtyMinY));
      const clearW = Math.min(this.width - clearX, Math.ceil(dirtyMaxX - dirtyMinX));
      const clearH = Math.min(this.height - clearY, Math.ceil(dirtyMaxY - dirtyMinY));
      
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(clearX, clearY, clearW, clearH);
      this.ctx.clip();
      this.ctx.clearRect(clearX, clearY, clearW, clearH);
      
      // Render only within dirty region
      for (const layer of this.layers) {
        if (!layer.hasContent) continue;
        this.renderLayerPaths(layer);
      }
      
      this.ctx.restore();
    } else {
      // Full render if no specific dirty region
      this.ctx.clearRect(0, 0, this.width, this.height);
      for (const layer of this.layers) {
        if (!layer.hasContent) continue;
        this.renderLayerPaths(layer);
      }
    }
    
    // Reset dirty bounds after render
    for (const layer of this.layers) {
      layer.dirtyBounds = undefined;
    }
    
    this.needsRedraw = false;
  }
  
  /**
   * Render a single layer's paths with optimizations
   */
  private renderLayerPaths(layer: ColorCycleLayer) {
    this.ctx.save();
    this.ctx.globalAlpha = layer.globalAlpha;
    
    // Group segments by stroke width and gradient index for batch rendering
    const strokeGroups = new Map<string, PathSegment[]>();
    const fillSegments: PathSegment[] = [];
    
    for (const segment of layer.pathSegments) {
      if (segment.strokeWidth > 0) {
        const key = `${segment.strokeWidth}_${segment.gradientIndex}`;
        if (!strokeGroups.has(key)) {
          strokeGroups.set(key, []);
        }
        strokeGroups.get(key)!.push(segment);
      } else {
        fillSegments.push(segment);
      }
    }
    
    // Batch render strokes with same properties
    strokeGroups.forEach((segments, key) => {
      const [strokeWidth, gradientIndex] = key.split('_').map(Number);
      const color = this.getColorFromIndex(gradientIndex, layer.gradientStops);
      
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = strokeWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      // Combine paths for single draw call
      const combinedPath = new Path2D();
      segments.forEach(segment => {
        combinedPath.addPath(segment.path);
      });
      this.ctx.stroke(combinedPath);
    });
    
    // Render filled shapes
    for (const segment of fillSegments) {
      const bounds = this.getPathBounds(segment.points);
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
      
      // Create radial gradient for filled shapes
      const gradient = this.ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
      );
      
      // Apply animated gradient with caching
      const cacheKey = this.getGradientKey(layer.gradientStops) + '_' + Math.floor(this.animationState.cycleOffset * 100);
      const cachedGradient = this.gradientCache.get(cacheKey);
      
      if (!cachedGradient || cachedGradient.lastCycleOffset !== this.animationState.cycleOffset) {
        layer.gradientStops.forEach(stop => {
          const position = (stop.position + this.animationState.cycleOffset) % 1.0;
          gradient.addColorStop(position, stop.color);
        });
        
        if (cachedGradient) {
          cachedGradient.canvasGradient = gradient;
          cachedGradient.lastCycleOffset = this.animationState.cycleOffset;
        }
      }
      
      this.ctx.fillStyle = gradient;
      this.ctx.fill(segment.path);
    }
    
    this.ctx.restore();
  }
  
  /**
   * Get bounds of points
   */
  private getPathBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
    
    points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    
    return { minX, minY, maxX, maxY };
  }
  
  /**
   * Update animation
   */
  updateAnimation() {
    if (this.animationState.isAnimating && !this.animationState.isPaused) {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.animationState.lastFrameTime;
      
      if (deltaTime >= this.animationState.frameInterval) {
        this.animationState.cycleOffset += (deltaTime / 1000) * this.animationState.cycleSpeed * 0.2;
        this.animationState.cycleOffset = this.animationState.cycleOffset % 1.0;
        this.animationState.lastFrameTime = currentTime - (deltaTime % this.animationState.frameInterval);
        
        this.needsRedraw = true;
        this.renderAllLayers();
        
        if (this.onFrameRendered) {
          this.onFrameRendered();
        }
      }
    }
  }
  
  /**
   * Render
   */
  render() {
    if (this.pathBatchTimer) {
      clearTimeout(this.pathBatchTimer);
      this.pathBatchTimer = undefined;
    }
    
    this.renderAllLayers();
  }
  
  /**
   * Animation controls
   */
  startAnimation() {
    this.animationState.isAnimating = true;
    this.animationState.isPaused = false;
    this.animationState.lastFrameTime = performance.now();
  }
  
  stopAnimation() {
    this.animationState.isAnimating = false;
    this.animationState.isPaused = false;
  }
  
  pauseAnimation() {
    this.animationState.isPaused = true;
  }
  
  resumeAnimation() {
    this.animationState.isPaused = false;
    this.animationState.lastFrameTime = performance.now();
  }
  
  isPlaying(): boolean {
    return this.animationState.isAnimating && !this.animationState.isPaused;
  }
  
  setPlaying(play: boolean) {
    if (play) {
      this.resumeAnimation();
    } else {
      this.pauseAnimation();
    }
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
  
  setGradient(stops: Array<{ position: number; color: string }>, layerId?: string) {
    if (layerId) {
      const state = this.getOrCreateStrokeState(layerId);
      const layer = this.layers[state.currentLayerIndex];
      layer.gradientStops = stops;
    } else {
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
    
    this.cacheGradient(stops);
  }
  
  /**
   * Clear operations
   */
  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    this.layers.forEach(layer => {
      layer.hasContent = false;
      layer.pathSegments = [];
      layer.dirtyBounds = undefined;
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
      layer.pathSegments = [];
      layer.dirtyBounds = undefined;
    }
    
    this.layerStrokes.delete(layerId);
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * Direct render to target canvas
   */
  renderDirectToCanvas(targetCanvas: HTMLCanvasElement, layerId?: string) {
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) return;
    
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    
    if (layerId) {
      const layerIndex = this.layerIdToIndex.get(layerId);
      if (layerIndex !== undefined) {
        const layer = this.layers[layerIndex];
        if (layer.hasContent) {
          targetCtx.drawImage(this.canvas, 0, 0);
        }
      }
    } else {
      targetCtx.drawImage(this.canvas, 0, 0);
    }
  }
  
  /**
   * State management
   */
  createSnapshot(layerId: string): ArrayBuffer {
    const layerIndex = this.layerIdToIndex.get(layerId);
    if (layerIndex === undefined || layerIndex >= this.layers.length) {
      return new ArrayBuffer(0);
    }
    
    const layer = this.layers[layerIndex];
    
    // Serialize path segments
    const pathData = JSON.stringify({
      gradientStops: layer.gradientStops,
      pathSegments: layer.pathSegments.map(seg => ({
        gradientIndex: seg.gradientIndex,
        strokeWidth: seg.strokeWidth,
        points: seg.points
      }))
    });
    
    const encoder = new TextEncoder();
    const encoded = encoder.encode(pathData);
    return encoded.slice().buffer;
  }
  
  restoreSnapshot(layerId: string, snapshot: ArrayBuffer) {
    if (snapshot.byteLength === 0) {
      this.clearLayer(layerId);
      return;
    }
    
    const decoder = new TextDecoder();
    const pathData = JSON.parse(decoder.decode(snapshot)) as SerializedLayerData;
    
    if (!this.layerIdToIndex.has(layerId)) {
      this.addNewLayer(pathData.gradientStops, layerId);
    }
    
    const layerIndex = this.layerIdToIndex.get(layerId)!;
    const layer = this.layers[layerIndex];
    
    // Restore gradient
    layer.gradientStops = pathData.gradientStops;
    
    // Restore paths
    layer.pathSegments = pathData.pathSegments.map((seg: SerializedPathSegmentData) => {
      const path = new Path2D();
      if (seg.points.length > 0) {
        path.moveTo(seg.points[0].x, seg.points[0].y);
        for (let i = 1; i < seg.points.length; i++) {
          path.lineTo(seg.points[i].x, seg.points[i].y);
        }
        if (seg.strokeWidth === 0) {
          path.closePath();
        }
      }
      
      return {
        path,
        gradientIndex: seg.gradientIndex,
        strokeWidth: seg.strokeWidth,
        points: seg.points
      };
    });
    
    layer.hasContent = layer.pathSegments.length > 0;
    this.needsRedraw = true;
    this.render();
  }
  
  /**
   * Utilities
   */
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
    
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
    this.stopAnimation();
    
    if (this.pathBatchTimer) {
      clearTimeout(this.pathBatchTimer);
    }
    
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.offscreenCtx.clearRect(0, 0, this.width, this.height);
    
    this.layers = [];
    this.layerStrokes.clear();
    this.layerIdToIndex.clear();
    this.gradientCache.clear();
  }
  
  /**
   * Memory stats
   */
  getMemoryStats(): {
    layerCount: number;
    pathSegmentCount: number;
    gradientCacheSize: number;
    estimatedTotalMemory: number;
  } {
    let pathSegmentCount = 0;
    
    this.layers.forEach(layer => {
      pathSegmentCount += layer.pathSegments.length;
    });
    
    const gradientCacheSize = this.gradientCache.size * 256 * 3;
    const pathMemory = pathSegmentCount * 100; // Rough estimate per path
    
    return {
      layerCount: this.layers.length,
      pathSegmentCount,
      gradientCacheSize,
      estimatedTotalMemory: gradientCacheSize + pathMemory
    };
  }
}
