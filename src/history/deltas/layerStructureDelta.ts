import { useAppStore } from '@/stores/useAppStore';
import type {
  CanvasSnapshot,
  Layer,
  LayerGroup,
  ReferenceSamplingSource,
  TxtShape,
} from '@/types';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';
import { cloneAdjustmentLayerData } from '@/lib/adjustmentLayers';

import {
  prepareHistoryDelta,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '@/history/actionTypes';
import { restoreOwnedProperties } from '@/history/storeStateCompensation';

export interface LayerStructureSnapshot {
  snapshot: CanvasSnapshot;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  referenceSamplingSource?: ReferenceSamplingSource;
  layerGroups: LayerGroup[];
  txtShapes?: TxtShape[];
}

const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const cloneLayerGroups = (groups: LayerGroup[]): LayerGroup[] => (
  groups.map((group) => ({
    ...group,
    interlace: group.interlace ? { ...group.interlace } : undefined,
  }))
);

const cloneTxtShapes = (shapes: readonly TxtShape[]): TxtShape[] => shapes.map((shape) => ({
  ...shape,
  colorRanges: shape.colorRanges?.map((range) => ({ ...range })),
  regionPath: shape.regionPath?.map((point) => ({ ...point })),
  selections: shape.selections.map((selection) => ({ ...selection })),
}));

const cloneLayerForReplay = (layer: Layer): Layer => ({
  ...layer,
  imageData: cloneImageData(layer.imageData),
  alignment: cloneLayerAlignment(layer.alignment),
  adjustmentData: cloneAdjustmentLayerData(layer.adjustmentData),
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
        gradientDefStore: layer.colorCycleData.gradientDefStore
          ? layer.colorCycleData.gradientDefStore.map((entry) => ({
              ...entry,
              stops: entry.stops.map((stop) => ({ ...stop })),
              sourceStops: entry.sourceStops?.map((stop) => ({ ...stop })),
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

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id ?? null;
    const ownedState = {
      layers: state.layers,
      layerGroups: state.layerGroups,
      hiddenLayerGroupIds: state.hiddenLayerGroupIds,
      activeLayerId: state.activeLayerId,
      selectedLayerIds: state.selectedLayerIds,
      referenceLayerId: state.referenceLayerId,
      colorPickerPreferReferenceLayer: state.colorPickerPreferReferenceLayer,
      layersNeedRecomposition: state.layersNeedRecomposition,
      compositeSegments: state.compositeSegments,
      pendingCompositeDirtyBatches: state.pendingCompositeDirtyBatches,
      tools: state.tools,
    };
    const projectSnapshot = state.project;
    const isCurrentProject = (): boolean =>
      (useAppStore.getState().project?.id ?? null) === projectId;
    const requiresCompensation = (): boolean => {
      if (!isCurrentProject()) return false;
      const current = useAppStore.getState();
      return (
        Object.entries(ownedState).some(([key, value]) => (
          !Object.is(current[key as keyof typeof ownedState], value)
        )) ||
        !Object.is(current.project?.layers, projectSnapshot?.layers) ||
        !Object.is(current.project?.layerGroups, projectSnapshot?.layerGroups) ||
        !Object.is(current.project?.txtShapes, projectSnapshot?.txtShapes) ||
        current.project?.referenceLayerId !== projectSnapshot?.referenceLayerId ||
        !Object.is(
          current.project?.referenceSamplingSource,
          projectSnapshot?.referenceSamplingSource,
        ) ||
        !Object.is(current.project?.updatedAt, projectSnapshot?.updatedAt)
      );
    };

    return prepareHistoryDelta(
      this._tag,
      () => this.applyReplay(direction),
      requiresCompensation,
      () => {
        if (!isCurrentProject()) return;
        const previousActiveLayer = useAppStore.getState().layers.find(
          (layer) => layer.id === useAppStore.getState().activeLayerId,
        ) ?? null;
        const restoreSnapshot = () => useAppStore.setState((current) => ({
          ...ownedState,
          project: current.project && projectSnapshot
            ? restoreOwnedProperties(current.project, projectSnapshot, [
                'layers',
                'layerGroups',
                'txtShapes',
                'referenceLayerId',
                'referenceSamplingSource',
                'updatedAt',
              ])
            : current.project,
        }));
        restoreSnapshot();
        useAppStore.getState().setActiveLayer(ownedState.activeLayerId, {
          previousActiveLayer,
          forceLifecycle: true,
          preserveSelection: true,
        });
        // Runtime/tool lifecycle is imperative; restore the captured store objects exactly
        // after those effects have been issued.
        restoreSnapshot();
      },
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  applyReplay(direction: HistoryDirection): void {
    const target = direction === 'forward' ? this.afterSnapshot : this.beforeSnapshot;
    const targetSnapshot = target.snapshot;
    const restoredLayers = cloneLayersForReplay(targetSnapshot.layers ?? []);
    const validLayerIds = new Set(restoredLayers.map((layer) => layer.id));
    const store = useAppStore.getState();
    const previousActiveLayer = store.layers.find(
      (layer) => layer.id === store.activeLayerId,
    ) ?? null;

    useAppStore.setState({ layerGroups: cloneLayerGroups(target.layerGroups) });
    store.setLayers(restoredLayers);
    const restoredLayerState = useAppStore.getState().layers;
    const resolvedActiveLayerId =
      targetSnapshot.activeLayerId && validLayerIds.has(targetSnapshot.activeLayerId)
        ? targetSnapshot.activeLayerId
        : restoredLayerState[0]?.id ?? null;
    useAppStore.getState().setActiveLayer(resolvedActiveLayerId, {
      previousActiveLayer,
      forceLifecycle: true,
    });

    const restoredSelection = target.selectedLayerIds.filter((layerId) => validLayerIds.has(layerId));
    store.setSelectedLayerIds(restoredSelection);

    const restoredReferenceId =
      target.referenceLayerId && validLayerIds.has(target.referenceLayerId)
        ? target.referenceLayerId
        : null;
    store.setReferenceLayer(restoredReferenceId);
    store.setReferenceSamplingSource(
      target.referenceSamplingSource
        ?? (restoredReferenceId
          ? { kind: 'layer', layerId: restoredReferenceId }
          : { kind: 'canvas' }),
    );

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
          ...(target.txtShapes ? { txtShapes: cloneTxtShapes(target.txtShapes) } : {}),
          updatedAt: new Date(),
        },
      };
    });

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
