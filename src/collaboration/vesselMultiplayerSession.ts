'use client';

import { useSyncExternalStore } from 'react';

import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import {
  commitColorCycleLayerStroke,
  type ManagedColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { createBrushEngineFacade } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  createPixelCircleStamp,
  createPixelSquareStamp,
} from '@/hooks/brushEngine/brushStampController';
import { applyColorCycleBrushSettingsPatch } from '@/hooks/brushEngine/colorCycleBrushSettingsController';
import type { CCBrushSettingsPatch } from '@/hooks/brushEngine/colorCycleBrushContracts';
import type { ColorCycleDirtyRect } from '@/lib/colorCycle/document';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { RenderStaticCompositeOptions } from '@/stores/layers/layersSliceTypes';
import type { BrushSettings, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

import type { VesselCollaborationPoint } from './vesselCollaborationProtocol';

export type VesselMultiplayerStatus =
  | 'idle'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface VesselMultiplayerCursor {
  x: number;
  y: number;
  visible: boolean;
  drawing: boolean;
}

export interface VesselMultiplayerSnapshot {
  sessionId: string | null;
  status: VesselMultiplayerStatus;
  humanLayerId: string | null;
  aiLayerId: string | null;
  activeGestureId: string | null;
  aiCursor: VesselMultiplayerCursor | null;
  stopReason: string | null;
  error: string | null;
}

export interface VesselMultiplayerGesture {
  sessionId: string;
  gestureId: string;
  actor: 'ai';
  kind: 'stroke' | 'shape';
  points: VesselCollaborationPoint[];
  direction?: VesselCollaborationPoint[];
  pointsPerFrame?: number;
  settings?: Partial<BrushSettings>;
}

export interface VesselMultiplayerRuntime {
  compositeCanvasDirtyRef: { current: boolean };
  rebuildStaticComposite: (
    options?: RenderStaticCompositeOptions,
  ) => boolean | Promise<boolean>;
  requestRedraw: () => void;
  scheduleHistoryCommit?: (payload: LayerHistoryPayload) => Promise<void>;
}

const INITIAL_SNAPSHOT: VesselMultiplayerSnapshot = {
  sessionId: null,
  status: 'idle',
  humanLayerId: null,
  aiLayerId: null,
  activeGestureId: null,
  aiCursor: null,
  stopReason: null,
  error: null,
};

let snapshot = INITIAL_SNAPSHOT;
let sessionBrushSettings: BrushSettings | null = null;
let activeGestureAbortController: AbortController | null = null;
const listeners = new Set<() => void>();

const publish = (updates: Partial<VesselMultiplayerSnapshot>) => {
  snapshot = { ...snapshot, ...updates };
  listeners.forEach((listener) => listener());
};

export const getVesselMultiplayerSnapshot = () => snapshot;

export const subscribeVesselMultiplayer = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useVesselMultiplayerSnapshot = () => useSyncExternalStore(
  subscribeVesselMultiplayer,
  getVesselMultiplayerSnapshot,
  getVesselMultiplayerSnapshot,
);

const cloneBrushSettings = (settings: BrushSettings): BrushSettings => ({
  ...settings,
  colorCycleGradient: settings.colorCycleGradient?.map((stop) => ({ ...stop })),
});

const createAiLayer = (
  name: string,
  layerType: 'normal' | 'color-cycle',
  project: { width: number; height: number },
): Omit<Layer, 'id' | 'order'> => {
  const state = getAppStoreState();
  const framebuffer = document.createElement('canvas');
  framebuffer.width = layerType === 'normal' ? project.width : 1;
  framebuffer.height = layerType === 'normal' ? project.height : 1;
  const commonLayer = {
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over' as const,
    locked: false,
    transparencyLocked: false,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
  };
  if (layerType === 'normal') {
    return { ...commonLayer, layerType: 'normal' };
  }
  return {
    ...commonLayer,
    layerType: 'color-cycle',
    colorCycleData: {
      gradient: (
        state.tools.brushSettings.colorCycleGradient ?? DEFAULT_GRADIENT_STOPS
      ).map((stop) => ({ ...stop })),
      isAnimating: true,
      flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'forward',
    },
  };
};

export const startVesselMultiplayerSession = async ({
  sessionId,
  aiLayerName = 'AI — Multiplayer',
}: {
  sessionId: string;
  aiLayerName?: string;
}): Promise<VesselMultiplayerSnapshot> => {
  if (snapshot.status === 'active' || snapshot.status === 'stopping') {
    if (snapshot.sessionId === sessionId) return snapshot;
    throw new Error(`Multiplayer session is already active: ${snapshot.sessionId}`);
  }

  const state = getAppStoreState();
  if (!state.project) throw new Error('No Vessel project is loaded');
  const humanLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
  if (!humanLayer) throw new Error('No active layer is selected');
  if (humanLayer.layerType !== 'normal' && humanLayer.layerType !== 'color-cycle') {
    throw new Error('Multiplayer painting requires Jason to use a normal or Color Cycle layer');
  }
  if (!humanLayer.visible || humanLayer.locked) {
    throw new Error('Jason\'s multiplayer layer must be visible and unlocked');
  }

  let aiLayerId: string | null = null;
  try {
    aiLayerId = state.addLayer(createAiLayer(aiLayerName, humanLayer.layerType, state.project));
    if (!aiLayerId) throw new Error('Failed to create the AI multiplayer layer');
    if (humanLayer.layerType === 'color-cycle') {
      const ready = await getAppStoreState().ensureColorCycleLayerRuntime(aiLayerId, {
        target: 'active',
      });
      if (!ready) throw new Error('The AI Color Cycle layer could not become editable');
      await getAppStoreState().ensureColorCycleLayerRuntime(aiLayerId, { target: 'warm' });
    }
  } catch (error) {
    if (aiLayerId) getAppStoreState().removeLayer(aiLayerId);
    throw error;
  } finally {
    getAppStoreState().setActiveLayer(humanLayer.id);
  }
  if (!aiLayerId) throw new Error('Failed to create the AI multiplayer layer');

  sessionBrushSettings = cloneBrushSettings(state.tools.brushSettings);
  publish({
    sessionId,
    status: 'active',
    humanLayerId: humanLayer.id,
    aiLayerId,
    activeGestureId: null,
    aiCursor: null,
    stopReason: null,
    error: null,
  });
  return snapshot;
};

const nextFrame = (signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) {
    resolve();
    return;
  }
  requestAnimationFrame(() => resolve());
});

