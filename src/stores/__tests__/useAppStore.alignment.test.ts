import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const createImageData = (width: number, height: number): ImageData => {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(width, height);
  }

  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  } as unknown as ImageData;
};

const baseProject = useAppStore.getState().project;

const resetStore = () => {
  const projectReset = baseProject
    ? {
        ...baseProject,
        createdAt: new Date(baseProject.createdAt),
        updatedAt: new Date(baseProject.updatedAt),
        layers: []
      }
    : null;

  useAppStore.setState({
    layers: [],
    activeLayerId: null,
    layersNeedRecomposition: false,
    project: projectReset
  });
};

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe('useAppStore updateLayerAlignment percent offsets', () => {
  const width = 10;
  const height = 8;

  const createLayer = (): Layer => {
    const imageData = createImageData(width, height);
    imageData.data[((3 * width) + 2) * 4 + 3] = 255;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    return {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal'
    };
  };

  it('populates offsetPercent when switching fit to percent', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layer]
          }
        : state.project,
      layersNeedRecomposition: false
    }));

    const { updateLayerAlignment } = useAppStore.getState();
    updateLayerAlignment(layer.id, { ...layer.alignment, fit: 'percent' });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.fit).toBe('percent');
    expect(updatedLayer.alignment.offsetPercent?.x).toBe(0);
    expect(updatedLayer.alignment.offsetPercent?.y).toBe(0);
  });

  it('preserves manually entered percent offsets once in percent mode', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layer]
          }
        : state.project,
      layersNeedRecomposition: false
    }));

    const { updateLayerAlignment } = useAppStore.getState();
    updateLayerAlignment(layer.id, { ...layer.alignment, fit: 'percent' });

    const customPercent = { x: 10, y: 15 } as const;
    const currentAlignment = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...currentAlignment,
      offsetPercent: customPercent
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.offsetPercent).toEqual(customPercent);
  });

  it('clears percent offsets when leaving percent fit', () => {
    const layer = createLayer();

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layer]
          }
        : state.project,
      layersNeedRecomposition: false
    }));

    const { updateLayerAlignment } = useAppStore.getState();
    const currentAlignment = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...currentAlignment,
      fit: 'none'
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.fit).toBe('none');
    expect(updatedLayer.alignment.offsetPercent).toBeUndefined();
  });
});
