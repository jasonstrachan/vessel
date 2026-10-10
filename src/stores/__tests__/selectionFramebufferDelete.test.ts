import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { clearSequentialLayerRendererAll } from '@/lib/sequential/SequentialLayerRenderer';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  getColorCycleLegacyLayerBuffer,
} from '@/lib/colorCycle/document';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';
import { readTestColorCycleBrushLayerSnapshot } from '@/testing/colorCycleSnapshotTestUtils';

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
      (['api-delete', 'keyboard-delete'] as const).map((source) => ({ layerType, source }))),
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

    useAppStore.getState().deleteSelectedPixels(source);
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
      } else useAppStore.getState().deleteSelectedPixels('api-delete');
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
      useAppStore.getState().deleteSelectedPixels('keyboard-delete');
      await waitForPendingHistoryCommits();
      const immediate = snapshot();
      expect(historyManager.entries()).toHaveLength(1);
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
