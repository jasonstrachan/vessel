import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset, computePercentOffsetFromPixels } from '@/utils/layerMetrics';
import type { Layer, LayerAlignmentPercentOffset, Project } from '@/types';

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

const EPS = 1e-4;

const expectClose = (actual: number, expected: number, epsilon = EPS) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
};

const expectPercentMatch = (
  actual: LayerAlignmentPercentOffset | null | undefined,
  expected: { x: number; y: number }
) => {
  expect(actual).toBeDefined();
  if (!actual) {
    return;
  }
  expectClose(actual.x, expected.x);
  expectClose(actual.y, expected.y);
};

const expectPercentOneOf = (
  actual: LayerAlignmentPercentOffset | null | undefined,
  candidates: Array<LayerAlignmentPercentOffset | null | undefined>
) => {
  expect(actual).toBeDefined();
  if (!actual) {
    return;
  }
  const match = candidates.filter(Boolean).some(candidate => {
    if (!candidate) {
      return false;
    }
    return (
      Math.abs(actual.x - candidate.x) <= EPS &&
      Math.abs(actual.y - candidate.y) <= EPS
    );
  });
  expect(match).toBe(true);
};

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

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const project = state.project as Project;
    const layerWithoutOffsets: Layer = {
      ...updatedLayer,
      alignment: {
        ...updatedLayer.alignment,
        offsetPercent: undefined,
        offsetPx: undefined
      }
    };

    expect(updatedLayer.alignment.fit).toBe('contain');
    const percentFromPx = computePercentOffsetFromPixels(updatedLayer.alignment.offsetPx, project);
    const percentFromMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);
    expectPercentOneOf(updatedLayer.alignment.offsetPercent, [percentFromPx, percentFromMetrics]);
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
    expectPercentMatch(updatedLayer.alignment.offsetPercent, customPercent);
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

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const project = state.project as Project;
    const layerWithoutOffsets: Layer = {
      ...updatedLayer,
      alignment: {
        ...updatedLayer.alignment,
        offsetPercent: undefined,
        offsetPx: undefined
      }
    };
    const percentFromPx = computePercentOffsetFromPixels(updatedLayer.alignment.offsetPx, project);
    const percentFromMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);

    expect(updatedLayer.alignment.positioning).toBe('auto');
    expect(updatedLayer.alignment.fit).toBe('contain');
    expectPercentOneOf(updatedLayer.alignment.offsetPercent, [percentFromPx, percentFromMetrics]);
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

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const project = state.project as Project;
    const layerWithoutOffsets: Layer = {
      ...updatedLayer,
      alignment: {
        ...updatedLayer.alignment,
        offsetPercent: undefined,
        offsetPx: undefined
      }
    };
    const percentFromPx = computePercentOffsetFromPixels(updatedLayer.alignment.offsetPx, project);
    const percentFromMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);
    expectPercentOneOf(updatedLayer.alignment.offsetPercent, [percentFromPx, percentFromMetrics]);
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

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const project = state.project as Project;
    const layerWithoutOffsets: Layer = {
      ...updatedLayer,
      alignment: {
        ...updatedLayer.alignment,
        offsetPercent: undefined,
        offsetPx: undefined
      }
    };
    const percentFromPx = computePercentOffsetFromPixels(updatedLayer.alignment.offsetPx, project);
    const percentFromMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);
    expectPercentOneOf(updatedLayer.alignment.offsetPercent, [percentFromPx, percentFromMetrics]);
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

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const project = state.project as Project;
    const layerWithoutOffsets: Layer = {
      ...updatedLayer,
      alignment: {
        ...updatedLayer.alignment,
        offsetPercent: undefined,
        offsetPx: undefined
      }
    };
    const percentFromPx = computePercentOffsetFromPixels(updatedLayer.alignment.offsetPx, project);
    const percentFromMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);
    expectPercentOneOf(updatedLayer.alignment.offsetPercent, [percentFromPx, percentFromMetrics]);
  });
});


