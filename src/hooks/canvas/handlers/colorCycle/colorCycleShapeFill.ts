import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type {
  ColorCycleCommittedStateBrush,
  CommitCommittedLayerStateOptions,
} from '@/hooks/brushEngine/colorCycleCommittedState';
import type { DeferredSaveWithStateArgs } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { clearColorCycleEraseMaskInRegion } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import { useAppStore } from '@/stores/useAppStore';
import { ensureForegroundGradientSlot } from '@/utils/colorCycleGradients';
import { buildCcDitherRuntimePalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { applyRuntimeToBrush, flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';

type ColorCycleBrush = ColorCycleBrushImplementation;
type SnapshotCapableBrush = ColorCycleBrush & ColorCycleCommittedStateBrush & {
  getLayerSnapshot?: (layerId: string) => {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  } | null;
  applyLayerSnapshot?: (layerId: string, snapshot: {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  }) => void;
};

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

const launchDeferredColorCycleShapeSave = (
  deps: ColorCycleShapeFillDeps,
  args: DeferredSaveWithStateArgs
): void => {
  deps.scheduleDeferredColorCycleSaveWithState(args).catch((error) => {
    deps.logError('Deferred color cycle shape save failed', error);
  });
};

export const clearColorCycleShapeEraseMask = (
  layerId: string,
  roi?: DeferredSaveWithStateArgs['roi']
): void => {
  if (!roi) {
    return;
  }
  clearColorCycleEraseMaskInRegion(
    { current: useAppStore.getState() },
    layerId,
    roi
  );
};

const snapshotTransparencyLockMask = (
  layerId: string,
  sourceCanvas: HTMLCanvasElement
): HTMLCanvasElement | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.transparencyLocked !== true) {
    return null;
  }
  if (typeof document === 'undefined') {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sourceCanvas.width;
  maskCanvas.height = sourceCanvas.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return null;
  }
  maskCtx.drawImage(sourceCanvas, 0, 0);
  return maskCanvas;
};

const isLayerTransparencyLocked = (layerId: string): boolean => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  return layer?.transparencyLocked === true;
};

const snapshotTransparencyLockPaintMask = ({
  brush,
  layerId,
}: {
  brush: SnapshotCapableBrush | null | undefined;
  layerId: string;
}): Uint8Array | null => {
  if (!brush || typeof brush.getLayerSnapshot !== 'function' || !isLayerTransparencyLocked(layerId)) {
    return null;
  }
  const snapshot = brush.getLayerSnapshot(layerId);
  if (!snapshot?.paintBuffer) {
    return null;
  }
  return new Uint8Array(snapshot.paintBuffer).slice();
};

const applyCanvasAlphaMask = (
  targetCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null
): void => {
  if (!maskCanvas) {
    return;
  }
  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!targetCtx) {
    return;
  }
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';
  targetCtx.drawImage(maskCanvas, 0, 0);
  targetCtx.restore();
};

const applyTransparencyLockToBrushSnapshot = ({
  brush,
  layerId,
  maskCanvas,
  preFillPaintMask,
}: {
  brush: SnapshotCapableBrush | null | undefined;
  layerId: string;
  maskCanvas: HTMLCanvasElement | null;
  preFillPaintMask?: Uint8Array | null;
}): boolean => {
  if (!brush || typeof brush.getLayerSnapshot !== 'function' || typeof brush.applyLayerSnapshot !== 'function') {
    return false;
  }
  if (!preFillPaintMask && !maskCanvas) {
    return false;
  }

  const snapshot = brush.getLayerSnapshot(layerId);
  if (!snapshot) {
    return false;
  }

  const paint = new Uint8Array(snapshot.paintBuffer);
  const gid = snapshot.gradientIdBuffer ? new Uint8Array(snapshot.gradientIdBuffer) : null;
  const gdef = snapshot.gradientDefIdBuffer ? new Uint16Array(snapshot.gradientDefIdBuffer) : null;
  const spd = snapshot.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null;
  const flow = snapshot.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null;
  const paintMask =
    preFillPaintMask && preFillPaintMask.length === paint.length
      ? preFillPaintMask
      : null;
  let maskAlpha: Uint8ClampedArray | null = null;
  if (!paintMask) {
    if (!maskCanvas) {
      return false;
    }
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) {
      return false;
    }
    maskAlpha = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  }
  const pixelCount = paintMask
    ? Math.min(paint.length, paintMask.length)
    : Math.min(paint.length, Math.floor((maskAlpha?.length ?? 0) / 4));
  let changed = false;
  let hasContent = false;

  for (let i = 0; i < pixelCount; i += 1) {
    const isLockedOut = paintMask ? paintMask[i] === 0 : (maskAlpha?.[i * 4 + 3] ?? 0) === 0;
    if (isLockedOut) {
      if (paint[i] !== 0) {
        paint[i] = 0;
        changed = true;
      }
      if (gid && gid[i] !== 0) {
        gid[i] = 0;
        changed = true;
      }
      if (gdef && gdef[i] !== 0) {
        gdef[i] = 0;
        changed = true;
      }
      if (spd && spd[i] !== 0) {
        spd[i] = 0;
        changed = true;
      }
      if (flow && flow[i] !== 0) {
        flow[i] = 0;
        changed = true;
      }
      continue;
    }
    if (paint[i] !== 0) {
      hasContent = true;
    }
  }

  if (!changed) {
    return false;
  }

  brush.applyLayerSnapshot(layerId, {
    paintBuffer: paint.buffer,
    gradientIdBuffer: gid?.buffer,
    gradientDefIdBuffer: gdef?.buffer,
    speedBuffer: spd?.buffer,
    flowBuffer: flow?.buffer,
    hasContent,
    strokeCounter: snapshot.strokeCounter,
  });
  return true;
};