const brushSettingsPatch = (settings: BrushSettings): CCBrushSettingsPatch => ({
  brushSize: Math.max(1, Math.round(settings.size ?? 1)),
  cycleSpeed: settings.colorCycleSpeed ?? 1,
  gradientBands: settings.gradientBands ?? 12,
  bandSpacing: settings.colorCycleBandSpacingPx ?? settings.spacing ?? 12,
  pressureEnabled: settings.pressureEnabled === true,
  minPressure: settings.minPressure ?? 100,
  maxPressure: settings.maxPressure ?? 100,
  ditherEnabled: settings.ditherEnabled === true,
  ditherPixelSize: Math.max(1, Math.round(settings.fillResolution ?? 1)),
  pxlEdgeEnabled: settings.pxlEdge === true,
  stampShape: settings.colorCycleStampShape ?? 'square',
  stampDitherEnabled: settings.colorCycleStampDitherEnabled === true,
  stampDitherAlgorithm: settings.ditherAlgorithm ?? 'sierra-lite',
  stampDitherPatternStyle: settings.patternStyle ?? 'dots',
  stampDitherPressureLinked: settings.colorCycleStampDitherPressureLinked === true,
  stampDitherBgFill: settings.colorCycleStampDitherBgFill !== false,
  stampDitherPixelSize: Math.max(
    1,
    Math.round(settings.colorCycleStampDitherPixelSize ?? settings.fillResolution ?? 1),
  ),
});

const pointBounds = (
  points: VesselCollaborationPoint[],
  padding: number,
  project: { width: number; height: number },
) => {
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - padding));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - padding));
  const maxX = Math.min(
    project.width,
    Math.ceil(Math.max(...points.map((point) => point.x)) + padding),
  );
  const maxY = Math.min(
    project.height,
    Math.ceil(Math.max(...points.map((point) => point.y)) + padding),
  );
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
};

