/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('@/stores/ccRuntime', () => ({
  __esModule: true,
  syncCCRuntimes: jest.fn(),
}));

import { createLayersSlice } from '@/stores/slices/layersSlice';

type MutableState = Record<string, any>;

const createTestStore = (overrides: MutableState = {}) => {
  let state: MutableState = {
    compositeSegments: [],
    layersNeedRecomposition: false,
    ...overrides,
  };

  const set = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...next };
    return state;
  };

  const get = () => state;

  const slice = (createLayersSlice as any)({
    syncPercentOffsetsFromPixels: (layers: any) => layers,
    trackLayerChanges: jest.fn(),
    colorCycleBrushManager: {} as any,
    captureLayerStructureSnapshot: jest.fn(),
    commitLayerStructureHistory: jest.fn(),
    getVesselWindow: () => undefined,
  })(set, get);

  state = { ...state, ...slice, ...overrides };

  return {
    ...slice,
    getState: () => state,
  };
};

describe('layers slice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
      window.requestAnimationFrame = (cb: FrameRequestCallback) => {
        return window.setTimeout(() => cb(Date.now()), 0);
      };
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases previous composite bitmap when replaced', () => {
    const store = createTestStore();
    const first = { close: jest.fn() } as unknown as ImageBitmap;
    const second = { close: jest.fn() } as unknown as ImageBitmap;

    store.setCurrentCompositeBitmap(first);
    store.setCurrentCompositeBitmap(second);

    expect(store.getState().currentCompositeBitmap).toBe(second);

    jest.advanceTimersByTime(200);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('marks static composite segments dirty when recomposition is needed', () => {
    const store = createTestStore({
      compositeSegments: [
        { kind: 'static', dirty: false, layerIds: ['a'] },
        { kind: 'color-cycle', layerIds: ['b'] },
      ],
    });

    store.setLayersNeedRecomposition(true);

    const segments = store.getState().compositeSegments;
    expect(segments[0].dirty).toBe(true);
  });
});
