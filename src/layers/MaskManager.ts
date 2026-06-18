import type { Layer } from '@/types';
import type { ColorCyclePaintMask } from '@/utils/colorCyclePaintMask';

export type MaskDimensions = { width: number; height: number };

type LayerUpdateOptions = { skipColorCycleSync?: boolean };
const MASK_UPDATE_OPTIONS: LayerUpdateOptions = { skipColorCycleSync: true };

export interface MaskManagerDeps {
  getLayer: (layerId: string) => Layer | undefined;
  updateLayer: (layerId: string, patch: Partial<Layer>, options?: LayerUpdateOptions) => void;
  getProjectSize: () => MaskDimensions | null;
}

export class MaskManager {
  private deps: MaskManagerDeps;
  private pendingHealMasks = new Map<string, HTMLCanvasElement>();
  private pendingHealBounds = new Map<string, MaskDimensions & { x: number; y: number }>();
  private effectiveMaskScratch = new Map<string, HTMLCanvasElement>();

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
    this.clearPendingHealMask(layerId);
    this.bumpVersion(layerId);
  }

  addPendingHealMask(layerId: string, paintMask: ColorCyclePaintMask): void {
    if (paintMask.width <= 0 || paintMask.height <= 0 || paintMask.data.length === 0) {
      return;
    }
    const layer = this.requireColorCycleLayer(layerId);
    const dimensions = this.resolveLayerDimensions(layer);
    const width = Math.max(1, Math.floor(dimensions.width));
    const height = Math.max(1, Math.floor(dimensions.height));
    const pending = this.ensurePendingHealCanvas(layerId, width, height);
    const ctx = pending.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return;
    }
    const imageData = new ImageData(
      this.paintMaskToRgba(paintMask.data),
      paintMask.width,
      paintMask.height
    );
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.putImageData(imageData, paintMask.bounds.x, paintMask.bounds.y);
      this.mergePendingHealBounds(layerId, paintMask.bounds);
    } finally {
      ctx.restore();
    }
  }

  clearPendingHealMask(layerId: string): void {
    this.pendingHealMasks.delete(layerId);
    this.pendingHealBounds.delete(layerId);
    this.effectiveMaskScratch.delete(layerId);
  }

  commitPendingHealMask(layerId: string): boolean {
    const pending = this.pendingHealMasks.get(layerId);
    if (!pending) {
      return false;
    }
    const mask = this.ensureMask(layerId);
    const ctx = mask.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.clearPendingHealMask(layerId);
      return false;
    }
    const bounds = this.pendingHealBounds.get(layerId) ?? {
      x: 0,
      y: 0,
      width: mask.width,
      height: mask.height,
    };
    try {
      this.subtractPendingMask(ctx, pending, bounds);
    } catch {
      this.clearPendingHealMask(layerId);
      return false;
    } finally {
      this.clearPendingHealMask(layerId);
    }
    this.bumpVersion(layerId);
    return true;
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
    this.deps.updateLayer(
      layerId,
      {
        colorCycleData: {
          eraseMaskVersion: currentVersion + 1
        }
      },
      MASK_UPDATE_OPTIONS
    );
  }

  applyMaskToCanvas(
    layerId: string,
    targetCtx: CanvasRenderingContext2D
  ): void {
    const layer = this.deps.getLayer(layerId);
    const mask = layer?.colorCycleData?.eraseMask;
    if (!layer || !mask) {
      return;
    }
    const effectiveMask = this.getEffectiveMask(layerId, mask);
    targetCtx.save();
    try {
      targetCtx.globalCompositeOperation = 'destination-out';
      targetCtx.drawImage(effectiveMask, 0, 0);
    } finally {
      targetCtx.restore();
    }
  }

  private ensurePendingHealCanvas(layerId: string, width: number, height: number): HTMLCanvasElement {
    const existing = this.pendingHealMasks.get(layerId);
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }
    const canvas = this.createMaskCanvas(width, height);
    this.pendingHealMasks.set(layerId, canvas);
    return canvas;
  }

  private getEffectiveMask(layerId: string, mask: HTMLCanvasElement): HTMLCanvasElement {
    const pending = this.pendingHealMasks.get(layerId);
    if (!pending) {
      return mask;
    }
    let scratch = this.effectiveMaskScratch.get(layerId);
    if (!scratch || scratch.width !== mask.width || scratch.height !== mask.height) {
      scratch = this.createMaskCanvas(mask.width, mask.height);
      this.effectiveMaskScratch.set(layerId, scratch);
    }
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return mask;
    }
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, scratch.width, scratch.height);
      ctx.drawImage(mask, 0, 0);
      const bounds = this.pendingHealBounds.get(layerId) ?? {
        x: 0,
        y: 0,
        width: scratch.width,
        height: scratch.height,
      };
      this.subtractPendingMask(ctx, pending, bounds);
    } finally {
      ctx.restore();
    }
    return scratch;
  }

  private subtractPendingMask(
    targetCtx: CanvasRenderingContext2D,
    pending: HTMLCanvasElement,
    bounds: MaskDimensions & { x: number; y: number }
  ): void {
    const pendingCtx = pending.getContext('2d', { willReadFrequently: true });
    if (!pendingCtx) {
      return;
    }
    const x = Math.max(0, Math.floor(bounds.x));
    const y = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(targetCtx.canvas.width, Math.ceil(bounds.x + bounds.width));
    const bottom = Math.min(targetCtx.canvas.height, Math.ceil(bounds.y + bounds.height));
    if (right <= x || bottom <= y) {
      return;
    }
    const width = right - x;
    const height = bottom - y;
    const targetData = targetCtx.getImageData(x, y, width, height);
    const pendingData = pendingCtx.getImageData(x, y, width, height);
    let changed = false;
    for (let index = 3; index < targetData.data.length; index += 4) {
      if (pendingData.data[index] === 0 || targetData.data[index] === 0) {
        continue;
      }
      targetData.data[index - 3] = 0;
      targetData.data[index - 2] = 0;
      targetData.data[index - 1] = 0;
      targetData.data[index] = 0;
      changed = true;
    }
    if (changed) {
      targetCtx.putImageData(targetData, x, y);
    }
  }

  private mergePendingHealBounds(
    layerId: string,
    incoming: MaskDimensions & { x: number; y: number }
  ): void {
    const existing = this.pendingHealBounds.get(layerId);
    if (!existing) {
      this.pendingHealBounds.set(layerId, {
        x: incoming.x,
        y: incoming.y,
        width: incoming.width,
        height: incoming.height,
      });
      return;
    }
    const x = Math.min(existing.x, incoming.x);
    const y = Math.min(existing.y, incoming.y);
    const right = Math.max(existing.x + existing.width, incoming.x + incoming.width);
    const bottom = Math.max(existing.y + existing.height, incoming.y + incoming.height);
    this.pendingHealBounds.set(layerId, {
      x,
      y,
      width: right - x,
      height: bottom - y,
    });
  }

  private paintMaskToRgba(mask: Uint8Array): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i += 1) {
      const alpha = mask[i];
      if (alpha === 0) {
        continue;
      }
      const offset = i * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = alpha;
    }
    return rgba;
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

    this.deps.updateLayer(
      layerId,
      {
        colorCycleData: {
          eraseMask: mask,
          eraseMaskVersion: nextVersion
        }
      },
      MASK_UPDATE_OPTIONS
    );

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
