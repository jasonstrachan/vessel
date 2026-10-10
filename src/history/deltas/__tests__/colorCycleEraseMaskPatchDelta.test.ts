import { createColorCycleEraseMaskPatchDelta } from '@/history/deltas/colorCycleEraseMaskPatchDelta';
import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  ColorCycleLayerDocument,
  getColorCycleBrushStrokeStateForOwner,
  registerColorCycleBrushPaintPatchRuntime,
} from '@/lib/colorCycle/document';
import { createColorCycleStrokePatchDelta } from '@/history/deltas/colorCycleStrokePatchDelta';
import { HistoryReplayApplyError, HistoryReplayDriftError } from '@/history/errors';
import HistoryManager from '@/history/historyManager';
import type { HistoryDelta } from '@/history/actionTypes';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import type { ColorCycleBrushConstructor } from '@/hooks/brushEngine/colorCycleBrushContracts';
import { createColorCycleBrushRegistry } from '@/stores/colorCycleBrushRegistry';
import { createLayerActivationActions } from '@/stores/layers/layerActivationActions';
import { defaultBrushSettings } from '@/presets/brushPresets';

const readMaskAlpha = (canvas: HTMLCanvasElement, x: number, y: number): number => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return 0;
  }
  return ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
};

const makeState = (
  layerId: string,
  width: number,
  height: number,
  alpha: number[],
  version: number
): ColorCycleSerializedState => {
  const animatorState = new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

  return ({
  cycleSpeed: 1,
  fps: 30,
  brushSize: 1,
  layers: [
    {
      layerId,
      data: animatorState,
      strokeData: {
        paintBuffer: new Uint8Array(width * height).buffer,
        hasContent: false,
        strokeCounter: 0,
      },
      eraseMaskSnapshot: {
        width,
        height,
        alpha: new Uint8ClampedArray(alpha),
        version,
      },
    },
  ],
  });
};

