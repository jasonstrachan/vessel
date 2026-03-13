import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { clearSequentialLayerRendererAll } from '@/lib/sequential/SequentialLayerRenderer';

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
    layersNeedRecomposition: false,
    currentCompositeBitmap: null,
  }));
};

describe('selection delete updates framebuffer', () => {
  beforeEach(() => {
    resetStore();
    historyManager.clear();
    clearSequentialLayerRendererAll();
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
});
