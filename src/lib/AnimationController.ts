/**
 * AnimationController - Manages animation loops with FPS control and performance optimization
 * Provides smooth, throttled animations with play/pause/speed controls
 */

import { debugLog } from '@/utils/debug';

export interface AnimationConfig {
  fps?: number;
  speed?: number;
  autoStart?: boolean;
  onFrame?: (deltaTime: number, totalTime: number) => void;
  onStart?: () => void;
  onStop?: () => void;
}

export class AnimationController {
  private fps: number = 60;
  private speed: number = 1.0;
  private offset: number = 0;
  
  // Animation state
  private isAnimating: boolean = false;
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  private startTime: number = 0;
  private totalElapsedTime: number = 0;
  private realElapsedTime: number = 0;
  private frameCount: number = 0;
  
  // Performance tracking
  private frameTimeHistory: number[] = [];
  private dbg = { t: 0, prevOff: 0 };
  private maxHistorySize: number = 60;
  private targetFrameTime: number = 1000 / 60; // Default to 60 FPS
  
  // Callbacks
  private onFrame?: (deltaTime: number, totalTime: number) => void;
  private onStart?: () => void;
  private onStop?: () => void;
  
  // Frame skipping for performance
  private skipNextFrames: number = 0;
  private autoAdjustQuality: boolean = true;
  
  constructor(config?: AnimationConfig) {
    if (config?.fps) {
      this.setFPS(config.fps);
    } else {
      this.targetFrameTime = 1000 / this.fps;
    }
    
    if (config?.speed !== undefined) {
      this.speed = config.speed;
    }
    
    if (config?.onFrame) {
      this.onFrame = config.onFrame;
    }
    
    if (config?.onStart) {
      this.onStart = config.onStart;
    }
    
    if (config?.onStop) {
      this.onStop = config.onStop;
    }
    
    if (config?.autoStart) {
      this.start();
    }
  }
  
  /**
   * Set target FPS
   */
  setFPS(fps: number) {
    this.fps = Math.max(1, Math.min(120, fps));
    this.targetFrameTime = 1000 / this.fps;
  }
  
  /**
   * Set animation speed multiplier
   */
  setSpeed(speed: number) {
    this.speed = Math.max(0, Math.min(10, speed));
  }
  
  /**
   * Get current offset (0-1 range for cycling animations)
   */
  getOffset(): number {
    return this.offset;
  }
  
  /**
   * Set offset directly
   */
  setOffset(offset: number) {
    this.offset = offset % 1;
  }
  
  /**
   * Get current speed
   */
  getSpeed(): number {
    return this.speed;
  }
  
  /**
   * Start animation
   */
  start() {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    this.startTime = this.lastFrameTime;
    this.totalElapsedTime = 0;
    this.realElapsedTime = 0;
    this.frameCount = 0;
    this.frameTimeHistory = [];
    
    if (this.onStart) {
      this.onStart();
    }
    
    this.animate();
  }
  
  /**
   * Stop animation
   */
  stop() {
    this.isAnimating = false;
    
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    if (this.onStop) {
      this.onStop();
    }
  }
  
