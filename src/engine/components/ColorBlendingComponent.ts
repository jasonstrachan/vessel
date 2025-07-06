import { 
  BrushComponent, 
  ComponentType, 
  ColorBlendingParams, 
  StrokeInput 
} from '@/types/brush';

/**
 * ColorBlendingComponent - Handle color processing, blending, and variations
 * Priority: 40 (late in pipeline, after size/opacity but before final rendering)
 */
export class ColorBlendingComponent implements BrushComponent {
  public readonly id: string;
  public readonly type = ComponentType.COLOR_BLENDING;
  public readonly priority = 40;
  public enabled = true;
  public parameters: ColorBlendingParams;

  private baseColor: string = '#000000'; // Base color from brush settings

  constructor(id: string, params: ColorBlendingParams) {
    this.id = id;
    this.parameters = params;
  }

  /**
   * Set the base color from brush settings
   */
  setBaseColor(color: string): void {
    this.baseColor = color;
  }

  /**
   * Execute color processing based on input and return final color
   */
  execute(input: StrokeInput): string {
    let finalColor = this.baseColor;

    // Apply hue shift if specified
    if (this.parameters.hueShift !== 0) {
      finalColor = this.applyHueShift(finalColor, this.parameters.hueShift);
    }

    // Apply saturation adjustment if specified
    if (this.parameters.saturationAdjust !== 0) {
      finalColor = this.applySaturationAdjust(finalColor, this.parameters.saturationAdjust);
    }

    // Apply color variation if specified
    if (this.parameters.colorVariation > 0) {
      finalColor = this.applyColorVariation(finalColor, input, this.parameters.colorVariation);
    }

    return finalColor;
  }

  /**
   * Convert hex color to HSL for manipulation
   */
  private hexToHsl(hex: string): { h: number; s: number; l: number } {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (diff !== 0) {
      s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
      
      switch (max) {
        case r: h = (g - b) / diff + (g < b ? 6 : 0); break;
        case g: h = (b - r) / diff + 2; break;
        case b: h = (r - g) / diff + 4; break;
      }
      h /= 6;
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  /**
   * Convert HSL back to hex
   */
  private hslToHex(h: number, s: number, l: number): string {
    h = h / 360;
    s = s / 100;
    l = l / 100;

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    let r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Apply hue shift to color
   */
  private applyHueShift(color: string, shift: number): string {
    const hsl = this.hexToHsl(color);
    hsl.h = (hsl.h + shift + 360) % 360; // Wrap around
    return this.hslToHex(hsl.h, hsl.s, hsl.l);
  }

  /**
   * Apply saturation adjustment to color
   */
  private applySaturationAdjust(color: string, adjust: number): string {
    const hsl = this.hexToHsl(color);
    hsl.s = Math.max(0, Math.min(100, hsl.s + (adjust * 100)));
    return this.hslToHex(hsl.h, hsl.s, hsl.l);
  }

  /**
   * Apply color variation based on position for consistent randomness
   */
  private applyColorVariation(color: string, input: StrokeInput, variation: number): string {
    if (variation === 0) return color;

    // Use position for consistent variation
    const x = Math.floor(input.x / 5); // Quantize for consistency
    const y = Math.floor(input.y / 5);
    
    // Simple hash for pseudo-random values
    let hash = 12345; // seed
    hash = ((hash << 5) - hash + x) & 0xffffffff;
    hash = ((hash << 5) - hash + y) & 0xffffffff;
    hash = Math.abs(hash);
    
    // Generate variation amounts
    const hueVariation = ((hash % 1000) / 1000 - 0.5) * variation * 60; // ±30 degrees max
    const satVariation = ((hash % 1500) / 1500 - 0.5) * variation * 40; // ±20% max
    const lightVariation = ((hash % 2000) / 2000 - 0.5) * variation * 30; // ±15% max

    const hsl = this.hexToHsl(color);
    hsl.h = (hsl.h + hueVariation + 360) % 360;
    hsl.s = Math.max(0, Math.min(100, hsl.s + satVariation));
    hsl.l = Math.max(0, Math.min(100, hsl.l + lightVariation));

    return this.hslToHex(hsl.h, hsl.s, hsl.l);
  }

  /**
   * Get blend mode for canvas operations
   */
  getBlendMode(): string {
    return this.parameters.blendMode;
  }

  /**
   * Update component parameters
   */
  updateParameters(newParams: Partial<ColorBlendingParams>): void {
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
  clone(newId: string): ColorBlendingComponent {
    const cloned = new ColorBlendingComponent(newId, { ...this.parameters });
    cloned.setBaseColor(this.baseColor);
    return cloned;
  }
}