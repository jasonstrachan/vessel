import {
  AUTO_CONVERT_MAX_COVERAGE,
  AUTO_CONVERT_MAX_FOCUS,
  AUTO_CONVERT_MAX_RESOLUTION,
  AUTO_CONVERT_MAX_SAMPLED_GRADIENTS,
  AUTO_CONVERT_MAX_SHAPES,
  AUTO_CONVERT_MIN_COVERAGE,
  AUTO_CONVERT_MIN_FOCUS,
  AUTO_CONVERT_MIN_RESOLUTION,
  AUTO_CONVERT_MIN_SHAPES,
} from '@/constants/colorCycleAutoConvert';
import {
  applyRuntimeToBrush,
  flushGradientApply,
  requestGradientApply,
} from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { applyColorCycleBrushSettingsPatch } from '@/hooks/brushEngine/colorCycleBrushSettingsPatch';
import { fillColorCycleConcentric, fillColorCycleLinear } from '@/hooks/brushEngine/colorCycleFillController';
import { initializeColorCycleBrushForActiveLayer } from '@/hooks/brushEngine/colorCycleInitController';
import { renderBrushToLayerCanvas } from '@/hooks/brushEngine/colorCycleSurface';
import {
  DEFAULT_CC_BAND_SPACING,
  clampColorCycleBandSpacing,
} from '@/hooks/brushEngine/engineShared';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import { captureLayerStructureSnapshot, commitLayerStructureHistory } from '@/stores/helpers/layerStructureHistory';
import {
  getInsertionIndexAboveActiveLayer,
  insertLayerAtIndex,
  normalizeLayerOrder,
} from '@/stores/layers/layerCrudService';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { BrushSettings, Layer } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';
import type { AutoConvertRegion } from '@/utils/colorCycle/autoConvertRegions';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { composeLayerOwnedProjectObjectsIntoLayerSource } from '@/utils/layerOwnedProjectObjects';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolveLayerImageData } from '@/stores/helpers/selectionCapture';
import { runAutoConvertRegionsJob } from '@/workers/colorCycleFillClient';

export type ColorCycleAutoConvertOptions = {
  targetShapes: number;
  focus: number;
  coverage?: number;
  resolutionRange: [number, number];
  onProgress?: (progress: ColorCycleAutoConvertProgress) => void;
};

export type ColorCycleAutoConvertProgress =
  | { phase: 'analyzing' }
  | { phase: 'painting'; completed: number; total: number };

export type ColorCycleAutoConvertResult = {
  layerId: string;
  shapeCount: number;
};

const createLayerId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `layer-${crypto.randomUUID()}`;
  }
  return `layer-${Date.now()}-${Math.random()}`;
};

