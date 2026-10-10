import { runStrokeStartLayerGuards } from '@/hooks/canvas/handlers/strokeStartLayerGuards';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (layerType: Layer['layerType']): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return {
    id: `layer-${layerType}`,
    name: layerType,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType,
    colorCycleData:
      layerType === 'color-cycle'
        ? {
            isAnimating: false,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          }
        : undefined,
    sequentialData:
      layerType === 'sequential'
        ? {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [],
          }
        : undefined,
  };
};

describe('runStrokeStartLayerGuards', () => {
  it.each([
    ['normal', 'brush', false],
    ['normal', 'eraser', false],
    ['normal', 'eraser', true],
    ['color-cycle', 'brush', true],
    ['color-cycle', 'eraser', false],
    ['color-cycle', 'eraser', true],
    ['sequential', 'brush', true],
    ['sequential', 'eraser', false],
    ['sequential', 'eraser', true],
  ] as const)('blocks %s layer %s strokes while locked with CC preset %s', (layerType, currentTool, isAnyColorCycleBrush) => {
    const feedback = jest.fn();
    const initColorCycleForLayer = jest.fn();
    const getColorCycleBrushManager = jest.fn(() => ({ getSurfaceBrush: () => null }));
    const ensureActiveColorCycleGradientSlot = jest.fn();
    const allowed = runStrokeStartLayerGuards({
      activeLayer: { ...createLayer(layerType), locked: true },
      currentTool,
      isAnyColorCycleBrush,
      runtimeProject: { width: 64, height: 64 },
      currentState: { ...useAppStore.getState(), initColorCycleForLayer },
      feedbackMessageRef: { current: feedback },
      logError: jest.fn(),
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
    });

    expect(allowed).toBe(false);
    expect(feedback).toHaveBeenCalledWith("Can't draw on a locked layer. Unlock it to edit.");
    expect(initColorCycleForLayer).not.toHaveBeenCalled();
    expect(getColorCycleBrushManager).not.toHaveBeenCalled();
    expect(ensureActiveColorCycleGradientSlot).not.toHaveBeenCalled();
  });

  it.each([
    ['normal', false],
    ['normal', true],
    ['color-cycle', false],
    ['color-cycle', true],
    ['sequential', false],
    ['sequential', true],
  ] as const)(
    'allows erasing an unlocked %s layer with CC preset %s',
    (layerType, isAnyColorCycleBrush) => {
      const feedback = jest.fn();
      const getColorCycleBrushManager = jest.fn(() => ({ getSurfaceBrush: () => null }));
      const ensureActiveColorCycleGradientSlot = jest.fn();
      const allowed = runStrokeStartLayerGuards({
        activeLayer: createLayer(layerType),
        currentTool: 'eraser',
        isAnyColorCycleBrush,
        runtimeProject: { width: 64, height: 64 },
        currentState: useAppStore.getState(),
        feedbackMessageRef: { current: feedback },
        logError: jest.fn(),
        getColorCycleBrushManager,
        ensureActiveColorCycleGradientSlot,
      });

      expect(allowed).toBe(true);
      expect(feedback).not.toHaveBeenCalled();
      expect(getColorCycleBrushManager).not.toHaveBeenCalled();
      expect(ensureActiveColorCycleGradientSlot).not.toHaveBeenCalled();
    },
  );

  it('still blocks regular brushes on unlocked Color Cycle layers', () => {
    const feedback = jest.fn();
    const allowed = runStrokeStartLayerGuards({
      activeLayer: createLayer('color-cycle'),
      currentTool: 'brush',
      isAnyColorCycleBrush: false,
      runtimeProject: { width: 64, height: 64 },
      currentState: useAppStore.getState(),
      feedbackMessageRef: { current: feedback },
      logError: jest.fn(),
      getColorCycleBrushManager: () => ({ getSurfaceBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
    });

    expect(allowed).toBe(false);
    expect(feedback).toHaveBeenCalledWith("Can't use regular brushes on a Color Cycle layer. Switch layers.");
  });

  it('blocks drawing on adjustment layers', () => {
    const feedback = jest.fn();
    const allowed = runStrokeStartLayerGuards({
      activeLayer: createLayer('adjustment'),
      currentTool: 'brush',
      isAnyColorCycleBrush: false,
      runtimeProject: { width: 64, height: 64 },
      currentState: useAppStore.getState(),
      feedbackMessageRef: { current: feedback },
      logError: jest.fn(),
      getColorCycleBrushManager: () => ({ getSurfaceBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
    });

    expect(allowed).toBe(false);
    expect(feedback).toHaveBeenCalledWith(
      "Can't draw on an Adjustment layer. Switch to a paint layer.",
    );
  });

  it('allows Color Cycle brushes on sequential layers', () => {
    const feedback = jest.fn();
    const allowed = runStrokeStartLayerGuards(
      {
        activeLayer: createLayer('sequential'),
        currentTool: 'brush',
        isAnyColorCycleBrush: true,
        runtimeProject: { width: 64, height: 64 },
        currentState: useAppStore.getState(),
        feedbackMessageRef: { current: feedback },
        logError: jest.fn(),
        getColorCycleBrushManager: () => ({ getSurfaceBrush: () => null }),
        ensureActiveColorCycleGradientSlot: jest.fn(),
      }
    );

    expect(allowed).toBe(true);
    expect(feedback).not.toHaveBeenCalled();
  });

  it('still blocks Color Cycle brushes on normal layers', () => {
    const feedback = jest.fn();
    const allowed = runStrokeStartLayerGuards(
      {
        activeLayer: createLayer('normal'),
        currentTool: 'brush',
        isAnyColorCycleBrush: true,
        runtimeProject: { width: 64, height: 64 },
        currentState: useAppStore.getState(),
        feedbackMessageRef: { current: feedback },
        logError: jest.fn(),
        getColorCycleBrushManager: () => ({ getSurfaceBrush: () => null }),
        ensureActiveColorCycleGradientSlot: jest.fn(),
      }
    );

    expect(allowed).toBe(false);
    expect(feedback).toHaveBeenCalledWith(
      "Can't use Color Cycle brush on this layer. Switch to a sequential or Color Cycle layer."
    );
  });

  it('primes gradient runtime at stroke start when CC stamp dithering is enabled', () => {
    const feedback = jest.fn();
    const requestGradientApply = jest.spyOn(
      jest.requireActual('@/hooks/brushEngine/ccGradientApplyScheduler'),
      'requestGradientApply'
    );
    const flushGradientApply = jest.spyOn(
      jest.requireActual('@/hooks/brushEngine/ccGradientApplyScheduler'),
      'flushGradientApply'
    );
    const state = useAppStore.getState();
    useAppStore.setState({
      ...state,
      layers: [createLayer('color-cycle')],
      activeLayerId: 'layer-color-cycle',
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleStampDitherEnabled: true,
        },
      },
    });
    const currentState = {
      ...useAppStore.getState(),
      initColorCycleForLayer: jest.fn(),
    } as typeof state;

    const allowed = runStrokeStartLayerGuards({
      activeLayer: createLayer('color-cycle'),
      currentTool: 'brush',
      isAnyColorCycleBrush: true,
      runtimeProject: { width: 64, height: 64 },
      currentState,
      feedbackMessageRef: { current: feedback },
      logError: jest.fn(),
      getColorCycleBrushManager: () => ({ getSurfaceBrush: () => ({}) as never }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
    });

    expect(allowed).toBe(true);
    expect(requestGradientApply).toHaveBeenCalledWith('layer-color-cycle', 'mark-session-start');
    expect(flushGradientApply).toHaveBeenCalledWith('layer-color-cycle');

    requestGradientApply.mockRestore();
    flushGradientApply.mockRestore();
  });
});
