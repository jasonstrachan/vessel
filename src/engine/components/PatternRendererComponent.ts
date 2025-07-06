'use client';

import { 
  BrushComponent, 
  ComponentType, 
  StrokeInput
} from '@/types/brush';

/**
 * PatternRendererComponent - Custom patterns and textures
 * Handles brush pattern rendering with texture support
 */
export class PatternRendererComponent implements BrushComponent {
  id: string;
  type = ComponentType.PATTERN_RENDERER;
  priority = 3; // Mid-priority - affects visual appearance
  enabled = true;
  parameters: any;

  constructor(id: string, params: any = {}) {
    this.id = id;
    this.parameters = {
      patternType: 'solid',
      textureImage: null,
      noiseIntensity: 0.1,
      patternScale: 1.0,
      randomSeed: Math.random(),
      ...params
    };
  }

  execute(input: StrokeInput): any {
    return {
      pattern: this.generatePattern(input),
      renderMode: this.getRenderMode(),
      patternOffset: this.calculatePatternOffset(input)
    };
  }

  private generatePattern(input: StrokeInput): any {
    switch (this.parameters.patternType) {
      case 'solid':
        return this.createSolidPattern();
      
      case 'noise':
        return this.createNoisePattern(input);
      
      case 'texture':
        return this.createTexturePattern(input);
      
      case 'hatching':
        return this.createHatchingPattern(input);
      
      case 'crosshatch':
        return this.createCrosshatchPattern(input);
      
      default:
        return this.createSolidPattern();
    }
  }

  private createSolidPattern(): any {
    return {
      type: 'solid',
      opacity: 1.0,
      fillStyle: 'solid'
    };
  }

  private createNoisePattern(input: StrokeInput): any {
    // Generate procedural noise based on position
    const noiseValue = this.generateNoise(
      input.x * this.parameters.patternScale,
      input.y * this.parameters.patternScale,
      this.parameters.randomSeed
    );

    return {
      type: 'noise',
      noiseValue,
      opacity: Math.max(0, 1 - (noiseValue * this.parameters.noiseIntensity)),
      variation: noiseValue * 0.5
    };
  }

  private createTexturePattern(input: StrokeInput): any {
    if (!this.parameters.textureImage) {
      return this.createSolidPattern();
    }

    // Calculate texture coordinates based on stroke position
    const textureX = (input.x * this.parameters.patternScale) % 1;
    const textureY = (input.y * this.parameters.patternScale) % 1;

    return {
      type: 'texture',
      textureCoords: { x: textureX, y: textureY },
      textureImage: this.parameters.textureImage,
      opacity: 1.0
    };
  }

  private createHatchingPattern(input: StrokeInput): any {
    // Create parallel lines pattern
    const lineSpacing = 5 * this.parameters.patternScale;
    const lineAngle = 45; // degrees
    
    // Calculate if current position should have a line
    const rotatedX = input.x * Math.cos(lineAngle * Math.PI / 180) - 
                     input.y * Math.sin(lineAngle * Math.PI / 180);
    const shouldDraw = (Math.floor(rotatedX / lineSpacing) % 2) === 0;

    return {
      type: 'hatching',
      shouldDraw,
      lineSpacing,
      lineAngle,
      opacity: shouldDraw ? 1.0 : 0.0
    };
  }

  private createCrosshatchPattern(input: StrokeInput): any {
    // Combine two hatching patterns at different angles
    const hatch1 = this.createHatchingPattern(input);
    
    // Second set of lines at perpendicular angle
    const lineSpacing = 5 * this.parameters.patternScale;
    const lineAngle = -45; // perpendicular to first set
    
    const rotatedX = input.x * Math.cos(lineAngle * Math.PI / 180) - 
                     input.y * Math.sin(lineAngle * Math.PI / 180);
    const shouldDraw2 = (Math.floor(rotatedX / lineSpacing) % 2) === 0;

    return {
      type: 'crosshatch',
      hatch1: hatch1.shouldDraw,
      hatch2: shouldDraw2,
      opacity: (hatch1.shouldDraw || shouldDraw2) ? 1.0 : 0.3,
      intensity: (hatch1.shouldDraw && shouldDraw2) ? 1.0 : 0.7
    };
  }

  private getRenderMode(): string {
    switch (this.parameters.patternType) {
      case 'texture':
        return 'texture-multiply';
      case 'noise':
        return 'alpha-modulate';
      case 'hatching':
      case 'crosshatch':
        return 'line-pattern';
      default:
        return 'normal';
    }
  }

  private calculatePatternOffset(input: StrokeInput): { x: number; y: number } {
    // Pattern offset based on stroke position for seamless tiling
    return {
      x: (input.x * this.parameters.patternScale) % 1,
      y: (input.y * this.parameters.patternScale) % 1
    };
  }

  private generateNoise(x: number, y: number, seed: number): number {
    // Simple 2D noise function
    const a = 12.9898;
    const b = 78.233;
    const c = 43758.5453;
    
    const dt = x * a + y * b + seed;
    const sn = Math.sin(dt);
    
    return (sn * c) % 1;
  }

  // Pattern management methods
  setPattern(patternType: string) {
    this.parameters.patternType = patternType;
  }

  setTextureImage(imageData: any) {
    this.parameters.textureImage = imageData;
  }

  setNoiseIntensity(intensity: number) {
    this.parameters.noiseIntensity = Math.max(0, Math.min(1, intensity));
  }

  setPatternScale(scale: number) {
    this.parameters.patternScale = Math.max(0.1, Math.min(10, scale));
  }

  randomizePattern() {
    this.parameters.randomSeed = Math.random();
  }
}