const shouldRefreshForegroundRuntimeForShapeFinalize = (
  useForegroundGradient: boolean,
  session: MarkGradientSession | null
): boolean => useForegroundGradient && !session?.binding;

const resolveShapeFinalizeDitherOptions = (
  brushSettings: ReturnType<typeof useAppStore.getState>['tools']['brushSettings'],
  ditherPixelSize: number | undefined,
  roi: DeferredSaveWithStateArgs['roi'] | undefined
): {
  ditherPixelSize: number | undefined;
  ditherLevels?: number;
  roi: DeferredSaveWithStateArgs['roi'] | undefined;
  skipPostRender: true;
} => {
  const ccDitherMode = resolveCcDitherBandMode(brushSettings.gradientBands ?? 16);
  return {
    ditherPixelSize,
    ditherLevels: brushSettings.ditherEnabled ? ccDitherMode.quantLevels : undefined,
    roi,
    skipPostRender: true,
  };
};

type CcDitherRenderSession = Pick<
  MarkGradientSession,
  'binding' | 'frozenStopsStored' | 'frozenHash' | 'source' | 'gradientKind' | 'speedCps'
>;

const resolveDitherRenderSession = ({
  layerId,
  session,
  brushSettings,
}: {
  layerId: string;
  session: MarkGradientSession | null;
  brushSettings: ReturnType<typeof useAppStore.getState>['tools']['brushSettings'];
}): CcDitherRenderSession | null => {
  const shouldUseSessionDither =
    Boolean(session?.ditherRenderConfig?.enabled) || (!session?.ditherRenderConfig && brushSettings.ditherEnabled);
  if (!session?.frozenStopsStored?.length || !shouldUseSessionDither) {
    return session
      ? {
          binding: session.binding,
          frozenStopsStored: resolveMarkSessionRuntimeStops(session, session.frozenStopsStored),
          frozenHash: session.frozenHash,
          source: session.source,
          gradientKind: session.gradientKind,
          speedCps: session.speedCps,
        }
      : null;
  }

  const renderPalette = buildCcDitherRuntimePalette({
    baseStops: session.frozenStopsStored,
    bands: session.ditherRenderConfig?.pairBandCount ??
      resolveCcDitherBandMode(brushSettings.gradientBands ?? 16).pairBandCount,
    spread: session.ditherRenderConfig?.spread ?? brushSettings.ditherPaletteSpread,
    algorithm: session.ditherRenderConfig?.algorithm ?? brushSettings.ditherAlgorithm,
    preserveSourceStops:
      session.source === 'sampled' &&
      (session.ditherRenderConfig?.pairBandCount ??
        resolveCcDitherBandMode(brushSettings.gradientBands ?? 16).pairBandCount) <= 0 &&
      (session.ditherRenderConfig?.algorithm ?? brushSettings.ditherAlgorithm ?? 'sierra-lite') === 'sierra-lite',
  });
  const renderDef = ensureGradientDefForStops({
    layerId,
    kind: session.gradientKind,
    stops: renderPalette.renderStops,
    source: session.source,
    speedCps: session.speedCps ?? undefined,
    seamProfile: session.seamProfile,
  });
  if (!renderDef) {
    return {
      binding: session.binding,
      frozenStopsStored: session.frozenStopsStored,
      frozenHash: session.frozenHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
    };
  }

  return {
    binding: { kind: 'def', defId: renderDef.def.id, slot: renderDef.slot },
    frozenStopsStored: renderPalette.renderStops,
    frozenHash: renderDef.hash,
    source: session.source,
    gradientKind: session.gradientKind,
    speedCps: session.speedCps,
  };
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
    const initialBrush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId) as SnapshotCapableBrush | null;
    const preFillPaintMask = snapshotTransparencyLockPaintMask({
      brush: initialBrush,
      layerId: args.activeLayerId,
    });
    const lockMaskCanvas = preFillPaintMask
      ? null
      : snapshotTransparencyLockMask(args.activeLayerId, args.activeLayerCanvas);
    const renderSession = await deps.timeAsync('cc:shape:fill(linear)', async () => {
      const live = useAppStore.getState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      const session = args.session;
      const resolvedRenderSession = resolveDitherRenderSession({
        layerId: args.activeLayerId,
        session,
        brushSettings: liveSettings,
      });
      const shouldRefreshForegroundRuntime = shouldRefreshForegroundRuntimeForShapeFinalize(useFG, session);
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (shouldRefreshForegroundRuntime && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const frozenStops = resolvedRenderSession?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (linear).');
      }
      if (resolvedRenderSession?.binding?.slot !== undefined && frozenStops?.length) {
        const brush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
        if (brush) {
          applyRuntimeToBrush(brush, args.activeLayerId, {
            layerId: args.activeLayerId,
            paintSlot: resolvedRenderSession.binding.slot,
            slotPalettes: [{ slot: resolvedRenderSession.binding.slot, stops: frozenStops }],
            flowMode: liveLayer?.colorCycleData?.flowMode,
          });
        }
      }
      await deps.brushEngine.fillCcGradientLinear(args.shapePoints, args.direction, {
        ...resolveShapeFinalizeDitherOptions(liveSettings, args.ditherPixelSize, args.roi),
      });
      return resolvedRenderSession;
    });

    const colorCycleBrush = initialBrush ?? deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
    if (colorCycleBrush) {
      const st = useAppStore.getState();
      if (shouldRefreshForegroundRuntimeForShapeFinalize(
        Boolean(st.tools.brushSettings.colorCycleUseForegroundGradient),
        args.session
      )) {
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
      const binding: CommitCommittedLayerStateOptions['binding'] = renderSession?.binding
        ? {
            defId: renderSession.binding.defId,
            slot: renderSession.binding.slot,
            bbox: args.roi
              ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
              : undefined,
            previewSlot: renderSession.source === 'sampled' ? TEMP_SAMPLE_SLOT : null,
          }
        : undefined;
      deps.timeSync('cc:shape:commit', () => {
        if (typeof colorCycleBrush.commitCommittedLayerState === 'function') {
          colorCycleBrush.commitCommittedLayerState({
            layerId: args.activeLayerId,
            targetCanvas: args.activeLayerCanvas,
            binding,
          });
          return;
        }
        deps.brushEngine.updateColorCycleTexture();
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
      if (renderSession?.source === 'sampled') {
        try {
          useAppStore.getState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    const maskedBrushData = applyTransparencyLockToBrushSnapshot({
      brush: colorCycleBrush as SnapshotCapableBrush | null,
      layerId: args.activeLayerId,
      maskCanvas: lockMaskCanvas,
      preFillPaintMask,
    });
    if (maskedBrushData) {
      deps.timeSync('cc:shape:render(masked)', () => {
        colorCycleBrush?.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    } else {
      applyCanvasAlphaMask(args.activeLayerCanvas, lockMaskCanvas);
    }

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      deps.ccLog('shape: frameUpdate dispatched', { mode: 'linear' });
    } catch {}

    clearColorCycleShapeEraseMask(args.activeLayerId, args.roi);

    if (args.shapeLayerId) {
      deps.ccLog('shape: wrote CC canvas', { mode: 'linear', layerId: args.shapeLayerId.slice(-6) });
      launchDeferredColorCycleShapeSave(deps, {
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
    const initialBrush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId) as SnapshotCapableBrush | null;
    const preFillPaintMask = snapshotTransparencyLockPaintMask({
      brush: initialBrush,
      layerId: args.activeLayerId,
    });
    const lockMaskCanvas = preFillPaintMask
      ? null
      : snapshotTransparencyLockMask(args.activeLayerId, args.activeLayerCanvas);
    const renderSession = await deps.timeAsync('cc:shape:fill(concentric)', async () => {
      const live = useAppStore.getState();
      const liveLayer = live.layers.find((candidate) => candidate.id === args.activeLayerId);
      const liveSettings = live.tools.brushSettings;
      const useFG = Boolean(liveSettings.colorCycleUseForegroundGradient);
      const session = args.session;
      const resolvedRenderSession = resolveDitherRenderSession({
        layerId: args.activeLayerId,
        session,
        brushSettings: liveSettings,
      });
      const shouldRefreshForegroundRuntime = shouldRefreshForegroundRuntimeForShapeFinalize(useFG, session);
      let fgSlot = liveLayer?.colorCycleData?.fgActiveSlot;
      let fgPalette = liveLayer?.colorCycleData?.slotPalettes?.find((entry) => entry.slot === fgSlot);
      if (shouldRefreshForegroundRuntime && (typeof fgSlot !== 'number' || !fgPalette?.stops?.length)) {
        const ensured = ensureForegroundGradientSlot(args.activeLayerId);
        fgSlot = ensured?.slot ?? fgSlot;
        fgPalette = ensured?.stops?.length
          ? { slot: ensured.slot, stops: ensured.stops }
          : fgPalette;
      }
      const frozenStops = resolvedRenderSession?.frozenStopsStored;
      if (!frozenStops?.length) {
        deps.logError('[CC] Missing mark session on shape finalize (concentric).');
      }
      if (resolvedRenderSession?.binding?.slot !== undefined && frozenStops?.length) {
        const brush = deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
        if (brush) {
          applyRuntimeToBrush(brush, args.activeLayerId, {
            layerId: args.activeLayerId,
            paintSlot: resolvedRenderSession.binding.slot,
            slotPalettes: [{ slot: resolvedRenderSession.binding.slot, stops: frozenStops }],
            flowMode: liveLayer?.colorCycleData?.flowMode,
          });
        }
      }
      await deps.brushEngine.fillCcGradientConcentric(args.shapePoints, {
        ...resolveShapeFinalizeDitherOptions(liveSettings, args.ditherPixelSize, args.roi),
      });
      return resolvedRenderSession;
    });

    const colorCycleBrush = initialBrush ?? deps.getColorCycleBrushManager().getBrush(args.activeLayerId);
    if (colorCycleBrush) {
      const st = useAppStore.getState();
      if (shouldRefreshForegroundRuntimeForShapeFinalize(
        Boolean(st.tools.brushSettings.colorCycleUseForegroundGradient),
        args.session
      )) {
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
      const binding: CommitCommittedLayerStateOptions['binding'] = renderSession?.binding
        ? {
            defId: renderSession.binding.defId,
            slot: renderSession.binding.slot,
            bbox: args.roi
              ? { minX: args.roi.x, minY: args.roi.y, width: args.roi.width, height: args.roi.height }
              : undefined,
            previewSlot: renderSession.source === 'sampled' ? TEMP_SAMPLE_SLOT : null,
          }
        : undefined;
      deps.timeSync('cc:shape:commit', () => {
        if (typeof colorCycleBrush.commitCommittedLayerState === 'function') {
          colorCycleBrush.commitCommittedLayerState({
            layerId: args.activeLayerId,
            targetCanvas: args.activeLayerCanvas,
            binding,
          });
          return;
        }
        deps.brushEngine.updateColorCycleTexture();
        colorCycleBrush.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    }

    try {
      if (renderSession?.source === 'sampled') {
        try {
          useAppStore.getState().setCcGradientSampleCount(0);
        } catch {}
      }
    } catch {}

    const maskedBrushData = applyTransparencyLockToBrushSnapshot({
      brush: colorCycleBrush as SnapshotCapableBrush | null,
      layerId: args.activeLayerId,
      maskCanvas: lockMaskCanvas,
      preFillPaintMask,
    });
    if (maskedBrushData) {
      deps.timeSync('cc:shape:render(masked)', () => {
        colorCycleBrush?.renderDirectToCanvas?.(args.activeLayerCanvas, args.activeLayerId);
      });
    } else {
      applyCanvasAlphaMask(args.activeLayerCanvas, lockMaskCanvas);
    }

    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      deps.ccLog('shape: frameUpdate dispatched', { mode: 'concentric' });
    } catch {}

    clearColorCycleShapeEraseMask(args.activeLayerId, args.roi);

    if (args.shapeLayerId) {
      deps.ccLog('shape: wrote CC canvas', { mode: 'concentric', layerId: args.shapeLayerId.slice(-6) });
      launchDeferredColorCycleShapeSave(deps, {
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
