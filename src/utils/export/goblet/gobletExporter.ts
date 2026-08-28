import { debugLog, debugWarn, logError } from '@/utils/debug';
import { cloneExportLayout } from '@/utils/layoutDefaults';
import { computeLayerContentMetrics } from '@/utils/layerMetrics';
import type { LayerContentMetrics } from '@/utils/layerMetrics';
import { resolveContainerLayout as resolveContainerLayoutModel } from '@/utils/layerAlignment';
import type { LayoutLayerInput, ResolvedLayerLayout } from '@/utils/layerAlignment';
import { deriveAutoPercentOffset, derivePercentBounds } from '@/utils/alignment/alignFitResolver';
import { normalizeAlign, type RawAlignInput } from '@/utils/alignment/normalizeAlign';
import { round3, toNum } from '@/utils/num';
import type {
  Layer,
  LayerAlignmentSettings,
  Project,
  WebGLExportBundleFormat,
} from '@/types';
import type {
  AlignmentExportPayload,
  GobletAutomationTrack,
  WebGLExportMetadata,
  WebGLExportRequest,
  WebGLLayerMetadata,
  WebGLViewport,
  WebGLViewportMode,
} from '@/utils/export/goblet/gobletTypes';
import { isInterlaceGroup, sanitizeInterlaceSettings } from '@/lib/interlace/interlaceSettings';
import {
  GOBLET_PROPERTY_MINIFY_MAP,
  type GobletPropertyMinifyKey,
} from '@/utils/export/goblet/gobletMetadataSchema';
import { buildGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadBuilder';
import {
  formatGobletColorCycleDiagnostics,
  getUserVisibleGobletColorCycleDiagnostics,
} from '@/utils/export/goblet/colorCyclePayloadDiagnostics';
import { validateGobletColorCycleMetadataContract } from '@/utils/export/goblet/colorCyclePayloadValidation';
import {
  hasGobletColorCycleLiveBrush,
  resolveGobletColorCycleDocument,
} from '@/utils/export/goblet/colorCycleLiveBrushResolver';
import { downloadBlob } from '@/utils/export/goblet/downloadBlob';
import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import {
  fetchGobletAsset,
  type GobletAssetName,
  type GobletAssetRoot,
} from '@/utils/export/goblet/gobletRuntimeAssets';
import {
  applyHtmlBackgroundColorToTemplate,
  applyHtmlTitleToTemplate,
  createSingleFileGobletHtmlArtifact,
  createSingleFileGobletHtmlArtifactFromBundledRuntime,
  DEFAULT_HTML_BACKGROUND_COLOR,
  DEFAULT_HTML_TITLE,
  GOBLET2_FORMAT,
  GOBLET2_SCHEMA_VERSION,
  sanitizeHtmlBackgroundColor,
  sanitizeHtmlTitle,
} from '@/utils/export/goblet/gobletHtmlBuilder';
import {
  canvasToDataURL,
  captureLayerTextureInfo,
  createExportPreviewCanvas,
  normalizeCanvasSurfaceForExport,
  normalizeImageDataUrl,
  synthesizeBrushTextureFromIndices,
} from '@/utils/export/goblet/gobletTextureEncoder';
import {
  buildSequentialExportPlayback,
  captureSequentialLayerFrameTextures,
  deriveSequentialContentBounds,
} from '@/utils/export/goblet/gobletSequentialSerializer';
import {
  createLayerMetadata,
  getLayerSurfaceSize,
  resolveDocumentBoundsPx,
  stripLayerDefaults,
} from '@/utils/export/goblet/gobletLayerSerializer';
import {
  applyExportPlaybackScale,
  clampBoundsToSurface,
  clampExportLayerSpeedScale,
  deduplicateGradients,
  extractBrushStateFromSavedSnapshot,
  resolveDefBoundSlotPalettes,
  resolveDimensionFromCandidates,
  resolveRecolorSurfaceSize,
  resolveExportLayerSpeedScale,
  sanitizePositiveDimension,
  scaleEncodedSpeedBuffer,
  serializeBrushState,
  serializeColorCycleDataFromResolvedLayer,
  setGobletColorCycleDiagnosticsActive,
  summarizeEncodedBuffer,
} from '@/utils/export/goblet/gobletColorCycleSerializer';
import { createGobletZipBlob } from '@/utils/export/goblet/gobletZipBuilder';
import {
  createGobletSingleHtmlSizeReport,
  createGobletSizeReport,
  createGobletZipPayloadPlan,
  updateGobletSizeReportPayloadTotals,
  type GobletBinaryPayloadEntry,
} from '@/utils/export/goblet/gobletSizeReport';
import {
  createTxtShapeLayerRasterCache,
  getProjectTxtShapePlaybackSettings,
  getTxtShapesForLayer,
  normalizeTxtShapes,
} from '@/utils/txtShape';
import {
  createUiShapeLayerRasterCache,
  getUiShapesForLayer,
  normalizeUiShapes,
} from '@/utils/uiShape';
import {
  ensureTxtShapeFontsReadyForRaster,
  inlineTxtShapeFontsInGobletTemplate,
} from '@/utils/export/goblet/gobletTxtShapeFonts';
import { ccLog, ccWarn, ccSample } from '@/utils/colorCycle/ccDebug';
import { cloneDisplayFilters } from '@/lib/displayFilters';
import { clampRectToDocument as clampBoundsToDocument } from '@/utils/export/colorCycleBounds';
import studioExtension from '@/extensions/studioExtension';

export type {
  WebGLExportMetadata,
  WebGLExportRequest,
  WebGLLayerBounds,
  WebGLLayerMetadata,
} from '@/utils/export/goblet/gobletTypes';

const gobletDiagnosticsDefault = process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true';

let gobletDiagnosticsActive = gobletDiagnosticsDefault;

type GobletBrushAlphaModeOptions = {
  hasVisibleTextureAlpha: boolean;
  syntheticTextureApplied: boolean;
};

export const resolveGobletBrushAlphaMode = ({
  hasVisibleTextureAlpha,
  syntheticTextureApplied,
}: GobletBrushAlphaModeOptions): 'source' | 'opaque-indices' => {
  if (syntheticTextureApplied) {
    return 'opaque-indices';
  }
  return hasVisibleTextureAlpha ? 'source' : 'opaque-indices';
};

const gobletDebugLog = (...args: Array<unknown>) => {
  if (gobletDiagnosticsActive) {
    debugLog('raw-console', ...args);
  }
};

const gobletDebugWarn = (...args: Array<unknown>) => {
  if (gobletDiagnosticsActive) {
    debugWarn('raw-console', ...args);
  }
};

const toProgressError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error ?? 'Unknown error') };
};

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Export cancelled', 'AbortError');
  }
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  return error;
};

const throwIfExportAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

type LayerExportMetrics = LayerContentMetrics;

const computeLayerExportMetrics = (layer: Layer, project: Project): LayerExportMetrics =>
  computeLayerContentMetrics(layer, project);

// Boundary: exporter flow only. Empty/hidden layer skipping lives here; CC source
// eligibility, serialization, and payload validation live in Goblet CC modules.
const shouldSkipEmptyColorCycleLayerForGobletExport = (
  layer: Layer,
  textureInfo: Awaited<ReturnType<typeof captureLayerTextureInfo>> | undefined,
): boolean => {
  const data = layer.colorCycleData;
  return Boolean(
    layer.layerType === 'color-cycle' &&
    data &&
    !data.recolorSettings &&
    data.hasContent !== true &&
    data.runtimeHydrationState !== 'cold' &&
    data.deferredRuntimeRestore !== true &&
    data.repairStatus?.ok !== false &&
    !data.brushState &&
    !data.colorCycleBrush &&
    !resolveGobletColorCycleDocument(layer) &&
    !hasGobletColorCycleLiveBrush(layer) &&
    !textureInfo?.hasVisibleAlpha
  );
};

const minifyProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => minifyProperties(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const mappedKey = GOBLET_PROPERTY_MINIFY_MAP[key as GobletPropertyMinifyKey] ?? key;
    result[mappedKey] = minifyProperties(nested);
  }
  return result;
};

const normalizeDynamicFeatureIds = (features: readonly string[]): string[] => (
  [...new Set(features.map((feature) => feature.trim()).filter(Boolean))].sort()
);

const GOBLET_AUTOMATION_TRACK_PROPERTIES = new Set<GobletAutomationTrack['property']>([
  'x', 'y', 'opacity', 'visible', 'rotation', 'scaleX', 'scaleY', 'pressed', 'sourceX', 'sourceY',
  'playbackTime',
]);

const isGobletAutomationTrackProperty = (
  value: unknown,
): value is GobletAutomationTrack['property'] => (
  typeof value === 'string'
  && GOBLET_AUTOMATION_TRACK_PROPERTIES.has(value as GobletAutomationTrack['property'])
);

const assertRendererV1AutomationReferencesComplete = (metadata: WebGLExportMetadata): void => {
  const automation = metadata.automation;
  if (!automation) return;
  const targets = new Map<string, { kind: string }>();
  const addTarget = (id: string, kind: string): void => {
    if (!id || targets.has(id)) {
      throw new Error(`Renderer v1 has an invalid or duplicate target ID: ${id}.`);
    }
    targets.set(id, { kind });
  };
  automation.objects.forEach((object) => addTarget(object.id, object.kind));
  (automation.masks ?? []).forEach((mask) => addTarget(mask.id, 'mask'));

  const referencedMasks = new Set<string>();
  automation.objects.forEach((object) => {
    if (!object.maskId) return;
    if (targets.get(object.maskId)?.kind !== 'mask') {
      throw new Error(`Renderer v1 object ${object.id} references missing mask ${object.maskId}.`);
    }
    referencedMasks.add(object.maskId);
  });
  (automation.symbols ?? []).forEach((symbol) => {
    symbol.objects.forEach((object) => {
      if (!object.maskId) return;
      if (targets.get(object.maskId)?.kind !== 'mask') {
        throw new Error(`Renderer v1 symbol ${symbol.id} references missing mask ${object.maskId}.`);
      }
      referencedMasks.add(object.maskId);
    });
  });
  const unusedMasks = (automation.masks ?? [])
    .map((mask) => mask.id)
    .filter((id) => !referencedMasks.has(id));
  if (unusedMasks.length > 0) {
    throw new Error(`Renderer v1 has unused masks: ${unusedMasks.join(', ')}.`);
  }

  const dataChannelIds = new Set<string>();
  for (const channel of automation.dataChannels ?? []) {
    if (
      !channel.id
      || dataChannelIds.has(channel.id)
      || channel.values.length === 0
      || !channel.values.every(Number.isFinite)
      || !Number.isFinite(channel.intervalSeconds)
      || channel.intervalSeconds <= 0
    ) {
      throw new Error(`Renderer v1 has an invalid or duplicate data channel: ${channel.id}.`);
    }
    dataChannelIds.add(channel.id);
  }

  const usedDataChannelIds = new Set<string>();
  const trackKeys = new Set<string>();
  let playbackTimeTracks = 0;
  for (const track of automation.tracks) {
    const target = targets.get(track.targetId);
    if (!target) {
      throw new Error(`Renderer v1 track references missing target ${track.targetId}.`);
    }
    const property: string = track.property;
    const trackKey = `${track.targetId}:${property}`;
    if (trackKeys.has(trackKey)) {
      throw new Error(`Renderer v1 has a duplicate track: ${trackKey}.`);
    }
    trackKeys.add(trackKey);
    const hasKeyframes = Array.isArray(track.keyframes) && track.keyframes.length > 0;
    const dataChannelId = track.dataChannelId;
    const hasDataChannel = typeof dataChannelId === 'string' && dataChannelId.length > 0;
    if (hasKeyframes === hasDataChannel || (hasDataChannel && !dataChannelIds.has(dataChannelId))) {
      throw new Error(`Renderer v1 track ${trackKey} requires exactly one valid data source.`);
    }
    if (hasDataChannel) usedDataChannelIds.add(dataChannelId);
    if (hasDataChannel && (property === 'visible' || property === 'pressed')) {
      throw new Error(`Renderer v1 track ${trackKey} cannot use numeric data.`);
    }
    if (property === 'playbackTime') {
      playbackTimeTracks += 1;
      if (target.kind !== 'artwork') {
        throw new Error(`Renderer v1 playbackTime track ${trackKey} must target artwork.`);
      }
    }
    if (
      (property === 'sourceX' || property === 'sourceY')
      && target.kind !== 'sprite'
      && target.kind !== 'mask'
    ) {
      throw new Error(`Renderer v1 source track ${trackKey} must target a sprite or mask.`);
    }
    if (target.kind === 'mask' && (property === 'visible' || property === 'pressed')) {
      throw new Error(`Renderer v1 mask track ${trackKey} uses an unsupported property.`);
    }
  }
  if (playbackTimeTracks > 1) {
    throw new Error('Renderer v1 supports only one playbackTime track.');
  }
  const unusedDataChannels = [...dataChannelIds].filter((id) => !usedDataChannelIds.has(id));
  if (unusedDataChannels.length > 0) {
    throw new Error(`Renderer v1 has unused data channels: ${unusedDataChannels.join(', ')}.`);
  }
};

const getNativeGobletDynamicFeatures = (metadata: WebGLExportMetadata): string[] => {
  const features: string[] = [];
  if (metadata.layers.some((layer) => Boolean(layer.colorCycle) && layer.colorCycle?.isAnimating !== false)) {
    features.push('goblet:color-cycle-v1');
  }
  if (metadata.layers.some((layer) => (
    (layer.sequential?.totalFrames ?? layer.assets?.textureFrames?.length ?? 0) > 1
  ))) {
    features.push('goblet:sequential-v1');
  }
  if ((metadata.interlaceGroups?.length ?? 0) > 0) {
    features.push('goblet:interlace-v1');
  }
  return features;
};

