import {
  COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS,
  createColorCycleStrokePatchDelta,
} from '@/history/deltas/colorCycleStrokePatchDelta';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import {
  HistoryReplayApplyError,
  HistoryReplayDriftError,
  HistoryReplayPreparationError,
} from '@/history/errors';
import HistoryManager from '@/history/historyManager';
import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS,
  COLOR_CYCLE_DOCUMENT_FIELD_MAPPING,
  ColorCycleLayerDocument,
  registerColorCycleBrushPaintPatchRuntime,
  cloneColorCycleBrushPersistenceLayerMeta,
  mergeColorCycleBrushPersistenceLayerMetaForOwner,
  setColorCycleBrushPersistenceLayerMeta,
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
  getColorCycleDerivedSurface: jest.fn(),
};
registerColorCycleBrushPaintPatchRuntime(mockBrush, {
  apply: mockApplyPaintPatch,
});
let mockHistoryBrush: typeof mockBrush | null = mockBrush;
let mockRealDocument: ColorCycleLayerDocument | undefined;
let mockDocumentVersion: number | undefined;
let mockPixelVersion: number | undefined;
let mockDocumentSnapshot: never = {} as never;
const mockRebaseVersionAnchors = jest.fn((options: { version?: number; pixelVersion?: number }) => {
  if (typeof options.version === 'number') {
    mockDocumentVersion = options.version;
  }
  if (typeof options.pixelVersion === 'number') {
    mockPixelVersion = options.pixelVersion;
  }
  return {
    snapshot: mockDocumentSnapshot,
    version: mockDocumentVersion ?? 0,
    pixelVersion: mockPixelVersion ?? mockDocumentVersion ?? 0,
  };
});

