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
      floatingPaste: null,
    });
  };

  afterEach(() => {
    resetStore();
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
  });

  it('setSelectionBounds replaces bounds and drops stale mask references', () => {
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
      selectionMask: new ImageData(1, 1),
      selectionMaskBounds: { x: 0, y: 0, width: 1, height: 1 },
      selectionMaskLayerId: 'layer-previous',
    } as Partial<ReturnType<typeof useAppStore.getState>>);

    useAppStore.getState().setSelectionBounds({ x: 2, y: 3 }, { x: 6, y: 8 });

    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 3 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 6, y: 8 });
    expect(useAppStore.getState().selectionMask).toBeNull();
    expect(useAppStore.getState().selectionMaskBounds).toBeNull();
    expect(useAppStore.getState().selectionMaskLayerId).toBeNull();
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
    expect(state.selectionMaskLayerId).toBe('layer-active');
    expect(alphaAt(state.selectionMask as ImageData, 0, 0)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 5, 4)).toBe(255);
    expect(alphaAt(state.selectionMask as ImageData, 3, 3)).toBe(0);
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
});
