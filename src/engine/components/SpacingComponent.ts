import { ComponentType, SpacingParams } from '@/types/brush';
import { BrushComponent, StrokeInput, StrokeResult } from '@/types/brush';

export class SpacingComponent {
  id: string;
  type: ComponentType.SPACING;
  parameters: SpacingParams;
  priority: number;
  enabled: boolean;
  
  private spacingDistance: number = 0;
  private lastStampPosition: { x: number; y: number } | null = null;

  constructor(component: BrushComponent) {
    this.id = component.id;
    this.type = ComponentType.SPACING;
    this.parameters = component.parameters as SpacingParams;
    this.priority = component.priority;
    this.enabled = component.enabled;
  }

  execute(input: StrokeInput): StrokeResult {
    if (!this.enabled) {
      return { 
        shouldDraw: true, 
        size: 1,
        opacity: 1,
        color: '#000000',
        rotation: 0,
        pattern: undefined,
        blendMode: 'normal',
        antialiased: false
      };
    }

    const { x, y, velocity } = input;
    
    // First stamp always draws
    if (!this.lastStampPosition) {
      this.lastStampPosition = { x, y };
      this.spacingDistance = 0;
      return {
        shouldDraw: true,
        size: 1,
        opacity: 1,
        color: '#000000',
        rotation: 0,
        pattern: undefined,
        blendMode: 'normal',
        antialiased: false
      };
    }
    
    // Calculate distance from last stamp position
    const distanceFromLastStamp = Math.sqrt(
      Math.pow(x - this.lastStampPosition.x, 2) + 
      Math.pow(y - this.lastStampPosition.y, 2)
    );

    // Add to spacing distance tracker
    this.spacingDistance += distanceFromLastStamp;

    // Calculate effective spacing
    const effectiveSpacing = this.calculateEffectiveSpacing(velocity || 0);

    // Check if we should render a stamp
    const shouldRender = this.spacingDistance >= effectiveSpacing;

    if (shouldRender) {
      // Reset spacing distance (keep remainder for continuous spacing)
      this.spacingDistance = this.spacingDistance % effectiveSpacing;
      this.lastStampPosition = { x, y };
    }

    return {
      shouldDraw: shouldRender,
      size: 1,
      opacity: 1,
      color: '#000000',
      rotation: 0,
      pattern: undefined,
      blendMode: 'normal',
      antialiased: false
    };
  }

  private calculateEffectiveSpacing(velocity: number): number {
    const baseSpacing = this.parameters.fixedSpacing || this.parameters.defaultSpacing;
    
    if (!this.parameters.dynamicEnabled) {
      return baseSpacing;
    }

    // Dynamic spacing: faster movement = larger spacing
    const velocityInfluence = this.parameters.velocityInfluence || 0.5;
    const speedFactor = Math.min(velocity / 10, 3); // Cap at 3x spacing
    const dynamicSpacing = baseSpacing * (1 + speedFactor * velocityInfluence);

    // Clamp to min/max spacing values
    return Math.max(
      this.parameters.minSpacing || baseSpacing * 0.5,
      Math.min(dynamicSpacing, this.parameters.maxSpacing || baseSpacing * 3)
    );
  }

  reset(): void {
    this.spacingDistance = 0;
    this.lastStampPosition = null;
  }

  updateParameters(newParams: Partial<SpacingParams>): void {
    this.parameters = { ...this.parameters, ...newParams };
  }

  getPerformanceMetrics(): { executionTime: number; cacheHits: number; cacheMisses: number } {
    return {
      executionTime: 0, // Spacing component is very fast
      cacheHits: 0,
      cacheMisses: 0
    };
  }
}