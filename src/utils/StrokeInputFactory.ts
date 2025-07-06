'use client';

import { StrokeInput } from '@/types/brush';

/**
 * StrokeInputFactory - Converts canvas events to StrokeInput format
 * Handles the conversion from drawing canvas coordinates and events to modular brush input
 */
export class StrokeInputFactory {
  private lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  private lastTimestamp: number = 0;
  private strokeStartTime: number = 0;
  private isStrokeActive: boolean = false;

  /**
   * Create StrokeInput from canvas drawing coordinates
   */
  createStrokeInput(
    x: number,
    y: number,
    pressure?: number,
    timestamp?: number,
    additionalData?: Partial<StrokeInput>
  ): StrokeInput {
    const currentTime = timestamp || performance.now();
    
    // Calculate velocity based on position change
    const velocity = this.calculateVelocity(x, y, currentTime);
    
    // Calculate tilt (placeholder - would come from stylus data)
    const tilt = this.calculateTilt();
    
    // Calculate stroke progress
    const strokeProgress = this.calculateStrokeProgress(currentTime);

    const strokeInput: StrokeInput = {
      x,
      y,
      pressure: pressure || this.simulatePressure(velocity),
      velocity,
      tiltX: tilt?.x || 0,
      tiltY: tilt?.y || 0,
      timestamp: currentTime,
      ...additionalData
    };

    // Update tracking data
    this.updateTrackingData(x, y, currentTime);

    return strokeInput;
  }

  /**
   * Start a new stroke (mouse down / pen down)
   */
  startStroke(x: number, y: number, timestamp?: number): StrokeInput {
    const currentTime = timestamp || performance.now();
    
    this.isStrokeActive = true;
    this.strokeStartTime = currentTime;
    this.lastPosition = { x, y };
    this.lastTimestamp = currentTime;

    return this.createStrokeInput(x, y, 0.5, currentTime, {});
  }

  /**
   * Continue an active stroke (mouse move / pen move)
   */
  continueStroke(x: number, y: number, pressure?: number, timestamp?: number): StrokeInput {
    if (!this.isStrokeActive) {
      return this.startStroke(x, y, timestamp);
    }

    return this.createStrokeInput(x, y, pressure, timestamp);
  }

  /**
   * End the current stroke (mouse up / pen up)
   */
  endStroke(x: number, y: number, timestamp?: number): StrokeInput {
    const currentTime = timestamp || performance.now();
    
    const strokeInput = this.createStrokeInput(x, y, 0, currentTime, {});

    this.isStrokeActive = false;
    return strokeInput;
  }

  /**
   * Calculate velocity based on position change over time
   */
  private calculateVelocity(x: number, y: number, timestamp: number): number {
    if (this.lastTimestamp === 0) {
      return 0;
    }

    const deltaTime = timestamp - this.lastTimestamp;
    if (deltaTime <= 0) {
      return 0;
    }

    const deltaX = x - this.lastPosition.x;
    const deltaY = y - this.lastPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Velocity in pixels per millisecond
    return distance / deltaTime;
  }

  /**
   * Calculate tilt (placeholder for stylus support)
   */
  private calculateTilt(): { x: number; y: number } {
    // For mouse input, tilt is neutral
    // For stylus input, this would use PointerEvent.tiltX/tiltY
    return { x: 0, y: 0 };
  }

  /**
   * Calculate stroke progress (0 at start, 1 at end)
   */
  private calculateStrokeProgress(timestamp: number): number {
    if (!this.isStrokeActive || this.strokeStartTime === 0) {
      return 0;
    }

    // For now, progress is based on time (could be based on distance)
    const strokeDuration = timestamp - this.strokeStartTime;
    const maxStrokeDuration = 5000; // 5 seconds max stroke
    
    return Math.min(strokeDuration / maxStrokeDuration, 1.0);
  }

  /**
   * Simulate pressure for mouse input based on velocity
   */
  private simulatePressure(velocity: number): number {
    // Simulate pressure based on velocity
    // Fast movement = higher pressure, slow movement = lower pressure
    const baselinePressure = 0.5;
    const velocityInfluence = 0.3;
    
    // Normalize velocity (assuming max useful velocity is around 2.0 pixels/ms)
    const normalizedVelocity = Math.min(velocity / 2.0, 1.0);
    
    // Apply velocity influence
    let pressure = baselinePressure + (normalizedVelocity * velocityInfluence);
    
    // Add slight randomness for natural feel
    pressure += (Math.random() - 0.5) * 0.1;
    
    // Clamp to valid range
    return Math.max(0, Math.min(1, pressure));
  }

  /**
   * Update internal tracking data
   */
  private updateTrackingData(x: number, y: number, timestamp: number): void {
    this.lastPosition.x = x;
    this.lastPosition.y = y;
    this.lastTimestamp = timestamp;
  }

  /**
   * Reset factory state
   */
  reset(): void {
    this.lastPosition = { x: 0, y: 0 };
    this.lastTimestamp = 0;
    this.strokeStartTime = 0;
    this.isStrokeActive = false;
  }

  /**
   * Check if a stroke is currently active
   */
  isStrokeInProgress(): boolean {
    return this.isStrokeActive;
  }

  /**
   * Get current velocity for external use
   */
  getCurrentVelocity(): number {
    return this.calculateVelocity(this.lastPosition.x, this.lastPosition.y, performance.now());
  }
}

/**
 * Utility functions for stroke input creation
 */
export const StrokeInputUtils = {
  /**
   * Create stroke input from mouse event
   */
  fromMouseEvent(event: MouseEvent, canvas: HTMLElement): StrokeInput {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    return {
      x,
      y,
      pressure: 0.5, // Default pressure for mouse
      velocity: 0, // Will be calculated by factory
      tiltX: 0,
      tiltY: 0,
      timestamp: performance.now()
    };
  },

  /**
   * Create stroke input from pointer event (supports stylus)
   */
  fromPointerEvent(event: PointerEvent, canvas: HTMLElement): StrokeInput {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    return {
      x,
      y,
      pressure: event.pressure || 0.5,
      velocity: 0, // Will be calculated by factory
      tiltX: event.tiltX || 0,
      tiltY: event.tiltY || 0,
      timestamp: performance.now()
    };
  }
};