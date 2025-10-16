/**
 * SimplifiedColorCycleManager - Cleaner animation and compositing management
 * Removes complexity from DrawingCanvas while maintaining functionality
 */

export class SimplifiedColorCycleManager {
  private animationFrameId: number | null = null;
  private isAnimating: boolean = false;
  private targetFPS: number = 24;
  private lastFrameTime: number = 0;
  private onFrameCallback?: () => void;
  
  constructor(options?: {
    targetFPS?: number;
    onFrame?: () => void;
  }) {
    if (options?.targetFPS) {
      this.targetFPS = options.targetFPS;
    }
    if (options?.onFrame) {
      this.onFrameCallback = options.onFrame;
    }
  }
  
  /**
   * Start the animation loop
   */
  start() {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    this.animate();
  }
  
  /**
   * Stop the animation loop
   */
  stop() {
    this.isAnimating = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  /**
   * Main animation loop
   */
  private animate = () => {
    if (!this.isAnimating) {
      this.animationFrameId = null;
      return;
    }
    
    const currentTime = performance.now();
    const frameInterval = 1000 / this.targetFPS;
    const elapsed = currentTime - this.lastFrameTime;
    
    // Throttle to target FPS
    if (elapsed >= frameInterval) {
      // Trigger frame callback
      if (this.onFrameCallback) {
        this.onFrameCallback();
      }
      
      // Adjust for frame time drift
      this.lastFrameTime = currentTime - (elapsed % frameInterval);
    }
    
    // Continue loop
    this.animationFrameId = requestAnimationFrame(this.animate);
  }
  
  /**
   * Check if currently animating
   */
  isPlaying(): boolean {
    return this.isAnimating;
  }
  
  /**
   * Set frame callback
   */
  setOnFrame(callback: () => void) {
    this.onFrameCallback = callback;
  }
  
  /**
   * Set target FPS
   */
  setTargetFPS(fps: number) {
    this.targetFPS = Math.max(1, Math.min(60, fps));
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.stop();
    this.onFrameCallback = undefined;
  }
}