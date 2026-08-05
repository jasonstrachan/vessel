import {
  restoreColorCycleBrushSerializedStateToRuntime,
  type ColorCycleLayerDocumentRead,
  type ColorCycleBrushSerializedState,
  type ColorCycleBrushSerializedStateRuntimeWriter,
} from '@/lib/colorCycle/document';
import type { ColorCycleHistoryBrushContext } from '@/hooks/brushEngine/colorCycleBrushContracts';
import type { GradientStop } from '@/lib/GradientPalette';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import { isColorCycleDesired } from '@/utils/colorCyclePlayback';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import {
  createHistoryMutationTracker,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryMutationTracker,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';
import { HistoryBlobReadError, HistoryReplayDriftError } from '../errors';
import { captureColdColorCycleRuntimeCompensation } from '../colorCycleRuntimeCompensation';

type ColorCycleBrushState = ColorCycleBrushSerializedState & {
  documentVersion?: number;
  pixelVersion?: number;
};
type ColorCycleSerializedLayer = NonNullable<ColorCycleBrushState['layers']>[number];
type HistoryBufferRef = {
  __historyBlobRef: true;
  blobId: string;
  byteLength: number;
};

type ManagedColorCycleBrush = ColorCycleHistoryBrushContext & ColorCycleBrushSerializedStateRuntimeWriter & {
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | null | undefined;
  clearPaintBuffer?: (layerId?: string) => void;
};

export interface ColorCycleStrokeDeltaOptions {
  layerId: string;
  forwardState: ColorCycleBrushState | null;
  backwardState: ColorCycleBrushState | null;
  beforeVersion?: number;
  afterVersion?: number;
  beforePixelVersion?: number;
  afterPixelVersion?: number;
  beforeDimensions?: { width: number; height: number };
  afterDimensions?: { width: number; height: number };
}

const structuredCloneFn: (<T>(value: T) => T) | undefined =
  typeof structuredClone === 'function' ? structuredClone : undefined;

const cloneLayerData = (
  data: ColorCycleSerializedLayer['data']
): ColorCycleSerializedLayer['data'] => {
  if (!data) {
    return data;
  }
  if (structuredCloneFn) {
    try {
      return structuredCloneFn(data) as ColorCycleSerializedLayer['data'];
    } catch {
      // Fallback to manual shallow copies below.
    }
  }
  const candidate = data as unknown as { slice?: (start?: number, end?: number) => unknown };
  if (candidate && typeof candidate.slice === 'function') {
    try {
      return candidate.slice(0) as ColorCycleSerializedLayer['data'];
    } catch {
      return data;
    }
  }
  if (typeof data === 'object' && data) {
    if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
      return data;
    }
    try {
      return JSON.parse(JSON.stringify(data)) as ColorCycleSerializedLayer['data'];
    } catch {
      return { ...(data as Record<string, unknown>) } as ColorCycleSerializedLayer['data'];
    }
  }
  return data;
};

