import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { DeferredSaveWithStateArgs } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { useAppStore } from '@/stores/useAppStore';
import {
  DEFAULT_COLOR_CYCLE_GRADIENT,
  ensureForegroundGradientSlot,
} from '@/utils/colorCycleGradients';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { beginMarkGradientSession, finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { featureFlags } from '@/config/featureFlags';

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

const resolveActiveNonFgStops = (
  layer: { colorCycleData?: { gradientDefs?: Array<{ id: string; currentSlot: number }>; activeGradientId?: string; slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }> } } | undefined
): Array<{ position: number; color: string }> | null => {
  const defs = layer?.colorCycleData?.gradientDefs;
  const palettes = layer?.colorCycleData?.slotPalettes;
  if (!defs?.length || !palettes?.length) {
    return null;
  }
  const activeId = layer?.colorCycleData?.activeGradientId ?? defs[0]?.id;
  const activeDef = defs.find((entry) => entry.id === activeId) ?? defs[0];
  const activeSlot = activeDef?.currentSlot;
  if (typeof activeSlot !== 'number') {
    return null;
  }
  const palette = palettes.find((entry) => entry.slot === activeSlot);
  return palette?.stops?.length ? palette.stops : null;
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
      const desiredSource =
        live.tools.ccGradientSource ??
        (liveSettings.colorCycleUseForegroundGradient ? 'fg' : 'manual');
      const useFG = desiredSource === 'fg';
      const source =
        desiredSource === 'sampled' && featureFlags.ccSampledEnabled
          ? 'sampled'
          : useFG
            ? 'fg'
            : 'manual';
      const fallbackStops =
        liveSettings.colorCycleGradient ?? DEFAULT_COLOR_CYCLE_GRADIENT;
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (useFG && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const activeStops = resolveActiveNonFgStops(liveLayer);
      const resolvedStops = useFG && fgPalette?.stops?.length
        ? fgPalette.stops
        : (activeStops?.length ? activeStops : (liveLayer?.colorCycleData?.gradient?.length ? liveLayer.colorCycleData.gradient : fallbackStops));
      const session = beginMarkGradientSession({
        layerId: args.activeLayerId,
        markKind: 'shape',
        gradientKind: 'linear',
        source,
        stops: resolvedStops,
      });
      if (session?.binding?.slot !== undefined) {
        requestGradientApply(args.activeLayerId, 'shape-prefill-session');
        flushGradientApply(args.activeLayerId);
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
      const session = finalizeMarkGradientSession(args.activeLayerId);
      if (session?.binding && colorCycleBrush?.bindGradientDefIdToSlot) {
        const bbox = args.roi
          ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
          : undefined;
        colorCycleBrush.bindGradientDefIdToSlot(
          args.activeLayerId,
          session.binding.defId,
          session.binding.slot,
          bbox
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
      const desiredSource =
        live.tools.ccGradientSource ??
        (liveSettings.colorCycleUseForegroundGradient ? 'fg' : 'manual');
      const useFG = desiredSource === 'fg';
      const source =
        desiredSource === 'sampled' && featureFlags.ccSampledEnabled
          ? 'sampled'
          : useFG
            ? 'fg'
            : 'manual';
      const fallbackStops =
        liveSettings.colorCycleGradient ?? DEFAULT_COLOR_CYCLE_GRADIENT;
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (useFG && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const activeStops = resolveActiveNonFgStops(liveLayer);
      const resolvedStops = useFG && fgPalette?.stops?.length
        ? fgPalette.stops
        : (activeStops?.length ? activeStops : (liveLayer?.colorCycleData?.gradient?.length ? liveLayer.colorCycleData.gradient : fallbackStops));
      const session = beginMarkGradientSession({
        layerId: args.activeLayerId,
        markKind: 'shape',
        gradientKind: 'concentric',
        source,
        stops: resolvedStops,
      });
      if (session?.binding?.slot !== undefined) {
        requestGradientApply(args.activeLayerId, 'shape-prefill-session');
        flushGradientApply(args.activeLayerId);
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
      const session = finalizeMarkGradientSession(args.activeLayerId);
      if (session?.binding && colorCycleBrush?.bindGradientDefIdToSlot) {
        const bbox = args.roi
          ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
          : undefined;
        colorCycleBrush.bindGradientDefIdToSlot(
          args.activeLayerId,
          session.binding.defId,
          session.binding.slot,
          bbox
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
