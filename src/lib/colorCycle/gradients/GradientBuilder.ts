/**
 * GradientBuilder - Advanced gradient generation from extracted colors
 * 
 * Creates smooth, visually pleasing gradients with perceptual interpolation,
 * color harmony analysis, and intelligent stop placement.
 */

import { OKLabConverter, OKLabColor, RGBColor, OKLChColor } from '../colorSpace/OKLabConverter';

export interface GradientStop {
  position: number; // 0-1
  color: string; // CSS color string
  oklabColor?: OKLabColor;
  weight?: number; // Influence strength for this color
}

export interface GradientOptions {
  interpolationMode: 'linear' | 'perceptual' | 'oklab' | 'smooth';
  distributionMode: 'uniform' | 'weighted' | 'harmonic' | 'adaptive';
  smoothness: number; // 0-1, higher = smoother transitions
  colorHarmonies: boolean; // Apply color harmony rules
  contrastBoost: number; // 0-2, enhance contrast
  preserveEndpoints: boolean; // Keep first/last colors exact
  minStopDistance: number; // Minimum distance between stops
}

export interface GradientAnalysis {
  totalRange: number; // Color range coverage
  smoothness: number; // Transition smoothness score
  contrast: number; // Overall contrast
  harmony: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'mixed';
  dominantHue: number; // Primary hue in degrees
  temperature: 'warm' | 'cool' | 'neutral';
  quality: number; // Overall gradient quality score (0-1)
}

export class GradientBuilder {
  private options: GradientOptions;
  
  constructor(options: Partial<GradientOptions> = {}) {
    this.options = {
      interpolationMode: 'perceptual',
      distributionMode: 'adaptive',
      smoothness: 0.7,
      colorHarmonies: true,
      contrastBoost: 1.0,
      preserveEndpoints: true,
      minStopDistance: 0.05,
      ...options
    };
  }

  /**
   * Build gradient from extracted colors with intelligent optimization
   */
  buildGradient(
    extractedColors: Array<{ color: string; frequency?: number }>,
    targetStops: number = 8
  ): GradientStop[] {
    if (extractedColors.length === 0) {
      return this.createDefaultGradient(targetStops);
    }

    // Convert colors to OKLab for processing
    const oklabColors = extractedColors.map(({ color, frequency = 1 }) => ({
      color,
      oklabColor: this.parseColorToOKLab(color),
      weight: frequency
    }));

    // Sort colors for optimal ordering
    const sortedColors = this.sortColorsForGradient(oklabColors);

    // Generate gradient stops with intelligent distribution
    let stops = this.distributeGradientStops(sortedColors, targetStops);

    // Apply smoothing and optimization
    stops = this.optimizeGradientStops(stops);

    // Apply color harmonies if enabled
    if (this.options.colorHarmonies) {
      stops = this.applyColorHarmonies(stops);
    }

    // Ensure minimum distances between stops
    stops = this.enforceMinimumDistances(stops);

    return stops;
  }

  /**
   * Create smooth gradient with perceptual interpolation
   */
  createSmoothGradient(
    startColor: string,
    endColor: string,
    intermediateColors: string[] = [],
    stops: number = 8
  ): GradientStop[] {
    const allColors = [startColor, ...intermediateColors, endColor];
    const oklabColors = allColors.map(color => ({
      color,
      oklabColor: this.parseColorToOKLab(color),
      weight: 1
    }));

    // Create smooth interpolation between colors
    const gradientStops: GradientStop[] = [];

    for (let i = 0; i < stops; i++) {
      const position = i / (stops - 1);
      
      let interpolatedColor: OKLabColor;
      
      if (this.options.interpolationMode === 'perceptual' || this.options.interpolationMode === 'oklab') {
        interpolatedColor = this.interpolateOKLab(oklabColors, position);
      } else {
        interpolatedColor = this.interpolateLinear(oklabColors, position);
      }

      const rgbColor = OKLabConverter.okLabToRGB(interpolatedColor);
      const cssColor = `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`;

      gradientStops.push({
        position,
        color: cssColor,
        oklabColor: interpolatedColor,
        weight: 1
      });
    }

    return gradientStops;
  }