const serializeGradientColor = (color: unknown): string => {
  if (typeof color === 'string') {
    return color;
  }
  if (
    color &&
    typeof color === 'object' &&
    typeof (color as { r?: unknown }).r === 'number' &&
    typeof (color as { g?: unknown }).g === 'number' &&
    typeof (color as { b?: unknown }).b === 'number'
  ) {
    const { r, g, b } = color as { r: number; g: number; b: number };
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  return String(color ?? '#000000');
};

const cloneStoredStops = <T extends { position: number; color: unknown; opacity?: number }>(
  stops: T[]
): Array<{ position: number; color: string; opacity?: number }> =>
  stops.map((stop) => ({
    position: stop.position,
    color: serializeGradientColor(stop.color),
    opacity: stop.opacity,
  }));

const cloneState = (
  state: ColorCycleBrushState | null,
  paintBufferLengths?: Map<string, number>
): ColorCycleBrushState | null => {
  if (!state) {
    return null;
  }
  return {
    documentVersion: state.documentVersion,
    pixelVersion: state.pixelVersion,
    cycleSpeed: state.cycleSpeed,
    fps: state.fps,
    brushSize: state.brushSize,
    layers: state.layers
      ? state.layers.map((layer: ColorCycleSerializedLayer) => ({
          layerId: layer.layerId,
          data: cloneLayerData(layer.data),
          gradientDefs: layer.gradientDefs
            ? layer.gradientDefs.map((entry) => ({
                id: entry.id,
                name: entry.name,
                currentSlot: entry.currentSlot,
              }))
            : undefined,
          slotPalettes: layer.slotPalettes
            ? layer.slotPalettes.map((entry) => ({
                slot: entry.slot,
                stops: cloneStoredStops(entry.stops),
                seamProfile: entry.seamProfile as GradientSeamProfile | undefined,
              }))
            : undefined,
          gradientDefStore: layer.gradientDefStore
            ? layer.gradientDefStore.map((entry) => ({
                ...entry,
                stops: cloneStoredStops(entry.stops),
              }))
            : undefined,
          nextGradientDefId: layer.nextGradientDefId,
          fgActiveSlot: layer.fgActiveSlot,
          fgDerivedKey: layer.fgDerivedKey,
          fgDerivedGradients: layer.fgDerivedGradients
            ? layer.fgDerivedGradients.map((entry) => ({
                key: entry.key,
                slot: entry.slot,
                spec: { ...entry.spec },
              }))
            : undefined,
          derivedGradients: layer.derivedGradients
            ? layer.derivedGradients.map((entry) => ({
                key: entry.key,
                slot: entry.slot,
                spec: { ...entry.spec },
              }))
            : undefined,
          activeGradientId: layer.activeGradientId,
          paintSlot: layer.paintSlot,
          legacyRemap: layer.legacyRemap,
          strokeData: layer.strokeData
            ? {
                ...layer.strokeData,
                paintBuffer: (() => {
                  if (!layer.strokeData?.paintBuffer) {
                    return layer.strokeData?.paintBuffer ?? undefined;
                  }
                  const desiredLength = paintBufferLengths?.get(layer.layerId);
                  if (typeof desiredLength === 'number') {
                    return layer.strokeData.paintBuffer.slice(0, desiredLength);
                  }
                  return layer.strokeData.paintBuffer.slice(0);
                })(),
                gradientIdBuffer: layer.strokeData?.gradientIdBuffer
                  ? layer.strokeData.gradientIdBuffer.slice(0)
                  : layer.strokeData?.gradientIdBuffer,
                gradientDefIdBuffer: layer.strokeData?.gradientDefIdBuffer
                  ? layer.strokeData.gradientDefIdBuffer.slice(0)
                  : layer.strokeData?.gradientDefIdBuffer,
                speedBuffer: layer.strokeData?.speedBuffer
                  ? layer.strokeData.speedBuffer.slice(0)
                  : layer.strokeData?.speedBuffer,
                flowBuffer: layer.strokeData?.flowBuffer
                  ? layer.strokeData.flowBuffer.slice(0)
                  : layer.strokeData?.flowBuffer,
                phaseBuffer: layer.strokeData?.phaseBuffer
                  ? layer.strokeData.phaseBuffer.slice(0)
                  : layer.strokeData?.phaseBuffer
              }
            : undefined
        }))
      : []
  };
};

const isHistoryBufferRef = (value: unknown): value is HistoryBufferRef =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { __historyBlobRef?: unknown }).__historyBlobRef === true &&
    typeof (value as { blobId?: unknown }).blobId === 'string'
  );

const blobifyBuffer = async (
  buffer: ArrayBuffer | undefined
): Promise<ArrayBuffer | HistoryBufferRef | undefined> => {
  if (!buffer) {
    return buffer;
  }
  return {
    __historyBlobRef: true,
    blobId: await storeBlob(buffer),
    byteLength: buffer.byteLength,
  };
};

const blobifyState = async (state: ColorCycleBrushState | null): Promise<ColorCycleBrushState | null> => {
  if (!state) {
    return null;
  }
  const layers = state.layers
    ? await Promise.all(
        state.layers.map(async (layer) => {
          if (!layer.strokeData) {
            return layer;
          }
          const [
            paintBuffer,
            gradientIdBuffer,
            gradientDefIdBuffer,
            speedBuffer,
            flowBuffer,
            phaseBuffer,
          ] = await Promise.all([
            blobifyBuffer(layer.strokeData.paintBuffer),
            blobifyBuffer(layer.strokeData.gradientIdBuffer),
            blobifyBuffer(layer.strokeData.gradientDefIdBuffer),
            blobifyBuffer(layer.strokeData.speedBuffer),
            blobifyBuffer(layer.strokeData.flowBuffer),
            blobifyBuffer(layer.strokeData.phaseBuffer),
          ]);
          return {
            ...layer,
            strokeData: {
              ...layer.strokeData,
              paintBuffer,
              gradientIdBuffer,
              gradientDefIdBuffer,
              speedBuffer,
              flowBuffer,
              phaseBuffer,
            } as ColorCycleSerializedLayer['strokeData'],
          };
        })
      )
    : [];

  return {
    ...state,
    layers,
  };
};

