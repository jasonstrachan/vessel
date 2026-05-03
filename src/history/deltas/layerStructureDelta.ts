import { useAppStore } from '@/stores/useAppStore';
import type { CanvasSnapshot, Layer, LayerGroup } from '@/types';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';

import type {
  HistoryDelta,
  HistoryDirection,
  HistoryRehydrationTargets,
} from '@/history/actionTypes';

export interface LayerStructureSnapshot {
  snapshot: CanvasSnapshot;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  layerGroups: LayerGroup[];
}

const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const cloneArrayBuffer = (input: ArrayBuffer | undefined): ArrayBuffer | undefined => {
  if (!input) {
    return undefined;
  }
  return input.slice(0);
};

const cloneLayerGroups = (groups: LayerGroup[]): LayerGroup[] => (
  groups.map((group) => ({ ...group }))
);

const cloneLayerForReplay = (layer: Layer): Layer => ({
  ...layer,
  imageData: cloneImageData(layer.imageData),
  alignment: cloneLayerAlignment(layer.alignment),
  colorCycleData: layer.colorCycleData
    ? {
        ...layer.colorCycleData,
        colorCycleBrush: undefined,
        isAnimating: false,
        canvasImageData: cloneImageData(layer.colorCycleData.canvasImageData) ?? undefined,
        eraseMaskImageData: cloneImageData(layer.colorCycleData.eraseMaskImageData) ?? undefined,
        softEdgeMaskImageData: cloneImageData(layer.colorCycleData.softEdgeMaskImageData) ?? undefined,
        gradient: layer.colorCycleData.gradient
          ? layer.colorCycleData.gradient.map((stop) => ({ ...stop }))
          : undefined,
        gradientDefs: layer.colorCycleData.gradientDefs
          ? layer.colorCycleData.gradientDefs.map((entry) => ({ ...entry }))
          : undefined,
        slotPalettes: layer.colorCycleData.slotPalettes
          ? layer.colorCycleData.slotPalettes.map((entry) => ({
              slot: entry.slot,
              stops: entry.stops.map((stop) => ({ ...stop })),
            }))
          : undefined,
        fgDerivedGradients: layer.colorCycleData.fgDerivedGradients
          ? layer.colorCycleData.fgDerivedGradients.map((entry) => ({
              ...entry,
              spec: { ...entry.spec },
            }))
          : undefined,
        derivedGradients: layer.colorCycleData.derivedGradients
          ? layer.colorCycleData.derivedGradients.map((entry) => ({
              ...entry,
              spec: { ...entry.spec },
            }))
          : undefined,
        gradientIdBuffer: cloneArrayBuffer(layer.colorCycleData.gradientIdBuffer),
        gradientDefIdBuffer: cloneArrayBuffer(layer.colorCycleData.gradientDefIdBuffer),
        gradientDefStore: layer.colorCycleData.gradientDefStore
          ? layer.colorCycleData.gradientDefStore.map((entry) => ({
              ...entry,
              stops: entry.stops.map((stop) => ({ ...stop })),
            }))
          : undefined,
      }
    : undefined,
  sequentialData: layer.sequentialData
    ? {
        ...layer.sequentialData,
        events: layer.sequentialData.events.map((event) => ({
          ...event,
          brush: {
            ...event.brush,
            pluginConfig: event.brush.pluginConfig
              ? { ...event.brush.pluginConfig }
              : event.brush.pluginConfig,
            colorCycleGradient: event.brush.colorCycleGradient
              ? event.brush.colorCycleGradient.map((stop) => ({ ...stop }))
              : event.brush.colorCycleGradient,
          },
          stamps: event.stamps.map((stamp) => ({ ...stamp })),
        })),
      }
    : undefined,
});

const cloneLayersForReplay = (layers: Layer[]): Layer[] => layers.map((layer) => cloneLayerForReplay(layer));

const collectLayerTargets = (targets: HistoryRehydrationTargets, layers: Layer[]): void => {
  layers.forEach((layer) => {
    targets.layerIds.add(layer.id);
    if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
      targets.colorCycleLayerIds.add(layer.id);
      targets.workerScopes.add('color-cycle-gradient');
    }
  });
};

class LayerStructureDelta implements HistoryDelta {
  readonly _tag = 'layer-structure';
  readonly approxBytes?: number;

  constructor(
    private readonly beforeSnapshot: LayerStructureSnapshot,
    private readonly afterSnapshot: LayerStructureSnapshot,
  ) {
    const layerCount =
      (beforeSnapshot.snapshot.layers?.length ?? 0) + (afterSnapshot.snapshot.layers?.length ?? 0);
    this.approxBytes = Math.max(1024, layerCount * 512);
  }

  apply(direction: HistoryDirection): void {
    const target = direction === 'forward' ? this.afterSnapshot : this.beforeSnapshot;
    const targetSnapshot = target.snapshot;
    const restoredLayers = cloneLayersForReplay(targetSnapshot.layers ?? []);
    const validLayerIds = new Set(restoredLayers.map((layer) => layer.id));
    const store = useAppStore.getState();

    useAppStore.setState({ layerGroups: cloneLayerGroups(target.layerGroups) });
    store.setLayers(restoredLayers);
    if (targetSnapshot.activeLayerId && validLayerIds.has(targetSnapshot.activeLayerId)) {
      store.setActiveLayer(targetSnapshot.activeLayerId);
    } else {
      useAppStore.setState({
        activeLayerId: null,
      });
    }

    const restoredSelection = target.selectedLayerIds.filter((layerId) => validLayerIds.has(layerId));
    store.setSelectedLayerIds(restoredSelection);

    const restoredReferenceId =
      target.referenceLayerId && validLayerIds.has(target.referenceLayerId)
        ? target.referenceLayerId
        : null;
    store.setReferenceLayer(restoredReferenceId);

    const resolvedProjectLayers = useAppStore.getState().layers;
    useAppStore.setState((state) => {
      if (!state.project) {
        return state;
      }
      return {
        project: {
          ...state.project,
          layers: resolvedProjectLayers,
          layerGroups: cloneLayerGroups(target.layerGroups),
          updatedAt: new Date(),
        },
      };
    });

    if (!targetSnapshot.activeLayerId && resolvedProjectLayers.length > 0) {
      const fallbackActive = resolvedProjectLayers[0]?.id;
      if (fallbackActive) {
        store.setActiveLayer(fallbackActive);
      }
    }

    useAppStore.getState().setLayersNeedRecomposition(true);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    collectLayerTargets(targets, this.beforeSnapshot.snapshot.layers ?? []);
    collectLayerTargets(targets, this.afterSnapshot.snapshot.layers ?? []);
  }
}

interface LayerStructureDeltaOptions {
  before: LayerStructureSnapshot;
  after: LayerStructureSnapshot;
}

export const createLayerStructureDelta = ({
  before,
  after,
}: LayerStructureDeltaOptions): HistoryDelta => new LayerStructureDelta(before, after);
