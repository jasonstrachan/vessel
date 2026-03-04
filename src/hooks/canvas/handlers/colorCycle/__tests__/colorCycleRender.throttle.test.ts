import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import {
  type ColorCycleBrush,
  renderAllColorCycleLayers,
  type ColorCycleRenderDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRender';

const makeLayer = (id: string): Layer =>
  ({
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    layerType: 'color-cycle',
    colorCycleData: {
      isAnimating: true,
      canvas: document.createElement('canvas'),
    },
  }) as Layer;

const makeDeps = (state: Partial<AppState>, brush: unknown): ColorCycleRenderDeps => {
  const storeRef = { current: state } as MutableRefObject<AppState>;
  return {
    storeRef,
    maskManager: { applyMaskToCanvas: jest.fn() },
    renderAllCCLogTSRef: { current: 0 },
    ccLog: jest.fn(),
    getColorCycleBrushManager: () => ({
      getBrush: () => brush as ColorCycleBrush,
    }),
    refreshLayerCCSurface: () => document.createElement('canvas'),
    bindBrushToCanvas: jest.fn(),
  };
};

describe('renderAllColorCycleLayers throttling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throttles non-active animating layers', () => {
    const layer = makeLayer('cc-non-active');
    const updateAnimation = jest.fn();
    const renderDirectToCanvas = jest.fn();
    const deps = makeDeps(
      { layers: [layer], activeLayerId: 'different-layer' } as unknown as AppState,
      { updateAnimation, renderDirectToCanvas }
    );

    const nowSpy = jest.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000);
    nowSpy.mockReturnValueOnce(1001);
    renderAllColorCycleLayers(deps);
    nowSpy.mockReturnValueOnce(1010);
    nowSpy.mockReturnValueOnce(1011);
    renderAllColorCycleLayers(deps);
    nowSpy.mockReturnValueOnce(1200);
    nowSpy.mockReturnValueOnce(1201);
    renderAllColorCycleLayers(deps);

    expect(updateAnimation).toHaveBeenCalledTimes(2);
    expect(renderDirectToCanvas).toHaveBeenCalledTimes(2);
  });

  it('does not throttle the active animating layer', () => {
    const layer = makeLayer('cc-active');
    const updateAnimation = jest.fn();
    const deps = makeDeps(
      { layers: [layer], activeLayerId: 'cc-active' } as unknown as AppState,
      { updateAnimation, renderDirectToCanvas: jest.fn() }
    );

    const nowSpy = jest.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(2000);
    renderAllColorCycleLayers(deps);
    nowSpy.mockReturnValueOnce(2010);
    renderAllColorCycleLayers(deps);

    expect(updateAnimation).toHaveBeenCalledTimes(2);
  });
});
