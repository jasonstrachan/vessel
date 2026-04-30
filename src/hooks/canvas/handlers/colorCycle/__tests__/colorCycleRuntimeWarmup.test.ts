import { startColorCycleRuntimeWarmupForEdit } from '@/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup';

const mockState = {
  layers: [] as Array<Record<string, unknown>>,
  getLayerColorCycleBrush: jest.fn(),
  ensureColorCycleLayerRuntime: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: () => mockState,
  },
}));

describe('startColorCycleRuntimeWarmupForEdit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockState.layers = [];
    mockState.getLayerColorCycleBrush.mockReset();
    mockState.ensureColorCycleLayerRuntime.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('blocks edits, hydrates cold color-cycle layers, and reports warming progress', async () => {
    const feedback = jest.fn();
    let resolveWarmup!: (ok: boolean) => void;
    mockState.layers = [
      {
        id: 'layer-cold',
        layerType: 'color-cycle',
        state: {
          hasContent: true,
          paintRef: 'state/paint.bin',
          gradientIdRef: 'state/gradient-id.bin',
          gradientDefIdRef: 'state/gradient-def-id.bin',
        },
        colorCycleData: {
          runtimeHydrationState: 'cold',
          deferredRuntimeRestore: false,
        },
      },
    ];
    mockState.getLayerColorCycleBrush.mockReturnValueOnce(null).mockReturnValue({});
    mockState.ensureColorCycleLayerRuntime.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveWarmup = resolve;
    }));

    const blocked = startColorCycleRuntimeWarmupForEdit({
      layerId: 'layer-cold',
      reason: 'shape-start',
      feedback,
    });

    expect(blocked).toBe(true);
    expect(mockState.ensureColorCycleLayerRuntime).toHaveBeenCalledWith('layer-cold', { target: 'active' });
    expect(feedback).toHaveBeenCalledWith('Preparing color-cycle layer... 0%');

    jest.advanceTimersByTime(120);
    expect(feedback).toHaveBeenCalledWith('Preparing color-cycle layer... 56%');

    resolveWarmup(true);
    await Promise.resolve();

    expect(feedback).toHaveBeenCalledWith('Color-cycle layer ready');
  });

  it('blocks preview-only color-cycle layers without trying runtime restore', () => {
    const feedback = jest.fn();
    mockState.layers = [
      {
        id: 'layer-preview-only',
        layerType: 'color-cycle',
        colorCycleData: {
          runtimeHydrationState: 'cold',
          deferredRuntimeRestore: false,
        },
      },
    ];
    mockState.getLayerColorCycleBrush.mockReturnValue(null);

    const blocked = startColorCycleRuntimeWarmupForEdit({
      layerId: 'layer-preview-only',
      reason: 'stroke-start',
      feedback,
    });

    expect(blocked).toBe(true);
    expect(mockState.ensureColorCycleLayerRuntime).not.toHaveBeenCalled();
    expect(feedback).toHaveBeenCalledWith('This color-cycle layer is preview-only and cannot be edited');
  });
});
