import type { StoreApi } from 'zustand';

import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

jest.mock('@/stores/helpers/colorCycleSelection', () => ({
  writeColorCycleRegion: jest.fn(() => false),
  deriveColorCycleIndicesFromImageData: jest.fn(() => null),
  hasColorCycleIndices: jest.fn((payload?: { colorCycleIndices?: Uint8Array | null }) =>
    Boolean(payload?.colorCycleIndices && payload.colorCycleIndices.length)
  ),
  debugCaptureColorCycleScalarRegion: jest.fn(() => null),
}));

type WriteColorCycleRegion = typeof import('@/stores/helpers/colorCycleSelection')['writeColorCycleRegion'];
type DeriveColorCycleIndicesFromImageData =
  typeof import('@/stores/helpers/colorCycleSelection')['deriveColorCycleIndicesFromImageData'];
type HasColorCycleIndices = typeof import('@/stores/helpers/colorCycleSelection')['hasColorCycleIndices'];

const { writeColorCycleRegion, deriveColorCycleIndicesFromImageData, hasColorCycleIndices } =
  jest.requireMock('@/stores/helpers/colorCycleSelection') as {
  writeColorCycleRegion: jest.MockedFunction<WriteColorCycleRegion>;
  deriveColorCycleIndicesFromImageData: jest.MockedFunction<DeriveColorCycleIndicesFromImageData>;
  hasColorCycleIndices: jest.MockedFunction<HasColorCycleIndices>;
};

const mockWriteColorCycleRegion = writeColorCycleRegion;
const mockDeriveColorCycleIndicesFromImageData = deriveColorCycleIndicesFromImageData;
const mockHasColorCycleIndices = hasColorCycleIndices;

type CommitLayerHistory = typeof import('@/history/helpers/layerHistory')['commitLayerHistory'];

