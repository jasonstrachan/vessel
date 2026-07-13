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
      getSurfaceBrush: () => brush as ColorCycleBrush,
    }),
    refreshLayerCCSurface: () => document.createElement('canvas'),
    bindBrushToCanvas: jest.fn(),
  };
};

describe('renderAllColorCycleLayers presentation ownership', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('discovers non-active layers without advancing, rendering, or presenting them', () => {
    const layer = makeLayer('cc-non-active');
    const updateAnimation = jest.fn();
    const renderDirectToCanvas = jest.fn();
    const presentCurrentFrameToCanvas = jest.fn();
    const deps = makeDeps(
      { layers: [layer], activeLayerId: 'different-layer' } as unknown as AppState,
      { updateAnimation, renderDirectToCanvas, presentCurrentFrameToCanvas }
    );

    renderAllColorCycleLayers(deps);
    renderAllColorCycleLayers(deps);

    expect(presentCurrentFrameToCanvas).not.toHaveBeenCalled();
    expect(updateAnimation).not.toHaveBeenCalled();
    expect(renderDirectToCanvas).not.toHaveBeenCalled();
  });

  it('leaves active-layer advancement and presentation to their owning runtimes', () => {
    const layer = makeLayer('cc-active');
    const updateAnimation = jest.fn();
    const presentCurrentFrameToCanvas = jest.fn();
    const deps = makeDeps(
      { layers: [layer], activeLayerId: 'cc-active' } as unknown as AppState,
      { updateAnimation, presentCurrentFrameToCanvas }
    );

    renderAllColorCycleLayers(deps);
    renderAllColorCycleLayers(deps);

    expect(presentCurrentFrameToCanvas).not.toHaveBeenCalled();
    expect(updateAnimation).not.toHaveBeenCalled();
  });

  it('composites current layer surfaces into an explicit target without invoking brush rendering', () => {
    const firstLayer = makeLayer('cc-first');
    const secondLayer = makeLayer('cc-second');
    const firstCanvas = firstLayer.colorCycleData!.canvas!;
    const secondCanvas = secondLayer.colorCycleData!.canvas!;
    const targetCanvas = document.createElement('canvas');
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) throw new Error('Missing test canvas context');
    const compositeDraw = jest.spyOn(targetCtx, 'drawImage');
    const updateAnimation = jest.fn();
    const renderDirectToCanvas = jest.fn();
    const presentCurrentFrameToCanvas = jest.fn();
    const deps = makeDeps(
      {
        layers: [firstLayer, secondLayer],
        activeLayerId: secondLayer.id,
      } as unknown as AppState,
      { updateAnimation, renderDirectToCanvas, presentCurrentFrameToCanvas },
    );
    deps.refreshLayerCCSurface = (_brush, layerId) => (
      layerId === firstLayer.id ? firstCanvas : secondCanvas
    );

    expect(renderAllColorCycleLayers(deps, targetCtx)).toBe(true);

    expect(compositeDraw).toHaveBeenCalledWith(firstCanvas, 0, 0);
    expect(compositeDraw).toHaveBeenCalledWith(secondCanvas, 0, 0);
    expect(updateAnimation).not.toHaveBeenCalled();
    expect(renderDirectToCanvas).not.toHaveBeenCalled();
    expect(presentCurrentFrameToCanvas).not.toHaveBeenCalled();
  });
});
