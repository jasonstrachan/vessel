import { resolveRecolorPalettePosition } from '@/lib/colorCycle/gobletPlaybackMath';
import { parseCssColor } from '@/utils/color/parseCssColor';
import type { Layer } from '@/types';

import type { RecolorSettings } from '../types';

type FrameBufferEntry = {
  imageData: ImageData;
  pixels32: Uint32Array;
};

export class CPUColorCycleRenderer {
  private frameBuffers = new Map<string, FrameBufferEntry>();

  render(
    layer: Layer,
    settings: RecolorSettings,
    tick: number
  ): ImageData | null {
    const imageData = layer.imageData;
    if (!imageData) return null;

    const { width, height } = imageData;
    const indices = this.getRenderIndices(layer, settings);
    if (!indices) return null;
    const gradientLUT = this.buildGradientLUT(settings, tick);
    const fb = this.getFrameBuffer(layer.id, width, height);
    this.fillPixelsFromIndices(indices, gradientLUT, fb.pixels32, width, height, settings.originalImageData?.data);
    return fb.imageData;
  }

  getRenderIndices(layer: Layer, settings: RecolorSettings): Uint8Array | undefined {
    if ((settings.flowMapping ?? 'palette') === 'palette') return settings.indexBuffer;
    this.ensurePhaseMap(layer, settings);
    return settings.phaseMap;
  }

  releaseLayer(layerId: string): void {
    this.frameBuffers.delete(layerId);
  }

  getStats(): { pooledBuffers: number; memoryUsage: number } {
    let pooledBuffers = 0;
    let memoryUsage = 0;

    for (const { imageData } of this.frameBuffers.values()) {
      pooledBuffers += 1;
      memoryUsage += imageData.data.byteLength;
    }

    return { pooledBuffers, memoryUsage };
  }

  private ensurePhaseMap(layer: Layer, settings: RecolorSettings): void {
    const flowMapping = settings.flowMapping ?? 'palette';
    if (flowMapping === 'palette') return;

    const imageData = layer.imageData;
    if (!imageData) return;

    const { width, height } = imageData;

    const needsRebuild =
      !settings.phaseMap || settings.phaseMap.length !== width * height;

    if (!needsRebuild) return;

    if (flowMapping === 'directional') {
      const angleDeg = Number.isFinite(settings.directionAngle)
        ? (settings.directionAngle as number)
        : 0;
      const bandWidthPx =
        Number.isFinite(settings.bandWidthPx) && (settings.bandWidthPx as number) > 0
          ? (settings.bandWidthPx as number)
          : 64;
      settings.phaseMap = this.buildDirectionalPhaseMap(
        width,
        height,
        angleDeg,
        bandWidthPx
      );
    } else if (flowMapping === 'luminance') {
      const src = settings.originalImageData ?? imageData;
      settings.phaseMap = this.buildLuminancePhaseMap(src);
    }
  }

  private buildDirectionalPhaseMap(
    width: number,
    height: number,
    angleDeg: number,
    wavelengthPx: number
  ): Uint8Array {
    const map = new Uint8Array(width * height);
    const theta = ((angleDeg % 360) * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const invWave = 1 / Math.max(1e-6, wavelengthPx);
    let idx = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++, idx++) {
        const proj = x * cos + y * sin;
        let phase = proj * invWave;
        phase = phase - Math.floor(phase);
        map[idx] = Math.max(0, Math.min(255, Math.floor(phase * 256))) as number;
      }
    }
    return map;
  }

  private buildLuminancePhaseMap(img: ImageData): Uint8Array {
    const map = new Uint8Array(img.width * img.height);
    const data = img.data;
    let idx = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = Math.max(
        0,
        Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b))
      );
      map[idx++] = luma;
    }
    return map;
  }

  buildGradientLUT(
    settings: RecolorSettings,
    tick: number
  ): Uint32Array {
    const lut = new Uint32Array(256);
    const gradient = settings.gradient ?? [];
    for (let i = 0; i < 256; i++) {
      const pos = resolveRecolorPalettePosition(i, settings, tick);

      const color = gradient.length > 0
        ? this.sampleGradient(gradient, pos)
        : { r: 255, g: 255, b: 255, a: 255 };

      lut[i] = (color.a << 24) | (color.b << 16) | (color.g << 8) | color.r;
    }

    return lut;
  }

  private sampleGradient(
    gradient: RecolorSettings['gradient'],
    position: number
  ): { r: number; g: number; b: number; a: number } {
    if (gradient.length === 0) {
      return { r: 255, g: 255, b: 255, a: 255 };
    }

    if (gradient.length === 1) {
      return this.parseColor(gradient[0].color, gradient[0].opacity);
    }

    let leftStop = gradient[0];
    let rightStop = gradient[gradient.length - 1];

    for (let i = 0; i < gradient.length - 1; i++) {
      if (
        position >= gradient[i].position &&
        position <= gradient[i + 1].position
      ) {
        leftStop = gradient[i];
        rightStop = gradient[i + 1];
        break;
      }
    }

    const range = rightStop.position - leftStop.position;
    const localProgress = range > 0 ? (position - leftStop.position) / range : 0;

    const leftColor = this.parseColor(leftStop.color, leftStop.opacity);
    const rightColor = this.parseColor(rightStop.color, rightStop.opacity);

    return {
      r: Math.round(leftColor.r + (rightColor.r - leftColor.r) * localProgress),
      g: Math.round(leftColor.g + (rightColor.g - leftColor.g) * localProgress),
      b: Math.round(leftColor.b + (rightColor.b - leftColor.b) * localProgress),
      a: Math.round(leftColor.a + (rightColor.a - leftColor.a) * localProgress),
    };
  }

  private parseColor(color: string, opacity?: number): { r: number; g: number; b: number; a: number } {
    const parsed = parseCssColor(color, { r: 255, g: 255, b: 255, a: 255 });
    const stopOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity!)) : 1;
    return { ...parsed, a: Math.round(parsed.a * stopOpacity) };
  }

  private getFrameBuffer(
    layerId: string,
    width: number,
    height: number
  ): FrameBufferEntry {
    let fb = this.frameBuffers.get(layerId);
    if (!fb || fb.imageData.width !== width || fb.imageData.height !== height) {
      const imageData = new ImageData(width, height);
      fb = { imageData, pixels32: new Uint32Array(imageData.data.buffer) };
      this.frameBuffers.set(layerId, fb);
    }
    return fb;
  }

  private fillPixelsFromIndices(
    indices: Uint8Array,
    lut: Uint32Array,
    outPixels32: Uint32Array,
    width: number,
    height: number,
    originalAlpha?: Uint8ClampedArray
  ): void {
    if (originalAlpha && originalAlpha.length >= width * height * 4) {
      for (let i = 0, aIdx = 3; i < indices.length; i++, aIdx += 4) {
        const rgb = lut[indices[i]] & 0x00ffffff;
        const a = Math.round(originalAlpha[aIdx] * (lut[indices[i]] >>> 24) / 255);
        outPixels32[i] = (a << 24) | rgb;
      }
      return;
    }

    for (let i = 0; i < indices.length; i++) {
      outPixels32[i] = lut[indices[i]];
    }
  }
}
