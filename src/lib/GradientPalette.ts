/**
 * GradientPalette - Manages color palettes generated from gradients
 * Supports color cycling animation and smooth gradient interpolation
 */

export interface GradientStop {
  position: number; // 0.0 to 1.0
  color: string | { r: number; g: number; b: number };    // CSS color string or RGB object
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export class GradientPalette {
  private colors: Uint8ClampedArray;  // 256 * 4 (RGBA)
  private gradientStops: GradientStop[];
  private paletteSize: number = 256;
  
  // Cache for parsed colors
  private parsedColors: Map<string, RGBA> = new Map();
  
  constructor(stops?: GradientStop[]) {
    this.colors = new Uint8ClampedArray(this.paletteSize * 4);
    this.gradientStops = stops || [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' }
    ];
    
    if (stops && stops.length > 0) {
      this.updateFromGradient(stops);
    } else {
      // Initialize with default gradient if no stops provided
      this.updateFromGradient(this.gradientStops);
    }
  }
  
  /**
   * Parse CSS color string to RGBA values
   */
  private parseColor(color: string | { r: number; g: number; b: number }): RGBA {
    // Handle RGB object format
    if (typeof color === 'object' && 'r' in color && 'g' in color && 'b' in color) {
      return {
        r: Math.round(color.r),
        g: Math.round(color.g),
        b: Math.round(color.b),
        a: 255
      };
    }
    
    // Handle string format
    if (this.parsedColors.has(color)) {
      return this.parsedColors.get(color)!;
    }
    
    // Use a small canvas to parse the color
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      const rgba = { r: 0, g: 0, b: 0, a: 255 };
      this.parsedColors.set(color, rgba);
      return rgba;
    }
    
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    
    const rgba = {
      r: data[0],
      g: data[1],
      b: data[2],
      a: data[3]
    };
    
    this.parsedColors.set(color, rgba);
    return rgba;
  }
  
