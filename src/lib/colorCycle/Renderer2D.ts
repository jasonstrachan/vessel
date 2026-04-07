import { canvasPool } from '@/utils/canvasPool';
import { FLOW_SLOT_MASK, type FlowMode } from '@/lib/colorCycle/flowEncoding';
import { decodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

export interface Renderer2DOptions {
  width: number;
  height: number;
  lazyImageData?: boolean;
  willReadFrequently?: boolean;
}

export class Renderer2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null;

  constructor(options: Renderer2DOptions) {
    this.canvas = canvasPool.acquire(options.width, options.height);
    const ctx = this.canvas.getContext('2d', {
      willReadFrequently: Boolean(options.willReadFrequently),
      alpha: true,
    });

    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }

    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = options.lazyImageData ? null : ctx.createImageData(options.width, options.height);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  hasImageData(): boolean {
    return !!this.imageData;
  }

  ensureImageData(): ImageData {
    if (!this.imageData) {
      this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    }
    return this.imageData;
  }

  getImageData(): ImageData {
    return this.ensureImageData();
  }

  render(options: {
    indexData: Uint8Array;
    gradientIdData?: Uint8Array;
    defIdData?: Uint16Array;
    defPalettesById?: Map<number, Uint32Array>;
    speedData?: Uint8Array;
    flowData?: Uint8Array;
    phaseData?: Uint8Array;
    paletteSlots: Uint32Array[];
    basePalette: Uint32Array;
    phase: number;
    baseOffset: number;
    baseTime: number;
    flowMode?: FlowMode;
  }) {
    const imageData = this.ensureImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    const legacyShift = (options.phase * 256) | 0;
    const offset = options.baseOffset;
    const gradientIdData = options.gradientIdData;
    const defIdData = options.defIdData;
    const defPalettesById = options.defPalettesById;
    const speedData = options.speedData;
    const flowData = options.flowData;
    const phaseData = options.phaseData;
    const baseTime = options.baseTime;
    void (options.flowMode ?? 'forward');

    for (let i = 0; i < options.indexData.length; i++) {
      const colorIndex = options.indexData[i];
      if (colorIndex === 0) {
        pixels32[i] = 0;
        continue;
      }
      const gid = gradientIdData ? gradientIdData[i] : 0;
      const slot = gid & FLOW_SLOT_MASK;
      const speedByte = speedData ? speedData[i] : 0;
      const flowByte = flowData ? flowData[i] : 0;
      const phaseByte = phaseData ? phaseData[i] : 0;
      const hasPerPixelSpeed = Boolean(speedData);
      const hasSpeed = speedByte > 0;
      const speed = hasSpeed ? decodeColorCycleSpeedByte(speedByte) : 0;
      const basePhase = hasSpeed ? (baseTime * speed) % 1 : (hasPerPixelSpeed ? 0 : offset);
      const phaseOffset = phaseByte / 256;
      let phase = (basePhase + phaseOffset) % 1;
      if (flowByte === 3) {
        const t = (phase * 2) % 2;
        phase = t > 1 ? 2 - t : t;
      }
      const dir = flowByte === 2 ? 1 : -1;
      const speedOffset = phase;
      const defId = defIdData ? defIdData[i] : 0;
      const palette =
        defId > 0
          ? defPalettesById?.get(defId) ?? options.basePalette
          : options.paletteSlots[slot] ?? options.basePalette;
      const shift = hasSpeed
        ? (dir * ((speedOffset * 256) | 0))
        : (hasPerPixelSpeed ? 0 : (dir * legacyShift));
      pixels32[i] = palette[(colorIndex - 1 + shift) & 255];
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  resize(width: number, height: number, options: { preserveImageData: boolean }) {
    const oldCanvas = this.canvas;
    const oldWidth = oldCanvas.width;
    const oldHeight = oldCanvas.height;

    let savedImageData: ImageData | null = null;
    if (options.preserveImageData && this.imageData && oldWidth > 0 && oldHeight > 0) {
      savedImageData = this.ctx.getImageData(0, 0, Math.min(oldWidth, width), Math.min(oldHeight, height));
    }

    this.canvas = canvasPool.acquire(width, height);
    const ctx = this.canvas.getContext('2d', {
      willReadFrequently: Boolean(this.imageData),
      alpha: true,
    });
    if (!ctx) {
      throw new Error('Failed to get context after resize');
    }

    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = this.ctx.createImageData(width, height);

    if (savedImageData) {
      this.ctx.putImageData(savedImageData, 0, 0);
    }

    canvasPool.release(oldCanvas);
  }

  drawFrom(source: HTMLCanvasElement, x: number = 0, y: number = 0) {
    this.ctx.drawImage(source, x, y);
  }

  cleanup() {
    if (this.canvas) {
      canvasPool.release(this.canvas);
    }
  }
}
