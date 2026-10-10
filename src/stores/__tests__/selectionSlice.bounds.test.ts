import historyManager from '@/history/historyService';
import { selectionSnapshotFromState } from '@/history/selectionState';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, width: number, height: number): Layer => {
  const imageData = new ImageData(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return {
    id,
    name: 'Selection Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  };
};

const createProject = (layer: Layer): Project => ({
  id: 'selection-project',
  name: 'Selection Project',
  width: layer.imageData?.width ?? 1,
  height: layer.imageData?.height ?? 1,
  layers: [layer],
  backgroundColor: '#fff',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

describe('selection slice bounds helpers', () => {
  const alphaAt = (mask: ImageData, x: number, y: number): number =>
    mask.data[(y * mask.width + x) * 4 + 3];
  const createMask = (
    width: number,
    height: number,
    opaquePixels: Array<{ x: number; y: number }>
  ): ImageData => {
    const mask = new ImageData(width, height);
    opaquePixels.forEach(({ x, y }) => {
      const index = (y * width + x) * 4;
      mask.data[index] = 255;
      mask.data[index + 1] = 255;
      mask.data[index + 2] = 255;
      mask.data[index + 3] = 255;
    });
    return mask;
  };

  const resetStore = () => {
    useAppStore.setState({
      project: null,
      layers: [],
      activeLayerId: null,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: null,
      floatingPaste: null,
    });
  };

  beforeEach(() => {
    historyManager.clear();
  });

  afterEach(() => {
    resetStore();
    historyManager.clear();
  });

  it('selectAllActiveLayerPixels fills bounds from the active layer size', () => {
    const layer = createLayer('layer-1', 4, 3);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: new ImageData(1, 1),
      selectionMaskBounds: { x: 9, y: 9, width: 1, height: 1 },
      selectionMaskLayerId: 'stale',
    });

    useAppStore.getState().selectAllActiveLayerPixels();

    expect(useAppStore.getState().selectionStart).toEqual({ x: 0, y: 0 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 4, y: 3 });
    expect(useAppStore.getState().selectionMask).toBeNull();
    expect(useAppStore.getState().selectionMaskBounds).toBeNull();
    expect(useAppStore.getState().selectionMaskLayerId).toBeNull();
    expect(useAppStore.getState().selectionLastAction).toEqual(expect.objectContaining({
      action: 'select-all',
      ownerKind: 'select-all',
      activeLayerId: layer.id,
    }));
  });

  it('clearSelection resets bounds and masks to null', () => {
    useAppStore.setState({
      selectionStart: { x: 2, y: 2 },
      selectionEnd: { x: 4, y: 5 },
      selectionMask: new ImageData(1, 1),
      selectionMaskBounds: { x: 2, y: 2, width: 2, height: 3 },
      selectionMaskLayerId: 'layer-1',
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().clearSelection();

    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(useAppStore.getState().selectionEnd).toBeNull();
    expect(useAppStore.getState().selectionMask).toBeNull();
    expect(useAppStore.getState().selectionMaskBounds).toBeNull();
    expect(useAppStore.getState().selectionMaskLayerId).toBeNull();
    expect(useAppStore.getState().selectionLastAction).toBeNull();
  });

  it('setSelectionBounds replaces bounds and drops stale mask references', () => {
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
      selectionMask: new ImageData(1, 1),
      selectionMaskBounds: { x: 0, y: 0, width: 1, height: 1 },
      selectionMaskLayerId: 'layer-previous',
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.setState({ activeLayerId: 'layer-current' });
    useAppStore.getState().setSelectionBounds({ x: 2, y: 3 }, { x: 6, y: 8 }, 'selection-marquee-final');

    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 3 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 6, y: 8 });
    expect(useAppStore.getState().selectionMask).toBeNull();
    expect(useAppStore.getState().selectionMaskBounds).toBeNull();
    expect(useAppStore.getState().selectionMaskLayerId).toBeNull();
    expect(useAppStore.getState().selectionLastAction).toEqual(expect.objectContaining({
      action: 'set-bounds',
      source: 'selection-marquee-final',
      ownerKind: 'direct-marquee',
      activeLayerId: 'layer-current',
      bounds: { x: 2, y: 3, width: 4, height: 5 },
    }));
  });

  it('appendSelectionBounds merges an incoming marquee with an existing marquee', () => {
    useAppStore.setState({
      activeLayerId: 'layer-1',
      selectionStart: { x: 2, y: 3 },
      selectionEnd: { x: 4, y: 5 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().appendSelectionBounds({ x: 6, y: 4 }, { x: 8, y: 7 });

    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 2, y: 3 });
    expect(state.selectionEnd).toEqual({ x: 8, y: 7 });
    expect(state.selectionMaskBounds).toEqual({ x: 2, y: 3, width: 6, height: 4 });
    expect(state.selectionMaskLayerId).toBe('layer-1');
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      ownerKind: 'mask-selection',
      activeLayerId: 'layer-1',
      maskLayerId: 'layer-1',
    }));
    expect(alphaAt(state.selectionMask as ImageData, 0, 0)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 4, 1)).toBe(255);
  });

  it('appendSelectionMask merges an incoming mask with an existing marquee', () => {
    useAppStore.setState({
      activeLayerId: 'layer-1',
      selectionStart: { x: 2, y: 2 },
      selectionEnd: { x: 4, y: 4 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().appendSelectionMask({
      mask: createMask(2, 2, [{ x: 1, y: 1 }]),
      bounds: { x: 5, y: 5, width: 2, height: 2 },
    });

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 2, y: 2, width: 5, height: 5 });
    expect(state.selectionMaskLayerId).toBe('layer-1');
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      ownerKind: 'mask-selection',
      activeLayerId: 'layer-1',
      maskLayerId: 'layer-1',
    }));
    expect(alphaAt(state.selectionMask as ImageData, 0, 0)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 4, 4)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 3, 3)).toBe(0);
  });

  it('appendSelectionBounds merges into an existing mask selection', () => {
    useAppStore.setState({
      activeLayerId: 'layer-active',
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      selectionMask: createMask(2, 2, [{ x: 1, y: 0 }]),
      selectionMaskBounds: { x: 4, y: 4, width: 2, height: 2 },
      selectionMaskLayerId: 'layer-mask',
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().appendSelectionBounds({ x: 0, y: 0 }, { x: 2, y: 1 });

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 6, height: 6 });
    expect(state.selectionMaskLayerId).toBe('layer-mask');
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      ownerKind: 'mask-selection',
      activeLayerId: 'layer-mask',
      maskLayerId: 'layer-mask',
    }));
    expect(alphaAt(state.selectionMask as ImageData, 0, 0)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 5, 4)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 3, 3)).toBe(0);
  });

  it('appendSelectionMask preserves existing owner after a layer switch', () => {
    useAppStore.setState({
      activeLayerId: 'layer-active',
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      selectionMask: createMask(2, 2, [{ x: 1, y: 0 }]),
      selectionMaskBounds: { x: 4, y: 4, width: 2, height: 2 },
      selectionMaskLayerId: 'layer-mask',
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-freehand',
        ownerKind: 'mask-selection',
        t: Date.now(),
        activeLayerId: 'layer-mask',
        maskLayerId: 'layer-mask',
        bounds: { x: 4, y: 4, width: 2, height: 2 },
      },
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().appendSelectionMask({
      mask: createMask(2, 2, [{ x: 0, y: 0 }]),
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      layerId: 'layer-active',
    });

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 6, height: 6 });
    expect(state.selectionMaskLayerId).toBe('layer-mask');
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      ownerKind: 'mask-selection',
      activeLayerId: 'layer-mask',
      maskLayerId: 'layer-mask',
    }));
  });

  it('invertSelection inverts marquee bounds across the active layer dimensions', () => {
    const layer = createLayer('layer-invert', 4, 3);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 2 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().invertSelection();

    const state = useAppStore.getState();
    expect(state.selectionMask).toBeTruthy();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(state.selectionStart).toEqual({ x: 0, y: 0 });
    expect(state.selectionEnd).toEqual({ x: 4, y: 3 });
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      ownerKind: 'mask-selection',
      activeLayerId: layer.id,
      maskLayerId: layer.id,
    }));
    expect(alphaAt(state.selectionMask as ImageData, 1, 1)).toBe(0);
    expect(alphaAt(state.selectionMask as ImageData, 0, 0)).toBe(255);
  });

  it('invertSelection clears selection when current selection covers the whole layer', () => {
    const layer = createLayer('layer-full', 4, 3);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 3 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().invertSelection();

    const state = useAppStore.getState();
    expect(state.selectionStart).toBeNull();
    expect(state.selectionEnd).toBeNull();
    expect(state.selectionMask).toBeNull();
    expect(state.selectionMaskBounds).toBeNull();
    expect(state.selectionMaskLayerId).toBeNull();
  });

  it('adjustMarqueeSelection expands a rectangular selection and clamps to project bounds', () => {
    const layer = createLayer('layer-expand', 10, 8);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 2, y: 2 },
      selectionEnd: { x: 6, y: 5 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().adjustMarqueeSelection(3);

    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 0, y: 0 });
    expect(state.selectionEnd).toEqual({ x: 9, y: 8 });
    expect(state.selectionMask).toBeNull();
    expect(state.selectionMaskBounds).toBeNull();
    expect(state.selectionLastAction).toEqual(expect.objectContaining({
      source: 'selection-marquee-expand',
      ownerKind: 'direct-marquee',
      activeLayerId: layer.id,
      bounds: { x: 0, y: 0, width: 9, height: 8 },
    }));
  });

  it('adjustMarqueeSelection insets a rectangular selection when enough room remains', () => {
    const layer = createLayer('layer-inset', 12, 12);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 2 },
      selectionEnd: { x: 11, y: 10 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().adjustMarqueeSelection(-2);

    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 3, y: 4 });
    expect(state.selectionEnd).toEqual({ x: 9, y: 8 });
    expect(state.selectionMask).toBeNull();
    expect(state.selectionMaskBounds).toBeNull();
  });

  it('adjustMarqueeSelection leaves the selection unchanged when inset would collapse it', () => {
    const layer = createLayer('layer-collapse', 6, 6);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 5, y: 4 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().adjustMarqueeSelection(-2);

    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 1, y: 1 });
    expect(state.selectionEnd).toEqual({ x: 5, y: 4 });
    expect(state.selectionMask).toBeNull();
    expect(state.selectionMaskBounds).toBeNull();
  });

  it.each([
    { name: 'negative both', start: { x: -8, y: -8 }, end: { x: 24, y: 24 }, delta: -1, left: 1, top: 1, right: 23, bottom: 23 },
    { name: 'negative x', start: { x: -8, y: 8 }, end: { x: 24, y: 24 }, delta: -1, left: 1, top: 9, right: 23, bottom: 23 },
    { name: 'negative y reversed', start: { x: 24, y: 24 }, end: { x: 8, y: -8 }, delta: -1, left: 9, top: 1, right: 23, bottom: 23 },
    { name: 'right and bottom overflow', start: { x: 32, y: 32 }, end: { x: 48, y: 48 }, delta: -1, left: 33, top: 33, right: 39, bottom: 39 },
    { name: 'positive inset', start: { x: 8, y: 8 }, end: { x: 24, y: 24 }, delta: -1, left: 9, top: 9, right: 23, bottom: 23 },
    { name: 'positive expand', start: { x: 8, y: 8 }, end: { x: 24, y: 24 }, delta: 2, left: 6, top: 6, right: 26, bottom: 26 },
  ])('adjusts visible marquee geometry with exact history: $name', async ({ start, end, delta, left, top, right, bottom }) => {
    const layer = createLayer('adjust-history', 40, 40);
    const context = layer.framebuffer!.getContext('2d')!;
    context.fillStyle = '#a53c29';
    context.fillRect(0, 0, 40, 40);
    layer.imageData = context.getImageData(0, 0, 40, 40);
    useAppStore.setState({ project: createProject(layer), layers: [layer], activeLayerId: layer.id, selectionVectorPath: null });
    useAppStore.getState().setSelectionBounds(start, end, 'selection-marquee-final');
    const geometry = () => {
      const { provenance, ...snapshot } = selectionSnapshotFromState(useAppStore.getState());
      void provenance;
      return snapshot;
    };
    const before = geometry();
    const pixels = layer.imageData.data.slice();
    useAppStore.getState().adjustMarqueeSelection(delta);
    expect(useAppStore.getState().selectionStart).toEqual({ x: left, y: top });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: right, y: bottom });
    expect(historyManager.entries()).toHaveLength(1);
    const after = geometry();
    await useAppStore.getState().undo();
    expect(geometry()).toEqual(before);
    expect(useAppStore.getState().selectionLastAction).toMatchObject({ ownerKind: 'history-restored', activeLayerId: layer.id });
    expect(historyManager.entries()).toHaveLength(0);
    expect(historyManager.redoEntries()).toHaveLength(1);
    await useAppStore.getState().redo();
    expect(geometry()).toEqual(after);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.redoEntries()).toHaveLength(0);
    expect(useAppStore.getState().layers[0]).toBe(layer);
    expect(layer.imageData.data).toEqual(pixels);
    expect(context.getImageData(0, 0, 40, 40).data).toEqual(pixels);
  });

  it.each([
    { name: 'clipped collapse', start: { x: -8, y: -8 }, end: { x: 24, y: 24 }, delta: -12 },
    { name: 'entirely outside', start: { x: -24, y: -24 }, end: { x: -8, y: -8 }, delta: 1 },
    { name: 'saturated expansion', start: { x: 0, y: 0 }, end: { x: 40, y: 40 }, delta: 9999 },
  ])('keeps geometry and history unchanged for $name', ({ start, end, delta }) => {
    const layer = createLayer('adjust-noop', 40, 40);
    useAppStore.setState({ project: createProject(layer), layers: [layer], activeLayerId: layer.id, selectionVectorPath: null });
    useAppStore.getState().setSelectionBounds(start, end, 'selection-marquee-final');
    const before = selectionSnapshotFromState(useAppStore.getState());
    useAppStore.getState().adjustMarqueeSelection(delta);
    const after = selectionSnapshotFromState(useAppStore.getState());
    expect(after.start).toEqual(before.start);
    expect(after.end).toEqual(before.end);
    expect(after.mask).toEqual(before.mask);
    expect(historyManager.entries()).toHaveLength(0);
    expect(historyManager.redoEntries()).toHaveLength(0);
  });

  it.each([
    { name: 'smaller image inset', imageSize: 24, start: 20, end: 35, delta: -1, left: 21, right: 34 },
    { name: 'smaller image expand', imageSize: 24, start: 20, end: 35, delta: 1, left: 19, right: 36 },
    { name: 'larger image expand', imageSize: 64, start: 32, end: 40, delta: 2, left: 30, right: 40 },
    { name: 'larger image clipped inset', imageSize: 64, start: 32, end: 48, delta: -1, left: 33, right: 39 },
  ])('uses document bounds for an imported $name', async ({ imageSize, start, end, delta, left, right }) => {
    const layer = createLayer('unequal-image', imageSize, imageSize);
    const project = { ...createProject(layer), width: 40, height: 40 };
    useAppStore.setState({ project, layers: [layer], activeLayerId: layer.id, selectionVectorPath: null });
    useAppStore.getState().setSelectionBounds({ x: start, y: start }, { x: end, y: end }, 'selection-marquee-final');
    const geometry = () => {
      const { provenance, ...snapshot } = selectionSnapshotFromState(useAppStore.getState());
      void provenance;
      return snapshot;
    };
    const before = geometry();
    const pixels = layer.imageData!.data.slice();
    useAppStore.getState().adjustMarqueeSelection(delta);
    expect(useAppStore.getState().selectionStart).toEqual({ x: left, y: left });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: right, y: right });
    expect(historyManager.entries()).toHaveLength(1);
    const after = geometry();
    await useAppStore.getState().undo();
    expect(geometry()).toEqual(before);
    await useAppStore.getState().redo();
    expect(geometry()).toEqual(after);
    expect(useAppStore.getState().layers[0]).toBe(layer);
    expect(layer.imageData!.data).toEqual(pixels);
  });

  it('restores immutable mask holes, owner and geometry through adjustment history', async () => {
    const layer = createLayer('adjust-mask-history', 40, 40);
    useAppStore.setState({ project: createProject(layer), layers: [layer], activeLayerId: layer.id, selectionVectorPath: null });
    const mask = new ImageData(12, 12);
    for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) {
      mask.data.set([17, 29, 41, x >= 4 && x < 8 && y >= 4 && y < 8 ? 0 : 255], (y * 12 + x) * 4);
    }
    useAppStore.getState().appendSelectionMask({ mask, bounds: { x: 4, y: 4, width: 12, height: 12 }, layerId: layer.id });
    const before = selectionSnapshotFromState(useAppStore.getState());
    const admittedMask = useAppStore.getState().selectionMask!;
    const inputBytes = mask.data.slice();
    const admittedBytes = admittedMask.data.slice();
    useAppStore.getState().adjustMarqueeSelection(-1);
    const after = selectionSnapshotFromState(useAppStore.getState());
    expect(after.mask?.data).not.toEqual(before.mask?.data);
    expect(historyManager.entries()).toHaveLength(1);
    await useAppStore.getState().undo();
    expect(useAppStore.getState().selectionMask?.data).toEqual(before.mask?.data);
    expect(useAppStore.getState().selectionMaskBounds).toEqual(before.maskBounds);
    expect(useAppStore.getState().selectionMaskLayerId).toBe(layer.id);
    await useAppStore.getState().redo();
    expect(useAppStore.getState().selectionMask?.data).toEqual(after.mask?.data);
    expect(useAppStore.getState().selectionMaskBounds).toEqual(after.maskBounds);
    expect(useAppStore.getState().selectionMaskLayerId).toBe(layer.id);
    expect(mask.data).toEqual(inputBytes);
    expect(admittedMask.data).toEqual(admittedBytes);
  });

});
