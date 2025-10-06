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

  it('populates offsetPercent when switching fit to contain', () => {
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
    updateLayerAlignment(layer.id, { ...layer.alignment, fit: 'contain' });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.fit).toBe('contain');
    expect(updatedLayer.alignment.offsetPercent?.x).toBe(0);
    expect(updatedLayer.alignment.offsetPercent?.y).toBe(0);
  });

  it('preserves manually entered percent offsets once in contain mode', () => {
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
    updateLayerAlignment(layer.id, { ...layer.alignment, fit: 'contain' });

    const customPercent = { x: 10, y: 15 } as const;
    const currentAlignment = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...currentAlignment,
      offsetPercent: customPercent
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.offsetPercent).toEqual(customPercent);
  });

  it('clears percent offsets when leaving contain fit after auto alignment', () => {
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
    updateLayerAlignment(layer.id, {
      ...layer.alignment,
      positioning: 'anchor'
    });

    const anchorAligned = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...anchorAligned,
      fit: 'contain'
    });

    const currentAlignment = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...currentAlignment,
      fit: 'none'
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.fit).toBe('none');
    expect(updatedLayer.alignment.offsetPercent).toBeUndefined();
  });

  it('keeps percent offsets when positioning is auto with non-percent fit', () => {
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
    const baseAlignment = useAppStore.getState().layers[0].alignment;
    updateLayerAlignment(layer.id, {
      ...baseAlignment,
      positioning: 'auto',
      fit: 'contain'
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.positioning).toBe('auto');
    expect(updatedLayer.alignment.fit).toBe('contain');
    expect(updatedLayer.alignment.offsetPercent).toBeDefined();
  });

  it('recomputes percent offsets from pixel offsets when layers are replaced using contain fit', () => {
    const layer = createLayer();
    const layerWithOffsets: Layer = {
      ...layer,
      alignment: {
        ...layer.alignment,
        fit: 'contain',
        offsetPx: { x: 5, y: 2 },
        offsetPercent: { x: 0, y: 0 }
      }
    };

    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: layerWithOffsets.id,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layerWithOffsets]
          }
        : state.project,
      layersNeedRecomposition: false
    }));

    useAppStore.getState().setLayers([layerWithOffsets]);

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.offsetPercent).toEqual({ x: 50, y: 25 });
  });

  it('derives percent offsets from frame data when pixels are stale', () => {
    const layer = createLayer();
    const layerWithFrame = {
      ...layer,
      alignment: {
        ...layer.alignment,
        fit: 'contain',
        offsetPx: { x: 0, y: 0 },
        offsetPercent: { x: 0, y: 0 }
      },
      frame: {
        x: 3,
        y: 2
      }
    } as Layer & { frame: { x: number; y: number } };

    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: layerWithFrame.id,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layerWithFrame]
          }
        : state.project,
      layersNeedRecomposition: false
    }));

    useAppStore.getState().setLayers([layerWithFrame]);

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.offsetPercent).toEqual({ x: 30, y: 25 });
  });

  it('keeps percent offsets in sync after updateLayer modifies pixel offsets', () => {
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

    const { updateLayerAlignment, updateLayer } = useAppStore.getState();
    updateLayerAlignment(layer.id, { ...layer.alignment, fit: 'contain' });

    const targetLayer = useAppStore.getState().layers[0];
    updateLayer(layer.id, {
      alignment: {
        ...targetLayer.alignment,
        offsetPx: { x: 3, y: 4 },
        offsetPercent: { x: 0, y: 0 }
      }
    });

    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.alignment.offsetPercent).toEqual({ x: 30, y: 50 });
  });
});