  /**
   * Generate gradient from color harmony rules
   */
  createHarmoniousGradient(
    baseColor: string,
    harmonyType: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'split-complementary',
    stops: number = 8
  ): GradientStop[] {
    const baseOKLab = this.parseColorToOKLab(baseColor);
    const baseOKLCh = OKLabConverter.okLabToOKLCh(baseOKLab);
    
    const harmonicColors: OKLabColor[] = [baseOKLab];

    switch (harmonyType) {
      case 'monochromatic':
        // Vary lightness and chroma, keep hue constant
        for (let i = 1; i < stops; i++) {
          const lightnessFactor = i / (stops - 1);
          const chromaFactor = 1 - Math.abs(0.5 - lightnessFactor) * 2;
          
          const newOKLCh: OKLChColor = {
            L: 0.2 + lightnessFactor * 0.6,
            C: baseOKLCh.C * (0.5 + chromaFactor * 0.5),
            h: baseOKLCh.h
          };
          
          harmonicColors.push(OKLabConverter.okLChToOKLab(newOKLCh));
        }
        break;

      case 'analogous':
        // Colors adjacent on color wheel
        const analogousRange = 60; // degrees
        for (let i = 1; i < stops; i++) {
          const hueShift = (i / (stops - 1) - 0.5) * analogousRange;
          const newOKLCh: OKLChColor = {
            ...baseOKLCh,
            h: (baseOKLCh.h + hueShift + 360) % 360
          };
          
          harmonicColors.push(OKLabConverter.okLChToOKLab(newOKLCh));
        }
        break;

      case 'complementary':
        // Base color and its complement
        const complementHue = (baseOKLCh.h + 180) % 360;
        for (let i = 1; i < stops; i++) {
          const t = i / (stops - 1);
          const useComplement = t > 0.5;
          const targetHue = useComplement ? complementHue : baseOKLCh.h;
          
          const newOKLCh: OKLChColor = {
            L: baseOKLCh.L + (t - 0.5) * 0.4,
            C: baseOKLCh.C * (0.7 + Math.sin(t * Math.PI) * 0.3),
            h: targetHue
          };
          
          harmonicColors.push(OKLabConverter.okLChToOKLab(newOKLCh));
        }
        break;

      case 'triadic':
        // Three colors equally spaced on color wheel
        const triadic1 = (baseOKLCh.h + 120) % 360;
        const triadic2 = (baseOKLCh.h + 240) % 360;
        const hues = [baseOKLCh.h, triadic1, triadic2];
        
        for (let i = 1; i < stops; i++) {
          const t = i / (stops - 1);
          const hueIndex = Math.floor(t * 3);
          const targetHue = hues[Math.min(hueIndex, 2)];
          
          const newOKLCh: OKLChColor = {
            L: baseOKLCh.L + Math.sin(t * Math.PI * 2) * 0.2,
            C: baseOKLCh.C * (0.8 + Math.cos(t * Math.PI * 3) * 0.2),
            h: targetHue
          };
          
          harmonicColors.push(OKLabConverter.okLChToOKLab(newOKLCh));
        }
        break;

      case 'split-complementary':
        // Base color and two colors adjacent to its complement
        const splitComp1 = (baseOKLCh.h + 150) % 360;
        const splitComp2 = (baseOKLCh.h + 210) % 360;
        
        for (let i = 1; i < stops; i++) {
          const t = i / (stops - 1);
          let targetHue = baseOKLCh.h;
          
          if (t > 0.33 && t < 0.66) {
            targetHue = splitComp1;
          } else if (t >= 0.66) {
            targetHue = splitComp2;
          }
          
          const newOKLCh: OKLChColor = {
            L: baseOKLCh.L + (t - 0.5) * 0.3,
            C: baseOKLCh.C,
            h: targetHue
          };
          
          harmonicColors.push(OKLabConverter.okLChToOKLab(newOKLCh));
        }
        break;
    }

    // Convert to gradient stops
    return harmonicColors.map((oklabColor, index) => {
      const rgbColor = OKLabConverter.okLabToRGB(oklabColor);
      const cssColor = `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`;
      
      return {
        position: index / (harmonicColors.length - 1),
        color: cssColor,
        oklabColor,
        weight: 1
      };
    });
  }

