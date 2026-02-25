/**
 * OKLabConverter - Perceptually uniform color space conversions
 * 
 * Implements OKLab color space conversions for accurate color analysis
 * and extraction. OKLab provides better perceptual uniformity than RGB.
 */

export interface RGBColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface OKLabColor {
  L: number; // Lightness: 0-1
  a: number; // Green-Red axis: ~-0.4 to 0.4
  b: number; // Blue-Yellow axis: ~-0.4 to 0.4
}

export interface HSLColor {
  h: number; // Hue: 0-360
  s: number; // Saturation: 0-100
  l: number; // Lightness: 0-100
}

export interface OKLChColor {
  L: number; // Lightness: 0-1
  C: number; // Chroma: 0+
  h: number; // Hue: 0-360
}

export interface ColorAnalysis {
  dominantColors: OKLabColor[];
  averageColor: OKLabColor;
  brightness: number;
  contrast: number;
  saturation: number;
  colorfulness: number;
  temperature: 'warm' | 'cool' | 'neutral';
}

export class OKLabConverter {
  private static readonly D65_WHITE = [0.95047, 1.0, 1.08883];
  
  /**
   * Convert RGB to OKLab color space
   */
  static rgbToOKLab(rgb: RGBColor): OKLabColor {
    // Convert RGB (0-255) to linear RGB (0-1)
    const r = this.sRGBtoLinear(rgb.r / 255);
    const g = this.sRGBtoLinear(rgb.g / 255);
    const b = this.sRGBtoLinear(rgb.b / 255);
    
    // Linear RGB to OKLab (Björn Ottosson's transformation)
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    
    // Cube root for perceptual uniformity
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    
    // Transform to OKLab
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b_oklab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    
    return { L, a, b: b_oklab };
  }
  
  /**
   * Convert OKLab to RGB color space (alias with capital L for consistency)
   */
  static okLabToRGB(oklab: OKLabColor): RGBColor {
    return this.oklabToRGB(oklab);
  }

  /**
   * Convert OKLab to RGB color space
   */
  static oklabToRGB(oklab: OKLabColor): RGBColor {
    const { L, a, b: b_oklab } = oklab;
    
    // OKLab to linear RGB
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b_oklab;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b_oklab;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b_oklab;
    
    // Cube the values
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    
    // Transform to linear RGB
    const r_lin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    
    // Linear RGB to sRGB (0-255)
    const r_final = Math.round(this.linearTosRGB(r_lin) * 255);
    const g_final = Math.round(this.linearTosRGB(g_lin) * 255);
    const b_final = Math.round(this.linearTosRGB(b_lin) * 255);
    
    return {
      r: Math.max(0, Math.min(255, r_final)),
      g: Math.max(0, Math.min(255, g_final)),
      b: Math.max(0, Math.min(255, b_final))
    };
  }
  
