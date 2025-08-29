/**
 * Web Worker for offloading gradient calculations
 */

interface GradientWorkerMessage {
  type: 'updateGradient' | 'shiftPalette' | 'applyToBuffer';
  data: any;
  id: number;
}

interface GradientStop {
  position: number;
  color: string;
}

class GradientProcessor {
  private paletteSize: number = 256;
  private colors: Uint8ClampedArray;
  private gradientStops: GradientStop[] = [];

  constructor() {
    this.colors = new Uint8ClampedArray(this.paletteSize * 4);
  }

  parseColor(color: string): { r: number; g: number; b: number; a: number } {
    // Simple RGB parser
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: 255
      };
    }
    
    // Hex color parser
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 255 };
    }
    
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  interpolateColor(
    color1: { r: number; g: number; b: number; a: number },
    color2: { r: number; g: number; b: number; a: number },
    t: number
  ) {
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * t),
      g: Math.round(color1.g + (color2.g - color1.g) * t),
      b: Math.round(color1.b + (color2.b - color1.b) * t),
      a: Math.round(color1.a + (color2.a - color1.a) * t)
    };
  }

  updateGradient(stops: GradientStop[]) {
    this.gradientStops = [...stops];
    this.gradientStops.sort((a, b) => a.position - b.position);
    
    // Ensure stops at 0 and 1
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
    
    return this.colors;
  }

  getColorAtPosition(position: number) {
    position = Math.max(0, Math.min(1, position));
    
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
    
    const leftColor = this.parseColor(leftStop.color);
    const rightColor = this.parseColor(rightStop.color);
    
    if (leftStop.position === rightStop.position) {
      return leftColor;
    }
    
    const t = (position - leftStop.position) / (rightStop.position - leftStop.position);
    return this.interpolateColor(leftColor, rightColor, t);
  }

  shiftPalette(offset: number): Uint8ClampedArray {
    offset = ((offset % 1) + 1) % 1;
    const shiftIndices = Math.floor(offset * this.paletteSize);
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

  applyToBuffer(indexData: Uint8Array, offset: number = 0): Uint8ClampedArray {
    const shifted = offset > 0 ? this.shiftPalette(offset) : this.colors;
    const pixels = new Uint8ClampedArray(indexData.length * 4);
    
    for (let i = 0; i < indexData.length; i++) {
      const colorIndex = indexData[i];
      
      if (colorIndex === 0) {
        const pixelIndex = i * 4;
        pixels[pixelIndex] = 0;
        pixels[pixelIndex + 1] = 0;
        pixels[pixelIndex + 2] = 0;
        pixels[pixelIndex + 3] = 0;
        continue;
      }
      
      const paletteIndex = (colorIndex - 1) % this.paletteSize;
      const colorIdx = paletteIndex * 4;
      const pixelIdx = i * 4;
      
      pixels[pixelIdx] = shifted[colorIdx];
      pixels[pixelIdx + 1] = shifted[colorIdx + 1];
      pixels[pixelIdx + 2] = shifted[colorIdx + 2];
      pixels[pixelIdx + 3] = shifted[colorIdx + 3];
    }
    
    return pixels;
  }
}

// Worker message handler
const processor = new GradientProcessor();

self.onmessage = (e: MessageEvent<GradientWorkerMessage>) => {
  const { type, data, id } = e.data;
  
  try {
    let result: any;
    
    switch (type) {
      case 'updateGradient':
        result = processor.updateGradient(data.stops);
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(
          { id, type: 'success', result }, 
          [result.buffer]
        );
        break;
        
      case 'shiftPalette':
        result = processor.shiftPalette(data.offset);
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(
          { id, type: 'success', result }, 
          [result.buffer]
        );
        break;
        
      case 'applyToBuffer':
        result = processor.applyToBuffer(data.indexData, data.offset);
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(
          { id, type: 'success', result }, 
          [result.buffer]
        );
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ 
      id, 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
};

export {};