const { commitLayerHistory } = jest.requireMock('@/history/helpers/layerHistory') as {
  commitLayerHistory: jest.MockedFunction<CommitLayerHistory>;
};

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
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
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
    addNotification: jest.fn(),
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

  it('passes a rounded/clamped bitmap ROI and ROI-sized beforeImage for normal paste', async () => {
    const { helpers } = setupHelpers({
      position: { x: 10.4, y: 12.6 },
      displayWidth: 20.2,
      displayHeight: 16.7,
      width: 20,
      height: 16,
    });

    await helpers.commitFloatingPaste();

    expect(commitLayerHistory).toHaveBeenCalledTimes(1);
    const args = commitLayerHistory.mock.calls[0]?.[0];
    expect(args?.bitmapRoi).toEqual({ x: 10, y: 13, width: 20, height: 17 });
    expect(args?.beforeImage?.width).toBe(20);
    expect(args?.beforeImage?.height).toBe(17);
  });

  it('uses extraction history context ROI so undo can restore source and destination', async () => {
    const { helpers, state } = setupHelpers({
      position: { x: 10, y: 10 },
      displayWidth: 2,
      displayHeight: 2,
      width: 2,
      height: 2,
      sourceLayerId: 'layer-1',
    });

    state.floatingPasteHistoryContext = {
      sourceLayerId: 'layer-1',
      sourceBounds: { x: 2, y: 2, width: 2, height: 2 },
      beforeImage: new ImageData(64, 64),
      beforeColorState: null,
      selectionBefore: {
        start: { x: 2, y: 2 },
        end: { x: 4, y: 4 },
      },
    };

    await helpers.commitFloatingPaste();

    expect(commitLayerHistory).toHaveBeenCalledTimes(1);
    const args = commitLayerHistory.mock.calls[0]?.[0];
    expect(args?.bitmapRoi).toEqual({ x: 2, y: 2, width: 10, height: 10 });
    expect(args?.beforeImage?.width).toBe(10);
    expect(args?.beforeImage?.height).toBe(10);
    expect(args?.selectionBefore).toEqual({
      start: { x: 2, y: 2 },
      end: { x: 4, y: 4 },
    });
  });

  it('rebuilds move beforeImage when history context is missing a full-layer snapshot', async () => {
    const movedPixels = new ImageData(2, 1);
    movedPixels.data.set([200, 100, 50, 255, 10, 20, 30, 128]);
    const { helpers, state } = setupHelpers({
      imageData: movedPixels,
      position: { x: 10, y: 10 },
      displayWidth: 6,
      displayHeight: 3,
      width: 2,
      height: 1,
      sourceLayerId: 'layer-1',
    });

    state.floatingPasteHistoryContext = {
      sourceLayerId: 'layer-1',
      sourceBounds: { x: 2, y: 2, width: 2, height: 1 },
      beforeImage: null,
      beforeColorState: null,
      selectionBefore: {
        start: { x: 2, y: 2 },
        end: { x: 4, y: 3 },
      },
    };

    await helpers.commitFloatingPaste();

    expect(commitLayerHistory).toHaveBeenCalledTimes(1);
    const args = commitLayerHistory.mock.calls[0]?.[0];
    expect(args?.bitmapRoi).toEqual({ x: 2, y: 2, width: 14, height: 11 });
    expect(args?.beforeImage?.width).toBe(14);
    expect(args?.beforeImage?.height).toBe(11);

    if (!args?.beforeImage) {
      return;
    }

    const firstPixel = Array.from(args.beforeImage.data.slice(0, 4));
    const secondPixel = Array.from(args.beforeImage.data.slice(4, 8));
    expect(firstPixel).toEqual([200, 100, 50, 255]);
    expect(secondPixel).toEqual([10, 20, 30, 128]);
  });

  it('prefers sourceBeforeImage over transformed bitmap when rebuilding move beforeImage', async () => {
    const transformedPixels = new ImageData(2, 2);
    transformedPixels.data.set([
      255, 0, 0, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 255, 0, 255,
    ]);
    const sourceBefore = new ImageData(2, 2);
    sourceBefore.data.set([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]);

    const { helpers, state } = setupHelpers({
      imageData: transformedPixels,
      position: { x: 8, y: 8 },
      displayWidth: 4,
      displayHeight: 4,
      width: 2,
      height: 2,
      sourceLayerId: 'layer-1',
    });

    state.floatingPasteHistoryContext = {
      sourceLayerId: 'layer-1',
      sourceBounds: { x: 2, y: 2, width: 2, height: 2 },
      sourceBeforeImage: sourceBefore,
      beforeImage: null,
      beforeColorState: null,
      selectionBefore: {
        start: { x: 2, y: 2 },
        end: { x: 4, y: 4 },
      },
    };

    await helpers.commitFloatingPaste();

    const args = commitLayerHistory.mock.calls[0]?.[0];
    expect(args?.beforeImage?.width).toBe(10);
    expect(args?.beforeImage?.height).toBe(10);
    if (!args?.beforeImage) {
      return;
    }

    const roiPixelAtSourceTopLeft = (args.beforeImage.width * 0 + 0) * 4;
    const roiPixelAtSourceTopRight = (args.beforeImage.width * 0 + 1) * 4;
    expect(Array.from(args.beforeImage.data.slice(roiPixelAtSourceTopLeft, roiPixelAtSourceTopLeft + 4))).toEqual([
      1, 2, 3, 255,
    ]);
    expect(Array.from(args.beforeImage.data.slice(roiPixelAtSourceTopRight, roiPixelAtSourceTopRight + 4))).toEqual([
      4, 5, 6, 255,
    ]);
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

  it('blocks color-cycle paste when indices are missing and conversion fails', async () => {
    const { helpers, state, captureCanvasToActiveLayer } = setupHelpers(
      {
        colorCycleIndices: null,
      },
      {
        layerType: 'color-cycle',
      }
    );
    mockHasColorCycleIndices.mockReturnValueOnce(false);
    mockDeriveColorCycleIndicesFromImageData.mockReturnValueOnce(null);

    await helpers.commitFloatingPaste();

    expect(mockWriteColorCycleRegion).not.toHaveBeenCalled();
    expect(commitLayerHistory).not.toHaveBeenCalled();
    expect(captureCanvasToActiveLayer).not.toHaveBeenCalled();
    expect(state.addNotification).toHaveBeenCalledTimes(1);
    expect(state.floatingPaste).not.toBeNull();
  });

  it('auto-converts bitmap paste into color-cycle indices when needed', async () => {
    const convertedIndices = new Uint8Array([1, 255]);
    const { helpers, state, layer } = setupHelpers(
      {
        colorCycleIndices: null,
        width: 2,
        height: 1,
        displayWidth: 2,
        displayHeight: 1,
        imageData: new ImageData(
          new Uint8ClampedArray([
            255, 0, 0, 255,
            0, 0, 255, 255,
          ]),
          2,
          1
        ),
        position: { x: 4.4, y: 6.6 },
      },
      {
        layerType: 'color-cycle',
      }
    );

    mockHasColorCycleIndices.mockReturnValueOnce(false);
    mockDeriveColorCycleIndicesFromImageData.mockReturnValueOnce(convertedIndices);
    mockWriteColorCycleRegion.mockReturnValueOnce(true);

    await helpers.commitFloatingPaste();

    expect(mockDeriveColorCycleIndicesFromImageData).toHaveBeenCalledTimes(1);
    expect(mockWriteColorCycleRegion).toHaveBeenCalledWith(
      state,
      layer,
      state.project,
      { x: 4, y: 7, width: 2, height: 1 },
      convertedIndices,
      2,
      1,
      expect.objectContaining({
        offsetX: 0,
        offsetY: 0,
      })
    );
    expect(state.floatingPaste).toBeNull();
  });

  it('writes color-cycle indices directly when committing a floating paste on a color-cycle layer', async () => {
    const colorCycleIndices = new Uint8Array([1, 2, 3, 4]);
    const { helpers, state, captureCanvasToActiveLayer, layer } = setupHelpers(
      {
        colorCycleIndices,
        width: 2,
        height: 2,
        displayWidth: 2,
        displayHeight: 2,
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
      expect.objectContaining({
        offsetX: 0,
        offsetY: 0,
        alphaStride: 4,
        alphaChannelOffset: 3,
        alphaThreshold: 0,
      })
    );

    expect(state.setLayersNeedRecomposition).toHaveBeenCalledWith(true);
    expect(state.setCurrentCompositeBitmap).toHaveBeenCalledWith(null);
    expect(captureCanvasToActiveLayer).not.toHaveBeenCalled();
    expect(state.floatingPaste).toBeNull();
  });

  it('resamples CC payload to transformed display size on commit', async () => {
    const colorCycleIndices = new Uint8Array([9, 8, 7, 6]);
    const { helpers, state, layer } = setupHelpers(
      {
        colorCycleIndices,
        width: 2,
        height: 2,
        displayWidth: 6,
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
      { x: 3, y: 10, width: 6, height: 5 },
      new Uint8Array([
        9, 9, 9, 8, 8, 8,
        9, 9, 9, 8, 8, 8,
        9, 9, 9, 8, 8, 8,
        7, 7, 7, 6, 6, 6,
        7, 7, 7, 6, 6, 6,
      ]),
      6,
      5,
      expect.objectContaining({
        offsetX: 0,
        offsetY: 0,
        alphaStride: 1,
        alphaChannelOffset: 0,
        alphaThreshold: 0,
      })
    );
  });
});