  /**
   * Convert RGB to HSL
   */
  static rgbToHSL(rgb: RGBColor): HSLColor {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    
    const l = (max + min) / 2;
    
    let h = 0;
    let s = 0;
    
    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      
      switch (max) {
        case r:
          h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / delta + 2) / 6;
          break;
        case b:
          h = ((r - g) / delta + 4) / 6;
          break;
      }
    }
    
    return {
      h: h * 360,
      s: s * 100,
      l: l * 100
    };
  }
  
  /**
   * Convert OKLab to OKLCh (Cylindrical coordinates)
   */
  static okLabToOKLCh(oklab: OKLabColor): OKLChColor {
    const { L, a, b } = oklab;
    
    const C = Math.sqrt(a * a + b * b);
    let h = Math.atan2(b, a) * 180 / Math.PI;
    
    if (h < 0) h += 360;
    
    return { L, C, h };
  }
  
  /**
   * Convert OKLCh to OKLab
   */
  static okLChToOKLab(oklch: OKLChColor): OKLabColor {
    const { L, C, h } = oklch;
    
    const hRad = h * Math.PI / 180;
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);
    
    return { L, a, b };
  }
  
  /**
   * Calculate perceptual color difference using Delta E 2000 in OKLab
   */
  static deltaE(color1: OKLabColor, color2: OKLabColor): number {
    // Simplified Delta E calculation in OKLab space
    const dL = color1.L - color2.L;
    const da = color1.a - color2.a;
    const db = color1.b - color2.b;
    
    return Math.sqrt(dL * dL + da * da + db * db);
  }
  
  /**
   * Calculate color temperature classification
   */
  static getColorTemperature(oklab: OKLabColor): 'warm' | 'cool' | 'neutral' {
    const oklch = this.okLabToOKLCh(oklab);
    const { h, C } = oklch;
    
    // Low chroma colors are neutral
    if (C < 0.05) return 'neutral';
    
    // Warm colors: red to yellow (roughly 0-90 and 270-360)
    if ((h >= 0 && h <= 90) || (h >= 270 && h <= 360)) {
      return 'warm';
    }
    
    // Cool colors: green to blue (roughly 90-270)
    if (h >= 90 && h <= 270) {
      return 'cool';
    }
    
    return 'neutral';
  }
  
  /**
   * Analyze image colors in OKLab space
   */
  static analyzeImageColors(imageData: ImageData, sampleCount: number = 1000): ColorAnalysis {
    const { data, width, height } = imageData;
    const pixels = width * height;
    
    // Sample pixels for analysis
    const step = Math.max(1, Math.floor(pixels / sampleCount));
    const colors: OKLabColor[] = [];
    
    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Skip transparent pixels
      if (a < 128) continue;
      
      const oklab = this.rgbToOKLab({ r, g, b });
      colors.push(oklab);
    }
    
    if (colors.length === 0) {
      // Return default analysis for empty image
      return {
        dominantColors: [],
        averageColor: { L: 0.5, a: 0, b: 0 },
        brightness: 0.5,
        contrast: 0,
        saturation: 0,
        colorfulness: 0,
        temperature: 'neutral'
      };
    }
    
    // Calculate statistics
    const avgL = colors.reduce((sum, c) => sum + c.L, 0) / colors.length;
    const avga = colors.reduce((sum, c) => sum + c.a, 0) / colors.length;
    const avgb = colors.reduce((sum, c) => sum + c.b, 0) / colors.length;
    
    const averageColor: OKLabColor = { L: avgL, a: avga, b: avgb };
    
    // Calculate brightness (average lightness)
    const brightness = avgL;
    
    // Calculate contrast (standard deviation of lightness)
    const lightnesses = colors.map(c => c.L);
    const avgBrightness = lightnesses.reduce((sum, l) => sum + l, 0) / lightnesses.length;
    const contrast = Math.sqrt(
      lightnesses.reduce((sum, l) => sum + (l - avgBrightness) ** 2, 0) / lightnesses.length
    );
    
    // Calculate colorfulness (average chroma in OKLCh)
    const chromas = colors.map(c => this.okLabToOKLCh(c).C);
    const colorfulness = chromas.reduce((sum, c) => sum + c, 0) / chromas.length;
    const saturation = colorfulness * 100; // Scale for readability
    
    // Find dominant colors using k-means clustering
    const dominantColors = this.findDominantColors(colors, Math.min(5, colors.length));
    
    // Determine overall temperature
    const temperatures = colors.map(c => this.getColorTemperature(c));
    const warmCount = temperatures.filter(t => t === 'warm').length;
    const coolCount = temperatures.filter(t => t === 'cool').length;
    
    let temperature: 'warm' | 'cool' | 'neutral' = 'neutral';
    if (warmCount > coolCount * 1.5) temperature = 'warm';
    else if (coolCount > warmCount * 1.5) temperature = 'cool';
    
    return {
      dominantColors,
      averageColor,
      brightness,
      contrast,
      saturation,
      colorfulness,
      temperature
    };
  }
  
  /**
   * Find dominant colors using simplified k-means clustering
   */
  private static findDominantColors(colors: OKLabColor[], k: number): OKLabColor[] {
    if (colors.length <= k) return [...colors];
    
    // Initialize centroids with random colors
    const centroids: OKLabColor[] = [];
    for (let i = 0; i < k; i++) {
      const randomIndex = Math.floor(Math.random() * colors.length);
      centroids.push({ ...colors[randomIndex] });
    }
    
    // K-means iterations
    for (let iter = 0; iter < 10; iter++) {
      const clusters: OKLabColor[][] = Array(k).fill(null).map(() => []);
      
      // Assign each color to nearest centroid
      for (const color of colors) {
        let minDistance = Infinity;
        let bestCluster = 0;
        
        for (let i = 0; i < k; i++) {
          const distance = this.deltaE(color, centroids[i]);
          if (distance < minDistance) {
            minDistance = distance;
            bestCluster = i;
          }
        }
        
        clusters[bestCluster].push(color);
      }
      
      // Update centroids
      for (let i = 0; i < k; i++) {
        if (clusters[i].length > 0) {
          const avgL = clusters[i].reduce((sum, c) => sum + c.L, 0) / clusters[i].length;
          const avga = clusters[i].reduce((sum, c) => sum + c.a, 0) / clusters[i].length;
          const avgb = clusters[i].reduce((sum, c) => sum + c.b, 0) / clusters[i].length;
          
          centroids[i] = { L: avgL, a: avga, b: avgb };
        }
      }
    }
    
    return centroids;
  }
  
  /**
   * Generate color palette in OKLab space
   */
  static generatePalette(
    baseColors: OKLabColor[],
    targetCount: number,
    options: {
      brightnessRange?: [number, number];
      chromaRange?: [number, number];
      preserveHue?: boolean;
    } = {}
  ): OKLabColor[] {
    const {
      brightnessRange = [0.2, 0.9],
      chromaRange = [0.05, 0.3],
      preserveHue = false
    } = options;
    
    if (baseColors.length === 0) {
      // Generate default palette
      return this.generateDefaultPalette(targetCount);
    }
    
    const palette: OKLabColor[] = [];
    
    // Include original colors
    palette.push(...baseColors);
    
    // Generate additional colors through interpolation and variation
    while (palette.length < targetCount) {
      // Pick two random base colors
      const color1 = baseColors[Math.floor(Math.random() * baseColors.length)];
      const color2 = baseColors[Math.floor(Math.random() * baseColors.length)];
      
      // Interpolate between them
      const t = Math.random();
      const interpolated: OKLabColor = {
        L: color1.L * (1 - t) + color2.L * t,
        a: color1.a * (1 - t) + color2.a * t,
        b: color1.b * (1 - t) + color2.b * t
      };
      
      // Apply variations within constraints
      const oklch = this.okLabToOKLCh(interpolated);
      
      // Vary lightness within range
      oklch.L = Math.max(brightnessRange[0], Math.min(brightnessRange[1], 
        oklch.L + (Math.random() - 0.5) * 0.2));
      
      // Vary chroma within range
      oklch.C = Math.max(chromaRange[0], Math.min(chromaRange[1], 
        oklch.C + (Math.random() - 0.5) * 0.1));
      
      // Vary hue unless preserveHue is set
      if (!preserveHue) {
        oklch.h = (oklch.h + (Math.random() - 0.5) * 60 + 360) % 360;
      }
      
      const newColor = this.okLChToOKLab(oklch);
      
      // Check if color is sufficiently different from existing colors
      const minDistance = 0.05;
      const isDifferent = palette.every(existingColor => 
        this.deltaE(newColor, existingColor) > minDistance);
      
      if (isDifferent) {
        palette.push(newColor);
      }
    }
    
    return palette.slice(0, targetCount);
  }
  
  /**
   * Generate default color palette
   */
  private static generateDefaultPalette(count: number): OKLabColor[] {
    const palette: OKLabColor[] = [];
    
    // Generate colors with even hue distribution
    for (let i = 0; i < count; i++) {
      const hue = (i / count) * 360;
      const oklch: OKLChColor = {
        L: 0.6 + Math.sin(i * 0.5) * 0.2, // Vary lightness
        C: 0.15 + Math.cos(i * 0.3) * 0.1, // Vary chroma
        h: hue
      };
      
      palette.push(this.okLChToOKLab(oklch));
    }
    
    return palette;
  }
  
  /**
   * sRGB to Linear RGB conversion
   */
  private static sRGBtoLinear(sRGB: number): number {
    if (sRGB <= 0.04045) {
      return sRGB / 12.92;
    } else {
      return Math.pow((sRGB + 0.055) / 1.055, 2.4);
    }
  }
  
  /**
   * Linear RGB to sRGB conversion
   */
  private static linearTosRGB(linear: number): number {
    if (linear <= 0.0031308) {
      return 12.92 * linear;
    } else {
      return 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    }
  }
  
  /**
   * Batch convert RGB array to OKLab
   */
  static batchRGBToOKLab(rgbColors: RGBColor[]): OKLabColor[] {
    return rgbColors.map(rgb => this.rgbToOKLab(rgb));
  }
  
  /**
   * Batch convert OKLab array to RGB
   */
  static batchOKLabToRGB(oklabColors: OKLabColor[]): RGBColor[] {
    return oklabColors.map(oklab => this.okLabToRGB(oklab));
  }
  
  /**
   * Sort colors by perceptual properties
   */
  static sortColors(
    colors: OKLabColor[], 
    sortBy: 'lightness' | 'chroma' | 'hue' | 'perceptual'
  ): OKLabColor[] {
    const sorted = [...colors];
    
    switch (sortBy) {
      case 'lightness':
        return sorted.sort((a, b) => a.L - b.L);
        
      case 'chroma':
        return sorted.sort((a, b) => {
          const chromaA = this.okLabToOKLCh(a).C;
          const chromaB = this.okLabToOKLCh(b).C;
          return chromaA - chromaB;
        });
        
      case 'hue':
        return sorted.sort((a, b) => {
          const hueA = this.okLabToOKLCh(a).h;
          const hueB = this.okLabToOKLCh(b).h;
          return hueA - hueB;
        });
        
      case 'perceptual':
        // Sort by luminance first, then chroma
        return sorted.sort((a, b) => {
          const diffL = a.L - b.L;
          if (Math.abs(diffL) > 0.1) return diffL;
          
          const chromaA = this.okLabToOKLCh(a).C;
          const chromaB = this.okLabToOKLCh(b).C;
          return chromaA - chromaB;
        });
        
      default:
        return sorted;
    }
  }
}