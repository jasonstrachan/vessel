import { runFinalizeColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/runFinalizeColorCycleBrush';
import { BrushShape, type BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import type { FinalizeColorCycleBrushBaseDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';

const createState = (layerType: 'sequential' | 'color-cycle'): AppState =>
  ({
    activeLayerId: 'layer-active',
    layers: [{ id: 'layer-active', layerType }],
    colorCyclePlayback: {
      desiredPlaying: false,
      suspendDepth: 0,
    },
    tools: {
      brushSettings: {
        autoSampleGradient: false,
        autoSampleGradientRealtime: false,
      },
    },
    setBrushSettings: jest.fn(),
    forceResumeColorCycle: jest.fn(),
  }) as unknown as AppState;

const createBaseDeps = () => {
  const endColorCycleStroke = jest.fn();
  const renderColorCycle = jest.fn();
  const deps: FinalizeColorCycleBrushBaseDeps = {
    storeRef: { current: createState('color-cycle') },
    brushEngine: {
      endColorCycleStroke,
      renderColorCycle,
      updateColorCycleGradient: jest.fn(),
    },
    drawingCanvasHasContent: { current: true },
    colorCycleAnimationRef: { current: null },
    brushSamplingPreviewActiveRef: { current: false },
    autoSamplePointsRef: { current: [] },
    autoSampleLastUpdateRef: { current: 0 },
    autoSampleLastAppliedHashRef: { current: '' },
    computeAutoSampleStops: jest.fn(() => null),
    clearBrushSamplingPreview: jest.fn(),
    getBrushForLayer: jest.fn(() => undefined),
    getEffectiveColorCyclePlaying: jest.fn(() => false),
    startPlaybackRef: { current: null },
  };
  return {
    deps,
    endColorCycleStroke,
    renderColorCycle,
  };
};

describe('runFinalizeColorCycleBrush', () => {
  const activeSettings = {
    brushShape: BrushShape.COLOR_CYCLE,
    autoSampleGradient: false,
    autoSampleGradientRealtime: false,
  } as BrushSettings;

  it('skips color-cycle finalize path for sequential layers', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d context unavailable');
    }

    const { deps, endColorCycleStroke, renderColorCycle } = createBaseDeps();
    deps.storeRef.current = createState('sequential');

    const result = await runFinalizeColorCycleBrush({
      activeSettings,
      currentState: createState('sequential'),
      drawingCanvas: canvas,
      drawingCtx: ctx,
      baseDeps: deps,
    });

    expect(result).toEqual({ shouldReturn: false });
    expect(endColorCycleStroke).not.toHaveBeenCalled();
    expect(renderColorCycle).not.toHaveBeenCalled();
  });

  it('executes color-cycle finalize path for color-cycle layers', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d context unavailable');
    }

    const { deps, endColorCycleStroke, renderColorCycle } = createBaseDeps();
    deps.storeRef.current = createState('color-cycle');

    const result = await runFinalizeColorCycleBrush({
      activeSettings,
      currentState: createState('color-cycle'),
      drawingCanvas: canvas,
      drawingCtx: ctx,
      baseDeps: deps,
    });

    expect(result).toEqual({ shouldReturn: false });
    expect(endColorCycleStroke).toHaveBeenCalledTimes(1);
    expect(renderColorCycle).toHaveBeenCalledTimes(1);
  });
});
