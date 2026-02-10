import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import type { Layer, BrushSettings } from '@/types';
import { BrushShape } from '@/types';
import { updateContinuousResamplerSample } from '@/hooks/canvas/handlers/customBrushCapture';
import { getCcEffectiveSpacing } from '@/hooks/canvas/utils/ccSpacing';
import {
  captureSequentialStampsForActiveLayer,
  createFallbackSequentialStamp,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';

type BrushEngine = {
  drawBrush: (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: { pressure: number; customBrushData?: CustomBrushStrokeData }
  ) => void;
  consumeRecentStamps?: () => Array<{
    x: number;
    y: number;
    pressure: number;
    rotation: number;
    size: number;
    alpha: number;
  }>;
  drawColorCycle: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number,
    rotation: number,
    options?: { customStamp?: CustomBrushStrokeData }
  ) => void;
};

type UserBrushEngine = {
  isUserBrush: (brushId: string) => boolean;
  continueStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number) => void;
};

export type StrokeBatchPoint = { pos: { x: number; y: number }; pressure: number };

export type ProcessBatchedStrokesArgs = {
  strokeBatchRef: React.MutableRefObject<StrokeBatchPoint[]>;
  strokeBatchTimerRef: React.MutableRefObject<number | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  lastDrawPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  stampCounterRef: React.MutableRefObject<number>;
  colorCyclePixelQueueRef: React.MutableRefObject<PixelQueue | null>;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  eraserToolRef: React.MutableRefObject<{
    move: (to: { x: number; y: number }, pressure: number, from: { x: number; y: number }) => void;
    getROI: () => { x: number; y: number; width: number; height: number } | null;
  } | null>;
  eraserRoiRef: React.MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
};

export type ProcessBatchedStrokesDeps = {
  storeRef: React.MutableRefObject<AppState>;
  project: { width: number; height: number } | null;
  brushEngine: BrushEngine | null;
  userBrushEngine: UserBrushEngine;
  drawEraserSegment: (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => void;
  updateAutoSampledGradient: (points: Array<{ x: number; y: number }>) => void;
  updateCcSampledGradient: (
    points: Array<{ x: number; y: number }>,
    options?: { layerId?: string | null; markKind?: 'stroke' | 'shape' }
  ) => void;
  renderBrushSamplingPreview: (points: Array<{ x: number; y: number }>) => void;
  getCCStampTargetCtx: () => CanvasRenderingContext2D | null;
  scheduleRecompose: (roi?: { x: number; y: number; width: number; height: number }) => void;
  extendMaskHealingStroke: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number
  ) => void;
  createPixelQueue: () => PixelQueue;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: Layer,
    brush?: ColorCycleBrushImplementation | null
  ) => void;
  resolveActiveCustomBrushData: (state: AppState) => CustomBrushStrokeData | undefined;
  getColorCycleBrushFlags: (settings: BrushSettings) => { isAny: boolean; isCustom: boolean };
  selectEffectiveColorCyclePlaying: (state: AppState) => boolean;
  shouldPixelAlignBrush: (settings: BrushSettings) => boolean;
  alignPointToPixel: (
    point: { x: number; y: number },
    shouldAlign: boolean
  ) => { x: number; y: number };
  clipLineSegment: (
    start: { x: number; y: number },
    end: { x: number; y: number },
    bounds: { x: number; y: number; width: number; height: number }
  ) => [{ x: number; y: number }, { x: number; y: number }] | null;
  shouldDrawStamp: (
    settings: BrushSettings,
    queue: PixelQueue,
    size?: number,
    isGridSnapping?: boolean
  ) => boolean;
  shouldApplyGridSnapPure: (settings: BrushSettings) => boolean;
  calculateGridSpacing: () => number;
  snapToGridPure: (x: number, y: number, gridSpacing: number) => { x: number; y: number };
  resolveBrushRotation: (
    rotationEnabled: boolean,
    dx: number,
    dy: number,
    distance: number,
    lastRotation?: number
  ) => { rotation: number; nextRotation: number | undefined };
  captureBrushFromCanvas: (
    canvas: HTMLCanvasElement,
    rect: { x: number; y: number; width: number; height: number },
    options?: { generateThumbnail: boolean }
  ) => { imageData: ImageData; width: number; height: number } | null;
  isEraserV2: boolean;
};

