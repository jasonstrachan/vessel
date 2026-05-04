import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { clearSequentialLayerRendererAll } from '@/lib/sequential/SequentialLayerRenderer';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';

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
    layersNeedRecomposition: false,
    currentCompositeBitmap: null,
  }));
};

describe('selection delete updates framebuffer', () => {
  beforeEach(() => {
    resetStore();
    historyManager.clear();
    clearSequentialLayerRendererAll();
    window.localStorage.clear();
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
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(state.currentCompositeBitmap).toBeNull();
  });

  it('does not delete pixels when a select-all selection belongs to a different layer', () => {
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
    const updatedActive = state.layers.find((layer) => layer.id === activeLayer.id);
    expect(updatedActive?.imageData?.data[(1 * 4 + 1) * 4 + 3]).toBe(255);
    const activeCtx = (updatedActive?.framebuffer as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
    expect(activeCtx?.getImageData(1, 1, 1, 1).data[3]).toBe(255);
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
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

    const snapshot = brush?.getLayerSnapshot?.(layerId);
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
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

    const snapshot = brush?.getLayerSnapshot?.(layerId);
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
  });

  it('blocks keyboard delete when set-bounds selection would clear all CC paint', () => {
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
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
    expect(brush?.getLayerSnapshot?.(layerId)?.hasContent).toBe(true);

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

  it('does not delete CC pixels when set-bounds selection belongs to another layer', () => {
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(ccLayer.id);
    brush?.applyLayerSnapshot?.(ccLayer.id, {
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
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(true);
    expect(brush?.getLayerSnapshot?.(ccLayer.id)?.hasContent).toBe(true);
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'selection-delete-skipped-layer-mismatch',
        layerId: ccLayer.id,
        reason: 'keyboard-delete',
        details: expect.objectContaining({
          selectionAction: 'set-bounds',
          selectionSource: 'selection-marquee-final',
          selectionSourceLayerId: sourceLayer.id,
          activeLayerId: ccLayer.id,
        }),
      }),
    ]));
  });

  it('does not delete CC pixels when an appended selection preserves an earlier layer owner', () => {
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(ccLayer.id);
    brush?.applyLayerSnapshot?.(ccLayer.id, {
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
    expect(updatedLayer?.colorCycleData?.hasContent).toBe(true);
    expect(brush?.getLayerSnapshot?.(ccLayer.id)?.hasContent).toBe(true);
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'selection-delete-skipped-layer-mismatch',
        layerId: ccLayer.id,
        reason: 'keyboard-delete',
        details: expect.objectContaining({
          selectionSourceLayerId: sourceLayer.id,
          activeLayerId: ccLayer.id,
        }),
      }),
    ]));
  });

  it('allows a marquee transform to extract all CC paint into a floating paste', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-extract-full-content';
    const ccLayer: Layer = {
      id: layerId,
      name: 'CC Extract Full Content',
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
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: Date.now(),
        activeLayerId: layerId,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      floatingPaste: null,
    }));

    useAppStore.getState().initColorCycleForLayer(layerId, 4, 4);
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
      paintBuffer: new Uint8Array(16).fill(9).buffer,
      gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
      gradientDefIdBuffer: new Uint16Array(16).fill(2).buffer,
      speedBuffer: new Uint8Array(16).fill(3).buffer,
      flowBuffer: new Uint8Array(16).fill(4).buffer,
      phaseBuffer: new Uint8Array(16).fill(5).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const beforeExtractSnapshot = brush?.getLayerSnapshot?.(layerId);
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.speedBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(3));
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(4));
    expect(Array.from(new Uint8Array(beforeExtractSnapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual(new Array(16).fill(5));

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
    expect(brush?.getLayerSnapshot?.(layerId)?.hasContent).toBe(false);
  });

  it('does not create a CC floating paste when source clear fails after payload capture', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layerId = 'layer-cc-extract-clear-fails';
    const originalGetLayerColorCycleBrush = useAppStore.getState().getLayerColorCycleBrush;
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
      getLayerColorCycleBrush: ((() => ({
        getLayerSnapshot: () => snapshot,
        getCanvas: () => canvas,
      })) as unknown) as typeof originalGetLayerColorCycleBrush,
    }));

    try {
      const extracted = useAppStore.getState().extractSelectionToFloatingPaste();

      expect(extracted).toBe(false);
      expect(useAppStore.getState().floatingPaste).toBeNull();
      expect(useAppStore.getState().selectionStart).toEqual({ x: 0, y: 0 });
      expect(getPersistedCCMutationLog()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'cc-selection-transaction-failed',
          layerId,
          reason: 'extract-selection-transform',
          details: expect.objectContaining({
            reason: 'source-clear-failed',
          }),
        }),
      ]));
    } finally {
      useAppStore.setState({ getLayerColorCycleBrush: originalGetLayerColorCycleBrush });
    }
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
    const brush = useAppStore.getState().getLayerColorCycleBrush(layerId);
    brush?.applyLayerSnapshot?.(layerId, {
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

    expect(brush?.getLayerSnapshot?.(layerId)?.hasContent).toBe(true);
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
    expect(Array.from(new Uint8Array(updatedLayer?.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0))))
      .toEqual(new Array(16).fill(4));
    expect(Array.from(new Uint16Array(updatedLayer?.colorCycleData?.gradientDefIdBuffer ?? new ArrayBuffer(0))))
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