const presentAiLayer = async (
  runtime: VesselMultiplayerRuntime,
  layer: Layer,
  dirtyRects?: ColorCycleDirtyRect[],
) => {
  if (layer.layerType === 'color-cycle') {
    const brush = getColorCycleBrushManager().getSurfaceBrush(layer.id);
    const canvas = layer.colorCycleData?.canvas ?? null;
    if (brush && canvas) brush.renderDirectToCanvas?.(canvas, layer.id);
  }
  runtime.compositeCanvasDirtyRef.current = true;
  if (layer.layerType === 'normal' && dirtyRects?.length) {
    await runtime.rebuildStaticComposite({
      captureBitmap: false,
      dirtyBatches: [{
        layerId: layer.id,
        version: layer.version ?? 0,
        rects: dirtyRects,
      }],
    });
  } else {
    await runtime.rebuildStaticComposite();
  }
  runtime.requestRedraw();
};

const executeNormalMultiplayerStroke = async (
  gesture: VesselMultiplayerGesture,
  runtime: VesselMultiplayerRuntime,
  layer: Layer,
  settings: BrushSettings,
  externalSignal?: AbortSignal,
): Promise<VesselMultiplayerSnapshot> => {
  if (gesture.kind !== 'stroke') {
    throw new Error('Normal-layer multiplayer currently supports strokes only');
  }
  const project = getAppStoreState().project;
  if (!project) throw new Error('The Vessel project closed during multiplayer painting');
  if (!runtime.scheduleHistoryCommit) {
    throw new Error('The canonical Vessel history queue is unavailable');
  }

  const framebuffer = layer.framebuffer;
  if (!(framebuffer instanceof HTMLCanvasElement)) {
    throw new Error('The AI normal layer requires an HTML canvas framebuffer');
  }
  if (framebuffer.width !== project.width || framebuffer.height !== project.height) {
    framebuffer.width = project.width;
    framebuffer.height = project.height;
  }
  const context = framebuffer.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The AI normal-layer canvas is unavailable');
  context.imageSmoothingEnabled = settings.antialiasing !== false;
  const beforeImage = context.getImageData(0, 0, project.width, project.height);
  const stampCache = new Map<string, HTMLCanvasElement>();
  const brushEngine = createBrushEngineFacade({
    brushSettings: settings,
    transparencyLockEnabled: layer.transparencyLocked === true,
    brushStampCache: stampCache,
    createPixelCircleStamp: (size) => createPixelCircleStamp({ size, brushStampCache: stampCache }),
    createPixelSquareStamp: (size) => createPixelSquareStamp({ size, brushStampCache: stampCache }),
    customBrushes: project.customBrushes ?? [],
  });
  brushEngine.resetStroke();

  const localAbortController = new AbortController();
  activeGestureAbortController = localAbortController;
  const detachExternalAbort = combineAbortSignals(localAbortController, externalSignal);
  const signal = localAbortController.signal;
  const pointsPerFrame = Math.max(1, Math.min(8, gesture.pointsPerFrame ?? 2));
  const dirtyPadding = Math.max(2, Math.ceil((settings.size ?? 1) / 2) + 2);
  let authoredPointCount = 0;
  let presentedPointCount = 0;
  publish({ activeGestureId: gesture.gestureId, error: null });

  try {
    for (let index = 0; index < gesture.points.length && !signal.aborted; index += 1) {
      const point = gesture.points[index];
      const previous = gesture.points[Math.max(0, index - 1)];
      brushEngine.renderBrushStroke(context, {
        from: { x: previous.x, y: previous.y },
        to: { x: point.x, y: point.y },
        pressure: point.pressure ?? 1,
        velocity: 0,
        timestamp: performance.now(),
      });
      authoredPointCount += 1;
      publish({ aiCursor: { x: point.x, y: point.y, visible: true, drawing: true } });
      if ((index + 1) % pointsPerFrame === 0) {
        const dirtyPoints = gesture.points.slice(
          Math.max(0, presentedPointCount - 1),
          index + 1,
        );
        await presentAiLayer(runtime, layer, [pointBounds(dirtyPoints, dirtyPadding, project)]);
        presentedPointCount = index + 1;
        await nextFrame(signal);
      }
    }
  } finally {
    detachExternalAbort();
    try {
      if (authoredPointCount > 0) {
        brushEngine.finalizeStroke(context);
        const finalDirtyPoints = gesture.points.slice(
          Math.max(0, presentedPointCount - 1),
          authoredPointCount,
        );
        await presentAiLayer(runtime, layer, [
          pointBounds(finalDirtyPoints, dirtyPadding, project),
        ]);
        const afterImage = context.getImageData(0, 0, project.width, project.height);
        getAppStoreState().updateLayer(layer.id, { framebuffer, imageData: afterImage });
        await runtime.scheduleHistoryCommit({
          layerId: layer.id,
          beforeImage,
          afterImage,
          beforeColorState: null,
          afterColorState: null,
          actionType: 'brush',
          description: 'AI multiplayer stroke',
          tool: 'brush',
        });
        await presentAiLayer(runtime, layer);
      }
    } finally {
      brushEngine.resetStroke();
      activeGestureAbortController = null;
      const lastPoint = gesture.points[Math.max(0, authoredPointCount - 1)];
      publish({
        activeGestureId: null,
        status: getVesselMultiplayerSnapshot().status === 'stopping'
          ? 'stopped'
          : getVesselMultiplayerSnapshot().status,
        aiCursor: lastPoint
          ? { x: lastPoint.x, y: lastPoint.y, visible: true, drawing: false }
          : snapshot.aiCursor,
      });
    }
  }
  return snapshot;
};