describe('useAppStore updateLayer raster content alignment', () => {
  const install = (layerType: Layer['layerType'] = 'normal') => {
    const imageData = createImageData(4, 4);
    for (let index = 0; index < imageData.data.length; index += 4) {
      imageData.data.set([255, 0, 0, 255], index);
    }
    const framebuffer = document.createElement('canvas');
    framebuffer.width = framebuffer.height = 4;
    framebuffer.getContext('2d')!.putImageData(imageData, 0, 0);
    const layer: Layer = {
      id: 'updated-raster-alignment', name: 'Raster alignment', visible: true,
      opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      layerType, imageData, framebuffer,
      alignment: {
        ...createDefaultLayerAlignment(),
        offsetPx: { x: 2, y: 2 }, offsetPercent: { x: 50, y: 50 },
      },
      ...(layerType === 'color-cycle' ? { colorCycleData: { canvas: framebuffer, hasContent: true } } : {}),
    };
    useAppStore.setState({
      layers: [layer], activeLayerId: layer.id,
      project: {
        id: 'raster-alignment-project', name: 'Raster alignment', width: 4, height: 4,
        layers: [], backgroundColor: 'transparent', createdAt: new Date(0),
        updatedAt: new Date(0), customBrushes: [],
      },
    });
    const replacement = createImageData(4, 4);
    replacement.data.set([255, 0, 0, 255], 4);
    replacement.data.set([255, 0, 0, 255], 20);
    return { layer, replacement };
  };

  it('refreshes automatic offsets from replacement pixels before publishing the layer', () => {
    const { layer, replacement } = install();
    useAppStore.getState().updateLayer(layer.id, { imageData: replacement });
    const updated = useAppStore.getState().layers[0];
    expect(updated.imageData).toBe(replacement);
    // The remaining 1x2 island starts at (1, 0), with free space 3x2.
    expect(updated.alignment).toEqual({
      ...layer.alignment,
      offsetPercent: { x: (1 / 3) * 100, y: 0 }, offsetPx: { x: 1, y: 0 },
    });
    expect(layer.alignment.offsetPx).toEqual({ x: 2, y: 2 });
  });

  it('preserves explicit manual alignment supplied with replacement pixels', () => {
    const { layer, replacement } = install();
    const alignment: Layer['alignment'] = {
      ...layer.alignment, positioning: 'anchor',
      offsetPx: { x: 3, y: -2 }, offsetPercent: { x: 37, y: -25 },
    };
    useAppStore.getState().updateLayer(layer.id, { imageData: replacement, alignment });
    expect(useAppStore.getState().layers[0].alignment).toEqual(alignment);
  });

  it('preserves alignment for an update that supplies the existing bitmap unchanged', () => {
    const { layer } = install();
    const alignment = {
      ...layer.alignment,
      offsetPx: { x: 1, y: 3 }, offsetPercent: { x: 25, y: 75 },
    };
    useAppStore.setState({ layers: [{ ...layer, alignment }] });
    useAppStore.getState().updateLayer(layer.id, { imageData: layer.imageData });
    expect(useAppStore.getState().layers[0].alignment).toEqual(alignment);
  });

  it.each(['metadata-only', 'alignment-only', 'null-image', 'color-cycle', 'sequential'] as const)(
    'preserves the existing offset authority for %s updates', (kind) => {
      const { layer, replacement } = install(kind === 'color-cycle' || kind === 'sequential' ? kind : 'normal');
      const updates: Partial<Layer> = kind === 'metadata-only' ? { name: 'Renamed raster' }
        : kind === 'alignment-only' ? { alignment: { ...layer.alignment, offsetPx: { x: 1, y: 3 }, offsetPercent: { x: 25, y: 75 } } }
        : { imageData: kind === 'null-image' ? null : replacement };
      useAppStore.getState().updateLayer(layer.id, updates, { skipColorCycleSync: true });
      expect(useAppStore.getState().layers[0].alignment).toEqual(updates.alignment ?? layer.alignment);
    },
  );
});
