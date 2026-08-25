import {
  applyRuntimeToBrush,
  flushGradientApply,
  requestGradientApply,
} from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { fillColorCycleConcentric, fillColorCycleLinear } from '@/hooks/brushEngine/colorCycleFillController';
import { initializeColorCycleBrushForActiveLayer } from '@/hooks/brushEngine/colorCycleInitController';
import { renderBrushToLayerCanvas } from '@/hooks/brushEngine/colorCycleSurface';
import {
  DEFAULT_CC_BAND_SPACING,
  clampColorCycleBandSpacing,
} from '@/hooks/brushEngine/engineShared';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { captureLayerStructureSnapshot, commitLayerStructureHistory } from '@/stores/helpers/layerStructureHistory';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import {
  getInsertionIndexAboveActiveLayer,
  insertLayerAtIndex,
  normalizeLayerOrder,
} from '@/stores/layers/layerCrudService';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { BrushSettings, Layer } from '@/types';
import { resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { composeLayerOwnedProjectObjectsIntoLayerSource } from '@/utils/layerOwnedProjectObjects';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolveLayerImageData } from '@/stores/helpers/selectionCapture';
import { runAutoConvertRegionsJob } from '@/workers/colorCycleFillClient';

export type ColorCycleAutoConvertOptions = {
  targetShapes: number;
  detail: number;
};

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

const createTransparentClearMask = (source: ImageData): Uint8Array | null => {
  const mask = new Uint8Array(source.width * source.height);
  let hasTransparentPixels = false;
  for (let index = 0; index < mask.length; index += 1) {
    if (source.data[index * 4 + 3] <= 8) {
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

export const autoConvertActiveImageToColorCycle = async ({
  targetShapes,
  detail,
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
    targetShapes: Math.max(2, Math.min(100, Math.round(targetShapes))),
    detail: Math.max(0, Math.min(100, Math.round(detail))),
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
    for (let index = 0; index < segmentation.regions.length; index += 1) {
      const region = segmentation.regions[index];
      const sampledSourceStops = resolveMarkSessionRuntimeStops(
        regionGradientSession,
        region.sampledStops,
        {
          enabled: false,
          rangeContrast: settings.ccGradientRangeContrast,
        },
      );
      const runtimeStops = resolveMarkSessionRuntimeStops(
        regionGradientSession,
        region.sampledStops,
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
        sourceStops: region.sampledStops,
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
        ditherPixelSize: settings.fillResolution,
        ditherSampledStops: resolvedSampledSourceStops,
        ditherBaseOffsetOverride: 0,
        paintSlotOverride: regionGradient.slot,
        paintDefIdOverride: regionGradient.def.id,
        shapePhaseSeedMarkId: `${targetLayerId}:auto:${index}`,
        linearGradientSpan: region.linearGradientSpan,
        skipPostRender: index < segmentation.regions.length - 1,
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
    }

    const transparentMask = createTransparentClearMask(sourceImage);
    if (transparentMask) {
      const currentState = getAppStoreState();
      const currentTarget = currentState.layers.find((layer) => layer.id === targetLayerId);
      if (currentTarget) {
        clearColorCycleRegion(
          currentState,
          currentTarget,
          project,
          { x: 0, y: 0, width: project.width, height: project.height },
          {
            alphaData: transparentMask,
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
        shapeCount: segmentation.regions.length,
      },
    });
    return { layerId: targetLayerId, shapeCount: segmentation.regions.length };
  } catch (error) {
    rollbackTargetLayer({
      layerId: targetLayerId,
      fallbackActiveLayerId: previousActiveLayerId,
      fallbackSelectedLayerIds: previousSelectedLayerIds,
    });
    throw error;
  }
};
