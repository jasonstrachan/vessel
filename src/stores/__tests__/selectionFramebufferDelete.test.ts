import * as layerHistory from '@/history/helpers/layerHistory';
import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import { encodeSequentialEventsToChunks, decodeSequentialChunksToEvents } from '@/lib/sequential/SequentialStrokeChunk';
import { clearSequentialLayerRendererAll, getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  getColorCycleLegacyLayerBuffer,
} from '@/lib/colorCycle/document';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';
import { readTestColorCycleBrushLayerSnapshot } from '@/testing/colorCycleSnapshotTestUtils';
import { captureSequentialLayerFrameTextures } from '@/utils/export/goblet/gobletSequentialSerializer';
import { getMaskedColorCycleCanvas } from '@/utils/colorCycleCoverage';

const CC_SCALAR_KEYS = ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const;

const resetStore = () => {
  useAppStore.setState((state) => ({
    ...state,
    project: {
      id: 'proj',
      name: 'proj',
      width: 4,
      height: 4,
      layers: [],
      backgroundColor: '#fff',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      customBrushes: [],
    },
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    selectionLastAction: null,
    floatingPaste: null,
    floatingPasteHistoryContext: null,
    layersNeedRecomposition: false,
    currentCompositeBitmap: null,
    compositeSegments: [],
    pendingCompositeDirtyBatches: [],
  }));
};

