/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('@/stores/ccRuntime', () => ({
  __esModule: true,
  syncCCRuntimes: jest.fn(),
}));

jest.mock('@/hooks/brushEngine/ccGradientApplyScheduler', () => ({
  __esModule: true,
  requestGradientApply: jest.fn(),
}));

jest.mock('@/utils/colorCycleSlotGC', () => ({
  __esModule: true,
  rebuildGradientSlotUsageAndGC: jest.fn(() => ({
    layers: [],
    removedSlotsByLayer: new Map(),
  })),
  buildDefaultReservedSlots: jest.fn(() => new Set()),
}));

import { createLayersSlice } from '@/stores/slices/layersSlice';
import { createSliceTestStore } from '@/stores/__tests__/sliceTestUtils';

const createTestStore = (overrides: Record<string, any> = {}) => {
  const { slice, getState } = createSliceTestStore(
    (set, get) =>
      (createLayersSlice as any)({
        syncPercentOffsetsFromPixels: (layers: any) => layers,
        trackLayerChanges: jest.fn(),
        colorCycleBrushManager: {} as any,
        captureLayerStructureSnapshot: jest.fn(),
        commitLayerStructureHistory: jest.fn(),
        getVesselWindow: () => undefined,
      })(set, get),
    {
      compositeSegments: [],
      layersNeedRecomposition: false,
      ...overrides,
    }
  );

  return {
    ...slice,
    getState,
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
