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
  WebGLExportMetadata,
  WebGLExportRequest,
  WebGLLayerMetadata,
  WebGLViewport,
  WebGLViewportMode,
} from '@/utils/export/goblet/gobletTypes';
import { downloadBlob } from '@/utils/export/goblet/downloadBlob';
import {
  fetchGobletAsset,
  type GobletAssetName,
  type GobletAssetRoot,
} from '@/utils/export/goblet/gobletRuntimeAssets';
import {
  applyHtmlBackgroundColorToTemplate,
  applyHtmlTitleToTemplate,
  createSingleFileGobletHtml,
  createSingleFileGobletHtmlFromBundledRuntime,
  DEFAULT_HTML_BACKGROUND_COLOR,
  DEFAULT_HTML_TITLE,
  GOBLET2_FORMAT,
  GOBLET2_SCHEMA_VERSION,
  sanitizeHtmlBackgroundColor,
  sanitizeHtmlTitle,
} from '@/utils/export/goblet/gobletHtmlBuilder';
import {
  canvasToDataURL,
  captureLayerTexture,
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
  serializeColorCycleData,
  setGobletColorCycleDiagnosticsActive,
  summarizeEncodedBuffer,
} from '@/utils/export/goblet/gobletColorCycleSerializer';
import { createGobletZipBlob } from '@/utils/export/goblet/gobletZipBuilder';
import { ccLog, ccWarn, ccSample } from '@/utils/colorCycle/ccDebug';
import { cloneDisplayFilters } from '@/lib/displayFilters';
import { clampRectToDocument as clampBoundsToDocument } from '@/utils/export/colorCycleBounds';

export type {
  WebGLExportMetadata,
  WebGLExportRequest,
  WebGLLayerBounds,
  WebGLLayerMetadata,
} from '@/utils/export/goblet/gobletTypes';

const gobletDiagnosticsDefault = process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true';

let gobletDiagnosticsActive = gobletDiagnosticsDefault;

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


type LayerExportMetrics = LayerContentMetrics;

const computeLayerExportMetrics = (layer: Layer, project: Project): LayerExportMetrics =>
  computeLayerContentMetrics(layer, project);

const PROPERTY_MINIFY_MAP = {
  format: 'f',
  version: 'v',
  exportedAt: 'e',
  project: 'p',
  viewport: 'vp',
  container: 'c',
  animation: 'an',
  settings: 's',
  layers: 'l',
  gradients: 'grl',
  fallback: 'fb',
  schemaVersion: 'csv',
  id: 'i',
  name: 'n',
  type: 't',
  visible: 'vi',
  opacity: 'o',
  blendMode: 'bm',
  source: 'src',
  bounds: 'bnd',
  pixelBoundsPx: 'pbpx',
  pixelBoundsPercent: 'pbpr',
  documentBoundsPx: 'dbpx',
  documentBoundsPercent: 'dbpr',
  layoutPlacement: 'lp',
  frame: 'fr',
  transform: 'tr',
  anchor: 'anc',
  alignment: 'al',
  fit: 'ft',
  horizontal: 'hz',
  vertical: 'vt',
  positioning: 'ps',
  offsetPx: 'opx',
  offsetPercent: 'opc',
  contentBounds: 'cb',
  paintedSize: 'psz',
  assets: 'as',
  colorCycle: 'cc',
  stackIndex: 'si',
  width: 'w',
  height: 'h',
  x: 'x',
  y: 'y',
  designWidth: 'dw',
  designHeight: 'dh',
  texture: 'txr',
  textureFrames: 'txf',
  textureFrameMap: 'txfm',
  mode: 'md',
  isAnimating: 'ia',
  brushState: 'bs',
  alphaMask: 'amk',
  gradientStops: 'gs',
  gradientIdBuffer: 'gib',
  indexBuffer: 'ib',
  slotPalettes: 'sp',
  palette: 'pl',
  animationOffset: 'ao',
  targetFPS: 'tf',
  flowDirection: 'fd',
  alphaMode: 'am',
  recolorSettings: 'rs',
  gradient: 'gr',
  gradientRef: 'grf',
  brushSpeed: 'spd',
  layerBaseSpeedCps: 'lbsc',
  controllerSpeedCps: 'csc',
  legacySpeedCps: 'lsc',
  speedMode: 'smd',
  slotSpeeds: 'ss',
  speedMin: 'smin',
  speedMax: 'smax',
  bundleFormat: 'bf',
  viewportPreset: 'vpp',
  includeHiddenLayers: 'ihl',
  embedCanvasFallback: 'ecf',
  minifyOutput: 'mo',
  htmlTitle: 'htl',
  htmlBackgroundColor: 'hbc',
  transparencyBackgroundMode: 'tbm',
  perfectLoop: 'plp',
  fps: 'fps',
  totalFrames: 'tfm',
  durationSeconds: 'ds',
  phaseMap: 'pm',
  coverageBoundsSourcePx: 'cbsp',
  sequential: 'sq'
} as const;