  /**
   * Pause animation (keeps state)
   */
  pause() {
    if (!this.isAnimating) return;
    
    this.isAnimating = false;
    
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  
  /**
   * Resume animation from paused state
   */
  resume() {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    
    this.animate();
  }
  
  /**
   * Toggle play/pause
   */
  toggle() {
    if (this.isAnimating) {
      this.pause();
    } else {
      this.resume();
    }
  }
  
  /**
   * Reset animation to beginning
   */
  reset() {
    this.offset = 0;
    this.totalElapsedTime = 0;
    this.realElapsedTime = 0;
    this.frameCount = 0;
    this.frameTimeHistory = [];
  }
  
  /**
   * Main animation loop
   */
  private animate = () => {
    if (!this.isAnimating) return;
    
    const currentTime = performance.now();
    const rawDeltaTime = currentTime - this.lastFrameTime;
    
    // Track frame time for performance monitoring
    this.frameTimeHistory.push(rawDeltaTime);
    if (this.frameTimeHistory.length > this.maxHistorySize) {
      this.frameTimeHistory.shift();
    }
    
    // Check if we should skip frames for performance
    if (this.skipNextFrames > 0) {
      this.skipNextFrames--;
      this.lastFrameTime = currentTime;
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }
    
    // Auto-adjust quality based on performance
    if (this.autoAdjustQuality) {
      this.adjustQuality();
    }
    
    const rawDeltaSeconds = rawDeltaTime / 1000;
    // Calculate actual delta time with speed modifier
    const deltaTime = rawDeltaSeconds * this.speed; // Convert to seconds and apply speed
    
    // Update offset for cycling animations
    this.offset = (this.offset + deltaTime) % 1;
    
    // Update total elapsed time
    this.totalElapsedTime += deltaTime;
    this.realElapsedTime += rawDeltaSeconds;
    
    // Call frame callback
    if (this.onFrame) {
      this.onFrame(deltaTime, this.totalElapsedTime);
    }
    
    // Update frame count
    this.frameCount++;
    
    // Update last frame time
    this.lastFrameTime = currentTime;
    
    // Schedule next frame with FPS throttling
    if (this.fps < 60) {
      // For lower FPS, use setTimeout for better control
      const timeUntilNextFrame = Math.max(0, this.targetFrameTime - rawDeltaTime);
      
      setTimeout(() => {
        this.animationId = requestAnimationFrame(this.animate);
      }, timeUntilNextFrame);
    } else {
      // For high FPS, use requestAnimationFrame directly
      this.animationId = requestAnimationFrame(this.animate);
    }
  }
  
  /**
   * Adjust quality based on performance
   */
  private adjustQuality() {
    if (this.frameTimeHistory.length < 10) return;
    
    // Calculate average frame time
    const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;
    
    // More aggressive frame skipping for better performance
    if (avgFrameTime > this.targetFrameTime * 2.0) {
      // Very poor performance - skip 2 frames
      this.skipNextFrames = 2;
    } else if (avgFrameTime > this.targetFrameTime * 1.5) {
      // Poor performance - skip 1 frame
      this.skipNextFrames = 1;
    } else if (avgFrameTime > this.targetFrameTime * 1.2) {
      // Slightly behind - dynamically reduce FPS
      if (this.fps > 15) {
        this.setFPS(Math.max(15, this.fps - 5));
      }
    }
  }
  
  /**
   * Get current FPS (actual, not target)
   */
  getActualFPS(): number {
    if (this.frameTimeHistory.length === 0) return 0;
    
    const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;
    return 1000 / avgFrameTime;
  }
  
  /**
   * Get performance stats
   */
  getStats(): {
    targetFPS: number;
    actualFPS: number;
    frameCount: number;
    totalTime: number;
    realTime: number;
    averageFrameTime: number;
    isAnimating: boolean;
  } {
    const avgFrameTime = this.frameTimeHistory.length > 0
      ? this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length
      : 0;
    
    return {
      targetFPS: this.fps,
      actualFPS: this.getActualFPS(),
      frameCount: this.frameCount,
      totalTime: this.totalElapsedTime,
      realTime: this.realElapsedTime,
      averageFrameTime: avgFrameTime,
      isAnimating: this.isAnimating
    };
  }

  /**
   * Get elapsed time in seconds without speed scaling.
   */
  getElapsedTime(): number {
    return this.realElapsedTime;
  }

  /**
   * Get elapsed time in seconds with speed scaling applied.
   */
  getScaledElapsedTime(): number {
    return this.totalElapsedTime;
  }

  /**
   * Advance time manually for external render loops.
   * deltaSeconds is real time; speed applies only to offset/totalTime.
   */
  advanceExternalFrame(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    const deltaWithSpeed = deltaSeconds * this.speed;
    this.offset = (this.offset + deltaWithSpeed) % 1;
    this.totalElapsedTime += deltaWithSpeed;
    this.realElapsedTime += deltaSeconds;
    this.frameCount += 1;
    this.dbg.t += deltaSeconds;
    if (this.dbg.t >= 1) {
      let doff = this.offset - this.dbg.prevOff;
      if (doff < 0) doff += 1;
      debugLog(
        'cc-anim',
        '[vessel][dbg] dt',
        this.dbg.t.toFixed(3),
        'speed',
        this.speed.toFixed(4),
        'doff',
        doff.toFixed(4),
        'cyclesPerSec',
        (doff / this.dbg.t).toFixed(4)
      );
      this.dbg.t = 0;
      this.dbg.prevOff = this.offset;
    }
  }
  
  /**
   * Enable/disable auto quality adjustment
   */
  setAutoAdjustQuality(enabled: boolean) {
    this.autoAdjustQuality = enabled;
  }
  
  /**
   * Is currently animating?
   */
  isPlaying(): boolean {
    return this.isAnimating;
  }
  
  /**
   * Set frame callback
   */
  setOnFrame(callback: (deltaTime: number, totalTime: number) => void) {
    this.onFrame = callback;
  }
  
  /**
   * Create animator with easing function
   */
  static withEasing(
    duration: number,
    easing: (t: number) => number,
    onUpdate: (value: number) => void,
    onComplete?: () => void
  ): AnimationController {
    let progress = 0;
    
    const controller = new AnimationController({
      fps: 60,
      speed: 1,
      onFrame: (deltaTime) => {
        progress += deltaTime / duration;
        
        if (progress >= 1) {
          progress = 1;
          const easedValue = easing(progress);
          onUpdate(easedValue);
          
          if (onComplete) {
            onComplete();
          }
          
          controller.stop();
        } else {
          const easedValue = easing(progress);
          onUpdate(easedValue);
        }
      }
    });
    
    return controller;
  }
  
  /**
   * Common easing functions
   */
  static Easing = {
    linear: (t: number) => t,
    
    easeInQuad: (t: number) => t * t,
    easeOutQuad: (t: number) => t * (2 - t),
    easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    
    easeInCubic: (t: number) => t * t * t,
    easeOutCubic: (t: number) => (--t) * t * t + 1,
    easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    
    easeInQuart: (t: number) => t * t * t * t,
    easeOutQuart: (t: number) => 1 - (--t) * t * t * t,
    easeInOutQuart: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
    
    easeInSine: (t: number) => 1 - Math.cos(t * Math.PI / 2),
    easeOutSine: (t: number) => Math.sin(t * Math.PI / 2),
    easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
    
    easeInExpo: (t: number) => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
    easeOutExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    easeInOutExpo: (t: number) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
      return (2 - Math.pow(2, -20 * t + 10)) / 2;
    },
    
    easeInCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
    easeOutCirc: (t: number) => Math.sqrt(1 - (--t) * t),
    easeInOutCirc: (t: number) => {
      if (t < 0.5) return (1 - Math.sqrt(1 - 4 * t * t)) / 2;
      return (Math.sqrt(1 - (-2 * t + 2) * (-2 * t + 2)) + 1) / 2;
    },
    
    easeInBack: (t: number) => 2.70158 * t * t * t - 1.70158 * t * t,
    easeOutBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    easeInOutBack: (t: number) => {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      if (t < 0.5) return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2;
      return (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    },
    
    easeInElastic: (t: number) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
    },
    easeOutElastic: (t: number) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    },
    easeInOutElastic: (t: number) => {
      if (t === 0) return 0;
      if (t === 1) return 1;
      if (t < 0.5) {
        return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2;
      }
      return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))) / 2 + 1;
    },
    
    easeInBounce: (t: number) => 1 - AnimationController.Easing.easeOutBounce(1 - t),
    easeOutBounce: (t: number) => {
      const n1 = 7.5625;
      const d1 = 2.75;
      
      if (t < 1 / d1) {
        return n1 * t * t;
      } else if (t < 2 / d1) {
        return n1 * (t -= 1.5 / d1) * t + 0.75;
      } else if (t < 2.5 / d1) {
        return n1 * (t -= 2.25 / d1) * t + 0.9375;
      } else {
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
      }
    },
    easeInOutBounce: (t: number) => {
      if (t < 0.5) {
        return (1 - AnimationController.Easing.easeOutBounce(1 - 2 * t)) / 2;
      }
      return (1 + AnimationController.Easing.easeOutBounce(2 * t - 1)) / 2;
    }
  };
}
