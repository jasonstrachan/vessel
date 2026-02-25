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
