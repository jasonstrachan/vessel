import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { recordRuntimeIncident } from '@/utils/runtimeIncidentJournal';
import {
  type ColorCycleBrush,
  renderAllColorCycleLayers,
  type ColorCycleRenderDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRender';

jest.mock('@/utils/runtimeIncidentJournal', () => ({
  recordRuntimeIncident: jest.fn(),
}));

const recordRuntimeIncidentMock = recordRuntimeIncident as jest.MockedFunction<
  typeof recordRuntimeIncident
>;

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

describe('renderAllColorCycleLayers throttling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    recordRuntimeIncidentMock.mockClear();
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
    renderAllColorCycleLayers(deps);
    nowSpy.mockReturnValueOnce(1010);
    renderAllColorCycleLayers(deps);
    nowSpy.mockReturnValueOnce(1200);
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

  it('preserves the failed layer and continues presenting the remaining layers', () => {
    const failedLayer = makeLayer('cc-failed');
    const healthyLayer = makeLayer('cc-healthy');
    const failedCanvas = failedLayer.colorCycleData!.canvas!;
    const healthyCanvas = healthyLayer.colorCycleData!.canvas!;
    const targetCanvas = document.createElement('canvas');
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) throw new Error('Missing test canvas context');
    const compositeDraw = jest.spyOn(targetCtx, 'drawImage');
    const failedRender = jest.fn(() => {
      throw new Error('failed replacement frame');
    });
    const healthyRender = jest.fn();
    const deps = makeDeps(
      {
        layers: [failedLayer, healthyLayer],
        activeLayerId: 'cc-healthy',
      } as unknown as AppState,
      {},
    );
    deps.getColorCycleBrushManager = () => ({
      getSurfaceBrush: (layerId) => ({
        updateAnimation: jest.fn(),
        renderDirectToCanvas: layerId === failedLayer.id ? failedRender : healthyRender,
      }),
    });
    deps.refreshLayerCCSurface = (_brush, layerId) => (
      layerId === failedLayer.id ? failedCanvas : healthyCanvas
    );

    expect(() => renderAllColorCycleLayers(deps, targetCtx)).not.toThrow();

    expect(failedRender).toHaveBeenCalledTimes(1);
    expect(healthyRender).toHaveBeenCalledTimes(1);
    expect(compositeDraw).toHaveBeenCalledWith(failedCanvas, 0, 0);
    expect(compositeDraw).toHaveBeenCalledWith(healthyCanvas, 0, 0);
    expect(deps.ccLog).toHaveBeenCalledWith(
      'CC layer presentation failed; preserved previous frame',
      expect.objectContaining({ layerId: failedLayer.id, stage: 'present' }),
    );
  });

  it('records one incident per continuous presentation failure and one recovery', () => {
    const layer = makeLayer('cc-continuous-failure');
    const renderDirectToCanvas = jest.fn<void, []>(() => {
      throw new Error('persistent presentation failure');
    });
    const deps = makeDeps(
      { layers: [layer], activeLayerId: layer.id } as unknown as AppState,
      { updateAnimation: jest.fn(), renderDirectToCanvas },
    );

    renderAllColorCycleLayers(deps);
    renderAllColorCycleLayers(deps);

    expect(recordRuntimeIncidentMock).toHaveBeenCalledTimes(1);
    expect(recordRuntimeIncidentMock).toHaveBeenLastCalledWith(expect.objectContaining({
      event: 'layer-presentation-failed',
    }));

    renderDirectToCanvas.mockImplementation(() => undefined);
    renderAllColorCycleLayers(deps);

    expect(recordRuntimeIncidentMock).toHaveBeenCalledTimes(2);
    expect(recordRuntimeIncidentMock).toHaveBeenLastCalledWith(expect.objectContaining({
      event: 'layer-presentation-recovered',
    }));
  });
});
