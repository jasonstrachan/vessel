/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
import { GradientStop } from '../../lib/GradientPalette';

export class ColorCycleBrushCanvas2D {
  private animators: Map<string, ColorCycleAnimator> = new Map();
  private activeLayerId: string | null = null;
  
  // Canvas references
  private webglCanvas: HTMLCanvasElement; // Keep name for compatibility
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  
  // Core settings (match original API)
  private brushSize: number;
  private cycleSpeed: number;
  private cycleOffset: number;
  private fps: number;
  private frameInterval: number;
  private lastFrameTime: number;
  
  // Canvas dimensions
  private width: number;
  private height: number;
  
  // Animation state
  private isAnimating: boolean = false;
  private animationId: number | null = null;
  private isPaused: boolean = false;
  
  // Stroke tracking
  private strokeCounter: number = 0;
  private strokeLength: number = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;
  
  // Stamp tracking for gradient progression
  private stampCounter: number = 0;
  private totalGradientSteps: number = 256; // Total colors in gradient
  private resetStampOnNewStroke: boolean = false; // Set to true to reset colors per stroke
  
  // Frame callback
  private onFrameRendered?: () => void;
  
  // Layer tracking for API compatibility
  private layerStrokes: Map<string, {
    paintBuffer: Uint8Array;
    hasContent: boolean;
    strokeCounter: number;
    strokeLength: number;
    lastPoint: { x: number; y: number } | null;
    gradientLayerIndices: number[];
    currentGradientIndex: number;
    stampCounter: number; // Track stamps per layer
  }> = new Map();
  
  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
  } = {}) {
    console.log('🎨 [ColorCycle] Creating Canvas2D implementation - NEW UNIFIED 2D PIPELINE');
    // Use provided canvas as the "WebGL" canvas for compatibility
    this.webglCanvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    
    // Create composite canvas for final rendering
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.width;
    this.compositeCanvas.height = this.height;
    
    const ctx = this.compositeCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    });
    
    if (!ctx) {
      throw new Error('Failed to create 2D context');
    }
    
    this.compositeCtx = ctx;
    this.compositeCtx.imageSmoothingEnabled = false;
    
    // Core settings
    this.brushSize = options.brushSize || 20;
    this.cycleSpeed = 1.0;
    this.cycleOffset = 0.0;
    this.fps = options.fps || 30;
    this.frameInterval = 1000 / this.fps;
    this.lastFrameTime = 0;
  }
  
  /**
   * Get or create animator for a layer
   */
  private getAnimator(layerId: string): ColorCycleAnimator {
    if (!this.animators.has(layerId)) {
      const animator = new ColorCycleAnimator({
        width: this.width,
        height: this.height,
        fps: this.fps,
        speed: this.cycleSpeed,
        autoStart: false
      });
      
      this.animators.set(layerId, animator);
      
      // Setup layer stroke tracking
      if (!this.layerStrokes.has(layerId)) {
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(this.width * this.height),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0
        });
      }
    }
    
    return this.animators.get(layerId)!;
  }
  
  /**
   * Paint at position (API compatible)
   */
  paint(x: number, y: number, layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);
    
    // Track stroke data
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      // Calculate color index based on stamp position in gradient
      // Each stamp gets the next color in the gradient sequence
      // Color indices are 0-255 for the gradient positions
      const colorIndex = strokeData.stampCounter % this.totalGradientSteps;
      
      // Debug: Log stamp progression
      if (strokeData.stampCounter < 5 || strokeData.stampCounter % 20 === 0) {
        console.log(`🎨 Stamp #${strokeData.stampCounter}: colorIndex=${colorIndex} (gradient position)`);
      }
      
      // Paint with specific color index (0-255 representing gradient positions)
      animator.paintSquare(x, y, this.brushSize, colorIndex);
      
      // Update tracking
      strokeData.hasContent = true;
      strokeData.strokeLength++;
      strokeData.lastPoint = { x, y };
      strokeData.stampCounter++;
    } else {
      // Fallback if no stroke data
      animator.paintSquare(x, y, this.brushSize);
    }
    
    // Mark as needing update
    if (!this.isAnimating) {
      this.render(false);
    }
  }
  
  /**
   * Set gradient (API compatible)
   */
  setGradient(stops: GradientStop[], layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);
    
    // Update gradient
    animator.setGradient(stops);
    
    // Store in layer data
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.currentGradientIndex = strokeData.gradientLayerIndices.length;
      strokeData.gradientLayerIndices.push(strokeData.currentGradientIndex);
    }
  }
  
  /**
   * Set whether to reset stamp counter on new strokes
   */
  setResetStampOnNewStroke(reset: boolean) {
    this.resetStampOnNewStroke = reset;
    console.log(`🎨 Stamp reset on new stroke: ${reset ? 'enabled' : 'disabled (continuous progression)'}`);
  }
  
  /**
   * Start new stroke (API compatible)
   */
  startStroke(layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    this.activeLayerId = id;
    this.isDrawing = true;
    this.strokeCounter++;
    this.strokeLength = 0;
    this.lastPoint = null;
    
    const animator = this.getAnimator(id);
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.strokeLength = 0;
      strokeData.lastPoint = null;
      
      // Only reset stamp counter if configured to do so
      // For continuous color progression across strokes, keep it accumulating
      if (this.resetStampOnNewStroke) {
        strokeData.stampCounter = 0;
        console.log('🎨 Resetting color progression for new stroke');
      } else {
        console.log(`🎨 Continuing color progression from stamp #${strokeData.stampCounter}`);
      }
    }
  }
  
  /**
   * End stroke (API compatible)
   */
  endStroke(layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    this.isDrawing = false;
    
    const animator = this.getAnimator(id);
    animator.endStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.lastPoint = null;
    }
    
    // Final render
    this.render(false);
  }
  
  /**
   * Fill shape (API compatible)
   */
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);
    
    // Simple polygon fill using scan-line algorithm
    if (vertices.length < 3) return;
    
    // Find bounds
    let minX = vertices[0].x;
    let maxX = vertices[0].x;
    let minY = vertices[0].y;
    let maxY = vertices[0].y;
    
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    
    // Scan-line fill
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const intersections: number[] = [];
      
      // Find intersections with polygon edges
      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const x = v1.x + ((y - v1.y) / (v2.y - v1.y)) * (v2.x - v1.x);
          intersections.push(x);
        }
      }
      
      // Sort intersections
      intersections.sort((a, b) => a - b);
      
      // Fill between pairs
      for (let i = 0; i < intersections.length; i += 2) {
        if (i + 1 < intersections.length) {
          for (let x = Math.floor(intersections[i]); x <= Math.ceil(intersections[i + 1]); x++) {
            animator.paint(x, y, 2);
          }
        }
      }
    }
    
    this.render(false);
  }
  
  /**
   * Clear (API compatible)
   */
  clear() {
    this.animators.forEach(animator => animator.clear());
    this.layerStrokes.clear();
    this.render(false);
  }
  
  /**
   * Render current frame (API compatible)
   */
  render(forceFullOpacity: boolean = false) {
    // Clear composite canvas
    this.compositeCtx.clearRect(0, 0, this.width, this.height);
    
    // Composite all layers
    let renderedLayers = 0;
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        animator.drawTo(this.compositeCtx);
        renderedLayers++;
      }
    });
    
    // Draw to webgl canvas (actually just a regular canvas)
    const webglCtx = this.webglCanvas.getContext('2d');
    if (webglCtx) {
      webglCtx.clearRect(0, 0, this.width, this.height);
      webglCtx.globalAlpha = forceFullOpacity ? 1.0 : 0.8;
      webglCtx.drawImage(this.compositeCanvas, 0, 0);
      webglCtx.globalAlpha = 1.0;
    }
    
    // Call frame callback
    if (this.onFrameRendered) {
      this.onFrameRendered();
    }
  }
  
  /**
   * Render directly to canvas (API compatible)
   */
  renderDirectToCanvas(targetCanvas: HTMLCanvasElement, layerId: string) {
    const animator = this.animators.get(layerId);
    if (animator) {
      const ctx = targetCanvas.getContext('2d');
      if (ctx) {
        animator.drawTo(ctx);
      }
    }
  }
  
  /**
   * Start animation (API compatible)
   */
  startAnimation() {
    console.log('🎬 [ColorCycle] startAnimation called, isAnimating:', this.isAnimating, 'animators:', this.animators.size);
    if (this.isAnimating) {
      return;
    }
    
    this.isAnimating = true;
    this.isPaused = false;
    
    // Start all animators
    this.animators.forEach((animator, layerId) => {
      console.log(`🎨 [ColorCycle] Starting animator for layer: ${layerId}`);
      animator.start();
      animator.onFrame(() => {
        if (!this.isPaused) {
          this.render(false);
        }
      });
    });
  }
  
  /**
   * Stop animation (API compatible)
   */
  stopAnimation() {
    this.isAnimating = false;
    
    // Stop all animators
    this.animators.forEach(animator => animator.stop());
    
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  
  /**
   * Toggle play/pause (API compatible)
   */
  togglePlayPause() {
    if (this.isAnimating) {
      this.pause();
    } else {
      this.startAnimation();
    }
  }
  
  /**
   * Pause animation (API compatible)
   */
  pause() {
    this.isPaused = true;
    this.animators.forEach(animator => animator.pause());
  }
  
  /**
   * Resume animation (API compatible)
   */
  resume() {
    this.isPaused = false;
    this.animators.forEach(animator => animator.resume());
  }
  
  /**
   * Update animation (API compatible)
   */
  updateAnimation() {
    // Force animator update even if not animating locally
    // This ensures the animation progresses when called from external loop
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        // Directly update the animator's frame
        animator.updateFrame();
      }
    });
    
    // Always render when updateAnimation is called
    this.render(false);
  }
  
  /**
   * Set animation speed (API compatible)
   */
  setSpeed(speed: number) {
    this.cycleSpeed = speed;
    this.animators.forEach(animator => animator.setSpeed(speed));
  }
  
  /**
   * Set FPS (API compatible)
   */
  setFPS(fps: number) {
    this.fps = fps;
    this.frameInterval = 1000 / fps;
    this.animators.forEach(animator => animator.setFPS(fps));
  }
  
  /**
   * Set brush size (API compatible)
   */
  setBrushSize(size: number) {
    this.brushSize = size;
  }
  
  /**
   * Is playing? (API compatible)
   */
  isPlaying(): boolean {
    return this.isAnimating && !this.isPaused;
  }
  
  /**
   * Set frame callback (API compatible)
   */
  setOnFrameRendered(callback: () => void) {
    this.onFrameRendered = callback;
  }
  
  /**
   * Set layer ID (API compatible)
   */
  setLayerId(layerId: string) {
    this.activeLayerId = layerId;
  }
  
  /**
   * Set active layer (API compatible)
   */
  setActiveLayer(layerId: string) {
    this.activeLayerId = layerId;
  }
  
  /**
   * Set playing state (API compatible)
   */
  setPlaying(playing: boolean) {
    if (playing) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }
  
  /**
   * Get canvas (API compatible)
   */
  getCanvas(): HTMLCanvasElement {
    return this.webglCanvas;
  }
  
  /**
   * Cleanup (API compatible)
   */
  cleanup() {
    this.stopAnimation();
    this.animators.forEach(animator => animator.stop());
    this.animators.clear();
    this.layerStrokes.clear();
  }
  
  /**
   * Destroy (API compatible - alias for cleanup)
   */
  destroy() {
    this.cleanup();
  }
  
  /**
   * Set flow direction (API compatible)
   */
  setFlowDirection(direction: 'forward' | 'backward') {
    this.animators.forEach(animator => animator.setFlowDirection(direction));
  }
  
  /**
   * Toggle flow direction (API compatible)
   */
  toggleFlowDirection() {
    this.animators.forEach(animator => animator.toggleFlowDirection());
  }
  
  /**
   * Get full state (API compatible)
   */
  getFullState() {
    return this.serialize();
  }
  
  /**
   * Restore full state (API compatible)
   */
  restoreFullState(state: any) {
    // Clear current state
    this.animators.clear();
    this.layerStrokes.clear();
    
    // Restore settings
    this.cycleSpeed = state.cycleSpeed || 1.0;
    this.fps = state.fps || 30;
    this.brushSize = state.brushSize || 20;
    
    // Restore layers
    if (state.layers) {
      state.layers.forEach((layer: any) => {
        this.layerStrokes.set(layer.layerId, {
          paintBuffer: new Uint8Array(this.width * this.height),
          hasContent: layer.strokeData.hasContent,
          strokeCounter: layer.strokeData.strokeCounter,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0
        });
      });
    }
  }
  
  /**
   * Serialize state (API compatible simplified)
   */
  serialize() {
    const layers: any[] = [];
    
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        layers.push({
          layerId,
          data: animator.serialize(),
          strokeData: {
            hasContent: strokeData.hasContent,
            strokeCounter: strokeData.strokeCounter
          }
        });
      }
    });
    
    return {
      layers,
      cycleSpeed: this.cycleSpeed,
      fps: this.fps,
      brushSize: this.brushSize
    };
  }
  
  /**
   * Deserialize state (API compatible simplified)
   */
  static deserialize(data: any, canvas: HTMLCanvasElement): ColorCycleBrushCanvas2D {
    const instance = new ColorCycleBrushCanvas2D(canvas, {
      brushSize: data.brushSize,
      fps: data.fps
    });
    
    instance.setSpeed(data.cycleSpeed);
    
    // Restore layers
    if (data.layers) {
      data.layers.forEach((layer: any) => {
        // Would need to implement ColorCycleAnimator deserialization
        // For now, just track that the layer exists
        instance.layerStrokes.set(layer.layerId, {
          paintBuffer: new Uint8Array(instance.width * instance.height),
          hasContent: layer.strokeData.hasContent,
          strokeCounter: layer.strokeData.strokeCounter,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0
        });
      });
    }
    
    return instance;
  }
}