describe('selection delete updates framebuffer', () => {
  beforeEach(() => {
    resetStore();
    historyManager.clear();
    clearSequentialLayerRendererAll();
    window.localStorage.clear();
  });

  it.each(
    (['normal', 'color-cycle', 'sequential'] as const).flatMap((layerType) =>
      (['api-delete', 'keyboard-delete', 'extract-selection'] as const).map((source) => ({ layerType, source }))),
  )('preserves content, masked selection, and history for locked $layerType $source', async ({ layerType, source }) => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = '#ff0000';
    ctx!.fillRect(0, 0, 4, 4);
    const layerId = `locked-${layerType}-${source}`;
    const layer: Layer = {
      id: layerId,
      name: layerId,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: true,
      order: 0,
      imageData: layerType === 'normal' ? ctx!.getImageData(0, 0, 4, 4) : null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType,
      ...(layerType === 'color-cycle' ? {
        colorCycleData: { canvas, hasContent: true },
      } : {}),
      ...(layerType === 'sequential' ? {
        sequentialData: {
          frameCount: 1,
          fps: 12,
          durationMs: 83,
          eventChunks: [],
          events: [{
            id: 'locked-seed',
            layerId,
            strokeId: 'locked-seed',
            timestampMs: 0,
            frameIndex: 0,
            brush: {
              tool: 'brush' as const,
              brushShape: BrushShape.SQUARE,
              size: 2,
              opacity: 1,
              blendMode: 'source-over' as const,
              rotation: 0,
              spacing: 1,
              color: '#ff0000',
            },
            stamps: [{ x: 2, y: 2, pressure: 1, rotation: 0, size: 2, alpha: 1 }],
          }],
        },
      } : {}),
    };
    useAppStore.setState({ layers: [layer], activeLayerId: layerId });
    if (layerType === 'color-cycle') {
      useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
      const brush = getColorCycleBrushManager().getBrush(layerId);
      expect(brush).toBeDefined();
      applyColorCycleBrushLayerSnapshotToRuntime(brush!, layerId, {
        paintBuffer: new Uint8Array(16).fill(9).buffer,
        gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
        gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
        speedBuffer: new Uint8Array(16).fill(3).buffer,
        flowBuffer: new Uint8Array(16).fill(4).buffer,
        phaseBuffer: new Uint8Array(16).fill(5).buffer,
        hasContent: true,
        strokeCounter: 1,
      });
    }
    const selectionMask = new ImageData(new Uint8ClampedArray(16).fill(255), 2, 2);
    useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
    useAppStore.setState({
      selectionMask,
      selectionMaskBounds: { x: 1, y: 1, width: 2, height: 2 },
      selectionMaskLayerId: layerId,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 }] },
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
    });
    const before = useAppStore.getState();
    const beforeMaskBytes = new Uint8ClampedArray(selectionMask.data);
    const beforeLayer = before.layers.find((candidate) => candidate.id === layerId)!;
    expect(beforeLayer.locked).toBe(true);
    const beforeImage = beforeLayer.imageData ? Array.from(beforeLayer.imageData.data) : null;
    const beforeFramebuffer = Array.from(ctx!.getImageData(0, 0, 4, 4).data);
    const beforeSequence = JSON.stringify(beforeLayer.sequentialData);
    const brush = layerType === 'color-cycle' ? getColorCycleBrushManager().getBrush(layerId) : undefined;
    const captureCc = () => JSON.stringify(readTestColorCycleBrushLayerSnapshot(brush, layerId), (_key, value: unknown) =>
      value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value);
    const beforeCc = brush ? captureCc() : null;
    const eraseMask = beforeLayer.colorCycleData?.eraseMask;
    const beforeEraseMask = eraseMask?.getContext('2d')?.getImageData(0, 0, 4, 4);
    const beforeUndo = historyManager.entries().slice();
    const beforeRedo = historyManager.redoEntries().slice();

    if (source === 'extract-selection') {
      expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(false);
    } else {
      useAppStore.getState().deleteSelectedPixels(source);
    }
    await waitForPendingHistoryCommits();

    const after = useAppStore.getState();
    const afterLayer = after.layers.find((candidate) => candidate.id === layerId)!;
    expect(after.layers).toBe(before.layers);
    expect(afterLayer.imageData ? Array.from(afterLayer.imageData.data) : null).toEqual(beforeImage);
    expect(Array.from(ctx!.getImageData(0, 0, 4, 4).data)).toEqual(beforeFramebuffer);
    expect(JSON.stringify(afterLayer.sequentialData)).toBe(beforeSequence);
    if (brush) expect(captureCc()).toBe(beforeCc);
    if (beforeEraseMask) {
      expect(eraseMask!.getContext('2d')!.getImageData(0, 0, 4, 4).data).toEqual(beforeEraseMask.data);
    }
    for (const key of [
      'selectionStart', 'selectionEnd', 'selectionMask', 'selectionMaskBounds',
      'selectionMaskLayerId', 'selectionVectorPath', 'selectionLastAction',
    ] as const) expect(after[key]).toBe(before[key]);
    expect(after.selectionMask!.data).toEqual(beforeMaskBytes);
    expect(after.floatingPaste).toBe(before.floatingPaste);
    expect(after.floatingPasteHistoryContext).toBe(before.floatingPasteHistoryContext);
    expect(after.layersNeedRecomposition).toBe(false);
    expect(after.pendingCompositeDirtyBatches).toEqual([]);
    expect(historyManager.entries()).toEqual(beforeUndo);
    expect(historyManager.redoEntries()).toEqual(beforeRedo);
  });

  it.each([
    { layerType: 'normal', extracted: false }, { layerType: 'normal', extracted: true },
    { layerType: 'color-cycle', extracted: false }, { layerType: 'color-cycle', extracted: true },
    { layerType: 'sequential', extracted: false },
  ] as const)('restores exact masked selection for $layerType delete (extracted=$extracted)', async ({ layerType, extracted }) => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 4, 4);
    const layerId = `masked-${layerType}-${extracted}`;
    const layer: Layer = { id: layerId, name: layerId, order: 0, visible: true, locked: false, opacity: 1,
      blendMode: 'source-over', alignment: createDefaultLayerAlignment(), framebuffer: canvas,
      imageData: layerType === 'normal' ? ctx.getImageData(0, 0, 4, 4) : null, layerType,
      ...(layerType === 'color-cycle' ? { colorCycleData: { canvas, hasContent: true } } : {}),
      ...(layerType === 'sequential' ? { sequentialData: { frameCount: 1, fps: 12, durationMs: 83,
        events: [{ id: 'mask-seed', layerId, strokeId: 'mask-seed', timestampMs: 0, frameIndex: 0,
          brush: { tool: 'brush' as const, brushShape: BrushShape.SQUARE, size: 4, opacity: 1, blendMode: 'source-over' as const,
            rotation: 0, spacing: 1, color: '#ff0000' },
          stamps: [{ x: 2, y: 2, pressure: 1, rotation: 0, size: 4, alpha: 1 }] }], eventChunks: [] } } : {}),
    };
    useAppStore.setState({ layers: [layer], activeLayerId: layerId });
    if (layerType === 'color-cycle') {
      useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
      const brush = getColorCycleBrushManager().getBrush(layerId)!;
      expect(brush).toBeDefined();
      applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
        paintBuffer: new Uint8Array(16).fill(9).buffer, gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
        gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer, speedBuffer: new Uint8Array(16).fill(3).buffer,
        flowBuffer: new Uint8Array(16).fill(4).buffer, phaseBuffer: new Uint8Array(16).fill(5).buffer,
        hasContent: true, strokeCounter: 1,
      });
    }
    const mask = new ImageData(new Uint8ClampedArray([12, 34, 56, 255, 1, 2, 3, 0, 4, 5, 6, 128, 7, 8, 9, 255]), 2, 2);
    const vector = { mode: 'freehand' as const, points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 }] };
    useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
    useAppStore.setState({ selectionMask: mask, selectionMaskBounds: { x: 1, y: 1, width: 2, height: 2 },
      selectionMaskLayerId: layerId, selectionVectorPath: vector });
    const readContent = () => {
      const current = useAppStore.getState().layers.find((entry) => entry.id === layerId)!;
      if (layerType === 'sequential') return JSON.stringify(current.sequentialData);
      if (layerType === 'color-cycle') {
        const snapshot = readTestColorCycleBrushLayerSnapshot(getColorCycleBrushManager().getBrush(layerId), layerId)!;
        return JSON.stringify(['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer']
          .map((key) => Array.from(new Uint8Array(snapshot[key as keyof typeof snapshot] as ArrayBuffer))));
      }
      return JSON.stringify(Array.from(current.imageData!.data));
    };
    const initialContent = readContent();
    const remove = async () => {
      if (extracted) {
        expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
        await useAppStore.getState().deleteFloatingPaste();
      } else useAppStore.getState().deleteSelectedPixels('keyboard-delete');
      await waitForPendingHistoryCommits();
    };
    await remove();
    expect(readContent()).not.toBe(initialContent);
    const deletedContent = readContent();
    expect(historyManager.entries()).toHaveLength(1);
    await useAppStore.getState().undo();
    expect(readContent()).toBe(initialContent);
    const restored = useAppStore.getState();
    expect(restored.selectionStart).toEqual({ x: 1, y: 1 });
    expect(restored.selectionEnd).toEqual({ x: 3, y: 3 });
    expect(restored.selectionMask?.data).toEqual(mask.data);
    expect(restored.selectionMaskBounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(restored.selectionMaskLayerId).toBe(layerId);
    expect(restored.selectionVectorPath).toEqual(vector);
    expect(restored.selectionLastAction).toEqual(expect.objectContaining({ ownerKind: 'history-restored', restoredFromHistory: true, activeLayerId: layerId }));
    await useAppStore.getState().redo();
    expect(readContent()).toBe(deletedContent);
    expect(useAppStore.getState().selectionStart).toBeNull();
    await useAppStore.getState().undo();
    await remove();
    if (layerType !== 'sequential') expect(readContent()).toBe(deletedContent);
    expect(historyManager.redoEntries()).toHaveLength(0);
    if (layerType === 'color-cycle' && !extracted) {
      await useAppStore.getState().undo();
      expect(useAppStore.getState().selectionLastAction).toMatchObject({
        ownerKind: 'history-restored', restoredOwnerKind: 'direct-marquee', restoredFromHistory: true,
      });
      await remove();
      expect(readContent()).toBe(deletedContent);
      expect(historyManager.redoEntries()).toHaveLength(0);
    }
  });

  it.each([
    { name: 'negative origin clipped at both edges', maskX: -8, maskY: -8, maskSize: 32, rectX: -8, rectY: -8, rectSize: 32 },
    { name: 'positive origin with explicit mask offsets', maskX: 2, maskY: 3, maskSize: 32, rectX: 8, rectY: 9, rectSize: 16 },
  ])('preserves CC mask coordinates and all canonical buffers for $name', async ({ name, maskX, maskY, maskSize, rectX, rectY, rectSize }) => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const layerId = `mask-origin-${name}`;
    const layer: Layer = {
      id: layerId, name: layerId, visible: true, locked: false, opacity: 1, order: 0,
      blendMode: 'source-over', alignment: createDefaultLayerAlignment(),
      imageData: null, framebuffer: canvas, layerType: 'color-cycle',
      colorCycleData: { canvas, hasContent: true },
    };
    useAppStore.setState((state) => ({
      project: { ...state.project!, width: size, height: size },
      layers: [layer], activeLayerId: layerId,
      selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
    }));
    useAppStore.getState().initColorCycleForLayer(layerId, size, size);
    const brush = getColorCycleBrushManager().getBrush(layerId)!;
    applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(size * size).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(size * size).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(size * size).fill(258).buffer,
      speedBuffer: new Uint8Array(size * size).fill(3).buffer,
      flowBuffer: new Uint8Array(size * size).fill(4).buffer,
      phaseBuffer: new Uint8Array(size * size).fill(5).buffer,
      hasContent: true, strokeCounter: 1,
    });
    const mask = new ImageData(maskSize, maskSize);
    for (let y = 0; y < maskSize; y += 1) {
      for (let x = 0; x < maskSize; x += 1) {
        const i = (y * maskSize + x) * 4;
        mask.data[i] = 17;
        mask.data[i + 1] = 29;
        mask.data[i + 2] = 41;
        mask.data[i + 3] = x >= 12 && x < 20 && y >= 12 && y < 20 ? 0 : [48, 128, 255][(x + y) % 3];
      }
    }
    const originalMaskBytes = mask.data.slice();
    const maskBounds = { x: maskX, y: maskY, width: maskSize, height: maskSize };
    useAppStore.getState().appendSelectionMask({ mask, bounds: maskBounds, layerId });
    // A smaller selection rectangle exercises the helper's explicit source offset.
    useAppStore.setState({
      selectionStart: { x: rectX, y: rectY },
      selectionEnd: { x: rectX + rectSize, y: rectY + rectSize },
    });
    const admittedMask = useAppStore.getState().selectionMask!;
    const admittedMaskBytes = admittedMask.data.slice();
    const keys = ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const;
    const capture = () => {
      const snapshot = readTestColorCycleBrushLayerSnapshot(getColorCycleBrushManager().getBrush(layerId), layerId)!;
      return keys.map((key) => key === 'gradientDefIdBuffer'
        ? Array.from(new Uint16Array(snapshot[key]!))
        : Array.from(new Uint8Array(snapshot[key]!)));
    };
    const before = capture();
    const expected = before.map((buffer) => buffer.map((value, index) => {
      const x = index % size;
      const y = Math.floor(index / size);
      const mx = x - maskX;
      const my = y - maskY;
      const selected = x >= rectX && x < rectX + rectSize && y >= rectY && y < rectY + rectSize &&
        mx >= 0 && mx < maskSize && my >= 0 && my < maskSize && mask.data[(my * maskSize + mx) * 4 + 3] > 0;
      return selected ? 0 : value;
    }));
    expect(expected[0].filter((value) => value === 0).length).toBeGreaterThan(0);
    expect(expected[0].filter((value) => value !== 0).length).toBeGreaterThan(0);

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');
    await waitForPendingHistoryCommits();
    expect(capture()).toEqual(expected);
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(mask.data).toEqual(originalMaskBytes);
    expect(admittedMask.data).toEqual(admittedMaskBytes);

    await useAppStore.getState().undo();
    expect(capture()).toEqual(before);
    expect(useAppStore.getState().selectionStart).toEqual({ x: rectX, y: rectY });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: rectX + rectSize, y: rectY + rectSize });
    expect(useAppStore.getState().selectionMaskBounds).toEqual(maskBounds);
    expect(useAppStore.getState().selectionMaskLayerId).toBe(layerId);
    expect(useAppStore.getState().selectionMask?.data).toEqual(admittedMaskBytes);
    await useAppStore.getState().redo();
    expect(capture()).toEqual(expected);
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().selectionMask).toBeNull();
    expect(mask.data).toEqual(originalMaskBytes);
    expect(admittedMask.data).toEqual(admittedMaskBytes);
  });

  it('keeps adjustment layers non-paintable for selection delete and extract', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const layer: Layer = {
      id: 'adjustment-1',
      name: 'Pixelate',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'adjustment',
      adjustmentData: {
        effect: { id: 'pixelate', settings: { cellSize: 4 } },
      },
    };
    useAppStore.setState((state) => ({
      ...state,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
    }));

    useAppStore.getState().deleteSelectedPixels();
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(false);

    const next = useAppStore.getState();
    expect(next.layers[0]?.imageData).toBeNull();
    expect(next.layersNeedRecomposition).toBe(false);
    expect(next.floatingPaste).toBeNull();
  });

  it('clears pixels on framebuffer and imageData, flags recomposition, and clears selection', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = 'rgba(0,0,0,1)';
    ctx!.fillRect(0, 0, 4, 4);

    const imageData = ctx!.getImageData(0, 0, 4, 4);

    const layerId = 'layer-1';
    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [
        {
          id: layerId,
          name: 'Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageData,
          framebuffer: canvas,
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal',
        },
      ],
      activeLayerId: layerId,
      selectionStart: { x: 1, y: 0 },
      selectionEnd: { x: 3, y: 2 },
    }));

    useAppStore.getState().deleteSelectedPixels();

    const state = useAppStore.getState();
    const updatedLayer = state.layers.find((l) => l.id === layerId);
    expect(updatedLayer).toBeDefined();

    // Framebuffer pixel in cleared area should be transparent
    const fbSample = ctx!.getImageData(1, 1, 1, 1).data;
    expect(fbSample[3]).toBe(0);

    // imageData mirrors the framebuffer
    const imgSample = updatedLayer!.imageData!.data;
    const idx = (1 * 4 + 1) * 4; // y=1, x=1
    expect(imgSample[idx + 3]).toBe(0);

    expect(state.layersNeedRecomposition).toBe(true);
    expect(state.pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 0,
        rects: [{ x: 1, y: 0, width: 2, height: 2 }],
      },
    ]);
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(state.currentCompositeBitmap).toBeNull();
  });

  it('applies a select-all selection to the newly active layer', () => {
    const makeFilledLayer = (id: string): Layer => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      expect(ctx).not.toBeNull();
      ctx!.fillStyle = 'rgba(0,0,0,1)';
      ctx!.fillRect(0, 0, 4, 4);

      return {
        id,
        name: id,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        order: 0,
        imageData: ctx!.getImageData(0, 0, 4, 4),
        framebuffer: canvas,
        alignment: createDefaultLayerAlignment(),
        layerType: 'normal',
      };
    };

    const sourceLayer = makeFilledLayer('layer-source');
    const activeLayer = makeFilledLayer('layer-active');
    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [sourceLayer, activeLayer],
      activeLayerId: sourceLayer.id,
    }));
    useAppStore.getState().selectAllActiveLayerPixels('keyboard-select-all');
    useAppStore.setState({ activeLayerId: activeLayer.id });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const state = useAppStore.getState();
    const updatedSource = state.layers.find((layer) => layer.id === sourceLayer.id);
    const updatedActive = state.layers.find((layer) => layer.id === activeLayer.id);
    expect(updatedSource?.imageData?.data[(1 * 4 + 1) * 4 + 3]).toBe(255);
    expect(updatedActive?.imageData?.data[(1 * 4 + 1) * 4 + 3]).toBe(0);
    const activeCtx = (updatedActive?.framebuffer as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
    expect(activeCtx?.getImageData(1, 1, 1, 1).data[3]).toBe(0);
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
  });

  it.each([
    { x: -4, y: 1 }, { x: 4, y: 1 }, { x: 1, y: -4 }, { x: 1, y: 4 },
  ])('undoes and redoes a selected pixel moved completely outside to $x,$y', async (position) => {
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 4;
    framebuffer.height = 4;
    const ctx = framebuffer.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#804020';
    ctx.fillRect(0, 0, 4, 4);
    const imageData = ctx.getImageData(0, 0, 4, 4);
    const layer: Layer = {
      id: 'outside-move', name: 'Outside move', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData, framebuffer,
      alignment: createDefaultLayerAlignment(), layerType: 'normal',
    };
    useAppStore.setState({
      layers: [layer], activeLayerId: layer.id,
      selectionMask: null, selectionMaskBounds: null, selectionVectorPath: null,
    });
    useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 2, y: 2 }, 'selection-marquee-final');
    const before = new Uint8ClampedArray(imageData.data);
    const store = useAppStore.getState();
    expect(store.extractSelectionToFloatingPaste()).toBe(true);
    store.updateFloatingPastePosition(position);
    await store.commitFloatingPaste();
    await waitForPendingHistoryCommits();
    const after = new Uint8ClampedArray(useAppStore.getState().layers[0].imageData!.data);
    expect(after[(1 * 4 + 1) * 4 + 3]).toBe(0);
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().floatingPaste).toBeNull();

    await store.undo();
    expect(useAppStore.getState().layers[0].imageData!.data).toEqual(before);
    expect(ctx.getImageData(0, 0, 4, 4).data).toEqual(before);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 1, y: 1 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 2, y: 2 });
    await store.redo();
    expect(useAppStore.getState().layers[0].imageData!.data).toEqual(after);
    expect(ctx.getImageData(0, 0, 4, 4).data).toEqual(after);
  });

  it('extractSelectionToFloatingPaste clears source framebuffer before floating transform', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = 'rgba(0,0,0,1)';
    ctx!.fillRect(0, 0, 4, 4);

    const imageData = ctx!.getImageData(0, 0, 4, 4);
    const layerId = 'layer-extract-1';

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [
        {
          id: layerId,
          name: 'Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageData,
          framebuffer: canvas,
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal',
        },
      ],
      activeLayerId: layerId,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 2, y: 2 },
      floatingPaste: null,
    }));

    const extracted = useAppStore.getState().extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);

    const state = useAppStore.getState();
    const updatedLayer = state.layers.find((l) => l.id === layerId);
    expect(updatedLayer).toBeDefined();
    expect(state.floatingPaste).not.toBeNull();

    const fbSample = ctx!.getImageData(1, 1, 1, 1).data;
    expect(fbSample[3]).toBe(0);

    const imgSample = updatedLayer!.imageData!.data;
    const idx = (1 * 4 + 1) * 4;
    expect(imgSample[idx + 3]).toBe(0);
    expect(state.pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 0,
        rects: [{ x: 1, y: 1, width: 1, height: 1 }],
      },
    ]);
  });

  it('restores source pixels when cancelFloatingPaste is called after extraction', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = 'rgba(0,0,0,1)';
    ctx!.fillRect(0, 0, 4, 4);

    const imageData = ctx!.getImageData(0, 0, 4, 4);
    const layerId = 'layer-cancel-1';

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [
        {
          id: layerId,
          name: 'Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageData,
          framebuffer: canvas,
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal',
        },
      ],
      activeLayerId: layerId,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      floatingPaste: null,
    }));

    const extracted = useAppStore.getState().extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);
    expect(useAppStore.getState().floatingPaste).not.toBeNull();

    useAppStore.getState().cancelFloatingPaste();

    const state = useAppStore.getState();
    const updatedLayer = state.layers.find((l) => l.id === layerId);
    expect(updatedLayer).toBeDefined();
    expect(state.floatingPaste).toBeNull();

    const fbSample = ctx!.getImageData(1, 1, 1, 1).data;
    expect(fbSample[3]).toBe(255);

    const imgSample = updatedLayer!.imageData!.data;
    const idx = (1 * 4 + 1) * 4;
    expect(imgSample[idx + 3]).toBe(255);
    expect(state.pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 0,
        rects: [{ x: 1, y: 1, width: 2, height: 2 }],
      },
    ]);
  });

  it('deletes selected pixels on sequential layers and records undo history', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-seq-1';
    const sequentialLayer: Layer = {
      id: layerId,
      name: 'Sequence 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: {
        frameCount: 1,
        fps: 12,
        durationMs: 83,
        events: [
          {
            id: 'event-before',
            layerId,
            strokeId: 'stroke-before',
            timestampMs: 0,
            frameIndex: 0,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.SQUARE,
              size: 1,
              opacity: 1,
              blendMode: 'source-over',
              rotation: 0,
              spacing: 1,
              color: '#000000',
            },
            stamps: [
              { x: 1.5, y: 1.5, pressure: 1, rotation: 0, size: 1, alpha: 1 },
              { x: 2.5, y: 1.5, pressure: 1, rotation: 0, size: 1, alpha: 1 },
              { x: 1.5, y: 2.5, pressure: 1, rotation: 0, size: 1, alpha: 1 },
              { x: 2.5, y: 2.5, pressure: 1, rotation: 0, size: 1, alpha: 1 },
            ],
          },
        ],
      },
    };

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [sequentialLayer],
      activeLayerId: layerId,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      sequentialRecord: {
        ...state.sequentialRecord,
        currentFrame: 0,
      },
    }));

    useAppStore.getState().deleteSelectedPixels();
    await Promise.resolve();

    const afterDelete = useAppStore.getState();
    const updatedLayer = afterDelete.layers.find((layer) => layer.id === layerId);
    expect(updatedLayer?.sequentialData?.events).toHaveLength(2);
    expect(updatedLayer?.version).toBe(1);
    expect(afterDelete.pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 1, y: 1, width: 2, height: 2 }],
      },
    ]);
    expect(updatedLayer?.sequentialData?.events[1]?.brush.tool).toBe('eraser');
    expect(updatedLayer?.sequentialData?.events[1]?.brush.blendMode).toBe('destination-out');
    expect(updatedLayer?.sequentialData?.events[1]?.stamps).toHaveLength(4);
    expect(updatedLayer?.sequentialData?.events[1]?.stamps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 1.5, y: 1.5, size: 1, alpha: 1 }),
        expect.objectContaining({ x: 2.5, y: 1.5, size: 1, alpha: 1 }),
        expect.objectContaining({ x: 1.5, y: 2.5, size: 1, alpha: 1 }),
        expect.objectContaining({ x: 2.5, y: 2.5, size: 1, alpha: 1 }),
      ])
    );

    await useAppStore.getState().undo();

    const afterUndo = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(afterUndo?.sequentialData?.events).toHaveLength(1);
  });

  it('deletes a full CC selection, persists hasContent false, and records forensic clear context', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-delete';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels();

    const afterDelete = useAppStore.getState();
    const updatedLayer = afterDelete.layers.find((layer) => layer.id === layerId);
    expect(updatedLayer?.layerType).toBe('color-cycle');
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(false);

    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId,
        reason: 'delete-selected',
        severity: 'error',
        details: expect.objectContaining({
          source: 'selection-region-clear',
          operation: 'delete-selected',
          expectedDestructive: true,
          activeLayerId: layerId,
          rect: { x: 0, y: 0, width: 4, height: 4 },
          clampedRect: { x: 0, y: 0, width: 4, height: 4 },
          selectionStart: { x: 0, y: 0 },
          selectionEnd: { x: 4, y: 4 },
          selectionMaskBounds: null,
          paintBefore: expect.objectContaining({ nonZeroCount: 16 }),
          paintAfter: expect.objectContaining({ nonZeroCount: 0 }),
        }),
      }),
    ]));
  });

  it('allows keyboard delete to clear all CC paint after explicit same-layer select-all', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-explicit-select-all-delete';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Explicit Select All Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
    }));
    useAppStore.getState().selectAllActiveLayerPixels('keyboard-select-all');
    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    useAppStore.setState({ pendingCompositeDirtyBatches: [] });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const snapshot = readTestColorCycleBrushLayerSnapshot(brush, layerId);
    expect(snapshot?.hasContent).toBe(false);
    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(getPersistedCCMutationLog()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-keyboard-delete-full-content-blocked',
      }),
    ]));
  });

  it('partial CC delete clears every selected scalar buffer through the store path', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-partial-delete-scalars';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Partial Delete Scalars',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    useAppStore.setState({ pendingCompositeDirtyBatches: [] });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const snapshot = readTestColorCycleBrushLayerSnapshot(brush, layerId);
    expect(snapshot?.hasContent).toBe(true);
    const paint = new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0));
    const gradientId = new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0));
    const gradientDefId = new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0));
    const speed = new Uint8Array(snapshot?.speedBuffer ?? new ArrayBuffer(0));
    const flow = new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0));
    const phase = new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0));

    [0, 1, 4, 5].forEach((index) => {
      expect(paint[index]).toBe(0);
      expect(gradientId[index]).toBe(0);
      expect(gradientDefId[index]).toBe(0);
      expect(speed[index]).toBe(0);
      expect(flow[index]).toBe(0);
      expect(phase[index]).toBe(0);
    });
    [2, 6, 10, 15].forEach((index) => {
      expect(paint[index]).toBe(9);
      expect(gradientId[index]).toBe(1);
      expect(gradientDefId[index]).toBe(2);
      expect(speed[index]).toBe(3);
      expect(flow[index]).toBe(4);
      expect(phase[index]).toBe(5);
    });
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 0,
        rects: [{ x: 0, y: 0, width: 2, height: 2 }],
      },
    ]);
  });

  it('deletes all CC paint inside a current same-layer marquee without requiring a move first', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-direct-marquee-delete';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Direct Marquee Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;
    const paint = new Uint8Array(16);
    const gradientId = new Uint8Array(16);
    const gradientDefId = new Uint16Array(16);
    const speed = new Uint8Array(16);
    const flow = new Uint8Array(16);
    const phase = new Uint8Array(16);
    [0, 1, 4, 5].forEach((index) => {
      paint[index] = 9;
      gradientId[index] = 1;
      gradientDefId[index] = 2;
      speed[index] = 3;
      flow[index] = 4;
      phase[index] = 5;
    });

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientId.buffer,
      gradientDefIdBuffer: gradientDefId.buffer,
      speedBuffer: speed.buffer,
      flowBuffer: flow.buffer,
      phaseBuffer: phase.buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    expect(readTestColorCycleBrushLayerSnapshot(brush, layerId)?.hasContent).toBe(false);
    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(getPersistedCCMutationLog()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-keyboard-delete-full-content-blocked',
        layerId,
      }),
    ]));
  });

  it('blocks keyboard delete when an unowned set-bounds selection would clear all CC paint', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-keyboard-delete-full-content';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Keyboard Delete Full Content',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'setSelectionBounds',
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const updatedLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(true);
    expect(readTestColorCycleBrushLayerSnapshot(brush, layerId)?.hasContent).toBe(true);

    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-keyboard-delete-full-content-blocked',
        layerId,
        reason: 'delete-selected',
        severity: 'error',
        details: expect.objectContaining({
          deleteSource: 'keyboard-delete',
          selectionLastAction: expect.objectContaining({
            action: 'set-bounds',
          }),
          paintBefore: expect.objectContaining({ nonZeroCount: 16 }),
          paintAfter: expect.objectContaining({ nonZeroCount: 0 }),
        }),
      }),
    ]));
  });

  it('deletes active CC pixels when the marquee was created on another layer', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    const ccCanvas = document.createElement('canvas');
    ccCanvas.width = 4;
    ccCanvas.height = 4;

    const sourceLayer: Layer = {
      id: 'layer-selection-source',
      name: 'Selection Source',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: sourceCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    } as Layer;
    const ccLayer: Layer = {
      id: 'layer-cc-mismatch-delete',
      name: 'CC Mismatch Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 1,
      imageData: null,
      framebuffer: ccCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: ccCanvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [sourceLayer, ccLayer],
      activeLayerId: sourceLayer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionLastAction: null,
    }));
    useAppStore.getState().setSelectionBounds(
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      'selection-marquee-final'
    );
    useAppStore.setState({ activeLayerId: ccLayer.id });

    useAppStore.getState().initColorCycleForLayer(ccLayer.id, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(ccLayer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, ccLayer.id, {
      paintBuffer: new Uint8Array(16).fill(7).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).buffer,
      flowBuffer: new Uint8Array(16).buffer,
      phaseBuffer: new Uint8Array(16).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const state = useAppStore.getState();
    const updatedLayer = state.layers.find((layer) => layer.id === ccLayer.id);
    const updatedSnapshot = readTestColorCycleBrushLayerSnapshot(brush, ccLayer.id);
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(false);
    expect(updatedSnapshot?.hasContent).toBe(false);
    expect(Array.from(new Uint8Array(updatedSnapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual(
      new Array(16).fill(0),
    );
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId: ccLayer.id,
        reason: 'delete-selected',
        details: expect.objectContaining({
          operation: 'delete-selected',
          expectedDestructive: true,
        }),
      }),
    ]));
  });

  it('deletes active CC pixels through an appended mask created on another layer', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    const ccCanvas = document.createElement('canvas');
    ccCanvas.width = 4;
    ccCanvas.height = 4;

    const sourceLayer: Layer = {
      id: 'layer-append-source',
      name: 'Append Source',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: sourceCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    } as Layer;
    const ccLayer: Layer = {
      id: 'layer-cc-append-delete',
      name: 'CC Append Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 1,
      imageData: null,
      framebuffer: ccCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: ccCanvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [sourceLayer, ccLayer],
      activeLayerId: sourceLayer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: null,
    }));
    useAppStore.getState().setSelectionBounds(
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      'selection-marquee-final'
    );
    useAppStore.setState({ activeLayerId: ccLayer.id });
    useAppStore.getState().appendSelectionBounds({ x: 2, y: 2 }, { x: 4, y: 4 });

    expect(useAppStore.getState().selectionMaskLayerId).toBe(sourceLayer.id);
    expect(useAppStore.getState().selectionLastAction).toEqual(expect.objectContaining({
      activeLayerId: sourceLayer.id,
      maskLayerId: sourceLayer.id,
    }));

    useAppStore.getState().initColorCycleForLayer(ccLayer.id, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(ccLayer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, ccLayer.id, {
      paintBuffer: new Uint8Array(16).fill(7).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).buffer,
      flowBuffer: new Uint8Array(16).buffer,
      phaseBuffer: new Uint8Array(16).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const state = useAppStore.getState();
    const updatedLayer = state.layers.find((layer) => layer.id === ccLayer.id);
    const updatedSnapshot = readTestColorCycleBrushLayerSnapshot(brush, ccLayer.id);
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(true);
    expect(updatedSnapshot?.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(updatedSnapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      0, 0, 7, 7,
      0, 0, 7, 7,
      7, 7, 0, 0,
      7, 7, 0, 0,
    ]);
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
  });

  it('extracts active CC paint when the marquee was created on another layer', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    const ccCanvas = document.createElement('canvas');
    ccCanvas.width = 4;
    ccCanvas.height = 4;

    const layerId = 'layer-cc-extract-full-content';
    const sourceLayer: Layer = {
      id: 'layer-cc-extract-selection-source',
      name: 'CC Extract Selection Source',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: sourceCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    } as Layer;
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Extract Full Content',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 1,
      imageData: null,
      framebuffer: ccCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: ccCanvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [sourceLayer, ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: Date.now(),
        activeLayerId: sourceLayer.id,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      floatingPaste: null,
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    useAppStore.setState({ pendingCompositeDirtyBatches: [] });
    const beforeExtractSnapshot = readTestColorCycleBrushLayerSnapshot(brush, layerId);
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.speedBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(3));
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(4));
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(5));

    const extracted = useAppStore.getState().extractSelectionToFloatingPaste();

    expect(extracted).toBe(true);
    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste).not.toBeNull();
    expect(floatingPaste?.sourceLayerId).toBe(layerId);
    expect(Array.from(floatingPaste?.colorCycleIndices ?? [])).toEqual(new Array(16).fill(9));
    expect(Array.from(floatingPaste?.colorCycleGradientIds ?? [])).toEqual(new Array(16).fill(1));
    expect(Array.from(floatingPaste?.colorCycleGradientDefIds ?? [])).toEqual(new Array(16).fill(2));
    expect(Array.from(floatingPaste?.colorCycleSpeed ?? [])).toEqual(new Array(16).fill(3));
    expect(Array.from(floatingPaste?.colorCycleFlow ?? [])).toEqual(new Array(16).fill(4));
    expect(Array.from(floatingPaste?.colorCyclePhase ?? [])).toEqual(new Array(16).fill(5));
    expect(readTestColorCycleBrushLayerSnapshot(brush, layerId)?.hasContent).toBe(false);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 0,
        rects: [{ x: 0, y: 0, width: 4, height: 4 }],
      },
    ]);
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId,
        reason: 'extract-selection-transform',
        severity: 'info',
        details: expect.objectContaining({
          transactionKind: 'full-object-move',
          expectedDestructive: true,
        }),
      }),
    ]));
  });

  it('extracts CC floating paste payloads from the manager document snapshot', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-extract-clear-fails';
    const snapshot = {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    };
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Extract Clear Fails',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
        gradientDefStore: [
          {
            id: 2,
            kind: 'linear',
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            hash: 'def-2',
            source: 'manual',
            createdAtMs: 1,
          },
        ],
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      floatingPaste: null,
    }));

    getColorCycleBrushManager().ensureDocument(layerId, 4, 4).replaceState({
      layerId,
      width: 4,
      height: 4,
      paintBuffer: snapshot.paintBuffer,
      gradientIdBuffer: snapshot.gradientIdBuffer,
      gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
      speedBuffer: snapshot.speedBuffer,
      flowBuffer: snapshot.flowBuffer,
      phaseBuffer: snapshot.phaseBuffer,
      hasContent: snapshot.hasContent,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    }, 'test-seed-selection-extract-failure');

    const manager = getColorCycleBrushManager();
    const extracted = useAppStore.getState().extractSelectionToFloatingPaste();

    expect(extracted).toBe(true);
    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste).not.toBeNull();
    expect(Array.from(floatingPaste?.colorCycleIndices ?? [])).toEqual(new Array(16).fill(9));
    expect(Array.from(floatingPaste?.colorCycleGradientIds ?? [])).toEqual(new Array(16).fill(1));
    expect(Array.from(floatingPaste?.colorCycleGradientDefIds ?? [])).toEqual(new Array(16).fill(2));
    expect(Array.from(floatingPaste?.colorCycleSpeed ?? [])).toEqual(new Array(16).fill(3));
    expect(Array.from(floatingPaste?.colorCycleFlow ?? [])).toEqual(new Array(16).fill(4));
    expect(Array.from(floatingPaste?.colorCyclePhase ?? [])).toEqual(new Array(16).fill(5));
    expect(manager.getDocument(layerId)?.read().snapshot.hasContent).toBe(false);
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'color-cycle-layer-cleared',
        layerId,
        reason: 'extract-selection-transform',
        severity: 'info',
        details: expect.objectContaining({
          transactionKind: 'full-object-move',
        }),
      }),
    ]));
  });

  it('does not keyboard-delete CC pixels from a history-restored selection on the same layer', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-history-restored-delete';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC History Delete',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'history-selection-backward',
        ownerKind: 'history-restored',
        restoredFromHistory: true,
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = getColorCycleBrushManager().getBrush(layerId);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: new Uint8Array(16).fill(3).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).buffer,
      flowBuffer: new Uint8Array(16).buffer,
      phaseBuffer: new Uint8Array(16).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    expect(readTestColorCycleBrushLayerSnapshot(brush, layerId)?.hasContent).toBe(true);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 0, y: 0 });
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'selection-delete-authorization-blocked',
        layerId,
        reason: 'history-restored-keyboard-delete',
      }),
    ]));
  });

  it('does not seed CC selection delete paint from gradient ids when canonical paint is missing', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-delete-no-paint';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Delete No Paint',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
        gradientIdBuffer: new Uint8Array(16).fill(4).buffer,
        gradientDefIdBuffer: new Uint16Array(16).fill(8).buffer,
      },
    } as Layer;

    useAppStore.setState((state) => ({
      ...state,
      project: state.project!,
      layers: [ccLayer],
      activeLayerId: layerId,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    useAppStore.getState().deleteSelectedPixels('keyboard-delete');

    const updatedLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(getColorCycleLegacyLayerBuffer(updatedLayer?.colorCycleData, 'gradientIdBuffer') ?? new ArrayBuffer(0))))
      .toEqual(new Array(16).fill(4));
    expect(Array.from(new Uint16Array(getColorCycleLegacyLayerBuffer(updatedLayer?.colorCycleData, 'gradientDefIdBuffer') ?? new ArrayBuffer(0))))
      .toEqual(new Array(16).fill(8));

    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'selection-delete-authorization-blocked',
        layerId,
        reason: 'missing-canonical-paint',
      }),
      expect.objectContaining({
        event: 'color-cycle-selection-clear-skipped-missing-canonical-paint',
        layerId,
        reason: 'delete-selected',
        severity: 'error',
        details: expect.objectContaining({
          source: 'selection-region-clear',
          operation: 'delete-selected',
          deleteSource: 'keyboard-delete',
          hasGradientIdBuffer: true,
          hasGradientDefIdBuffer: true,
        }),
      }),
    ]));
  });
});