export const assertDynamicFeatureManifestComplete = (metadata: WebGLExportMetadata): void => {
  const manifest = metadata.dynamicFeatures;
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error('Goblet export requires a dynamic feature manifest.');
  }
  const authored = normalizeDynamicFeatureIds(manifest.authored);
  const compiled = normalizeDynamicFeatureIds(manifest.compiled);
  const missing = authored.filter((feature) => !compiled.includes(feature));
  const undeclared = compiled.filter((feature) => !authored.includes(feature));
  if (missing.length > 0 || undeclared.length > 0) {
    throw new Error([
      missing.length > 0 ? `Dynamic features were not compiled: ${missing.join(', ')}.` : '',
      undeclared.length > 0 ? `Compiled features were not declared: ${undeclared.join(', ')}.` : '',
    ].filter(Boolean).join(' '));
  }
  assertRendererV1AutomationReferencesComplete(metadata);
  const requirements = manifest.requirements ?? [];
  if (!Array.isArray(requirements)) {
    throw new Error('Dynamic feature requirements must be an array.');
  }
  const requirementFeatures = new Set<string>();
  const normalizedRequirements = requirements.map((requirement) => {
    const featureId = typeof requirement?.featureId === 'string'
      ? requirement.featureId.trim()
      : '';
    const requiredObjects = Array.isArray(requirement?.objects) ? requirement.objects : [];
    const seenObjectIds = new Set<string>();
    const objects = requiredObjects.map((object) => {
      const objectId = typeof object?.objectId === 'string' ? object.objectId.trim() : '';
      const trackProperties = Array.isArray(object?.trackProperties)
        && object.trackProperties.every(isGobletAutomationTrackProperty)
        ? [...new Set(object.trackProperties.filter(isGobletAutomationTrackProperty))].sort()
        : null;
      if (!objectId || seenObjectIds.has(objectId) || trackProperties === null) {
        throw new Error(`Dynamic feature ${featureId} has invalid object requirements.`);
      }
      seenObjectIds.add(objectId);
      return { objectId, trackProperties };
    }).sort((left, right) => left.objectId.localeCompare(right.objectId));
    if (!featureId || requirementFeatures.has(featureId) || objects.length === 0) {
      throw new Error('Dynamic feature requirements need unique feature IDs and object IDs.');
    }
    if (!authored.includes(featureId) || !compiled.includes(featureId)) {
      throw new Error(`Dynamic feature requirement is not declared and compiled: ${featureId}.`);
    }
    requirementFeatures.add(featureId);
    return { featureId, objects };
  }).sort((left, right) => left.featureId.localeCompare(right.featureId));
  const missingRequirements = authored.filter((feature) => (
    feature.startsWith('studio:') && !requirementFeatures.has(feature)
  ));
  if (missingRequirements.length > 0) {
    throw new Error(`Dynamic features have no object requirements: ${missingRequirements.join(', ')}.`);
  }
  const actualObjectIds = new Set([
    ...(metadata.automation?.objects.map((object) => object.id) ?? []),
    ...(metadata.automation?.masks?.map((mask) => mask.id) ?? []),
  ]);
  const missingObjects = normalizedRequirements.flatMap(({ featureId, objects }) => (
    objects.filter(({ objectId }) => !actualObjectIds.has(objectId)).map(({ objectId }) => (
      `${featureId}:${objectId}`
    ))
  ));
  if (missingObjects.length > 0) {
    throw new Error(`Dynamic feature objects were not compiled: ${missingObjects.join(', ')}.`);
  }
  const trackPropertiesByTarget = new Map<string, Set<string>>();
  (metadata.automation?.tracks ?? []).forEach((track) => {
    const properties = trackPropertiesByTarget.get(track.targetId) ?? new Set<string>();
    properties.add(track.property);
    trackPropertiesByTarget.set(track.targetId, properties);
  });
  normalizedRequirements.forEach(({ featureId, objects }) => {
    objects.forEach(({ objectId, trackProperties }) => {
      const actualProperties = trackPropertiesByTarget.get(objectId) ?? new Set<string>();
      const missingProperties = trackProperties.filter((property) => !actualProperties.has(property));
      if (missingProperties.length > 0) {
        throw new Error(
          `Dynamic feature object ${featureId}:${objectId} is missing tracks: ${missingProperties.join(', ')}.`,
        );
      }
    });
  });
  metadata.dynamicFeatures = {
    schemaVersion: 1,
    authored,
    compiled,
    ...(normalizedRequirements.length > 0 ? { requirements: normalizedRequirements } : {}),
  };
};






