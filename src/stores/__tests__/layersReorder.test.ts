import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const makeLayer = (id: string, order: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order,
    imageData: new ImageData(4, 4),
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  } as Layer;
};

const makeProject = (layers: Layer[]): Project => ({
  id: 'proj',
  name: 'proj',
  width: 4,
  height: 4,
  layers,
  backgroundColor: '#000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

describe('layersSlice reorderLayers', () => {
  afterEach(() => {
    useAppStore.setState({ layers: [], project: null });
  });

  it('reorders layers, updates order indices, and flags recomposition', () => {
    const layers = [makeLayer('a', 0), makeLayer('b', 1), makeLayer('c', 2)];
    const project = makeProject(layers);

    useAppStore.setState((state) => ({
      ...state,
      layers,
      project,
      layersNeedRecomposition: false,
    }));

    useAppStore.getState().reorderLayers(0, 2);

    const reordered = useAppStore.getState().layers;
    expect(reordered.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(reordered.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
  });
});