  /**
   * Analyze gradient quality and characteristics
   */
  analyzeGradient(stops: GradientStop[]): GradientAnalysis {
    if (stops.length < 2) {
      return {
        totalRange: 0,
        smoothness: 0,
        contrast: 0,
        harmony: 'mixed',
        dominantHue: 0,
        temperature: 'neutral',
        quality: 0
      };
    }

    const oklabColors = stops.map(stop => 
      stop.oklabColor || this.parseColorToOKLab(stop.color)
    );

    // Calculate total color range
    let totalRange = 0;
    for (let i = 1; i < oklabColors.length; i++) {
      totalRange += OKLabConverter.deltaE(oklabColors[i - 1], oklabColors[i]);
    }

    // Calculate smoothness (inverse of maximum jump)
    let maxJump = 0;
    for (let i = 1; i < oklabColors.length; i++) {
      const jump = OKLabConverter.deltaE(oklabColors[i - 1], oklabColors[i]);
      maxJump = Math.max(maxJump, jump);
    }
    const smoothness = Math.max(0, 1 - maxJump / 0.5);

    // Calculate contrast
    const lightnesses = oklabColors.map(c => c.L);
    const minL = Math.min(...lightnesses);
    const maxL = Math.max(...lightnesses);
    const contrast = maxL - minL;

    // Analyze color harmony
    const oklchColors = oklabColors.map(OKLabConverter.okLabToOKLCh);
    const hues = oklchColors.map(c => c.h);
    const harmony = this.determineColorHarmony(hues);

    // Find dominant hue (circular mean)
    const hueRadians = hues.map(h => h * Math.PI / 180);
    const cosSum = hueRadians.reduce((sum, h) => sum + Math.cos(h), 0);
    const sinSum = hueRadians.reduce((sum, h) => sum + Math.sin(h), 0);
    const dominantHue = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
    const normalizedDominantHue = (dominantHue + 360) % 360;

    // Determine temperature
    const temperature = OKLabConverter.getColorTemperature(
      oklabColors.reduce((sum, color) => ({
        L: sum.L + color.L / oklabColors.length,
        a: sum.a + color.a / oklabColors.length,
        b: sum.b + color.b / oklabColors.length
      }), { L: 0, a: 0, b: 0 })
    );

    // Calculate overall quality score
    const qualityFactors = {
      smoothness: smoothness * 0.3,
      contrast: Math.min(1, contrast / 0.6) * 0.25,
      range: Math.min(1, totalRange / 2) * 0.25,
      harmony: harmony === 'mixed' ? 0.7 : 1.0
    };

    const quality = Object.values(qualityFactors).reduce((sum, factor) => sum + factor, 0) / 4;

    return {
      totalRange,
      smoothness,
      contrast,
      harmony,
      dominantHue: normalizedDominantHue,
      temperature,
      quality
    };
  }

  /**
   * Optimize gradient stops for better visual quality
   */
  private optimizeGradientStops(stops: GradientStop[]): GradientStop[] {
    let optimized = [...stops];

    // Apply smoothing
    if (this.options.smoothness > 0) {
      optimized = this.smoothGradientTransitions(optimized, this.options.smoothness);
    }

    // Boost contrast if requested
    if (this.options.contrastBoost !== 1.0) {
      optimized = this.adjustGradientContrast(optimized, this.options.contrastBoost);
    }

    return optimized;
  }

  /**
   * Smooth gradient transitions using weighted averaging
   */
  private smoothGradientTransitions(stops: GradientStop[], smoothness: number): GradientStop[] {
    const smoothed = [...stops];
    
    for (let i = 1; i < smoothed.length - 1; i++) {
      const prev = this.parseColorToOKLab(smoothed[i - 1].color);
      const current = this.parseColorToOKLab(smoothed[i].color);
      const next = this.parseColorToOKLab(smoothed[i + 1].color);
      
      // Weighted average with neighboring colors
      const smoothedColor: OKLabColor = {
        L: current.L * (1 - smoothness) + (prev.L + next.L) * 0.5 * smoothness,
        a: current.a * (1 - smoothness) + (prev.a + next.a) * 0.5 * smoothness,
        b: current.b * (1 - smoothness) + (prev.b + next.b) * 0.5 * smoothness
      };
      
      const rgbColor = OKLabConverter.okLabToRGB(smoothedColor);
      smoothed[i].color = `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`;
      smoothed[i].oklabColor = smoothedColor;
    }
    
    return smoothed;
  }

