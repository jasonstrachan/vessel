import {
  COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS,
  createColorCycleStrokePatchDelta,
} from '@/history/deltas/colorCycleStrokePatchDelta';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { HistoryReplayDriftError } from '@/history/errors';
import HistoryManager from '@/history/historyManager';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS,
  COLOR_CYCLE_DOCUMENT_FIELD_MAPPING,
  registerColorCycleBrushPaintPatchRuntime,
} from '@/lib/colorCycle/document';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';

type PatchExtras = {
  gradientIdBytes?: Uint8Array;
  gradientDefIdBytes?: Uint8Array;
  speedBytes?: Uint8Array;
  flowBytes?: Uint8Array;
  phaseBytes?: Uint8Array;
};

const mockApplyPaintPatch = jest.fn((_layerId: string, _roi: unknown, bytes: Uint8Array) =>
  bytes.some((value) => value !== 0)
);

const mockBrush = {
  updateColorCycleTexture: jest.fn(),
  commitToLayer: jest.fn(),
  setTargetCanvas: jest.fn(),
};
registerColorCycleBrushPaintPatchRuntime(mockBrush, {
  apply: mockApplyPaintPatch,
});
let mockDocumentVersion: number | undefined;
let mockPixelVersion: number | undefined;

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => ({
    getHistoryBrush: () => mockBrush,
    getPlaybackBrush: () => null,
    getDocument: () => (
      typeof mockDocumentVersion === 'number'
        ? {
            read: () => ({
              snapshot: {} as never,
              version: mockDocumentVersion,
              pixelVersion: mockPixelVersion ?? mockDocumentVersion,
            }),
          }
        : undefined
    ),
    validateColorCycleBrush: () => true,
  }),
  getColorCycleStoreState: () => null,
  setColorCycleStoreStateGetter: jest.fn(),
  setLayerIdGetter: jest.fn(),
}));

const makeAnimatorState = (width: number, height: number) =>
  new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

const makeState = ({
  layerId,
  width,
  height,
  paint,
  gradientId,
  gradientDefId,
  speed,
  flow,
  phase,
}: {
  layerId: string;
  width: number;
  height: number;
  paint: number[];
  gradientId: number[];
  gradientDefId: number[];
  speed: number[];
  flow: number[];
  phase: number[];
}) => ({
  cycleSpeed: 1,
  fps: 30,
  brushSize: 1,
  layers: [
    {
      layerId,
      data: makeAnimatorState(width, height),
      strokeData: {
        paintBuffer: new Uint8Array(paint).buffer,
        gradientIdBuffer: new Uint8Array(gradientId).buffer,
        gradientDefIdBuffer: new Uint16Array(gradientDefId).buffer,
        speedBuffer: new Uint8Array(speed).buffer,
        flowBuffer: new Uint8Array(flow).buffer,
        phaseBuffer: new Uint8Array(phase).buffer,
        hasContent: paint.some((value) => value !== 0),
        strokeCounter: 1,
      },
    },
  ],
});

const createLayer = (layerId: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    id: layerId,
    name: 'CC Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      canvas,
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      paintSlot: 0,
      hasContent: true,
    },
    version: 1,
  };
};

const createBitmapLayer = (layerId: string, imageData: ImageData): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')?.putImageData(imageData, 0, 0);
  return {
    id: layerId,
    name: 'Bitmap Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 1,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    version: 1,
  };
};

const makeImage = (pixels: number[]): ImageData =>
  new ImageData(new Uint8ClampedArray(pixels), 2, 2);