type PropertyMinifyKey = keyof typeof PROPERTY_MINIFY_MAP;

const minifyProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => minifyProperties(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const mappedKey = PROPERTY_MINIFY_MAP[key as PropertyMinifyKey] ?? key;
    result[mappedKey] = minifyProperties(nested);
  }
  return result;
};






export const exportProjectAsWebGL = async (
  options: WebGLExportRequest
): Promise<WebGLExportMetadata> => {
  if (typeof window === 'undefined') {
    throw new Error('WebGL export is only available in the browser');
  }

  const diagnosticsEnabled = options.enableGobletDiagnostics ?? gobletDiagnosticsDefault;
  const previousDiagnostics = gobletDiagnosticsActive;
  gobletDiagnosticsActive = diagnosticsEnabled;
  setGobletColorCycleDiagnosticsActive(diagnosticsEnabled);

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

  const metricsMap = new Map<string, LayerExportMetrics>();
  options.layers.forEach((layer) => {
    try {
      metricsMap.set(layer.id, computeLayerExportMetrics(layer, options.project));
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
    const layer = options.layers[index];
    if (!options.includeHiddenLayers && !layer.visible) {
      continue;
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

    let texture = await captureLayerTexture(layer);
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
    if (sequentialFrames && sequentialFrames.frames.length > 0) {
      texture = sequentialFrames.frames[0] ?? texture;
      surfaceSize.width = sequentialFrames.sourceSize.width;
      surfaceSize.height = sequentialFrames.sourceSize.height;
    }
    const colorCycleResult = await serializeColorCycleData(layer, options.project, speedWarning, {
      forceSpeedBuffer: false,
      layerSpeedScale: exportLayerSpeedScale,
      toolSpeed: options.colorCycleToolSpeed,
    });
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

    const needsSyntheticTexture = Boolean(
      brushRuntime && (!texture || originalSurfaceSize.width <= 1 || originalSurfaceSize.height <= 1)
    );

    let syntheticTextureApplied = false;
    if (needsSyntheticTexture && brushRuntime) {
      const syntheticTexture = await synthesizeBrushTextureFromIndices(brushRuntime);
      if (syntheticTexture) {
        texture = syntheticTexture;
        syntheticTextureApplied = true;
        surfaceSize.width = Math.max(surfaceSize.width, Math.max(1, brushRuntime.width));
        surfaceSize.height = Math.max(surfaceSize.height, Math.max(1, brushRuntime.height));
      }
    }

    if (colorCycle?.mode === 'brush' && colorCycle.brushState) {
      // Preserve brush alpha/texture detail in Goblet when an exported texture exists.
      colorCycle.brushState.alphaMode = texture ? 'source' : 'opaque-indices';
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
        : normalizedAlignment.offsetPercent
            ? { x: normalizedAlignment.offsetPercent.x, y: normalizedAlignment.offsetPercent.y }
            : undefined;

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

    const metadataDocumentBoundsPx = useIdentityPixelPerfectStack
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

    const metadataDocumentBoundsPercent = useIdentityPixelPerfectStack
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
  }

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

  const bundleFormat: WebGLExportBundleFormat = options.bundleFormat ?? 'zip';
  const transparencyBackgroundMode =
    options.transparencyBackgroundMode
    ?? 'checker';
  const displayFilters = cloneDisplayFilters(
    options.displayFilters ?? options.project.viewState?.displayFilters ?? []
  );

  const metadata: WebGLExportMetadata = {
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
    layers: metadataLayers
  };

  if (preview) {
    metadata.preview = preview;
  }

  if (fallback) {
    metadata.fallback = fallback;
  }

  if (gobletDiagnosticsActive && placementByLayerId) {
    placementByLayerId.forEach((placement, layerId) => {
      gobletDebugLog('[webglExporter] Layout placement', layerId, placement);
    });
  }

  deduplicateGradients(metadata);

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
  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] JSON size after stringify', {
      bytes: json.length,
      minified: options.minify
    });
  }
  const jsonFilename = `${options.filenameBase}-goblet.json`;

  if (bundleFormat === 'json') {
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, jsonFilename);
    return metadata;
  }

  let indexHtml: string;
  try {
    indexHtml = await fetchGobletAsset('index.html', options.assetPrefix, gobletAssetRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet template: ${message}`);
  }
  const indexHtmlWithPresentation = applyHtmlBackgroundColorToTemplate(
    applyHtmlTitleToTemplate(indexHtml, resolvedHtmlTitle),
    resolvedHtmlBackgroundColor
  );

  let baseRuntimeAssetsPromise: Promise<[string, string, string, string, string]> | null = null;
  const ensureBaseRuntimeAssets = () => {
    if (!baseRuntimeAssetsPromise) {
      baseRuntimeAssetsPromise = Promise.all([
        fetchGobletAsset(gobletRuntimeAsset, options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('alignFitResolver.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('displayFilterPipeline.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('num.js', options.assetPrefix, gobletAssetRoot),
        fetchGobletAsset('fflate-inflate.js', options.assetPrefix, gobletAssetRoot)
      ]);
    }
    return baseRuntimeAssetsPromise;
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
    if (bundledRuntime) {
      const singleFileHtml = createSingleFileGobletHtmlFromBundledRuntime(
        indexHtmlWithPresentation,
        bundledRuntime,
        gobletRuntimeModulePath,
        json,
        diagnosticsEnabled
      );
      const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
      downloadBlob(htmlBlob, `${options.filenameBase}-goblet.html`);
      return metadata;
    }

    let gobletJs: string;
    let alignJs: string;
    let displayFilterJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, displayFilterJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const singleFileHtml = createSingleFileGobletHtml(
      indexHtmlWithPresentation,
      gobletJs,
      gobletRuntimeModulePath,
      alignJs,
      displayFilterJs,
      numJs,
      inflateJs,
      json,
      diagnosticsEnabled,
      {
        log: gobletDebugLog,
        warn: gobletDebugWarn,
      }
    );
    const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
    downloadBlob(htmlBlob, `${options.filenameBase}-goblet.html`);
    return metadata;
  }

  if (bundleFormat === 'zip') {
    let gobletJs: string;
    let alignJs: string;
    let displayFilterJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, displayFilterJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const zipBlob = await createGobletZipBlob({
      indexHtml: indexHtmlWithPresentation,
      metadataFilename: jsonFilename,
      metadataJson: json,
      diagnosticsEnabled,
      runtimeAsset: gobletRuntimeAsset,
      runtimeJs: gobletJs,
      alignJs,
      displayFilterJs,
      numJs,
      inflateJs,
      minify: options.minify,
    });
    downloadBlob(zipBlob, `${options.filenameBase}-goblet.zip`);
    return metadata;
  }

  // Fallback to raw JSON if an unknown bundle format is supplied.
  const fallbackBlob = new Blob([json], { type: 'application/json' });
  downloadBlob(fallbackBlob, jsonFilename);

  return metadata;
  } finally {
    gobletDiagnosticsActive = previousDiagnostics;
    setGobletColorCycleDiagnosticsActive(previousDiagnostics);
  }
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
  serializeColorCycleData,
  resolveDefBoundSlotPalettes,
  normalizeCanvasSurfaceForExport,
};
