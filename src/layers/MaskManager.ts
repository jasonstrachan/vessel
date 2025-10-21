import type { Layer } from '@/types';
import { perfMark, perfMeasure } from '@/utils/perf/ccPerfProbe';

export type MaskDimensions = { width: number; height: number };

export interface MaskManagerDeps {
  getLayer: (layerId: string) => Layer | undefined;
  updateLayer: (layerId: string, patch: Partial<Layer>) => void;
  getProjectSize: () => MaskDimensions | null;
}

export class MaskManager {
  private deps: MaskManagerDeps;

  constructor(deps: MaskManagerDeps) {
    this.deps = deps;
  }

  configure(deps: MaskManagerDeps): void {
    this.deps = deps;
  }

  getMask(layerId: string): HTMLCanvasElement {
    return this.ensureMask(layerId);
  }

  clear(layerId: string): void {
    const mask = this.ensureMask(layerId);
    const ctx = mask.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mask.width, mask.height);
    ctx.restore();
    this.bumpVersion(layerId);
  }

  resize(layerId: string, width: number, height: number): HTMLCanvasElement {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));
    const layer = this.requireColorCycleLayer(layerId);
    const currentMask = layer.colorCycleData?.eraseMask;
    if (
      currentMask &&
      currentMask.width === targetWidth &&
      currentMask.height === targetHeight
    ) {
      return currentMask;
    }
    return this.ensureMask(layerId, { width: targetWidth, height: targetHeight });
  }

  bumpVersion(layerId: string): void {
    const layer = this.requireColorCycleLayer(layerId);
    const currentVersion = layer.colorCycleData?.eraseMaskVersion ?? 0;
    this.deps.updateLayer(layerId, {
      colorCycleData: {
        eraseMaskVersion: currentVersion + 1
      }
    });
  }

  applyMaskToCanvas(
    layerId: string,
    targetCtx: CanvasRenderingContext2D,
    options: { perfLabel?: string } = {}
  ): void {
    const layer = this.deps.getLayer(layerId);
    const mask = layer?.colorCycleData?.eraseMask;
    if (!layer || !mask) {
      return;
    }
    const label = options.perfLabel ?? 'cc:mask:apply';
    perfMark(`${label}:start`);
    targetCtx.save();
    try {
      targetCtx.globalCompositeOperation = 'destination-out';
      targetCtx.drawImage(mask, 0, 0);
    } finally {
      targetCtx.restore();
      perfMark(`${label}:end`);
      perfMeasure(label, `${label}:start`, `${label}:end`);
    }
  }

  private ensureMask(layerId: string, requested?: MaskDimensions): HTMLCanvasElement {
    const layer = this.requireColorCycleLayer(layerId);
    const existingMask = layer.colorCycleData?.eraseMask ?? null;
    const dimensions = requested ?? this.resolveLayerDimensions(layer);
    const width = Math.max(1, Math.floor(dimensions.width));
    const height = Math.max(1, Math.floor(dimensions.height));

    if (existingMask && existingMask.width === width && existingMask.height === height) {
      return existingMask;
    }

    const mask = this.createMaskCanvas(width, height);
    if (existingMask) {
      const ctx = mask.getContext('2d');
      if (ctx) {
        ctx.drawImage(existingMask, 0, 0, existingMask.width, existingMask.height, 0, 0, width, height);
      }
    }

    const currentVersion = layer.colorCycleData?.eraseMaskVersion;
    const nextVersion =
      existingMask && typeof currentVersion === 'number'
        ? currentVersion + 1
        : existingMask
        ? 1
        : 0;

    this.deps.updateLayer(layerId, {
      colorCycleData: {
        eraseMask: mask,
        eraseMaskVersion: nextVersion
      }
    });

    return mask;
  }

  private requireColorCycleLayer(layerId: string): Layer {
    const layer = this.deps.getLayer(layerId);
    if (!layer) {
      throw new Error(`[MaskManager] Layer not found: ${layerId}`);
    }
    if (layer.layerType !== 'color-cycle') {
      throw new Error(`[MaskManager] Layer ${layerId} is not color-cycle`);
    }
    return layer;
  }

  private resolveLayerDimensions(layer: Layer): MaskDimensions {
    const ccCanvas = layer.colorCycleData?.canvas;
    if (ccCanvas) {
      return { width: ccCanvas.width, height: ccCanvas.height };
    }
    const framebuffer = layer.framebuffer as
      | HTMLCanvasElement
      | (OffscreenCanvas & { width: number; height: number })
      | undefined;
    if (framebuffer && typeof framebuffer.width === 'number' && typeof framebuffer.height === 'number') {
      return {
        width: framebuffer.width,
        height: framebuffer.height
      };
    }
    const project = this.deps.getProjectSize();
    if (project) {
      return project;
    }
    return { width: 1, height: 1 };
  }

  private createMaskCanvas(width: number, height: number): HTMLCanvasElement {
    if (typeof document === 'undefined') {
      throw new Error('[MaskManager] document is not available to create mask canvas');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }
}

let globalMaskManager: MaskManager | null = null;

export const configureMaskManager = (deps: MaskManagerDeps): MaskManager => {
  if (!globalMaskManager) {
    globalMaskManager = new MaskManager(deps);
    return globalMaskManager;
  }
  globalMaskManager.configure(deps);
  return globalMaskManager;
};

export const getMaskManager = (): MaskManager => {
  if (!globalMaskManager) {
    throw new Error('[MaskManager] Manager accessed before configuration');
  }
  return globalMaskManager;
};
