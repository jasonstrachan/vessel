import {
  writeColorCycleRegion,
  clearColorCycleRegion,
  deriveColorCycleIndicesFromImageData,
} from '@/stores/helpers/colorCycleSelection';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

// Minimal ImageData polyfill for Node/jest environments that lack canvas.
class FakeImageData implements ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  readonly colorSpace = 'srgb';
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

const makeOffscreenCanvas = (width: number, height: number): OffscreenCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  // Minimal stub to satisfy types in non-DOM Jest environments.
  return { width, height } as unknown as OffscreenCanvas;
};

const createProject = (): Project => ({
  id: 'project-test',
  name: 'test',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
  defaultCustomBrushId: null,
});

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
  const project: Project = createProject();

  beforeEach(() => {
    mockApplyLayerSnapshot.mockClear();
    mockGetLayerSnapshot.mockClear();
    mockRenderDirect.mockClear();
    window.localStorage.clear();
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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
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
    const gradientId = new Uint8Array(16).fill(6);
    const gradientDefId = new Uint16Array(16).fill(7);
    const speed = new Uint8Array(16).fill(8);
    const flow = new Uint8Array(16).fill(9);
    const phase = new Uint8Array(16).fill(10);
    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: buffer.buffer,
      gradientIdBuffer: gradientId.buffer,
      gradientDefIdBuffer: gradientDefId.buffer,
      speedBuffer: speed.buffer,
      flowBuffer: flow.buffer,
      phaseBuffer: phase.buffer,
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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
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
    const incomingGradientId = new Uint8Array(snapshotArg.gradientIdBuffer);
    const incomingGradientDefId = new Uint16Array(snapshotArg.gradientDefIdBuffer);
    const incomingSpeed = new Uint8Array(snapshotArg.speedBuffer);
    const incomingFlow = new Uint8Array(snapshotArg.flowBuffer);
    const incomingPhase = new Uint8Array(snapshotArg.phaseBuffer);
    [0, 1, 4, 5].forEach((index) => {
      expect(incomingGradientId[index]).toBe(0);
      expect(incomingGradientDefId[index]).toBe(0);
      expect(incomingSpeed[index]).toBe(0);
      expect(incomingFlow[index]).toBe(0);
      expect(incomingPhase[index]).toBe(0);
    });
    expect(incomingGradientId[2]).toBe(6);
    expect(incomingGradientDefId[2]).toBe(7);
    expect(incomingSpeed[2]).toBe(8);
    expect(incomingFlow[2]).toBe(9);
    expect(incomingPhase[2]).toBe(10);
  });

  it('permanently logs when a CC clear empties the whole layer', () => {
    const buffer = new Uint8Array(16).fill(5);
    const gradientId = new Uint8Array(16).fill(6);
    const gradientDefId = new Uint16Array(16).fill(7);
    const speed = new Uint8Array(16).fill(8);
    const flow = new Uint8Array(16).fill(9);
    const phase = new Uint8Array(16).fill(10);
    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: buffer.buffer,
      gradientIdBuffer: gradientId.buffer,
      gradientDefIdBuffer: gradientDefId.buffer,
      speedBuffer: speed.buffer,
      flowBuffer: flow.buffer,
      phaseBuffer: phase.buffer,
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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas, hasContent: true },
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
      width: 4,
      height: 4,
    }, {
      auditSource: 'delete-selected',
      auditDetails: {
        activeLayerId: 'layer-cc',
        selectionMaskBounds: null,
      },
    });

    expect(cleared).toBe(true);
    expect(getPersistedCCMutationLog()).toEqual([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId: 'layer-cc',
        reason: 'delete-selected',
        severity: 'error',
        stack: expect.stringContaining('color-cycle-layer-cleared'),
        details: expect.objectContaining({
          source: 'selection-region-clear',
          operation: 'delete-selected',
          expectedDestructive: true,
          activeLayerId: 'layer-cc',
          selectionMaskBounds: null,
          layerName: 'CC',
          layerVisible: true,
          layerOpacity: 1,
          layerBlendMode: 'source-over',
          projectId: 'project-test',
          projectWidth: 4,
          projectHeight: 4,
          canvasWidth: 4,
          canvasHeight: 4,
          bufferLength: 16,
          rect: { x: 0, y: 0, width: 4, height: 4 },
          clampedRect: { x: 0, y: 0, width: 4, height: 4 },
          hasAlphaMask: false,
          paintBefore: expect.objectContaining({
            byteLength: 16,
            nonZeroCount: 16,
            bounds: { x: 0, y: 0, width: 4, height: 4 },
            samples: expect.arrayContaining([
              expect.objectContaining({ index: 0, x: 0, y: 0, value: 5 }),
            ]),
          }),
          paintAfter: expect.objectContaining({
            byteLength: 16,
            nonZeroCount: 0,
            bounds: null,
          }),
          gradientIdAfter: expect.objectContaining({ byteLength: 16, nonZeroCount: 0 }),
          gradientDefIdAfter: expect.objectContaining({ byteLength: 32, nonZeroCount: 0 }),
          speedAfter: expect.objectContaining({ byteLength: 16, nonZeroCount: 0 }),
          flowAfter: expect.objectContaining({ byteLength: 16, nonZeroCount: 0 }),
          phaseAfter: expect.objectContaining({ byteLength: 16, nonZeroCount: 0 }),
        }),
      }),
    ]);
    expect(state.updateLayer).toHaveBeenCalledWith(
      'layer-cc',
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          hasContent: false,
        }),
      }),
      expect.objectContaining({ skipColorCycleSync: true })
    );
  });

  it('clears only masked pixels when alphaData is provided', () => {
    const buffer = new Uint8Array(16).fill(5);
    const alphaData = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 255,
    ]);

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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas },
    } as Layer;

    const state = {
      updateLayer: jest.fn(),
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const cleared = clearColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      { alphaData, alphaWidth: 2, alphaHeight: 2, alphaStride: 4, alphaChannelOffset: 3, alphaThreshold: 0 }
    );

    expect(cleared).toBe(true);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[mockApplyLayerSnapshot.mock.calls.length - 1][1];
    const incoming = new Uint8Array(snapshotArg.paintBuffer);
    expect(incoming[0]).toBe(0); // opaque mask
    expect(incoming[1]).toBe(5); // transparent mask
    expect(incoming[4]).toBe(5); // transparent mask
    expect(incoming[5]).toBe(0); // opaque mask
  });

  it('preserves destination pixels where source alpha is transparent', () => {
    const buffer = new Uint8Array(16).fill(9);
    const src = new Uint8Array([1, 2, 3, 4]);
    const alphaData = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 255,
    ]);

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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas },
    } as Layer;

    const state = {
      updateLayer: jest.fn(),
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const applied = writeColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      src,
      2,
      2,
      { alphaData, alphaStride: 4, alphaChannelOffset: 3, alphaThreshold: 0 }
    );

    expect(applied).toBe(true);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[mockApplyLayerSnapshot.mock.calls.length - 1][1];
    const incoming = new Uint8Array(snapshotArg.paintBuffer);
    expect(incoming[0]).toBe(1); // opaque
    expect(incoming[1]).toBe(9); // transparent source pixel -> unchanged
    expect(incoming[4]).toBe(9); // transparent source pixel -> unchanged
    expect(incoming[5]).toBe(4); // opaque
  });

  it('does not mutate when all source pixels are transparent', () => {
    const buffer = new Uint8Array(16).fill(7);
    const src = new Uint8Array([1, 2, 3, 4]);
    const alphaData = new Uint8ClampedArray(2 * 2 * 4).fill(0); // fully transparent

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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas },
    } as Layer;

    const state = {
      updateLayer: jest.fn(),
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const applied = writeColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      src,
      2,
      2,
      { alphaData, alphaStride: 4, alphaChannelOffset: 3, alphaThreshold: 0 }
    );

    expect(applied).toBe(false);
  });

  it('derives CC indices from RGBA using the active slot palette', () => {
    const source = new FakeImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
      2,
      1
    );

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
      framebuffer: makeOffscreenCanvas(2, 1),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: {
        paintSlot: 3,
        slotPalettes: [
          {
            slot: 3,
            stops: [
              { position: 0, color: '#ff0000' },
              { position: 1, color: '#0000ff' },
            ],
          },
        ],
      },
    } as Layer;

    const result = deriveColorCycleIndicesFromImageData({
      imageData: source as unknown as ImageData,
      layer,
    });

    expect(result).not.toBeNull();
    expect(result?.length).toBe(2);
    expect(result?.[0]).toBe(1);
    expect(result?.[1]).toBe(255);
  });

  it('writes transparent source pixels as index 0 while deriving CC indices', () => {
    const source = new FakeImageData(
      new Uint8ClampedArray([
        50, 60, 70, 0,
        255, 0, 0, 255,
      ]),
      2,
      1
    );

    const layer: Layer = {
      id: 'layer-cc-alpha',
      name: 'CC alpha',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: makeOffscreenCanvas(2, 1),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: {
        gradient: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
      },
    } as Layer;

    const result = deriveColorCycleIndicesFromImageData({
      imageData: source as unknown as ImageData,
      layer,
    });

    expect(result).toEqual(new Uint8Array([0, 1]));
  });

  it('writes gradient slot ids when requested during CC region write', () => {
    const buffer = new Uint8Array(16);
    const gradientIds = new Uint8Array(16).fill(0);
    const src = new Uint8Array([1, 2, 3, 4]);

    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: buffer.buffer,
      gradientIdBuffer: gradientIds.buffer,
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
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas },
    } as Layer;

    const state = {
      updateLayer: jest.fn(),
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const applied = writeColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      src,
      2,
      2,
      { gradientSlot: 5 }
    );

    expect(applied).toBe(true);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[mockApplyLayerSnapshot.mock.calls.length - 1][1];
    const incomingGradient = new Uint8Array(snapshotArg.gradientIdBuffer);
    expect(incomingGradient[0]).toBe(5);
    expect(incomingGradient[1]).toBe(5);
    expect(incomingGradient[4]).toBe(5);
    expect(incomingGradient[5]).toBe(5);
  });

  it('preserves full per-pixel CC payload during region write', () => {
    const paint = new Uint8Array(16).fill(0);
    const gradientIds = new Uint8Array(16).fill(1);
    const gradientDefIds = new Uint16Array(16).fill(2);
    const speed = new Uint8Array(16).fill(3);
    const flow = new Uint8Array(16).fill(4);
    const phase = new Uint8Array(16).fill(5);
    const src = new Uint8Array([9, 8, 7, 6]);
    const srcGradientIds = new Uint8Array([11, 12, 13, 14]);
    const srcGradientDefIds = new Uint16Array([101, 102, 103, 104]);
    const srcSpeed = new Uint8Array([21, 22, 23, 24]);
    const srcFlow = new Uint8Array([31, 32, 33, 34]);
    const srcPhase = new Uint8Array([41, 42, 43, 44]);

    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientIds.buffer,
      gradientDefIdBuffer: gradientDefIds.buffer,
      speedBuffer: speed.buffer,
      flowBuffer: flow.buffer,
      phaseBuffer: phase.buffer,
      hasContent: true,
      strokeCounter: 0,
    });

    const imageData = new FakeImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const canvas = makeCanvas(4, 4, imageData);

    const layer: Layer = {
      id: 'layer-cc-payload',
      name: 'CC payload',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
      colorCycleData: { canvas },
    } as Layer;

    const updateLayer = jest.fn();
    const state = {
      updateLayer,
      setCurrentCompositeBitmap: jest.fn(),
      setLayersNeedRecomposition: jest.fn(),
      markCompositeSegmentsDirtyByLayerIds: jest.fn(),
    } as unknown as import('@/stores/useAppStore').AppState;

    const applied = writeColorCycleRegion(
      state,
      layer,
      project,
      { x: 0, y: 0, width: 2, height: 2 },
      src,
      2,
      2,
      {
        sourceGradientIds: srcGradientIds,
        sourceGradientDefIds: srcGradientDefIds,
        sourceSpeed: srcSpeed,
        sourceFlow: srcFlow,
        sourcePhase: srcPhase,
      }
    );

    expect(applied).toBe(true);
    const snapshotArg = mockApplyLayerSnapshot.mock.calls[mockApplyLayerSnapshot.mock.calls.length - 1][1];
    expect(Array.from(new Uint8Array(snapshotArg.paintBuffer).slice(0, 6))).toEqual([9, 8, 0, 0, 7, 6]);
    expect(Array.from(new Uint8Array(snapshotArg.gradientIdBuffer).slice(0, 6))).toEqual([11, 12, 1, 1, 13, 14]);
    expect(Array.from(new Uint16Array(snapshotArg.gradientDefIdBuffer).slice(0, 6))).toEqual([101, 102, 2, 2, 103, 104]);
    expect(Array.from(new Uint8Array(snapshotArg.speedBuffer).slice(0, 6))).toEqual([21, 22, 3, 3, 23, 24]);
    expect(Array.from(new Uint8Array(snapshotArg.flowBuffer).slice(0, 6))).toEqual([31, 32, 4, 4, 33, 34]);
    expect(Array.from(new Uint8Array(snapshotArg.phaseBuffer).slice(0, 6))).toEqual([41, 42, 5, 5, 43, 44]);
    expect(updateLayer).toHaveBeenCalledWith(
      'layer-cc-payload',
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          gradientDefIdBuffer: expect.any(ArrayBuffer),
        }),
      }),
      expect.objectContaining({ skipColorCycleSync: true })
    );
  });

  it('can skip materialization so preview writes do not render or capture imageData early', () => {
    const paint = new Uint8Array(16).fill(0);
    const gradientIds = new Uint8Array(16).fill(1);

    mockGetLayerSnapshot.mockReturnValue({
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientIds.buffer,
      hasContent: true,
      strokeCounter: 0,
    });

    const imageData = new FakeImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
    const canvas = makeCanvas(4, 4, imageData);

    const layer: Layer = {
      id: 'layer-cc-preview',
      name: 'CC preview',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: makeOffscreenCanvas(4, 4),
      alignment: { ...createDefaultLayerAlignment(), positioning: 'auto' },
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
      new Uint8Array([1, 2, 3, 4]),
      2,
      2,
      { skipMaterialize: true }
    );

    expect(applied).toBe(true);
    expect(mockApplyLayerSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRenderDirect).not.toHaveBeenCalled();
    expect(updateLayer).toHaveBeenCalledWith(
      'layer-cc-preview',
      {
        colorCycleData: expect.objectContaining({
          canvas,
          gradientIdBuffer: expect.any(ArrayBuffer),
        }),
      },
      expect.objectContaining({ skipColorCycleSync: true })
    );
    expect(setCurrentCompositeBitmap).not.toHaveBeenCalled();
    expect(setLayersNeedRecomposition).not.toHaveBeenCalled();
    expect(markCompositeSegmentsDirtyByLayerIds).not.toHaveBeenCalled();
  });
});