describe('CC floating selection coverage integration', () => {
  beforeEach(async () => {
    await waitForPendingHistoryCommits();
    resetStore();
    historyManager.clear();
  });

  afterEach(async () => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
  });

  const setupCoverage = (suffix: string, withSoftEdge: boolean, withEmptySource = false) => {
    const size = 8;
    const layerId = `cc-floating-coverage-${suffix}`;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const layer: Layer = {
      id: layerId, name: layerId, visible: true, locked: false, opacity: 1, order: 0,
      blendMode: 'source-over', alignment: createDefaultLayerAlignment(),
      imageData: null, framebuffer: canvas, layerType: 'color-cycle',
      colorCycleData: {
        canvas, hasContent: true,
        gradientDefStore: [{
          id: 2, kind: 'linear', hash: 'coverage-def-2', source: 'manual', createdAtMs: 1,
          stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
        }],
      },
    };
    useAppStore.setState((state) => ({
      project: { ...state.project!, width: size, height: size },
      layers: [layer], activeLayerId: layerId,
      selectionStart: { x: 1, y: 1 }, selectionEnd: { x: 4, y: 3 },
      selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
      selectionLastAction: {
        action: 'set-bounds', source: 'selection-marquee-final', ownerKind: 'direct-marquee',
        t: Date.now(), activeLayerId: layerId, bounds: { x: 1, y: 1, width: 3, height: 2 },
      },
    }));
    useAppStore.getState().initColorCycleForLayer(layerId, size, size);
    const brush = getColorCycleBrushManager().getBrush(layerId)!;
    const scalarBuffer = (value: number) => {
      const values = new Uint8Array(size * size).fill(value);
      if (withEmptySource) values[2 * size + 1] = 0;
      return values.buffer;
    };
    const gradientDefs = new Uint16Array(size * size).fill(2);
    if (withEmptySource) gradientDefs[2 * size + 1] = 0;
    applyColorCycleBrushLayerSnapshotToRuntime(brush, layerId, {
      paintBuffer: scalarBuffer(9),
      gradientIdBuffer: scalarBuffer(1),
      gradientDefIdBuffer: gradientDefs.buffer,
      speedBuffer: scalarBuffer(3),
      flowBuffer: scalarBuffer(4),
      phaseBuffer: scalarBuffer(5),
      hasContent: true, strokeCounter: 1,
    });

    const createMask = (alpha: Uint8Array) => {
      const mask = document.createElement('canvas');
      mask.width = mask.height = size;
      const image = new ImageData(size, size);
      for (let index = 0; index < alpha.length; index += 1) {
        image.data.set([255, 255, 255, alpha[index]], index * 4);
      }
      mask.getContext('2d')!.putImageData(image, 0, 0);
      return mask;
    };
    const eraseAlpha = new Uint8Array(size * size);
    eraseAlpha[1 * size + 1] = 128;
    eraseAlpha[1 * size + 3] = 255; // Canonical paint remains present despite zero visible alpha.
    eraseAlpha[2 * size + 2] = 64;
    eraseAlpha[4 * size + 4] = 77;
    eraseAlpha[4 * size + 5] = 99; // Destination hole must retain existing coverage.
    eraseAlpha[7 * size + 7] = 66;
    const softAlpha = new Uint8Array(size * size).fill(255);
    softAlpha[1 * size + 1] = 96;
    softAlpha[1 * size + 3] = 0;
    softAlpha[2 * size + 2] = 180;
    softAlpha[4 * size + 5] = 120;
    if (withEmptySource) {
      softAlpha[2 * size + 1] = 0;
      eraseAlpha[5 * size + 4] = 99;
      softAlpha[5 * size + 4] = 120;
    }
    const current = useAppStore.getState().layers[0];
    useAppStore.getState().updateLayer(layerId, {
      colorCycleData: {
        ...current.colorCycleData!, eraseMask: createMask(eraseAlpha), eraseMaskVersion: 1,
        ...(withSoftEdge ? { softEdgeMask: createMask(softAlpha), softEdgeMaskEnabled: true, softEdgeMaskVersion: 1 } : {}),
      },
    }, { skipColorCycleSync: true });
    const liveCanvas = useAppStore.getState().layers[0].colorCycleData!.canvas!;
    const visible = new ImageData(size, size);
    for (let index = 0; index < eraseAlpha.length; index += 1) {
      visible.data.set([120, 80, 40, 255 - eraseAlpha[index]], index * 4);
    }
    if (withEmptySource) visible.data.fill(0, (2 * size + 1) * 4, (2 * size + 2) * 4);
    liveCanvas.getContext('2d')!.putImageData(visible, 0, 0);
    const mask = new ImageData(3, 2);
    for (let index = 3; index < mask.data.length; index += 4) mask.data[index] = 80;
    mask.data[1 * 4 + 3] = 0;
    useAppStore.setState({
      selectionMask: mask, selectionMaskBounds: { x: 1, y: 1, width: 3, height: 2 },
      selectionMaskLayerId: layerId,
    });
    const capture = () => {
      const snapshot = readTestColorCycleBrushLayerSnapshot(getColorCycleBrushManager().getBrush(layerId), layerId)!;
      const currentLayer = useAppStore.getState().layers.find((entry) => entry.id === layerId)!;
      const readAlpha = (field: 'eraseMask' | 'softEdgeMask') => {
        const maskCanvas = currentLayer.colorCycleData?.[field];
        const rgba = maskCanvas?.getContext('2d')?.getImageData(0, 0, size, size).data;
        return rgba ? Array.from({ length: size * size }, (_, index) => rgba[index * 4 + 3]) : null;
      };
      return {
        scalars: CC_SCALAR_KEYS.map((key) => key === 'gradientDefIdBuffer'
          ? Array.from(new Uint16Array(snapshot[key]!))
          : Array.from(new Uint8Array(snapshot[key]!))),
        eraseAlpha: readAlpha('eraseMask'),
        softAlpha: readAlpha('softEdgeMask'),
      };
    };
    const before = capture();
    const expectedExtracted = {
      scalars: before.scalars.map((values) => values.slice()),
      eraseAlpha: before.eraseAlpha!.slice(), softAlpha: before.softAlpha?.slice() ?? null,
    };
    const expectedMoved = {
      scalars: before.scalars.map((values) => values.slice()),
      eraseAlpha: before.eraseAlpha!.slice(), softAlpha: before.softAlpha?.slice() ?? null,
    };
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if ((x === 1 && y === 0) || (withEmptySource && x === 0 && y === 1)) continue;
        const source = (y + 1) * size + x + 1;
        const destination = (y + 4) * size + x + 4;
        for (let channel = 0; channel < CC_SCALAR_KEYS.length; channel += 1) {
          expectedExtracted.scalars[channel][source] = 0;
          expectedMoved.scalars[channel][source] = 0;
          expectedMoved.scalars[channel][destination] = before.scalars[channel][source];
        }
        expectedExtracted.eraseAlpha[source] = 0;
        expectedMoved.eraseAlpha[source] = 0;
        expectedMoved.eraseAlpha[destination] = before.eraseAlpha![source];
        if (expectedExtracted.softAlpha && expectedMoved.softAlpha && before.softAlpha) {
          expectedExtracted.softAlpha[source] = 0;
          expectedMoved.softAlpha[source] = 0;
          expectedMoved.softAlpha[destination] = before.softAlpha[source];
        }
      }
    }
    return { capture, before, expectedExtracted, expectedMoved };
  };

  // Canvas I/O double only: the shared mock does not implement mask compositing.
  // Native production tests separately verify browser premultiplied rounding.
  const enableCoverageCanvas = () => {
    const canvasState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRasterize = canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    // Jest's MessageChannel clone returns Node-realm ArrayBuffers. Browser structuredClone
    // returns same-realm buffers, which the real history codecs validate with instanceof.
    const originalClone = globalThis.structuredClone;
    const clone = jest.spyOn(globalThis, 'structuredClone').mockImplementation(<T,>(value: T, options?: StructuredSerializeOptions): T => {
      const seen = new WeakMap<object, unknown>();
      const normalize = (entry: unknown): unknown => {
        if (!entry || typeof entry !== 'object') return entry;
        if (seen.has(entry)) return seen.get(entry);
        if (Object.prototype.toString.call(entry) === '[object ArrayBuffer]') {
          const buffer = new Uint8Array(entry as ArrayBuffer).slice().buffer;
          seen.set(entry, buffer);
          return buffer;
        }
        if (ArrayBuffer.isView(entry)) return entry;
        seen.set(entry, entry);
        const record = entry as Record<string, unknown>;
        Object.keys(record).forEach((key) => { record[key] = normalize(record[key]); });
        return entry;
      };
      return normalize(originalClone(value, options)) as T;
    });
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    const draw = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (
      this: CanvasRenderingContext2D, source: CanvasImageSource, ...args: number[]
    ) {
      const operation = this.globalCompositeOperation;
      if (operation !== 'destination-out' && operation !== 'destination-in') {
        Reflect.apply(originalDraw, this, [source, ...args]);
        return;
      }
      const mask = (source as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const pixels = this.getImageData(0, 0, this.canvas.width, this.canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const coverage = operation === 'destination-out' ? 255 - mask.data[i + 3] : mask.data[i + 3];
        pixels.data[i + 3] = Math.round(pixels.data[i + 3] * coverage / 255);
        if (pixels.data[i + 3] === 0) pixels.data.fill(0, i, i + 4);
      }
      this.putImageData(pixels, 0, 0);
      this.globalCompositeOperation = 'source-over';
    });
    return () => {
      draw.mockRestore();
      clone.mockRestore();
      canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
    };
  };

  const setupVisibleCoverage = (softEnabled: boolean) => {
    const fixture = setupCoverage(`visible-${softEnabled}`, true);
    const source = useAppStore.getState().layers[0];
    const raw = new ImageData(8, 8);
    const rawAlpha = [201, 177, 220, 128, 193, 64];
    const selectionAlpha = [128, 0, 255, 64, 192, 255];
    const selection = new ImageData(3, 2);
    rawAlpha.forEach((alpha, i) => {
      raw.data.set([255, 0, 0, alpha], ((1 + Math.floor(i / 3)) * 8 + 1 + i % 3) * 4);
      selection.data[i * 4 + 3] = selectionAlpha[i];
    });
    source.colorCycleData!.canvas!.getContext('2d')!.putImageData(raw, 0, 0);
    useAppStore.setState({
      layers: [{ ...source, colorCycleData: { ...source.colorCycleData!, softEdgeMaskEnabled: softEnabled } }],
      selectionMask: selection,
    });
    // BEFORE-only oracle: raw -> erase -> optional soft -> selection, rounding at each stage.
    const expectedAlpha = softEnabled ? [19, 0, 0, 32, 77, 64] : [50, 0, 0, 32, 109, 64];
    return { ...fixture, source, raw, expectedAlpha };
  };

  it.each([false, true].flatMap(soft => [false, true].map(retry => ({ soft, retry }))))(
    'retains bitmap alpha when converting into CC (soft $soft, retry $retry)', async ({ soft, retry }) => {
      const restoreCanvas = enableCoverageCanvas();
      try {
        const { capture, before } = setupCoverage(`bitmap-alpha-${soft}-${retry}`, soft);
        const alpha = [128, 0, 255, 64, 1, 200];
        const imageData = new ImageData(3, 2);
        alpha.forEach((value, i) => imageData.data.set([255, 255, 255, value], i * 4));
        useAppStore.getState().clearSelection();
        useAppStore.getState().setFloatingPaste({
          imageData, width: 3, height: 2, position: { x: 4, y: 4 },
        });
        if (retry) {
          const failure = jest.spyOn(layerHistory, 'commitLayerHistory').mockRejectedValueOnce(new Error('bitmap paste history unavailable'));
          await useAppStore.getState().commitFloatingPaste();
          failure.mockRestore();
          expect(capture()).toEqual(before);
          expect(useAppStore.getState().floatingPaste?.imageData?.data).toEqual(imageData.data);
          expect(historyManager.entries()).toHaveLength(0);
        }
        await useAppStore.getState().commitFloatingPaste();
        await waitForPendingHistoryCommits();
        const after = capture();
        const expectedErase = before.eraseAlpha!.slice();
        const expectedSoft = before.softAlpha?.slice();
        const expectedPaint = before.scalars[0].slice();
        alpha.forEach((value, i) => {
          const offset = (4 + Math.floor(i / 3)) * 8 + 4 + i % 3;
          // Bitmap conversion replaces transparent cells under its established contract.
          if (!value) { expectedPaint[offset] = 0; return; }
          expectedErase[offset] = 255 - value;
          if (expectedSoft) expectedSoft[offset] = 255;
          expectedPaint[offset] = 255;
        });
        expect(after.eraseAlpha).toEqual(expectedErase);
        expect(after.softAlpha).toEqual(expectedSoft ?? null);
        expect(after.scalars[0]).toEqual(expectedPaint);
        expect(useAppStore.getState().floatingPaste).toBeNull();
        expect(historyManager.entries()).toHaveLength(1);
        await historyManager.undo();
        expect(capture()).toEqual(before);
        await historyManager.redo();
        expect(capture()).toEqual(after);
      } finally { restoreCanvas(); }
    },
  );

  it.each((['copy', 'cut'] as const).flatMap(mode =>
    [false, true].flatMap(floating => [false, true].map(softEnabled => ({ mode, floating, softEnabled }))),
  ))('preserves covered CC clipboard pixels/masks for $mode (floating $floating, soft $softEnabled)', async ({ mode, floating, softEnabled }) => {
    const restoreCanvas = enableCoverageCanvas();
    try {
      const { capture, expectedAlpha } = setupVisibleCoverage(softEnabled);
      if (floating) expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
      const before = capture();
      const sourceMasks = useAppStore.getState().floatingPaste?.colorCycleSelectionMasks;
      await expect(useAppStore.getState().copySelectionToClipboard({ mode })).resolves.toBe(true);
      const clipboard = useAppStore.getState().selectionClipboard!;
      expect(Array.from(clipboard.imageData.data).filter((_, i) => i % 4 === 3)).toEqual(expectedAlpha);
      expect(clipboard.colorCycleSelectionMasks).toEqual({
        membership: new Uint8Array([255, 0, 255, 255, 255, 255]),
        eraseAlpha: new Uint8Array([128, 0, 255, 0, 64, 0]),
        softEdgeAlpha: new Uint8Array([96, 255, 0, 255, 180, 255]),
      });
      if (sourceMasks) {
        expect(clipboard.colorCycleSelectionMasks?.membership).not.toBe(sourceMasks.membership);
        expect(clipboard.colorCycleSelectionMasks?.eraseAlpha).not.toBe(sourceMasks.eraseAlpha);
        expect(clipboard.colorCycleSelectionMasks?.softEdgeAlpha).not.toBe(sourceMasks.softEdgeAlpha);
      }
      expect(clipboard.colorCycleIndices?.[2]).toBe(9); // Fully erased paint still owns indexed data.
      if (mode === 'copy') expect(capture()).toEqual(before);
    } finally {
      restoreCanvas();
    }
  });

  it.each(['mask-draw', 'scratch-context'] as const)('refuses extraction before mutation when coverage %s fails, retaining display fallback', (failure) => {
    const restoreCanvas = enableCoverageCanvas();
    let restoreFailure = () => {};
    try {
      const { capture, before, source } = setupVisibleCoverage(true);
      const rawBefore = source.colorCycleData!.canvas!.getContext('2d')!.getImageData(0, 0, 8, 8).data.slice();
      const selectionBefore = useAppStore.getState();
      const maskBefore = selectionBefore.selectionMask!.data.slice();
      let failures = 0;
      if (failure === 'mask-draw') {
        const draw = jest.mocked(CanvasRenderingContext2D.prototype.drawImage);
        const compose = draw.getMockImplementation()!;
        draw.mockImplementation(function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...args: number[]) {
          if (image === source.colorCycleData!.softEdgeMask) {
            failures += 1;
            throw new Error('Injected coverage mask draw failure');
          }
          Reflect.apply(compose, this, [image, ...args]);
        });
      } else {
        const scratch = getMaskedColorCycleCanvas(source.colorCycleData!.canvas!, source)!;
        expect(scratch).not.toBe(source.colorCycleData!.canvas);
        const getContext = jest.spyOn(scratch, 'getContext').mockImplementation(() => {
          failures += 1;
          return null;
        });
        restoreFailure = () => getContext.mockRestore();
      }
      expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(false);
      expect(failures).toBeGreaterThan(0);
      expect(capture()).toEqual(before);
      expect(source.colorCycleData!.canvas!.getContext('2d')!.getImageData(0, 0, 8, 8).data).toEqual(rawBefore);
      const after = useAppStore.getState();
      expect(after.floatingPaste).toBeNull();
      expect(after.floatingPasteHistoryContext).toBeNull();
      expect(after.selectionStart).toEqual(selectionBefore.selectionStart);
      expect(after.selectionEnd).toEqual(selectionBefore.selectionEnd);
      expect(after.selectionMask!.data).toEqual(maskBefore);
      expect(after.selectionMaskBounds).toEqual(selectionBefore.selectionMaskBounds);
      expect(after.selectionMaskLayerId).toBe(selectionBefore.selectionMaskLayerId);
      expect(after.selectionLastAction).toEqual(selectionBefore.selectionLastAction);
      expect(historyManager.entries()).toHaveLength(0);
      // Presentation still provides its established best-effort surface on failure.
      const display = getMaskedColorCycleCanvas(source.colorCycleData!.canvas!, source);
      expect(display).not.toBeNull();
      if (failure === 'scratch-context') expect(display).toBe(source.colorCycleData!.canvas);
    } finally {
      restoreFailure();
      restoreCanvas();
    }
  });

  it.each([false, true])('freezes visible CC bitmap once and restores canonical source after transformed Cancel (soft enabled %s)', (softEnabled) => {
    const restoreCanvas = enableCoverageCanvas();
    try {
      const { capture, before, source, expectedAlpha } = setupVisibleCoverage(softEnabled);
      const originalRaw = source.colorCycleData!.canvas!.getContext('2d')!.getImageData(1, 1, 3, 2).data.slice();
      expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
      const floating = useAppStore.getState().floatingPaste!;
      const bitmap = floating.imageData;
      expect(bitmap).not.toBeNull();
      if (!bitmap) throw new Error('Missing floating bitmap');
      expect(Array.from({ length: 6 }, (_, i) => bitmap.data[i * 4 + 3])).toEqual(expectedAlpha);
      expect(floating.colorCycleIndices![2]).toBe(9); // Fully erased cells remain canonical.
      const frozen = bitmap.data.slice();
      source.colorCycleData!.canvas!.getContext('2d')!.clearRect(0, 0, 8, 8);
      expect(bitmap.data).toEqual(frozen);
      expect(useAppStore.getState().floatingPasteHistoryContext!.sourceBeforeImage!.data).toEqual(originalRaw);
      useAppStore.getState().flipFloatingPasteHorizontal();
      useAppStore.getState().flipFloatingPasteVertical();
      useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 5 });
      useAppStore.getState().cancelFloatingPaste();
      expect(capture()).toEqual(before);
      // Restoration re-renders canonical CC data; the explicitly seeded raw I/O fixture
      // intentionally differs from that renderer. Native tests verify rendered restoration.
      expect(historyManager.entries()).toHaveLength(0);
    } finally { restoreCanvas(); }
  });

  it.each((['normal', 'sequential'] as const).flatMap((kind) => [false, true].map((softEnabled) => ({ kind, softEnabled }))))(
    'moves covered CC pixels into $kind with atomic history and retry (soft enabled $softEnabled)',
    async ({ kind, softEnabled }) => {
      const restoreCanvas = enableCoverageCanvas();
      const gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
      const worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
      setFeatureFlag('enableSequentialGpuAcceleration', false);
      setFeatureFlag('enableSequentialWorkerMaterialization', false);
      clearSequentialLayerRendererAll();
      try {
        const { capture, before, expectedExtracted, expectedAlpha } = setupVisibleCoverage(softEnabled);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const destination: Layer = {
          id: `coverage-destination-${kind}`, name: 'Destination', layerType: kind,
          visible: true, locked: false, opacity: 1, blendMode: 'source-over', order: 1,
          alignment: createDefaultLayerAlignment(), framebuffer: canvas,
          imageData: kind === 'normal' ? new ImageData(8, 8) : null,
          ...(kind === 'sequential' ? { sequentialData: { events: [], frameCount: 2, fps: 1, durationMs: 2000 } } : {}),
        };
        useAppStore.setState((state) => ({ layers: [...state.layers, destination],
          sequentialRecord: { ...state.sequentialRecord, currentFrame: 0, isPointerDown: false } }));
        expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
        useAppStore.getState().setActiveLayer(destination.id);
        useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
        const reject = jest.spyOn(layerHistory, 'commitLayerHistoryBatch').mockRejectedValueOnce(new Error('coverage retry'));
        try { await useAppStore.getState().commitFloatingPaste(); } finally { reject.mockRestore(); }
        expect(useAppStore.getState().floatingPaste).not.toBeNull();
        expect(capture()).toEqual(expectedExtracted);
        expect(historyManager.entries()).toHaveLength(0);
        const readDestination = () => {
          const current = useAppStore.getState().layers.find((layer) => layer.id === destination.id)!;
          return kind === 'normal' ? current.imageData!.data : getSequentialLayerRenderCanvas({
            layer: current, width: 8, height: 8, frameIndex: 0, holdPreviousOnEmptyFrames: false,
          })!.getContext('2d')!.getImageData(0, 0, 8, 8).data;
        };
        expect(readDestination()).toEqual(new Uint8ClampedArray(8 * 8 * 4));
        await useAppStore.getState().commitFloatingPaste();
        const expected = new Uint8ClampedArray(8 * 8 * 4);
        expectedAlpha.forEach((alpha, i) => {
          if (alpha) expected.set([255, 0, 0, alpha], ((4 + Math.floor(i / 3)) * 8 + 4 + i % 3) * 4);
        });
        expect(readDestination()).toEqual(expected);
        if (kind === 'sequential') {
          const exportedFrames: Uint8ClampedArray[] = [];
          const toBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
            this: HTMLCanvasElement, callback: BlobCallback, type?: string,
          ) {
            const pixels = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
            exportedFrames.push(pixels);
            callback(new Blob([new Uint8Array(pixels)], { type: type ?? 'image/png' }));
          });
          try {
            const current = useAppStore.getState().layers.find((layer) => layer.id === destination.id)!;
            const exported = await captureSequentialLayerFrameTextures({ layer: current, width: 8, height: 8, frameCount: 2 });
            expect(exported?.frameMap).toEqual([0, 1]);
            expect(exportedFrames).toEqual([expected, new Uint8ClampedArray(8 * 8 * 4)]);
          } finally { toBlob.mockRestore(); }
        }
        expect(historyManager.entries()).toHaveLength(1);
        await useAppStore.getState().undo();
        expect(capture()).toEqual(before);
        expect(readDestination()).toEqual(new Uint8ClampedArray(8 * 8 * 4));
        await useAppStore.getState().redo();
        expect(capture()).toEqual(expectedExtracted);
        expect(readDestination()).toEqual(expected);
      } finally {
        clearSequentialLayerRendererAll();
        setFeatureFlag('enableSequentialGpuAcceleration', gpu);
        setFeatureFlag('enableSequentialWorkerMaterialization', worker);
        restoreCanvas();
      }
    },
  );

  it.each([63, 36])('removes only unused imported CC metadata after rejection and preserves independent cell %i', async (independentIndex) => {
    const { capture, expectedExtracted } = setupCoverage('failure-metadata', true);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    const beforeMetadata = useAppStore.getState().layers[0].colorCycleData!;
    const beforeRaw = beforeMetadata.canvas!.getContext('2d')!.getImageData(4, 4, 3, 2).data.slice();
    const pastedDef = { ...beforeMetadata.gradientDefStore![0], hash: 'imported-conflict', slot: 1 };
    useAppStore.setState((state) => ({ floatingPaste: { ...state.floatingPaste!,
      colorCycleSlotPalettes: [{ slot: 1, stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#00ff00' }] }],
      colorCycleGradientDefs: [pastedDef],
    } }));
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
    let reject!: (reason: Error) => void;
    const failure = jest.spyOn(layerHistory, 'commitLayerHistory').mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    try {
      const pending = useAppStore.getState().commitFloatingPaste();
      const layer = useAppStore.getState().layers[0];
      expect(layer.colorCycleData!.gradientDefStore).toHaveLength(2);
      const attempted = capture();
      const brush = getColorCycleBrushManager().getBrush(layer.id)!;
      const later = readTestColorCycleBrushLayerSnapshot(brush, layer.id)!;
      const paint = new Uint8Array(later.paintBuffer!.slice(0));
      paint[independentIndex] = 31;
      applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, { ...later, paintBuffer: paint.buffer });
      reject(new Error('CC history rejected'));
      await pending;
      const expected = { ...expectedExtracted, scalars: expectedExtracted.scalars.map((plane) => plane.slice()),
        eraseAlpha: expectedExtracted.eraseAlpha.slice(), softAlpha: expectedExtracted.softAlpha!.slice() };
      if (independentIndex === 36) {
        expected.scalars.forEach((plane, channel) => { plane[independentIndex] = attempted.scalars[channel][independentIndex]; });
        expected.eraseAlpha[independentIndex] = attempted.eraseAlpha![independentIndex];
        expected.softAlpha[independentIndex] = attempted.softAlpha![independentIndex];
      }
      expected.scalars[0][independentIndex] = 31;
      expect(capture()).toEqual(expected);
      const afterMetadata = useAppStore.getState().layers[0].colorCycleData!;
      if (independentIndex === 63) {
        expect(afterMetadata.gradientDefStore).toEqual(beforeMetadata.gradientDefStore);
        expect(afterMetadata.nextGradientDefId).toEqual(beforeMetadata.nextGradientDefId);
        expect(afterMetadata.slotPalettes).toEqual(beforeMetadata.slotPalettes);
        expect(afterMetadata.canvas!.getContext('2d')!.getImageData(4, 4, 3, 2).data).toEqual(beforeRaw);
      } else {
        expect(afterMetadata.gradientDefStore).toEqual(layer.colorCycleData!.gradientDefStore);
        expect(afterMetadata.slotPalettes).toEqual(layer.colorCycleData!.slotPalettes);
      }
    } finally { failure.mockRestore(); }
  });

  it.each(['cancel', 'retry'] as const)('rolls back rejected CC destination coverage before %s', async (recovery) => {
    const { capture, before, expectedExtracted, expectedMoved } = setupCoverage(`failure-${recovery}`, true);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
    const failure = jest.spyOn(layerHistory, 'commitLayerHistory').mockRejectedValueOnce(new Error('injected CC history failure'));
    try {
      await useAppStore.getState().commitFloatingPaste();
      expect(capture()).toEqual(expectedExtracted);
      expect(useAppStore.getState().floatingPaste).not.toBeNull();
      expect(historyManager.entries()).toHaveLength(0);
      if (recovery === 'cancel') {
        useAppStore.getState().cancelFloatingPaste();
        expect(capture()).toEqual(before);
        expect(historyManager.entries()).toHaveLength(0);
      } else {
        await useAppStore.getState().commitFloatingPaste();
        expect(capture()).toEqual(expectedMoved);
        expect(historyManager.entries()).toHaveLength(1);
        await useAppStore.getState().undo();
        expect(capture()).toEqual(before);
        await useAppStore.getState().redo();
        expect(capture()).toEqual(expectedMoved);
      }
      expect(useAppStore.getState().floatingPaste).toBeNull();
    } finally {
      failure.mockRestore();
    }
  });

  it.each([false, true])('moves fractional and fully erased CC coverage with holes through Undo/Redo (soft edge %s)', async (withSoftEdge) => {
    const { capture, before, expectedExtracted, expectedMoved } = setupCoverage(`move-${withSoftEdge}`, withSoftEdge);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    expect(capture()).toEqual(expectedExtracted);
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
    await useAppStore.getState().commitFloatingPaste();
    await waitForPendingHistoryCommits();
    expect(capture()).toEqual(expectedMoved);
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(historyManager.entries()).toHaveLength(1);
    await useAppStore.getState().undo();
    expect(capture()).toEqual(before);
    await useAppStore.getState().redo();
    expect(capture()).toEqual(expectedMoved);
  });

  it.each([false, true])('cancels moved CC coverage without history or losing fully erased canonical cells (soft edge %s)', async (withSoftEdge) => {
    const { capture, before } = setupCoverage(`cancel-${withSoftEdge}`, withSoftEdge);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
    useAppStore.getState().cancelFloatingPaste();
    await waitForPendingHistoryCommits();
    expect(capture()).toEqual(before);
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(historyManager.entries()).toHaveLength(0);
  });

  it('preserves occupied destination paint and mask coverage beneath an originally empty selected source cell', async () => {
    const { capture, before, expectedExtracted, expectedMoved } = setupCoverage('empty-source', true, true);
    expect(before.scalars.every((channel) => channel[2 * 8 + 1] === 0)).toBe(true);
    expect(before.eraseAlpha![2 * 8 + 1]).toBe(0);
    expect(before.eraseAlpha![5 * 8 + 4]).toBe(99);
    expect(before.softAlpha![5 * 8 + 4]).toBe(120);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    expect(capture()).toEqual(expectedExtracted);
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 4 });
    await useAppStore.getState().commitFloatingPaste();
    await waitForPendingHistoryCommits();
    expect(capture()).toEqual(expectedMoved);
    await useAppStore.getState().undo();
    expect(capture()).toEqual(before);
    await useAppStore.getState().redo();
    expect(capture()).toEqual(expectedMoved);
  });
});


