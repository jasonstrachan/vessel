import type { StoreApi } from 'zustand';

import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

jest.mock('@/stores/helpers/historyLifecycle', () => ({
  cloneImageDataForHistory: jest.fn((imageData: ImageData | null) => imageData),
}));

jest.mock('@/history/helpers/colorCycle', () => ({
  captureColorCycleBrushState: jest.fn(() => null),
}));

jest.mock('@/history/helpers/layerHistory', () => ({
  commitLayerHistory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/utils/debug', () => ({
  logError: jest.fn(),
}));

type StoreSet = StoreApi<AppState>['setState'];

const createBaseLayer = (projectSize: number): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = projectSize;
  framebuffer.height = projectSize;

  return {
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: new ImageData(projectSize, projectSize),
    framebuffer,
    alignment: {
      positioning: 'anchor',
      horizontal: 'left',
      vertical: 'top',
      offsetPx: { x: 0, y: 0 },
    },
    layerType: 'normal',
    colorCycleData: undefined,
    version: 0,
  } as unknown as Layer;
};

const setupHelpers = (floatingOverrides: Partial<NonNullable<AppState['floatingPaste']>>) => {
  const project = { width: 64, height: 64 } as unknown as AppState['project'];
  const layer = createBaseLayer(project.width);

  const floatingPaste: NonNullable<AppState['floatingPaste']> = {
    active: true,
    imageData: new ImageData(16, 12),
    position: { x: 0, y: 0 },
    originalPosition: { x: 0, y: 0 },
    width: 16,
    height: 12,
    displayWidth: 16,
    displayHeight: 12,
    sourceLayerId: layer.id,
  };

  Object.assign(floatingPaste, floatingOverrides);

  const state: Partial<AppState> = {
    floatingPaste,
    layers: [layer],
    activeLayerId: layer.id,
    project,
  };

  const get = () => state as AppState;
  const set: StoreSet = (updater) => {
    if (typeof updater === 'function') {
      const result = updater(state as AppState);
      if (result) {
        Object.assign(state, result);
      }
      return;
    }
    if (updater) {
      Object.assign(state, updater);
    }
  };

  const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);

  const helpers = createSelectionPasteHelpers({
    get,
    set,
    captureCanvasToActiveLayer,
  });

  return { helpers, state, captureCanvasToActiveLayer };
};

describe('selection paste commit', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('crops the source bitmap instead of scaling when the rect extends past the canvas', async () => {
    const drawImageSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    const { helpers } = setupHelpers({
      position: { x: -10, y: -6 },
      displayWidth: 32,
      displayHeight: 24,
      width: 16,
      height: 12,
    });

    await helpers.commitFloatingPaste();

    const pasteCall = drawImageSpy.mock.calls.find((call) => call.length === 9);
    expect(pasteCall).toBeDefined();
    if (!pasteCall) {
      return;
    }
    const [, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight] = pasteCall;
    expect(sx).toBeCloseTo(5);
    expect(sy).toBeCloseTo(3);
    expect(sWidth).toBeCloseTo(11);
    expect(sHeight).toBeCloseTo(9);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(0);
    expect(dWidth).toBeCloseTo(22);
    expect(dHeight).toBeCloseTo(18);
  });

  it('captures only the visible intersection when extending past the bottom/right edges', async () => {
    const { helpers, captureCanvasToActiveLayer } = setupHelpers({
      position: { x: 50, y: 40 },
      displayWidth: 40,
      displayHeight: 40,
      width: 20,
      height: 20,
    });

    await helpers.commitFloatingPaste();

    expect(captureCanvasToActiveLayer).toHaveBeenCalledTimes(1);
    const [, roi] = captureCanvasToActiveLayer.mock.calls[0];
    expect(roi).toMatchObject({ x: 50, y: 40, width: 14, height: 24 });
  });

  it('clears the floating paste without capturing when it sits fully outside the canvas', async () => {
    const { helpers, state, captureCanvasToActiveLayer } = setupHelpers({
      position: { x: 80, y: 80 },
      displayWidth: 10,
      displayHeight: 10,
    });

    await helpers.commitFloatingPaste();

    expect(captureCanvasToActiveLayer).not.toHaveBeenCalled();
    expect(state.floatingPaste).toBeNull();
  });
});
