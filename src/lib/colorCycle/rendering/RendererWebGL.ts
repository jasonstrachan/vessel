import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import { WebGLColorCycleRenderer } from './WebGLColorCycleRenderer';

export type PaletteRGBA = Uint8ClampedArray | Uint8Array;

export class RendererWebGL {
  private renderer: WebGLColorCycleRenderer;
  private canvas: HTMLCanvasElement;
  private paletteSignaturesBySlot: Array<string | null> = new Array(256).fill(null);
  private paletteReady: boolean = false;

  constructor(options: { width: number; height: number }) {
    this.renderer = new WebGLColorCycleRenderer({ width: options.width, height: options.height });
    this.canvas = this.renderer.getCanvas();
  }

  static isSupported(): boolean {
    return WebGLColorCycleRenderer.isSupported();
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  isPaletteReady(signature?: string | null): boolean {
    if (!this.paletteReady) {
      return false;
    }
    if (signature && this.paletteSignaturesBySlot[0] !== signature) {
      return false;
    }
    return true;
  }

  ensureBasePalette(rgba: PaletteRGBA, signature?: string | null): boolean {
    if (this.isPaletteReady(signature)) {
      return true;
    }

    try {
      this.renderer.setPaletteRow(0, rgba);
      this.paletteSignaturesBySlot[0] = signature ?? this.paletteSignaturesBySlot[0];
      this.paletteReady = true;
      return true;
    } catch {
      this.paletteReady = false;
      return false;
    }
  }

  setPaletteRow(slot: number, rgba: PaletteRGBA, signature?: string | null) {
    this.renderer.setPaletteRow(slot, rgba);
    if (signature !== undefined) {
      const clamped = Math.max(0, Math.min(255, Math.round(slot)));
      this.paletteSignaturesBySlot[clamped] = signature;
      if (clamped === 0) {
        this.paletteReady = true;
      }
    }
  }

  syncPaletteAtlas(signatures: Array<string | null>, paletteRGBABySlot: Array<PaletteRGBA | null>) {
    for (let slot = 0; slot < 256; slot++) {
      const signature = signatures[slot];
      if (!signature) {
        continue;
      }
      if (this.paletteSignaturesBySlot[slot] === signature) {
        continue;
      }
      const rgba = paletteRGBABySlot[slot];
      if (!rgba) {
        continue;
      }
      try {
        this.renderer.setPaletteRow(slot, rgba);
        this.paletteSignaturesBySlot[slot] = signature;
      } catch {
        // Ignore palette upload errors; will retry lazily.
      }
    }
    this.paletteReady = this.paletteSignaturesBySlot[0] === signatures[0];
  }

  setIndexData(
    data: Uint8Array,
    gradientId?: Uint8Array,
    speedData?: Uint8Array,
    defIdData?: Uint16Array,
    rect?: { x: number; y: number; width: number; height: number },
    defIdDirty: boolean = true
  ) {
    this.renderer.setIndexData(data, gradientId, speedData, defIdData, rect, defIdDirty);
  }

  render(timeSeconds: number, legacyPhase: number = timeSeconds, flowMode: FlowMode = 'forward') {
    this.renderer.render(timeSeconds, legacyPhase, flowMode);
  }

  resize(width: number, height: number) {
    this.renderer.resize(width, height);
    this.canvas = this.renderer.getCanvas();
  }

  dispose() {
    this.renderer.dispose();
  }

  resetPaletteState() {
    this.paletteReady = false;
    this.paletteSignaturesBySlot.fill(null);
  }

  setDefPaletteRow(row: number, rgba: PaletteRGBA, signature?: string | null) {
    this.renderer.setDefPaletteRow(row, rgba);
    void signature;
  }

  setDefPaletteLut(lut: Uint8Array) {
    this.renderer.setDefPaletteLut(lut);
  }

  setDefPaletteRows(rows: number) {
    this.renderer.setDefPaletteRows(rows);
  }

  resetDefPaletteState() {
    this.renderer.resetDefPaletteState();
  }

  fillPolygonConcentric(options: Parameters<WebGLColorCycleRenderer['fillPolygonConcentric']>[0]) {
    return this.renderer.fillPolygonConcentric(options);
  }

  getFillMaxVerts(): number | null {
    if (typeof this.renderer.getFillMaxVerts === 'function') {
      return this.renderer.getFillMaxVerts();
    }
    return null;
  }
}