const mockDeleteBrush = jest.fn((layerId: string) => {
  void layerId;
  mockHistoryBrush = null;
});

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => ({
    getHistoryBrush: () => mockHistoryBrush,
    hasBrush: () => mockHistoryBrush !== null,
    deleteBrush: (layerId: string) => mockDeleteBrush(layerId),
    registerDocument: jest.fn(),
    getPlaybackBrush: () => null,
    getDocument: () => mockRealDocument ?? (
      typeof mockDocumentVersion === 'number'
        ? {
            read: () => ({
              snapshot: mockDocumentSnapshot,
              version: mockDocumentVersion,
              pixelVersion: mockPixelVersion ?? mockDocumentVersion,
            }),
            rebaseVersionAnchors: mockRebaseVersionAnchors,
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
    mockRealDocument = undefined;
    mockDocumentVersion = undefined;
    mockPixelVersion = undefined;
    mockDocumentSnapshot = {} as never;
    mockHistoryBrush = mockBrush;
    mockBrush.getColorCycleDerivedSurface.mockReturnValue(null);
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
    await replayDeltaForTest(delta!, 'backward');

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

  it('restores independent metadata snapshots before each patch, including removed and undefined fields', async () => {
    const layerId = 'layer-cc-patch';
    const makeMetadataState = (paint: number, color: string, withUnusedSlot: boolean) => {
      const state = makeState({
        layerId, width: 2, height: 2, paint: [paint, 0, 0, 0], gradientId: [0, 0, 0, 0],
        gradientDefId: [1, 0, 0, 0], speed: [0, 0, 0, 0], flow: [0, 0, 0, 0], phase: [0, 0, 0, 0],
      });
      return { ...state, layers: [{
        ...state.layers[0],
        gradientDefs: [{ id: 'g0', name: color, currentSlot: 0 }],
        slotPalettes: [
          { slot: 0, stops: [{ position: 0, color, opacity: 0.5 }], seamProfile: 'hard' as const },
          ...(withUnusedSlot ? [{ slot: 1, stops: [{ position: 0, color: '#ffffff' }], seamProfile: 'soft' as const }] : []),
        ],
        gradientDefStore: [{
          id: 1, kind: 'linear' as const, stops: [{ position: 0, color }],
          sourceStops: [{ position: 0, color: '#abcdef', opacity: 0.25 }],
          sampledPath: { rgba: 'ESIz/w==', offset: 7 },
          hash: color, source: 'manual' as const, createdAtMs: 123, slot: 0, speedCps: 0.5,
          seamProfile: 'hard' as const,
        }],
        nextGradientDefId: 2, paintSlot: 0, activeGradientId: 'g0',
        fgActiveSlot: withUnusedSlot ? 1 : undefined,
        fgDerivedKey: withUnusedSlot ? 'before-key' : undefined,
        fgDerivedGradients: withUnusedSlot ? [{
          key: 'fg-key', slot: 1,
          spec: { mode: 'fg-derived' as const, baseColor: '#112233', lightness: 0.5, bands: 3, algoVersion: 1, key: 'fg-key' },
        }] : undefined,
        derivedGradients: [{
          key: 'derived-key', slot: 0,
          spec: { mode: 'fg-derived' as const, baseColor: color, lightness: 0.25, bands: 4, algoVersion: 1, key: 'derived-key' },
        }],
      }] };
    };
    const backwardState = makeMetadataState(1, '#112233', true);
    const forwardState = makeMetadataState(0, '#445566', false);
    const beforeMetadata = cloneColorCycleBrushPersistenceLayerMeta(backwardState.layers[0]);
    const afterMetadata = cloneColorCycleBrushPersistenceLayerMeta(forwardState.layers[0]);
    const delta = await createColorCycleStrokePatchDelta({
      layerId, width: 2, height: 2, roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState, backwardState,
    });
    expect(delta).not.toBeNull();
    backwardState.layers[0].slotPalettes[0].stops[0].color = '#badbad';
    backwardState.layers[0].gradientDefStore[0].sampledPath.offset = 99;
    backwardState.layers[0].fgDerivedGradients![0].spec.baseColor = '#badbad';
    forwardState.layers[0].gradientDefStore[0].sourceStops[0].color = '#badbad';
    const observedMetadata: unknown[] = [];
    mockApplyPaintPatch.mockImplementationOnce((_id, _roi, bytes) => {
      const metadata = useAppStore.getState().layers[0].colorCycleData;
      observedMetadata.push(cloneColorCycleBrushPersistenceLayerMeta(metadata));
      observedMetadata.push(mergeColorCycleBrushPersistenceLayerMetaForOwner(mockBrush, layerId, null));
      return bytes.some((value) => value !== 0);
    });
    await replayDeltaForTest(delta!, 'backward');
    expect(observedMetadata).toEqual([beforeMetadata, beforeMetadata]);
    expect(cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData))
      .toEqual(beforeMetadata);
    useAppStore.getState().layers[0].colorCycleData!.slotPalettes![0].stops[0].color = '#badbad';
    await replayDeltaForTest(delta!, 'forward');
    expect(cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData))
      .toEqual(afterMetadata);
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(mockBrush, layerId, null)).toEqual(afterMetadata);
    await replayDeltaForTest(delta!, 'backward');
    expect(cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData))
      .toEqual(beforeMetadata);
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
    await expect(replayDeltaForTest(delta!, 'backward')).rejects.toBeInstanceOf(HistoryReplayDriftError);

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

  it('reports no compensation when the replay anchor drifts after preparation', async () => {
    const layerId = 'layer-cc-patch';
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 0, 0, 0],
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
      paint: [2, 0, 0, 0],
      gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });
    mockDocumentVersion = 2;
    mockPixelVersion = 2;
    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState,
      backwardState,
      beforeVersion: 1,
      afterVersion: 2,
    });
    expect(delta).not.toBeNull();
    const prepared = await delta!.prepare('backward');

    mockPixelVersion = 3;
    await expect(prepared.apply()).rejects.toBeInstanceOf(HistoryReplayDriftError);

    expect(prepared.requiresCompensation()).toBe(false);
    expect(mockApplyPaintPatch).not.toHaveBeenCalled();
  });

  it('rebases document anchors to the target history state after applying a patch', async () => {
    const layerId = 'layer-cc-patch';
    mockDocumentVersion = 21;
    mockPixelVersion = 2;
    mockDocumentSnapshot = { layerId } as never;
    const derivedSurface = {
      builtFromVersion: 22,
      rebuild: jest.fn(),
    };
    mockBrush.getColorCycleDerivedSurface.mockReturnValue(derivedSurface);
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 0, 0, 0],
      gradientId: [1, 0, 0, 0],
      gradientDefId: [1, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [2, 0, 0, 0],
      gradientId: [2, 0, 0, 0],
      gradientDefId: [2, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState,
      backwardState,
      beforeDocumentVersion: 20,
      afterDocumentVersion: 21,
      beforeVersion: 1,
      afterVersion: 2,
    });

    expect(delta).not.toBeNull();
    await replayDeltaForTest(delta!, 'backward');

    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(1);
    expect(mockRebaseVersionAnchors).toHaveBeenCalledWith({
      version: 20,
      pixelVersion: 1,
    });
    expect(derivedSurface.rebuild).toHaveBeenCalledWith(mockDocumentSnapshot, 20);
    expect(mockDocumentVersion).toBe(20);
    expect(mockPixelVersion).toBe(1);
  });

  it('allows adjacent patch entries to undo sequentially after replay re-anchors the document', async () => {
    const layerId = 'layer-cc-patch';
    mockDocumentVersion = 2;
    mockPixelVersion = 2;
    const state0 = makeState({
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
    const state1 = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 0, 0, 0],
      gradientId: [1, 0, 0, 0],
      gradientDefId: [1, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });
    const state2 = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [2, 0, 0, 0],
      gradientId: [2, 0, 0, 0],
      gradientDefId: [2, 0, 0, 0],
      speed: [0, 0, 0, 0],
      flow: [0, 0, 0, 0],
      phase: [0, 0, 0, 0],
    });
    const firstDelta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: state1,
      backwardState: state0,
      beforeDocumentVersion: 0,
      afterDocumentVersion: 1,
      beforeVersion: 0,
      afterVersion: 1,
    });
    const secondDelta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: state2,
      backwardState: state1,
      beforeDocumentVersion: 1,
      afterDocumentVersion: 2,
      beforeVersion: 1,
      afterVersion: 2,
    });

    expect(firstDelta).not.toBeNull();
    expect(secondDelta).not.toBeNull();
    await replayDeltaForTest(secondDelta!, 'backward');
    await expect(replayDeltaForTest(firstDelta!, 'backward')).resolves.toBeUndefined();

    expect(mockRebaseVersionAnchors).toHaveBeenLastCalledWith({
      version: 0,
      pixelVersion: 0,
    });
  });

  it('compensates a real CC patch when a later delta fails in the same entry', async () => {
    const layerId = 'layer-cc-patch';
    const before = makeState({
      layerId, width: 2, height: 2, paint: [0, 0, 0, 0], gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0], speed: [0, 0, 0, 0], flow: [0, 0, 0, 0], phase: [0, 0, 0, 0],
    });
    const after = makeState({
      layerId, width: 2, height: 2, paint: [9, 0, 0, 0], gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0], speed: [0, 0, 0, 0], flow: [0, 0, 0, 0], phase: [0, 0, 0, 0],
    });
    const beforeMetadata = {
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#112233' }], seamProfile: 'hard' as const }],
      paintSlot: 0, activeGradientId: 'g0',
    };
    const afterMetadata = {
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#445566' }], seamProfile: 'soft' as const }],
      paintSlot: 0, activeGradientId: 'g0',
    };
    Object.assign(before.layers[0], beforeMetadata);
    Object.assign(after.layers[0], afterMetadata);
    const metadataSeenByPatches: unknown[] = [];
    mockApplyPaintPatch.mockImplementationOnce((_id, _roi, bytes) => {
      metadataSeenByPatches.push(cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData));
      return bytes.some((value) => value !== 0);
    }).mockImplementationOnce((_id, _roi, bytes) => {
      metadataSeenByPatches.push(cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData));
      return bytes.some((value) => value !== 0);
    });
    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: after,
      backwardState: before,
      beforeDocumentVersion: 0,
      afterDocumentVersion: 1,
      beforeVersion: 0,
      afterVersion: 1,
    });
    expect(delta).not.toBeNull();
    mockDocumentVersion = 1;
    mockPixelVersion = 1;

    const preReplayColorCycleData = {
      ...useAppStore.getState().layers[0].colorCycleData!,
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#778899' }] }],
      gradientDefStore: [], paintSlot: 0, activeGradientId: 'g0',
    };
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) => ({ ...layer, colorCycleData: preReplayColorCycleData })),
    }));
    const preReplayCache = {
      ...afterMetadata,
      slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#abcdef' }], seamProfile: 'hard' as const }],
    };
    setColorCycleBrushPersistenceLayerMeta(mockBrush, layerId, preReplayCache);

    class LateFailureDelta implements HistoryDelta {
      readonly _tag = 'late-failure';
      apply(direction: HistoryDirection): void {
        void direction;
        throw new Error('late failure');
      }
      prepare(direction: HistoryDirection): PreparedHistoryDelta {
        return {
          deltaTag: this._tag,
          apply: () => this.apply(direction),
          requiresCompensation: () => false,
          compensate: () => undefined,
        };
      }
    }

    const manager = new HistoryManager();
    const txn = manager.begin('cc-stroke');
    txn.push(new LateFailureDelta());
    txn.push(delta!);
    txn.commit('CC patch and late failure');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(mockDocumentVersion).toBe(1);
    expect(mockPixelVersion).toBe(1);
    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(2);
    const [, , compensatedPaint] = mockApplyPaintPatch.mock.calls[1] as [unknown, unknown, Uint8Array];
    expect(Array.from(compensatedPaint)).toEqual([9]);
    expect(metadataSeenByPatches).toEqual([
      cloneColorCycleBrushPersistenceLayerMeta(beforeMetadata),
      cloneColorCycleBrushPersistenceLayerMeta(afterMetadata),
    ]);
    expect(useAppStore.getState().layers[0].colorCycleData).toBe(preReplayColorCycleData);
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(mockBrush, layerId, null))
      .toEqual(cloneColorCycleBrushPersistenceLayerMeta(preReplayCache));
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it.each([false, true])('restores real document metadata, audit and dirty state after late failure (pending dirty: %s)', async (hasPendingDirty) => {
    const layerId = 'layer-cc-patch';
    const before = makeState({
      layerId, width: 2, height: 2, paint: [1, 2, 3, 4], gradientId: [1, 1, 1, 1],
      gradientDefId: [257, 257, 257, 257], speed: [5, 6, 7, 8], flow: [9, 10, 11, 12], phase: [13, 14, 15, 16],
    });
    const after = makeState({
      layerId, width: 2, height: 2, paint: [21, 2, 3, 4], gradientId: [2, 1, 1, 1],
      gradientDefId: [513, 257, 257, 257], speed: [25, 6, 7, 8], flow: [29, 10, 11, 12], phase: [33, 14, 15, 16],
    });
    const beforeMetadata = {
      gradientDefs: [{ id: 'g0', currentSlot: 1 }],
      slotPalettes: [{ slot: 1, stops: [{ position: 0, color: '#112233' }], seamProfile: 'hard' as const }],
      paintSlot: 1, activeGradientId: 'g0',
    };
    const afterMetadata = {
      gradientDefs: [{ id: 'g0', currentSlot: 2 }],
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#445566' }], seamProfile: 'soft' as const }],
      paintSlot: 2, activeGradientId: 'g0',
    };
    Object.assign(before.layers[0], beforeMetadata);
    Object.assign(after.layers[0], afterMetadata);
    const buffers = after.layers[0].strokeData;
    const canonicalDocument = new ColorCycleLayerDocument({
      layerId, width: 2, height: 2,
      paintBuffer: buffers.paintBuffer,
      gradientIdBuffer: buffers.gradientIdBuffer,
      gradientDefIdBuffer: buffers.gradientDefIdBuffer,
      speedBuffer: buffers.speedBuffer,
      flowBuffer: buffers.flowBuffer,
      phaseBuffer: buffers.phaseBuffer,
      ...afterMetadata,
      hasContent: true,
      sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
    }, { initialVersion: 1, initialPixelVersion: 1, now: () => 1234 });
    // A palette edit after the stroke must survive failed Undo, including its envelope.
    const independentMetadata = {
      ...afterMetadata,
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#778899' }], seamProfile: 'hard' as const }],
    };
    canonicalDocument.replaceState({
      ...canonicalDocument.read().snapshot,
      ...independentMetadata,
    }, 'independent-palette-edit', { dirtyRects: [{ x: 1, y: 1, width: 1, height: 1 }] });
    if (!hasPendingDirty) {
      canonicalDocument.consumeDirtyBatch();
    }
    mockRealDocument = canonicalDocument;
    const preReplayRead = canonicalDocument.read();
    const preReplayAudit = canonicalDocument.getAuditLog();
    const preReplayDirty = canonicalDocument.peekDirtyBatch();
    expect(preReplayRead).toMatchObject({ version: 2, pixelVersion: 1 });
    expect(preReplayAudit).toHaveLength(1);
    expect(Boolean(preReplayDirty)).toBe(hasPendingDirty);
    const preReplayLayerData = {
      ...useAppStore.getState().layers[0].colorCycleData!,
      ...independentMetadata,
    };
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) => ({ ...layer, colorCycleData: preReplayLayerData })),
    }));
    setColorCycleBrushPersistenceLayerMeta(mockBrush, layerId, independentMetadata);
    const derivedSurface = { builtFromVersion: 2, rebuild: jest.fn() };
    mockBrush.getColorCycleDerivedSurface.mockReturnValue(derivedSurface);
    const observedSnapshots: unknown[] = [];
    const applyToDocument = (_id: string, _roi: unknown, paint: Uint8Array, extras?: PatchExtras) => {
      const metadata = cloneColorCycleBrushPersistenceLayerMeta(useAppStore.getState().layers[0].colorCycleData);
      canonicalDocument.replaceState({
        ...canonicalDocument.read().snapshot,
        gradientDefs: metadata?.gradientDefs,
        slotPalettes: metadata?.slotPalettes as typeof independentMetadata.slotPalettes,
        paintSlot: metadata?.paintSlot,
        activeGradientId: metadata?.activeGradientId,
        paintBuffer: new Uint8Array([paint[0], 2, 3, 4]).buffer,
        gradientIdBuffer: new Uint8Array([extras!.gradientIdBytes![0], 1, 1, 1]).buffer,
        gradientDefIdBuffer: new Uint16Array([
          new Uint16Array(extras!.gradientDefIdBytes!.buffer)[0], 257, 257, 257,
        ]).buffer,
        speedBuffer: new Uint8Array([extras!.speedBytes![0], 6, 7, 8]).buffer,
        flowBuffer: new Uint8Array([extras!.flowBytes![0], 10, 11, 12]).buffer,
        phaseBuffer: new Uint8Array([extras!.phaseBytes![0], 14, 15, 16]).buffer,
      }, 'history-patch-publication', { dirtyRects: [{ x: 0, y: 0, width: 1, height: 1 }] });
      observedSnapshots.push(canonicalDocument.read().snapshot);
      return true;
    };
    mockApplyPaintPatch.mockImplementationOnce(applyToDocument).mockImplementationOnce(applyToDocument);
    const delta = await createColorCycleStrokePatchDelta({
      layerId, width: 2, height: 2, roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: after, backwardState: before,
      beforeDocumentVersion: 0, afterDocumentVersion: 1, beforeVersion: 0, afterVersion: 1,
    });
    expect(delta).not.toBeNull();
    const lateFailure: HistoryDelta = {
      _tag: 'real-document-late-failure',
      prepare: () => ({
        deltaTag: 'real-document-late-failure',
        apply: () => { throw new Error('late failure'); },
        requiresCompensation: () => false,
        compensate: () => undefined,
      }),
    };
    const manager = new HistoryManager();
    const txn = manager.begin('cc-stroke');
    txn.push(lateFailure);
    txn.push(delta!);
    txn.commit('Real document patch and late failure');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(mockApplyPaintPatch).toHaveBeenCalledTimes(2);
    expect(observedSnapshots).toEqual([
      expect.objectContaining(beforeMetadata), expect.objectContaining(afterMetadata),
    ]);
    for (const { documentKey } of COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS) {
      expect(new Uint8Array(canonicalDocument.read().snapshot[documentKey]!))
        .toEqual(new Uint8Array(preReplayRead.snapshot[documentKey]!));
    }
    expect(canonicalDocument.read()).toEqual(preReplayRead);
    expect(canonicalDocument.getAuditLog()).toEqual(preReplayAudit);
    expect(canonicalDocument.peekDirtyBatch()).toEqual(preReplayDirty);
    expect(useAppStore.getState().layers[0].colorCycleData).toBe(preReplayLayerData);
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(mockBrush, layerId, null))
      .toEqual(cloneColorCycleBrushPersistenceLayerMeta(independentMetadata));
    expect(derivedSurface.rebuild).toHaveBeenLastCalledWith(preReplayRead.snapshot, preReplayRead.version);
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it('removes a runtime created during a compensated replay', async () => {
    const layerId = 'layer-cc-patch';
    const before = makeState({
      layerId, width: 2, height: 2, paint: [0, 0, 0, 0], gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0], speed: [0, 0, 0, 0], flow: [0, 0, 0, 0], phase: [0, 0, 0, 0],
    });
    const after = makeState({
      layerId, width: 2, height: 2, paint: [7, 0, 0, 0], gradientId: [0, 0, 0, 0],
      gradientDefId: [0, 0, 0, 0], speed: [0, 0, 0, 0], flow: [0, 0, 0, 0], phase: [0, 0, 0, 0],
    });
    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: after,
      backwardState: before,
      beforeVersion: 0,
      afterVersion: 1,
    });
    expect(delta).not.toBeNull();

    const originalInit = useAppStore.getState().initColorCycleForLayer;
    const initialLayers = useAppStore.getState().layers;
    const initColorCycleForLayer = jest.fn(() => {
      mockHistoryBrush = mockBrush;
      useAppStore.setState((state) => ({
        layers: state.layers.map((layer) => layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...layer.colorCycleData!,
                isAnimating: true,
              },
            }
          : layer),
      }));
    });
    mockHistoryBrush = null;
    useAppStore.setState({ initColorCycleForLayer });

    class LateFailureDelta implements HistoryDelta {
      readonly _tag = 'late-failure';
      prepare(): PreparedHistoryDelta {
        return {
          deltaTag: this._tag,
          apply: () => { throw new Error('late failure'); },
          requiresCompensation: () => false,
          compensate: () => undefined,
        };
      }
    }

    try {
      const manager = new HistoryManager();
      const txn = manager.begin('cc-stroke');
      txn.push(new LateFailureDelta());
      txn.push(delta!);
      txn.commit('Cold CC patch and late failure');

      await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);

      expect(initColorCycleForLayer).toHaveBeenCalledTimes(1);
      expect(mockDeleteBrush).toHaveBeenCalledWith(layerId);
      expect(mockHistoryBrush).toBeNull();
      expect(useAppStore.getState().layers).toBe(initialLayers);
    } finally {
      useAppStore.setState({ initColorCycleForLayer: originalInit });
    }
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
    await expect(replayDeltaForTest(delta!, 'forward')).rejects.toBeInstanceOf(HistoryReplayDriftError);
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
    await replayDeltaForTest(delta!, 'backward');

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
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayPreparationError);
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
    await replayDeltaForTest(delta!, 'backward');

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
    await replayDeltaForTest(delta!, 'backward');

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
