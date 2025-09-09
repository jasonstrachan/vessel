/**
 * RecolorAnimationController - Manages global animation state for recolor layers
 * Handles timing, tick progression, and multi-layer synchronization
 * Based on the color cycling recolor feature specification
 */

import { RecolorEngine } from './RecolorEngine';
import type { Layer } from '../../types';

export interface AnimatedLayer {
  layer: Layer;
  enabled: boolean;
  lastTick: number;
  lastFrameTime: number;
}

export interface AnimationStats {
  fps: number;
  frameTime: number;
  activeLayers: number;
  droppedFrames: number;
  memoryUsage: number;
}

export class RecolorAnimationController {
  private engine: RecolorEngine;
  private animatedLayers: Map<string, AnimatedLayer> = new Map();
  
  // Animation state
  private isPlaying: boolean = false;
  private globalTick: number = 0;
  private targetFPS: number = 30;
  private frameInterval: number = 1000 / 30; // ms between frames
  private lastFrameTime: number = 0;
  private animationFrameId: number | null = null;
  
  // Performance monitoring
  private stats: AnimationStats = {
    fps: 0,
    frameTime: 0,
    activeLayers: 0,
    droppedFrames: 0,
    memoryUsage: 0
  };
  
  private frameTimeHistory: number[] = [];
  private readonly MAX_FRAME_HISTORY = 60; // Track last 60 frames
  
  // Adaptive quality
  private performanceMode: 'quality' | 'balanced' | 'performance' = 'balanced';
  private frameTimeTarget: number = 1000 / 30; // Target 33.33ms per frame
  
  // Callbacks
  private frameCallbacks: Set<(layers: AnimatedLayer[], stats: AnimationStats) => void> = new Set();
  
  constructor() {
    this.engine = new RecolorEngine();
    this.updateFrameInterval();
  }
  