const createUniqueLayerName = (sourceName: string, layers: Layer[]): string => {
  const baseName = `${sourceName.trim() || 'Layer'} — CC Auto`;
  if (!layers.some((layer) => layer.name === baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (layers.some((layer) => layer.name === `${baseName} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
};

const captureSourceImage = (layer: Layer): ImageData => {
  const state = getAppStoreState();
  const project = state.project;
  if (!project || typeof document === 'undefined') {
    throw new Error('No image document is available to convert');
  }
  const baseImage = resolveLayerImageData(layer);
  if (!baseImage) {
    throw new Error('The selected layer has no image pixels to convert');
  }
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = project.width;
  baseCanvas.height = project.height;
  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseContext) {
    throw new Error('Unable to read the selected image layer');
  }
  baseContext.putImageData(baseImage, 0, 0);
  const composedSource = composeLayerOwnedProjectObjectsIntoLayerSource({
    source: baseCanvas,
    project,
    layerId: layer.id,
    width: project.width,
    height: project.height,
  });
  if (composedSource && composedSource !== baseCanvas) {
    baseContext.clearRect(0, 0, project.width, project.height);
    baseContext.drawImage(composedSource, 0, 0, project.width, project.height);
  }
  return baseContext.getImageData(0, 0, project.width, project.height);
};

const createTransparentPixelMask = (source: ImageData): Uint8Array | null => {
  const mask = new Uint8Array(source.width * source.height);
  let hasTransparentPixels = false;
  for (let index = 0; index < mask.length; index += 1) {
    if (source.data[index * 4 + 3] === 0) {
      mask[index] = 255;
      hasTransparentPixels = true;
    }
  }
  return hasTransparentPixels ? mask : null;
};

const createTargetLayer = ({
  layerId,
  sourceLayer,
  layers,
  brushSettings,
}: {
  layerId: string;
  sourceLayer: Layer;
  layers: Layer[];
  brushSettings: BrushSettings;
}): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 1;
  framebuffer.height = 1;
  return {
    id: layerId,
    name: createUniqueLayerName(sourceLayer.name, layers),
    visible: true,
    opacity: Math.max(0, Math.min(1, brushSettings.opacity ?? 1)),
    blendMode: brushSettings.blendMode ?? 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    groupId: sourceLayer.groupId,
    layerType: 'color-cycle',
    colorCycleData: {
      gradient: brushSettings.colorCycleGradient?.map((stop) => ({ ...stop })),
      isAnimating: true,
      flowMode: 'forward',
      layerBaseSpeedCps: 1,
      runtimeHydrationState: 'warm',
    },
  };
};

const rollbackTargetLayer = ({
  layerId,
  fallbackActiveLayerId,
  fallbackSelectedLayerIds,
}: {
  layerId: string;
  fallbackActiveLayerId: string | null;
  fallbackSelectedLayerIds: string[];
}): void => {
  const manager = getColorCycleBrushManager();
  manager.deleteBrush(layerId);
  const state = getAppStoreState();
  const targetExists = state.layers.some((layer) => layer.id === layerId);
  if (targetExists) {
    state.setLayers(state.layers.filter((layer) => layer.id !== layerId));
  }
  if (state.activeLayerId === layerId) {
    const nextActiveLayerId = fallbackActiveLayerId
      && getAppStoreState().layers.some((layer) => layer.id === fallbackActiveLayerId)
      ? fallbackActiveLayerId
      : getAppStoreState().layers[0]?.id ?? null;
    getAppStoreState().setActiveLayer(nextActiveLayerId);
  }
  if (state.selectedLayerIds.includes(layerId)) {
    const remainingSelectedLayerIds = state.selectedLayerIds.filter((id) => id !== layerId);
    const validFallbackSelection = fallbackSelectedLayerIds.filter((id) =>
      getAppStoreState().layers.some((layer) => layer.id === id),
    );
    getAppStoreState().setSelectedLayerIds(
      remainingSelectedLayerIds.length > 0
        ? remainingSelectedLayerIds
        : validFallbackSelection,
    );
  }
  state.markAllCompositeSegmentsDirty();
};

const hasSameLayerStack = (layers: Layer[], expectedLayers: Layer[]): boolean =>
  layers.length === expectedLayers.length
  && layers.every((layer, index) => layer.id === expectedLayers[index]?.id);

const clampResolution = (value: number): number => (
  Number.isFinite(value)
    ? Math.max(
      AUTO_CONVERT_MIN_RESOLUTION,
      Math.min(AUTO_CONVERT_MAX_RESOLUTION, Math.round(value)),
    )
    : AUTO_CONVERT_MIN_RESOLUTION
);

const AUTO_CONVERT_RESOLUTION_RANK_EXPONENT = 16;

const resolveRegionDetailScore = (region: AutoConvertRegion): number => (
  Number.isFinite(region.detailScore)
    ? Math.max(0, Math.min(1, region.detailScore))
    : 0
);

const resolveRegionDitherPixelSizes = (
  regions: AutoConvertRegion[],
  resolutionRange: [number, number],
): number[] => {
  if (regions.length === 0) {
    return [];
  }
  const firstResolution = clampResolution(resolutionRange[0]);
  const secondResolution = clampResolution(resolutionRange[1]);
  const minimumResolution = Math.min(firstResolution, secondResolution);
  const maximumResolution = Math.max(firstResolution, secondResolution);
  const resolutionSpan = maximumResolution - minimumResolution;
  const detailScores = regions.map(resolveRegionDetailScore);
  const minimum = Math.min(...detailScores);
  const maximum = Math.max(...detailScores);
  const range = maximum - minimum;
  if (range <= Number.EPSILON) {
    return regions.map(() => maximumResolution);
  }
  const rankedScores = [...new Set(detailScores)].sort((left, right) => right - left);
  const rankByScore = new Map(rankedScores.map((score, index) => [
    score,
    rankedScores.length > 1 ? index / (rankedScores.length - 1) : 1,
  ]));
  return detailScores.map((score) => {
    const detailRank = rankByScore.get(score) ?? 1;
    const longTailRank = detailRank ** AUTO_CONVERT_RESOLUTION_RANK_EXPONENT;
    return minimumResolution + Math.round(longTailRank * resolutionSpan);
  });
};

const selectRegionIndexesForCoverage = (
  regions: AutoConvertRegion[],
  requestedCoverage: number,
): number[] => {
  if (regions.length === 0) {
    return [];
  }
  const coverage = Number.isFinite(requestedCoverage)
    ? Math.max(AUTO_CONVERT_MIN_COVERAGE, Math.min(AUTO_CONVERT_MAX_COVERAGE, requestedCoverage))
    : AUTO_CONVERT_MAX_COVERAGE;
  if (coverage <= AUTO_CONVERT_MIN_COVERAGE) {
    return [];
  }
  const totalVisiblePixels = regions.reduce(
    (total, region) => total + Math.max(0, region.pixelCount),
    0,
  );
  if (totalVisiblePixels <= 0) {
    return [];
  }
  const targetVisiblePixels = totalVisiblePixels * coverage / AUTO_CONVERT_MAX_COVERAGE;
  const rankedIndexes = regions
    .map((_region, index) => index)
    .sort((leftIndex, rightIndex) => {
      const detailDifference = resolveRegionDetailScore(regions[rightIndex])
        - resolveRegionDetailScore(regions[leftIndex]);
      if (Math.abs(detailDifference) > Number.EPSILON) {
        return detailDifference;
      }
      const sizeDifference = regions[leftIndex].pixelCount - regions[rightIndex].pixelCount;
      return sizeDifference !== 0 ? sizeDifference : leftIndex - rightIndex;
    });
  if (coverage >= AUTO_CONVERT_MAX_COVERAGE) {
    return rankedIndexes;
  }
  const selectedIndexes: number[] = [];
  let selectedVisiblePixels = 0;
  for (const index of rankedIndexes) {
    selectedIndexes.push(index);
    selectedVisiblePixels += Math.max(0, regions[index].pixelCount);
    if (selectedVisiblePixels >= targetVisiblePixels) {
      break;
    }
  }
  return selectedIndexes;
};

const describeGradient = (region: AutoConvertRegion): number[] => {
  const stops = [...region.sampledStops].sort((left, right) => left.position - right.position);
  return [0, 0.25, 0.5, 0.75, 1].flatMap((position) => {
    const rightIndex = stops.findIndex((stop) => stop.position >= position);
    const right = stops[rightIndex < 0 ? stops.length - 1 : rightIndex];
    const left = stops[Math.max(0, rightIndex <= 0 ? 0 : rightIndex - 1)];
    if (!left || !right) {
      return [0, 0, 0];
    }
    const span = Math.max(Number.EPSILON, right.position - left.position);
    const amount = Math.max(0, Math.min(1, (position - left.position) / span));
    const leftColor = parseCssColor(left.color);
    const rightColor = parseCssColor(right.color);
    return [
      leftColor.r + (rightColor.r - leftColor.r) * amount,
      leftColor.g + (rightColor.g - leftColor.g) * amount,
      leftColor.b + (rightColor.b - leftColor.b) * amount,
    ];
  });
};

const clusterRegionGradientStops = (
  regions: AutoConvertRegion[],
): AutoConvertRegion['sampledStops'][] => {
  if (regions.length <= AUTO_CONVERT_MAX_SAMPLED_GRADIENTS) {
    return regions.map((region) => region.sampledStops);
  }
  const descriptors = regions.map(describeGradient);
  const distance = (left: number[], right: number[]): number => left.reduce(
    (total, value, index) => total + (value - right[index]) ** 2,
    0,
  );
  let largestRegionIndex = 0;
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].pixelCount > regions[largestRegionIndex].pixelCount) {
      largestRegionIndex = index;
    }
  }
  const representativeIndexes = [largestRegionIndex];
  const minimumDistances = descriptors.map((descriptor) => (
    distance(descriptor, descriptors[largestRegionIndex])
  ));
  minimumDistances[largestRegionIndex] = 0;
  while (representativeIndexes.length < AUTO_CONVERT_MAX_SAMPLED_GRADIENTS) {
    let nextIndex = -1;
    let nextScore = 0;
    for (let index = 0; index < regions.length; index += 1) {
      const score = minimumDistances[index] * Math.sqrt(Math.max(1, regions[index].pixelCount));
      if (score > nextScore) {
        nextScore = score;
        nextIndex = index;
      }
    }
    if (nextIndex < 0) {
      break;
    }
    representativeIndexes.push(nextIndex);
    minimumDistances[nextIndex] = 0;
    for (let index = 0; index < descriptors.length; index += 1) {
      minimumDistances[index] = Math.min(
        minimumDistances[index],
        distance(descriptors[index], descriptors[nextIndex]),
      );
    }
  }
  return descriptors.map((descriptor) => {
    let nearestIndex = representativeIndexes[0];
    let nearestDistance = distance(descriptor, descriptors[nearestIndex]);
    for (let index = 1; index < representativeIndexes.length; index += 1) {
      const candidateIndex = representativeIndexes[index];
      const candidateDistance = distance(descriptor, descriptors[candidateIndex]);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearestIndex = candidateIndex;
      }
    }
    return regions[nearestIndex].sampledStops;
  });
};

export const autoConvertActiveImageToColorCycle = async ({
  targetShapes,
  focus,
  coverage = AUTO_CONVERT_MAX_COVERAGE,
  resolutionRange,
  onProgress,
}: ColorCycleAutoConvertOptions): Promise<ColorCycleAutoConvertResult> => {
  const stateBefore = getAppStoreState();
  const project = stateBefore.project;
  const sourceLayer = stateBefore.layers.find((layer) => layer.id === stateBefore.activeLayerId) ?? null;
  if (!project || !sourceLayer || sourceLayer.layerType !== 'normal') {
    throw new Error('Select an image layer to auto convert');
  }
  const fillMode = stateBefore.tools.brushSettings.colorCycleFillMode ?? 'linear';
  if (fillMode === 'stroke') {
    throw new Error('Choose Grad or Concentric before auto converting');
  }
  onProgress?.({ phase: 'analyzing' });
  const sourceImage = captureSourceImage(sourceLayer);
  const sourceVersion = sourceLayer.version;
  const settings: BrushSettings = {
    ...stateBefore.tools.brushSettings,
    colorCycleGradient: stateBefore.tools.brushSettings.colorCycleGradient?.map((stop) => ({ ...stop })),
  };
  const sourcePixels = sourceImage.data.slice();
  const segmentation = await runAutoConvertRegionsJob({
    type: 'auto-convert-regions',
    width: sourceImage.width,
    height: sourceImage.height,
    targetShapes: Math.max(
      AUTO_CONVERT_MIN_SHAPES,
      Math.min(AUTO_CONVERT_MAX_SHAPES, Math.round(targetShapes)),
    ),
    focus: Math.max(
      AUTO_CONVERT_MIN_FOCUS,
      Math.min(AUTO_CONVERT_MAX_FOCUS, Math.round(focus)),
    ),
    maxColors: Math.max(
      2,
      Math.min(16, Math.round(stateBefore.tools.brushSettings.gradientBands ?? 5)),
    ),
    pixels: sourcePixels.buffer as ArrayBuffer,
  });
  if (segmentation.regions.length === 0) {
    throw new Error('The selected layer has no visible image areas to convert');
  }

  const transactionState = getAppStoreState();
  const transactionProject = transactionState.project;
  const currentSourceLayer = transactionState.layers.find((layer) => layer.id === sourceLayer.id);
  if (
    !transactionProject
    || transactionProject.id !== project.id
    || transactionProject.width !== project.width
    || transactionProject.height !== project.height
    || transactionState.activeLayerId !== sourceLayer.id
    || !currentSourceLayer
    || currentSourceLayer.layerType !== 'normal'
    || currentSourceLayer.version !== sourceVersion
  ) {
    throw new Error('The selected image layer changed during conversion');
  }

  const beforeSnapshot = captureLayerStructureSnapshot(transactionState, {
    actionType: 'layer-add',
    description: 'Auto Convert to Color Cycle',
    activeLayerId: sourceLayer.id,
  });
  const previousLayers = transactionState.layers;
  const previousActiveLayerId = transactionState.activeLayerId;
  const previousSelectedLayerIds = [...transactionState.selectedLayerIds];
  const targetLayerId = createLayerId();
  const targetLayer = createTargetLayer({
    layerId: targetLayerId,
    sourceLayer: currentSourceLayer,
    layers: previousLayers,
    brushSettings: settings,
  });
  let expectedLayers: Layer[] = [];

  try {
    const insertionIndex = getInsertionIndexAboveActiveLayer(previousLayers, sourceLayer.id);
    expectedLayers = normalizeLayerOrder(
      insertLayerAtIndex(previousLayers, targetLayer, insertionIndex),
    );
    getAppStoreState().setLayers(expectedLayers);
    getAppStoreState().initColorCycleForLayer(targetLayerId, project.width, project.height);

    const manager = getColorCycleBrushManager();
    const initializedBrush = initializeColorCycleBrushForActiveLayer({
      activeLayerId: targetLayerId,
      projectWidth: project.width,
      projectHeight: project.height,
      brushSettings: settings,
      playbackSpeedScale: stateBefore.colorCyclePlayback.playbackSpeedScale,
      isCCGradientActiveLayer: true,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      resolveBrushPressureRange,
      getLayers: () => getAppStoreState().layers,
      initColorCycleForLayer: (layerId, width, height) =>
        getAppStoreState().initColorCycleForLayer(layerId, width, height),
      getActiveLayerColorCycleBrush: () => manager.getInitBrush(targetLayerId),
      requestGradientApply,
    });
    if (!initializedBrush) {
      throw new Error('Unable to initialize the new Color Cycle layer');
    }
    const fillBrush = manager.getFillBrush(targetLayerId);
    if (!fillBrush) {
      throw new Error('Unable to initialize the new Color Cycle fill brush');
    }
    applyColorCycleBrushSettingsPatch(fillBrush, { pxlEdgeEnabled: false });
    const gradientApplyBrush = manager.getGradientApplyBrush(targetLayerId);
    if (!gradientApplyBrush) {
      throw new Error('Unable to initialize the new Color Cycle gradient brush');
    }
    requestGradientApply(targetLayerId, 'auto-convert');
    flushGradientApply(targetLayerId);

    const gradientKind = fillMode === 'concentric' || fillMode === 'circular'
      ? 'concentric'
      : 'linear';
    const regionGradientSession = {
      ditherRenderConfig: undefined,
      source: 'sampled' as const,
      sampledRepresentativeColor: undefined,
      isRuntimePalette: false,
    };
    const ditherMode = resolveCcDitherBandMode(settings.gradientBands ?? 16);
    const allRegionDitherPixelSizes = resolveRegionDitherPixelSizes(
      segmentation.regions,
      resolutionRange,
    );
    const selectedRegionIndexes = selectRegionIndexesForCoverage(
      segmentation.regions,
      coverage,
    );
    const selectedRegions = selectedRegionIndexes.map((index) => segmentation.regions[index]);
    const regionDitherPixelSizes = selectedRegionIndexes.map(
      (index) => allRegionDitherPixelSizes[index],
    );
    const regionGradientStops = clusterRegionGradientStops(selectedRegions);
    onProgress?.({
      phase: 'painting',
      completed: 0,
      total: selectedRegions.length,
    });
    const sharedFillArgs = {
      initializeColorCycleBrush: () => fillBrush,
      activeLayerId: targetLayerId,
      isCCGradientActiveLayer: true,
      brushSettings: settings,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      requestGradientApply,
      flushGradientApply,
      renderBrushToLayerCanvas,
    };
    for (let index = 0; index < selectedRegions.length; index += 1) {
      const region = selectedRegions[index];
      const clusteredStops = regionGradientStops[index];
      const sampledSourceStops = resolveMarkSessionRuntimeStops(
        regionGradientSession,
        clusteredStops,
        {
          enabled: false,
          rangeContrast: settings.ccGradientRangeContrast,
        },
      );
      const runtimeStops = resolveMarkSessionRuntimeStops(
        regionGradientSession,
        clusteredStops,
        {
          enabled: Boolean(settings.ditherEnabled),
          pairBandCount: ditherMode.pairBandCount,
          spread: settings.ditherPaletteSpread,
          rangeContrast: settings.ccGradientRangeContrast,
          algorithm: settings.ditherAlgorithm,
          useDitherRenderPalette: settings.ccFlatCycleDither !== true,
          fillBackground:
            (settings.ditherGradBgFill ?? settings.ditherBackgroundFill) !== false,
        },
      );
      const regionGradient = ensureGradientDefForStops({
        layerId: targetLayerId,
        kind: gradientKind,
        stops: runtimeStops,
        sourceStops: clusteredStops,
        source: 'sampled',
        seamProfile: settings.colorCycleGradientSeamProfile,
        sampledCapacityFallback: 'reuse-nearest-compatible',
        updateOptions: { skipColorCycleSync: true },
      });
      if (!regionGradient) {
        throw new Error('Unable to preserve the sampled colors for a converted shape');
      }
      const resolvedRegionStops = regionGradient.def.stops.map((stop) => ({ ...stop }));
      const resolvedSampledSourceStops = regionGradient.reusedForCapacity
        ? resolvedRegionStops
        : sampledSourceStops;
      const currentTargetLayer = getAppStoreState().layers.find(
        (layer) => layer.id === targetLayerId,
      );
      applyRuntimeToBrush(gradientApplyBrush, targetLayerId, {
        layerId: targetLayerId,
        paintSlot: regionGradient.slot,
        slotPalettes: [{
          slot: regionGradient.slot,
          stops: resolvedRegionStops,
          seamProfile: regionGradient.def.seamProfile,
        }],
        flowMode: currentTargetLayer?.colorCycleData?.flowMode,
      });
      const options = {
        ditherPixelSize: regionDitherPixelSizes[index],
        ditherSampledStops: resolvedSampledSourceStops,
        ditherBaseOffsetOverride: 0,
        paintSlotOverride: regionGradient.slot,
        paintDefIdOverride: regionGradient.def.id,
        shapePhaseSeedMarkId: `${targetLayerId}:auto:${selectedRegionIndexes[index]}`,
        linearGradientSpan: region.linearGradientSpan,
        skipPostRender: index < selectedRegions.length - 1,
      };
      if (fillMode === 'concentric' || fillMode === 'circular') {
        await fillColorCycleConcentric({
          ...sharedFillArgs,
          vertices: region.points,
          options,
        });
      } else {
        await fillColorCycleLinear({
          ...sharedFillArgs,
          vertices: region.points,
          direction: region.direction,
          options,
        });
      }
      const completed = index + 1;
      const previousPercent = Math.floor((index * 100) / selectedRegions.length);
      const completedPercent = Math.floor((completed * 100) / selectedRegions.length);
      if (completed === selectedRegions.length || completedPercent > previousPercent) {
        onProgress?.({
          phase: 'painting',
          completed,
          total: selectedRegions.length,
        });
      }
    }

    if (selectedRegions.length > 0) {
      const transparentPixelMask = createTransparentPixelMask(sourceImage);
      const currentState = getAppStoreState();
      const currentTargetLayer = currentState.layers.find((layer) => layer.id === targetLayerId);
      if (transparentPixelMask && currentTargetLayer) {
        clearColorCycleRegion(
          currentState,
          currentTargetLayer,
          project,
          { x: 0, y: 0, width: project.width, height: project.height },
          {
            alphaData: transparentPixelMask,
            alphaWidth: project.width,
            alphaHeight: project.height,
            alphaStride: 1,
            alphaChannelOffset: 0,
            auditSource: 'auto-convert-transparent-source',
          },
        );
      }
    }

    const completedState = getAppStoreState();
    const completedSourceLayer = completedState.layers.find((layer) => layer.id === sourceLayer.id);
    if (
      !hasSameLayerStack(completedState.layers, expectedLayers)
      || completedSourceLayer?.version !== sourceVersion
    ) {
      throw new Error('The layer stack changed during conversion');
    }
    completedState.setActiveLayer(targetLayerId);
    completedState.setSelectedLayerIds([targetLayerId]);
    completedState.markAllCompositeSegmentsDirty();
    const afterState = getAppStoreState();
    const afterSnapshot = captureLayerStructureSnapshot(afterState, {
      actionType: 'layer-add',
      description: 'Auto Convert to Color Cycle',
      activeLayerId: targetLayerId,
      previousSnapshot: beforeSnapshot,
    });
    commitLayerStructureHistory({
      set: useAppStore.setState,
      beforeSnapshot,
      afterSnapshot,
      label: 'Auto Convert to Color Cycle',
      metadata: {
        sourceLayerId: sourceLayer.id,
        targetLayerId,
        shapeCount: selectedRegions.length,
      },
    });
    return { layerId: targetLayerId, shapeCount: selectedRegions.length };
  } catch (error) {
    rollbackTargetLayer({
      layerId: targetLayerId,
      fallbackActiveLayerId: previousActiveLayerId,
      fallbackSelectedLayerIds: previousSelectedLayerIds,
    });
    throw error;
  }
};
