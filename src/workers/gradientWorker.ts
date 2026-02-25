/**
 * Web Worker for offloading gradient calculations
 */

import { parseCssColor } from '@/utils/color/parseCssColor';

type UpdateGradientMessage = {
  type: 'updateGradient';
  data: { stops?: GradientStop[]; palette?: Uint8ClampedArray; paletteSize?: number };
  id: number;
};

type ShiftPaletteMessage = {
  type: 'shiftPalette';
  data: { offset: number };
  id: number;
};

type ApplyToBufferMessage = {
  type: 'applyToBuffer';
  data: { indexData: Uint8Array; offset?: number };
  id: number;
};

type GradientWorkerMessage = UpdateGradientMessage | ShiftPaletteMessage | ApplyToBufferMessage;

type WorkerSuccessMessage = {
  id: number;
  type: 'success';
  result: Uint8ClampedArray;
};

type WorkerErrorMessage = {
  id: number;
  type: 'error';
  error: string;
};

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
    return parseCssColor(color, { r: 0, g: 0, b: 0, a: 255 });
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

  updateGradient(stops?: GradientStop[], incomingPalette?: Uint8ClampedArray) {
    if (incomingPalette && incomingPalette.length > 0) {
      return this.setPaletteColors(incomingPalette);
    }
    if (!stops || stops.length === 0) {
      return this.colors;
    }
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

  private setPaletteColors(palette: Uint8ClampedArray): Uint8ClampedArray {
    if (palette.length !== this.colors.length) {
      this.colors = new Uint8ClampedArray(palette);
      this.paletteSize = Math.max(1, palette.length / 4);
    } else {
      this.colors.set(palette);
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
    
    return pixels;
  }
}

// Worker message handler
const processor = new GradientProcessor();

const dedicatedWorkerScope = self as unknown as DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<GradientWorkerMessage>) => {
  const { type, data, id } = e.data;
  
  try {
    let result: Uint8ClampedArray;
    
    switch (type) {
      case 'updateGradient':
        result = processor.updateGradient(data.stops, data.palette);
        dedicatedWorkerScope.postMessage(
          { id, type: 'success', result } satisfies WorkerSuccessMessage,
          [result.buffer]
        );
        break;
        
      case 'shiftPalette':
        result = processor.shiftPalette(data.offset);
        dedicatedWorkerScope.postMessage(
          { id, type: 'success', result } satisfies WorkerSuccessMessage,
          [result.buffer]
        );
        break;
        
      case 'applyToBuffer':
        result = processor.applyToBuffer(data.indexData, data.offset);
        dedicatedWorkerScope.postMessage(
          { id, type: 'success', result } satisfies WorkerSuccessMessage,
          [result.buffer]
        );
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    dedicatedWorkerScope.postMessage({ 
      id, 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    } satisfies WorkerErrorMessage);
  }
};

export {};