  /**
   * Adjust gradient contrast
   */
  private adjustGradientContrast(stops: GradientStop[], contrastBoost: number): GradientStop[] {
    const oklabColors = stops.map(stop => 
      stop.oklabColor || this.parseColorToOKLab(stop.color)
    );
    
    // Find center lightness
    const avgLightness = oklabColors.reduce((sum, c) => sum + c.L, 0) / oklabColors.length;
    
    // Adjust each color's lightness
    const adjusted = stops.map((stop, index) => {
      const oklabColor = oklabColors[index];
      const deviation = oklabColor.L - avgLightness;
      const adjustedL = avgLightness + deviation * contrastBoost;
      
      const newOKLabColor: OKLabColor = {
        L: Math.max(0, Math.min(1, adjustedL)),
        a: oklabColor.a,
        b: oklabColor.b
      };
      
      const rgbColor = OKLabConverter.okLabToRGB(newOKLabColor);
      
      return {
        ...stop,
        color: `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`,
        oklabColor: newOKLabColor
      };
    });
    
    return adjusted;
  }

  /**
   * Parse CSS color string to OKLab
   */
  private parseColorToOKLab(colorString: string): OKLabColor {
    // Simple RGB parser for rgb() format
    const rgbMatch = colorString.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const rgb: RGBColor = {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3])
      };
      return OKLabConverter.rgbToOKLab(rgb);
    }
    
    // Fallback: assume it's a hex color or convert
    // For now, return a default color
    return { L: 0.5, a: 0, b: 0 };
  }

  /**
   * Sort colors for optimal gradient flow
   */
  private sortColorsForGradient(
    colors: Array<{ color: string; oklabColor: OKLabColor; weight: number }>
  ): typeof colors {
    if (this.options.distributionMode === 'uniform') {
      return colors; // Keep original order
    }
    
    // Sort by perceptual properties for smooth transitions
    return colors.sort((a, b) => {
      const oklchA = OKLabConverter.okLabToOKLCh(a.oklabColor);
      const oklchB = OKLabConverter.okLabToOKLCh(b.oklabColor);
      
      // Primary sort by hue, secondary by lightness
      const hueDiff = oklchA.h - oklchB.h;
      if (Math.abs(hueDiff) > 10) {
        return hueDiff;
      }
      
      return a.oklabColor.L - b.oklabColor.L;
    });
  }

  /**
   * Distribute gradient stops intelligently
   */
  private distributeGradientStops(
    colors: Array<{ color: string; oklabColor: OKLabColor; weight: number }>,
    targetStops: number
  ): GradientStop[] {
    const stops: GradientStop[] = [];
    
    for (let i = 0; i < targetStops; i++) {
      const t = i / (targetStops - 1);
      
      // Find the color or interpolate between colors
      let selectedColor: { color: string; oklabColor: OKLabColor; weight: number };
      
      if (colors.length === 1) {
        selectedColor = colors[0];
      } else {
        const colorIndex = t * (colors.length - 1);
        const lowerIndex = Math.floor(colorIndex);
        const upperIndex = Math.min(colors.length - 1, Math.ceil(colorIndex));
        
        if (lowerIndex === upperIndex) {
          selectedColor = colors[lowerIndex];
        } else {
          // Interpolate between colors
          const alpha = colorIndex - lowerIndex;
          const color1 = colors[lowerIndex];
          const color2 = colors[upperIndex];
          
          const interpolatedOKLab: OKLabColor = {
            L: color1.oklabColor.L * (1 - alpha) + color2.oklabColor.L * alpha,
            a: color1.oklabColor.a * (1 - alpha) + color2.oklabColor.a * alpha,
            b: color1.oklabColor.b * (1 - alpha) + color2.oklabColor.b * alpha
          };
          
          const rgbColor = OKLabConverter.okLabToRGB(interpolatedOKLab);
          selectedColor = {
            color: `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`,
            oklabColor: interpolatedOKLab,
            weight: (color1.weight + color2.weight) / 2
          };
        }
      }
      
      stops.push({
        position: t,
        color: selectedColor.color,
        oklabColor: selectedColor.oklabColor,
        weight: selectedColor.weight
      });
    }
    
    return stops;
  }

  /**
   * Apply color harmony adjustments
   */
  private applyColorHarmonies(stops: GradientStop[]): GradientStop[] {
    // Analyze current harmony and make subtle adjustments
    const hues = stops.map(stop => {
      const oklch = OKLabConverter.okLabToOKLCh(
        stop.oklabColor || this.parseColorToOKLab(stop.color)
      );
      return oklch.h;
    });
    
    this.determineColorHarmony(hues);

    // Apply minor adjustments based on harmony type
    return stops; // For now, return as-is
  }

  /**
   * Enforce minimum distances between gradient stops
   */
  private enforceMinimumDistances(stops: GradientStop[]): GradientStop[] {
    const filtered: GradientStop[] = [];
    
    for (const stop of stops) {
      const tooClose = filtered.some(existing => 
        Math.abs(stop.position - existing.position) < this.options.minStopDistance
      );
      
      if (!tooClose) {
        filtered.push(stop);
      }
    }
    
    return filtered;
  }

  /**
   * Determine color harmony type from hue array
   */
  private determineColorHarmony(hues: number[]): 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'mixed' {
    if (hues.length < 2) return 'monochromatic';
    
    const hueRange = Math.max(...hues) - Math.min(...hues);
    
    if (hueRange < 30) return 'monochromatic';
    if (hueRange < 60) return 'analogous';
    if (hueRange > 150 && hueRange < 210) return 'complementary';
    if (hues.length >= 3 && hueRange > 200) return 'triadic';
    
    return 'mixed';
  }

  /**
   * Interpolate between OKLab colors
   */
  private interpolateOKLab(
    colors: Array<{ oklabColor: OKLabColor }>,
    position: number
  ): OKLabColor {
    if (colors.length === 1) return colors[0].oklabColor;
    
    const scaledPosition = position * (colors.length - 1);
    const lowerIndex = Math.floor(scaledPosition);
    const upperIndex = Math.min(colors.length - 1, Math.ceil(scaledPosition));
    
    if (lowerIndex === upperIndex) {
      return colors[lowerIndex].oklabColor;
    }
    
    const alpha = scaledPosition - lowerIndex;
    const color1 = colors[lowerIndex].oklabColor;
    const color2 = colors[upperIndex].oklabColor;
    
    return {
      L: color1.L * (1 - alpha) + color2.L * alpha,
      a: color1.a * (1 - alpha) + color2.a * alpha,
      b: color1.b * (1 - alpha) + color2.b * alpha
    };
  }

  /**
   * Linear RGB interpolation (fallback)
   */
  private interpolateLinear(
    colors: Array<{ color: string }>,
    position: number
  ): OKLabColor {
    // Convert to RGB, interpolate, then convert back
    const rgbColors = colors.map(c => {
      const oklabColor = this.parseColorToOKLab(c.color);
      return OKLabConverter.okLabToRGB(oklabColor);
    });
    
    const scaledPosition = position * (rgbColors.length - 1);
    const lowerIndex = Math.floor(scaledPosition);
    const upperIndex = Math.min(rgbColors.length - 1, Math.ceil(scaledPosition));
    
    if (lowerIndex === upperIndex) {
      return OKLabConverter.rgbToOKLab(rgbColors[lowerIndex]);
    }
    
    const alpha = scaledPosition - lowerIndex;
    const color1 = rgbColors[lowerIndex];
    const color2 = rgbColors[upperIndex];
    
    const interpolatedRGB: RGBColor = {
      r: Math.round(color1.r * (1 - alpha) + color2.r * alpha),
      g: Math.round(color1.g * (1 - alpha) + color2.g * alpha),
      b: Math.round(color1.b * (1 - alpha) + color2.b * alpha)
    };
    
    return OKLabConverter.rgbToOKLab(interpolatedRGB);
  }

  /**
   * Create default gradient when no colors provided
   */
  private createDefaultGradient(stops: number): GradientStop[] {
    const colors = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0080ff', '#8000ff'];
    
    return Array.from({ length: stops }, (_, i) => {
      const position = i / (stops - 1);
      const colorIndex = position * (colors.length - 1);
      const color = colors[Math.round(colorIndex)];
      
      return {
        position,
        color,
        weight: 1
      };
    });
  }

  /**
   * Update gradient builder options
   */
  updateOptions(newOptions: Partial<GradientOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  /**
   * Get current options
   */
  getOptions(): GradientOptions {
    return { ...this.options };
  }
}
