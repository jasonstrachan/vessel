/**
 * ColorCycleAnimator - Integrates AnimationController with color cycling
 * Provides a complete animated drawing system with indexed colors
 */

import { IndexBuffer } from './IndexBuffer';
import { debugLog, debugWarn } from '../utils/debug';
// Debug logs suppressed for color cycle GPU path
import { GradientPalette, GradientStop } from './GradientPalette';
import { AnimationController } from './AnimationController';
import { PaletteController } from '@/lib/colorCycle/PaletteController';
import { Renderer2D } from '@/lib/colorCycle/Renderer2D';
import { RendererWebGL, type PaletteRGBA } from '@/lib/colorCycle/rendering/RendererWebGL';
import { FlowMode, StrokeOrderTracker } from '@/lib/colorCycle/StrokeOrderTracker';
import type { CCIndexSurface, CCIndexSurfaceRect } from '@/lib/colorCycle/CCIndexSurface';
import { MAX_BRUSH_COLOR_CYCLE_SPEED, MIN_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';

type GPUFillMode = 'concentric' | 'linear';

interface GPUFillOptions {
  mode: GPUFillMode;
  bands: number;
  baseOffset: number;
  colorStep: number;
  bbox: { minX: number; minY: number; width: number; height: number };
  maxDist?: number;
  direction?: { x: number; y: number };
  directionOrigin?: { x: number; y: number };
  directionRange?: { min: number; range: number };
  ditherStrength?: number;
  ditherPixelSize?: number;
  noiseSeed?: number;
}

type DirectFillHandle = {
  data: Uint8Array;
  gradientId: Uint8Array;
  speedData: Uint8Array;
  flowData: Uint8Array;
  phaseData: Uint8Array;
  width: number;
  height: number;
};

export interface ColorCycleAnimatorConfig {
  width: number;
  height: number;
  gradientStops?: GradientStop[];
  fps?: number;
  speed?: number;
  autoStart?: boolean;
  lazyInit?: boolean; // Support deferred heavy initialization
  forceCanvas2D?: boolean; // Force CPU rendering even if WebGL is available
}

export class ColorCycleAnimator implements CCIndexSurface {
  private indexBuffer: IndexBuffer;
  private animationController: AnimationController;
  private paletteController: PaletteController;
  private renderer2D: Renderer2D;
  // GPU renderer (optional)
  private glRenderer: RendererWebGL | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  // One-time render path log guard
  private _renderPathLogged: boolean = false;
  // Palette upload guard for GPU renderer
  // One-time sample log guard
  private _renderSampledOnce: boolean = false;
  private _dbgSpeedStatsLogged: boolean = false;
  // Track when index buffer changed to avoid re-uploading every frame
  private _glIndexDirty: boolean = true;
  private _glDefIdDirty: boolean = true;
  private currentSpeedByte: number = 0;
  // Rendering mode flag
  private forceCanvas2D: boolean = false;
  private strokeTracker: StrokeOrderTracker;
  private defIdData: Uint16Array | null = null;
  private defPalettesById: Map<number, Uint32Array> | null = null;
  private defPaletteRGBAById: Map<number, PaletteRGBA> | null = null;
  private defPaletteSignaturesById: Map<number, string> | null = null;
  private defIdUsageSet: Set<number> | null = null;
  private defIdUsageDirty: boolean = false;
  private defValidationDirty: boolean = false;
  private defPaletteCacheDirty: boolean = false;
  private defAtlasRowById: Map<number, number> = new Map();
  private defAtlasRowSignatures: Array<string | null> = [];
  private defAtlasMaxRows: number = 1024;
  private defAtlasLut: Uint8Array | null = null;
  
  // Callbacks
  private onFrameCallbacks: Set<(imageData: ImageData) => void> = new Set();
  private directFillDepth: number = 0;

  constructor(config: ColorCycleAnimatorConfig) {
    this.forceCanvas2D = Boolean(config.forceCanvas2D);

    const isLazy = Boolean(config.lazyInit);
    this.indexBuffer = new IndexBuffer(config.width, config.height);
    this.paletteController = new PaletteController({ gradientStops: config.gradientStops });
    this.renderer2D = new Renderer2D({
      width: config.width,
      height: config.height,
      lazyImageData: isLazy,
      willReadFrequently: !isLazy,
    });
    this.strokeTracker = new StrokeOrderTracker(
      isLazy ? 0 : config.width,
      isLazy ? 0 : config.height
    );

    if (!this.forceCanvas2D && typeof window !== 'undefined' && RendererWebGL.isSupported()) {
      try {
        this.glRenderer = new RendererWebGL({ width: config.width, height: config.height });
        this.glCanvas = this.glRenderer.getCanvas();
      } catch (error) {
        if (error instanceof Error && error.message === 'WEBGL_CONTEXT_BUDGET_EXCEEDED') {
          this.forceCanvas2D = true;
          debugWarn('cc-render', '[ColorCycleAnimator] WebGL context budget exhausted; using Canvas2D');
        } else {
          debugWarn('cc-render', '[ColorCycleAnimator] Failed to init WebGL renderer:', error);
        }
        this.glRenderer = null;
        this.glCanvas = null;
      }
    }

    this.animationController = new AnimationController({
      fps: config.fps || 30,
      speed: config.speed || 0.1,
      autoStart: isLazy ? false : config.autoStart || false,
      onFrame: this.handleAnimationFrame.bind(this),
    });

    if (isLazy) {
      requestAnimationFrame(() => this.updateIndexBufferPalette());
    } else {
      this.updateIndexBufferPalette();
    }
  }

  get width(): number {
    return this.indexBuffer.getDimensions().width;
  }

  get height(): number {
    return this.indexBuffer.getDimensions().height;
  }

  getIndexBuffers(): { data: Uint8Array; gid?: Uint8Array; spd?: Uint8Array; flow?: Uint8Array; phase?: Uint8Array } {
    return {
      data: this.indexBuffer.getDirectData(),
      gid: this.indexBuffer.getDirectGradientIdData(),
      spd: this.indexBuffer.getDirectSpeedData(),
      flow: this.indexBuffer.getDirectFlowData(),
      phase: this.indexBuffer.getDirectPhaseData(),
    };
  }

  setIndexBuffers(data: Uint8Array, gid?: Uint8Array, spd?: Uint8Array, flow?: Uint8Array, phase?: Uint8Array): void {
    this.setIndexBufferFromArray(data, gid, spd, flow, phase);
  }

  setDefIdData(defIdData?: Uint16Array | null, options?: { forceDirty?: boolean }): void {
    const next = defIdData && defIdData.length > 0 ? defIdData : null;
    const sameRef = next === this.defIdData;
    this.defIdData = next;
    if (sameRef && !options?.forceDirty) {
      return;
    }
    this.defIdUsageDirty = true;
    this.defValidationDirty = true;
    this._glDefIdDirty = true;
  }

  setDefPaletteCache(cache?: {
    palettesById: Map<number, Uint32Array>;
    rgbaById: Map<number, PaletteRGBA>;
    signaturesById: Map<number, string>;
  } | null): void {
    if (!cache) {
      this.defPalettesById = null;
      this.defPaletteRGBAById = null;
      this.defPaletteSignaturesById = null;
    } else {
      this.defPalettesById = cache.palettesById;
      this.defPaletteRGBAById = cache.rgbaById;
      this.defPaletteSignaturesById = cache.signaturesById;
    }
    this.defPaletteCacheDirty = true;
    this.defValidationDirty = true;
  }

  markDirty(bounds?: CCIndexSurfaceRect): void {
    if (!bounds) {
      this.indexBuffer.markDirty();
      this._glIndexDirty = true;
      return;
    }
    const minX = Math.floor(bounds.x);
    const minY = Math.floor(bounds.y);
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));
    this.markDirtyBounds({ minX, minY, width, height });
  }

  renderToCanvas2D(ctx: CanvasRenderingContext2D): void {
    this.drawTo(ctx, 0, 0);
  }

  
  /**
   * Handle animation frame
   */
  private handleAnimationFrame() {
    // Get current animation offset
    const offset = this.animationController.getOffset();
    
    // Render frame with offset
    this.renderFrame(offset);
    
    // Notify all callbacks
    const frameImageData = this.renderer2D.ensureImageData();
    this.onFrameCallbacks.forEach(callback => {
      callback(frameImageData);
    });
  }
  
  /**
   * Update IndexBuffer palette from gradient
   */
  private updateIndexBufferPalette() {
    const paletteStrings = this.paletteController.getPaletteStrings();
    this.indexBuffer.setPalette(paletteStrings);
    const handle = this.paletteController.getPaletteHandle();
    // If GPU renderer exists, upload palette once (as base palette)
    if (!this.forceCanvas2D && this.glRenderer) {
      try {
        const signature = this.paletteController.getSignatureForSlot(0);
        this.glRenderer.setPaletteRow(0, handle.rgba, signature ?? undefined);
      } catch {}
    }
  }

  private syncPaletteAtlasToGPU() {
    if (this.forceCanvas2D || !this.glRenderer) {
      return;
    }
    this.glRenderer.syncPaletteAtlas(
      this.paletteController.getPaletteSignaturesBySlot(),
      this.paletteController.getPaletteRGBABySlot()
    );
  }

  private computeDefIdsInUse(): Set<number> {
    const used = new Set<number>();
    const data = this.defIdData;
    if (!data || data.length === 0) {
      return used;
    }
    for (let i = 0; i < data.length; i += 1) {
      const id = data[i];
      if (id > 0) {
        used.add(id);
      }
    }
    return used;
  }

  private getDefIdsInUse(): Set<number> {
    if (this.defIdUsageDirty || !this.defIdUsageSet) {
      this.defIdUsageSet = this.computeDefIdsInUse();
      this.defIdUsageDirty = false;
    }
    return this.defIdUsageSet;
  }

  private validateDefPalettes(defIdsInUse: Set<number>): void {
    if (process.env.NODE_ENV === 'production' || !this.defValidationDirty) {
      return;
    }
    this.defValidationDirty = false;
    if (!this.defPalettesById || defIdsInUse.size === 0) {
      return;
    }
    let missing: number | null = null;
    for (const id of defIdsInUse) {
      if (!this.defPalettesById.has(id)) {
        missing = id;
        break;
      }
    }
    if (missing !== null) {
      console.assert(false, '[CC] Missing def palette for defId', { defId: missing });
    }
  }

  private syncDefPaletteAtlasToGPU(defIdsInUse: Set<number>): Set<number> {
    const nonResident = new Set<number>();
    if (this.forceCanvas2D || !this.glRenderer) {
      return nonResident;
    }
    if (!this.defPaletteRGBAById || !this.defPaletteSignaturesById || defIdsInUse.size === 0) {
      this.defAtlasRowById.clear();
      this.defAtlasRowSignatures = [];
      this.defPaletteCacheDirty = false;
      this.defAtlasLut = null;
      this.glRenderer.resetDefPaletteState?.();
      return nonResident;
    }

    const maxRows = Math.max(1, this.defAtlasMaxRows);
    let lutDirty = this.defPaletteCacheDirty || !this.defAtlasLut;
    if (this.defAtlasRowSignatures.length !== maxRows) {
      this.defAtlasRowSignatures = new Array(maxRows).fill(null);
      this.defAtlasRowById.clear();
      lutDirty = true;
    }

    const isRowUsed = new Array(maxRows).fill(false);
    const currentDefs = new Set(defIdsInUse);

    for (const [defId, row] of this.defAtlasRowById.entries()) {
      if (!currentDefs.has(defId)) {
        this.defAtlasRowById.delete(defId);
        if (row >= 0 && row < maxRows) {
          this.defAtlasRowSignatures[row] = null;
        }
        lutDirty = true;
      }
    }

    for (const row of this.defAtlasRowById.values()) {
      if (row >= 0 && row < maxRows) {
        isRowUsed[row] = true;
      }
    }

    const freeRows: number[] = [];
    for (let row = 0; row < maxRows; row += 1) {
      if (!isRowUsed[row]) {
        freeRows.push(row);
      }
    }

    try {
      this.glRenderer.setDefPaletteRows?.(maxRows);
    } catch {}

    for (const defId of defIdsInUse) {
      const signature = this.defPaletteSignaturesById.get(defId);
      const rgba = this.defPaletteRGBAById.get(defId);
      if (!signature || !rgba) {
        nonResident.add(defId);
        continue;
      }
      let row = this.defAtlasRowById.get(defId);
      if (typeof row !== 'number' || row < 0 || row >= maxRows) {
        const nextRow = freeRows.shift();
        if (typeof nextRow !== 'number') {
          nonResident.add(defId);
          continue;
        }
        row = nextRow;
        this.defAtlasRowById.set(defId, row);
        lutDirty = true;
      }
      if (this.defAtlasRowSignatures[row] !== signature || this.defPaletteCacheDirty) {
        try {
          this.glRenderer.setDefPaletteRow?.(row, rgba, signature);
        } catch {}
        this.defAtlasRowSignatures[row] = signature;
      }
    }

    if (lutDirty) {
      const lut = this.defAtlasLut && this.defAtlasLut.length === 256 * 256 * 2
        ? this.defAtlasLut
        : new Uint8Array(256 * 256 * 2);
      lut.fill(0);
      for (const [defId, row] of this.defAtlasRowById.entries()) {
        const idx = defId * 2;
        if (idx < 0 || idx + 1 >= lut.length) {
          continue;
        }
        const encoded = row + 1;
        lut[idx] = encoded & 0xff;
        lut[idx + 1] = (encoded >> 8) & 0xff;
      }
      this.defAtlasLut = lut;
      try {
        this.glRenderer.setDefPaletteLut?.(lut);
      } catch {}
    }

    this.defPaletteCacheDirty = false;
    return nonResident;
  }

  /**
   * Whether GPU renderer is available
   */
  hasWebGL(): boolean {
    return !this.forceCanvas2D && !!this.glRenderer;
  }

  getPalettesBySlot(): Uint32Array[] {
    return this.paletteController.getPalettesBySlot();
  }

  getPaletteRGBABySlot(): Array<Uint8ClampedArray | Uint8Array | null> {
    return this.paletteController.getPaletteRGBABySlot();
  }


  setForceCanvas2D(force: boolean) {
    if (this.forceCanvas2D === force) {
      return;
    }

    this.forceCanvas2D = force;

    if (force) {
      if (this.glRenderer) {
        try {
          this.glRenderer.dispose();
        } catch {}
      }
      this.glRenderer = null;
      this.glCanvas = null;
      this._glIndexDirty = true;
      this._renderSampledOnce = false;
    } else if (!this.glRenderer && typeof window !== 'undefined' && RendererWebGL.isSupported()) {
      try {
        const canvas = this.renderer2D.getCanvas();
        this.glRenderer = new RendererWebGL({ width: canvas.width, height: canvas.height });
        this.glCanvas = this.glRenderer.getCanvas();
        this._glIndexDirty = true;
        this._renderSampledOnce = false;
        this.syncPaletteAtlasToGPU();
      } catch (error) {
        // Failed to initialize WebGL; fall back to Canvas2D
        this.forceCanvas2D = true;
        this.glRenderer = null;
        this.glCanvas = null;
        this._renderSampledOnce = false;
        if (error instanceof Error) {
          if (error.message === 'WEBGL_CONTEXT_BUDGET_EXCEEDED') {
            debugWarn('cc-render', '[ColorCycleAnimator] WebGL context budget exhausted when enabling GPU; staying on Canvas2D');
          } else {
            debugWarn('cc-render', '[ColorCycleAnimator] setForceCanvas2D -> WebGL init failed:', error);
          }
        }
      }
    }

    // Force a redraw so consumers see the updated rendering mode
    try {
      this.forceRender();
    } catch {}
  }

  /**
   * GPU concentric fill: renders polygon bands on the GPU into an offscreen buffer,
   * reads back indices for the bbox, and writes into our index buffer.
   * Falls back to no-op if GPU is not available.
   */
  gpuFillShape(
    vertices: Array<{ x: number; y: number }>,
    options: GPUFillOptions,
    gradientSlot: number = 0,
    speedByte: number = 0,
    flowByte: number = 0,
    resolvePhaseByte?: (x: number, y: number, colorIndex: number) => number,
  ): boolean {
    if (this.forceCanvas2D || !this.glRenderer || vertices.length < 3) {
      return false;
    }
    try {
      // quiet
      const flat = new Float32Array(vertices.length * 2);
      for (let i = 0; i < vertices.length; i++) {
        flat[i * 2] = vertices[i].x;
        flat[i * 2 + 1] = vertices[i].y;
      }

      const modeValue = options.mode === 'linear' ? 1 : 0;
      const canvas = this.renderer2D.getCanvas();
      const result = this.glRenderer.fillPolygonConcentric({
        vertices: flat,
        bands: options.bands,
        baseOffset: options.baseOffset,
        colorStep: options.colorStep,
        maxDist: Math.max(1, options.maxDist ?? 1),
        bbox: options.bbox,
        canvasHeight: canvas.height,
        mode: modeValue,
        direction: options.direction,
        directionOrigin: options.directionOrigin,
        directionRange: options.directionRange,
        ditherStrength: options.ditherStrength,
        ditherPixelSize: options.ditherPixelSize,
        noiseSeed: options.noiseSeed,
      });

      if (!result) return false;

      const data = this.indexBuffer.getDirectData();
      const gradientId = this.indexBuffer.getDirectGradientIdData();
      const speedData = this.indexBuffer.getDirectSpeedData();
      const flowData = this.indexBuffer.getDirectFlowData();
      const phaseData = this.indexBuffer.getDirectPhaseData();
      const width = canvas.width;
      const { minX, minY, width: bw, height: bh } = options.bbox;
      const clampedSlot = Math.max(0, Math.min(255, Math.round(gradientSlot)));
      const clampedSpeed = Math.max(0, Math.min(255, Math.round(speedByte)));
      const clampedFlow = Math.max(0, Math.min(255, Math.round(flowByte)));

      // Blit rows into the index buffer
      // WebGL readPixels returns rows bottom-to-top; flip vertically to top-left origin
      let wroteNonZero = false;
      for (let y = 0; y < bh; y++) {
        const srcStart = y * bw;
        const destY = minY + (bh - 1 - y);
        const destStart = destY * width + minX;
        data.set(result.subarray(srcStart, srcStart + bw), destStart);
        for (let x = 0; x < bw; x++) {
          const value = result[srcStart + x];
          gradientId[destStart + x] = value === 0 ? 0 : clampedSlot;
          speedData[destStart + x] = value === 0 ? 0 : clampedSpeed;
          flowData[destStart + x] = value === 0 ? 0 : clampedFlow;
          phaseData[destStart + x] =
            value === 0
              ? 0
              : (resolvePhaseByte ? resolvePhaseByte(minX + x, destY, value) : 0);
          if (value !== 0) {
            wroteNonZero = true;
          }
        }
      }
      if (clampedSlot !== 0 && wroteNonZero) {
        this.indexBuffer.markHasNonZeroGradientIds();
      }
      this.indexBuffer.markDirtyBounds(
        minX,
        minY,
        minX + bw - 1,
        minY + bh - 1
      );

      // Mark index as dirty for GPU texture upload and force a render
      this._glIndexDirty = true;
      // Force a render to show the update
      this.forceRender();
      // Determine if any indices are non-zero to confirm visible output
      let hasContent = false;
      for (let i = 0; i < result.length; i++) { if (result[i] !== 0) { hasContent = true; break; } }
      return hasContent;
    } catch {
      // quiet
      return false;
    }
  }

  beginDirectFill(): DirectFillHandle {
    this.directFillDepth += 1;
    const { width, height } = this.indexBuffer.getDimensions();
    return {
      data: this.indexBuffer.getDirectData(),
      gradientId: this.indexBuffer.getDirectGradientIdData(),
      speedData: this.indexBuffer.getDirectSpeedData(),
      flowData: this.indexBuffer.getDirectFlowData(),
      phaseData: this.indexBuffer.getDirectPhaseData(),
      width,
      height,
    };
  }

  endDirectFill(options?: { markDirty?: boolean }) {
    if (this.directFillDepth > 0) {
      this.directFillDepth -= 1;
    }
    const shouldDirty = options?.markDirty !== false;
    if (shouldDirty) {
      this.indexBuffer.markDirty();
      this._glIndexDirty = true;
    }
  }

  /** Return runtime GPU vertex limit for fill shader (if available) */
  getGLFillMaxVerts(): number | null {
    if (this.forceCanvas2D) {
      return null;
    }
    try { return this.glRenderer?.getFillMaxVerts?.() ?? null; } catch { return null; }
  }
  
  /**
   * Render a single frame with directional flow
   */
  private renderFrame(offset: number = 0, baseTimeOverride?: number) {
    try {
      const legacyPhase = this.strokeTracker.computePhase(offset);
      const flowMode = this.strokeTracker.getFlowMode();
      const baseOffset = offset;
      const baseTime =
        Number.isFinite(baseTimeOverride)
          ? (baseTimeOverride as number)
          : this.animationController.getScaledElapsedTime();
      const indexData = this.indexBuffer.getDirectData();
      const gradientIdData = this.indexBuffer.getDirectGradientIdData();
      const speedData = this.indexBuffer.getDirectSpeedData();
      const flowData = this.indexBuffer.getDirectFlowData();
      const phaseData = this.indexBuffer.getDirectPhaseData();
      if (!indexData) return;

      if (!this._dbgSpeedStatsLogged && speedData && speedData.length > 0) {
        const length = speedData.length;
        let zeroCount = 0;
        let topByte: number | null = null;
        let topCount = 0;
        const counts = new Uint32Array(256);
        for (let i = 0; i < length; i += 1) {
          const sb = speedData[i] | 0;
          counts[sb] += 1;
          if (sb === 0) zeroCount += 1;
        }
        for (let b = 1; b < 256; b += 1) {
          const c = counts[b];
          if (c > topCount) {
            topCount = c;
            topByte = b;
          }
        }
        const paletteSize = this.paletteController.getPaletteHandle().uint32.length;
        const percentZero = (zeroCount / length) * 100;
        const decodedTop = topByte !== null
          ? (MIN_BRUSH_COLOR_CYCLE_SPEED
            + (Math.max(0, Math.min(254, topByte - 1)) / 254)
              * (MAX_BRUSH_COLOR_CYCLE_SPEED - MIN_BRUSH_COLOR_CYCLE_SPEED))
          : null;
        debugLog('cc-speed', '[vessel][cc speed stats]', {
          layerId: null,
          paletteSize,
          speedMin: MIN_BRUSH_COLOR_CYCLE_SPEED,
          speedMax: MAX_BRUSH_COLOR_CYCLE_SPEED,
          percentSpeedByteZero: percentZero,
          topSpeedByte: topByte,
          topSpeedByteDecoded: decodedTop
        });
        this._dbgSpeedStatsLogged = true;
      }
      const defIdsInUse = this.getDefIdsInUse();
      this.validateDefPalettes(defIdsInUse);
      const hasDefIds = defIdsInUse.size > 0;

      const glRenderer = this.glRenderer;
      const glCanvas = this.glCanvas;
      let useGPU = !this.forceCanvas2D && Boolean(glRenderer) && Boolean(glCanvas);
      if (useGPU && hasDefIds) {
        if (!this.defPaletteRGBAById || !this.defPaletteSignaturesById || !this.defPalettesById) {
          useGPU = false;
        } else {
          const nonResident = this.syncDefPaletteAtlasToGPU(defIdsInUse);
          if (nonResident.size > 0) {
            useGPU = false;
          }
        }
      }

      if (useGPU && glRenderer && glCanvas) {
        const baseSignature = this.paletteController.getSignatureForSlot(0);
        if (!glRenderer.isPaletteReady(baseSignature)) {
          try {
            const paletteHandle = this.paletteController.getPaletteHandle();
            glRenderer.ensureBasePalette(paletteHandle.rgba, baseSignature ?? undefined);
          } catch {}
        }
        if (!this._renderPathLogged) { this._renderPathLogged = true; }

        const dirtyBounds = this.indexBuffer.getDirtyBounds();
        if (this._glIndexDirty || this._glDefIdDirty || dirtyBounds) {
        const canvas = this.renderer2D.getCanvas();
        const rect = dirtyBounds ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
        glRenderer.setIndexData(
          indexData,
          gradientIdData,
            speedData,
            flowData,
            phaseData,
            this.defIdData ?? undefined,
            rect,
            this._glDefIdDirty
          );
          this.indexBuffer.clearDirtyBounds();
          this._glIndexDirty = false;
          this._glDefIdDirty = false;
        }
        glRenderer.render(baseTime, legacyPhase, flowMode);

        if (!this._renderSampledOnce) {
          try {
            const ctx = this.renderer2D.getContext();
            const canvas = this.renderer2D.getCanvas();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(glCanvas, 0, 0);
            const w = Math.min(4, canvas.width);
            const h = Math.min(4, canvas.height);
            ctx.getImageData(0, 0, w, h);
          } catch {}
          this._renderSampledOnce = true;
        }

        this.renderer2D.ensureImageData();
        return;
      }

      if (!this._renderPathLogged) { this._renderPathLogged = true; }

      const basePalette32 = this.paletteController.getSignatureForSlot(0)
        ? this.paletteController.getPaletteForSlot(0)
        : this.paletteController.getPaletteHandle().uint32;

      this.renderer2D.render({
        indexData,
        gradientIdData,
        defIdData: this.defIdData ?? undefined,
        defPalettesById: this.defPalettesById ?? undefined,
        speedData,
        flowData,
        phaseData,
        paletteSlots: this.paletteController.getPalettesBySlot(),
        basePalette: basePalette32,
        phase: legacyPhase,
        baseOffset,
        baseTime,
        flowMode,
      });

    } catch (error) {
      debugWarn('cc-render', '[ColorCycleAnimator] Error in renderFrame:', error);
      debugWarn('cc-render', '[ColorCycleAnimator] Stack:', (error as Error).stack);
    }
  }

  /** Expose current animation offset (0..1) for stamp dithering decisions. */
  getOffset(): number {
    return this.animationController.getOffset();
  }
  
  /**
   * Paint with brush
   */
  paint(x: number, y: number, brushSize: number, colorIndex?: number, gradientSlot?: number) {
    // Use provided index or auto-increment
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const slot = gradientSlot ?? this.paletteController.getActiveSlot();
    const flowBits = this.getFlowBits();
    // Paint to index buffer using numeric index
    this.indexBuffer.paintWithIndex(x, y, brushSize, index, slot, this.currentSpeedByte, flowBits);
    this._glIndexDirty = true;
    
    // If not animating, render immediately
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }

  /**
   * Fast path: set raw color index at pixel (no palette lookup, no render)
   * Preserves isDirty flag on the underlying buffer so a later render draws it.
   */
  setIndex(x: number, y: number, colorIndex: number, gradientSlot?: number) {
    try {
      if (colorIndex === 0) {
        this.indexBuffer.setPixel(x, y, 0, 0);
        this._glIndexDirty = true;
        return;
      }

      if (!Number.isFinite(colorIndex)) {
        return;
      }

      const clamped = Math.max(1, Math.min(255, Math.round(colorIndex)));
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.setPixel(x, y, clamped, slot, this.currentSpeedByte, flowBits);
      this._glIndexDirty = true;
    } catch {
      // Fail silently for out-of-bounds or transient states
    }
  }
  
  /**
   * Paint square brush with stamp-based color progression
   */
  paintSquare(
    x: number,
    y: number,
    brushSize: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      // Use provided color index or auto-increment
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      
      // Paint to index buffer with the specific color index - NO RENDERING
      this.indexBuffer.paintSquareWithIndex(
        x,
        y,
        brushSize,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
      
      // REMOVED per-stamp rendering - caller handles batched rendering
      
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintSquare:', error);
    }
  }

  /**
   * Paint triangle brush with stamp-based color progression
   */
  paintTriangle(
    x: number,
    y: number,
    brushSize: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintTriangleWithIndex(
        x,
        y,
        brushSize,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintTriangle:', error);
    }
  }

  /**
   * Paint circular brush with stamp-based color progression
   */
  paintCircle(
    x: number,
    y: number,
    brushSize: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintCircleWithIndex(
        x,
        y,
        brushSize,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintCircle:', error);
    }
  }

  /**
   * Paint diamond brush with stamp-based color progression
   */
  paintDiamond(
    x: number,
    y: number,
    brushSize: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintDiamondWithIndex(
        x,
        y,
        brushSize,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintDiamond:', error);
    }
  }

  /**
   * Paint pixelated 5x5 diamond brush (nearest-neighbor upscaled)
   */
  paintDiamond5Pixelated(
    x: number,
    y: number,
    pixelScale: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintDiamond5PixelatedWithIndex(
        x,
        y,
        pixelScale,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintDiamond5Pixelated:', error);
    }
  }

  /**
   * Paint pixelated 7x7 diamond brush (nearest-neighbor upscaled)
   */
  paintDiamond7Pixelated(
    x: number,
    y: number,
    pixelScale: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintDiamond7PixelatedWithIndex(
        x,
        y,
        pixelScale,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintDiamond7Pixelated:', error);
    }
  }

  /**
   * Paint pixelated 9x9 diamond brush (nearest-neighbor upscaled)
   */
  paintDiamond9Pixelated(
    x: number,
    y: number,
    pixelScale: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintDiamond9PixelatedWithIndex(
        x,
        y,
        pixelScale,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintDiamond9Pixelated:', error);
    }
  }

  paintCheckeredPixelated(
    x: number,
    y: number,
    pixelScale: number,
    colorIndex?: number,
    maskTile?: Uint8Array,
    maskTileSize?: number,
    maskClears?: boolean,
    secondaryIndex?: number,
    gradientSlot?: number,
    maskOriginX?: number,
    maskOriginY?: number
  ) {
    try {
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      const slot = gradientSlot ?? this.paletteController.getActiveSlot();
      const flowBits = this.getFlowBits();
      this.indexBuffer.paintCheckeredPixelatedWithIndex(
        x,
        y,
        pixelScale,
        index,
        maskTile,
        maskTileSize,
        maskClears,
        secondaryIndex,
        slot,
        maskOriginX,
        maskOriginY,
        this.currentSpeedByte,
        flowBits
      );
      this._glIndexDirty = true;
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintCheckeredPixelated:', error);
    }
  }
  
  /**
   * Paint line
   */
  paintLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    brushSize: number,
    colorIndex?: number,
    gradientSlot?: number
  ) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const slot = gradientSlot ?? this.paletteController.getActiveSlot();
    const flowBits = this.getFlowBits();
    
    this.indexBuffer.paintLineWithIndex(
      x0,
      y0,
      x1,
      y1,
      brushSize,
      index,
      slot,
      this.currentSpeedByte,
      flowBits
    );
    this._glIndexDirty = true;
    
    // REMOVED per-stamp rendering - caller handles batched rendering
  }
  
  /**
   * Fill area
   */
  fill(x: number, y: number, colorIndex?: number, gradientSlot?: number) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const slot = gradientSlot ?? this.paletteController.getActiveSlot();
    
    const flowBits = this.getFlowBits();
    this.indexBuffer.fillWithIndex(x, y, index, slot, this.currentSpeedByte, flowBits);
    this._glIndexDirty = true;
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Get next color index for gradient progression
   */
  private nextIndex: number = 1;
  private getNextColorIndex(): number {
    const index = this.nextIndex;
    try {
      const paletteHandle = this.paletteController.getPaletteHandle();
      const paletteSpan = Math.max(1, Math.min(255, paletteHandle.uint32.length));
      this.nextIndex = (this.nextIndex % paletteSpan) + 1;
    } catch {
      this.nextIndex = (this.nextIndex % 255) + 1;
    }
    return index;
  }
  
  /**
   * Start new stroke
   */
  startStroke() {
    // Don't reset stroke index, let it accumulate for proper flow
  }
  
  /**
   * End stroke
   */
  endStroke() {
    // Stroke index continues to accumulate
  }
  
  /**
   * Force render the current frame (used for immediate updates)
   */
  forceRender() {
    this.renderFrame(this.animationController.getOffset());
  }
  
  /**
   * Clear canvas
   */
  clear() {
    this.indexBuffer.clear();
    this._glIndexDirty = true;
    this.nextIndex = 1;
    this.strokeTracker.reset();
    this.renderFrame();
  }
  
  /**
   * Clear rectangle
   */
  clearRect(x: number, y: number, width: number, height: number) {
    this.indexBuffer.clearRect(x, y, width, height);
    this._glIndexDirty = true;
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }

  markDirtyBounds(bounds: { minX: number; minY: number; width: number; height: number }) {
    const maxX = bounds.minX + Math.max(1, bounds.width) - 1;
    const maxY = bounds.minY + Math.max(1, bounds.height) - 1;
    this.indexBuffer.markDirtyBounds(bounds.minX, bounds.minY, maxX, maxY);
    this._glIndexDirty = true;
  }
  
  /**
   * Update gradient
   */
  setGradient(stops: GradientStop[], seamProfile?: GradientSeamProfile) {
    this.setGradientSlot(0, stops, seamProfile);
  }

  setGradientSlot(slot: number, stops: GradientStop[], seamProfile?: GradientSeamProfile) {
    const clampedSlot = Math.max(0, Math.min(255, Math.round(slot)));
    const result = this.paletteController.setGradientSlot(clampedSlot, stops, seamProfile);
    if (!result.changed) {
      return;
    }

    if (clampedSlot === 0) {
      // Reset palette progression so the next stamp starts at the beginning
      this.nextIndex = 1;
      this.updateIndexBufferPalette();
      this.renderFrame(this.animationController.getOffset());
      return;
    }

    const rgba = this.paletteController.getPaletteRGBAForSlot(clampedSlot);
    if (!this.forceCanvas2D && this.glRenderer && rgba) {
      try {
        this.glRenderer.setPaletteRow(clampedSlot, rgba, result.signature);
      } catch {}
    }
    if (clampedSlot === this.paletteController.getActiveSlot()) {
      this.renderFrame(this.animationController.getOffset());
    }
  }

  setActiveGradientSlot(slot: number) {
    if (this.paletteController.setActiveSlot(slot)) {
      this.renderFrame(this.animationController.getOffset());
    }
  }

  markGradientSlotUsed(slot: number) {
    if (slot !== 0) {
      this.indexBuffer.markHasNonZeroGradientIds();
    }
  }
  
  /**
   * Use preset gradient
   */
  setPresetGradient(preset: 'bw-stripes' | 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'grayscale') {
    let palette: GradientPalette;
    const signature = `preset:${preset}`;
    
    switch (preset) {
      case 'bw-stripes':
        palette = GradientPalette.createDefault();
        break;
      case 'rainbow':
        palette = GradientPalette.createRainbow();
        break;
      case 'fire':
        palette = GradientPalette.createFire();
        break;
      case 'ocean':
        palette = GradientPalette.createOcean();
        break;
      case 'sunset':
        palette = GradientPalette.createSunset();
        break;
      case 'grayscale':
      default:
        palette = GradientPalette.createGrayscale();
        break;
    }
    
    if (this.paletteController.setPresetPalette(palette, signature)) {
      this.updateIndexBufferPalette();
      this.renderFrame(this.animationController.getOffset());
    }
  }
  
  /**
   * Animation controls
   */
  start() {
    this.animationController.start();
  }
  
  stop() {
    this.animationController.stop();
  }
  
  pause() {
    this.animationController.pause();
  }
  
  resume() {
    this.animationController.resume();
  }
  
  toggle() {
    this.animationController.toggle();
  }
  
  reset() {
    this.animationController.reset();
    this.renderFrame();
  }
  
  /**
   * Manually update animation frame
   * Used when animation is driven externally
   */
  updateFrame() {
    // Calculate delta time based on target FPS when driven externally
    // Use controller stats to avoid hardcoding 30fps
    const stats = this.animationController.getStats();
    const fps = Math.max(1, stats.targetFPS || 30);
    const deltaTime = 1 / fps;

    // Advance time manually (real time + speed-scaled offset)
    this.animationController.advanceExternalFrame(deltaTime);

    // Trigger frame render
    this.handleAnimationFrame();
  }

  /**
   * Set absolute animation phase [0,1) and render immediately
   * Useful for deterministic exports (perfect loops)
   */
  setPhase(phase: number) {
    const p = ((phase % 1) + 1) % 1;
    this.animationController.setOffset(p);
    this.renderFrame(p, p);
  }
  
  /**
   * Set animation speed
   */
  setSpeed(speed: number) {
    if (!Number.isFinite(speed)) {
      return;
    }

    this.animationController.setSpeed(Math.max(0, Math.abs(speed)));
  }

  setStrokeSpeedByte(speedByte: number) {
    if (!Number.isFinite(speedByte)) {
      return;
    }
    this.currentSpeedByte = Math.max(0, Math.min(255, Math.round(speedByte)));
  }
  
  /**
   * Set FPS
   */
  setFPS(fps: number) {
    this.animationController.setFPS(fps);
  }
  
  /**
   * Get animation stats
   */
  getStats() {
    return this.animationController.getStats();
  }
  
  /**
   * Is animating?
   */
  isAnimating(): boolean {
    return this.animationController.isPlaying();
  }
  
  /**
   * Add frame callback
   */
  onFrame(callback: (imageData: ImageData) => void) {
    this.onFrameCallbacks.add(callback);
  }
  
  /**
   * Remove frame callback
   */
  offFrame(callback: (imageData: ImageData) => void) {
    this.onFrameCallbacks.delete(callback);
  }
  
  /**
   * Get canvas
   */
  getCanvas(): HTMLCanvasElement {
    return this.glCanvas || this.renderer2D.getCanvas();
  }
  
  /**
   * Get current image data
   */
  getImageData(): ImageData {
    return this.renderer2D.getImageData();
  }
  
  /**
   * Draw to another context
   */
  drawTo(ctx: CanvasRenderingContext2D, x: number = 0, y: number = 0) {
    const src = this.glCanvas || this.renderer2D.getCanvas();
    ctx.drawImage(src, x, y);
  }
  
  /**
   * Resize
   */
  resize(width: number, height: number) {
    const canvas = this.renderer2D.getCanvas();
    // Skip if dimensions haven't changed
    if (canvas.width === width && canvas.height === height) {
      return;
    }
    
    const needsDataPreservation = canvas.width > 0 && canvas.height > 0 && this.renderer2D.hasImageData();

    // Resize index buffer
    this.indexBuffer.resize(width, height);
    this._glIndexDirty = true;
    this._glDefIdDirty = true;

    this.renderer2D.resize(width, height, { preserveImageData: needsDataPreservation });

    // Resize GPU renderer
    if (!this.forceCanvas2D && this.glRenderer) {
      try {
        this.glRenderer.resize(width, height);
        this.glCanvas = this.glRenderer.getCanvas();
      } catch {}
    }
    
    this.strokeTracker.resize(width, height, { preserveIndices: needsDataPreservation });
    
    this.renderFrame();
  }
  
  /**
   * Set flow direction
   */
  setFlowMode(mode: FlowMode) {
    if (this.strokeTracker.setFlowMode(mode, this.animationController.getOffset())) {
      this.forceRender();
    }
  }

  setFlowDirection(direction: 'forward' | 'backward') {
    this.setFlowMode(direction === 'backward' ? 'reverse' : 'forward');
  }
  
  /**
   * Get flow direction
   */
  getFlowDirection(): 'forward' | 'backward' {
    return this.strokeTracker.getFlowDirection();
  }

  getFlowMode(): FlowMode {
    return this.strokeTracker.getFlowMode();
  }

  private getFlowBits(): number {
    const mode = this.strokeTracker.getFlowMode();
    switch (mode) {
      case 'forward':
        return 1;
      case 'reverse':
        return 2;
      case 'pingpong':
        return 3;
      default:
        return 0;
    }
  }
  
  /**
   * Toggle flow direction
   */
  toggleFlowDirection() {
    const mode = this.strokeTracker.getFlowMode();
    if (mode === 'pingpong') {
      this.setFlowMode('forward');
      return;
    }
    this.setFlowMode(mode === 'forward' ? 'reverse' : 'forward');
  }

  get flowDirection(): 'forward' | 'backward' {
    return this.getFlowDirection();
  }

  set flowDirection(direction: 'forward' | 'backward') {
    this.setFlowDirection(direction);
  }

  /**
   * Get dimensions
   */
  getDimensions(): { width: number; height: number } {
    return this.indexBuffer.getDimensions();
  }
  
  /**
   * Overwrite the index buffer with external data (e.g., history/selection).
   * Expects a flat Uint8Array of length width*height.
   */
  setIndexBufferFromArray(
    data: Uint8Array,
    gradientIdData?: Uint8Array,
    speedData?: Uint8Array,
    flowData?: Uint8Array,
    phaseData?: Uint8Array
  ): void {
    const { width, height } = this.indexBuffer.getDimensions();
    const expected = width * height;
    if (!data || data.length === 0 || expected === 0) {
      return;
    }

    // Resize if the incoming buffer size does not match current dimensions
    if (data.length !== expected) {
      // Best-effort: keep existing dimensions rather than guessing; copy overlap only.
      const dest = this.indexBuffer.getDirectData();
      const gradientDest = this.indexBuffer.getDirectGradientIdData();
      const speedDest = this.indexBuffer.getDirectSpeedData();
      const flowDest = this.indexBuffer.getDirectFlowData();
      const phaseDest = this.indexBuffer.getDirectPhaseData();
      dest.fill(0);
      dest.set(data.subarray(0, Math.min(dest.length, data.length)));
      if (gradientIdData) {
        gradientDest.fill(0);
        gradientDest.set(gradientIdData.subarray(0, Math.min(gradientDest.length, gradientIdData.length)));
        this.indexBuffer.setHasNonZeroGradientIds(gradientIdData.some((value) => value !== 0));
      } else {
        gradientDest.fill(0);
        this.indexBuffer.setHasNonZeroGradientIds(false);
      }
      if (speedData) {
        speedDest.fill(0);
        speedDest.set(speedData.subarray(0, Math.min(speedDest.length, speedData.length)));
        this.indexBuffer.setHasNonZeroSpeed(speedData.some((value) => value !== 0));
      } else {
        speedDest.fill(0);
        this.indexBuffer.setHasNonZeroSpeed(false);
      }
      if (flowData) {
        flowDest.fill(0);
        flowDest.set(flowData.subarray(0, Math.min(flowDest.length, flowData.length)));
      } else {
        flowDest.fill(0);
      }
      if (phaseData) {
        phaseDest.fill(0);
        phaseDest.set(phaseData.subarray(0, Math.min(phaseDest.length, phaseData.length)));
      } else {
        phaseDest.fill(0);
      }
      this.indexBuffer.markDirty();
      this._glIndexDirty = true;
      return;
    }

    const dest = this.indexBuffer.getDirectData();
    dest.set(data);
    const gradientDest = this.indexBuffer.getDirectGradientIdData();
    const speedDest = this.indexBuffer.getDirectSpeedData();
    const flowDest = this.indexBuffer.getDirectFlowData();
    const phaseDest = this.indexBuffer.getDirectPhaseData();
    if (gradientIdData) {
      gradientDest.set(gradientIdData.subarray(0, Math.min(gradientDest.length, gradientIdData.length)));
      this.indexBuffer.setHasNonZeroGradientIds(gradientIdData.some((value) => value !== 0));
    } else {
      gradientDest.fill(0);
      this.indexBuffer.setHasNonZeroGradientIds(false);
    }
    if (speedData) {
      speedDest.set(speedData.subarray(0, Math.min(speedDest.length, speedData.length)));
      this.indexBuffer.setHasNonZeroSpeed(speedData.some((value) => value !== 0));
    } else {
      speedDest.fill(0);
      this.indexBuffer.setHasNonZeroSpeed(false);
    }
    if (flowData) {
      flowDest.set(flowData.subarray(0, Math.min(flowDest.length, flowData.length)));
    } else {
      flowDest.fill(0);
    }
    if (phaseData) {
      phaseDest.set(phaseData.subarray(0, Math.min(phaseDest.length, phaseData.length)));
    } else {
      phaseDest.fill(0);
    }
    this.indexBuffer.markDirty();
    this._glIndexDirty = true;
  }
  
  /**
   * Serialize state
   */
  serialize() {
    return {
      indexBuffer: this.indexBuffer.serialize(),
      gradient: this.paletteController.getGradientPalette().serialize(),
      animation: {
        offset: this.animationController.getOffset(),
        stats: this.animationController.getStats()
      }
    };
  }
  
  /**
   * Deserialize state
   */
  static deserialize(data: ReturnType<ColorCycleAnimator['serialize']>): ColorCycleAnimator {
    const animator = new ColorCycleAnimator({
      width: data.indexBuffer.width,
      height: data.indexBuffer.height,
      gradientStops: data.gradient.gradientStops
    });
    
    // Restore index buffer
    animator.indexBuffer = IndexBuffer.deserialize(data.indexBuffer);
    
    // Restore animation offset
    animator.animationController.setOffset(data.animation.offset);
    
    // Render current state
    animator.renderFrame();
    
    return animator;
  }
  
  /**
   * Create animated gradient fill effect
   */
  createGradientFill(
    x: number, 
    y: number, 
    width: number, 
    height: number,
    startIndex: number = 0,
    endIndex: number = 255
  ) {
    const indexRange = endIndex - startIndex;
    
    for (let py = 0; py < height; py++) {
      const progress = py / height;
      const colorIndex = Math.floor(startIndex + progress * indexRange);
      
      for (let px = 0; px < width; px++) {
        this.indexBuffer.setPixel(x + px, y + py, colorIndex);
      }
    }
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Create radial gradient effect
   */
  createRadialGradient(
    centerX: number,
    centerY: number,
    radius: number,
    startIndex: number = 0,
    endIndex: number = 255
  ) {
    const indexRange = endIndex - startIndex;
    
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
      for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= radius) {
          const progress = distance / radius;
          const colorIndex = Math.floor(startIndex + progress * indexRange);
          this.indexBuffer.setPixel(x, y, colorIndex);
        }
      }
    }
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Clean up resources and return canvas to pool
   */
  cleanup() {
    // Stop animation
    this.animationController.stop();
    
    // Clear callbacks
    this.onFrameCallbacks.clear();

    if (this.glRenderer) {
      try {
        this.glRenderer.dispose();
      } catch (error) {
        debugWarn('cc-render', '[ColorCycleAnimator] Error disposing WebGL renderer:', error);
      } finally {
        this.glRenderer = null;
        this.glCanvas = null;
        this._glIndexDirty = true;
        this._renderSampledOnce = false;
      }
    }
    
    this.renderer2D.cleanup();
  }
  
  /**
   * Alias for cleanup to maintain API compatibility
   */
  destroy() {
    this.cleanup();
  }

}
