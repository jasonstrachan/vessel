'use client';

import { 
  BrushComponent, 
  ComponentType, 
  StrokeInput, 
  OpacityParams 
} from '@/types/brush';

/**
 * OpacityModifierComponent - Transparency and blending effects
 * Controls brush transparency with pressure sensitivity and fade effects
 */
export class OpacityModifierComponent implements BrushComponent {
  public readonly id: string;
  public readonly type = ComponentType.OPACITY_MODIFIER;
  public readonly priority = 30; // After size, before anti-aliasing
  public enabled = true;
  public parameters: OpacityParams;

  private strokeStartTime = 0;
  private lastOpacity = 1.0;

  constructor(id: string, params: Partial<OpacityParams> = {}) {
    this.id = id;
    this.parameters = {
      baseOpacity: 1.0,
      pressureInfluence: 0.5,
      velocityInfluence: 0.2,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      minOpacity: 0.1,
      maxOpacity: 1.0,
      opacityJitter: 0,
      buildup: false,
      buildupRate: 0.1,
      ...params
    };
  }

  execute(input: StrokeInput): number {
    const pressure = input.pressure || 0.5;
    const velocity = this.calculateVelocity(input);
    const strokeProgress = this.calculateStrokeProgress(input);
    
    let opacity = this.parameters.baseOpacity;
    
    // Apply pressure influence
    if (this.parameters.pressureInfluence > 0) {
      opacity *= this.calculatePressureOpacity(pressure);
    }
    
    // Apply velocity influence
    if (this.parameters.velocityInfluence > 0) {
      opacity *= this.calculateVelocityOpacity(velocity);
    }
    
    // Apply fade effects
    opacity *= this.calculateFadeOpacity(strokeProgress);
    
    // Apply jitter for natural variation
    if (this.parameters.opacityJitter > 0) {
      opacity *= this.calculateJitteredOpacity();
    }
    
    // Apply buildup effect
    if (this.parameters.buildup) {
      opacity = this.calculateBuildupOpacity(opacity);
    }
    
    // Clamp to bounds
    opacity = Math.max(this.parameters.minOpacity, 
                      Math.min(this.parameters.maxOpacity, opacity));
    
    this.lastOpacity = opacity;
    return opacity;
  }

  private calculatePressureOpacity(pressure: number): number {
    // Map pressure (0-1) to opacity multiplier
    const pressureRange = 1 - this.parameters.pressureInfluence;
    return pressureRange + (pressure * this.parameters.pressureInfluence);
  }

  private calculateVelocityOpacity(velocity: number): number {
    // Higher velocity can reduce opacity for natural brush behavior
    const normalizedVelocity = Math.min(velocity / 100, 2); // Normalize to 0-2 range
    const velocityReduction = normalizedVelocity * this.parameters.velocityInfluence;
    
    return Math.max(0.1, 1 - velocityReduction);
  }

  private calculateFadeOpacity(strokeProgress: number): number {
    let fadeMultiplier = 1.0;
    
    // Fade in at stroke start
    if (this.parameters.fadeInDuration > 0) {
      const fadeInProgress = Math.min(strokeProgress / this.parameters.fadeInDuration, 1);
      fadeMultiplier *= this.easeInOut(fadeInProgress);
    }
    
    // Fade out at stroke end (would need stroke end detection)
    if (this.parameters.fadeOutDuration > 0) {
      // This would need stroke end prediction or explicit end signals
      // For now, we'll skip fade-out as it requires more context
    }
    
    return fadeMultiplier;
  }

  private calculateJitteredOpacity(): number {
    // Add subtle random variation
    const jitterRange = this.parameters.opacityJitter;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange; // -jitterRange to +jitterRange
    return 1 + jitter;
  }

  private calculateBuildupOpacity(baseOpacity: number): number {
    // Gradual buildup effect - opacity increases over time at same location
    const buildupFactor = Math.min(1, this.lastOpacity + this.parameters.buildupRate);
    return Math.min(baseOpacity, buildupFactor);
  }

  private calculateStrokeProgress(input: StrokeInput): number {
    // Calculate how far we are into the current stroke
    if (this.strokeStartTime === 0) {
      this.strokeStartTime = input.timestamp || Date.now();
    }
    
    const currentTime = input.timestamp || Date.now();
    return (currentTime - this.strokeStartTime) / 1000; // Progress in seconds
  }

  private calculateVelocity(input: StrokeInput): number {
    // Simple velocity calculation
    // In a real implementation, this would use previous stroke positions
    return Math.random() * 50; // Placeholder
  }

  private easeInOut(t: number): number {
    // Smooth easing function for fade effects
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Advanced opacity effects
  
  /**
   * Calculate opacity for flow-based painting
   * Flow affects how quickly opacity builds up
   */
  calculateFlowOpacity(flow: number, deltaTime: number): number {
    const flowRate = flow * this.parameters.buildupRate;
    const deltaOpacity = flowRate * deltaTime;
    
    return Math.min(this.parameters.maxOpacity, this.lastOpacity + deltaOpacity);
  }

  /**
   * Calculate opacity for airbrush-style effects
   * Creates gradual buildup with distance falloff
   */
  calculateAirbrushOpacity(distance: number, maxDistance: number): number {
    const falloff = Math.max(0, 1 - (distance / maxDistance));
    const airbrushOpacity = this.parameters.baseOpacity * falloff;
    
    return Math.max(this.parameters.minOpacity, airbrushOpacity);
  }

  /**
   * Calculate opacity for texture-sensitive brushes
   * Opacity varies based on underlying texture
   */
  calculateTextureOpacity(textureValue: number): number {
    // textureValue should be 0-1 representing texture intensity
    const textureInfluence = 0.3; // How much texture affects opacity
    const opacityModifier = 1 + (textureValue - 0.5) * textureInfluence;
    
    return this.parameters.baseOpacity * opacityModifier;
  }

  // Configuration methods
  
  setBaseOpacity(opacity: number) {
    this.parameters.baseOpacity = Math.max(0, Math.min(1, opacity));
  }

  setPressureInfluence(influence: number) {
    this.parameters.pressureInfluence = Math.max(0, Math.min(1, influence));
  }

  setVelocityInfluence(influence: number) {
    this.parameters.velocityInfluence = Math.max(0, Math.min(1, influence));
  }

  setFadeSettings(fadeIn: number, fadeOut: number) {
    this.parameters.fadeInDuration = Math.max(0, fadeIn);
    this.parameters.fadeOutDuration = Math.max(0, fadeOut);
  }

  setOpacityBounds(min: number, max: number) {
    this.parameters.minOpacity = Math.max(0, Math.min(1, min));
    this.parameters.maxOpacity = Math.max(min, Math.min(1, max));
  }

  setJitter(jitter: number) {
    this.parameters.opacityJitter = Math.max(0, Math.min(0.5, jitter));
  }

  enableBuildup(enabled: boolean, rate: number = 0.1) {
    this.parameters.buildup = enabled;
    this.parameters.buildupRate = Math.max(0, Math.min(1, rate));
  }

  reset() {
    this.strokeStartTime = 0;
    this.lastOpacity = this.parameters.baseOpacity;
  }
}