const commitAiMark = async ({
  layer,
  settings,
  points,
  beforeColorState,
  runtime,
  kind,
}: {
  layer: Layer;
  settings: BrushSettings;
  points: VesselCollaborationPoint[];
  beforeColorState: NonNullable<ReturnType<typeof captureColorCycleBrushState>>;
  runtime: VesselMultiplayerRuntime;
  kind: 'stroke' | 'shape';
}) => {
  const project = getAppStoreState().project;
  if (!project) throw new Error('The Vessel project closed during multiplayer painting');
  const padding = Math.max(2, Math.ceil((settings.size ?? 1) / 2) + 2);
  const roi = pointBounds(points, padding, project);
  const manager = getColorCycleBrushManager();
  await commitColorCycleLayerStroke({
    layer,
    drawingCanvas: null,
    brushSettings: settings,
    project,
    strokeBoundingBox: {
      minX: roi.x,
      minY: roi.y,
      maxX: roi.x + roi.width,
      maxY: roi.y + roi.height,
    },
    captureRoi: roi,
    strokeCapturePadding: 0,
    roiPadding: 0,
    enableCaptureRoi: true,
    shouldBuildEraseMask: false,
  }, {
    getBrushForLayer: (layerId) => manager.getCommitBrush(layerId) as ManagedColorCycleBrush | undefined,
    bindBrushToCanvas: (brush, canvas) => brush.setTargetCanvas?.(canvas),
    markLayerHasContent: (layerId) => {
      const current = getAppStoreState();
      const currentLayer = current.layers.find((candidate) => candidate.id === layerId);
      if (currentLayer?.colorCycleData) {
        current.updateLayer(layerId, {
          colorCycleData: { ...currentLayer.colorCycleData, hasContent: true },
        });
      }
    },
    perfMark: () => {},
    perfMeasure: () => {},
    startFinalizeVisibleTimer: () => {},
    endFinalizeVisibleTimer: () => {},
    dispatchFrameUpdate: () => {
      runtime.compositeCanvasDirtyRef.current = true;
      runtime.requestRedraw();
    },
  });

  const afterColorState = captureColorCycleBrushState(layer.id);
  if (!afterColorState) throw new Error('AI Color Cycle state could not be captured after the mark');
  if (!runtime.scheduleHistoryCommit) {
    throw new Error('The canonical Vessel history queue is unavailable');
  }
  await runtime.scheduleHistoryCommit({
    layerId: layer.id,
    beforeImage: null,
    beforeColorState,
    afterColorState,
    actionType: 'brush',
    description: `AI multiplayer ${kind}`,
    tool: 'brush',
    skipBitmapDelta: true,
    bitmapRoi: roi,
  });
  await presentAiLayer(runtime, layer);
};

