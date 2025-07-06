import { 
  BrushComponent, 
  ComponentType, 
  PressureHandlerParams, 
  StrokeInput 
} from '@/types/brush';

/**
 * PressureHandlerComponent - Process tablet/mouse input and simulate natural pressure curves
 * Priority: 10 (first in pipeline to establish pressure values)
 */
export class PressureHandlerComponent implements BrushComponent {
  public readonly id: string;
  public readonly type = ComponentType.PRESSURE_HANDLER;
  public readonly priority = 10;
  public enabled = true;
  public parameters: PressureHandlerParams;

  private pressureHistory: number[] = [];
  private velocityHistory: number[] = [];
  private lastPosition: { x: number; y: number } | null = null;
  private lastTimestamp: number = 0;

  constructor(id: string, params: PressureHandlerParams) {
    this.id = id;
    this.parameters = params;
  }

  /**
   * Execute pressure processing based on input type
   */
  execute(input: StrokeInput): number {
    let pressure = input.pressure || 0.5;

    if (this.parameters.inputSource === 'mouse') {
      // Simulate pressure from mouse velocity for mouse users
      pressure = this.calculateVelocityPressure(input);
    }

    // Apply pressure curve transformation
    pressure = this.applyPressureCurve(pressure);

    // Apply smoothing to reduce jitter
    pressure = this.smoothPressure(pressure);

    // Ensure minimum pressure threshold
    return Math.max(this.parameters.minimumPressure, pressure);
  }

  /**
   * Calculate simulated pressure from mouse velocity
   */
  private calculateVelocityPressure(input: StrokeInput): number {
    if (!this.lastPosition || !this.lastTimestamp) {
      this.lastPosition = { x: input.x, y: input.y };
      this.lastTimestamp = input.timestamp;
      return 0.5; // Default pressure for first point
    }

    // Calculate velocity
    const deltaX = input.x - this.lastPosition.x;
    const deltaY = input.y - this.lastPosition.y;
    const deltaTime = Math.max(1, input.timestamp - this.lastTimestamp);
    
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / deltaTime;

    // Store velocity in history for smoothing
    this.velocityHistory.push(velocity);
    if (this.velocityHistory.length > 5) {
      this.velocityHistory.shift();
    }

    // Calculate average velocity
    const avgVelocity = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;

    // Convert velocity to pressure (inverse relationship - faster = lighter pressure)
    const maxVelocity = 5; // Adjust based on testing
    const velocityPressure = Math.max(0.1, 1 - (avgVelocity / maxVelocity));

    // Apply velocity influence parameter
    const basePressure = input.pressure || 0.5;
    const finalPressure = basePressure + 
      (velocityPressure - basePressure) * this.parameters.velocityInfluence;

    // Update tracking
    this.lastPosition = { x: input.x, y: input.y };
    this.lastTimestamp = input.timestamp;

    return Math.max(0, Math.min(1, finalPressure));
  }

  /**
   * Apply pressure curve transformation
   */
  private applyPressureCurve(pressure: number): number {
    if (!this.parameters.pressureCurve || this.parameters.pressureCurve.length < 2) {
      return pressure;
    }

    const curve = this.parameters.pressureCurve;
    const segments = curve.length - 1;
    const segmentSize = 1 / segments;
    
    // Find which segment the pressure falls into
    const segmentIndex = Math.min(segments - 1, Math.floor(pressure / segmentSize));
    const segmentProgress = (pressure - segmentIndex * segmentSize) / segmentSize;

    // Linear interpolation between curve points
    const startValue = curve[segmentIndex];
    const endValue = curve[segmentIndex + 1];
    
    return startValue + (endValue - startValue) * segmentProgress;
  }

  /**
   * Apply smoothing to reduce pressure jitter
   */
  private smoothPressure(pressure: number): number {
    if (this.parameters.smoothing === 0) {
      return pressure;
    }

    // Add to history
    this.pressureHistory.push(pressure);
    
    // Limit history size based on smoothing amount
    const historySize = Math.ceil(this.parameters.smoothing * 10);
    if (this.pressureHistory.length > historySize) {
      this.pressureHistory.shift();
    }

    // Calculate weighted average (more recent = higher weight)
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < this.pressureHistory.length; i++) {
      const weight = (i + 1) / this.pressureHistory.length; // Linear weighting
      weightedSum += this.pressureHistory[i] * weight;
      totalWeight += weight;
    }

    return weightedSum / totalWeight;
  }

  /**
   * Reset component state (for new strokes)
   */
  reset(): void {
    this.pressureHistory = [];
    this.velocityHistory = [];
    this.lastPosition = null;
    this.lastTimestamp = 0;
  }

  /**
   * Update component parameters
   */
  updateParameters(newParams: Partial<PressureHandlerParams>): void {
    this.parameters = { ...this.parameters, ...newParams };
  }

  /**
   * Get component info for debugging/UI
   */
  getInfo(): { type: string; enabled: boolean; params: any } {
    return {
      type: this.type,
      enabled: this.enabled,
      params: this.parameters
    };
  }

  /**
   * Clone component with new ID
   */
  clone(newId: string): PressureHandlerComponent {
    return new PressureHandlerComponent(newId, { ...this.parameters });
  }
}