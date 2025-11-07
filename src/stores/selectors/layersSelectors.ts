import type { AppState } from '@/stores/useAppStore';

export const selectLayers = (state: AppState) => state.layers;

export const selectActiveLayerId = (state: AppState) => state.activeLayerId;

export const selectSelectedLayerIds = (state: AppState) => state.selectedLayerIds;

export const selectLayerIdsDescending = (state: AppState) => {
  const ids: string[] = [];
  for (let index = state.layers.length - 1; index >= 0; index -= 1) {
    const layer = state.layers[index];
    if (layer) {
      ids.push(layer.id);
    }
  }
  return ids;
};

export const selectReferenceLayerId = (state: AppState) => state.referenceLayerId;

export const selectLayersNeedRecomposition = (state: AppState) => state.layersNeedRecomposition;

export const selectLayerActions = (state: AppState) => ({
  setLayersNeedRecomposition: state.setLayersNeedRecomposition,
  setLayers: state.setLayers,
  addLayer: state.addLayer,
  removeLayer: state.removeLayer,
  updateLayer: state.updateLayer,
  reorderLayers: state.reorderLayers,
  setActiveLayer: state.setActiveLayer,
  setSelectedLayerIds: state.setSelectedLayerIds,
  setReferenceLayer: state.setReferenceLayer,
  updateLayerAlignment: state.updateLayerAlignment,
  initColorCycleForLayer: state.initColorCycleForLayer,
  cleanupColorCycleForLayer: state.cleanupColorCycleForLayer,
  getLayerColorCycleBrush: state.getLayerColorCycleBrush,
  compositeLayersToCanvas: state.compositeLayersToCanvas,
  captureCanvasToActiveLayer: state.captureCanvasToActiveLayer,
  captureCanvasToLayer: state.captureCanvasToLayer,
});

export const selectSetLayersNeedRecomposition = (state: AppState) =>
  state.setLayersNeedRecomposition;

export const selectActiveLayer = (state: AppState) => {
  const activeId = state.activeLayerId;
  if (!activeId) {
    return null;
  }
  return state.layers.find((layer) => layer.id === activeId) ?? null;
};
