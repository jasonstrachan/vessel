import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import type { GradientStop } from '@/lib/GradientPalette';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import { isColorCycleDesired } from '@/utils/colorCyclePlayback';
import type {
  HistoryDelta,
  HistoryDirection,
  HistoryRehydrationTargets,
} from '../actionTypes';

type ColorCycleBrushState = ReturnType<ColorCycleBrushCanvas2D['serialize']>;
type ColorCycleSerializedLayer = NonNullable<ColorCycleBrushState['layers']>[number];

type ManagedColorCycleBrush = ColorCycleBrushCanvas2D & {
  commitToLayer?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  render?: (forceFullOpacity?: boolean) => void;
  flush?: (layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
  updateColorCycleTexture?: () => void;
  getCanvas?: () => HTMLCanvasElement | null;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  applyLayerSnapshot?: (
    layerId: string,
    snapshot: {
      paintBuffer: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    },
    animatorIndex?: unknown
  ) => void;
};

type RuntimeLayerState = { strokeCounter?: number; hasContent?: boolean };

export interface ColorCycleStrokeDeltaOptions {
  layerId: string;
  forwardState: ColorCycleBrushState | null;
  backwardState: ColorCycleBrushState | null;
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

const cloneState = (
  state: ColorCycleBrushState | null,
  paintBufferLengths?: Map<string, number>
): ColorCycleBrushState | null => {
  if (!state) {
    return null;
  }
  return {
    cycleSpeed: state.cycleSpeed,
    fps: state.fps,
    brushSize: state.brushSize,
    layers: state.layers
      ? state.layers.map((layer: ColorCycleSerializedLayer) => ({
          layerId: layer.layerId,
          data: cloneLayerData(layer.data),
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
                })()
              }
            : undefined
        }))
      : []
  };
};

export class ColorCycleStrokeDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly forwardState: ColorCycleBrushState | null;
  private readonly backwardState: ColorCycleBrushState | null;

  constructor(options: ColorCycleStrokeDeltaOptions) {
    this.layerId = options.layerId;
    this.forwardState = options.forwardState;
    this.backwardState = options.backwardState;
    const sizeOf = (state: ColorCycleBrushState | null) =>
      state?.layers?.reduce((sum: number, layer: ColorCycleSerializedLayer) => {
        return sum + (layer.strokeData?.paintBuffer?.byteLength ?? 0);
      }, 0) ?? 0;
    this.approxBytes = sizeOf(this.forwardState) + sizeOf(this.backwardState);
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const state = direction === 'forward' ? this.forwardState : this.backwardState;
    if (!state) {
      return;
    }

    const manager = getColorCycleBrushManager();
    const initialState = useAppStore.getState();
    const initialLayer = initialState.layers.find((candidate) => candidate.id === this.layerId);
    if (!initialLayer || initialLayer.layerType !== 'color-cycle' || !initialLayer.colorCycleData) {
      return;
    }

    if (!manager.getBrush(this.layerId)) {
      const width =
        initialLayer.colorCycleData.canvas?.width ??
        initialState.project?.width ??
        0;
      const height =
        initialLayer.colorCycleData.canvas?.height ??
        initialState.project?.height ??
        0;
      if (!width || !height) {
        return;
      }
      try {
        initialState.initColorCycleForLayer(this.layerId, width, height);
      } catch {
        return;
      }
    }

    const brush = manager.getBrush(this.layerId) as ManagedColorCycleBrush | undefined;
    const liveState = useAppStore.getState();
    const layer = liveState.layers.find((candidate) => candidate.id === this.layerId);
    const targetCanvas = layer?.colorCycleData?.canvas;
    if (!brush || !layer || layer.layerType !== 'color-cycle' || !targetCanvas) {
      return;
    }

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      targetCanvas instanceof HTMLCanvasElement &&
      typeof (brush as ManagedColorCycleBrush).setTargetCanvas === 'function'
    ) {
      try {
        (brush as ManagedColorCycleBrush).setTargetCanvas(targetCanvas);
      } catch {
        // Best-effort reattachment; render flow will continue regardless.
      }
    }

    const layerSnapshots = state.layers ?? [];
    const restoredHasContent = layerSnapshots.some((layerSnapshot) =>
      Boolean(layerSnapshot.strokeData?.hasContent)
    );
    const layerHadContent = Boolean(layer.colorCycleData?.hasContent);

    if (!restoredHasContent && !layerHadContent) {
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
      brush.restoreFullState({
        cycleSpeed: state.cycleSpeed,
        fps: state.fps,
        brushSize: state.brushSize,
        layerSnapshots: layerSnapshots.map((layerSnapshot: ColorCycleSerializedLayer) => {
          const layerData = layerSnapshot?.data as {
            indexBuffer?: {
              width?: number;
              height?: number;
              data?: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | SharedArrayBuffer;
            };
            gradient?: { gradientStops?: GradientStop[] | unknown };
          } | undefined;
          const indexBuffer = layerData?.indexBuffer;
          const animatorData = toArrayBuffer(indexBuffer?.data);
          const gradientStops = Array.isArray(layerData?.gradient?.gradientStops)
            ? (layerData?.gradient?.gradientStops as GradientStop[])
            : undefined;
          const animatorIndex =
            animatorData && typeof indexBuffer?.width === 'number' && typeof indexBuffer?.height === 'number'
              ? {
                  width: indexBuffer.width,
                  height: indexBuffer.height,
                  data: animatorData,
                  gradientStops
                }
              : undefined;
          return {
            layerId: layerSnapshot.layerId,
            paintBuffer: layerSnapshot.strokeData?.paintBuffer ?? new ArrayBuffer(0),
            hasContent: Boolean(layerSnapshot.strokeData?.hasContent),
            strokeCounter: layerSnapshot.strokeData?.strokeCounter ?? 0,
            animatorIndex
          };
        })
      }, { mode: 'history' });
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

      // Ensure runtime stroke data reflects presence of restored content
      if (restoredHasContent) {
        try {
          const runtimeBrush = brush as unknown as { layerStrokes?: Map<string, RuntimeLayerState> };
          const runtimeState = runtimeBrush.layerStrokes?.get?.(this.layerId);
          if (runtimeState) {
            runtimeState.hasContent = true;
          }
        } catch {
          // Best-effort; brush state remains authoritative even if this fails.
        }
      }

      const tctx = targetCanvas.getContext('2d', { willReadFrequently: true });
      if (!tctx) {
        return;
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
        if (latestLayer?.colorCycleData) {
          latestState.updateLayer(this.layerId, {
            colorCycleData: {
              ...latestLayer.colorCycleData,
              hasContent: restoredHasContent
            }
          });
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
    } catch {
      // If restore fails, leave state unchanged. Fallback bitmap delta should cover visual output.
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
}

export const createColorCycleStrokeDelta = (
  options: ColorCycleStrokeDeltaOptions
): HistoryDelta | null => {
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

  return new ColorCycleStrokeDelta({
    layerId: options.layerId,
    forwardState: cloneState(options.forwardState, forwardLengths),
    backwardState: cloneState(options.backwardState, backwardLengths)
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
