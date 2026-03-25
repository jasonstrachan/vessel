import type { Layer, Rectangle } from '@/types';

type AppState = import('../useAppStore').AppState;

export type EligibleTargetSummary = {
  hasValidLayer: boolean;
  count: number;
  label: string;
};

export type ColorAdjustSessionTargets = {
  eligibleLayerIds: string[];
  firstLayerId: string | null;
  firstLayerType: Layer['layerType'] | null;
  firstOriginalImageData: ImageData | null;
  firstOriginalGradient: Array<{ position: number; color: string }> | null;
  firstSelectionBounds: Rectangle | null;
  hasColorCycleTarget: boolean;
  distinctLayerTypes: Set<Layer['layerType']>;
  originalImageDataByLayerId: Map<string, ImageData>;
  originalColorCycleDataByLayerId: Map<string, Layer['colorCycleData']>;
  originalColorCycleSnapshotByLayerId: Map<string, unknown>;
};

export const DEFAULT_ELIGIBLE_TARGET_SUMMARY: EligibleTargetSummary = {
  hasValidLayer: false,
  count: 0,
  label: 'Layer',
};

export const resolveColorAdjustTargetLayerIds = (
  activeLayerId: string | null,
  selectedLayerIds: string[]
): string[] => {
  if (!activeLayerId) {
    return [];
  }

  if (selectedLayerIds.length > 1 && selectedLayerIds.includes(activeLayerId)) {
    return selectedLayerIds;
  }

  return [activeLayerId];
};

export const isEligibleColorAdjustLayer = (layer: Layer | null | undefined): layer is Layer => {
  if (!layer) {
    return false;
  }

  if (layer.layerType === 'normal') {
    return Boolean(layer.imageData);
  }

  if (layer.layerType === 'color-cycle') {
    return Boolean(
      (layer.colorCycleData?.recolorSettings?.gradient?.length ?? 0) > 0 ||
      (layer.colorCycleData?.gradient?.length ?? 0) > 0 ||
      (layer.colorCycleData?.slotPalettes?.some((entry) => entry.stops.length > 0) ?? false) ||
      (layer.colorCycleData?.gradientDefStore?.some((entry) => entry.stops.length > 0) ?? false)
    );
  }

  return false;
};

export const summarizeEligibleColorAdjustTargets = (
  activeLayerId: string | null,
  selectedLayerIds: string[],
  layers: Layer[]
): EligibleTargetSummary => {
  const targetLayerIds = resolveColorAdjustTargetLayerIds(activeLayerId, selectedLayerIds);
  if (targetLayerIds.length === 0) {
    return DEFAULT_ELIGIBLE_TARGET_SUMMARY;
  }

  const eligibleLayers = targetLayerIds
    .map((layerId) => layers.find((layer) => layer.id === layerId))
    .filter(isEligibleColorAdjustLayer);

  if (eligibleLayers.length === 0) {
    return DEFAULT_ELIGIBLE_TARGET_SUMMARY;
  }

  if (eligibleLayers.length === 1) {
    return {
      hasValidLayer: true,
      count: 1,
      label: eligibleLayers[0]?.name ?? 'Layer',
    };
  }

  return {
    hasValidLayer: true,
    count: eligibleLayers.length,
    label: `${eligibleLayers.length} Layers`,
  };
};

export const buildColorAdjustSessionTargets = <ColorCycleSnapshot>({
  state,
  cloneColorCycleData,
  resolveColorCycleGradient,
  snapshotLayerImageData,
  resolveSelectionBounds,
  captureColorCycleRuntimeSnapshot,
}: {
  state: AppState;
  cloneColorCycleData: (data: Layer['colorCycleData'] | undefined) => Layer['colorCycleData'] | null;
  resolveColorCycleGradient: (layer: Layer) => Array<{ position: number; color: string }> | null;
  snapshotLayerImageData: (layer: Layer | undefined) => ImageData | null;
  resolveSelectionBounds: (
    state: AppState,
    width: number,
    height: number
  ) => Rectangle | null;
  captureColorCycleRuntimeSnapshot: (state: AppState, layer: Layer) => ColorCycleSnapshot | null;
}): ColorAdjustSessionTargets => {
  const targetLayerIds = resolveColorAdjustTargetLayerIds(state.activeLayerId, state.selectedLayerIds);
  const targetLayers = targetLayerIds
    .map((layerId) => state.layers.find((layer) => layer.id === layerId))
    .filter((layer): layer is Layer => Boolean(layer));

  const eligibleLayerIds: string[] = [];
  const originalImageDataByLayerId = new Map<string, ImageData>();
  const originalColorCycleDataByLayerId = new Map<string, Layer['colorCycleData']>();
  const originalColorCycleSnapshotByLayerId = new Map<string, unknown>();
  const distinctLayerTypes = new Set<Layer['layerType']>();
  let firstLayerId: string | null = null;
  let firstLayerType: Layer['layerType'] | null = null;
  let firstOriginalImageData: ImageData | null = null;
  let firstOriginalGradient: Array<{ position: number; color: string }> | null = null;
  let firstSelectionBounds: Rectangle | null = null;
  let hasColorCycleTarget = false;

  for (const layer of targetLayers) {
    if (layer.layerType === 'color-cycle') {
      const originalGradient = resolveColorCycleGradient(layer);
      if (!originalGradient || originalGradient.length === 0) {
        continue;
      }

      const originalColorCycleData = cloneColorCycleData(layer.colorCycleData);
      if (!originalColorCycleData) {
        continue;
      }

      eligibleLayerIds.push(layer.id);
      distinctLayerTypes.add(layer.layerType);
      originalColorCycleDataByLayerId.set(layer.id, originalColorCycleData);
      const runtimeSnapshot = captureColorCycleRuntimeSnapshot(state, layer);
      if (runtimeSnapshot) {
        originalColorCycleSnapshotByLayerId.set(layer.id, runtimeSnapshot);
      }
      hasColorCycleTarget = true;

      if (!firstLayerId) {
        firstLayerId = layer.id;
        firstLayerType = layer.layerType;
        firstOriginalGradient = originalGradient;
        firstSelectionBounds = null;
      }
      continue;
    }

    if (layer.layerType !== 'normal') {
      continue;
    }

    const originalImageData = snapshotLayerImageData(layer);
    if (!originalImageData) {
      continue;
    }

    eligibleLayerIds.push(layer.id);
    distinctLayerTypes.add(layer.layerType);
    originalImageDataByLayerId.set(layer.id, originalImageData);

    if (!firstLayerId) {
      firstLayerId = layer.id;
      firstLayerType = layer.layerType;
      firstOriginalImageData = originalImageData;
      firstSelectionBounds = resolveSelectionBounds(
        state,
        originalImageData.width,
        originalImageData.height
      );
    }
  }

  return {
    eligibleLayerIds,
    firstLayerId,
    firstLayerType,
    firstOriginalImageData,
    firstOriginalGradient,
    firstSelectionBounds,
    hasColorCycleTarget,
    distinctLayerTypes,
    originalImageDataByLayerId,
    originalColorCycleDataByLayerId,
    originalColorCycleSnapshotByLayerId,
  };
};