describe('ColorCycleStrokePatchDelta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocumentVersion = undefined;
    mockPixelVersion = undefined;
    window.localStorage.clear();
    const layer = createLayer('layer-cc-patch', 2, 2);
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));
  });

  it('keeps the explicit patch contract aligned with serialized render buffers', () => {
    const canonicalBufferFields = Object.entries(COLOR_CYCLE_DOCUMENT_FIELD_MAPPING)
      .filter(([, mapping]) => mapping.archive === 'canonical-buffer')
      .map(([key]) => key);

    expect(COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS.map((buffer) => buffer.documentKey)).toEqual(
      canonicalBufferFields,
    );
    expect(COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS).toEqual(
      COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS.map((buffer) => buffer.historyKey),
    );
    expect(COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS.map((buffer) => buffer.historyBehavior)).toEqual(
      new Array(canonicalBufferFields.length).fill('patch-and-full-state'),
    );
  });

  it('restores gradient def id and phase bytes when undoing an overlapping CC shape patch', async () => {
    const layerId = 'layer-cc-patch';
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 2, 0, 0],
      gradientId: [3, 4, 0, 0],
      gradientDefId: [7, 9, 0, 0],
      speed: [10, 20, 0, 0],
      flow: [30, 40, 0, 0],
      phase: [50, 60, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockApplyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([1, 2, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([3, 4, 0, 0]);
    expect(Array.from(new Uint16Array(extras.gradientDefIdBytes?.buffer ?? new ArrayBuffer(0)))).toEqual([
      7,
      9,
      0,
      0,
    ]);
    expect(Array.from(extras.speedBytes ?? [])).toEqual([10, 20, 0, 0]);
    expect(Array.from(extras.flowBytes ?? [])).toEqual([30, 40, 0, 0]);
    expect(Array.from(extras.phaseBytes ?? [])).toEqual([50, 60, 0, 0]);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 0, y: 0, width: 2, height: 2 }],
      },
    ]);
  });

  it('skips applying a patch when the document version has drifted from the expected history version', async () => {
    const layerId = 'layer-cc-patch';
    mockDocumentVersion = 3;
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 2, 0, 0],
      gradientId: [3, 4, 0, 0],
      gradientDefId: [7, 9, 0, 0],
      speed: [10, 20, 0, 0],
      flow: [30, 40, 0, 0],
      phase: [50, 60, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
      beforeVersion: 1,
      afterVersion: 2,
    });

    expect(delta).not.toBeNull();
    await expect(delta!.apply('backward')).rejects.toBeInstanceOf(HistoryReplayDriftError);

    expect(mockApplyPaintPatch).not.toHaveBeenCalled();
    expect(getPersistedCCMutationLog()).toEqual([
      expect.objectContaining({
        event: 'history-cc-document-version-mismatch',
        layerId,
        reason: 'history-undo-patch',
        severity: 'warn',
        details: expect.objectContaining({
          source: 'history-color-cycle-stroke-patch',
          operation: 'undo',
          expectedVersion: 2,
          actualVersion: 3,
        }),
      }),
    ]);
  });

  it('refuses redo when the document version has drifted from the expected before version', async () => {
    const layerId = 'layer-cc-patch';
    mockDocumentVersion = 9;
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 2, 0, 0],
      gradientId: [3, 4, 0, 0],
      gradientDefId: [7, 9, 0, 0],
      speed: [10, 20, 0, 0],
      flow: [30, 40, 0, 0],
      phase: [50, 60, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
      beforeVersion: 1,
      afterVersion: 2,
    });

    expect(delta).not.toBeNull();
    await expect(delta!.apply('forward')).rejects.toBeInstanceOf(HistoryReplayDriftError);
    expect(mockApplyPaintPatch).not.toHaveBeenCalled();
    expect(getPersistedCCMutationLog()).toEqual([
      expect.objectContaining({
        event: 'history-cc-document-version-mismatch',
        layerId,
        reason: 'history-redo-patch',
        severity: 'warn',
        details: expect.objectContaining({
          source: 'history-color-cycle-stroke-patch',
          operation: 'redo',
          expectedVersion: 1,
          actualVersion: 9,
        }),
      }),
    ]);
  });

  it('allows undo when document metadata drifted but canonical pixel version is still anchored', async () => {
    const layerId = 'layer-cc-patch';
    mockDocumentVersion = 3;
    mockPixelVersion = 2;
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [0, 0, 0, 0],
      gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
      beforeVersion: 1,
      afterVersion: 2,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockApplyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(new Uint16Array(extras.gradientDefIdBytes?.buffer ?? new ArrayBuffer(0)))).toEqual([
      0,
      0,
      0,
      0,
    ]);
  });

  it('keeps a mixed CC and bitmap stack intact when the CC replay anchor drifts', async () => {
    const layerId = 'layer-cc-patch';
    const bitmapBefore = makeImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const bitmapAfter = makeImage([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const bitmapLayer = createBitmapLayer('bitmap-layer', bitmapAfter);
    useAppStore.setState((state) => ({
      layers: [...state.layers, bitmapLayer],
      project: state.project
        ? { ...state.project, layers: [...state.layers, bitmapLayer] }
        : state.project,
    }));

    const bitmapDelta = await createBitmapTileDelta({
      layerId: bitmapLayer.id,
      before: bitmapBefore,
      after: bitmapAfter,
    });
    expect(bitmapDelta).not.toBeNull();

    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 2, 0, 0],
      gradientId: [3, 4, 0, 0],
      gradientDefId: [7, 9, 0, 0],
      speed: [10, 20, 0, 0],
      flow: [30, 40, 0, 0],
      phase: [50, 60, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });
    const ccDelta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
      beforeVersion: 1,
      afterVersion: 2,
    });
    expect(ccDelta).not.toBeNull();

    const manager = new HistoryManager();
    const bitmapTxn = manager.begin('brush-stroke');
    bitmapTxn.push(bitmapDelta!);
    bitmapTxn.commit('Bitmap stroke');
    const ccTxn = manager.begin('cc-stroke');
    ccTxn.push(ccDelta!);
    ccTxn.commit('CC stroke');

    mockDocumentVersion = 3;
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayDriftError);
    expect(manager.entries()).toHaveLength(2);
    expect(manager.redoEntries()).toHaveLength(0);
    expect(mockApplyPaintPatch).not.toHaveBeenCalled();

    mockDocumentVersion = 2;
    await manager.undo();
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(1);
    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);

    await manager.undo();
    const restoredBitmap = useAppStore.getState().layers.find((layer) => layer.id === bitmapLayer.id)?.imageData;
    expect(Array.from(restoredBitmap?.data ?? [])).toEqual(Array.from(bitmapBefore.data));
  });

  it('does not synthesize an empty undo patch when before brush state is missing', async () => {
    const layerId = 'layer-cc-patch';
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState: null,
    });

    expect(delta).toBeNull();
    expect(mockApplyPaintPatch).not.toHaveBeenCalled();
    const missingBeforeReports = getPersistedCCMutationLog().filter(
      (entry) => entry.event === 'history-cc-before-state-missing'
    );
    expect(missingBeforeReports).toEqual([
      expect.objectContaining({
        event: 'history-cc-before-state-missing',
        layerId,
        reason: 'missing-backward-paint-patch',
        severity: 'warn',
        details: expect.objectContaining({
          source: 'history-color-cycle-stroke-patch',
          expectedDestructive: false,
          roi: { x: 0, y: 0, width: 2, height: 2 },
          forwardPaint: expect.objectContaining({
            byteLength: 4,
            nonZeroCount: 2,
          }),
        }),
      }),
    ]);
  });

  it('does not synthesize an empty undo patch from a layer shell with missing stroke data', async () => {
    const layerId = 'layer-cc-patch';
    const shellData = makeAnimatorState(2, 2);
    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [{
        layerId,
        data: {
          ...shellData,
          indexBuffer: undefined,
        },
      }],
    };
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState: backwardState as unknown as Parameters<
        typeof createColorCycleStrokePatchDelta
      >[0]['backwardState'],
    });

    expect(delta).toBeNull();
    expect(mockApplyPaintPatch).not.toHaveBeenCalled();
    const missingBeforeReports = getPersistedCCMutationLog().filter(
      (entry) => entry.event === 'history-cc-before-state-missing'
    );
    expect(missingBeforeReports).toEqual([
      expect.objectContaining({
        event: 'history-cc-before-state-missing',
        layerId,
        reason: 'missing-backward-paint-patch',
        severity: 'warn',
      }),
    ]);
  });

  it('preserves all-zero legacy index-buffer undo patches without stroke data', async () => {
    const layerId = 'layer-cc-patch';
    const backwardData = makeAnimatorState(2, 2);
    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [{
        layerId,
        data: {
          ...backwardData,
          indexBuffer: {
            ...backwardData.indexBuffer,
            data: new Uint8Array([0, 0, 0, 0]),
            gradientId: new Uint8Array([0, 0, 0, 0]),
            speedData: new Uint8Array([0, 0, 0, 0]),
            flowData: new Uint8Array([0, 0, 0, 0]),
            phaseData: new Uint8Array([0, 0, 0, 0]),
          },
        },
      }],
    };
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [0, 0, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockApplyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.speedBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.flowBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.phaseBytes ?? [])).toEqual([0, 0, 0, 0]);
  });

  it('synthesizes an empty undo patch for an explicitly empty first CC stroke state', async () => {
    const layerId = 'layer-cc-patch';
    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [{
        layerId,
        data: makeAnimatorState(2, 2),
        strokeData: {
          paintBuffer: new ArrayBuffer(0),
          hasContent: false,
          strokeCounter: 0,
        },
      }],
    };
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockApplyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(new Uint16Array(extras.gradientDefIdBytes?.buffer ?? new ArrayBuffer(0)))).toEqual([
      0,
      0,
      0,
      0,
    ]);
    expect(Array.from(extras.speedBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.flowBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.phaseBytes ?? [])).toEqual([0, 0, 0, 0]);
    const clearReports = getPersistedCCMutationLog().filter(
      (entry) => entry.event === 'color-cycle-layer-cleared'
    );
    expect(clearReports).toEqual([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId,
        reason: 'history-undo-patch',
        severity: 'info',
        details: expect.objectContaining({
          source: 'history-color-cycle-stroke-patch',
          operation: 'undo',
          expectedDestructive: true,
        }),
        stack: expect.stringContaining('color-cycle-layer-cleared'),
      }),
    ]);
  });
});
