import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayerInput = (name: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;

  return {
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over' as const,
    locked: false,
    transparencyLocked: false,
    imageData: new ImageData(4, 4),
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal' as const
  };
};

beforeEach(() => {
  useAppStore.setState({
    layers: [],
    activeLayerId: null,
    selectedLayerIds: [],
    referenceLayerId: null
  });
});

describe('reference layer management', () => {
  it('starts with no reference layer and toggles via setReferenceLayer', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createLayerInput('Layer 1'));

    expect(useAppStore.getState().referenceLayerId).toBeNull();

    store.setReferenceLayer(layerId);
    expect(useAppStore.getState().referenceLayerId).toBe(layerId);

    store.setReferenceLayer(null);
    expect(useAppStore.getState().referenceLayerId).toBeNull();
  });

  it('only keeps the most recent reference layer selection', () => {
    const store = useAppStore.getState();
    const firstLayerId = store.addLayer(createLayerInput('Layer 1'));
    const secondLayerId = store.addLayer(createLayerInput('Layer 2'));

    store.setReferenceLayer(firstLayerId);
    store.setReferenceLayer(secondLayerId);

    expect(useAppStore.getState().referenceLayerId).toBe(secondLayerId);
  });

  it('clears referenceLayerId when the referenced layer is removed', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createLayerInput('Layer 1'));
    store.setReferenceLayer(layerId);

    store.removeLayer(layerId);

    expect(useAppStore.getState().referenceLayerId).toBeNull();
  });

  it('clears referenceLayerId when setLayers omits the reference layer', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createLayerInput('Layer 1'));
    store.setReferenceLayer(layerId);

    const remainingLayers = useAppStore.getState().layers.filter(layer => layer.id !== layerId);
    store.setLayers(remainingLayers);

    expect(useAppStore.getState().referenceLayerId).toBeNull();
  });
});