  /**
   * Interpolate between two colors
   */
  private interpolateColor(color1: RGBA, color2: RGBA, t: number): RGBA {
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * t),
      g: Math.round(color1.g + (color2.g - color1.g) * t),
      b: Math.round(color1.b + (color2.b - color1.b) * t),
      a: Math.round(color1.a + (color2.a - color1.a) * t)
    };
  }
  
  /**
   * Update palette from gradient stops
   */
  updateFromGradient(stops: GradientStop[]) {
    if (!stops || stops.length === 0) return;
    
    this.gradientStops = [...stops];
    
    // Sort stops by position
    this.gradientStops.sort((a, b) => a.position - b.position);
    
    // Ensure we have stops at 0 and 1
    if (this.gradientStops[0].position > 0) {
      this.gradientStops.unshift({
        position: 0,
        color: this.gradientStops[0].color
      });
    }
    if (this.gradientStops[this.gradientStops.length - 1].position < 1) {
      this.gradientStops.push({
        position: 1,
        color: this.gradientStops[this.gradientStops.length - 1].color
      });
    }
    
    // Generate palette
    for (let i = 0; i < this.paletteSize; i++) {
      const position = i / (this.paletteSize - 1);
      const color = this.getColorAtPosition(position);
      
      const idx = i * 4;
      this.colors[idx] = color.r;
      this.colors[idx + 1] = color.g;
      this.colors[idx + 2] = color.b;
      this.colors[idx + 3] = color.a;
    }
  }
  
  /**
   * Get interpolated color at a specific position
   */
  private getColorAtPosition(position: number): RGBA {
    // Clamp position
    position = Math.max(0, Math.min(1, position));
    
    // Find surrounding stops
    let leftStop = this.gradientStops[0];
    let rightStop = this.gradientStops[this.gradientStops.length - 1];
    
    for (let i = 0; i < this.gradientStops.length - 1; i++) {
      if (position >= this.gradientStops[i].position && 
          position <= this.gradientStops[i + 1].position) {
        leftStop = this.gradientStops[i];
        rightStop = this.gradientStops[i + 1];
        break;
      }
    }
    
    // Parse colors
    const leftColor = this.parseColor(leftStop.color);
    const rightColor = this.parseColor(rightStop.color);
    
    // Calculate interpolation factor
    if (leftStop.position === rightStop.position) {
      return leftColor;
    }
    
    const t = (position - leftStop.position) / (rightStop.position - leftStop.position);
    
    // Interpolate
    return this.interpolateColor(leftColor, rightColor, t);
  }
  
  /**
   * Shift colors by offset for animation (color cycling)
   */
  shift(offset: number) {
    // Normalize offset to 0-1 range
    offset = ((offset % 1) + 1) % 1;
    
    // Calculate shift in palette indices
    const shiftIndices = Math.floor(offset * this.paletteSize);
    
    // Create temporary buffer for shifted colors
    const shifted = new Uint8ClampedArray(this.paletteSize * 4);
    
    for (let i = 0; i < this.paletteSize; i++) {
      const sourceIndex = (i + shiftIndices) % this.paletteSize;
      const sourceIdx = sourceIndex * 4;
      const targetIdx = i * 4;
      
      shifted[targetIdx] = this.colors[sourceIdx];
      shifted[targetIdx + 1] = this.colors[sourceIdx + 1];
      shifted[targetIdx + 2] = this.colors[sourceIdx + 2];
      shifted[targetIdx + 3] = this.colors[sourceIdx + 3];
    }
    
    return shifted;
  }
  
  /**
   * Shift colors in place
   */
  shiftInPlace(offset: number) {
    const shifted = this.shift(offset);
    this.colors = shifted;
  }
  
  /**
   * Get color at specific index
   */
  getColor(index: number): RGBA {
    // Ensure colors array exists
    if (!this.colors || this.colors.length === 0) {
      console.warn('[GradientPalette] Colors array not initialized');
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    
    index = Math.max(0, Math.min(this.paletteSize - 1, index));
    const idx = index * 4;
    
    // Bounds check
    if (idx + 3 >= this.colors.length) {
      console.warn('[GradientPalette] Index out of bounds:', index, idx);
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    
    return {
      r: this.colors[idx] || 0,
      g: this.colors[idx + 1] || 0,
      b: this.colors[idx + 2] || 0,
      a: this.colors[idx + 3] || 255
    };
  }
  
  /**
   * Get color as CSS string
   */
  getColorString(index: number): string {
    const color = this.getColor(index);
    // Ensure valid values
    const r = Math.max(0, Math.min(255, color.r || 0));
    const g = Math.max(0, Math.min(255, color.g || 0));
    const b = Math.max(0, Math.min(255, color.b || 0));
    const a = Math.max(0, Math.min(255, color.a || 255)) / 255;
    return `rgba(${r},${g},${b},${a})`;
  }
  
  /**
   * Get the entire palette as RGBA array
   */
  getPaletteColors(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.colors);
  }
  
  /**
   * Get palette as array of CSS color strings
   */
  getPaletteStrings(): string[] {
    const strings: string[] = [];
    for (let i = 0; i < this.paletteSize; i++) {
      strings.push(this.getColorString(i));
    }
    return strings;
  }
  
  /**
   * Apply palette to ImageData using index buffer
   */
  applyToIndexBuffer(indexData: Uint8Array, imageData: ImageData, offset: number = 0) {
    const pixels = imageData.data;
    const shifted = offset > 0 ? this.shift(offset) : this.colors;
    
    for (let i = 0; i < indexData.length; i++) {
      const colorIndex = indexData[i];
      
      // Skip transparent pixels (index 0)
      if (colorIndex === 0) {
        const pixelIndex = i * 4;
        pixels[pixelIndex] = 0;
        pixels[pixelIndex + 1] = 0;
        pixels[pixelIndex + 2] = 0;
        pixels[pixelIndex + 3] = 0;
        continue;
      }
      
      // Map index to palette color
      let paletteIndex = colorIndex - 1;
      if (colorIndex >= 255 && this.paletteSize >= 256) {
        paletteIndex = this.paletteSize - 1;
      }
      if (paletteIndex < 0) {
        paletteIndex = 0;
      } else if (paletteIndex >= this.paletteSize) {
        paletteIndex = this.paletteSize - 1;
      }
      const colorIdx = paletteIndex * 4;
      const pixelIdx = i * 4;
      
      pixels[pixelIdx] = shifted[colorIdx];
      pixels[pixelIdx + 1] = shifted[colorIdx + 1];
      pixels[pixelIdx + 2] = shifted[colorIdx + 2];
      pixels[pixelIdx + 3] = shifted[colorIdx + 3];
    }
  }
  
  /**
   * Create a smooth rainbow gradient
   */
  static createRainbow(): GradientPalette {
    return new GradientPalette([
      { position: 0.00, color: '#ff0000' }, // Red
      { position: 0.17, color: '#ff7f00' }, // Orange  
      { position: 0.33, color: '#ffff00' }, // Yellow
      { position: 0.50, color: '#00ff00' }, // Green
      { position: 0.67, color: '#0000ff' }, // Blue
      { position: 0.83, color: '#4b0082' }, // Indigo
      { position: 1.00, color: '#9400d3' }  // Violet
    ]);
  }
  
  /**
   * Create a fire gradient
   */
  static createFire(): GradientPalette {
    return new GradientPalette([
      { position: 0.00, color: '#000000' }, // Black
      { position: 0.20, color: '#330000' }, // Dark red
      { position: 0.40, color: '#aa0000' }, // Red
      { position: 0.60, color: '#ff5500' }, // Orange
      { position: 0.80, color: '#ffaa00' }, // Yellow-orange
      { position: 1.00, color: '#ffffff' }  // White
    ]);
  }
  
  /**
   * Create an ocean gradient
   */
  static createOcean(): GradientPalette {
    return new GradientPalette([
      { position: 0.00, color: '#000033' }, // Deep blue
      { position: 0.25, color: '#000066' }, // Dark blue
      { position: 0.50, color: '#0066cc' }, // Blue
      { position: 0.75, color: '#00aaff' }, // Light blue
      { position: 1.00, color: '#66ddff' }  // Cyan
    ]);
  }
  
  /**
   * Create a sunset gradient
   */
  static createSunset(): GradientPalette {
    return new GradientPalette([
      { position: 0.00, color: '#1a0033' }, // Dark purple
      { position: 0.25, color: '#4d0066' }, // Purple
      { position: 0.50, color: '#ff3366' }, // Pink
      { position: 0.75, color: '#ff9933' }, // Orange
      { position: 1.00, color: '#ffcc00' }  // Yellow
    ]);
  }
  
  /**
   * Create a grayscale gradient
   */
  static createGrayscale(): GradientPalette {
    return new GradientPalette([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' }
    ]);
  }
  
  /**
   * Clone the palette
   */
  clone(): GradientPalette {
    const cloned = new GradientPalette();
    cloned.colors = new Uint8ClampedArray(this.colors);
    cloned.gradientStops = this.gradientStops.map(stop => ({ ...stop }));
    return cloned;
  }
  
  /**
   * Get current gradient stops
   */
  getGradientStops(): GradientStop[] {
    return this.gradientStops.map(stop => ({ ...stop }));
  }
  
  /**
   * Serialize for storage
   */
  serialize(): {
    gradientStops: GradientStop[];
    paletteSize: number;
  } {
    return {
      gradientStops: this.getGradientStops(),
      paletteSize: this.paletteSize
    };
  }
  
  /**
   * Deserialize from storage
   */
  static deserialize(data: {
    gradientStops: GradientStop[];
    paletteSize?: number;
  }): GradientPalette {
    const palette = new GradientPalette();
    if (data.paletteSize) {
      palette.paletteSize = data.paletteSize;
      palette.colors = new Uint8ClampedArray(palette.paletteSize * 4);
    }
    palette.updateFromGradient(data.gradientStops);
    return palette;
  }
}