  /**
   * Update a single layer immediately (manual tick/render)
   * - Ensures the layer is registered
   * - Advances tick based on current settings
   * - Renders a frame and updates layer.imageData
   */
  updateLayer(layer: Layer): boolean {
    const settings = layer.colorCycleData?.recolorSettings;
    if (!settings || !settings.indexBuffer) {
      console.warn('[RecolorAnimationController] updateLayer: missing recolor settings/indexBuffer');
      return false;
    }

    // Ensure the layer is registered for animation tracking
    let animatedLayer = this.animatedLayers.get(layer.id);
    if (!animatedLayer) {
      const registered = this.registerLayer(layer);
      if (!registered) return false;
      animatedLayer = this.animatedLayers.get(layer.id)!;
    }

    // Ensure ticksPerFrame is initialized
    if (!Number.isFinite(settings.animation.ticksPerFrame) || settings.animation.ticksPerFrame <= 0) {
      this.updateTicksPerFrame(layer);
    }

    // Advance tick with fractional support
    const tickIncrement = settings.animation.ticksPerFrame;
    const newTickFloat = (settings.animation.currentTick || 0) + tickIncrement;
    settings.animation.currentTick = newTickFloat;
    const wrappedTick = settings.cycleColors > 0 ? Math.floor(newTickFloat) % settings.cycleColors : 0;

    // Render frame for this layer (pass float tick for smooth offset)
    const imageData = this.engine.renderFrame(layer, newTickFloat);
    if (!imageData) {
      console.warn(`[RecolorAnimationController] updateLayer: render returned no imageData for layer ${layer.id}`);
      return false;
    }

    // Apply frame and record timing
    layer.imageData = imageData;
    animatedLayer.lastTick = wrappedTick;
    animatedLayer.lastFrameTime = performance.now();

    // Notify any listeners that a frame is ready
    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate', {
        detail: { layerId: layer.id, tick: wrappedTick }
      }));
    } catch {}

    return true;
  }
  
  /**
   * Register a layer for animation
   */
  registerLayer(layer: Layer): boolean {
    // verbose logs removed
    
    if (!layer.colorCycleData?.recolorSettings?.indexBuffer) {
      console.warn('[RecolorAnimationController] Cannot register layer - no recolor data');
      return false;
    }
    
    if (layer.colorCycleData.mode !== 'recolor') {
      console.warn('[RecolorAnimationController] Cannot register layer - not in recolor mode');
      return false;
    }
    
    const animatedLayer: AnimatedLayer = {
      layer,
      enabled: true,
      lastTick: -1,
      lastFrameTime: 0
    };
    
    this.animatedLayers.set(layer.id, animatedLayer);
    this.updateStats();
    
    // registration logs removed
    return true;
  }
  
  /**
   * Unregister a layer from animation
   */
  unregisterLayer(layerId: string): boolean {
    const removed = this.animatedLayers.delete(layerId);
    if (removed) {
      this.updateStats();
    }
    return removed;
  }
  
  /**
   * Enable/disable animation for a specific layer
   */
  setLayerEnabled(layerId: string, enabled: boolean): boolean {
    const animatedLayer = this.animatedLayers.get(layerId);
    if (!animatedLayer) {
      return false;
    }
    
    animatedLayer.enabled = enabled;
    this.updateStats();
    return true;
  }
  
  /**
   * Start global animation (all enabled layers)
   */
  playAll(): void {
    if (this.animatedLayers.size === 0) {
      console.warn('[RecolorAnimationController] No layers registered for animation');
      return;
    }
    
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.startAnimationLoop();
    
    // started
  }
  
  /**
   * Play only a specific layer (disable others temporarily)
   */
  playSingle(layerId: string): void {
    const targetLayer = this.animatedLayers.get(layerId);
    if (!targetLayer) {
      console.warn(`[RecolorAnimationController] Layer ${layerId} not found in registered layers`);
      return;
    }
    
    // Temporarily disable all other layers
    for (const [id, layer] of Array.from(this.animatedLayers.entries())) {
      layer.enabled = (id === layerId);
    }
    
    this.playAll();
  }
  
  /**
   * Stop animation
   */
  stop(): void {
    this.isPlaying = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Reset all layers to tick 0
    for (const animatedLayer of Array.from(this.animatedLayers.values())) {
      if (animatedLayer.layer.colorCycleData?.recolorSettings) {
        animatedLayer.layer.colorCycleData.recolorSettings.animation.currentTick = 0;
        animatedLayer.lastTick = -1;
      }
    }
    
    // stopped
  }
  
  /**
   * Pause animation (preserve current tick positions)
   */
  pause(): void {
    this.isPlaying = false;
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // paused
  }
  
  /**
   * Resume animation from current positions
   */
  resume(): void {
    if (this.animatedLayers.size === 0) {
      return;
    }
    
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.startAnimationLoop();
    
    // resumed
  }
  
  /**
   * Toggle play/pause
   */
  toggle(): void {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.resume();
    }
  }
  
  /**
   * Set target FPS for all animations
   */
  setFPS(fps: number): void {
    this.targetFPS = Math.max(15, Math.min(60, fps));
    this.updateFrameInterval();
    
    // Update all layer animation settings
    for (const animatedLayer of Array.from(this.animatedLayers.values())) {
      if (animatedLayer.layer.colorCycleData?.recolorSettings) {
        animatedLayer.layer.colorCycleData.recolorSettings.animation.fps = this.targetFPS;
        this.updateTicksPerFrame(animatedLayer.layer);
      }
    }
    
    console.log(`[RecolorAnimationController] Set FPS to ${this.targetFPS}`);
  }
  
  /**
   * Set animation speed for a layer
   */
  setLayerSpeed(layerId: string, speed: number): boolean {
    const animatedLayer = this.animatedLayers.get(layerId);
    if (!animatedLayer || !animatedLayer.layer.colorCycleData?.recolorSettings) {
      return false;
    }
    
    // Defensive clamp to avoid zero/negative speed from UI glitches
    const clamped = Math.max(0.05, Math.min(2.0, Number.isFinite(speed) ? speed : 0.4));
    animatedLayer.layer.colorCycleData.recolorSettings.animation.speed = clamped;
    this.updateTicksPerFrame(animatedLayer.layer);
    return true;
  }
  
  /**
   * Main animation loop
   */
  private startAnimationLoop(): void {
    if (!this.isPlaying) return;
    
    const frameStart = performance.now();
    const deltaTime = frameStart - this.lastFrameTime;
    
    // Only render if enough time has passed (frame rate limiting)
    if (deltaTime >= this.frameInterval) {
      this.updateFrame(deltaTime);
      this.lastFrameTime = frameStart;
      
      // Track performance
      const frameEnd = performance.now();
      const frameTime = frameEnd - frameStart;
      this.trackFrameTime(frameTime);
      
      // Adaptive quality adjustment
      this.adjustQuality(frameTime);
    }
    
    this.animationFrameId = requestAnimationFrame(() => this.startAnimationLoop());
  }
  
  /**
   * Update all enabled layers for current frame
   */
  private updateFrame(deltaTime: number): void {
    const activeLayers: AnimatedLayer[] = [];
    
    for (const animatedLayer of Array.from(this.animatedLayers.values())) {
      if (!animatedLayer.enabled || !animatedLayer.layer.visible) {
        continue;
      }
      
      const settings = animatedLayer.layer.colorCycleData?.recolorSettings;
      if (!settings) continue;
      
      // Calculate new tick for this layer (fractional support)
      const tickIncrement = settings.animation.ticksPerFrame;
      const newTickFloat = (settings.animation.currentTick || 0) + tickIncrement;
      const wrappedTick = Math.floor(newTickFloat) % Math.max(1, settings.cycleColors);

      // Always advance and render; fractional tick shifts gradient continuously
      settings.animation.currentTick = newTickFloat;
      const imageData = this.engine.renderFrame(animatedLayer.layer, newTickFloat);
      if (imageData) {
        animatedLayer.layer.imageData = imageData;
        animatedLayer.lastTick = wrappedTick;
        animatedLayer.lastFrameTime = performance.now();
        try {
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate', {
            detail: { layerId: animatedLayer.layer.id, tick: wrappedTick }
          }));
        } catch {}
      }
      
      activeLayers.push(animatedLayer);
    }
    
    // Notify callbacks
    this.frameCallbacks.forEach(callback => {
      callback(activeLayers, this.stats);
    });
  }
  
  /**
   * Update ticks per frame based on speed and FPS
   */
  private updateTicksPerFrame(layer: Layer): void {
    const settings = layer.colorCycleData?.recolorSettings;
    if (!settings) return;
    
    // Calculate how many ticks to advance per frame
    // speed 1.0 = one full cycle per second
    // At 30fps, that's 1/30 of a cycle per frame
    const cyclesPerSecond = settings.animation.speed;
    const cyclesPerFrame = cyclesPerSecond / this.targetFPS;
    const ticksPerFrame = cyclesPerFrame * settings.cycleColors;
    
    settings.animation.ticksPerFrame = ticksPerFrame;
  }
  
  /**
   * Update frame interval based on target FPS
   */
  private updateFrameInterval(): void {
    this.frameInterval = 1000 / this.targetFPS;
    this.frameTimeTarget = this.frameInterval * 0.8; // Target 80% of frame time
  }
  
  /**
   * Track frame time for performance monitoring
   */
  private trackFrameTime(frameTime: number): void {
    this.frameTimeHistory.push(frameTime);
    
    if (this.frameTimeHistory.length > this.MAX_FRAME_HISTORY) {
      this.frameTimeHistory.shift();
    }
    
    // Update rolling average
    const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;
    this.stats.frameTime = avgFrameTime;
    this.stats.fps = 1000 / avgFrameTime;
    
    // Count dropped frames
    if (frameTime > this.frameInterval * 1.5) {
      this.stats.droppedFrames++;
    }
  }
  
  /**
   * Adjust quality based on performance
   */
  private adjustQuality(frameTime: number): void {
    if (frameTime > this.frameTimeTarget * 1.5) {
      // Performance is poor, reduce quality
      for (const animatedLayer of Array.from(this.animatedLayers.values())) {
        const settings = animatedLayer.layer.colorCycleData?.recolorSettings;
        if (settings && settings.currentLOD === 'full') {
          settings.currentLOD = 'half';
          console.log(`[RecolorAnimationController] Reduced quality to half for layer ${animatedLayer.layer.id}`);
        }
      }
    } else if (frameTime < this.frameTimeTarget * 0.7) {
      // Performance is good, increase quality
      for (const animatedLayer of Array.from(this.animatedLayers.values())) {
        const settings = animatedLayer.layer.colorCycleData?.recolorSettings;
        if (settings && settings.currentLOD !== 'full') {
          settings.currentLOD = 'full';
          console.log(`[RecolorAnimationController] Increased quality to full for layer ${animatedLayer.layer.id}`);
        }
      }
    }
  }
  
  /**
   * Update statistics
   */
  private updateStats(): void {
    this.stats.activeLayers = Array.from(this.animatedLayers.values())
      .filter(layer => layer.enabled).length;
    this.stats.memoryUsage = this.engine.getStats().memoryUsage;
  }
  
  /**
   * Add frame callback
   */
  onFrame(callback: (layers: AnimatedLayer[], stats: AnimationStats) => void): void {
    this.frameCallbacks.add(callback);
  }
  
  /**
   * Remove frame callback
   */
  offFrame(callback: (layers: AnimatedLayer[], stats: AnimationStats) => void): void {
    this.frameCallbacks.delete(callback);
  }
  
  /**
   * Get current animation statistics
   */
  getStats(): AnimationStats {
    return { ...this.stats };
  }
  
  /**
   * Get list of registered layers
   */
  getLayers(): AnimatedLayer[] {
    return Array.from(this.animatedLayers.values());
  }
  
  /**
   * Check if animation is playing
   */
  isAnimating(): boolean {
    return this.isPlaying;
  }
  
  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
    this.animatedLayers.clear();
    this.frameCallbacks.clear();
    console.log('[RecolorAnimationController] Cleaned up resources');
  }
}
