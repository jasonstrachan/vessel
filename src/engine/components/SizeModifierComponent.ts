import { 
  BrushComponent, 
  ComponentType, 
  SizeModifierParams, 
  StrokeInput 
} from '@/types/brush';

/**
 * SizeModifierComponent - Calculate final brush size with pressure sensitivity and variation
 * Priority: 20 (early in pipeline, after pressure handler)
 */
export class SizeModifierComponent implements BrushComponent {
  public readonly id: string;
  public readonly type = ComponentType.SIZE_MODIFIER;
  public readonly priority = 20;
  public enabled = true;
  public parameters: SizeModifierParams;

  constructor(id: string, params: SizeModifierParams) {
    this.id = id;
    this.parameters = params;
  }

  /**
   * Execute size calculation based on input and pressure
   */
  execute(input: StrokeInput): number {
    
    const pressure = input.pressure || 0.5;
    const variation = this.calculateVariation(input);
    
    // Calculate pressure-influenced size
    const pressureMultiplier = 1 + (pressure - 0.5) * this.parameters.pressureInfluence;
    
    // Calculate variation (seeded random for consistency)
    const variationMultiplier = 1 + variation * this.parameters.variationAmount;
    
    // Apply calculations
    const calculatedSize = this.parameters.baseSize * pressureMultiplier * variationMultiplier;
    
    // Clamp to min/max bounds
    const finalSize = Math.max(
      this.parameters.minSize,
      Math.min(this.parameters.maxSize, calculatedSize)
    );
    
    return finalSize;
  }

  /**
   * Calculate pseudo-random variation based on position and seed
   */
  private calculateVariation(input: StrokeInput): number {
    if (this.parameters.variationAmount === 0) return 0;
    
    // Use position and seed for consistent variation
    const seed = this.parameters.variationSeed;
    const x = Math.floor(input.x / 10); // Quantize position for consistency
    const y = Math.floor(input.y / 10);
    
    // Simple hash function for pseudo-random values
    let hash = seed;
    hash = ((hash << 5) - hash + x) & 0xffffffff;
    hash = ((hash << 5) - hash + y) & 0xffffffff;
    hash = Math.abs(hash);
    
    // Normalize to -1 to 1 range
    return ((hash % 2000) / 1000) - 1;
  }

  /**
   * Update component parameters
   */
  updateParameters(newParams: Partial<SizeModifierParams>): void {
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
  clone(newId: string): SizeModifierComponent {
    return new SizeModifierComponent(newId, { ...this.parameters });
  }
}