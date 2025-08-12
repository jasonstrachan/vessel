/**
 * Dithering Brush Demo and Integration Example
 * Shows how to integrate pressure-sensitive dithering with TinyBrush
 */

import { 
  applyPressureDither,
  DitherSettings,
  APPLE_II_PALETTE,
  createGrayscalePalette,
  calculatePressureDitherThreshold
} from '../utils/ditherAlgorithms';

/**
 * Example: Real-time dithering brush for canvas drawing
 * This shows how to integrate with the existing brush engine
 */
export class DitherBrushEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private isDrawing: boolean = false;
  private lastPoint: { x: number; y: number } | null = null;
  private ditherSettings: DitherSettings;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    
    // Default dither settings
    this.ditherSettings = {
      algorithm: 'bayer',
      pressure: 0.5,
      intensity: 0.8,
      bayerMatrixSize: 8,
      palette: APPLE_II_PALETTE
    };
    
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // Mouse events
    this.canvas.addEventListener('mousedown', this.handlePointerDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handlePointerMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handlePointerUp.bind(this));
    
    // Touch events (with pressure simulation)
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this));
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this));
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));
    
    // Pointer events (for stylus/pressure support)
    if ('PointerEvent' in window) {
      this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
      this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
      this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    }
  }
  
  private getPointerPosition(event: MouseEvent | TouchEvent | PointerEvent): { x: number; y: number; pressure: number } {
    const rect = this.canvas.getBoundingClientRect();
    let clientX: number, clientY: number, pressure: number = 0.5;
    
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
      pressure = 0.5; // Default pressure for mouse
    } else if (event instanceof TouchEvent) {
      const touch = event.touches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
      // Simulate pressure based on touch force (if available)
      pressure = (touch as any).force || 0.5;
    } else if (event instanceof PointerEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
      pressure = event.pressure || 0.5; // Real pressure from stylus
    } else {
      return { x: 0, y: 0, pressure: 0.5 };
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      pressure: Math.max(0.1, Math.min(1.0, pressure))
    };
  }
  
  private handlePointerDown(event: MouseEvent | TouchEvent | PointerEvent): void {
    event.preventDefault();
    this.isDrawing = true;
    const pos = this.getPointerPosition(event);
    this.lastPoint = pos;
    this.drawDitherStroke(pos.x, pos.y, pos.pressure);
  }
  
  private handlePointerMove(event: MouseEvent | TouchEvent | PointerEvent): void {
    if (!this.isDrawing) return;
    event.preventDefault();
    
    const pos = this.getPointerPosition(event);
    
    // Interpolate between last point and current point for smooth strokes
    if (this.lastPoint) {
      this.interpolateStroke(this.lastPoint, pos);
    }
    
    this.lastPoint = pos;
  }
  
  private handlePointerUp(event: MouseEvent | TouchEvent | PointerEvent): void {
    this.isDrawing = false;
    this.lastPoint = null;
  }
  
  private handleTouchStart(event: TouchEvent): void {
    this.handlePointerDown(event);
  }
  
  private handleTouchMove(event: TouchEvent): void {
    this.handlePointerMove(event);
  }
  
  private handleTouchEnd(event: TouchEvent): void {
    this.handlePointerUp(event);
  }
  
  private interpolateStroke(from: { x: number; y: number; pressure: number }, to: { x: number; y: number; pressure: number }): void {
    const distance = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    const steps = Math.max(1, Math.floor(distance / 5)); // One stroke every 5 pixels
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const pressure = from.pressure + (to.pressure - from.pressure) * t;
      
      this.drawDitherStroke(x, y, pressure);
    }
  }
  
  private drawDitherStroke(x: number, y: number, pressure: number): void {
    const brushSize = 40; // Base brush size
    const pressureSensitiveSize = brushSize * (0.3 + pressure * 0.7); // Pressure affects size
    const halfSize = Math.floor(pressureSensitiveSize / 2);
    
    // Update dither settings based on pressure
    this.ditherSettings.pressure = pressure;
    
    // Get the region to dither
    const regionX = Math.max(0, Math.floor(x - halfSize));
    const regionY = Math.max(0, Math.floor(y - halfSize));
    const regionWidth = Math.min(pressureSensitiveSize, this.canvas.width - regionX);
    const regionHeight = Math.min(pressureSensitiveSize, this.canvas.height - regionY);
    
    if (regionWidth <= 0 || regionHeight <= 0) return;
    
    try {
      // Draw base stroke first
      this.ctx.save();
      this.ctx.globalAlpha = 0.1 + pressure * 0.2; // Pressure affects opacity
      this.ctx.fillStyle = '#333';
      this.ctx.beginPath();
      this.ctx.arc(x, y, pressureSensitiveSize / 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
      
      // Get image data for the region
      const imageData = this.ctx.getImageData(regionX, regionY, regionWidth, regionHeight);
      
      // Apply dithering
      const ditheredData = applyPressureDither(imageData, this.ditherSettings);
      this.ctx.putImageData(ditheredData, regionX, regionY);
    } catch (error) {
      console.warn('Dither stroke failed:', error);
    }
  }
  
  public updateSettings(newSettings: Partial<DitherSettings>): void {
    this.ditherSettings = { ...this.ditherSettings, ...newSettings };
  }
  
  public clearCanvas(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

/**
 * Example usage and integration patterns
 */
export const createDitherBrushDemo = (canvasElement: HTMLCanvasElement): DitherBrushEngine => {
  const engine = new DitherBrushEngine(canvasElement);
  
  // Example: Set up different dithering algorithms
  const algorithms = [
    { name: 'Bayer Matrix', settings: { algorithm: 'bayer' as const, bayerMatrixSize: 8 as const } },
    { name: 'Floyd-Steinberg', settings: { algorithm: 'floyd-steinberg' as const } },
    { name: 'Sierra Lite', settings: { algorithm: 'sierra-lite' as const } }
  ];
  
  // Example: Set up different palettes
  const palettes = [
    { name: 'Apple II', palette: APPLE_II_PALETTE },
    { name: 'B&W', palette: createGrayscalePalette(2) },
    { name: 'Grayscale', palette: createGrayscalePalette(8) }
  ];
  
  return engine;
};

/**
 * Integration with existing TinyBrush hook system
 * This shows how to integrate dithering into useBrushEngine.ts
 */
export const integrateWithBrushEngine = () => {
  // Example code for adding to useBrushEngine.ts:
  
  const exampleBrushEngineIntegration = `
    // Add to useBrushEngine.ts imports:
    import { 
      applyPressureDither, 
      DitherSettings, 
      APPLE_II_PALETTE,
      calculatePressureDitherThreshold 
    } from '../utils/ditherAlgorithms';
    
    // Add to BrushSettings interface (if not already present):
    interface BrushSettings {
      // ... existing settings
      ditherAlgorithm?: 'floyd-steinberg' | 'bayer' | 'sierra-lite';
      ditherIntensity?: number;
      pressureSensitiveDither?: boolean;
      bayerMatrixSize?: 2 | 4 | 8;
    }
    
    // Add dithering function to the hook:
    const applyDitherEffect = useCallback((
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      pressure: number
    ) => {
      if (!brushSettings.ditherEnabled) return;
      
      const ditherSettings: DitherSettings = {
        algorithm: brushSettings.ditherAlgorithm || 'bayer',
        pressure: brushSettings.pressureSensitiveDither ? pressure : 0.5,
        intensity: (brushSettings.ditherIntensity || 50) / 100,
        bayerMatrixSize: brushSettings.bayerMatrixSize || 8,
        palette: APPLE_II_PALETTE
      };
      
      const halfSize = Math.floor(size / 2);
      const regionX = Math.max(0, x - halfSize);
      const regionY = Math.max(0, y - halfSize);
      const regionWidth = Math.min(size, ctx.canvas.width - regionX);
      const regionHeight = Math.min(size, ctx.canvas.height - regionY);
      
      if (regionWidth > 0 && regionHeight > 0) {
        const imageData = ctx.getImageData(regionX, regionY, regionWidth, regionHeight);
        const ditheredData = applyPressureDither(imageData, ditherSettings);
        ctx.putImageData(ditheredData, regionX, regionY);
      }
    }, [brushSettings]);
    
    // Use in drawBrushStroke function:
    // After drawing the brush stroke, apply dithering:
    applyDitherEffect(ctx, x, y, effectiveSize, pressure);
  `;
  
  return exampleBrushEngineIntegration;
};

/**
 * Performance benchmarking for different algorithms
 */
export const benchmarkDitherAlgorithms = (canvas: HTMLCanvasElement): Promise<void> => {
  return new Promise((resolve) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const testSize = 100;
    
    // Create test image
    const imageData = ctx.createImageData(testSize, testSize);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = Math.random() * 255;     // R
      imageData.data[i + 1] = Math.random() * 255; // G
      imageData.data[i + 2] = Math.random() * 255; // B
      imageData.data[i + 3] = 255;                 // A
    }
    
    const algorithms: DitherSettings[] = [
      { algorithm: 'bayer', pressure: 0.5, intensity: 0.8, bayerMatrixSize: 2, palette: APPLE_II_PALETTE },
      { algorithm: 'bayer', pressure: 0.5, intensity: 0.8, bayerMatrixSize: 4, palette: APPLE_II_PALETTE },
      { algorithm: 'bayer', pressure: 0.5, intensity: 0.8, bayerMatrixSize: 8, palette: APPLE_II_PALETTE },
      { algorithm: 'floyd-steinberg', pressure: 0.5, intensity: 0.8, bayerMatrixSize: 8, palette: APPLE_II_PALETTE },
      { algorithm: 'sierra-lite', pressure: 0.5, intensity: 0.8, bayerMatrixSize: 8, palette: APPLE_II_PALETTE }
    ];
    
    console.log('Benchmarking dithering algorithms...');
    
    algorithms.forEach((settings, index) => {
      const start = performance.now();
      
      for (let i = 0; i < 10; i++) { // 10 iterations
        applyPressureDither(imageData, settings);
      }
      
      const end = performance.now();
      const avgTime = (end - start) / 10;
      
      console.log(`${settings.algorithm} (${settings.bayerMatrixSize}x${settings.bayerMatrixSize}): ${avgTime.toFixed(2)}ms avg`);
    });
    
    resolve();
  });
};

/**
 * Export examples for documentation
 */
export const DITHERING_EXAMPLES = {
  retro_pixel_art: {
    algorithm: 'bayer' as const,
    intensity: 0.9,
    bayerMatrixSize: 2 as const,
    palette: createGrayscalePalette(4),
    description: 'Perfect for retro pixel art with chunky dithering'
  },
  
  smooth_gradients: {
    algorithm: 'floyd-steinberg' as const,
    intensity: 0.6,
    bayerMatrixSize: 8 as const,
    palette: APPLE_II_PALETTE,
    description: 'Smooth color transitions with classic Apple II colors'
  },
  
  newspaper_print: {
    algorithm: 'bayer' as const,
    intensity: 0.8,
    bayerMatrixSize: 8 as const,
    palette: createGrayscalePalette(2),
    description: 'Black and white newspaper print effect'
  },
  
  pressure_artistic: {
    algorithm: 'sierra-lite' as const,
    intensity: 0.7,
    bayerMatrixSize: 4 as const,
    palette: APPLE_II_PALETTE,
    description: 'Pressure-sensitive artistic dithering with natural feel'
  }
};

export default DitherBrushEngine;