describe('inverted raster selection delete alignment history', () => {
  beforeEach(async () => {
    await waitForPendingHistoryCommits();
    resetStore();
    historyManager.clear();
  });

  it.each(['auto', 'anchor'] as const)(
    'keeps immediate deletion pixels and full metadata identical to redo for %s positioning',
    async (positioning) => {
      const framebuffer = document.createElement('canvas');
      framebuffer.width = framebuffer.height = 4;
      const ctx = framebuffer.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 4, 4);
      const layer: Layer = {
        id: 'inverted-delete-alignment', name: 'Inverted delete alignment', visible: true,
        opacity: 0.7, blendMode: 'source-over', locked: false, order: 0,
        layerType: 'normal', imageData: ctx.getImageData(0, 0, 4, 4), framebuffer,
        alignment: {
          ...createDefaultLayerAlignment(), positioning,
          ...(positioning === 'anchor' ? {
            offsetPx: { x: 3, y: -2 }, offsetPercent: { x: 37, y: -25 },
          } : {}),
        },
      };
      useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
      await useAppStore.getState().captureCanvasToActiveLayer(framebuffer, undefined, { mode: 'replace' });
      const snapshot = () => {
        const current = useAppStore.getState().layers[0];
        const { imageData, framebuffer: currentFramebuffer, ...metadata } = current;
        return {
          metadata,
          pixels: new Uint8ClampedArray(imageData!.data),
          framebufferPixels: (currentFramebuffer.getContext('2d') as CanvasRenderingContext2D)
            .getImageData(0, 0, 4, 4).data,
        };
      };
      const before = snapshot();
      useAppStore.getState().setSelectionBounds({ x: 1, y: 0 }, { x: 2, y: 2 });
      useAppStore.getState().invertSelection();
      expect(useAppStore.getState().selectionMask).not.toBeNull();
      const selectionHistory = [...historyManager.entries()];
      expect(selectionHistory).toHaveLength(1);
      expect(selectionHistory[0].action).toBe('selection-change');
      useAppStore.getState().deleteSelectedPixels('keyboard-delete');
      await waitForPendingHistoryCommits();
      const immediate = snapshot();
      expect(historyManager.entries()).toHaveLength(selectionHistory.length + 1);
      expect(historyManager.entries()[0]).toBe(selectionHistory[0]);
      expect(historyManager.peekUndo()?.action).toBe('layer-bitmap');
      await historyManager.undo();
      const undone = snapshot();
      await historyManager.redo();
      const redone = snapshot();

      const expectedPixels = new Uint8ClampedArray(64);
      expectedPixels.set([255, 0, 0, 255], 4);
      expectedPixels.set([255, 0, 0, 255], 20);
      const expectedAlignment = positioning === 'auto' ? {
        ...before.metadata.alignment,
        offsetPercent: { x: (1 / 3) * 100, y: 0 }, offsetPx: { x: 1, y: 0 },
      } : before.metadata.alignment;
      expect(immediate).toEqual({
        metadata: { ...before.metadata, alignment: expectedAlignment },
        pixels: expectedPixels, framebufferPixels: expectedPixels,
      });
      expect(undone).toEqual(before);
      expect(redone).toEqual(immediate);
    },
  );
});

