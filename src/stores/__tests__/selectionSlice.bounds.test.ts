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
});
