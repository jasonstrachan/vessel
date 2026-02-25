import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { DeferredSaveWithStateArgs } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { useAppStore } from '@/stores/useAppStore';
import { ensureForegroundGradientSlot } from '@/utils/colorCycleGradients';
import { applyRuntimeToBrush, flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';

type ColorCycleBrush = ColorCycleBrushImplementation;

export type ColorCycleShapeFillDeps = {
  brushEngine: BrushEngine;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => ColorCycleBrush | null | undefined };
  bindBrushToCanvas: (brush: ColorCycleBrush | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
  timeAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  timeSync: (label: string, task: () => void) => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  scheduleDeferredColorCycleSaveWithState: (args: DeferredSaveWithStateArgs) => Promise<void>;
  logError: (message: string, error?: unknown) => void;
};

export const computeFallbackLinearDirection = (
  points: Array<{ x: number; y: number }>
): { x: number; y: number } => {
  const n = points.length;
  if (n === 0) {
    return { x: 1, y: 0 };
  }
  if (n === 1) {
    return { x: 1, y: 0 };
  }

  let bestD2 = -1;
  let ax = points[0];
  let bx = points[1];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) {
        bestD2 = d2;
        ax = points[i];
        bx = points[j];
      }
    }
  }

  let dx = bx.x - ax.x;
  let dy = bx.y - ax.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return { x: 1, y: 0 };
  }
  dx /= len;
  dy /= len;

  return { x: dx, y: dy };
};

export type ColorCycleShapeLinearArgs = {
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  direction: { x: number; y: number };
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
};