export const buildProjectGobletArtifact = async (
  options: WebGLExportRequest
): Promise<GobletArtifact> => {
  if (typeof window === 'undefined') {
    throw new Error('WebGL export is only available in the browser');
  }

  const diagnosticsEnabled = options.enableGobletDiagnostics ?? gobletDiagnosticsDefault;
  const previousDiagnostics = gobletDiagnosticsActive;
  gobletDiagnosticsActive = diagnosticsEnabled;
  setGobletColorCycleDiagnosticsActive(diagnosticsEnabled);
  const emitProgress = options.onProgress;
  let currentProgressLayer: { id: string; name: string; staticPreviewReason?: string } | null = null;
  const progressLayerTotal = Math.max(
    1,
    options.layers.filter((layer) => options.includeHiddenLayers || layer.visible).length
  );
  let progressLayerIndex = 0;
  throwIfExportAborted(options.signal);
  emitProgress?.({
    phase: 'preparing',
    percent: 1,
    message: 'Preparing Goblet export...',
  });

  try {
    const resolvedHtmlTitle = sanitizeHtmlTitle(options.htmlTitle ?? DEFAULT_HTML_TITLE);
    const resolvedHtmlBackgroundColor = sanitizeHtmlBackgroundColor(options.htmlBackgroundColor ?? DEFAULT_HTML_BACKGROUND_COLOR);
    const gobletVersion = options.gobletVersion === 'goblet1' ? 'goblet1' : 'goblet2';
    const gobletFormat: WebGLExportMetadata['format'] = gobletVersion === 'goblet2'
      ? GOBLET2_FORMAT
      : 'vessel-goblet';
    const gobletAssetRoot: GobletAssetRoot = gobletVersion === 'goblet2' ? 'goblet2' : 'goblet';
    const gobletRuntimeAsset: GobletAssetName = gobletVersion === 'goblet2' ? 'goblet2.js' : 'goblet.js';
    const gobletInlineAsset: GobletAssetName = gobletVersion === 'goblet2' ? 'goblet2-inline.js' : 'goblet-inline.js';
    const gobletRuntimeModulePath = gobletVersion === 'goblet2' ? './goblet2.js' : './goblet.js';
    if (
      gobletVersion === 'goblet1'
      && options.layers.some((layer) => layer.layerType === 'adjustment')
    ) {
      throw new Error('Adjustment layers require Goblet 2 export.');
    }

  const normalizedTextShapes = normalizeTxtShapes(
    options.project.txtShapes,
    options.project.width,
    options.project.height,
    options.layers,
  );
  const txtShapePlayback = getProjectTxtShapePlaybackSettings(options.project);
  const rasterTextShapes = studioExtension.transformGobletRasterTextShapes?.(
    normalizedTextShapes,
    { txtShapePlayback },
  ) ?? normalizedTextShapes;
  const normalizedUiShapes = normalizeUiShapes(
    options.project.uiShapes,
    options.project.width,
    options.project.height,
    options.layers,
  );
  await ensureTxtShapeFontsReadyForRaster(normalizedTextShapes);
  throwIfExportAborted(options.signal);
  const metricsMap = new Map<string, LayerExportMetrics>();
  options.layers.forEach((layer) => {
    try {
      metricsMap.set(
        layer.id,
        getTxtShapesForLayer(normalizedTextShapes, layer.id).length > 0
          || getUiShapesForLayer(normalizedUiShapes, layer.id).length > 0
          ? {
              surfaceSize: { width: options.project.width, height: options.project.height },
              contentBounds: {
                x: 0,
                y: 0,
                width: options.project.width,
                height: options.project.height,
              },
            }
          : computeLayerExportMetrics(layer, options.project),
      );
    } catch (error) {
      debugWarn('raw-console', '[webglExporter] Failed to compute export metrics for layer', layer.id, error);
      const fallbackSurface = getLayerSurfaceSize(layer, options.project);
      metricsMap.set(layer.id, {
        surfaceSize: fallbackSurface,
        contentBounds: {
          x: 0,
          y: 0,
          width: Math.max(1, fallbackSurface.width),
          height: Math.max(1, fallbackSurface.height)
        }
      });
    }
  });

  const containerLayout = cloneExportLayout(options.layout);

  const resolveViewportMode = (mode: unknown): WebGLViewportMode => {
    if (mode === 'fill') {
      return 'fill';
    }
    if (mode === 'fit') {
      return 'fit';
    }
    if (mode === 'cover') {
      return 'cover';
    }
    return 'fixed';
  };

  const resolvedViewport: WebGLViewport = {
    mode: resolveViewportMode(options.viewport?.mode),
    designWidth: sanitizePositiveDimension(
      options.viewport?.designWidth ?? options.viewport?.width ?? options.project.width,
      options.project.width
    ),
    designHeight: sanitizePositiveDimension(
      options.viewport?.designHeight ?? options.viewport?.height ?? options.project.height,
      options.project.height
    )
  };
  const pixelPerfectStack = options.pixelPerfectStack === true;
  const useIdentityPixelPerfectStack = pixelPerfectStack
    && resolvedViewport.designWidth === Math.max(1, options.project.width)
    && resolvedViewport.designHeight === Math.max(1, options.project.height);

  const metadataLayers: WebGLLayerMetadata[] = [];
  const layoutInputs: LayoutLayerInput[] = [];
  const documentSize = {
    width: options.project.width,
    height: options.project.height
  };
  const speedWarning = { warned: false };
  const exportLayerSpeedScale = resolveExportLayerSpeedScale(
    options.colorCyclePlaybackSpeedScale ?? options.colorCycleLayerSpeedScale
  );

  for (let index = 0; index < options.layers.length; index += 1) {
    throwIfExportAborted(options.signal);
    const layer = options.layers[index];
    if (!options.includeHiddenLayers && !layer.visible) {
      emitProgress?.({
        phase: 'layers',
        percent: Math.min(80, 5 + Math.round((progressLayerIndex / progressLayerTotal) * 70)),
        message: `Skipping hidden layer ${layer.name || layer.id}`,
        layer: {
          id: layer.id,
          name: layer.name || layer.id,
          status: 'skipped-hidden',
          message: 'Hidden layer excluded',
        },
      });
      continue;
    }
    let staticPreviewReason: string | undefined = layer.colorCycleData?.repairStatus?.reason;
    currentProgressLayer = { id: layer.id, name: layer.name || layer.id, staticPreviewReason };
    const layerPercent = Math.min(80, 5 + Math.round((progressLayerIndex / progressLayerTotal) * 70));
    let isStaticPreviewLayer = layer.colorCycleData?.repairStatus?.ok === false;
    emitProgress?.({
      phase: 'layers',
      percent: layerPercent,
      message: `Exporting ${layer.name || layer.id}`,
      layer: {
        id: layer.id,
        name: layer.name || layer.id,
        status: 'exporting',
      },
    });
    if (isStaticPreviewLayer) {
      emitProgress?.({
        phase: 'layers',
        percent: layerPercent,
        message: `${layer.name || layer.id} is static preview only`,
        layer: {
          id: layer.id,
          name: layer.name || layer.id,
          status: 'static-preview',
          message: layer.colorCycleData?.repairStatus?.reason ?? 'Missing canonical color-cycle paint',
        },
      });
    }

    const metrics = metricsMap.get(layer.id) ?? computeLayerExportMetrics(layer, options.project);
    const originalSurfaceSize = {
      width: Math.max(1, metrics.surfaceSize.width),
      height: Math.max(1, metrics.surfaceSize.height)
    };
    const surfaceSize = { ...originalSurfaceSize };
    let documentBoundsPx = resolveDocumentBoundsPx(layer, metrics, options.project);
    const sequentialContentBounds = deriveSequentialContentBounds(layer, options.project);
    if (sequentialContentBounds) {
      documentBoundsPx = sequentialContentBounds;
    }

    const txtRasterCache = layer.layerType === 'normal'
      ? createTxtShapeLayerRasterCache({
          layer,
          shapes: rasterTextShapes,
          width: options.project.width,
          height: options.project.height,
        })
      : null;
    const uiRasterCache = layer.layerType === 'normal'
      ? createUiShapeLayerRasterCache({
          layer: txtRasterCache
            ? { ...layer, framebuffer: txtRasterCache, imageData: null }
            : layer,
          shapes: normalizedUiShapes,
          width: options.project.width,
          height: options.project.height,
        })
      : null;
    const semanticRasterCache = uiRasterCache ?? txtRasterCache;
    let textureInfo = layer.layerType === 'adjustment'
      ? undefined
      : await captureLayerTextureInfo(
          semanticRasterCache
            ? { ...layer, framebuffer: semanticRasterCache, imageData: null }
            : layer,
          undefined,
          txtRasterCache ? 'txt-shape' : 'default',
        );
    throwIfExportAborted(options.signal);
    let texture = textureInfo?.dataUrl;
    const sequentialFrameCount = Math.max(
      1,
      Math.round(layer.sequentialData?.frameCount ?? options.totalFrames)
    );
    const sequentialFrames = await captureSequentialLayerFrameTextures({
      layer,
      width: Math.max(originalSurfaceSize.width, options.project.width),
      height: Math.max(originalSurfaceSize.height, options.project.height),
      frameCount: sequentialFrameCount,
      // Goblet renders sequential frame textures as full-layer surfaces.
      // Cropping them here makes the exported playback appear inset/clipped.
      cropBounds: undefined,
    });
    throwIfExportAborted(options.signal);
    if (sequentialFrames && sequentialFrames.frames.length > 0) {
      texture = sequentialFrames.frames[0] ?? texture;
      surfaceSize.width = sequentialFrames.sourceSize.width;
      surfaceSize.height = sequentialFrames.sourceSize.height;
    }
    if (shouldSkipEmptyColorCycleLayerForGobletExport(layer, textureInfo)) {
      progressLayerIndex += 1;
      emitProgress?.({
        phase: 'layers',
        percent: Math.min(85, 5 + Math.round((progressLayerIndex / progressLayerTotal) * 70)),
        message: `Skipping empty color-cycle layer ${layer.name || layer.id}`,
        layer: {
          id: layer.id,
          name: layer.name || layer.id,
          status: 'skipped-empty',
          message: 'Empty color-cycle layer has no exportable animated payload',
        },
      });
      continue;
    }
    let colorCycleResult: Awaited<ReturnType<typeof serializeColorCycleDataFromResolvedLayer>> | undefined;
    let colorCycleSource: string | undefined;
    let colorCycleDiagnostics: string[] | undefined;
    let colorCycleStats: {
      payloadPixels?: number;
      nonZeroPaint?: number;
      usedSlots?: number;
      paletteSlots?: number;
    } | undefined;
    if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
      emitProgress?.({
        phase: 'layers',
        percent: layerPercent,
        message: `Building color-cycle payload for ${layer.name || layer.id}`,
        layer: {
          id: layer.id,
          name: layer.name || layer.id,
          status: layer.colorCycleData.runtimeHydrationState === 'cold' ? 'hydrating-cc-archive' : 'building-cc-payload',
        },
      });
      const payloadResult = await buildGobletColorCyclePayload(layer, options.project, {
        forceSpeedBuffer: false,
        layerSpeedScale: exportLayerSpeedScale,
        toolSpeed: options.colorCycleToolSpeed,
        speedWarning,
        serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
      });
      throwIfExportAborted(options.signal);
      colorCycleDiagnostics = getUserVisibleGobletColorCycleDiagnostics(payloadResult.diagnostics);
      const colorCycleFailureDiagnostics = formatGobletColorCycleDiagnostics(payloadResult.diagnostics);
      if (!payloadResult.ok) {
        const canExportVisibleStaticPreview = Boolean(
          payloadResult.reason === 'empty-paint-with-content' &&
          texture &&
          textureInfo?.hasVisibleAlpha
        );
        if (canExportVisibleStaticPreview) {
          staticPreviewReason = payloadResult.reason;
          currentProgressLayer = { id: layer.id, name: layer.name || layer.id, staticPreviewReason };
          isStaticPreviewLayer = true;
          emitProgress?.({
            phase: 'layers',
            percent: layerPercent,
            message: `${layer.name || layer.id} exported as static preview`,
            layer: {
              id: layer.id,
              name: layer.name || layer.id,
              status: 'static-preview',
              message: payloadResult.reason,
              colorCycle: {
                diagnostics: colorCycleFailureDiagnostics,
              },
            },
          });
        } else {
          emitProgress?.({
            phase: 'layers',
            percent: layerPercent,
            message: `${layer.name || layer.id} failed color-cycle payload validation`,
            layer: {
              id: layer.id,
              name: layer.name || layer.id,
              status: 'failed',
              message: payloadResult.reason,
              colorCycle: {
                diagnostics: colorCycleFailureDiagnostics,
              },
            },
          });
          throw new Error(
            `Goblet export blocked: color-cycle layer "${layer.name ?? layer.id}" is missing animated brush data (${payloadResult.reason}).`
          );
        }
      } else {
        colorCycleResult = payloadResult.payload;
        colorCycleSource = payloadResult.source;
        colorCycleStats = payloadResult.stats;
        emitProgress?.({
          phase: 'layers',
          percent: layerPercent,
          message: `Validated color-cycle payload for ${layer.name || layer.id}`,
          layer: {
            id: layer.id,
            name: layer.name || layer.id,
            status: 'packing-cc-payload',
            colorCycle: {
              source: colorCycleSource,
              payloadPixels: colorCycleStats?.payloadPixels,
              nonZeroPaint: colorCycleStats?.nonZeroPaint,
              usedSlots: colorCycleStats?.usedSlots,
              paletteSlots: colorCycleStats?.paletteSlots,
              diagnostics: colorCycleDiagnostics,
            },
          },
        });
      }
    }
    throwIfExportAborted(options.signal);
    const colorCycle = colorCycleResult?.colorCycle;
    const colorCycleRuntime = colorCycleResult?.runtime;
    const brushRuntime = colorCycleRuntime?.brushState;

    if (brushRuntime) {
      surfaceSize.width = Math.max(surfaceSize.width, Math.max(1, brushRuntime.width));
      surfaceSize.height = Math.max(surfaceSize.height, Math.max(1, brushRuntime.height));
    }
    const recolorRuntime = colorCycle?.recolorSettings;
    if (recolorRuntime) {
      const recolorWidth = toNum(recolorRuntime.width, NaN);
      const recolorHeight = toNum(recolorRuntime.height, NaN);
      if (Number.isFinite(recolorWidth) && recolorWidth > 0) {
        surfaceSize.width = Math.max(1, recolorWidth);
      }
      if (Number.isFinite(recolorHeight) && recolorHeight > 0) {
        surfaceSize.height = Math.max(1, recolorHeight);
      }
    }

    if (texture && brushRuntime && colorCycleRuntime?.sourceCropPx) {
      const croppedTextureInfo = await captureLayerTextureInfo(layer, {
        bounds: colorCycleRuntime.sourceCropPx,
        basis: colorCycleRuntime.sourceCropBasis,
      });
      throwIfExportAborted(options.signal);
      if (croppedTextureInfo) {
        textureInfo = croppedTextureInfo;
        texture = croppedTextureInfo.dataUrl;
        surfaceSize.width = Math.max(1, brushRuntime.width);
        surfaceSize.height = Math.max(1, brushRuntime.height);
      } else {
        textureInfo = undefined;
        texture = undefined;
      }
    }

    const needsSyntheticTexture = Boolean(
      brushRuntime && (!texture || originalSurfaceSize.width <= 1 || originalSurfaceSize.height <= 1)
    );

    let syntheticTextureApplied = false;
    if (needsSyntheticTexture && brushRuntime) {
      const syntheticTexture = await synthesizeBrushTextureFromIndices(brushRuntime);
      throwIfExportAborted(options.signal);
      if (syntheticTexture) {
        texture = syntheticTexture;
        textureInfo = { dataUrl: syntheticTexture, hasVisibleAlpha: true };
        syntheticTextureApplied = true;
        surfaceSize.width = Math.max(surfaceSize.width, Math.max(1, brushRuntime.width));
        surfaceSize.height = Math.max(surfaceSize.height, Math.max(1, brushRuntime.height));
      }
    }

    if (colorCycle?.mode === 'brush' && colorCycle.brushState) {
      // Synthetic textures are generated from authoritative indices; source
      // texture alpha can be a sparse preview surface and punch holes in strokes.
      colorCycle.brushState.alphaMode = resolveGobletBrushAlphaMode({
        hasVisibleTextureAlpha: Boolean(texture && textureInfo?.hasVisibleAlpha),
        syntheticTextureApplied,
      });
    }

    if (colorCycle?.coverageBoundsPx) {
      documentBoundsPx = clampBoundsToDocument(colorCycle.coverageBoundsPx, documentSize);
    }

    const documentBoundsPercent = derivePercentBounds(documentBoundsPx, documentSize);

    const autoOffsetPercent = deriveAutoPercentOffset(documentBoundsPx, documentSize);
    const normalizedAlignment = normalizeAlign(
      layer.alignment as RawAlignInput,
      autoOffsetPercent
    );

    const positioning: LayerAlignmentSettings['positioning'] =
      normalizedAlignment.positioning === 'auto' ? 'auto' : 'anchor';

    const offsetPercent: LayerAlignmentSettings['offsetPercent'] | undefined =
      positioning === 'anchor'
        ? undefined
        : { x: autoOffsetPercent.x, y: autoOffsetPercent.y };

    const alignmentPayload: AlignmentExportPayload = useIdentityPixelPerfectStack
      ? {
          fit: 'none',
          horizontal: 'left',
          vertical: 'top',
          positioning: 'auto',
          offsetPercent: { x: 0, y: 0 }
        }
      : {
          fit: normalizedAlignment.fit as AlignmentExportPayload['fit'],
          horizontal: normalizedAlignment.horizontal ?? 'center',
          vertical: normalizedAlignment.vertical ?? 'center',
          positioning,
          ...(offsetPercent ? { offsetPercent } : {})
        };

    const layoutAlignment: LayerAlignmentSettings = {
      fit: alignmentPayload.fit,
      horizontal: alignmentPayload.horizontal,
      vertical: alignmentPayload.vertical,
      positioning,
      ...(offsetPercent ? { offsetPercent } : {}),
      offsetPx: undefined
    };

    if (layer.layerType !== 'adjustment') {
      layoutInputs.push({
        layerId: layer.id,
        surface: {
          width: Math.max(1, surfaceSize.width),
          height: Math.max(1, surfaceSize.height)
        },
        document: {
          width: Math.max(1, options.project.width),
          height: Math.max(1, options.project.height)
        },
        content: {
          width: Math.max(1, documentBoundsPx.width),
          height: Math.max(1, documentBoundsPx.height)
        },
        alignment: layoutAlignment,
        hidden: !options.includeHiddenLayers && !layer.visible
      });
    }

    const brushPayload = colorCycle?.brushState?.indexBuffer as ArrayLike<number> | string | undefined;
    const brushEnc = Array.isArray(brushPayload) ? 'array' : (typeof brushPayload === 'string' ? 'b64z' : 'none');
    const brushLen = Array.isArray(brushPayload) ? brushPayload.length : (typeof brushPayload === 'string' ? brushPayload.length : 0);
    ccLog('EXPORT layer', {
      id: layer.id,
      hasTexture: Boolean(texture),
      ccMode: colorCycle?.mode ?? null,
      hasRecolor: Boolean(colorCycle?.recolorSettings),
      brushEnc,
      brushLen,
      brushWH: colorCycle?.brushState ? { w: colorCycle.brushState.width, h: colorCycle.brushState.height } : null,
      preview: Array.isArray(brushPayload) ? ccSample(brushPayload, 12) : undefined
    });
    if (!colorCycle?.recolorSettings && !colorCycle?.brushState) {
      ccWarn('NO CC PAYLOAD FOR LAYER', layer.id);
    }

    const sequentialSurfaceBounds = sequentialFrames
      ? {
          x: 0,
          y: 0,
          width: Math.max(1, sequentialFrames.sourceSize.width),
          height: Math.max(1, sequentialFrames.sourceSize.height)
        }
      : null;

    const surfaceBounds = colorCycle?.coverageBoundsSourcePx
      ? clampBoundsToSurface(colorCycle.coverageBoundsSourcePx, surfaceSize)
      : (sequentialSurfaceBounds ?? metrics.contentBounds);

    if (syntheticTextureApplied) {
      surfaceSize.width = Math.max(1, round3(surfaceBounds.width));
      surfaceSize.height = Math.max(1, round3(surfaceBounds.height));
    }

    const contentBoundsPayload = {
      x: round3(surfaceBounds.x),
      y: round3(surfaceBounds.y),
      width: round3(Math.max(1, surfaceBounds.width)),
      height: round3(Math.max(1, surfaceBounds.height))
    };

    const stackBoundsPayload = useIdentityPixelPerfectStack
      ? {
          x: 0,
          y: 0,
          width: round3(Math.max(1, surfaceSize.width)),
          height: round3(Math.max(1, surfaceSize.height))
        }
      : contentBoundsPayload;

    const shouldPreserveColorCycleDocumentBounds = Boolean(colorCycle?.coverageBoundsPx);
    const metadataDocumentBoundsPx = useIdentityPixelPerfectStack && !shouldPreserveColorCycleDocumentBounds
      ? {
          x: 0,
          y: 0,
          width: round3(Math.max(1, options.project.width)),
          height: round3(Math.max(1, options.project.height))
        }
      : {
          x: round3(documentBoundsPx.x),
          y: round3(documentBoundsPx.y),
          width: round3(documentBoundsPx.width),
          height: round3(documentBoundsPx.height)
        };

    const metadataDocumentBoundsPercent = useIdentityPixelPerfectStack && !shouldPreserveColorCycleDocumentBounds
      ? {
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      : {
          x: round3(documentBoundsPercent.x),
          y: round3(documentBoundsPercent.y),
          width: round3(documentBoundsPercent.width),
          height: round3(documentBoundsPercent.height)
        };

    const baseLayerMetadata = createLayerMetadata({
      layer,
      index,
      surfaceSize,
      stackBoundsPayload,
      documentBoundsPx: metadataDocumentBoundsPx,
      documentBoundsPercent: metadataDocumentBoundsPercent,
      alignment: alignmentPayload,
      texture,
      sequentialFrames,
      colorCycle,
      sequential: layer.layerType === 'sequential'
        ? buildSequentialExportPlayback({
            fps: layer.sequentialData?.fps ?? options.fps,
            frameCount: sequentialFrameCount,
            durationMs: layer.sequentialData?.durationMs,
          })
        : undefined,
    });

    metadataLayers.push(stripLayerDefaults(baseLayerMetadata));
    progressLayerIndex += 1;
    emitProgress?.({
      phase: 'layers',
      percent: Math.min(85, 5 + Math.round((progressLayerIndex / progressLayerTotal) * 70)),
      message: isStaticPreviewLayer
        ? `${layer.name || layer.id} exported as static preview`
        : `${layer.name || layer.id} exported`,
      layer: {
        id: layer.id,
        name: layer.name || layer.id,
        status: isStaticPreviewLayer ? 'static-preview' : 'exported',
        message: isStaticPreviewLayer
          ? (staticPreviewReason ?? 'Missing canonical color-cycle paint')
          : undefined,
        colorCycle: colorCycleSource
          ? {
              source: colorCycleSource,
              payloadPixels: colorCycleStats?.payloadPixels,
              nonZeroPaint: colorCycleStats?.nonZeroPaint,
              usedSlots: colorCycleStats?.usedSlots,
              paletteSlots: colorCycleStats?.paletteSlots,
              diagnostics: colorCycleDiagnostics,
            }
          : undefined,
      },
    });
  }
  currentProgressLayer = null;

  let placementByLayerId: Map<string, ResolvedLayerLayout> | null = null;
  if (useIdentityPixelPerfectStack) {
    const stackScaleX = resolvedViewport.designWidth / Math.max(1, options.project.width);
    const stackScaleY = resolvedViewport.designHeight / Math.max(1, options.project.height);
    placementByLayerId = new Map<string, ResolvedLayerLayout>();
    metadataLayers.forEach((layer) => {
      placementByLayerId!.set(layer.id, {
        layerId: layer.id,
        frame: {
          x: 0,
          y: 0,
          width: resolvedViewport.designWidth,
          height: resolvedViewport.designHeight
        },
        transform: {
          scaleX: stackScaleX,
          scaleY: stackScaleY,
          translateX: 0,
          translateY: 0
        }
      });
    });
  } else {
    try {
      const resolvedPlacements = resolveContainerLayoutModel(layoutInputs, containerLayout, {
        width: resolvedViewport.designWidth,
        height: resolvedViewport.designHeight
      });
      placementByLayerId = new Map<string, ResolvedLayerLayout>();
      resolvedPlacements.forEach((placement) => {
        placementByLayerId!.set(placement.layerId, placement);
      });
    } catch (error) {
      gobletDebugWarn('[webglExporter] Failed to resolve container layout', error);
    }
  }

  if (placementByLayerId) {
    metadataLayers.forEach((layer) => {
      const placement = placementByLayerId?.get(layer.id);
      if (!placement) {
        layer.layoutPlacement = undefined;
        return;
      }

      layer.layoutPlacement = {
        frame: {
          x: round3(placement.frame.x),
          y: round3(placement.frame.y),
          width: round3(placement.frame.width),
          height: round3(placement.frame.height)
        },
        transform: {
          scaleX: round3(placement.transform.scaleX),
          scaleY: round3(placement.transform.scaleY),
          translateX: round3(placement.transform.translateX),
          translateY: round3(placement.transform.translateY),
          rotation: typeof placement.transform.rotation === 'number'
            ? round3(placement.transform.rotation)
            : undefined
        }
      };
    });
  }

  let preview: WebGLExportMetadata['preview'];
  let fallback: WebGLExportMetadata['fallback'];
  if (
    typeof document !== 'undefined' &&
    (options.compositeLayersToCanvasSync || options.compositeLayersToCanvas)
  ) {
    try {
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = Math.max(1, options.project.width);
      compositeCanvas.height = Math.max(1, options.project.height);
      if (options.compositeLayersToCanvasSync) {
        options.compositeLayersToCanvasSync(compositeCanvas);
      } else {
        options.compositeLayersToCanvas?.(compositeCanvas);
      }

      const previewCanvas = createExportPreviewCanvas(compositeCanvas);
      const { dataUrl: previewDataUrl, format: previewFormat } = await canvasToDataURL(previewCanvas);
      const normalizedPreview = normalizeImageDataUrl(previewDataUrl);
      if (!normalizedPreview) {
        logError(`[webglExporter] Invalid data URL generated for ${previewFormat} preview`);
      } else {
        preview = {
          type: previewFormat,
          width: previewCanvas.width,
          height: previewCanvas.height,
          dataUrl: normalizedPreview
        };
      }

      if (options.embedCanvasFallback) {
        const { dataUrl, format } = await canvasToDataURL(compositeCanvas);
        const normalized = normalizeImageDataUrl(dataUrl);
        if (!normalized) {
          logError(`[webglExporter] Invalid data URL generated for ${format} fallback`);
        } else {
          fallback = {
            type: format,
            dataUrl: normalized
          };
        }
      }
    } catch (error) {
      debugWarn('raw-console', '[webglExporter] Failed to capture Goblet preview or fallback', error);
    }
  }

  const bundleFormat: WebGLExportBundleFormat = options.bundleFormat ?? 'zip-compat';
  const transparencyBackgroundMode =
    options.transparencyBackgroundMode
    ?? 'checker';
  const displayFilters = cloneDisplayFilters(
    options.displayFilters ?? options.project.viewState?.displayFilters ?? []
  );

  let metadata: WebGLExportMetadata = {
    format: gobletFormat,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: options.project.id,
      name: options.project.name,
      width: options.project.width,
      height: options.project.height,
      backgroundColor: options.project.backgroundColor
    },
    ...(gobletVersion === 'goblet2'
      ? {
          colorCycle: {
            schemaVersion: GOBLET2_SCHEMA_VERSION
          }
        }
      : {}),
    viewport: resolvedViewport,
    container: containerLayout,
    animation: {
      fps: options.fps,
      totalFrames: options.totalFrames,
      durationSeconds: options.durationSeconds,
      perfectLoop: options.perfectLoop
    },
    settings: {
      includeHiddenLayers: options.includeHiddenLayers,
      embedCanvasFallback: options.embedCanvasFallback,
      minifyOutput: options.minify,
      pixelPerfectStack,
      perfectLoop: options.perfectLoop,
      bundleFormat,
      displayFilters,
      viewportPreset: options.viewportPreset,
      htmlTitle: resolvedHtmlTitle,
      htmlBackgroundColor: resolvedHtmlBackgroundColor,
      transparencyBackgroundMode,
    },
    textShapes: normalizedTextShapes.filter((shape) => (
      metadataLayers.some((layer) => layer.id === shape.layerId)
    )),
    txtShapePlayback,
    uiShapes: normalizedUiShapes.filter((shape) => (
      metadataLayers.some((layer) => layer.id === shape.layerId)
    )),
    layers: metadataLayers,
    interlaceGroups: (options.project.layerGroups ?? [])
      .filter(isInterlaceGroup)
      .map((group) => {
        const settings = sanitizeInterlaceSettings(group.interlace);
        return {
          id: group.id,
          layerIds: metadataLayers
            .filter((layer) => layer.visible !== false && options.layers.find(
              (sourceLayer) => sourceLayer.id === layer.id,
            )?.groupId === group.id)
            .map((layer) => layer.id),
          settings: {
            ...settings,
            loopDurationSeconds: settings.loopDurationSeconds / exportLayerSpeedScale,
          },
        };
      })
      .filter((group) => group.layerIds.length >= 2),
    adjustmentGroups: (options.project.layerGroups ?? [])
      .filter((group) => !isInterlaceGroup(group))
      .map((group) => ({
        id: group.id,
        layerIds: metadataLayers
          .filter((layer) => layer.visible !== false && options.layers.find(
            (sourceLayer) => sourceLayer.id === layer.id,
          )?.groupId === group.id)
          .map((layer) => layer.id),
      }))
      .filter((group) => group.layerIds.some((layerId) => (
        metadataLayers.find((layer) => layer.id === layerId)?.type === 'adjustment'
      ))),
  };

  if (preview) {
    metadata.preview = preview;
  }

  if (fallback) {
    metadata.fallback = fallback;
  }

  const nativeDynamicFeatures = getNativeGobletDynamicFeatures(metadata);
  const extensionDynamicFeatures = studioExtension.getGobletAuthoredDynamicFeatures?.(metadata) ?? [];
  metadata.dynamicFeatures = {
    schemaVersion: 1,
    authored: normalizeDynamicFeatureIds([...nativeDynamicFeatures, ...extensionDynamicFeatures]),
    compiled: normalizeDynamicFeatureIds(nativeDynamicFeatures),
  };
  metadata = studioExtension.transformGobletMetadata?.(metadata) ?? metadata;
  assertDynamicFeatureManifestComplete(metadata);

  if (gobletDiagnosticsActive && placementByLayerId) {
    placementByLayerId.forEach((placement, layerId) => {
      gobletDebugLog('[webglExporter] Layout placement', layerId, placement);
    });
  }

  if (gobletVersion === 'goblet2') {
    const metadataContract = validateGobletColorCycleMetadataContract(metadata);
    if (!metadataContract.ok) {
      throw new Error([
        'Goblet2 color-cycle metadata failed contract validation.',
        ...formatGobletColorCycleDiagnostics(metadataContract.diagnostics),
      ].join(' '));
    }
  }

  deduplicateGradients(metadata);
  throwIfExportAborted(options.signal);
  emitProgress?.({
    phase: 'packaging',
    percent: 88,
    message: 'Packaging Goblet export...',
  });

  if (gobletDiagnosticsActive) {
    metadata.layers.forEach((layer, index) => {
      const brushPayload = layer.colorCycle?.brushState?.indexBuffer;
      const brushStateSummary = summarizeEncodedBuffer(
        Array.isArray(brushPayload) || typeof brushPayload === 'string' ? brushPayload : undefined,
        Array.isArray(brushPayload) ? brushPayload.length : 0
      );
      gobletDebugLog('[webglExporter] Layer export summary', {
        index,
        id: layer.id,
        visible: layer.visible,
        hasColorCycle: Boolean(layer.colorCycle),
        brushStateSummary
      });
    });
  }

  const metadataPayload = options.minify ? minifyProperties(metadata) : metadata;
  const json = JSON.stringify(metadataPayload, null, options.minify ? undefined : 2);
  throwIfExportAborted(options.signal);
  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] JSON size after stringify', {
      bytes: json.length,
      minified: options.minify
    });
  }
  const jsonFilename = `${options.filenameBase}-goblet.json`;

  if (bundleFormat === 'json') {
    throwIfExportAborted(options.signal);
    const blob = new Blob([json], { type: 'application/json' });
    const sizeReport = createGobletSizeReport({
      metadata,
      metadataJson: json,
      format: 'json',
      totalBytes: blob.size,
    });
    options.onSizeReport?.(sizeReport);
    emitProgress?.({
      phase: 'complete',
      percent: 100,
      message: 'Goblet export complete',
    });
    return { blob, filename: jsonFilename, metadata, sizeReport };
  }

  let indexHtml: string;
  try {
    indexHtml = await fetchGobletAsset('index.html', options.assetPrefix, gobletAssetRoot);
    throwIfExportAborted(options.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet template: ${message}`);
  }
  const indexHtmlWithTxtFonts = await inlineTxtShapeFontsInGobletTemplate({
    template: indexHtml,
    shapes: normalizedTextShapes,
    assetPrefix: options.assetPrefix,
    gobletAssetRoot,
    signal: options.signal,
  });
  throwIfExportAborted(options.signal);
  const indexHtmlWithPresentation = applyHtmlBackgroundColorToTemplate(
    applyHtmlTitleToTemplate(indexHtmlWithTxtFonts, resolvedHtmlTitle),
    resolvedHtmlBackgroundColor
  );
  const indexHtmlWithStudioExtension = studioExtension.transformGobletTemplate?.(
    indexHtmlWithPresentation,
    { metadata },
  ) ?? indexHtmlWithPresentation;

  let baseRuntimeAssetsPromise: Promise<[string, string, string, string, string, string]> | null = null;
  let payloadContractAssetPromise: Promise<string | null> | null = null;
  const ensureBaseRuntimeAssets = () => {
    if (!baseRuntimeAssetsPromise) {
      baseRuntimeAssetsPromise = Promise.all([
        fetchGobletAsset(gobletRuntimeAsset, options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('alignFitResolver.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('displayFilterPipeline.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('gobletPlaybackMath.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('num.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('fflate-inflate.js', options.assetPrefix, gobletAssetRoot)
      ]);
    }
    return baseRuntimeAssetsPromise;
  };
  const ensurePayloadContractAsset = (): Promise<string | null> => {
    if (gobletVersion !== 'goblet2') {
      return Promise.resolve(null);
    }
    if (!payloadContractAssetPromise) {
      payloadContractAssetPromise = fetchGobletAsset('gobletPayloadContract.js', options.assetPrefix, gobletAssetRoot);
    }
    return payloadContractAssetPromise;
  };

  const loadBundledRuntime = async (): Promise<string | null> => {
    try {
      return await fetchGobletAsset(gobletInlineAsset, options.assetPrefix, gobletAssetRoot);
    } catch (error) {
      gobletDebugWarn('[webglExporter] Failed to load prebundled Goblet runtime, using legacy inline path', error);
      return null;
    }
  };

  if (bundleFormat === 'single-html') {
    const bundledRuntime = await loadBundledRuntime();
    throwIfExportAborted(options.signal);
    if (bundledRuntime) {
      const singleHtmlArtifact = createSingleFileGobletHtmlArtifactFromBundledRuntime(
        indexHtmlWithStudioExtension,
        bundledRuntime,
        gobletRuntimeModulePath,
        json,
        diagnosticsEnabled
      );
      const htmlBlob = new Blob([singleHtmlArtifact.html], { type: 'text/html' });
      const sizeReport = createGobletSingleHtmlSizeReport({
        metadata,
        metadataJson: json,
        runtimeBytes: singleHtmlArtifact.runtimeBytes,
        htmlBytes: singleHtmlArtifact.htmlBytes,
        totalBytes: htmlBlob.size,
      });
      options.onSizeReport?.(sizeReport);
      emitProgress?.({
        phase: 'complete',
        percent: 100,
        message: 'Goblet export complete',
      });
      return {
        blob: htmlBlob,
        filename: `${options.filenameBase}-goblet.html`,
        metadata,
        sizeReport,
      };
    }

    let gobletJs: string;
    let alignJs: string;
    let displayFilterJs: string;
    let payloadContractJs: string | null;
    let playbackMathJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, displayFilterJs, playbackMathJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
      payloadContractJs = await ensurePayloadContractAsset();
      throwIfExportAborted(options.signal);
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      payloadContractAssetPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const singleHtmlArtifact = createSingleFileGobletHtmlArtifact(
      indexHtmlWithStudioExtension,
      gobletJs,
      gobletRuntimeModulePath,
      alignJs,
      displayFilterJs,
      payloadContractJs,
      playbackMathJs,
      numJs,
      inflateJs,
      json,
      diagnosticsEnabled,
      {
        log: gobletDebugLog,
        warn: gobletDebugWarn,
      }
    );
    const htmlBlob = new Blob([singleHtmlArtifact.html], { type: 'text/html' });
    const sizeReport = createGobletSingleHtmlSizeReport({
      metadata,
      metadataJson: json,
      runtimeBytes: singleHtmlArtifact.runtimeBytes,
      htmlBytes: singleHtmlArtifact.htmlBytes,
      totalBytes: htmlBlob.size,
    });
    options.onSizeReport?.(sizeReport);
    emitProgress?.({
      phase: 'complete',
      percent: 100,
      message: 'Goblet export complete',
    });
    return {
      blob: htmlBlob,
      filename: `${options.filenameBase}-goblet.html`,
      metadata,
      sizeReport,
    };
  }

  if (bundleFormat === 'zip' || bundleFormat === 'zip-compat') {
    let gobletJs: string;
    let alignJs: string;
    let displayFilterJs: string;
    let payloadContractJs: string | null;
    let playbackMathJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, displayFilterJs, playbackMathJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
      payloadContractJs = await ensurePayloadContractAsset();
      throwIfExportAborted(options.signal);
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      payloadContractAssetPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const runtimeBytes = [gobletJs, alignJs, displayFilterJs, payloadContractJs ?? '', playbackMathJs, numJs, inflateJs]
      .reduce((sum, asset) => sum + new TextEncoder().encode(asset).byteLength, 0);
    const htmlBytes = new TextEncoder().encode(indexHtmlWithStudioExtension).byteLength;
    const zipMetadataSource = bundleFormat === 'zip'
      ? createGobletZipPayloadPlan({
          metadata,
          metadataJson: json,
          runtimeBytes,
          htmlBytes,
        })
      : {
          metadata,
          binaryEntries: [] as GobletBinaryPayloadEntry[],
          report: createGobletSizeReport({
            metadata,
            metadataJson: json,
            format: 'zip',
            runtimeBytes,
            htmlBytes,
            duplicatedMetadataBytes: json.length,
          }),
        };
    const zipMetadataPayload = options.minify ? minifyProperties(zipMetadataSource.metadata) : zipMetadataSource.metadata;
    const zipJson = JSON.stringify(zipMetadataPayload, null, options.minify ? undefined : 2);
    zipMetadataSource.report = updateGobletSizeReportPayloadTotals(
      zipMetadataSource.report,
      zipJson,
      zipMetadataSource.binaryEntries
    );
    if (gobletDiagnosticsActive) {
      gobletDebugLog('[webglExporter] Goblet ZIP size report', zipMetadataSource.report);
    }

    const zipBlob = await createGobletZipBlob({
      indexHtml: indexHtmlWithStudioExtension,
      metadataFilename: jsonFilename,
      metadataJson: zipJson,
      diagnosticsEnabled,
      runtimeAsset: gobletRuntimeAsset,
      runtimeJs: gobletJs,
      alignJs,
      displayFilterJs,
      payloadContractJs,
      playbackMathJs,
      numJs,
      inflateJs,
      minify: options.minify,
      embedMetadataFallback: bundleFormat === 'zip-compat',
      binaryEntries: zipMetadataSource.binaryEntries,
    });
    throwIfExportAborted(options.signal);
    const sizeReport = {
      ...zipMetadataSource.report,
      totalBytes: zipBlob.size,
    };
    options.onSizeReport?.(sizeReport);
    emitProgress?.({
      phase: 'complete',
      percent: 100,
      message: 'Goblet export complete',
    });
    return {
      blob: zipBlob,
      filename: `${options.filenameBase}-goblet.zip`,
      metadata,
      sizeReport,
    };
  }

  // Fallback to raw JSON if an unknown bundle format is supplied.
  throwIfExportAborted(options.signal);
  const fallbackBlob = new Blob([json], { type: 'application/json' });
  const fallbackSizeReport = createGobletSizeReport({
    metadata,
    metadataJson: json,
    format: 'json',
    totalBytes: fallbackBlob.size,
  });
  options.onSizeReport?.(fallbackSizeReport);
  emitProgress?.({
    phase: 'complete',
    percent: 100,
    message: 'Goblet export complete',
  });

  return {
    blob: fallbackBlob,
    filename: jsonFilename,
    metadata,
    sizeReport: fallbackSizeReport,
  };
  } catch (error) {
    const progressError = toProgressError(error);
    emitProgress?.({
      phase: 'failed',
      percent: 100,
      message: progressError.message,
      layer: currentProgressLayer
        ? {
            id: currentProgressLayer.id,
            name: currentProgressLayer.name,
            status: 'failed',
            message: currentProgressLayer.staticPreviewReason
              ? `Static preview: ${currentProgressLayer.staticPreviewReason}. ${progressError.message}`
              : progressError.message,
          }
        : undefined,
      error: progressError,
    });
    throw error;
  } finally {
    gobletDiagnosticsActive = previousDiagnostics;
    setGobletColorCycleDiagnosticsActive(previousDiagnostics);
  }
};

export const exportProjectAsWebGL = async (
  options: WebGLExportRequest,
): Promise<WebGLExportMetadata> => {
  const artifact = await buildProjectGobletArtifact(options);
  downloadBlob(artifact.blob, artifact.filename);
  return artifact.metadata;
};

// Expose a few pure helpers for focused tests
export const __TESTING__ = {
  resolveDimensionFromCandidates,
  resolveRecolorSurfaceSize,
  clampBoundsToSurface,
  clampExportLayerSpeedScale,
  applyExportPlaybackScale,
  scaleEncodedSpeedBuffer,
  buildSequentialExportPlayback,
  captureSequentialLayerFrameTextures,
  minifyProperties,
  extractBrushStateFromSavedSnapshot,
  serializeBrushState,
  serializeColorCycleData: serializeColorCycleDataFromResolvedLayer,
  resolveDefBoundSlotPalettes,
  normalizeCanvasSurfaceForExport,
};
