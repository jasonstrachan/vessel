import { 
  BrushComponent, 
  ComponentType, 
  AntiAliasingParams, 
  StrokeInput 
} from '@/types/brush';

/**
 * AntiAliasingComponent - Control pixel-perfect vs antialiased rendering per brush
 * Priority: 50 (mid-pipeline, after size/opacity calculations)
 */
export class AntiAliasingComponent implements BrushComponent {
  public readonly id: string;
  public readonly type = ComponentType.ANTI_ALIASING;
  public readonly priority = 50;
  public enabled = true;
  public parameters: AntiAliasingParams;

  constructor(id: string, params: AntiAliasingParams) {
    this.id = id;
    this.parameters = params;
  }

  /**
   * Execute anti-aliasing settings based on mode
   */
  execute(input: StrokeInput): RenderSettings {
    if (this.parameters.mode === 'pixel') {
      return this.getPixelPerfectSettings();
    } else {
      return this.getAntialiasedSettings();
    }
  }

  /**
   * Get pixel-perfect rendering settings
   */
  private getPixelPerfectSettings(): RenderSettings {
    return {
      antiAliasing: false,
      pixelAlignment: this.parameters.pixelAlignment,
      smoothing: false,
      snapToGrid: true,
      edgeSharpness: 1.0, // Maximum sharpness for pixel art
      subpixelPrecision: false
    };
  }

  /**
   * Get antialiased rendering settings
   */
  private getAntialiasedSettings(): RenderSettings {
    return {
      antiAliasing: true,
      pixelAlignment: false,
      smoothing: true,
      snapToGrid: false,
      edgeSharpness: this.parameters.edgeSharpness,
      subpixelPrecision: this.parameters.subpixelPrecision
    };
  }

  /**
   * Check if brush should use pixel-perfect mode
   */
  isPixelPerfect(): boolean {
    return this.parameters.mode === 'pixel';
  }

  /**
   * Update component parameters
   */
  updateParameters(newParams: Partial<AntiAliasingParams>): void {
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
  clone(newId: string): AntiAliasingComponent {
    return new AntiAliasingComponent(newId, { ...this.parameters });
  }
}

/**
 * Render settings output from AntiAliasingComponent
 */
export interface RenderSettings {
  antiAliasing: boolean;
  pixelAlignment: boolean;
  smoothing: boolean;
  snapToGrid: boolean;
  edgeSharpness: number;
  subpixelPrecision: boolean;
}