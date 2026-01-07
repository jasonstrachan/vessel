import type { StoreApi } from 'zustand';

import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

jest.mock('@/stores/helpers/colorCycleSelection', () => ({
  writeColorCycleRegion: jest.fn(() => false),
  hasColorCycleIndices: jest.fn((payload?: { colorCycleIndices?: Uint8Array | null }) =>
    Boolean(payload?.colorCycleIndices && payload.colorCycleIndices.length)
  ),
  debugCaptureColorCycleScalarRegion: jest.fn(() => null),
}));

type WriteColorCycleRegion = typeof import('@/stores/helpers/colorCycleSelection')['writeColorCycleRegion'];

const { writeColorCycleRegion } = jest.requireMock('@/stores/helpers/colorCycleSelection') as {
  writeColorCycleRegion: jest.MockedFunction<WriteColorCycleRegion>;
};

const mockWriteColorCycleRegion = writeColorCycleRegion;

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

type FloatingPasteState = NonNullable<AppState['floatingPaste']> & {
  colorCycleIndices?: Uint8Array | null;
};

const setupHelpers = (
  floatingOverrides: Partial<FloatingPasteState>,
  layerOverrides?: Partial<Layer>
) => {
  const project = { width: 64, height: 64 } as unknown as NonNullable<AppState['project']>;
  const layer = {
    ...createBaseLayer(project.width),
    ...(layerOverrides ?? {}),
  } as Layer;

  const floatingPaste: NonNullable<AppState['floatingPaste']> = {
    active: true,
    imageData: new ImageData(16, 12),
    position: { x: 0, y: 0 },
    originalPosition: { x: 0, y: 0 },
    width: 16,
    height: 12,
    displayWidth: 16,
    displayHeight: 12,
    rotation: 0,
    sourceLayerId: layer.id,
  };

  Object.assign(floatingPaste, floatingOverrides);

  const state: Partial<AppState> = {
    floatingPaste,
    layers: [layer],
    activeLayerId: layer.id,
    project,
    setLayersNeedRecomposition: jest.fn(),
    setCurrentCompositeBitmap: jest.fn(),
    updateLayer: jest.fn(),
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

  return { helpers, state, captureCanvasToActiveLayer, layer };
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

  it('writes color-cycle indices directly when committing a floating paste on a color-cycle layer', async () => {
    const colorCycleIndices = new Uint8Array([1, 2, 3, 4]);
    const { helpers, state, captureCanvasToActiveLayer, layer } = setupHelpers(
      {
        colorCycleIndices,
        width: 2,
        height: 2,
        position: { x: 5.4, y: 7.6 },
      },
      {
        layerType: 'color-cycle',
      }
    );

    mockWriteColorCycleRegion.mockReturnValueOnce(true);

    await helpers.commitFloatingPaste();

    expect(mockWriteColorCycleRegion).toHaveBeenCalledTimes(1);
    expect(mockWriteColorCycleRegion).toHaveBeenCalledWith(
      state,
      layer,
      state.project,
      { x: 5, y: 8, width: 2, height: 2 },
      colorCycleIndices,
      2,
      2,
      { offsetX: 0, offsetY: 0 }
    );

    expect(state.setLayersNeedRecomposition).toHaveBeenCalledWith(true);
    expect(state.setCurrentCompositeBitmap).toHaveBeenCalledWith(null);
    expect(captureCanvasToActiveLayer).not.toHaveBeenCalled();
    expect(state.floatingPaste).toBeNull();
  });

  it('uses intrinsic CC payload size and rounded position even when display is scaled', async () => {
    const colorCycleIndices = new Uint8Array([9, 8, 7, 6]);
    const { helpers, state, layer } = setupHelpers(
      {
        colorCycleIndices,
        width: 2,
        height: 2,
        displayWidth: 6, // scaled up in UI, but CC data should stay intrinsic
        displayHeight: 5,
        position: { x: 3.2, y: 9.9 },
      },
      {
        layerType: 'color-cycle',
      }
    );

    mockWriteColorCycleRegion.mockReturnValueOnce(true);

    await helpers.commitFloatingPaste();

    expect(mockWriteColorCycleRegion).toHaveBeenCalledWith(
      state,
      layer,
      state.project,
      { x: 3, y: 10, width: 2, height: 2 },
      colorCycleIndices,
      2,
      2,
      { offsetX: 0, offsetY: 0 }
    );
  });
});
