import type { BrushStrokeParams } from '@/hooks/brushEngine/BrushEngineFacade';
import { runDrawBrushEntry } from '@/hooks/brushEngine/strokeDrawEntry';
import type { MaskManager } from '@/layers/MaskManager';
import { useAppStore } from '@/stores/useAppStore';
import { EraserTool } from '@/tools/EraserTool';
import { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { BrushShape, type Layer } from '@/types';

import {
  processBatchedStrokes,
  type ProcessBatchedStrokesArgs,
  type ProcessBatchedStrokesDeps,
} from '../strokeBatching';

const createHarness = (layerType: Layer['layerType']) => {
  const layer = { id: 'eraser-velocity', layerType } as Layer;
  const initialState = useAppStore.getState();
  const state = {
    ...initialState,
    activeLayerId: layer.id,
    layers: [layer],
    currentBrushPreset: null,
    tools: {
      ...initialState.tools,
      currentTool: 'eraser' as const,
      brushSettings: {
        ...initialState.tools.brushSettings,
        size: 8,
        brushShape: BrushShape.SQUARE,
        autoSampleGradient: false,
        autoSampleGradientRealtime: false,
      },
    },
  };
  const params: BrushStrokeParams[] = [];
  const ctx = document.createElement('canvas').getContext('2d')!;
  const mask = document.createElement('canvas');
  const source = new BrushStampSource({
    getState: () => state,
    brushRuntime: {
      drawBrush: (target, from, to, cursor = {}) => runDrawBrushEntry({
        ctx: target,
        from,
        to,
        cursor,
        beginStroke: jest.fn(),
        runStrokeDrawCore: ({ makeStrokeParams, rawPressure }) => {
          params.push(makeStrokeParams(rawPressure));
        },
      }),
      updateConfig: jest.fn(),
    },
    userBrushEngine: {
      isUserBrush: () => false,
      setActiveBrush: jest.fn(),
      startStroke: jest.fn(),
      continueStroke: jest.fn(),
      endStroke: jest.fn(),
    },
    resolveCustomBrush: () => undefined,
  });
  const tool = new EraserTool(layer, { opacity: 0.5 }, {
    overlayCtx: ctx,
    maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
    createStampSource: () => source,
    brushHalfSize: () => 4,
    getBrushSettings: () => ({
      size: 8,
      brushShape: BrushShape.SQUARE,
      pressureEnabled: false,
      minPressure: 100,
      maxPressure: 100,
    }),
  });
  const args: ProcessBatchedStrokesArgs = {
    strokeBatchRef: { current: [] },
    strokeBatchTimerRef: { current: null },
    drawingCtxRef: { current: ctx },
    lastDrawPosRef: { current: { x: 10, y: 10 } },
    lastDrawTimestampRef: { current: 1000 },
    brushSamplingPreviewActiveRef: { current: false },
    autoSamplePointsRef: { current: [] },
    ccSampledPointsRef: { current: [] },
    resamplerBrushDataRef: { current: undefined },
    stampCounterRef: { current: 0 },
    colorCyclePixelQueueRef: { current: null },
    colorCycleDistanceRef: { current: 0 },
    colorCycleLastPosRef: { current: null },
    colorCycleLastRotationRef: { current: undefined },
    ccFlowVelocityRef: { current: { smoothedPxPerMs: 0 } },
    eraserToolRef: { current: tool },
    eraserRoiRef: { current: null },
  };
  const deps: ProcessBatchedStrokesDeps = {
    storeRef: { current: state },
    project: { width: 64, height: 64 },
    brushRuntime: null,
    userBrushEngine: { isUserBrush: () => false, continueStroke: jest.fn() },
    drawEraserSegment: jest.fn(),
    updateAutoSampledGradient: jest.fn(),
    updateCcSampledGradient: jest.fn(),
    renderBrushSamplingPreview: jest.fn(),
    getCCStampTargetCtx: () => null,
    scheduleRecompose: jest.fn(),
    extendMaskHealingStroke: jest.fn(),
    createPixelQueue: jest.fn(),
    getColorCycleBrushManager: () => ({ getSurfaceBrush: () => null }),
    ensureActiveColorCycleGradientSlot: jest.fn(),
    resolveActiveCustomBrushData: () => undefined,
    getColorCycleBrushFlags: () => ({ isAny: false, isCustom: false }),
    selectEffectiveColorCyclePlaying: () => true,
    shouldPixelAlignBrush: () => false,
    alignPointToPixel: (point) => point,
    clipLineSegment: (from, to) => [from, to],
    shouldDrawStamp: () => true,
    shouldApplyGridSnapPure: () => false,
    calculateGridSpacing: () => 1,
    snapToGridPure: (x, y) => ({ x, y }),
    resolveBrushRotation: () => ({ rotation: 0, nextRotation: undefined }),
    captureBrushFromCanvas: () => null,
    isEraserV2: true,
  };
  tool.begin({ x: 10, y: 10 });
  params.length = 0;
  return { args, deps, tool, params };
};

describe('eraser velocity owner integration', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'preserves event timing through batching, %s strategy and brush draw entry',
    (layerType) => {
      for (const deltaMs of [200, 4]) {
        const { args, deps, tool, params } = createHarness(layerType);
        for (let i = 1; i <= 2; i++) {
          args.strokeBatchRef.current = [{
            pos: { x: 10 + 4 * i, y: 10 },
            pressure: i === 1 ? 0 : 0.75,
            timestampMs: 1000 + deltaMs * i,
          }];
          processBatchedStrokes(args, deps);
        }
        expect(params).toEqual([0, 0.75].map((pressure, i) => expect.objectContaining({
          from: { x: 10 + 4 * i, y: 10 },
          to: { x: 14 + 4 * i, y: 10 },
          pressure,
          velocity: 4 / deltaMs,
          timestamp: 1000 + deltaMs * (i + 1),
        })));
        expect(args.strokeBatchRef.current).toEqual([]);
        tool.end();
      }
    },
  );

  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'retains the distance/time fallback for legacy %s tool callers',
    (layerType) => {
      jest.spyOn(Date, 'now').mockReturnValue(4321);
      const { tool, params } = createHarness(layerType);
      tool.move({ x: 13, y: 14 }, 0.25, { x: 10, y: 10 });
      expect(params).toEqual([expect.objectContaining({ velocity: 5, timestamp: 4321, pressure: 0.25 })]);
      tool.end();
    },
  );

  it('preserves the supplied timestamp and falls back to distance without a prior timed point', () => {
    const { args, deps, tool, params } = createHarness('normal');
    args.lastDrawTimestampRef.current = null;
    args.strokeBatchRef.current = [{ pos: { x: 13, y: 14 }, pressure: 1, timestampMs: 1234 }];
    processBatchedStrokes(args, deps);
    expect(params).toEqual([expect.objectContaining({ velocity: 5, timestamp: 1234 })]);
    tool.end();
  });
});
