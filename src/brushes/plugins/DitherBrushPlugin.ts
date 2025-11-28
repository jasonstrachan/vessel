import { BaseBrushPlugin, BrushDrawContext, BrushMetadata, BrushConfig } from '../BrushPlugin';
import { BrushSettings } from '../../types';
import { 
  applyFloydSteinbergDither,
  applyBayerDither,
  DitherSettings,
  DitherAlgorithm,
  APPLE_II_PALETTE,
  createGrayscalePalette
} from '../../utils/ditherAlgorithms';

/**
 * Dither Brush Plugin - Creates dithered drawing effects
 * Example of a user-created brush plugin
 */
export class DitherBrushPlugin extends BaseBrushPlugin {
  readonly id = 'dither-brush';
  readonly metadata: BrushMetadata = {
    id: 'dither-brush',
    name: 'Dither Brush',
    description: 'Creates retro dithered drawing effects with various algorithms',
    author: 'Vessel Team',
    version: '1.0.0',
    category: 'Artistic',
    tags: ['dither', 'retro', 'pixel', 'artistic'],
  };

  private ditherSettings: DitherSettings = {
    algorithm: 'bayer',
    pressure: 0.5,
    intensity: 0.8,
    bayerMatrixSize: 8,
    palette: APPLE_II_PALETTE
  };

  private stampCanvas?: HTMLCanvasElement;
  private stampCtx?: CanvasRenderingContext2D;

  performanceHints = {
    preferredFPS: 30,
    usesGPU: false,
    requiresImageData: true,
    maxStrokePoints: 500
  };

  initialize(config?: BrushConfig): void {
    if (config?.algorithm) {
      this.ditherSettings.algorithm = config.algorithm as DitherAlgorithm;
    }

    if (config?.palette === 'grayscale') {
      this.ditherSettings.palette = createGrayscalePalette(16);
    } else if (config?.palette === 'apple2') {
      this.ditherSettings.palette = APPLE_II_PALETTE;
    }

    if (typeof config?.intensity === 'number') {
      this.ditherSettings.intensity = config.intensity;
    }

    if (isValidBayerMatrixSize(config?.bayerMatrixSize)) {
      this.ditherSettings.bayerMatrixSize = config.bayerMatrixSize;
    }

    // Create stamp canvas for dithering
    this.stampCanvas = document.createElement('canvas');
    this.stampCtx = this.stampCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    }) || undefined;
  }

  onActivate(): void {
    console.log('Dither brush activated with settings:', this.ditherSettings);
  }

  onDeactivate(): void {
    console.log('Dither brush deactivated');
  }

  draw(context: BrushDrawContext): void {
    const { ctx, x, y, pressure, settings } = context;
    const size = Math.round(settings.size * (pressure || 1));
    
    if (!this.stampCanvas || !this.stampCtx) {
      // Fallback to simple drawing if stamp canvas not initialized
      ctx.fillStyle = settings.color;
      ctx.globalAlpha = settings.opacity * pressure;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Update dither pressure based on pen pressure
    this.ditherSettings.pressure = pressure;

    // Resize stamp canvas if needed
    const stampSize = size * 2; // Extra space for dithering
    if (this.stampCanvas.width !== stampSize || this.stampCanvas.height !== stampSize) {
      this.stampCanvas.width = stampSize;
      this.stampCanvas.height = stampSize;
    }

    // Clear stamp canvas
    this.stampCtx.clearRect(0, 0, stampSize, stampSize);

    // Draw brush shape on stamp canvas
    this.stampCtx.fillStyle = settings.color;
    this.stampCtx.globalAlpha = 1;
    this.stampCtx.beginPath();
    this.stampCtx.arc(stampSize / 2, stampSize / 2, size / 2, 0, Math.PI * 2);
    this.stampCtx.fill();

    // Get image data and apply dithering
    const imageData = this.stampCtx.getImageData(0, 0, stampSize, stampSize);
    
    // Apply selected dither algorithm
    let ditheredData: ImageData;
    switch (this.ditherSettings.algorithm) {
      case 'floyd-steinberg':
        ditheredData = applyFloydSteinbergDither(imageData, this.ditherSettings);
        break;
      case 'bayer':
      default:
        ditheredData = applyBayerDither(imageData, this.ditherSettings);
        break;
    }

    // Put dithered data back
    this.stampCtx.putImageData(ditheredData, 0, 0);

    // Draw the dithered stamp to main canvas
    ctx.save();
    ctx.globalAlpha = settings.opacity;
    ctx.globalCompositeOperation = settings.blendMode || 'source-over';
    ctx.drawImage(
      this.stampCanvas,
      x - stampSize / 2,
      y - stampSize / 2
    );
    ctx.restore();
  }

  drawLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: BrushSettings
  ): void {
    // Draw multiple stamps along the line for dithered effect
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / (settings.size * 0.5))); // Overlap stamps
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      
      this.draw({
        ctx,
        x,
        y,
        pressure: 1,
        settings,
        lastPoint: i === 0 ? null : { x: x1 + (x2 - x1) * ((i - 1) / steps), y: y1 + (y2 - y1) * ((i - 1) / steps), pressure: 1 }
      });
    }
  }

  validateSettings(settings: BrushSettings): boolean {
    // Dither brush works best with certain settings
    if (settings.size < 1 || settings.size > 200) {
      console.warn('Dither brush works best with size between 1 and 200');
    }
    return true;
  }

  cleanup(): void {
    this.stampCanvas = undefined;
    this.stampCtx = undefined;
  }

  getControls(): React.ComponentType | null {
    // Could return a custom React component for dither-specific controls
    // For now, return null to use default controls
    return null;
  }
}

function isValidBayerMatrixSize(value: unknown): value is DitherSettings['bayerMatrixSize'] {
  return value === 2 || value === 4 || value === 8;
}

// Export as default for dynamic loading
export default DitherBrushPlugin;