export const finalizeColorCycleShapeFillLinear = async (
  args: ColorCycleShapeLinearArgs,
  deps: ColorCycleShapeFillDeps
): Promise<void> => {
  try {
    await deps.timeAsync('cc:shape:fill(linear)', async () => {
      const live = useAppStore.getState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (useFG && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const session = args.session;
      const frozenStops = session?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (linear).');
      }
      if (session?.binding?.slot !== undefined && frozenStops?.length) {
        const brush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
        if (brush) {
          applyRuntimeToBrush(brush, args.activeLayerId, {
            layerId: args.activeLayerId,
            paintSlot: session.binding.slot,
            slotPalettes: [{ slot: session.binding.slot, stops: frozenStops }],
            flowMode: liveLayer?.colorCycleData?.flowMode,
          });
        }
      }
      deps.brushEngine.resetColorCycle(false, { skipGradientReinit: true });
      await deps.brushEngine.fillCcGradientLinear(args.shapePoints, args.direction, {
        ditherPixelSize: args.ditherPixelSize,
        roi: args.roi,
      });
    });

    deps.timeSync('cc:shape:texture', () => {
      deps.brushEngine.updateColorCycleTexture();
    });

    const colorCycleBrush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
    if (colorCycleBrush) {
      const st = useAppStore.getState();
      if (st.tools.brushSettings.colorCycleUseForegroundGradient) {
        const layer = st.layers.find((candidate) => candidate.id === args.activeLayerId);
        let fgSlot = layer?.colorCycleData?.fgActiveSlot;
        let fgPalette = layer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
        if (typeof fgSlot !== 'number' || !fgPalette?.stops?.length) {
          const ensured = ensureForegroundGradientSlot(args.activeLayerId);
          fgSlot = ensured?.slot ?? fgSlot;
          fgPalette = ensured?.stops?.length
            ? { slot: ensured.slot, stops: ensured.stops }
            : fgPalette;
        }
        if (typeof fgSlot !== 'number' || !fgPalette?.stops?.length) {
          return;
        }
        requestGradientApply(args.activeLayerId, 'shape-render-fg');
        flushGradientApply(args.activeLayerId);
      }
      deps.bindBrushToCanvas(colorCycleBrush, args.activeLayerCanvas);
      deps.timeSync('cc:shape:render', () => {
        colorCycleBrush.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    } else {
      deps.timeSync('cc:shape:render(fallback)', () => {
        const targetCtx = args.activeLayerCanvas.getContext('2d', { willReadFrequently: true });
        if (targetCtx && args.overlayCanvas) {
          targetCtx.save();
          targetCtx.globalCompositeOperation = args.fallbackBlendMode;
          targetCtx.globalAlpha = args.fallbackOpacity;
          targetCtx.drawImage(args.overlayCanvas, 0, 0);
          targetCtx.restore();
        }
      });
    }

    try {
      const session = args.session;
      if (session?.binding && colorCycleBrush?.bindGradientDefIdToSlot) {
        const bbox = args.roi
          ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
          : undefined;
        const previewSlot = session.source === 'sampled' ? TEMP_SAMPLE_SLOT : null;
        colorCycleBrush.bindGradientDefIdToSlot(
          args.activeLayerId,
          session.binding.defId,
          session.binding.slot,
          bbox,
          previewSlot
        );
        if (typeof colorCycleBrush.getLayerSnapshot === 'function') {
          const snapshot = colorCycleBrush.getLayerSnapshot(args.activeLayerId);
          if (snapshot?.gradientDefIdBuffer) {
            const state = useAppStore.getState();
            const layer = state.layers.find((entry) => entry.id === args.activeLayerId);
            if (layer?.colorCycleData) {
              state.updateLayer(args.activeLayerId, {
                colorCycleData: {
                  ...layer.colorCycleData,
                  gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
                },
              });
            }
          }
        }
      }
      if (session?.source === 'sampled') {
        try {
          useAppStore.getState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      deps.ccLog('shape: frameUpdate dispatched', { mode: 'linear' });
    } catch {}

    if (args.shapeLayerId) {
      deps.ccLog('shape: wrote CC canvas', { mode: 'linear', layerId: args.shapeLayerId.slice(-6) });
      await deps.scheduleDeferredColorCycleSaveWithState({
        layerId: args.shapeLayerId,
        canvas: args.activeLayerCanvas,
        beforeColorState: args.beforeColorState,
        actionType: 'fill',
        description: 'CC Shape Linear',
        tool: args.tool,
        roi: args.roi,
      });
    }

    const overlayCtx = args.overlayCtx;
    const overlayCanvas = args.overlayCanvas;
    if (!args.keepOverlayAfter && overlayCtx && overlayCanvas) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  } catch (error) {
    deps.logError('Color cycle linear shape fill failed', error);
  }
};

export type ColorCycleShapeConcentricArgs = {
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
};

export const finalizeColorCycleShapeFillConcentric = async (
  args: ColorCycleShapeConcentricArgs,
  deps: ColorCycleShapeFillDeps
): Promise<void> => {
  try {
    await deps.timeAsync('cc:shape:fill(concentric)', async () => {
      const live = useAppStore.getState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (useFG && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const session = args.session;
      const frozenStops = session?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (concentric).');
      }
      if (session?.binding?.slot !== undefined && frozenStops?.length) {
        const brush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
        if (brush) {
          applyRuntimeToBrush(brush, args.activeLayerId, {
            layerId: args.activeLayerId,
            paintSlot: session.binding.slot,
            slotPalettes: [{ slot: session.binding.slot, stops: frozenStops }],
            flowMode: liveLayer?.colorCycleData?.flowMode,
          });
        }
      }
      deps.brushEngine.resetColorCycle(false, { skipGradientReinit: true });
      await deps.brushEngine.fillCcGradientConcentric(args.shapePoints, {
        ditherPixelSize: args.ditherPixelSize,
        roi: args.roi,
      });
    });

    deps.timeSync('cc:shape:texture', () => {
      deps.brushEngine.updateColorCycleTexture();
    });

    const colorCycleBrush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
    if (colorCycleBrush) {
      const st = useAppStore.getState();
      if (st.tools.brushSettings.colorCycleUseForegroundGradient) {
        const layer = st.layers.find((candidate) => candidate.id === args.activeLayerId);
        let fgSlot = layer?.colorCycleData?.fgActiveSlot;
        let fgPalette = layer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
        if (typeof fgSlot !== 'number' || !fgPalette?.stops?.length) {
          const ensured = ensureForegroundGradientSlot(args.activeLayerId);
          fgSlot = ensured?.slot ?? fgSlot;
          fgPalette = ensured?.stops?.length
            ? { slot: ensured.slot, stops: ensured.stops }
            : fgPalette;
        }
        if (typeof fgSlot !== 'number' || !fgPalette?.stops?.length) {
          return;
        }
        requestGradientApply(args.activeLayerId, 'shape-render-fg');
        flushGradientApply(args.activeLayerId);
      }
      deps.bindBrushToCanvas(colorCycleBrush, args.activeLayerCanvas);
      deps.timeSync('cc:shape:render', () => {
        colorCycleBrush.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    }

    try {
      const session = args.session;
      if (session?.binding && colorCycleBrush?.bindGradientDefIdToSlot) {
        const bbox = args.roi
          ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
          : undefined;
        const previewSlot = session.source === 'sampled' ? TEMP_SAMPLE_SLOT : null;
        colorCycleBrush.bindGradientDefIdToSlot(
          args.activeLayerId,
          session.binding.defId,
          session.binding.slot,
          bbox,
          previewSlot
        );
        if (typeof colorCycleBrush.getLayerSnapshot === 'function') {
          const snapshot = colorCycleBrush.getLayerSnapshot(args.activeLayerId);
          if (snapshot?.gradientDefIdBuffer) {
            const state = useAppStore.getState();
            const layer = state.layers.find((entry) => entry.id === args.activeLayerId);
            if (layer?.colorCycleData) {
              state.updateLayer(args.activeLayerId, {
                colorCycleData: {
                  ...layer.colorCycleData,
                  gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
                },
              });
            }
          }
        }
      }
      if (session?.source === 'sampled') {
        try {
          useAppStore.getState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      deps.ccLog('shape: frameUpdate dispatched', { mode: 'concentric' });
    } catch {}

    if (args.shapeLayerId) {
      deps.ccLog('shape: wrote CC canvas', { mode: 'concentric', layerId: args.shapeLayerId.slice(-6) });
      await deps.scheduleDeferredColorCycleSaveWithState({
        layerId: args.shapeLayerId,
        canvas: args.activeLayerCanvas,
        beforeColorState: args.beforeColorState,
        actionType: 'fill',
        description: 'CC Shape',
        tool: args.tool,
        roi: args.roi,
      });
    }

    const overlayCtx = args.overlayCtx;
    const overlayCanvas = args.overlayCanvas;
    if (!args.keepOverlayAfter && overlayCtx && overlayCanvas && args.activeLayerCanvas) {
      deps.timeSync('cc:shape:renderOverlay', () => {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.globalAlpha = args.fallbackOpacity;
        overlayCtx.globalCompositeOperation = args.fallbackBlendMode;
        overlayCtx.drawImage(args.activeLayerCanvas, 0, 0);
      });
    }
  } catch (error) {
    deps.logError('Color cycle concentric shape fill failed', error);
  }
};

export type ColorCycleShapeFillMode = 'linear' | 'concentric';

export type RunColorCycleShapeFillArgs = {
  mode: ColorCycleShapeFillMode;
  session: MarkGradientSession | null;
  shapePoints: Array<{ x: number; y: number }>;
  direction?: { x: number; y: number };
  activeLayerId: string;
  activeLayerCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement | null;
  overlayCtx: CanvasRenderingContext2D | null;
  fallbackBlendMode: GlobalCompositeOperation;
  fallbackOpacity: number;
  shapeLayerId: string;
  beforeColorState: DeferredSaveWithStateArgs['beforeColorState'];
  tool: DeferredSaveWithStateArgs['tool'];
  roi?: DeferredSaveWithStateArgs['roi'];
  ditherPixelSize?: number;
  keepOverlayAfter?: boolean;
};

export type RunColorCycleShapeFillDeps = ColorCycleShapeFillDeps & {
  ccDebug: { on?: boolean };
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
};

export const runColorCycleShapeFill = async (
  args: RunColorCycleShapeFillArgs,
  deps: RunColorCycleShapeFillDeps
): Promise<void> => {
  deps.perfMark('cc:visible-finalize:start');
  if (deps.ccDebug.on) {
    deps.debugTime('cc:visible-finalize');
  }

  if (args.mode === 'linear') {
    const direction = args.direction ?? computeFallbackLinearDirection(args.shapePoints);
    await finalizeColorCycleShapeFillLinear({
      session: args.session,
      shapePoints: args.shapePoints,
      direction,
      activeLayerId: args.activeLayerId,
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      fallbackBlendMode: args.fallbackBlendMode,
      fallbackOpacity: args.fallbackOpacity,
      shapeLayerId: args.shapeLayerId,
      beforeColorState: args.beforeColorState,
      tool: args.tool,
      roi: args.roi,
      ditherPixelSize: args.ditherPixelSize,
      keepOverlayAfter: args.keepOverlayAfter,
    }, deps);
  } else {
    await finalizeColorCycleShapeFillConcentric({
      session: args.session,
      shapePoints: args.shapePoints,
      activeLayerId: args.activeLayerId,
      activeLayerCanvas: args.activeLayerCanvas,
      overlayCanvas: args.overlayCanvas,
      overlayCtx: args.overlayCtx,
      fallbackBlendMode: args.fallbackBlendMode,
      fallbackOpacity: args.fallbackOpacity,
      shapeLayerId: args.shapeLayerId,
      beforeColorState: args.beforeColorState,
      tool: args.tool,
      roi: args.roi,
      ditherPixelSize: args.ditherPixelSize,
      keepOverlayAfter: args.keepOverlayAfter,
    }, deps);
  }

  if (deps.ccDebug.on) {
    deps.debugTimeEnd('cc:visible-finalize');
  }
  deps.perfMark('cc:visible-finalize:end');
  deps.perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');
};
