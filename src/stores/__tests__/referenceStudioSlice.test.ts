import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project, ReferenceAsset } from '@/types';

const project: Project = {
  id: 'reference-project',
  name: 'Reference project',
  width: 100,
  height: 100,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
  referenceAssets: [],
  referenceSamplingSource: { kind: 'canvas' },
};

const asset: ReferenceAsset = {
  id: 'reference-1',
  name: 'Portrait',
  dataUrl: 'data:image/png;base64,AAAA',
  naturalWidth: 20,
  naturalHeight: 30,
  visible: true,
  locked: false,
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  flipX: false,
  flipY: false,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  useAppStore.setState((state) => ({
    project,
    layers: [],
    referenceLayerId: null,
    colorPickerPreferReferenceLayer: false,
    autosave: {
      ...state.autosave,
      isSessionSyncSuspended: true,
      hasUnsavedChanges: false,
      dirtyRevision: 0,
      savedRevision: 0,
    },
  }));
});

describe('referenceStudioSlice', () => {
  it('adds, updates, selects, and removes a persisted reference asset', () => {
    const store = useAppStore.getState();
    store.addReferenceAsset(asset);
    store.updateReferenceAsset(asset.id, { opacity: 0.4, flipX: true });
    store.setReferenceSamplingSource({ kind: 'asset', assetId: asset.id });

    expect(useAppStore.getState().project?.referenceAssets?.[0]).toMatchObject({
      id: asset.id,
      opacity: 0.4,
      flipX: true,
    });
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual({
      kind: 'asset',
      assetId: asset.id,
    });
    expect(useAppStore.getState().autosave.hasUnsavedChanges).toBe(true);

    store.removeReferenceAsset(asset.id);
    expect(useAppStore.getState().project?.referenceAssets).toEqual([]);
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual({ kind: 'canvas' });
  });

  it('keeps artwork layers available as an explicit sampling source', () => {
    useAppStore.setState({
      layers: [{ id: 'layer-1', name: 'Paint', visible: true } as Layer],
    });
    useAppStore.getState().setReferenceSamplingSource({ kind: 'layer', layerId: 'layer-1' });

    expect(useAppStore.getState().referenceLayerId).toBe('layer-1');
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual({
      kind: 'layer',
      layerId: 'layer-1',
    });
  });
});