const bufferApproxBytes = (buffer: unknown): number => {
  if (isHistoryBufferRef(buffer)) {
    return buffer.byteLength;
  }
  return buffer instanceof ArrayBuffer ? buffer.byteLength : 0;
};

const materializeBuffer = async (
  buffer: ArrayBuffer | HistoryBufferRef | undefined,
  direction: HistoryDirection,
  deltaTag: string,
  layerId: string,
): Promise<ArrayBuffer | undefined> => {
  if (!buffer || buffer instanceof ArrayBuffer) {
    return buffer;
  }
  if (!isHistoryBufferRef(buffer)) {
    return undefined;
  }
  const blob = await readBlob(buffer.blobId);
  if (!blob) {
    throw new HistoryBlobReadError({
      deltaTag,
      direction,
      layerId,
      expected: buffer.blobId,
      actual: null,
      reason: 'missing-color-cycle-full-state-blob',
    });
  }
  return blob.data.buffer.slice(
    blob.data.byteOffset,
    blob.data.byteOffset + blob.data.byteLength,
  ) as ArrayBuffer;
};

const materializeState = async (
  state: ColorCycleBrushState,
  direction: HistoryDirection,
  deltaTag: string,
  layerId: string,
): Promise<ColorCycleBrushState> => ({
  ...state,
  layers: state.layers
    ? await Promise.all(
        state.layers.map(async (layer) => ({
          ...layer,
          strokeData: layer.strokeData
            ? {
                ...layer.strokeData,
                paintBuffer: (await materializeBuffer(
                  layer.strokeData.paintBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                )) ?? new ArrayBuffer(0),
                gradientIdBuffer: await materializeBuffer(
                  layer.strokeData.gradientIdBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                ),
                gradientDefIdBuffer: await materializeBuffer(
                  layer.strokeData.gradientDefIdBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                ),
                speedBuffer: await materializeBuffer(
                  layer.strokeData.speedBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                ),
                flowBuffer: await materializeBuffer(
                  layer.strokeData.flowBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                ),
                phaseBuffer: await materializeBuffer(
                  layer.strokeData.phaseBuffer as ArrayBuffer | HistoryBufferRef | undefined,
                  direction,
                  deltaTag,
                  layerId,
                ),
              }
            : undefined,
        }))
      )
    : [],
});

const collectStateBlobRefs = (state: ColorCycleBrushState | null, refs: string[]): void => {
  state?.layers?.forEach((layer) => {
    const strokeData = layer.strokeData;
    if (!strokeData) {
      return;
    }
    [
      strokeData.paintBuffer,
      strokeData.gradientIdBuffer,
      strokeData.gradientDefIdBuffer,
      strokeData.speedBuffer,
      strokeData.flowBuffer,
      strokeData.phaseBuffer,
    ].forEach((buffer) => {
      if (isHistoryBufferRef(buffer)) {
        refs.push(buffer.blobId);
      }
    });
  });
};

class ColorCycleStrokeDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly forwardState: ColorCycleBrushState | null;
  private readonly backwardState: ColorCycleBrushState | null;
  private readonly beforeVersion?: number;
  private readonly afterVersion?: number;
  private readonly beforePixelVersion?: number;
  private readonly afterPixelVersion?: number;
  private readonly beforeDimensions?: { width: number; height: number };
  private readonly afterDimensions?: { width: number; height: number };

  constructor(options: ColorCycleStrokeDeltaOptions) {
    this.layerId = options.layerId;
    this.forwardState = options.forwardState;
    this.backwardState = options.backwardState;
    this.beforeVersion = options.beforeVersion ?? options.backwardState?.documentVersion;
    this.afterVersion = options.afterVersion ?? options.forwardState?.documentVersion;
    this.beforePixelVersion = options.beforePixelVersion ?? options.backwardState?.pixelVersion;
    this.afterPixelVersion = options.afterPixelVersion ?? options.forwardState?.pixelVersion;
    this.beforeDimensions = options.beforeDimensions;
    this.afterDimensions = options.afterDimensions;
    const sizeOf = (state: ColorCycleBrushState | null) =>
      state?.layers?.reduce((sum: number, layer: ColorCycleSerializedLayer) => {
        return sum
          + bufferApproxBytes(layer.strokeData?.paintBuffer)
          + bufferApproxBytes(layer.strokeData?.gradientIdBuffer)
          + bufferApproxBytes(layer.strokeData?.gradientDefIdBuffer)
          + bufferApproxBytes(layer.strokeData?.speedBuffer)
          + bufferApproxBytes(layer.strokeData?.flowBuffer)
          + bufferApproxBytes(layer.strokeData?.phaseBuffer);
      }, 0) ?? 0;
    this.approxBytes = sizeOf(this.forwardState) + sizeOf(this.backwardState);
  }

  async prepare(direction: HistoryDirection): Promise<PreparedHistoryDelta> {
    const requested = await this.materializeDirection(direction);
    const compensationDirection = direction === 'forward' ? 'backward' : 'forward';
    const compensation = await this.materializeDirection(compensationDirection);
    this.assertReplayReady(direction);
    const runtimeCompensation = captureColdColorCycleRuntimeCompensation(this.layerId);
    const mutation = createHistoryMutationTracker();
    return {
      deltaTag: this._tag,
      apply: () => this.applyPrepared(direction, requested, mutation),
      requiresCompensation: mutation.requiresCompensation,
      compensate: async () => {
        try {
          await this.applyPrepared(compensationDirection, compensation);
        } finally {
          runtimeCompensation.restoreIfCreated();
        }
      },
      collectRehydrationTargets: (targets) => this.collectRehydrationTargets(targets),
    };
  }

  async applyReplay(direction: HistoryDirection): Promise<void> {
    const prepared = await this.prepare(direction);
    await prepared.apply();
  }

  private async materializeDirection(direction: HistoryDirection): Promise<ColorCycleBrushState | null> {
    const storedState = direction === 'forward' ? this.forwardState : this.backwardState;
    if (!storedState) {
      return null;
    }
    return materializeState(storedState, direction, this._tag, this.layerId);
  }

  private assertReplayReady(direction: HistoryDirection): void {
    const manager = getColorCycleBrushManager();
    const initialState = useAppStore.getState();
    const initialLayer = initialState.layers.find((candidate) => candidate.id === this.layerId);
    if (!initialLayer || initialLayer.layerType !== 'color-cycle' || !initialLayer.colorCycleData) {
      throw new Error(`Color-cycle layer ${this.layerId} is unavailable for history replay.`);
    }
    const expectedVersion = direction === 'forward' ? this.beforeVersion : this.afterVersion;
    const documentRead = manager.getDocument(this.layerId)?.read?.();
    if (typeof expectedVersion === 'number' && documentRead && documentRead.version !== expectedVersion) {
      logCCMutation({
        event: 'history-cc-document-version-mismatch',
        layerId: this.layerId,
        reason: direction === 'backward' ? 'history-undo-full-state' : 'history-redo-full-state',
        severity: 'warn',
        before: summarizeColorCycleLayer(initialLayer),
        after: summarizeColorCycleLayer(initialLayer),
        details: {
          source: 'history-color-cycle-stroke-full-state',
          operation: direction === 'backward' ? 'undo' : 'redo',
          direction,
          expectedVersion,
          actualVersion: documentRead.version,
        },
      });
      throw new HistoryReplayDriftError({
        deltaTag: this._tag,
        direction,
        layerId: this.layerId,
        expected: expectedVersion,
        actual: documentRead.version,
        reason: 'document-version-mismatch',
      });
    }
  }

  private async applyPrepared(
    direction: HistoryDirection,
    state: ColorCycleBrushState | null,
    mutation?: HistoryMutationTracker,
  ): Promise<void> {
    if (!state) {
      return;
    }
    const manager = getColorCycleBrushManager();
    const initialState = useAppStore.getState();
    const initialLayer = initialState.layers.find((candidate) => candidate.id === this.layerId);
    const targetDimensions = direction === 'forward'
      ? this.afterDimensions
      : this.beforeDimensions;
    if (!initialLayer || initialLayer.layerType !== 'color-cycle' || !initialLayer.colorCycleData) {
      throw new Error(`Color-cycle layer ${this.layerId} is unavailable for history replay.`);
    }
    if (!manager.getHistoryBrush(this.layerId)) {
      if (manager.hasBrush?.(this.layerId)) {
        throw new Error(`Color-cycle runtime for ${this.layerId} cannot restore history state.`);
      }
      const width = targetDimensions?.width
        ?? initialLayer.colorCycleData.canvas?.width
        ?? initialState.project?.width
        ?? 0;
      const height = targetDimensions?.height
        ?? initialLayer.colorCycleData.canvas?.height
        ?? initialState.project?.height
        ?? 0;
      if (!width || !height) {
        throw new Error(`Color-cycle runtime for ${this.layerId} has no drawable size.`);
      }
      mutation?.markMutated();
      initialState.initColorCycleForLayer(this.layerId, width, height);
    }
    const brush = manager.getHistoryBrush(this.layerId) as ManagedColorCycleBrush | undefined;
    const liveState = useAppStore.getState();
    const layer = liveState.layers.find((candidate) => candidate.id === this.layerId);
    let targetCanvas = layer?.colorCycleData?.canvas;
    if (!brush || !layer || layer.layerType !== 'color-cycle' || !targetCanvas) {
      throw new Error(`Color-cycle runtime for ${this.layerId} is unavailable for history replay.`);
    }

    mutation?.markMutated();

    if (targetDimensions) {
      const targetWidth = Math.max(1, Math.floor(targetDimensions.width));
      const targetHeight = Math.max(1, Math.floor(targetDimensions.height));
      if (targetCanvas.width !== targetWidth || targetCanvas.height !== targetHeight) {
        const ownerDocument = targetCanvas.ownerDocument
          ?? (typeof document !== 'undefined' ? document : null);
        if (!ownerDocument) {
          throw new Error(`Color-cycle runtime for ${this.layerId} cannot create a resized canvas.`);
        }
        const replacementCanvas = ownerDocument.createElement('canvas');
        replacementCanvas.width = targetWidth;
        replacementCanvas.height = targetHeight;
        targetCanvas = replacementCanvas;
        useAppStore.setState((current) => ({
          layers: current.layers.map((candidate) => (
            candidate.id === this.layerId && candidate.layerType === 'color-cycle'
              ? {
                  ...candidate,
                  framebuffer: replacementCanvas,
                  colorCycleData: {
                    ...candidate.colorCycleData,
                    canvas: replacementCanvas,
                    canvasWidth: targetWidth,
                    canvasHeight: targetHeight,
                  },
                }
              : candidate
          )),
        }));
      }
    }

    const setTargetCanvas = brush.setTargetCanvas;
    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      targetCanvas instanceof HTMLCanvasElement &&
      typeof setTargetCanvas === 'function'
    ) {
      try {
        setTargetCanvas(targetCanvas);
      } catch {
        // Best-effort reattachment; render flow will continue regardless.
      }
    }

    const layerSnapshots = state.layers ?? [];
    const restoredHasContent = layerSnapshots.some((layerSnapshot) =>
      Boolean(layerSnapshot.strokeData?.hasContent)
    );
    const layerHadContent = Boolean(layer.colorCycleData?.hasContent);
    const hasLayerSnapshot = layerSnapshots.some((layerSnapshot) => layerSnapshot.layerId === this.layerId);

    if (!restoredHasContent && !layerHadContent && !hasLayerSnapshot) {
      return;
    }

    const wasAnimating = Boolean(layer.colorCycleData?.isAnimating);
    if (wasAnimating && layer.colorCycleData) {
      try {
        liveState.updateLayer(this.layerId, {
          colorCycleData: { ...layer.colorCycleData, isAnimating: false }
        });
      } catch {
        // Pausing animation failed; continue best-effort.
      }
    }

    try {
      // Do not clear before a history restore; the restore will rebuild the animator and commit the correct pixels.
      restoreColorCycleBrushSerializedStateToRuntime(brush, {
        cycleSpeed: state.cycleSpeed,
        fps: state.fps,
        brushSize: state.brushSize,
        layerSnapshots: layerSnapshots.map((layerSnapshot: ColorCycleSerializedLayer) => {
          const layerData = layerSnapshot?.data as {
            indexBuffer?: {
              width?: number;
              height?: number;
              data?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
              gradientId?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
              speedData?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
              flowData?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
              phaseData?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
            };
            gradient?: { gradientStops?: GradientStop[] | unknown };
          } | undefined;
          const indexBuffer = layerData?.indexBuffer;
          const animatorData = toArrayBuffer(indexBuffer?.data);
          const animatorGradientId = toArrayBuffer(indexBuffer?.gradientId);
          const animatorSpeed = toArrayBuffer(indexBuffer?.speedData);
          const animatorFlow = toArrayBuffer(indexBuffer?.flowData);
          const animatorPhase = toArrayBuffer(indexBuffer?.phaseData);
          const gradientStops = Array.isArray(layerData?.gradient?.gradientStops)
            ? (layerData?.gradient?.gradientStops as GradientStop[])
            : undefined;
          const animatorIndex =
            animatorData && typeof indexBuffer?.width === 'number' && typeof indexBuffer?.height === 'number'
              ? {
                  width: indexBuffer.width,
                  height: indexBuffer.height,
                  data: animatorData,
                  gradientIdData: animatorGradientId ?? undefined,
                  speedData: animatorSpeed ?? undefined,
                  flowData: animatorFlow ?? undefined,
                  phaseData: animatorPhase ?? undefined,
                  gradientStops,
                  gradientDefs: layerSnapshot.gradientDefs
                    ? layerSnapshot.gradientDefs.map((entry) => ({
                        id: entry.id,
                        name: entry.name,
                        currentSlot: entry.currentSlot,
                      }))
                    : undefined,
                  slotPalettes: layerSnapshot.slotPalettes
                    ? layerSnapshot.slotPalettes.map((entry) => ({
                        slot: entry.slot,
                        stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
                      }))
                    : undefined,
                  activeGradientId: layerSnapshot.activeGradientId,
                }
              : undefined;
          return {
            layerId: layerSnapshot.layerId,
            paintBuffer: layerSnapshot.strokeData?.paintBuffer ?? new ArrayBuffer(0),
            gradientIdBuffer: layerSnapshot.strokeData?.gradientIdBuffer,
            gradientDefIdBuffer: layerSnapshot.strokeData?.gradientDefIdBuffer,
            speedBuffer: layerSnapshot.strokeData?.speedBuffer,
            flowBuffer: layerSnapshot.strokeData?.flowBuffer,
            phaseBuffer: layerSnapshot.strokeData?.phaseBuffer,
            hasContent: Boolean(layerSnapshot.strokeData?.hasContent),
            strokeCounter: layerSnapshot.strokeData?.strokeCounter ?? 0,
            animatorIndex
          };
        })
      }, { mode: 'history' });
      const targetDocumentVersion = direction === 'forward'
        ? this.afterVersion
        : this.beforeVersion;
      const targetPixelVersion = direction === 'forward'
        ? this.afterPixelVersion
        : this.beforePixelVersion;
      const restoredDocument = manager.getDocument(this.layerId);
      if (
        (typeof targetDocumentVersion === 'number' || typeof targetPixelVersion === 'number') &&
        typeof restoredDocument?.rebaseVersionAnchors === 'function'
      ) {
        restoredDocument.rebaseVersionAnchors({
          version: targetDocumentVersion,
          pixelVersion: targetPixelVersion,
        });
      }
      try {
        brush.updateColorCycleTexture?.();
      } catch {
        // Texture updates are best-effort.
      }

      if (restoredHasContent) {
        try {
          brush.render?.(false);
        } catch {
          // Rendering is best-effort; ignore failures so history replay can continue.
        }
      }

      const tctx = targetCanvas.getContext('2d', { willReadFrequently: true });
      if (!tctx) {
        throw new Error(`Color-cycle target canvas for ${this.layerId} has no 2D context.`);
      }

      tctx.save();
      tctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = 1;

      tctx.restore();
      let synced = false;
      if (typeof brush.commitToLayer === 'function') {
        try {
          // Do NOT clear here. commitToLayer() already handles any required clearing;
          // if srcCanvas === targetCanvas it will bail out, so pre-clearing would leave a blank frame.
          brush.commitToLayer(targetCanvas, this.layerId);
          synced = true;
        } catch {
          // Fall through to other strategies.
        }
      }

      if (!synced && typeof brush.renderDirectToCanvas === 'function') {
        try {
          brush.renderDirectToCanvas(targetCanvas, this.layerId);
          synced = true;
        } catch {
          // Continue to fallback path.
        }
      }

      if (!synced) {
        try {
          brush.render?.(false);
        } catch {
          // Rendering is best-effort; ignore failures so history replay can continue.
        }
        const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
        const internalCanvas =
          typeof brush.getCanvas === 'function' ? brush.getCanvas() : null;
        if (ctx && internalCanvas) {
          try {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            ctx.drawImage(internalCanvas, 0, 0);
          } finally {
            try { ctx.restore(); } catch {}
          }
        }
      }

      try {
        brush.flush?.(this.layerId);
      } catch {
        // Flushing is optional; ignore failures.
      }

      try {
        const latestState = useAppStore.getState();
        const latestLayer = latestState.layers.find((candidate) => candidate.id === this.layerId);
        const restoredLayerSnapshot = layerSnapshots.find((snapshot) => snapshot.layerId === this.layerId);
        const restoredImageData = targetDimensions
          ? tctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height)
          : null;
        if (latestLayer?.colorCycleData) {
          const hasRestoredSnapshot = Boolean(restoredLayerSnapshot);
          const restoredSlotPalettes = restoredLayerSnapshot?.slotPalettes
            ? restoredLayerSnapshot.slotPalettes.map((entry) => ({
                slot: entry.slot,
                stops: cloneStoredStops(entry.stops),
                seamProfile: entry.seamProfile as GradientSeamProfile | undefined,
              }))
            : undefined;
          const restoredGradientDefStore = restoredLayerSnapshot?.gradientDefStore
            ? restoredLayerSnapshot.gradientDefStore.map((entry) => ({
                ...entry,
                seamProfile: entry.seamProfile as GradientSeamProfile | undefined,
                stops: cloneStoredStops(entry.stops),
              }))
            : undefined;
          const nextColorCycleData = {
            ...latestLayer.colorCycleData,
            gradientDefs: hasRestoredSnapshot ? restoredLayerSnapshot?.gradientDefs : latestLayer.colorCycleData.gradientDefs,
            slotPalettes: hasRestoredSnapshot ? restoredSlotPalettes : latestLayer.colorCycleData.slotPalettes,
            gradientDefStore: hasRestoredSnapshot ? restoredGradientDefStore : latestLayer.colorCycleData.gradientDefStore,
            nextGradientDefId: hasRestoredSnapshot ? restoredLayerSnapshot?.nextGradientDefId : latestLayer.colorCycleData.nextGradientDefId,
            fgActiveSlot: hasRestoredSnapshot ? restoredLayerSnapshot?.fgActiveSlot : latestLayer.colorCycleData.fgActiveSlot,
            fgDerivedKey: hasRestoredSnapshot ? restoredLayerSnapshot?.fgDerivedKey : latestLayer.colorCycleData.fgDerivedKey,
            fgDerivedGradients: hasRestoredSnapshot ? restoredLayerSnapshot?.fgDerivedGradients : latestLayer.colorCycleData.fgDerivedGradients,
            derivedGradients: hasRestoredSnapshot ? restoredLayerSnapshot?.derivedGradients : latestLayer.colorCycleData.derivedGradients,
            activeGradientId: hasRestoredSnapshot ? restoredLayerSnapshot?.activeGradientId : latestLayer.colorCycleData.activeGradientId,
            paintSlot: hasRestoredSnapshot ? restoredLayerSnapshot?.paintSlot : latestLayer.colorCycleData.paintSlot,
            legacyRemap: hasRestoredSnapshot ? restoredLayerSnapshot?.legacyRemap : latestLayer.colorCycleData.legacyRemap,
            hasContent: restoredHasContent
          };
          useAppStore.setState((current) => ({
            layers: current.layers.map((candidate) =>
              candidate.id === this.layerId && candidate.layerType === 'color-cycle'
                ? {
                    ...candidate,
                    imageData: restoredImageData ?? candidate.imageData,
                    framebuffer: targetDimensions ? targetCanvas : candidate.framebuffer,
                    colorCycleData: {
                      ...candidate.colorCycleData,
                      ...nextColorCycleData,
                      canvas: targetCanvas,
                      canvasImageData:
                        restoredImageData ?? candidate.colorCycleData?.canvasImageData,
                      canvasWidth: targetDimensions?.width
                        ?? candidate.colorCycleData?.canvasWidth,
                      canvasHeight: targetDimensions?.height
                        ?? candidate.colorCycleData?.canvasHeight,
                    },
                  }
                : candidate
            ),
          }));
        }
      } catch {
        // Best-effort metadata update.
      }

      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
        } catch {
          // Overlay clear signal is optional.
        }
        try {
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        } catch {
          // Event dispatch is optional.
        }
      }
    } catch (error) {
      throw error;
    } finally {
      if (wasAnimating) {
        try {
          const latestState = useAppStore.getState();
          const latestLayer = latestState.layers.find((candidate) => candidate.id === this.layerId);
          if (latestLayer?.colorCycleData) {
            latestState.updateLayer(this.layerId, {
              colorCycleData: { ...latestLayer.colorCycleData, isAnimating: true }
            });
          }
        } catch {
          // Animation resume best-effort.
        }
      }
      try {
        if (isColorCycleDesired()) {
          const handlers = useAppStore.getState().colorCycleRuntimeHandlers;
          handlers.start?.('delta-replay');
        }
      } catch {
        // Restart request best-effort.
      }
    }
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
    targets.workerScopes.add('color-cycle-gradient');
  }

  dispose(): void {
    const refs: string[] = [];
    collectStateBlobRefs(this.forwardState, refs);
    collectStateBlobRefs(this.backwardState, refs);
    refs.forEach((id) => releaseBlob(id));
  }
}