const combineAbortSignals = (
  local: AbortController,
  external?: AbortSignal,
) => {
  if (!external) return () => {};
  const abort = () => local.abort(external.reason);
  if (external.aborted) abort();
  else external.addEventListener('abort', abort, { once: true });
  return () => external.removeEventListener('abort', abort);
};

export const executeVesselMultiplayerGesture = async (
  gesture: VesselMultiplayerGesture,
  runtime: VesselMultiplayerRuntime,
  externalSignal?: AbortSignal,
): Promise<VesselMultiplayerSnapshot> => {
  if (snapshot.status !== 'active' || snapshot.sessionId !== gesture.sessionId) {
    throw new Error(`Multiplayer session is not active: ${gesture.sessionId}`);
  }
  if (snapshot.activeGestureId) {
    throw new Error(`AI gesture is already active: ${snapshot.activeGestureId}`);
  }
  if (gesture.actor !== 'ai') throw new Error('Only the AI bridge actor can submit remote gestures');

  const state = getAppStoreState();
  const aiLayer = state.layers.find((layer) => layer.id === snapshot.aiLayerId);
  if (!state.project || !aiLayer) {
    throw new Error('The AI multiplayer layer is unavailable');
  }
  const project = state.project;
  if (!aiLayer.visible || aiLayer.locked) throw new Error('The AI multiplayer layer is not drawable');
  const outsideProject = [...gesture.points, ...(gesture.direction ?? [])].find(
    (point) => point.x < 0 || point.y < 0 || point.x >= project.width || point.y >= project.height,
  );
  if (outsideProject) throw new Error('Multiplayer gesture points must stay inside the project canvas');
  const settings = {
    ...cloneBrushSettings(sessionBrushSettings ?? state.tools.brushSettings),
    ...gesture.settings,
  } as BrushSettings;
  sessionBrushSettings = cloneBrushSettings(settings);
  if (aiLayer.layerType === 'normal') {
    return executeNormalMultiplayerStroke(
      gesture,
      runtime,
      aiLayer,
      settings,
      externalSignal,
    );
  }
  if (aiLayer.layerType !== 'color-cycle') {
    throw new Error('The AI multiplayer layer is not drawable');
  }
  const ready = await state.ensureColorCycleLayerRuntime(aiLayer.id, { target: 'warm' });
  if (!ready) throw new Error('The AI multiplayer layer is not editable');

  const manager = getColorCycleBrushManager();
  const settingsBrush = manager.getSettingsPatchBrush(aiLayer.id);
  applyColorCycleBrushSettingsPatch(settingsBrush, brushSettingsPatch(settings));
  const beforeColorState = captureColorCycleBrushState(aiLayer.id);
  if (!beforeColorState) throw new Error('AI Color Cycle state could not be captured before the mark');

  const localAbortController = new AbortController();
  activeGestureAbortController = localAbortController;
  const detachExternalAbort = combineAbortSignals(localAbortController, externalSignal);
  const signal = localAbortController.signal;
  const pointsPerFrame = Math.max(1, Math.min(8, gesture.pointsPerFrame ?? 2));
  let authoredPointCount = 0;
  let hasAuthoredMark = false;
  let startedStroke = false;
  publish({ activeGestureId: gesture.gestureId, error: null });

  try {
    if (gesture.kind === 'stroke') {
      const lifecycle = manager.getStrokeLifecycleBrush(aiLayer.id);
      const drawBrush = manager.getDrawBrush(aiLayer.id);
      if (!lifecycle || !drawBrush) throw new Error('AI Color Cycle stroke runtime is unavailable');
      lifecycle.setLayerId?.(aiLayer.id);
      lifecycle.setActiveLayer?.(aiLayer.id);
      lifecycle.startStroke?.(aiLayer.id, false);
      startedStroke = true;
      for (let index = 0; index < gesture.points.length && !signal.aborted; index += 1) {
        const point = gesture.points[index];
        drawBrush.paint(point.x, point.y, aiLayer.id, point.pressure ?? 1);
        authoredPointCount += 1;
        hasAuthoredMark = true;
        publish({ aiCursor: { x: point.x, y: point.y, visible: true, drawing: true } });
        if ((index + 1) % pointsPerFrame === 0) {
          await presentAiLayer(runtime, aiLayer);
          await nextFrame(signal);
        }
      }
    } else {
      for (let index = 0; index < gesture.points.length && !signal.aborted; index += 1) {
        const point = gesture.points[index];
        authoredPointCount += 1;
        publish({ aiCursor: { x: point.x, y: point.y, visible: true, drawing: true } });
        if ((index + 1) % pointsPerFrame === 0) await nextFrame(signal);
      }
      if (!signal.aborted) {
        const fillBrush = manager.getFillBrush(aiLayer.id);
        if (!fillBrush?.fillShapeDispatch) throw new Error('AI Color Cycle shape runtime is unavailable');
        fillBrush.setLayerId?.(aiLayer.id);
        fillBrush.setActiveLayer?.(aiLayer.id);
        const directionStart = gesture.direction?.[0];
        const directionEnd = gesture.direction?.at(-1);
        await Promise.resolve(fillBrush.fillShapeDispatch({
          mode: gesture.direction ? 'linear' : 'concentric',
          vertices: gesture.points.map(({ x, y }) => ({ x, y })),
          layerId: aiLayer.id,
          ...(directionStart && directionEnd
            ? {
                direction: {
                  x: directionEnd.x - directionStart.x,
                  y: directionEnd.y - directionStart.y,
                },
              }
            : {}),
          options: {
            spacing: settings.colorCycleBandSpacingPx ?? settings.spacing ?? 12,
            continuous: true,
            ccGradient: true,
            ditherLevels: settings.gradientBands,
            ditherPixelSize: settings.fillResolution,
            ditherPaletteSpread: settings.ditherPaletteSpread,
            ditherPatternDiversity: settings.ditherPatternDiversity,
            ditherBackgroundFill: settings.ditherGradBgFill ?? settings.ditherBackgroundFill,
            lostEdge: settings.lostEdge,
          },
        }));
        fillBrush.endStroke(aiLayer.id);
        hasAuthoredMark = true;
      }
    }
  } finally {
    detachExternalAbort();
    if (startedStroke) manager.getStrokeLifecycleBrush(aiLayer.id)?.endStroke?.(aiLayer.id);
    try {
      if (hasAuthoredMark) {
        await commitAiMark({
          layer: aiLayer,
          settings,
          points: gesture.points.slice(0, authoredPointCount),
          beforeColorState,
          runtime,
          kind: gesture.kind,
        });
      }
    } finally {
      activeGestureAbortController = null;
      const lastPoint = gesture.points[Math.max(0, authoredPointCount - 1)];
      publish({
        activeGestureId: null,
        status: getVesselMultiplayerSnapshot().status === 'stopping'
          ? 'stopped'
          : getVesselMultiplayerSnapshot().status,
        aiCursor: lastPoint
          ? { x: lastPoint.x, y: lastPoint.y, visible: true, drawing: false }
          : snapshot.aiCursor,
      });
    }
  }
  return snapshot;
};

export const stopVesselMultiplayerSession = ({
  sessionId,
  reason = 'Stopped by Jason',
}: {
  sessionId: string;
  reason?: string;
}): VesselMultiplayerSnapshot => {
  if (snapshot.sessionId !== sessionId || snapshot.status === 'idle') {
    throw new Error(`Multiplayer session is not available: ${sessionId}`);
  }
  publish({
    status: snapshot.activeGestureId ? 'stopping' : 'stopped',
    stopReason: reason,
    aiCursor: snapshot.aiCursor ? { ...snapshot.aiCursor, drawing: false } : null,
  });
  activeGestureAbortController?.abort(reason);
  return snapshot;
};

export const failVesselMultiplayerSession = (error: unknown) => {
  activeGestureAbortController?.abort(error);
  publish({
    status: 'error',
    activeGestureId: null,
    error: error instanceof Error ? error.message : String(error),
  });
};

export const __resetVesselMultiplayerSessionForTests = () => {
  activeGestureAbortController?.abort('test reset');
  activeGestureAbortController = null;
  sessionBrushSettings = null;
  snapshot = INITIAL_SNAPSHOT;
  listeners.forEach((listener) => listener());
};