describe('Sequence floating selection canonical integration', () => {
  const canvasState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  let previousRasterize: boolean | undefined;
  let gpu: boolean;
  let worker: boolean;
  beforeEach(async () => {
    await waitForPendingHistoryCommits();
    resetStore();
    historyManager.clear();
    clearSequentialLayerRendererAll();
    gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
    worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    previousRasterize = canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
  });
  afterEach(() => {
    clearSequentialLayerRendererAll();
    setFeatureFlag('enableSequentialGpuAcceleration', gpu);
    setFeatureFlag('enableSequentialWorkerMaterialization', worker);
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
  });

  const seed = (maskAlpha?: number, sourceAlpha = 255) => {
    const paint = (id: string, frameIndex: number, color: string, x: number, y: number): SequentialStrokeEvent => ({
      id, layerId: 'seq-move', strokeId: id, timestampMs: 0, frameIndex,
      brush: { tool: 'brush', brushShape: BrushShape.SQUARE, size: 2, opacity: 1, blendMode: 'source-over', rotation: 0, spacing: 1, color },
      stamps: [{ x, y, pressure: 1, rotation: 0, size: 2, alpha: sourceAlpha / 255 }],
    });
    const events = [paint('red', 0, '#ff0000', 2, 2), paint('blue', 0, '#0000ff', 6, 6), paint('green', 1, '#00ff00', 2, 2)];
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 8;
    framebuffer.height = 8;
    const layer: Layer = {
      id: 'seq-move', name: 'Sequence', layerType: 'sequential', visible: true, locked: false,
      opacity: 1, blendMode: 'source-over', order: 0, alignment: createDefaultLayerAlignment(),
      framebuffer, imageData: new ImageData(8, 8),
      sequentialData: { frameCount: 3, fps: 1, durationMs: 3000, events,
        eventChunks: [{ id: 'original-chunk', startEventIndex: 0, eventCount: 3, frameIndexes: [0, 1] }] },
    };
    useAppStore.setState((state) => ({
      project: { ...state.project!, width: 8, height: 8 }, layers: [layer], activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 }, selectionEnd: { x: 3, y: 3 },
      selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null,
      sequentialRecord: { ...state.sequentialRecord, currentFrame: 0, isPointerDown: false },
    }));
    if (maskAlpha !== undefined) {
      const mask = new ImageData(2, 2);
      [maskAlpha, 0, 255, maskAlpha].forEach((alpha, index) => { mask.data[index * 4 + 3] = alpha; });
      useAppStore.setState({ selectionMask: mask, selectionMaskBounds: { x: 1, y: 1, width: 2, height: 2 }, selectionMaskLayerId: layer.id });
    }
    return layer;
  };
  const pixels = (frameIndex = 0, layer = useAppStore.getState().layers[0]) => {
    const canvas = getSequentialLayerRenderCanvas({ layer, width: 8, height: 8, frameIndex, holdPreviousOnEmptyFrames: false });
    return canvas!.getContext('2d')!.getImageData(0, 0, 8, 8).data.slice();
  };

  it.each([
    { name: 'move', x: 4, y: 1 }, { name: 'overlap', x: 2, y: 2 },
    { name: 'left', x: -1, y: 1 }, { name: 'top', x: 1, y: -1 },
    { name: 'right', x: 7, y: 1 }, { name: 'bottom', x: 1, y: 7 },
    { name: 'outside', x: 10, y: 10 }, { name: 'zero delta', x: 1, y: 1 },
    { name: 'hole', x: 4, y: 1, mask: 255 }, { name: 'feather', x: 4, y: 1, mask: 80 },
    { name: 'fractional source', x: 4, y: 1, alpha: 128 },
  ])('moves $name with exact canonical pixels, frame/chunk preservation, Undo and Redo', async ({ x, y, mask, alpha }) => {
    const layer = seed(mask, alpha);
    const original = pixels();
    const otherFrame = pixels(1);
    const beforeData = JSON.stringify(layer.sequentialData);
    const backing = Array.from(layer.imageData!.data);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    const float = useAppStore.getState().floatingPaste!;
    const expected = original.slice();
    for (let sy = 0; sy < 2; sy += 1) {
      for (let sx = 0; sx < 2; sx += 1) {
        if (mask !== undefined && sx === 1 && sy === 0) continue;
        expected.fill(0, ((1 + sy) * 8 + 1 + sx) * 4, ((1 + sy) * 8 + 1 + sx) * 4 + 4);
      }
    }
    for (let sy = 0; sy < 2; sy += 1) {
      for (let sx = 0; sx < 2; sx += 1) {
        if (mask !== undefined && sx === 1 && sy === 0) continue;
        if (x + sx < 0 || y + sy < 0 || x + sx >= 8 || y + sy >= 8) continue;
        const maskValue = mask !== undefined && !(sx === 0 && sy === 1) ? mask : 255;
        expected.set([255, 0, 0, Math.round((alpha ?? 255) * maskValue / 255)], ((y + sy) * 8 + x + sx) * 4);
      }
    }
    // The target remains the captured frame even when the transport changes while floating.
    useAppStore.setState((state) => ({ sequentialRecord: { ...state.sequentialRecord, currentFrame: 1 } }));
    useAppStore.getState().updateFloatingPastePosition({ x, y });
    await useAppStore.getState().commitFloatingPaste();
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(pixels()).toEqual(expected);
    expect(pixels(1)).toEqual(otherFrame);
    expect(pixels(2)).toEqual(new Uint8ClampedArray(256));
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(1);
    const after = useAppStore.getState().layers[0];
    expect(after.sequentialData!.events.slice(0, 3)).toEqual(layer.sequentialData!.events);
    expect(after.sequentialData!.events.slice(3).every((event) => event.frameIndex === 0)).toBe(true);
    expect(after.sequentialData!.events).toHaveLength(x === 10 ? 4 : 5);
    expect(after.sequentialData!.eventChunks).toEqual(layer.sequentialData!.eventChunks);
    expect(Array.from(after.imageData!.data)).toEqual(backing);
    expect(Array.from(after.framebuffer.getContext('2d')!.getImageData(0, 0, 8, 8).data)).toEqual(backing);
    expect(historyManager.entries()).toHaveLength(1);
    const encoded = encodeSequentialEventsToChunks({ layerId: layer.id, fps: 1, frameCount: 3, events: after.sequentialData!.events });
    const restored = { ...after, sequentialData: { ...after.sequentialData!, events: decodeSequentialChunksToEvents(JSON.parse(JSON.stringify(encoded))) } };
    expect(pixels(0, restored)).toEqual(expected);
    if (x !== 10) {
      expect(restored.sequentialData.events.at(-1)!.brush.customStamp).toEqual(after.sequentialData!.events.at(-1)!.brush.customStamp);
      expect(after.sequentialData!.events.at(-1)!.brush.customStampHash).toBeUndefined();
    }
    await useAppStore.getState().undo();
    expect(JSON.stringify(useAppStore.getState().layers[0].sequentialData)).toBe(beforeData);
    expect(pixels()).toEqual(original);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 1, y: 1 });
    await useAppStore.getState().redo();
    expect(pixels()).toEqual(expected);
    expect(useAppStore.getState().layers[0].sequentialData!.eventChunks).toEqual(layer.sequentialData!.eventChunks);
    expect(float.imageData).not.toBeNull();
  });

  it.each(['cancel', 'delete'] as const)('supports extracted %s without raster backing writes', async (operation) => {
    const layer = seed(80);
    const original = pixels();
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    const erased = pixels();
    if (operation === 'cancel') useAppStore.getState().cancelFloatingPaste();
    else await useAppStore.getState().deleteFloatingPaste();
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(pixels()).toEqual(operation === 'cancel' ? original : erased);
    expect(historyManager.entries()).toHaveLength(operation === 'cancel' ? 0 : 1);
    if (operation === 'delete') {
      await useAppStore.getState().undo();
      expect(pixels()).toEqual(original);
      await useAppStore.getState().redo();
      expect(pixels()).toEqual(erased);
    }
    expect(useAppStore.getState().layers[0].sequentialData!.eventChunks).toEqual(layer.sequentialData!.eventChunks);
  });

  it.each(['scale', 'rotation', 'flip'] as const)('materializes the projected %s bitmap exactly once', async (operation) => {
    seed(255);
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
    const expected = pixels();
    useAppStore.getState().updateFloatingPastePosition({ x: 4, y: 0 });
    if (operation === 'scale') useAppStore.getState().updateFloatingPasteRect({ x: 4, y: 0, width: 4, height: 4 });
    if (operation === 'rotation') useAppStore.getState().updateFloatingPasteRotation(90);
    if (operation === 'flip') useAppStore.getState().flipFloatingPasteHorizontal();
    const size = operation === 'scale' ? 4 : 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const isHole = operation === 'scale' ? x >= 2 && y < 2
          : operation === 'rotation' ? x === 1 && y === 1 : x === 0 && y === 0;
        if (!isHole) expected.set([255, 0, 0, 255], (y * 8 + 4 + x) * 4);
      }
    }
    await useAppStore.getState().commitFloatingPaste();
    expect(pixels()).toEqual(expected);
    await useAppStore.getState().undo();
    await useAppStore.getState().redo();
    expect(pixels()).toEqual(expected);
  });

  it('refuses held empty-frame extraction without authoring held pixels or clearing selection', () => {
    const layer = seed();
    useAppStore.setState((state) => ({ sequentialRecord: { ...state.sequentialRecord, currentFrame: 2 } }));
    expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(false);
    expect(useAppStore.getState().layers[0]).toBe(layer);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 1, y: 1 });
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(2);
    expect(historyManager.entries()).toHaveLength(0);
  });
});
