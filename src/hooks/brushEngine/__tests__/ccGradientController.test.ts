import { applyGradientEdit } from '../ccGradientController';

const requestGradientApply = jest.fn();
const getStateMock = jest.fn();

jest.mock('../ccGradientApplyScheduler', () => ({
  requestGradientApply: (...args: unknown[]) => requestGradientApply(...args),
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: (...args: unknown[]) => getStateMock(...args),
  },
}));

describe('ccGradientController', () => {
  const editedStops = [
    { position: 0, color: '#ff0000' },
    { position: 1, color: '#0000ff' },
  ];

  beforeEach(() => {
    requestGradientApply.mockClear();
    getStateMock.mockReset();
  });

  it('rebuilds def-bound recolor edits with dither runtime stops', () => {
    const updateLayer = jest.fn();
    const layer = {
      id: 'layer-1',
      layerType: 'color-cycle',
      colorCycleData: {
        paintSlot: 2,
        activeGradientId: 'g0',
        gradientDefs: [{ id: 'g0', currentSlot: 2 }],
        slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }] }],
        gradientDefStore: [{
          id: 7,
          kind: 'linear' as const,
          stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }],
          hash: 'old-hash',
          source: 'foreground' as const,
          slot: 2,
          createdAtMs: 1,
        }],
      },
    };
    const state = {
      activeLayerId: 'layer-1',
      layers: [layer],
      tools: {
        brushSettings: {
          ditherEnabled: true,
          gradientBands: 4,
          ditherPaletteSpread: 0,
        },
      },
      updateLayer,
    };
    getStateMock.mockReturnValue(state);

    applyGradientEdit({
      stops: editedStops,
      layerId: 'layer-1',
      intent: 'commitRecolor',
    });

    const colorCycleData = updateLayer.mock.calls[0]?.[1]?.colorCycleData;
    expect(colorCycleData.gradient).toEqual(editedStops);
    expect(colorCycleData.slotPalettes[0].slot).toBe(2);
    expect(colorCycleData.slotPalettes[0].stops).toHaveLength(6);
    expect(colorCycleData.gradientDefStore[0].stops).toEqual(colorCycleData.slotPalettes[0].stops);
    expect(colorCycleData.gradientDefStore[0].hash).not.toBe('old-hash');
    expect(requestGradientApply).toHaveBeenCalledWith('layer-1', 'commit-recolor');
  });

  it('keeps raw stops for recolor edits when no def is bound to the slot', () => {
    const updateLayer = jest.fn();
    const layer = {
      id: 'layer-2',
      layerType: 'color-cycle',
      colorCycleData: {
        paintSlot: 3,
        activeGradientId: 'g0',
        gradientDefs: [{ id: 'g0', currentSlot: 3 }],
        slotPalettes: [{ slot: 3, stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }] }],
        gradientDefStore: [],
      },
    };
    const state = {
      activeLayerId: 'layer-2',
      layers: [layer],
      tools: {
        brushSettings: {
          ditherEnabled: true,
          gradientBands: 4,
          ditherPaletteSpread: 0,
        },
      },
      updateLayer,
    };
    getStateMock.mockReturnValue(state);

    applyGradientEdit({
      stops: editedStops,
      layerId: 'layer-2',
      intent: 'commitRecolor',
    });

    const colorCycleData = updateLayer.mock.calls[0]?.[1]?.colorCycleData;
    expect(colorCycleData.slotPalettes[0].stops).toEqual(editedStops);
    expect(colorCycleData.gradientDefStore).toEqual([]);
  });
});