export const createColorCycleStrokeDelta = async (
  options: ColorCycleStrokeDeltaOptions
): Promise<HistoryDelta | null> => {
  if (!options.forwardState && !options.backwardState) {
    return null;
  }
  const measurePaintBufferLengths = (
    state: ColorCycleBrushState | null
  ): Map<string, number> => {
    const lengths = new Map<string, number>();
    state?.layers?.forEach((layer) => {
      const byteLength = layer.strokeData?.paintBuffer?.byteLength;
      if (typeof byteLength === 'number') {
        lengths.set(layer.layerId, byteLength);
      }
    });
    return lengths;
  };

  const backwardLengths = measurePaintBufferLengths(options.backwardState);
  const forwardLengths = measurePaintBufferLengths(options.forwardState);

  const forwardState = await blobifyState(cloneState(options.forwardState, forwardLengths));
  const backwardState = await blobifyState(cloneState(options.backwardState, backwardLengths));

  return new ColorCycleStrokeDelta({
    layerId: options.layerId,
    forwardState,
    backwardState,
    beforeVersion: options.beforeVersion ?? options.backwardState?.documentVersion,
    afterVersion: options.afterVersion ?? options.forwardState?.documentVersion,
    beforePixelVersion: options.beforePixelVersion ?? options.backwardState?.pixelVersion,
    afterPixelVersion: options.afterPixelVersion ?? options.forwardState?.pixelVersion,
    beforeDimensions: options.beforeDimensions,
    afterDimensions: options.afterDimensions,
  });
};
const toArrayBuffer = (
  value:
    | ArrayBuffer
    | ArrayBufferView
    | { buffer?: ArrayBuffer | SharedArrayBuffer }
    | SharedArrayBuffer
    | undefined
): ArrayBuffer | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof ArrayBuffer) {
    return value;
  }

  const cloneFromView = (view: ArrayBufferView): ArrayBuffer => {
    const out = new Uint8Array(view.byteLength);
    out.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return out.buffer;
  };

  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    const out = new Uint8Array(value.byteLength);
    out.set(new Uint8Array(value));
    return out.buffer;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    if (typeof SharedArrayBuffer !== 'undefined' && view.buffer instanceof SharedArrayBuffer) {
      return cloneFromView(view);
    }
    if (view.buffer instanceof ArrayBuffer) {
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return cloneFromView(view);
  }

  if (typeof value === 'object' && 'buffer' in value && value.buffer) {
    const buffer = value.buffer;
    if (buffer instanceof ArrayBuffer) {
      return buffer;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      const out = new Uint8Array(buffer.byteLength);
      out.set(new Uint8Array(buffer));
      return out.buffer;
    }
  }

  return undefined;
};