export const resetColorCyclePixelQueue = (
  colorCyclePixelQueueRef: React.MutableRefObject<PixelQueue | null>,
  deps: { createPixelQueue: () => PixelQueue }
): void => {
  try {
    colorCyclePixelQueueRef.current?.flushNow();
  } catch {}
  colorCyclePixelQueueRef.current = deps.createPixelQueue();
  try {
    colorCyclePixelQueueRef.current?.flushNow();
  } catch {}
};

export const processBatchedStrokes = (
  args: ProcessBatchedStrokesArgs,
  deps: ProcessBatchedStrokesDeps
): void => {
  const batch = args.strokeBatchRef.current;
  if (batch.length === 0) return;

  const currentState = deps.storeRef.current;
  const currentTool = currentState.tools.currentTool;
  const currentBrushId = currentState.currentBrushPreset?.id;
  const drawCtx = args.drawingCtxRef.current;

  const brushSettings = currentState.tools.brushSettings;
  const alignPixelStrokes = deps.shouldPixelAlignBrush(brushSettings);
  const brushSize = brushSettings.size || 1;
  const doSnap = deps.shouldApplyGridSnapPure(brushSettings);
  const gridSpacing = doSnap ? deps.calculateGridSpacing() : 0;
  const paused = !deps.selectEffectiveColorCyclePlaying(currentState);

  if (!drawCtx || !deps.project) {
    args.strokeBatchRef.current = [];
    return;
  }

  const boundary = { x: 0, y: 0, width: deps.project.width, height: deps.project.height };
  const ccProcessFlags = deps.getColorCycleBrushFlags(currentState.tools.brushSettings);
  const shouldAlignStroke = alignPixelStrokes && !ccProcessFlags.isAny;
  const captureSequentialStamps = (
    stamps: Array<{
      x: number;
      y: number;
      pressure: number;
      rotation: number;
      size: number;
      alpha: number;
    }>,
    customBrushData?: CustomBrushStrokeData,
    pluginBrushId?: string | null
  ) => {
    if (stamps.length === 0) {
      return;
    }
    const captureState = useAppStore.getState();
    captureSequentialStampsForActiveLayer({
      state: captureState,
      stamps,
      customBrushData,
      pluginBrushId,
    });
  };

  for (let i = 0; i < batch.length; i++) {
    const { pos: worldPos, pressure } = batch[i];
    const shouldAutoSample =
      ccProcessFlags.isAny &&
      (currentState.tools.brushSettings.autoSampleGradient ||
        currentState.tools.brushSettings.autoSampleGradientRealtime);
    if (shouldAutoSample) {
      args.autoSamplePointsRef.current.push(worldPos);
      if (args.autoSamplePointsRef.current.length > 5000) {
        args.autoSamplePointsRef.current.splice(0, args.autoSamplePointsRef.current.length - 5000);
      }
      if (!args.brushSamplingPreviewActiveRef.current) {
        deps.updateAutoSampledGradient(args.autoSamplePointsRef.current);
      } else {
        deps.renderBrushSamplingPreview(args.autoSamplePointsRef.current);
      }
    }
    const shouldSampled =
      ccProcessFlags.isAny &&
      currentState.tools.ccGradientSource === 'sampled';
    if (shouldSampled) {
      args.ccSampledPointsRef.current.push(worldPos);
      if (args.ccSampledPointsRef.current.length > 5000) {
        args.ccSampledPointsRef.current.splice(0, args.ccSampledPointsRef.current.length - 5000);
      }
      deps.updateCcSampledGradient(args.ccSampledPointsRef.current, { markKind: 'stroke' });
    }
    const lastPoint = args.lastDrawPosRef.current;

    if (!lastPoint) {
      args.lastDrawPosRef.current = worldPos;
      continue;
    }

    if (args.brushSamplingPreviewActiveRef.current) {
      args.lastDrawPosRef.current = worldPos;
      continue;
    }

    const clippedSegment = deps.clipLineSegment(lastPoint, worldPos, boundary);

    if (clippedSegment) {
      const [clippedStart, clippedEnd] = clippedSegment;
      const drawFrom = deps.alignPointToPixel(clippedStart, shouldAlignStroke);
      const drawTo = deps.alignPointToPixel(clippedEnd, shouldAlignStroke);

      if (currentTool === 'eraser') {
        if (deps.isEraserV2) {
          const eraserTool = args.eraserToolRef.current;
          if (eraserTool) {
            eraserTool.move(drawTo, pressure, drawFrom);
            const roi = eraserTool.getROI();
            args.eraserRoiRef.current = roi;
            if (roi) {
              const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              if (activeLayer?.layerType === 'color-cycle') {
                deps.scheduleRecompose(roi);
              }
            }
          }
        } else {
          const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
          const canMirrorBrush = !ccProcessFlags.isAny;
          drawCtx.save();
          try {
            drawCtx.globalCompositeOperation = 'destination-out';
            if (canMirrorBrush) {
              drawCtx.globalAlpha = eraserOpacity;
              if (currentBrushId && deps.userBrushEngine.isUserBrush(currentBrushId)) {
                deps.userBrushEngine.continueStroke(drawCtx, drawTo.x, drawTo.y, pressure);
              } else if (deps.brushEngine) {
                const customBrushData: CustomBrushStrokeData | undefined =
                  deps.resolveActiveCustomBrushData(currentState);
                deps.brushEngine.drawBrush(drawCtx, drawFrom, drawTo, { pressure, customBrushData });
              } else {
                drawCtx.globalAlpha = 1;
                deps.drawEraserSegment(drawCtx, drawFrom, drawTo);
              }
            } else {
              drawCtx.globalAlpha = 1;
              deps.drawEraserSegment(drawCtx, drawFrom, drawTo);
            }
          } finally {
            drawCtx.restore();
          }
        }
      } else {
        if (currentBrushId && deps.userBrushEngine.isUserBrush(currentBrushId)) {
          deps.userBrushEngine.continueStroke(drawCtx, drawTo.x, drawTo.y, pressure);
          const customBrushData = deps.resolveActiveCustomBrushData(currentState);
          captureSequentialStamps([
            createFallbackSequentialStamp(drawTo, pressure, currentState.tools.brushSettings),
          ], customBrushData, currentBrushId);
        } else if (deps.brushEngine) {
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';

          let customBrushData: CustomBrushStrokeData | undefined =
            deps.resolveActiveCustomBrushData(currentState);
          const isCustomBrushShape = currentState.tools.brushSettings.brushShape === BrushShape.CUSTOM;
          if (!customBrushData && isCustomBrushShape) {
            customBrushData = args.resamplerBrushDataRef.current;
          }
          if (customBrushData && isCustomBrushShape) {
            args.resamplerBrushDataRef.current = customBrushData;
          }

          if (ccProcessFlags.isAny) {
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
            const isSequentialLayer = activeLayer?.layerType === 'sequential';

            if (!isColorCycleLayer && !isSequentialLayer && activeLayer?.layerType) {
              continue;
            }

            const targetCtx = isColorCycleLayer ? deps.getCCStampTargetCtx() : drawCtx;
            const layerCanvas = activeLayer?.colorCycleData?.canvas ?? null;
            if (
              !targetCtx ||
              (isColorCycleLayer && targetCtx.canvas !== layerCanvas)
            ) {
              args.colorCycleLastPosRef.current = clippedEnd;
              continue;
            }
            if (activeLayer && deps.isEraserV2 && isColorCycleLayer) {
              deps.extendMaskHealingStroke(drawFrom, drawTo, pressure);
            }
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.globalAlpha = 1;

            if (activeLayer && isColorCycleLayer) {
              const colorCycleBrushManager = deps.getColorCycleBrushManager();
              const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayer.id);
              deps.ensureActiveColorCycleGradientSlot(currentState, activeLayer, colorCycleBrush);
            }

            const usingCustomStamp = ccProcessFlags.isCustom;
            const stampData = usingCustomStamp
              ? customBrushData ?? args.resamplerBrushDataRef.current
              : undefined;

            if (usingCustomStamp && !stampData) {
              continue;
            }
            if (usingCustomStamp && stampData) {
              args.resamplerBrushDataRef.current = stampData;
            }
            const effectiveSpacing = getCcEffectiveSpacing(currentState);
            const spacingScreenPx = paused
              ? Math.max(1, Math.round(effectiveSpacing * 1.25))
              : effectiveSpacing;
            const rotationEnabled = !!brushSettings.rotationEnabled;
            const pixelQueue = args.colorCyclePixelQueueRef.current ?? (() => {
              const queue = deps.createPixelQueue();
              args.colorCyclePixelQueueRef.current = queue;
              return queue;
            })();
            const stampCmds: Array<{
              x: number;
              y: number;
              pressure: number;
              rotation: number;
              customStamp?: CustomBrushStrokeData;
            }> = [];
            const MAX_STAMPS_PER_BATCH = 128;

            const previousPos = args.colorCycleLastPosRef.current;
            if (previousPos) {
              const dx = clippedEnd.x - previousPos.x;
              const dy = clippedEnd.y - previousPos.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              args.colorCycleDistanceRef.current += distance;
              const { rotation, nextRotation } = deps.resolveBrushRotation(
                rotationEnabled,
                dx,
                dy,
                distance,
                args.colorCycleLastRotationRef.current
              );
              args.colorCycleLastRotationRef.current = nextRotation;

              let enqueuedStamps = false;
              let roiMinX = Number.POSITIVE_INFINITY;
              let roiMinY = Number.POSITIVE_INFINITY;
              let roiMaxX = Number.NEGATIVE_INFINITY;
              let roiMaxY = Number.NEGATIVE_INFINITY;

              while (distance > 0 && args.colorCycleDistanceRef.current >= spacingScreenPx) {
                const t = 1 - (args.colorCycleDistanceRef.current - spacingScreenPx) / distance;
                let stampX = previousPos.x + dx * t;
                let stampY = previousPos.y + dy * t;

                if (doSnap) {
                  const snapped = deps.snapToGridPure(stampX, stampY, gridSpacing);
                  stampX = snapped.x;
                  stampY = snapped.y;
                }

                const dashAllows = deps.shouldDrawStamp(brushSettings, pixelQueue, brushSize);
                const allowStamp = dashAllows;

                if (allowStamp) {
                  const sx = stampX;
                  const sy = stampY;
                  const sRotation = rotation;
                  const sPressure = pressure;
                  stampCmds.push({
                    x: sx,
                    y: sy,
                    pressure: sPressure,
                    rotation: sRotation,
                    customStamp: usingCustomStamp ? stampData : undefined
                  });

                  enqueuedStamps = true;
                  roiMinX = Math.min(roiMinX, sx);
                  roiMinY = Math.min(roiMinY, sy);
                  roiMaxX = Math.max(roiMaxX, sx);
                  roiMaxY = Math.max(roiMaxY, sy);
                }

                args.colorCycleDistanceRef.current -= spacingScreenPx;
                if (stampCmds.length >= MAX_STAMPS_PER_BATCH) {
                  break;
                }
              }

              if (stampCmds.length) {
                const ctx = targetCtx;
                const cmds = stampCmds.splice(0, stampCmds.length);
                pixelQueue.enqueue(() => {
                  for (let i = 0; i < cmds.length; i++) {
                    const c = cmds[i];
                    if (c.customStamp) {
                      deps.brushEngine?.drawColorCycle(
                        ctx,
                        c.x,
                        c.y,
                        c.pressure,
                        c.rotation,
                        { customStamp: c.customStamp }
                      );
                    } else if (rotationEnabled && c.rotation !== 0) {
                      deps.brushEngine?.drawColorCycle(ctx, c.x, c.y, c.pressure, c.rotation);
                    } else {
                      deps.brushEngine?.drawColorCycle(ctx, c.x, c.y, c.pressure, 0);
                    }
                  }
                });
                if (isSequentialLayer) {
                  captureSequentialStamps(
                    cmds.map((stamp) => ({
                      x: stamp.x,
                      y: stamp.y,
                      pressure: stamp.pressure,
                      rotation: stamp.rotation,
                      size: brushSize,
                      alpha: currentState.tools.brushSettings.opacity ?? 1,
                    })),
                    stampData
                  );
                }
              }

              if (isColorCycleLayer && paused && enqueuedStamps) {
                const pad = Math.ceil(brushSize / 2) + 2;
                const minX = Math.floor(Math.min(roiMinX, previousPos.x, clippedEnd.x) - pad);
                const minY = Math.floor(Math.min(roiMinY, previousPos.y, clippedEnd.y) - pad);
                const maxX = Math.ceil(Math.max(roiMaxX, previousPos.x, clippedEnd.x) + pad);
                const maxY = Math.ceil(Math.max(roiMaxY, previousPos.y, clippedEnd.y) + pad);
                const width = Math.max(0, maxX - minX);
                const height = Math.max(0, maxY - minY);
                if (width > 0 && height > 0) {
                  if (typeof pixelQueue.addDirtyRect === 'function') {
                    pixelQueue.addDirtyRect(minX, minY, width, height);
                  } else {
                    deps.scheduleRecompose({ x: minX, y: minY, width, height });
                  }
                }
              }
            } else {
              args.colorCycleLastRotationRef.current = rotationEnabled ? 0 : undefined;
            }

            args.colorCycleLastPosRef.current = clippedEnd;
            continue;
          } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
            if (currentState.tools.brushSettings.continuousSampling) {
              const resamplerData = updateContinuousResamplerSample({
                samplePos: clippedEnd,
                brushSize: currentState.tools.brushSettings.size || 20,
                compositeCanvas: currentState.currentOffscreenCanvas ?? null,
                resamplerBrushDataRef: args.resamplerBrushDataRef,
                stampCounterRef: args.stampCounterRef,
                resampleInterval: currentState.tools.brushSettings.resampleInterval || 5,
              }, {
                captureBrushFromCanvas: deps.captureBrushFromCanvas,
              });
              if (resamplerData) {
                customBrushData = resamplerData;
              }
            } else if (args.resamplerBrushDataRef.current) {
              customBrushData = args.resamplerBrushDataRef.current;
            }
          }

          if (typeof deps.brushEngine.consumeRecentStamps === 'function') {
            deps.brushEngine.consumeRecentStamps();
          }
          deps.brushEngine.drawBrush(drawCtx, drawFrom, drawTo, { pressure, customBrushData });
          const emittedStamps =
            typeof deps.brushEngine.consumeRecentStamps === 'function'
              ? deps.brushEngine.consumeRecentStamps()
              : [];
          captureSequentialStamps(
            emittedStamps.length > 0
              ? emittedStamps
              : [createFallbackSequentialStamp(drawTo, pressure, currentState.tools.brushSettings)],
            customBrushData
          );
        }
      }
    }

    args.lastDrawPosRef.current = worldPos;
  }

  args.strokeBatchRef.current = [];
  args.strokeBatchTimerRef.current = null;
};

export type ProcessBatchedStrokesDispatcher = () => void;

export const createProcessBatchedStrokesDispatcher = (
  args: ProcessBatchedStrokesArgs,
  deps: ProcessBatchedStrokesDeps
): ProcessBatchedStrokesDispatcher => () => {
  processBatchedStrokes(args, deps);
};