describe('ColorCycleEraseMaskPatchDelta', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    const width = 4;
    const height = 4;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;

    const layer: Layer = {
      id: 'layer-cc-mask',
      name: 'CC Layer',
      order: 0,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      colorCycleData: {
        canvas,
        gradient: [],
        mode: 'brush',
        hasContent: false,
        eraseMask: mask,
        eraseMaskVersion: 0,
      },
      version: 1,
    };

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      project: state.project
        ? { ...state.project, width, height, layers: [layer] }
        : state.project,
    }));
  });

  it('restores erase mask ROI alpha on undo/redo', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-mask';
    const index = 1 * width + 1;
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[index] = 255;
    const backwardAlpha = new Array(width * height).fill(0);

    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId,
      width,
      height,
      roi: { x: 0, y: 0, width, height },
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, backwardAlpha, 1),
    });

    expect(delta).not.toBeNull();

    const mask = useAppStore.getState().layers[0]?.colorCycleData?.eraseMask as HTMLCanvasElement;
    expect(readMaskAlpha(mask, 1, 1)).toBe(0);

    await replayDeltaForTest(delta!, 'forward');
    expect(readMaskAlpha(mask, 1, 1)).toBe(255);
    expect(useAppStore.getState().layers[0]?.colorCycleData?.eraseMaskVersion).toBe(2);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 0, y: 0, width, height }],
      },
    ]);

    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });
    await replayDeltaForTest(delta!, 'backward');
    expect(readMaskAlpha(mask, 1, 1)).toBe(0);
    expect(useAppStore.getState().layers[0]?.colorCycleData?.eraseMaskVersion).toBe(1);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 0, y: 0, width, height }],
      },
    ]);
  });

  it('treats a missing pre-erase mask as a transparent mask', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-mask';
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[5] = 255;
    const backwardState = makeState(
      layerId,
      width,
      height,
      new Array(width * height).fill(0),
      0,
    );
    delete backwardState?.layers[0]?.eraseMaskSnapshot;

    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId,
      width,
      height,
      roi: { x: 0, y: 0, width, height },
      forwardState: makeState(layerId, width, height, forwardAlpha, 1),
      backwardState,
    });

    expect(delta).not.toBeNull();
    const mask = useAppStore.getState().layers[0]?.colorCycleData?.eraseMask as HTMLCanvasElement;

    await replayDeltaForTest(delta!, 'forward');
    expect(readMaskAlpha(mask, 1, 1)).toBe(255);

    await replayDeltaForTest(delta!, 'backward');
    expect(readMaskAlpha(mask, 1, 1)).toBe(0);
    expect(useAppStore.getState().layers[0]?.colorCycleData?.eraseMaskVersion).toBe(0);
  });

  it.each([
    ['forward', 1],
    ['backward', 2],
  ] as const)('accepts %s replay at its pre-replay document version', async (direction, documentVersion) => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-mask';
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[5] = 255;
    const backwardAlpha = new Array(width * height).fill(0);

    const document = new ColorCycleLayerDocument({
      layerId, width, height, hasContent: false,
      sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
    }, { initialVersion: documentVersion });
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: () => document,
    } as never);

    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId,
      width,
      height,
      roi: { x: 0, y: 0, width, height },
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, backwardAlpha, 1),
      beforeVersion: 1,
      afterVersion: 2,
    });

    await expect(replayDeltaForTest(delta!, direction)).resolves.toBeUndefined();
  });

  it('restores document anchors for repeated overlapping mask undo/redo', async () => {
    const layerId = 'layer-cc-mask';
    const document = new ColorCycleLayerDocument({
      layerId, width: 4, height: 4,
      paintBuffer: new Uint8Array(16).fill(1).buffer,
      hasContent: true,
      sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
    }, { initialVersion: 5, initialPixelVersion: 4 });
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: () => document,
    } as never);
    const canonicalBefore = document.read().snapshot;
    const forwardAlpha = new Array(16).fill(0);
    forwardAlpha[5] = 192;
    forwardAlpha[10] = 128;
    const backwardAlpha = [...forwardAlpha];
    backwardAlpha[5] = 128;
    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId, width: 4, height: 4,
      roi: { x: 1, y: 1, width: 1, height: 1 },
      forwardState: { ...makeState(layerId, 4, 4, forwardAlpha, 3)!, documentVersion: 5, pixelVersion: 4 },
      backwardState: { ...makeState(layerId, 4, 4, backwardAlpha, 2)!, documentVersion: 4, pixelVersion: 3 },
      beforeVersion: 4, afterVersion: 5,
    });
    const mask = useAppStore.getState().layers[0]!.colorCycleData!.eraseMask!;
    const ctx = mask.getContext('2d')!;
    const initial = ctx.createImageData(4, 4);
    for (let index = 0; index < 16; index++) initial.data[index * 4 + 3] = forwardAlpha[index];
    ctx.putImageData(initial, 0, 0);

    for (let iteration = 0; iteration < 2; iteration++) {
      await replayDeltaForTest(delta!, 'backward');
      expect(readMaskAlpha(mask, 1, 1)).toBe(128);
      expect(document.read().version).toBe(4);
      expect(document.read().pixelVersion).toBe(3);
      await replayDeltaForTest(delta!, 'forward');
      expect(readMaskAlpha(mask, 1, 1)).toBe(192);
      expect(readMaskAlpha(mask, 2, 2)).toBe(128);
      expect(document.read().version).toBe(5);
      expect(document.read().pixelVersion).toBe(4);
      expect(document.read().snapshot).toBe(canonicalBefore);
    }

    document.rebaseVersionAnchors({ version: 6 });
    await expect(replayDeltaForTest(delta!, 'backward')).rejects.toBeInstanceOf(HistoryReplayDriftError);
    expect(readMaskAlpha(mask, 1, 1)).toBe(192);
    expect(document.read().version).toBe(6);
  });


  it.each(['adjacent', 'combined'] as const)(
    'restores pixel anchors with %s indexed paint history', async (mode) => {
    const layerId = 'layer-cc-mask';
    const paint = new Uint8Array(16);
    paint[0] = 9;
    const document = new ColorCycleLayerDocument({
      layerId, width: 4, height: 4, paintBuffer: paint.buffer, hasContent: true,
      sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
    }, { initialVersion: 4, initialPixelVersion: 3 });
    const brush = { updateColorCycleTexture: jest.fn(), commitToLayer: jest.fn() };
    registerColorCycleBrushPaintPatchRuntime(brush, {
      apply: (_layerId, _roi, bytes) => {
        const txn = document.beginTransaction('history-restore');
        txn.mutate(draft => {
          new Uint8Array(draft.paintBuffer!)[0] = bytes[0];
          draft.hasContent = bytes[0] !== 0;
        });
        txn.commit();
        return bytes[0] !== 0;
      },
    });
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: () => document,
      getHistoryBrush: () => brush,
      getPlaybackBrush: () => null,
      hasBrush: () => true,
    } as never);
    const beforePaint = makeState(layerId, 4, 4, new Array(16).fill(0), 0)!;
    const afterPaint = makeState(layerId, 4, 4, new Array(16).fill(0), 0)!;
    afterPaint.layers[0].strokeData!.paintBuffer = new Uint8Array(paint).buffer;
    const indexedDelta = await createColorCycleStrokePatchDelta({
      layerId, width: 4, height: 4, roi: { x: 0, y: 0, width: 1, height: 1 },
      forwardState: afterPaint, backwardState: beforePaint,
      beforeDocumentVersion: 2, afterDocumentVersion: mode === 'combined' ? 4 : 3,
      beforeVersion: 1, afterVersion: mode === 'combined' ? 3 : 2,
    });
    const maskAlpha = new Array(16).fill(0);
    maskAlpha[5] = 128;
    const maskDelta = await createColorCycleEraseMaskPatchDelta({
      layerId, width: 4, height: 4, roi: { x: 1, y: 1, width: 1, height: 1 },
      forwardState: { ...makeState(layerId, 4, 4, maskAlpha, 1)!, documentVersion: 4, pixelVersion: 3 },
      backwardState: { ...afterPaint,
        documentVersion: mode === 'combined' ? 2 : 3,
        pixelVersion: mode === 'combined' ? 1 : 2,
      },
      restoreDocumentAnchors: mode !== 'combined',
    });
    expect(indexedDelta).not.toBeNull();
    expect(maskDelta).not.toBeNull();

    const makeManager = () => new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async () => undefined,
      },
    });
    const manager = makeManager();
    if (mode === 'combined') {
      const txn = manager.begin('cc-stroke');
      txn.push(indexedDelta!);
      txn.push(maskDelta!);
      txn.commit('Indexed paint and erase mask');
      await manager.undo();
    } else {
      await replayDeltaForTest(maskDelta!, 'backward');
      await replayDeltaForTest(indexedDelta!, 'backward');
    }
    expect(document.read().pixelVersion).toBe(1);
    expect(new Uint8Array(document.read().snapshot.paintBuffer!)[0]).toBe(0);
    if (mode === 'combined') {
      await manager.redo();
    } else {
      await replayDeltaForTest(indexedDelta!, 'forward');
      expect(document.read().pixelVersion).toBe(2);
      await replayDeltaForTest(maskDelta!, 'forward');
    }
    expect(new Uint8Array(document.read().snapshot.paintBuffer!)[0]).toBe(9);
    expect(document.read().version).toBe(4);
    expect(document.read().pixelVersion).toBe(3);
    const mask = useAppStore.getState().layers[0]!.colorCycleData!.eraseMask!;
    expect(readMaskAlpha(mask, 1, 1)).toBe(128);

    if (mode === 'combined') {
      const failure: HistoryDelta = {
        _tag: 'late-failure',
        prepare: async () => ({
          deltaTag: 'late-failure',
          apply: () => { throw new Error('late failure'); },
          requiresCompensation: () => false,
          compensate: () => undefined,
        }),
      };
      const failingManager = makeManager();
      const txn = failingManager.begin('cc-stroke');
      txn.push(failure);
      txn.push(indexedDelta!);
      txn.push(maskDelta!);
      txn.commit('Indexed paint and mask with late failure');
      await expect(failingManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
      expect(document.read().version).toBe(4);
      expect(document.read().pixelVersion).toBe(3);
      expect(new Uint8Array(document.read().snapshot.paintBuffer!)[0]).toBe(9);
      expect(readMaskAlpha(mask, 1, 1)).toBe(128);
      expect(failingManager.entries()).toHaveLength(1);
    }

  });

  describe('real CC source deactivation with erase history', () => {
    const createActivationFixture = () => {
      const layerId = 'layer-cc-mask';
      const registry = createColorCycleBrushRegistry({
        getBrushSettings: () => defaultBrushSettings,
        getPlaybackSpeedScale: () => 1,
        getLayers: () => useAppStore.getState().layers,
        createCanvas: (width, height) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        },
        getBrushClass: () => ColorCycleBrushCanvas2D as unknown as ColorCycleBrushConstructor,
        shouldForceCanvas2D: () => true,
      });
      jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue(registry);
      const brush = registry.createBrush(layerId, 4, 4) as unknown as ColorCycleBrushCanvas2D;
      brush.setGradient([{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }], layerId);
      brush.setStampShape('square');
      brush.setBrushSize(1);
      brush.setStampDitherEnabled(false);
      brush.startStroke(layerId);
      brush.paint(1, 1, layerId, 1, 0, 0.5);
      brush.endStroke(layerId);
      const canonical = registry.getDocument(layerId)!;
      expect(canonical.read().snapshot.hasContent).toBe(true);
      expect(new Uint8Array(canonical.read().snapshot.paintBuffer!)[1 * 4 + 1]).toBeGreaterThan(0);
      const source = useAppStore.getState().layers[0]!;
      useAppStore.setState({
        layers: [source, {
          ...source,
          id: 'layer-raster',
          name: 'Raster destination',
          layerType: 'normal',
          colorCycleData: undefined,
          order: 1,
        }],
        activeLayerId: layerId,
        selectedLayerIds: [layerId],
      });
      const activation = createLayerActivationActions({
        set: useAppStore.setState,
        get: useAppStore.getState,
        colorCycleBrushManager: registry,
        scheduleDeferredColorCycleRestore: async () => undefined,
      });
      return { layerId, registry, brush, canonical, activation };
    };

    it('keeps a completed source generation undoable after real layer deactivation', async () => {
      const { layerId, registry, canonical, activation } = createActivationFixture();
      const history = new HistoryManager({
        runtimeRehydration: {
          createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
          rehydrate: async () => undefined,
        },
      });
      try {
        const read = canonical.read();
        const audit = canonical.getAuditLog();
        const before = { ...makeState(layerId, 4, 4, new Array(16).fill(0), 0)!,
          documentVersion: read.version, pixelVersion: read.pixelVersion };
        const alpha = new Array(16).fill(0);
        alpha[5] = 128;
        const after = { ...makeState(layerId, 4, 4, alpha, 1)!,
          documentVersion: read.version, pixelVersion: read.pixelVersion };
        const delta = await createColorCycleEraseMaskPatchDelta({
          layerId, width: 4, height: 4, roi: { x: 1, y: 1, width: 1, height: 1 },
          forwardState: after, backwardState: before,
        });
        expect(delta).not.toBeNull();
        await replayDeltaForTest(delta!, 'forward');
        const transaction = history.begin('eraser-stroke');
        transaction.push(delta!);
        transaction.commit('Erase populated CC source');
        const mask = useAppStore.getState().layers.find(layer => layer.id === layerId)!.colorCycleData!.eraseMask!;
        expect(readMaskAlpha(mask, 1, 1)).toBe(128);

        activation.setActiveLayer('layer-raster');
        expect(useAppStore.getState().activeLayerId).toBe('layer-raster');
        // This is the reported failing seam: completed eraser history followed
        // by actual activation cleanup, then real history preparation/apply.
        await expect(history.undo()).resolves.toMatchObject({ action: 'eraser-stroke' });
        expect(readMaskAlpha(mask, 1, 1)).toBe(0);
        await expect(history.redo()).resolves.toMatchObject({ action: 'eraser-stroke' });
        expect(readMaskAlpha(mask, 1, 1)).toBe(128);
        expect(canonical.read()).toEqual(read);
        expect(canonical.getAuditLog()).toEqual(audit);

        const externalEdit = canonical.beginTransaction('external-base-speed-edit');
        externalEdit.updateScalarMetadata({ layerBaseSpeedCps: 2 });
        externalEdit.commit();
        expect(canonical.read().version).toBe(read.version + 1);
        await expect(delta!.prepare('backward')).rejects.toBeInstanceOf(HistoryReplayDriftError);
        expect(readMaskAlpha(mask, 1, 1)).toBe(128);
      } finally {
        history.clear();
        registry.cleanupAll();
      }
    });

    it('finalizes an active painted source once and never republishes an idle source', () => {
      const { layerId, registry, brush, canonical, activation } = createActivationFixture();
      try {
        const baselinePaint = new Uint8Array(canonical.read().snapshot.paintBuffer!);
        expect(baselinePaint[2 * 4 + 2]).toBe(0);
        brush.startStroke(layerId);
        brush.paint(2, 2, layerId, 1, 0, 0.5);
        const activeRead = canonical.read();
        const activePaint = getColorCycleBrushStrokeStateForOwner(brush, layerId)!.buffers.paint;
        expect(activePaint[2 * 4 + 2]).toBeGreaterThan(0);
        expect(new Uint8Array(activeRead.snapshot.paintBuffer!)).toEqual(baselinePaint);
        activation.setActiveLayer('layer-raster');
        const finishedRead = canonical.read();
        expect(finishedRead.version).toBe(activeRead.version + 1);
        expect(finishedRead.pixelVersion).toBe(activeRead.pixelVersion + 1);
        expect(finishedRead.snapshot.hasContent).toBe(true);
        expect(new Uint8Array(finishedRead.snapshot.paintBuffer!)[2 * 4 + 2]).toBe(activePaint[2 * 4 + 2]);
        activation.setActiveLayer(layerId);
        const idleRead = canonical.read();
        const idleAudit = canonical.getAuditLog();
        activation.setActiveLayer('layer-raster');
        expect(canonical.read()).toEqual(idleRead);
        expect(canonical.getAuditLog()).toEqual(idleAudit);
      } finally {
        registry.cleanupAll();
      }
    });
  });

});
