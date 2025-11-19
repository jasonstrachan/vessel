import { writeColorCycleRegion, clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import type { Layer, Project } from '@/types';

// Minimal ImageData polyfill for Node/jest environments that lack canvas.
class FakeImageData implements ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

// Provide a lightweight canvas stub the helper can render into.
const makeCanvas = (width: number, height: number, imageData: ImageData) => {
  return {
    width,
    height,
    getContext: jest.fn(() => ({
      getImageData: jest.fn(() => imageData),
      clearRect: jest.fn(),
    })),
  } as unknown as HTMLCanvasElement;
};

// Stub brush + manager so colorCycleSelection routes buffers into applyLayerSnapshot.
const mockApplyLayerSnapshot = jest.fn();
const mockGetLayerSnapshot = jest.fn();
const mockRenderDirect = jest.fn();

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => ({
    getLayerColorCycleBrush: () => ({
      getLayerSnapshot: mockGetLayerSnapshot,
      applyLayerSnapshot: mockApplyLayerSnapshot,
      renderDirectToCanvas: mockRenderDirect,
      getCanvas: () => null,
    }),
  }),
}));

describe('colorCycleSelection helpers', () => {
  const project: Project = { width: 4, height: 4, name: 'test', layers: [] } as Project;

  beforeEach(() => {
    mockApplyLayerSnapshot.mockClear();
    mockGetLayerSnapshot.mockClear();
    mockRenderDirect.mockClear();
  });

  it('writes pasted CC indices into brush + invalidates composites', () => {
    const buffer = new Uint8Array(16); // 4x4 canvas => 16 scalar slots
    const src = new Uint8Array([1, 2, 3, 4]); // 2x2 payload

    const imageData = new FakeImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const canvas = makeCanvas(4, 4, imageData);

    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: buffer.buffer,
      hasContent: true,
      strokeCounter: 0,
    });

    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: null,
      alignment: { positioning: 'auto' } as any,
      colorCycleData: { canvas },
    } as Layer;

    const updateLayer = jest.fn();
    const setCurrentCompositeBitmap = jest.fn();
    const setLayersNeedRecomposition = jest.fn();
    const markCompositeSegmentsDirtyByLayerIds = jest.fn();

    const state = {
      updateLayer,
      setCurrentCompositeBitmap,
      setLayersNeedRecomposition,
      markCompositeSegmentsDirtyByLayerIds,
    } as unknown as import('@/stores/useAppStore').AppState;

    const applied = writeColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      src,
      2,
      2
    );

    expect(applied).toBe(true);
    expect(mockApplyLayerSnapshot).toHaveBeenCalledTimes(1);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[0][1];
    const incoming = new Uint8Array(snapshotArg.paintBuffer);
    expect(incoming[0]).toBe(1);
    expect(incoming[1]).toBe(2);
    expect(incoming[4]).toBe(3);
    expect(incoming[5]).toBe(4);
    expect(setCurrentCompositeBitmap).toHaveBeenCalled();
    expect(setLayersNeedRecomposition).toHaveBeenCalled();
    expect(markCompositeSegmentsDirtyByLayerIds).toHaveBeenCalledWith(['layer-cc']);
    // Canvas used for resolved imageData should be persisted back onto the layer
    expect(updateLayer).toHaveBeenCalledWith(
      'layer-cc',
      expect.objectContaining({
        colorCycleData: expect.objectContaining({ canvas }),
      }),
      expect.objectContaining({ skipColorCycleSync: true })
    );
  });

  it('clears CC region and writes zeros', () => {
    const buffer = new Uint8Array(16).fill(5);
    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: buffer.buffer,
      hasContent: true,
      strokeCounter: 0,
    });

    const imageData = new FakeImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const canvas = makeCanvas(4, 4, imageData);

    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: null,
      alignment: { positioning: 'auto' } as any,
      colorCycleData: { canvas },
    } as Layer;

    const state = {
      updateLayer: jest.fn(),
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const cleared = clearColorCycleRegion(state, layer, project, {
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    });

    expect(cleared).toBe(true);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[mockApplyLayerSnapshot.mock.calls.length - 1][1];
    const incoming = new Uint8Array(snapshotArg.paintBuffer);
    expect(incoming[0]).toBe(0);
    expect(incoming[1]).toBe(0);
    expect(incoming[4]).toBe(0);
    expect(incoming[5]).toBe(0);
  });
});
