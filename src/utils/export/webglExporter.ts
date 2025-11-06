import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { cloneExportLayout } from '@/utils/layoutDefaults';
import { computeLayerContentMetrics } from '@/utils/layerMetrics';
import type { LayerContentMetrics } from '@/utils/layerMetrics';
import { resolveContainerLayout as resolveContainerLayoutModel } from '@/utils/layerAlignment';
import type { LayoutLayerInput, LayerTransform, ResolvedLayerLayout } from '@/utils/layerAlignment';
import { deriveAutoPercentOffset, derivePercentBounds } from '@/utils/alignment/alignFitResolver';
import { normalizeAlign, type RawAlignInput } from '@/utils/alignment/normalizeAlign';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { posInt, round3, toNum } from '@/utils/num';
import type {
  ContentBounds,
  ExportContainerLayout,
  Layer,
  LayerAlignmentSettings,
  Project,
  WebGLExportBundleFormat
} from '@/types';
import { packArrayToB64Z } from '@/utils/export/b64z';
import { ccLog, ccWarn, ccSample } from '@/utils/colorCycle/ccDebug';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import {
  clampRectToDocument as clampBoundsToDocument,
  scaleMaskBoundsToDocument,
  deriveCoverageFromIndexBuffer,
  type Size2D as CoverageSize
} from '@/utils/export/colorCycleBounds';

const gobletDiagnosticsDefault = process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true';

let gobletDiagnosticsActive = gobletDiagnosticsDefault;

const gobletDebugLog = (...args: Array<unknown>) => {
  if (gobletDiagnosticsActive) {
    console.log(...args);
  }
};

const gobletDebugWarn = (...args: Array<unknown>) => {
  if (gobletDiagnosticsActive) {
    console.warn(...args);
  }
};

const resolveDimensionFromCandidates = (candidates: Array<unknown>, fallback: number): number => {
  for (const candidate of candidates) {
    const numeric = toNum(candidate, NaN);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.max(1, numeric);
    }
  }
  return Math.max(1, fallback);
};

const resolveRecolorSurfaceSize = (layer: Layer, project: Project): CoverageSize => {
  const colorCycle = layer.colorCycleData;
  const recolorImage = colorCycle?.recolorSettings?.originalImageData ?? layer.imageData ?? null;

  const width = resolveDimensionFromCandidates(
    [
      recolorImage?.width,
      colorCycle?.canvas?.width,
      colorCycle?.canvasWidth,
      project.width
    ],
    project.width
  );

  const height = resolveDimensionFromCandidates(
    [
      recolorImage?.height,
      colorCycle?.canvas?.height,
      colorCycle?.canvasHeight,
      project.height
    ],
    project.height
  );

  return {
    width,
    height
  };
};

const clampBoundsToSurface = (bounds: WebGLLayerBounds, surface: CoverageSize): WebGLLayerBounds => {
  return clampBoundsToDocument(bounds, surface);
};

type JSZipConstructor = typeof import('jszip');

let jszipCtorPromise: Promise<JSZipConstructor> | null = null;

const loadJSZip = async (): Promise<JSZipConstructor> => {
  if (!jszipCtorPromise) {
    jszipCtorPromise = import('jszip').then((mod) => {
      const namespace = mod as unknown as { default?: JSZipConstructor };
      return namespace.default ?? (mod as unknown as JSZipConstructor);
    });
  }
  return jszipCtorPromise;
};

type WebGLViewportMode = 'fixed' | 'fill' | 'fit';

interface WebGLViewport {
  mode: WebGLViewportMode;
  designWidth: number;
  designHeight: number;
}

interface WebGLLayerAsset {
  texture?: string;
}

type LayerExportMetrics = LayerContentMetrics;

type CanvasExportMimeType = 'image/avif' | 'image/webp' | 'image/png';

type SerializedGradientStops = Array<{ position: number; color: string }>;

interface CanvasExportFormatOption {
  type: CanvasExportMimeType;
  quality?: number;
}

type LegacyLayerBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

const resolveDocumentBoundsPx = (
  layer: Layer,
  metrics: LayerContentMetrics,
  project: Project
): WebGLLayerBounds => {
  const layerBounds = (layer as { bounds?: LegacyLayerBounds | null }).bounds;
  if (layerBounds) {
    return {
      x: toNum(layerBounds.x, 0),
      y: toNum(layerBounds.y, 0),
      width: Math.max(1, toNum(layerBounds.width, metrics.contentBounds.width ?? project.width)),
      height: Math.max(1, toNum(layerBounds.height, metrics.contentBounds.height ?? project.height))
    };
  }

  const frame = (layer as { frame?: { x?: number; y?: number } | null }).frame;
  const originX = toNum(frame?.x, 0);
  const originY = toNum(frame?.y, 0);

  return {
    x: originX + toNum(metrics.contentBounds.x, 0),
    y: originY + toNum(metrics.contentBounds.y, 0),
    width: Math.max(1, metrics.contentBounds.width),
    height: Math.max(1, metrics.contentBounds.height)
  };
};

const CANVAS_EXPORT_FORMATS: readonly CanvasExportFormatOption[] = [
  { type: 'image/avif', quality: 0.6 },
  { type: 'image/webp', quality: 0.75 },
  { type: 'image/png' }
];

const getLayerSurfaceSize = (layer: Layer, project?: Project | null) => {
  const framebuffer = layer.framebuffer;
  const fallbackWidth = project?.width ?? layer.imageData?.width ?? 1;
  const fallbackHeight = project?.height ?? layer.imageData?.height ?? 1;

  const width = Math.max(1, framebuffer?.width ?? fallbackWidth);
  const height = Math.max(1, framebuffer?.height ?? fallbackHeight);

  return { width, height };
};

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
  mode: 'md',
  isAnimating: 'ia',
  brushState: 'bs',
  alphaMask: 'amk',
  gradientStops: 'gs',
  indexBuffer: 'ib',
  palette: 'pl',
  animationOffset: 'ao',
  targetFPS: 'tf',
  flowDirection: 'fd',
  alphaMode: 'am',
  recolorSettings: 'rs',
  gradient: 'gr',
  gradientRef: 'grf',
  brushSpeed: 'spd',
  bundleFormat: 'bf',
  includeHiddenLayers: 'ihl',
  embedCanvasFallback: 'ecf',
  minifyOutput: 'mo',
  htmlTitle: 'htl',
  perfectLoop: 'plp',
  fps: 'fps',
  totalFrames: 'tfm',
  durationSeconds: 'ds',
  phaseMap: 'pm',
  coverageBoundsSourcePx: 'cbsp'
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

const isCanvas2DContext = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | RenderingContext | null
): ctx is CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  return Boolean(ctx && typeof (ctx as CanvasRenderingContext2D).clearRect === 'function');
};

interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: number[] | string;
  gradientStops: SerializedGradientStops;
  palette?: Array<string | number>;
  animationOffset: number;
  targetFPS?: number;
  flowDirection?: 'forward' | 'reverse' | 'pingpong';
  alphaMode?: 'source' | 'opaque-indices';
}

interface WebGLSerializedColorCycle {
  mode: NonNullable<Layer['colorCycleData']>['mode'] | 'brush';
  gradient?: SerializedGradientStops;
  gradientRef?: number;
  brushSpeed?: number | null;
  isAnimating: boolean;
  recolorSettings?: Record<string, unknown>;
  brushState?: WebGLSerializedBrushState;
  alphaMask?: WebGLSerializedAlphaMask;
  coverageBoundsPx?: WebGLLayerBounds;
  coverageBoundsSourcePx?: WebGLLayerBounds;
}

interface BrushStateRuntimePayload {
  width: number;
  height: number;
  indices: number[];
  palette?: Array<string | number>;
}

interface ColorCycleRuntimeMetadata {
  brushState?: BrushStateRuntimePayload;
}

interface ColorCycleSerializationResult {
  colorCycle?: WebGLSerializedColorCycle;
  runtime?: ColorCycleRuntimeMetadata;
}

interface WebGLSerializedAlphaMask {
  width: number;
  height: number;
  data: number[] | string;
}

interface SerializedAlphaMaskResult {
  payload: WebGLSerializedAlphaMask;
  values: Uint8Array;
  coverageBounds?: WebGLLayerBounds;
}

interface ColorCycleMaskDataset {
  width: number;
  height: number;
  values: Uint8Array;
  coverage?: WebGLLayerBounds;
}

interface ColorCycleCoverageResult {
  source: WebGLLayerBounds;
  document: WebGLLayerBounds;
}

export interface WebGLLayerSource {
  width: number;
  height: number;
}

/**
 * Rectangle describing a layer in design-space coordinates.
 */
export interface WebGLLayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WebGLLayerBoundsPercent = WebGLLayerBounds;

export interface WebGLLayerPlacement {
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  transform: LayerTransform;
}

export interface AlignmentExportPayload {
  fit: LayerAlignmentSettings['fit'];
  horizontal: LayerAlignmentSettings['horizontal'];
  vertical: LayerAlignmentSettings['vertical'];
  positioning: LayerAlignmentSettings['positioning'];
  offsetPercent?: { x: number; y: number };
}

export interface WebGLLayerMetadata {
  id: string;
  name: string;
  type: Layer['layerType'];
  visible?: boolean;
  opacity?: number;
  blendMode?: Layer['blendMode'];
  source: WebGLLayerSource;
  pixelBoundsPx?: WebGLLayerBounds;
  documentBoundsPx: WebGLLayerBounds;
  documentBoundsPercent: WebGLLayerBoundsPercent;
  layoutPlacement?: WebGLLayerPlacement;
  alignment: AlignmentExportPayload;
  contentBounds?: ContentBounds;
  paintedSize?: { width: number; height: number };
  assets?: WebGLLayerAsset;
  colorCycle?: WebGLSerializedColorCycle;
  stackIndex?: number;
  version?: number;
}

interface WebGLExportAnimationMetadata {
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
}

export interface WebGLExportMetadata {
  format: 'vessel-goblet';
  version: 1;
  exportedAt: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
  };
  viewport: WebGLViewport;
  container: ExportContainerLayout;
  animation: WebGLExportAnimationMetadata;
  settings: {
    includeHiddenLayers: boolean;
    embedCanvasFallback: boolean;
    minifyOutput: boolean;
    perfectLoop: boolean;
    bundleFormat: WebGLExportBundleFormat;
    htmlTitle: string;
  };
  layers: WebGLLayerMetadata[];
  gradients?: SerializedGradientStops[];
  fallback?: {
    type: CanvasExportMimeType;
    dataUrl: string;
  };
}

export interface WebGLExportRequest {
  project: Project;
  layers: Layer[];
  layout: ExportContainerLayout;
  viewport: Partial<WebGLViewport> & {
    mode?: WebGLViewportMode;
    designWidth?: number;
    designHeight?: number;
    width?: number;
    height?: number;
  };
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
  includeHiddenLayers: boolean;
  embedCanvasFallback: boolean;
  minify: boolean;
  filenameBase: string;
  bundleFormat?: WebGLExportBundleFormat;
  enableGobletDiagnostics?: boolean;
  assetPrefix?: string;
  compositeLayersToCanvas?: (targetCanvas: HTMLCanvasElement) => void;
  htmlTitle?: string;
}

const isHTMLCanvas = (canvas: unknown): canvas is HTMLCanvasElement => {
  return typeof window !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && canvas instanceof HTMLCanvasElement;
};

const isOffscreenCanvas = (canvas: unknown): canvas is OffscreenCanvas => {
  return typeof OffscreenCanvas !== 'undefined'
    && canvas instanceof OffscreenCanvas;
};

const isCanvasLike = (canvas: unknown): canvas is HTMLCanvasElement | OffscreenCanvas => {
  return isHTMLCanvas(canvas) || isOffscreenCanvas(canvas);
};

const isImageBitmapLike = (value: unknown): value is ImageBitmap => {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
};

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
};

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

const normalizeImageDataUrl = (dataUrl: unknown): string | undefined => {
  if (typeof dataUrl !== 'string') {
    return undefined;
  }
  const trimmed = dataUrl.trim();
  if (!IMAGE_DATA_URL_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
};

const normalizeBrushFlowDirection = (direction: unknown): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (typeof direction !== 'string') {
    return undefined;
  }

  const trimmed = direction.trim().toLowerCase();
  if (trimmed === 'forward') {
    return 'forward';
  }
  if (trimmed === 'reverse' || trimmed === 'backward') {
    return 'reverse';
  }
  if (trimmed === 'pingpong' || trimmed === 'ping-pong' || trimmed === 'bounce') {
    return 'pingpong';
  }

  return undefined;
};

const sanitizePositiveDimension = (value: unknown, fallback: number): number => {
  const fallbackPositive = Math.max(1, Math.round(toNum(fallback, 1)));
  const numeric = toNum(value, fallbackPositive);
  const safe = numeric > 0 ? numeric : fallbackPositive;
  return posInt(safe, fallbackPositive);
};

const isSerializedGradient = (value: unknown): value is SerializedGradientStops => {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  return value.every((stop) => {
    if (!stop || typeof stop !== 'object') {
      return false;
    }
    const entry = stop as { position?: unknown; color?: unknown };
    const hasColor = typeof entry.color === 'string';
    const position = entry.position;
    const hasPosition = typeof position === 'number' && Number.isFinite(position);
    return hasColor && hasPosition;
  });
};

const buildGradientKey = (gradient: SerializedGradientStops): string => {
  return gradient
    .map((stop) => {
      const position = Number.isFinite(stop.position) ? Number(stop.position.toFixed(6)) : 0;
      return `${position}:${stop.color}`;
    })
    .join('|');
};

const deduplicateGradients = (metadata: WebGLExportMetadata): void => {
  if (!metadata || !Array.isArray(metadata.layers) || metadata.layers.length === 0) {
    return;
  }

  const gradientMap = new Map<string, number>();
  const gradients: SerializedGradientStops[] = [];

  metadata.layers.forEach((layer) => {
    if (!layer?.colorCycle) {
      return;
    }
    const gradient = layer.colorCycle.gradient;
    if (!isSerializedGradient(gradient)) {
      return;
    }

    const key = buildGradientKey(gradient);
    let index = gradientMap.get(key);
    if (typeof index === 'undefined') {
      index = gradients.length;
      gradientMap.set(key, index);
      gradients.push(gradient);
    }

    layer.colorCycle.gradientRef = index;
    delete layer.colorCycle.gradient;
  });

  if (gradients.length > 0) {
    metadata.gradients = gradients;
  } else if ('gradients' in metadata) {
    delete metadata.gradients;
  }
};

const stripLayerDefaults = (layer: WebGLLayerMetadata): WebGLLayerMetadata => layer;

const detectFlowDirectionFromAnimator = (animator: unknown): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (!animator || typeof animator !== 'object') {
    return undefined;
  }

  const animatorAny = animator as {
    getFlowMode?: () => unknown;
    getFlowDirection?: () => unknown;
    flowMode?: unknown;
    flowDirection?: unknown;
    animationController?: {
      getMode?: () => unknown;
      getDirection?: () => unknown;
      flowMode?: unknown;
      flowDirection?: unknown;
    };
  };

  if (typeof animatorAny.getFlowMode === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(animatorAny.getFlowMode());
      if (detected) {
        return detected;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to read flow mode via animator.getFlowMode()', error);
    }
  }

  if (typeof animatorAny.getFlowDirection === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(animatorAny.getFlowDirection());
      if (detected) {
        return detected;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to read flow direction via animator.getFlowDirection()', error);
    }
  }

  const modeDirect = normalizeBrushFlowDirection(animatorAny.flowMode);
  if (modeDirect) {
    return modeDirect;
  }

  const direct = normalizeBrushFlowDirection(animatorAny.flowDirection);
  if (direct) {
    return direct;
  }

  const controller = animatorAny.animationController;
  if (controller) {
    if (typeof controller.getMode === 'function') {
      try {
        const detected = normalizeBrushFlowDirection(controller.getMode());
        if (detected) {
          return detected;
        }
      } catch (error) {
        console.debug('[webglExporter] Failed to read flow mode via animationController.getMode()', error);
      }
    }

    if (typeof controller.getDirection === 'function') {
      try {
        const detected = normalizeBrushFlowDirection(controller.getDirection());
        if (detected) {
          return detected;
        }
      } catch (error) {
        console.debug('[webglExporter] Failed to read flow direction via animationController.getDirection()', error);
      }
    }

    const controllerModeDirect = normalizeBrushFlowDirection(controller.flowMode);
    if (controllerModeDirect) {
      return controllerModeDirect;
    }

    const controllerDirect = normalizeBrushFlowDirection(controller.flowDirection);
    if (controllerDirect) {
      return controllerDirect;
    }
  }

  return undefined;
};

const detectBrushFlowDirection = (brush: unknown, layerId: string): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (!brush || typeof brush !== 'object') {
    return undefined;
  }

  const brushAny = brush as {
    flowMode?: unknown;
    flowDirection?: unknown;
    getFlowDirection?: () => unknown;
    getFlowMode?: () => unknown;
    animators?: Map<string, unknown> | {
      get?: (key: string) => unknown;
      size?: number;
      values?: () => Iterable<unknown>;
    };
  };

  const modeDirect = normalizeBrushFlowDirection(brushAny.flowMode);
  if (modeDirect) {
    return modeDirect;
  }

  const direct = normalizeBrushFlowDirection(brushAny.flowDirection);
  if (direct) {
    return direct;
  }

  if (typeof brushAny.getFlowMode === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(brushAny.getFlowMode());
      if (detected) {
        return detected;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to read brush flow mode via getFlowMode()', error);
    }
  }

  if (typeof brushAny.getFlowDirection === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(brushAny.getFlowDirection());
      if (detected) {
        return detected;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to read brush flow direction via getFlowDirection()', error);
    }
  }

  const { animators } = brushAny;
  if (!animators || typeof animators !== 'object') {
    return undefined;
  }

  try {
    if (animators instanceof Map) {
      let animator = animators.get(layerId);
      if (!animator && animators.size === 1) {
        animator = Array.from(animators.values())[0];
      }
      const detected = detectFlowDirectionFromAnimator(animator);
      if (detected) {
        return detected;
      }
    } else if (typeof (animators as { get?: (key: string) => unknown }).get === 'function') {
      const mapLike = animators as {
        get: (key: string) => unknown;
        size?: number;
        values?: () => Iterable<unknown>;
      };
      let animator = mapLike.get(layerId);
      if (!animator && typeof mapLike.size === 'number' && mapLike.size === 1 && typeof mapLike.values === 'function') {
        const iterator = mapLike.values();
        const first = iterator && iterator[Symbol.iterator] ? iterator[Symbol.iterator]().next() : undefined;
        animator = first && !first.done ? first.value : animator;
      }
      const detected = detectFlowDirectionFromAnimator(animator);
      if (detected) {
        return detected;
      }
    }
  } catch (error) {
    console.debug('[webglExporter] Failed to inspect brush animators for flow direction', error);
  }

  return undefined;
};

const encodeCanvasToBlob = async (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: CanvasExportFormatOption
): Promise<Blob | null> => {
  if (isHTMLCanvas(canvas)) {
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        const callback = (b: Blob | null) => resolve(b && b.size > 0 ? b : null);
        if (typeof format.quality === 'number') {
          canvas.toBlob(callback, format.type, format.quality);
        } else {
          canvas.toBlob(callback, format.type);
        }
      });
      if (blob) {
        return blob;
      }
    } catch (error) {
      console.debug(`[webglExporter] HTMLCanvas toBlob failed for ${format.type}`, error);
    }
  }

  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    try {
      const options: { type: string; quality?: number } = { type: format.type };
      if (typeof format.quality === 'number') {
        options.quality = format.quality;
      }
      const blob = await canvas.convertToBlob(options);
      if (blob && blob.size > 0) {
        return blob;
      }
    } catch (error) {
      console.debug(`[webglExporter] OffscreenCanvas convertToBlob failed for ${format.type}`, error);
    }
  }

  return null;
};

const canvasToDataURL = async (
  canvas: HTMLCanvasElement | OffscreenCanvas
): Promise<{ dataUrl: string; format: CanvasExportMimeType }> => {
  for (const format of CANVAS_EXPORT_FORMATS) {
    try {
      const blob = await encodeCanvasToBlob(canvas, format);
      if (!blob) {
        continue;
      }
      const dataUrl = await blobToDataURL(blob);
      return { dataUrl, format: format.type };
    } catch (error) {
      console.debug(`[webglExporter] Failed to encode canvas as ${format.type}`, error);
    }
  }

  if (isHTMLCanvas(canvas)) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      return { dataUrl, format: 'image/png' };
    } catch (error) {
      console.debug('[webglExporter] Final HTMLCanvas toDataURL fallback failed', error);
    }
  }

  throw new Error('Unsupported canvas instance for export');
};

const imageDataToDataURL = async (imageData: ImageData): Promise<string> => {
  if (typeof document === 'undefined') {
    throw new Error('ImageData serialization requires a browser environment');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, imageData.width);
  canvas.height = Math.max(1, imageData.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to obtain 2D context for ImageData serialization');
  }
  ctx.putImageData(imageData, 0, 0);
  const { dataUrl } = await canvasToDataURL(canvas);
  return dataUrl;
};

const computeLayerExportMetrics = (layer: Layer, project: Project): LayerExportMetrics =>
  computeLayerContentMetrics(layer, project);

const toSerializableGradientStops = (
  stops: Array<{ position?: number; color?: string }> | undefined,
  fallback: Array<{ position: number; color: string }> = []
): Array<{ position: number; color: string }> => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [...fallback];
  }

  const normalized = stops
    .map((stop) => {
      const positionRaw = typeof stop?.position === 'number'
        ? stop.position
        : Number.parseFloat(String(stop?.position ?? '0'));
      const position = Number.isFinite(positionRaw) ? positionRaw : 0;
      const color = typeof stop?.color === 'string' && stop.color
        ? stop.color
        : '#ffffff';
      return { position, color };
    })
    .filter((entry) => Number.isFinite(entry.position));

  if (normalized.length === 0) {
    return [...fallback];
  }

  return normalized;
};

const toSerializableArrayLike = (source: unknown): unknown[] => {
  if (source == null) {
    return [];
  }
  if (Array.isArray(source)) {
    return source.slice();
  }
  if (source instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(source));
  }
  if (ArrayBuffer.isView(source)) {
    return Array.from(source as unknown as ArrayLike<unknown>);
  }
  if (typeof source === 'object') {
    const maybeRecord = source as Record<string, unknown>;
    if ('data' in maybeRecord && maybeRecord.data !== source) {
      const nested = toSerializableArrayLike(maybeRecord.data);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  const iterator = (source as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === 'function') {
    try {
      return Array.from(source as Iterable<unknown>);
    } catch {
      return [];
    }
  }
  return [];
};

const toSerializableNumberArray = (source: unknown): number[] => {
  const values = toSerializableArrayLike(source);
  if (values.length === 0) {
    return [];
  }

  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers.push(value);
      continue;
    }

    const coerced = Number(value);
    if (Number.isFinite(coerced)) {
      numbers.push(coerced);
    }
  }

  return numbers;
};

const normalizeIndexBufferValues = (source: unknown, visited: Set<unknown> = new Set()): number[] => {
  if (source == null) {
    return [];
  }

  const isObjectLike = typeof source === 'object' || typeof source === 'function';
  if (isObjectLike) {
    if (visited.has(source)) {
      return [];
    }
    visited.add(source);
  }

  if (Array.isArray(source)) {
    const values: number[] = [];
    for (const value of source) {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric)) {
        values.push(numeric);
      }
    }
    return values;
  }

  if (source instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(source));
  }

  if (ArrayBuffer.isView(source)) {
    const view = source as unknown as ArrayLike<number> & { length?: number };
    if (typeof view.length === 'number') {
      const values: number[] = new Array(view.length);
      for (let index = 0; index < view.length; index += 1) {
        const raw = view[index];
        values[index] = Number(raw);
      }
      return values;
    }
  }

  const iterator = (source as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === 'function') {
    try {
      const values: number[] = [];
      for (const value of source as Iterable<unknown>) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(numeric)) {
          values.push(numeric);
        }
      }
      if (values.length > 0) {
        return values;
      }
    } catch {
      // Ignore iterator conversion failures and continue falling back to nested inspection.
    }
  }

  if (isObjectLike) {
    const record = source as Record<string, unknown>;
    const nestedCandidates = ['data', 'values', 'buffer', 'array', 'indexBuffer'] as const;
    for (const key of nestedCandidates) {
      if (key in record) {
        const nested = record[key];
        if (nested && nested !== source) {
          const extracted = normalizeIndexBufferValues(nested, visited);
          if (extracted.length > 0) {
            return extracted;
          }
        }
      }
    }
  }

  return toSerializableNumberArray(source);
};

const isByteRangeArray = (values: number[]): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      return false;
    }
  }
  return true;
};

type NumericArrayInput = Uint8Array | number[] | string | null | undefined;

const packNumericArrayForExport = async (input: NumericArrayInput): Promise<number[] | string | undefined> => {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [];
    }
    if (!isByteRangeArray(input)) {
      return [...input];
    }
    const packed = await packArrayToB64Z(input);
    if (packed) {
      return packed;
    }
    return [...input];
  }

  if (input.length === 0) {
    return [];
  }

  const packed = await packArrayToB64Z(input);
  if (packed) {
    return packed;
  }
  return Array.from(input);
};

const summarizeEncodedBuffer = (
  payload: number[] | string | undefined,
  fallbackLength: number
): {
  encoding: 'array' | 'b64z' | 'none';
  length: number | null;
  preview: number[] | string;
} => {
  if (!payload) {
    return { encoding: 'none', length: null, preview: 'none' };
  }

  if (Array.isArray(payload)) {
    return {
      encoding: 'array',
      length: payload.length,
      preview: payload.slice(0, 16)
    };
  }

  return {
    encoding: 'b64z',
    length: fallbackLength,
    preview: payload.slice(0, 64)
  };
};

const toSerializablePaletteArray = (source: unknown): Array<string | number> => {
  const values = toSerializableArrayLike(source);
  if (values.length === 0) {
    return [];
  }

  const palette: Array<string | number> = [];
  for (const value of values) {
    if (typeof value === 'string') {
      palette.push(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      palette.push(value);
    } else if (value != null) {
      const coerced = Number(value);
      if (Number.isFinite(coerced)) {
        palette.push(coerced);
      }
    }
  }

  return palette;
};

const extractBrushStateFromBrushProperties = (brush: unknown, layer: Layer): WebGLSerializedBrushState | undefined => {
  const brushAny = brush as Record<string, unknown>;
  const rawIndexSource = brushAny?.indexBuffer ?? brushAny?.indices ?? brushAny?.data;
  const indexBuffer = normalizeIndexBufferValues(rawIndexSource);
  if (indexBuffer.length === 0) {
    return undefined;
  }

  const dimensionSource = typeof brushAny?.dimensions === 'object' && brushAny.dimensions
    ? brushAny.dimensions as Record<string, unknown>
    : undefined;

  const widthRaw = Number(
    brushAny?.width
    ?? dimensionSource?.width
    ?? layer.imageData?.width
    ?? layer.colorCycleData?.canvas?.width
    ?? 0
  );
  const heightRaw = Number(
    brushAny?.height
    ?? dimensionSource?.height
    ?? layer.imageData?.height
    ?? layer.colorCycleData?.canvas?.height
    ?? 0
  );
  const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : 1));
  const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : 1));

  const gradientStops = toSerializableGradientStops(
    (brushAny?.gradientStops as Array<{ position?: number; color?: string }>)
      ?? (dimensionSource?.gradientStops as Array<{ position?: number; color?: string }>)
      ?? (layer.colorCycleData?.gradient ?? []),
    layer.colorCycleData?.gradient ?? []
  );

  const brushState: WebGLSerializedBrushState = {
    width,
    height,
    indexBuffer,
    gradientStops,
    animationOffset: 0
  };

  const flowDirection = detectBrushFlowDirection(brush, layer.id);
  if (flowDirection) {
    brushState.flowDirection = flowDirection;
  }

  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] Created brush state from direct properties', {
      layerId: layer.id,
      width,
      height,
      indices: indexBuffer.length,
      gradientStops: gradientStops.length
    });
  }

  return brushState;
};

const extractBrushStateFromAnimator = (brush: unknown, layer: Layer): WebGLSerializedBrushState | undefined => {
  const brushAny = brush as Record<string, unknown>;
  const animators = brushAny?.animators as Map<string, unknown> | undefined;
  if (!animators || typeof animators.get !== 'function') {
    return undefined;
  }

  const keys = animators instanceof Map ? Array.from(animators.keys()) : [];
  ccLog('extractBrushStateFromAnimator.animators', { want: layer.id, keys });

  let animator = animators.get(layer.id);
  if (!animator) {
    animator = animators.get('default');
  }
  if (!animator && animators.size === 1) {
    animator = Array.from(animators.values())[0];
  }
  if (!animator) {
    return undefined;
  }

  ccLog('extractBrushStateFromAnimator.use', { used: (animator as { layerId?: string }).layerId ?? 'unknown' });

  try {
    const animatorAny = animator as {
      serialize?: () => unknown;
      indexBuffer?: { serialize?: () => unknown; getDirectData?: () => Uint8Array; width?: number; height?: number; palette?: string[] };
      getCanvas?: () => HTMLCanvasElement;
    };

    const serialized = typeof animatorAny.serialize === 'function'
      ? animatorAny.serialize() as {
          indexBuffer?: { width?: number; height?: number; data?: Uint8Array | number[]; palette?: string[] };
          gradient?: { gradientStops?: Array<{ position?: number; color?: string }> };
          animation?: { offset?: number; stats?: { targetFPS?: number } };
        }
      : undefined;

    let indexBuffer = serialized?.indexBuffer;
    if ((!indexBuffer || !indexBuffer.data) && animatorAny.indexBuffer) {
      try {
        const fromIndexBuffer = typeof animatorAny.indexBuffer.serialize === 'function'
          ? animatorAny.indexBuffer.serialize() as { width?: number; height?: number; data?: Uint8Array | number[]; palette?: string[] }
          : undefined;
        if (fromIndexBuffer?.data) {
          indexBuffer = fromIndexBuffer;
        } else if (typeof animatorAny.indexBuffer.getDirectData === 'function') {
          const directData = animatorAny.indexBuffer.getDirectData();
          indexBuffer = {
            width: animatorAny.indexBuffer.width,
            height: animatorAny.indexBuffer.height,
            data: directData,
            palette: animatorAny.indexBuffer.palette
          } as { width?: number; height?: number; data?: Uint8Array; palette?: string[] };
        }
      } catch (error) {
        console.warn('[webglExporter] Failed to read animator index buffer directly for layer', layer.id, error);
      }
    }

    if (!indexBuffer?.data) {
      return undefined;
    }

    const widthRaw = Number(indexBuffer.width ?? (animatorAny as { width?: number }).width ?? layer.imageData?.width ?? layer.colorCycleData?.canvas?.width);
    const heightRaw = Number(indexBuffer.height ?? (animatorAny as { height?: number }).height ?? layer.imageData?.height ?? layer.colorCycleData?.canvas?.height);

    const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : 0));
    const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : 0));

    const gradientStops = toSerializableGradientStops(
      serialized?.gradient?.gradientStops as Array<{ position?: number; color?: string }> | undefined,
      toSerializableGradientStops((brushAny.currentGradientStops as Array<{ position?: number; color?: string }>) ?? [], layer.colorCycleData?.gradient ?? [])
    );

    const animationOffset = typeof serialized?.animation?.offset === 'number' ? serialized.animation.offset : 0;
    const targetFPS = typeof serialized?.animation?.stats?.targetFPS === 'number'
      ? serialized.animation.stats.targetFPS
      : undefined;

    const indexBufferData = normalizeIndexBufferValues(indexBuffer.data);
    if (indexBufferData.length === 0) {
      console.warn('[webglExporter] Animator fallback produced an empty index buffer for layer', layer.id);
      return undefined;
    }

    ccLog('extractBrushStateFromAnimator.index', {
      w: widthRaw,
      h: heightRaw,
      len: indexBufferData.length,
      sample: ccSample(indexBufferData, 12)
    });

    const paletteValues = indexBuffer.palette ? toSerializablePaletteArray(indexBuffer.palette) : undefined;
    const palette = paletteValues && paletteValues.length > 0 ? paletteValues : undefined;

    if (gobletDiagnosticsActive) {
      gobletDebugLog('[webglExporter] Animator-derived index buffer', {
        layerId: layer.id,
        width,
        height,
        paletteSize: palette?.length ?? null,
        dataSample: indexBufferData.slice(0, 16)
      });
    }

    const brushState: WebGLSerializedBrushState = {
      width,
      height,
      indexBuffer: indexBufferData,
      gradientStops,
      palette,
      animationOffset,
      targetFPS
    };

    const flowDirection = detectFlowDirectionFromAnimator(animator)
      ?? detectBrushFlowDirection(brush, layer.id);
    if (flowDirection) {
      brushState.flowDirection = flowDirection;
    }

    if (gobletDiagnosticsActive) {
      gobletDebugLog('[webglExporter] Brush state extracted from animator fallback', {
        layerId: layer.id,
        width,
        height,
        indices: indexBufferData.length,
        paletteSize: palette?.length ?? null,
        targetFPS,
        hasFlowDirection: Boolean(brushState.flowDirection)
      });
    }

    return brushState;
  } catch (error) {
    console.warn('[webglExporter] Failed to extract brush state from animator for layer', layer.id, error);
    return undefined;
  }
};

let cachedBrushManager: Pick<ColorCycleBrushManager, 'getBrush'> | null = null;

const getBrushManagerInstance = (): Pick<ColorCycleBrushManager, 'getBrush'> | null => {
  if (cachedBrushManager) {
    return cachedBrushManager;
  }

  try {
    cachedBrushManager = getColorCycleBrushManager();
    return cachedBrushManager;
  } catch (error) {
    console.debug('[webglExporter] Unable to load color cycle brush manager', error);
    cachedBrushManager = null;
  }

  return null;
};

const resolveColorCycleBrushInstance = (layer: Layer): { serialize?: () => unknown } | undefined => {
  const directBrush = layer.colorCycleData?.colorCycleBrush as { serialize?: () => unknown } | undefined;
  if (directBrush && typeof directBrush.serialize === 'function') {
    return directBrush;
  }

  try {
    const manager = getBrushManagerInstance();
    if (manager?.getBrush) {
      const managedBrush = manager.getBrush(layer.id) as { serialize?: () => unknown } | undefined;
      if (managedBrush && typeof managedBrush.serialize === 'function') {
        return managedBrush;
      }
    }
  } catch (error) {
    console.debug('[webglExporter] Failed to resolve color cycle brush via manager', error);
  }

  return directBrush;
};

const serializeBrushState = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const brush = resolveColorCycleBrushInstance(layer);

  if (!brush?.serialize) {
    return undefined;
  }

  try {
    const raw = brush.serialize() as {
      layers?: Array<{
        layerId?: string;
        data?: {
          indexBuffer?: {
            width?: number;
            height?: number;
            data?: Uint8Array | number[];
            palette?: string[];
          };
          gradient?: { gradientStops?: Array<{ position?: number; color?: string }> };
          animation?: {
            offset?: number;
            stats?: { targetFPS?: number };
          };
        };
      }>;
    } | undefined;

    ccLog('serializeBrushState.raw', {
      layerId: layer.id,
      rawLayers: raw?.layers?.map((entry) => ({
        id: entry?.layerId ?? null,
        w: entry?.data?.indexBuffer?.width ?? null,
        h: entry?.data?.indexBuffer?.height ?? null,
        len: (entry?.data?.indexBuffer?.data as { length?: number } | undefined)?.length ?? null
      })) ?? null
    });

    if (raw?.layers && raw.layers.length > 0) {
      const directMatch = raw.layers.find((candidate) => candidate?.layerId === layer.id);

      type FallbackReason = 'default' | 'single' | 'dimensions' | 'density';
      let fallbackReason: FallbackReason | undefined;
      let entry = directMatch;

      if (!entry) {
        const defaultMatch = raw.layers.find((candidate) => candidate?.layerId === 'default');
        if (defaultMatch) {
          entry = defaultMatch;
          fallbackReason = 'default';
        } else if (raw.layers.length === 1) {
          entry = raw.layers[0];
          fallbackReason = 'single';
        }
      }

      if (!entry) {
        const toFiniteNumber = (value: unknown): number | undefined => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
          }
          return undefined;
        };
        const resolveDimension = (...values: Array<unknown>): number | undefined => {
          for (const value of values) {
            const numeric = toFiniteNumber(value);
            if (numeric !== undefined) {
              return numeric;
            }
          }
          return undefined;
        };
        const approx = (a?: number, b?: number) => {
          if (typeof a !== 'number' || typeof b !== 'number') {
            return false;
          }
          return Math.abs(a - b) <= 2;
        };

        const lw = resolveDimension(
          layer.imageData?.width,
          layer.colorCycleData?.canvas?.width,
          (layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | undefined)?.width
        );
        const lh = resolveDimension(
          layer.imageData?.height,
          layer.colorCycleData?.canvas?.height,
          (layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | undefined)?.height
        );

        entry = raw.layers.find((candidate) => {
          if (!candidate) {
            return false;
          }
          const width = resolveDimension(candidate?.data?.indexBuffer?.width);
          const height = resolveDimension(candidate?.data?.indexBuffer?.height);
          return approx(width, lw) && approx(height, lh);
        });

        if (entry) {
          fallbackReason = 'dimensions';
          ccLog('serializeBrushState.dimFallback', {
            wanted: layer.id,
            wantedW: lw ?? null,
            wantedH: lh ?? null,
            picked: entry?.layerId ?? null
          });
        }
      }

      if (!entry) {
        const sorted = raw.layers
          .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
          .sort((a, b) => {
            const al = (a.data?.indexBuffer?.data as ArrayLike<number> | undefined)?.length ?? 0;
            const bl = (b.data?.indexBuffer?.data as ArrayLike<number> | undefined)?.length ?? 0;
            return bl - al;
          });
        entry = sorted[0];

        if (entry) {
          fallbackReason = 'density';
        }
      }

      if (!entry) {
        return undefined;
      }

      ccLog('serializeBrushState.pick', {
        wanted: layer.id,
        picked: entry?.layerId ?? null,
        reason: directMatch ? 'direct' : (fallbackReason ?? 'unknown')
      });

      if (!directMatch && console) {
        const reasonDescription = (() => {
          switch (fallbackReason) {
            case 'default':
              return 'default layerId match';
            case 'single':
              return 'single serialized layer';
            case 'dimensions':
              return 'dimension-based match';
            case 'density':
              return 'largest non-zero index buffer';
            default:
              return undefined;
          }
        })();
        console.warn?.(
          '[webglExporter] Falling back to brush state from layerId',
          entry.layerId ?? 'unknown',
          'for layer',
          layer.id,
          reasonDescription ? `(${reasonDescription})` : ''
        );
      }

      if (entry) {
        const indexBuffer = entry.data?.indexBuffer;
        if (indexBuffer) {
          const ib = indexBuffer;
          const widthRaw = Number(ib.width);
          const heightRaw = Number(ib.height);
          const fallbackWidth = layer.imageData?.width ?? layer.colorCycleData?.canvas?.width ?? 1;
          const fallbackHeight = layer.imageData?.height ?? layer.colorCycleData?.canvas?.height ?? 1;

          if (ib.data) {
            if (gobletDiagnosticsActive) {
              const dataType = (ib.data as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
              const sample = (() => {
                try {
                  const arrayLike = ib.data as ArrayLike<number>;
                  return Array.prototype.slice.call(arrayLike, 0, 16);
                } catch {
                  return 'unavailable';
                }
              })();
              gobletDebugLog('[webglExporter] Brush serialize() indexBuffer payload', {
                layerId: layer.id,
                width: ib.width,
                height: ib.height,
                dataType,
                dataLength: (ib.data as { length?: number })?.length ?? 0,
                sample
              });
            }

            let indexArray: number[] = [];
            try {
              indexArray = Array.from(ib.data as ArrayLike<number>);
            } catch (conversionError) {
              console.warn('[webglExporter] Failed to convert indexBuffer data via Array.from; falling back to normalizeIndexBufferValues', conversionError);
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              console.warn(`[webglExporter] Brush serialize() returned an empty index buffer for layer ${layer.id}`);
              return undefined;
            }

            if (gobletDiagnosticsActive) {
              const totalLength = indexArray.length;
              const uniqueValues = new Set(indexArray);
              const firstNonZeroIndex = indexArray.findIndex((value) => value !== 0);
              gobletDebugLog('[webglExporter] Brush serialize() index analysis', {
                layerId: layer.id,
                totalLength,
                nonZeroCount: indexArray.filter((value) => value !== 0).length,
                uniqueValues: Array.from(uniqueValues).slice(0, 20),
                firstNonZeroIndex,
                startSample: indexArray.slice(0, 16),
                endSample: indexArray.slice(totalLength > 16 ? totalLength - 16 : 0)
              });
            }

            const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : fallbackWidth));
            const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : fallbackHeight));
            const gradientStops = toSerializableGradientStops(
              entry.data?.gradient?.gradientStops as Array<{ position?: number; color?: string }> | undefined,
              layer.colorCycleData?.gradient ?? []
            );
            const animationOffset = typeof entry.data?.animation?.offset === 'number'
              ? entry.data.animation.offset
              : 0;
            const targetFPS = typeof entry.data?.animation?.stats?.targetFPS === 'number'
              ? entry.data.animation.stats.targetFPS
              : undefined;
            const paletteValues = ib.palette ? toSerializablePaletteArray(ib.palette) : undefined;
            const palette = paletteValues && paletteValues.length > 0 ? paletteValues : undefined;

            const result: WebGLSerializedBrushState = {
              width,
              height,
              indexBuffer: indexArray,
              gradientStops,
              palette,
              animationOffset,
              targetFPS
            };

            const animationData = entry.data?.animation as { flowDirection?: unknown; stats?: { flowDirection?: unknown } } | undefined;
            const serializedDirection = normalizeBrushFlowDirection(animationData?.flowDirection)
              ?? normalizeBrushFlowDirection(animationData?.stats?.flowDirection);
            const flowDirection = serializedDirection
              ?? detectBrushFlowDirection(brush, layer.id);

            if (flowDirection) {
              result.flowDirection = flowDirection;
            }

            result.alphaMode = 'opaque-indices';

            if (gobletDiagnosticsActive) {
              gobletDebugLog('[webglExporter] Brush serialize() final state', {
                layerId: layer.id,
                width,
                height,
                indices: indexArray.length,
                gradientStops: gradientStops.length,
                paletteSize: palette?.length ?? null,
                targetFPS
              });
            }

            ccLog('serializeBrushState.done', {
              layerId: layer.id,
              width,
              height,
              idxLen: indexArray.length,
              idxSample: ccSample(indexArray, 12)
            });

            return result;
          }
        }
      }
    }
  } catch (error) {
    console.warn('[webglExporter] Failed to serialize brush color cycle state for layer', layer.id, error);
  }

  const propertyState = extractBrushStateFromBrushProperties(brush, layer);
  if (propertyState) {
    if (!propertyState.alphaMode) {
      propertyState.alphaMode = 'opaque-indices';
    }
    return propertyState;
  }

  const animatorState = extractBrushStateFromAnimator(brush, layer);
  if (animatorState) {
    if (!animatorState.alphaMode) {
      animatorState.alphaMode = 'opaque-indices';
    }
    return animatorState;
  }

  return undefined;
};

const resolveColorCycleMaskImage = (layer: Layer): ImageData | undefined => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }
  if (data.eraseMaskImageData) {
    return data.eraseMaskImageData;
  }
  return captureCanvasImageData(data.eraseMask ?? null) ?? undefined;
};

const extractAlphaChannel = (imageData: ImageData): Uint8Array => {
  const width = Math.max(1, Math.floor(imageData.width));
  const height = Math.max(1, Math.floor(imageData.height));
  const total = width * height;
  const alpha = new Uint8Array(total);
  const source = imageData.data;
  for (let i = 0, aIdx = 3; i < total && aIdx < source.length; i += 1, aIdx += 4) {
    alpha[i] = source[aIdx] ?? 0;
  }
  return alpha;
};

const resampleAlphaChannel = (imageData: ImageData, width: number, height: number): Uint8Array => {
  const targetWidth = Math.max(1, Math.floor(width));
  const targetHeight = Math.max(1, Math.floor(height));
  const sourceWidth = Math.max(1, Math.floor(imageData.width));
  const sourceHeight = Math.max(1, Math.floor(imageData.height));

  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return extractAlphaChannel(imageData);
  }

  const result = new Uint8Array(targetWidth * targetHeight);
  const srcData = imageData.data;
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(sourceHeight - 1, Math.max(0, Math.floor(y * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(sourceWidth - 1, Math.max(0, Math.floor(x * scaleX)));
      const srcIndex = (srcY * sourceWidth + srcX) * 4 + 3;
      result[y * targetWidth + x] = srcData[srcIndex] ?? 0;
    }
  }

  return result;
};

const captureColorCycleMaskDataset = (
  layer: Layer,
  width: number,
  height: number
): ColorCycleMaskDataset | undefined => {
  const maskSource = resolveColorCycleMaskImage(layer);
  if (!maskSource) {
    return undefined;
  }

  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedHeight = Math.max(1, Math.floor(height));
  const values = resampleAlphaChannel(maskSource, normalizedWidth, normalizedHeight);

  let hasCoverage = false;
  let minX = normalizedWidth;
  let minY = normalizedHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < normalizedHeight; y += 1) {
    for (let x = 0; x < normalizedWidth; x += 1) {
      const idx = y * normalizedWidth + x;
      if (values[idx] > 0) {
        hasCoverage = true;
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }

  const coverage = hasCoverage
    ? {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      }
    : undefined;

  return {
    width: normalizedWidth,
    height: normalizedHeight,
    values,
    coverage
  };
};

const deriveCoverageFromIndexBufferWithMask = (
  buffer: ArrayLike<number>,
  width: number,
  height: number,
  maskDataset?: ColorCycleMaskDataset
): WebGLLayerBounds | undefined => {
  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedHeight = Math.max(1, Math.floor(height));
  const total = normalizedWidth * normalizedHeight;
  const length = typeof buffer.length === 'number' ? buffer.length : total;
  const limit = Math.min(length, total);

  const maskValues = maskDataset
    && maskDataset.width === normalizedWidth
    && maskDataset.height === normalizedHeight
      ? maskDataset.values
      : undefined;

  let minX = normalizedWidth;
  let minY = normalizedHeight;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < limit; index += 1) {
    const value = Number(buffer[index]);
    if (!Number.isFinite(value) || value === 0) {
      continue;
    }
    if (maskValues && maskValues[index] > 0) {
      continue;
    }
    const y = Math.floor(index / normalizedWidth);
    const x = index - y * normalizedWidth;
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
};

interface ColorCycleCoverageContext {
  layer: Layer;
  project: Project;
  brushState?: WebGLSerializedBrushState;
  recolorIndexBuffer?: ArrayLike<number> | null;
  recolorSurface?: CoverageSize | null;
  maskDataset?: ColorCycleMaskDataset;
}

const computeColorCycleCoverage = (
  context: ColorCycleCoverageContext
): ColorCycleCoverageResult | undefined => {
  const documentSize = {
    width: Math.max(1, context.project.width),
    height: Math.max(1, context.project.height)
  };

  const brushState = context.brushState;
  if (
    brushState &&
    Array.isArray(brushState.indexBuffer) &&
    Number.isFinite(brushState.width) &&
    Number.isFinite(brushState.height)
  ) {
    const coverage = deriveCoverageFromIndexBufferWithMask(
      brushState.indexBuffer,
      brushState.width,
      brushState.height
    );
    if (coverage) {
      return {
        source: clampBoundsToSurface(coverage, {
          width: brushState.width,
          height: brushState.height
        }),
        document: scaleMaskBoundsToDocument(coverage, {
          width: brushState.width,
          height: brushState.height
        }, documentSize)
      };
    }
  }

  if (context.recolorIndexBuffer && context.recolorSurface) {
    const coverage = deriveCoverageFromIndexBufferWithMask(
      context.recolorIndexBuffer,
      context.recolorSurface.width,
      context.recolorSurface.height,
      context.maskDataset
    );
    if (coverage) {
      return {
        source: clampBoundsToSurface(coverage, context.recolorSurface),
        document: scaleMaskBoundsToDocument(
          coverage,
          context.recolorSurface,
          documentSize
        )
      };
    }
  }

  return undefined;
};

const serializeColorCycleAlphaMask = async (
  layer: Layer,
  width: number,
  height: number,
  dataset?: ColorCycleMaskDataset
): Promise<SerializedAlphaMaskResult | undefined> => {
  const maskDataset = dataset ?? captureColorCycleMaskDataset(layer, width, height);
  if (!maskDataset) {
    return undefined;
  }

  const encoded = await packNumericArrayForExport(maskDataset.values);
  if (!encoded) {
    return undefined;
  }

  return {
    payload: {
      width: maskDataset.width,
      height: maskDataset.height,
      data: encoded
    },
    values: maskDataset.values,
    coverageBounds: maskDataset.coverage
  };
};

const applyAlphaMaskToIndexBuffer = (indices: number[] | undefined, mask: Uint8Array): void => {
  if (!indices || indices.length === 0 || mask.length === 0) {
    return;
  }
  const length = Math.min(indices.length, mask.length);
  for (let i = 0; i < length; i += 1) {
    if (mask[i] > 0) {
      indices[i] = 0;
    }
  }
};

const hasNonZeroMagnitude = (value: unknown): boolean => {
  const numeric = toNum(value, 0);
  return Math.abs(numeric) > 0;
};

const isBrushInstanceAnimating = (brush: unknown): boolean => {
  if (!brush || typeof brush !== 'object') {
    return false;
  }

  const candidate = brush as {
    isPlaying?: () => unknown;
    isAnimating?: () => unknown;
    animationState?: { isAnimating?: unknown; isPaused?: unknown };
  };

  if (typeof candidate.isPlaying === 'function') {
    try {
      const playing = candidate.isPlaying();
      if (playing === true) {
        return true;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to inspect brush.isPlaying()', error);
    }
  }

  if (typeof candidate.isAnimating === 'function') {
    try {
      const animating = candidate.isAnimating();
      if (animating === true) {
        return true;
      }
    } catch (error) {
      console.debug('[webglExporter] Failed to inspect brush.isAnimating()', error);
    }
  }

  const state = candidate.animationState;
  if (state && typeof state === 'object') {
    const { isAnimating, isPaused } = state as { isAnimating?: unknown; isPaused?: unknown };
    if (isAnimating === true && isPaused !== true) {
      return true;
    }
  }

  return false;
};

const shouldExportLayerAsAnimating = (layer: Layer): boolean => {
  const data = layer.colorCycleData;
  if (!data) {
    return false;
  }

  if (data.isAnimating) {
    return true;
  }

  if (isBrushInstanceAnimating(data.colorCycleBrush)) {
    return true;
  }

  if (hasNonZeroMagnitude(data.brushSpeed)) {
    return true;
  }

  const recolor = data.recolorSettings;
  if (recolor) {
    const animation = recolor.animation;
    if (animation) {
      if (animation.isPlaying) {
        return true;
      }
      if (hasNonZeroMagnitude(animation.speed)) {
        return true;
      }
    }
  }

  return false;
};

const serializeColorCycleData = async (layer: Layer, project: Project): Promise<ColorCycleSerializationResult | undefined> => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }

  const brushInstance = data.colorCycleBrush as { commitCurrentStroke?: (layerId?: string) => void } | null | undefined;
  if (brushInstance && typeof brushInstance.commitCurrentStroke === 'function') {
    try {
      brushInstance.commitCurrentStroke(layer.id);
    } catch (error) {
      console.warn('[webglExporter] Failed to commit current color cycle stroke before export', error);
    }
  }

  const shouldAnimate = shouldExportLayerAsAnimating(layer);
  const serialized: WebGLSerializedColorCycle = {
    mode: data.mode ?? 'brush',
    gradient: data.gradient,
    brushSpeed: data.brushSpeed ?? null,
    isAnimating: shouldAnimate
  };

  let runtimeBrushState: BrushStateRuntimePayload | undefined;

  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] Animation inference for layer', layer.id, {
      inputIsAnimating: data.isAnimating,
      brushSpeed: data.brushSpeed,
      recolorSpeed: data.recolorSettings?.animation?.speed,
      animationWasPlaying: data.recolorSettings?.animation?.isPlaying,
      exportedIsAnimating: shouldAnimate
    });
  }

  if (data.recolorSettings) {
    const { recolorSettings } = data;
    const animation = { ...recolorSettings.animation };
    if (animation) {
      if (typeof animation.isPlaying !== 'boolean') {
        animation.isPlaying = shouldAnimate;
      } else if (shouldAnimate && animation.isPlaying === false) {
        animation.isPlaying = true;
      }
    }

    const serializedIndexBuffer = await packNumericArrayForExport(recolorSettings.indexBuffer ?? undefined);
    const serializedIndexPhaseMap = await packNumericArrayForExport(recolorSettings.indexPhaseMap ?? undefined);
    const serializedPhaseMap = await packNumericArrayForExport(recolorSettings.phaseMap ?? undefined);

    serialized.recolorSettings = {
      quantizationMode: recolorSettings.quantizationMode,
      ditherMode: recolorSettings.ditherMode,
      animation,
      cycleColors: recolorSettings.cycleColors,
      gradient: recolorSettings.gradient,
      mappingMode: recolorSettings.mappingMode,
      flowMapping: recolorSettings.flowMapping,
      directionAngle: recolorSettings.directionAngle,
      bandWidthPx: recolorSettings.bandWidthPx,
      indexBuffer: serializedIndexBuffer,
      palette: recolorSettings.palette ? Array.from(recolorSettings.palette) : undefined,
      indexPhaseMap: serializedIndexPhaseMap,
      phaseMap: serializedPhaseMap,
      colorMap: recolorSettings.colorMap ? Array.from(recolorSettings.colorMap.entries()) : undefined
    };
  }

  let brushState: WebGLSerializedBrushState | undefined;
  if (!data.recolorSettings) {
    brushState = serializeBrushState(layer);
    if (!brushState) {
      console.warn('[webglExporter] No brush state could be extracted for layer', layer.id);
    }
  }

  const recolorSurface = data.recolorSettings ? resolveRecolorSurfaceSize(layer, project) : undefined;

  const maskDimensions = brushState
    ? { width: brushState.width, height: brushState.height }
    : recolorSurface ?? getLayerSurfaceSize(layer);
  const alphaMaskDataset = captureColorCycleMaskDataset(layer, maskDimensions.width, maskDimensions.height);
  const alphaMaskResult = await serializeColorCycleAlphaMask(
    layer,
    maskDimensions.width,
    maskDimensions.height,
    alphaMaskDataset
  );
  if (alphaMaskResult) {
    serialized.alphaMask = alphaMaskResult.payload;
    if (brushState && Array.isArray(brushState.indexBuffer)) {
      applyAlphaMaskToIndexBuffer(brushState.indexBuffer, alphaMaskResult.values);
    }
  }

  if (brushState && Array.isArray(brushState.indexBuffer)) {
    runtimeBrushState = {
      width: brushState.width,
      height: brushState.height,
      indices: [...brushState.indexBuffer],
      palette: brushState.palette ? [...brushState.palette] : undefined
    };
  }

  let coverageMaskDataset: ColorCycleMaskDataset | undefined;
  if (recolorSurface) {
    if (
      alphaMaskDataset &&
      alphaMaskDataset.width === recolorSurface.width &&
      alphaMaskDataset.height === recolorSurface.height
    ) {
      coverageMaskDataset = alphaMaskDataset;
    } else {
      coverageMaskDataset = captureColorCycleMaskDataset(layer, recolorSurface.width, recolorSurface.height);
    }
  }

  const coverage = computeColorCycleCoverage({
    layer,
    project,
    brushState,
    recolorIndexBuffer: data.recolorSettings?.indexBuffer ?? null,
    recolorSurface,
    maskDataset: coverageMaskDataset
  });

  if (coverage) {
    serialized.coverageBoundsSourcePx = coverage.source;
    serialized.coverageBoundsPx = coverage.document;
  }

  if (brushState) {
    const encodedIndexBuffer = await packNumericArrayForExport(brushState.indexBuffer);
    const preparedBrushState: WebGLSerializedBrushState = {
      ...brushState,
      indexBuffer: encodedIndexBuffer ?? []
    };

    serialized.brushState = preparedBrushState;
    if (!serialized.gradient || serialized.gradient.length === 0) {
      serialized.gradient = preparedBrushState.gradientStops;
    }
    if (gobletDiagnosticsActive) {
      const summary = summarizeEncodedBuffer(preparedBrushState.indexBuffer, Array.isArray(brushState.indexBuffer) ? brushState.indexBuffer.length : 0);
      gobletDebugLog('[webglExporter] Brush state included for layer via serialize()', {
        layerId: layer.id,
        width: preparedBrushState.width,
        height: preparedBrushState.height,
        indices: summary.length,
        encoding: summary.encoding,
        paletteSize: preparedBrushState.palette?.length ?? null,
        sample: summary.preview
      });
    }
  }

  if (gobletDiagnosticsActive) {
    const recolorIndexPayload = serialized.recolorSettings?.indexBuffer;
    const brushIndexPayload = serialized.brushState?.indexBuffer;
    const recolorIndexSummary = summarizeEncodedBuffer(
      Array.isArray(recolorIndexPayload) || typeof recolorIndexPayload === 'string' ? recolorIndexPayload : undefined,
      Array.isArray(data.recolorSettings?.indexBuffer) ? data.recolorSettings!.indexBuffer!.length : 0
    );
    const brushIndexSummary = summarizeEncodedBuffer(
      Array.isArray(brushIndexPayload) || typeof brushIndexPayload === 'string' ? brushIndexPayload : undefined,
      typeof brushIndexPayload === 'string' ? 0 : Array.isArray(brushIndexPayload) ? brushIndexPayload.length : 0
    );

    gobletDebugLog('[webglExporter] Serialized color cycle layer', layer.id, {
      mode: serialized.mode,
      isAnimating: serialized.isAnimating,
      brushSpeed: serialized.brushSpeed,
      hasRecolor: Boolean(serialized.recolorSettings),
      recolorIndexSummary,
      recolorPhaseLength: Array.isArray(serialized.recolorSettings?.phaseMap)
        ? serialized.recolorSettings!.phaseMap!.length
        : undefined,
      recolorPaletteLength: Array.isArray(serialized.recolorSettings?.palette)
        ? serialized.recolorSettings!.palette!.length
        : undefined,
      brushIndexSummary,
      gradientStops: serialized.gradient?.length ?? 0
    });
  }

  return {
    colorCycle: serialized,
    runtime: runtimeBrushState ? { brushState: runtimeBrushState } : undefined
  };
};

const KNOWN_LAYER_CANVAS_KEYS = [
  'canvas',
  'webglCanvas',
  'compositeCanvas',
  'renderCanvas',
  'drawingCanvas',
  'displayCanvas',
  'bufferCanvas',
  'targetCanvas',
  'scratchCanvas'
] as const;

const extractCanvasFromValue = (value: unknown): HTMLCanvasElement | OffscreenCanvas | undefined => {
  if (isCanvasLike(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const nested = record.canvas ?? record.framebuffer;
  if (isCanvasLike(nested)) {
    return nested;
  }
  return undefined;
};

const resolveLayerCanvasSurface = (layer: Layer): HTMLCanvasElement | OffscreenCanvas | undefined => {
  if (isCanvasLike(layer.framebuffer)) {
    return layer.framebuffer;
  }

  const colorCycleCanvas = layer.colorCycleData?.canvas;
  if (isCanvasLike(colorCycleCanvas)) {
    return colorCycleCanvas;
  }

  const layerRecord = layer as unknown as Record<string, unknown>;
  for (const key of KNOWN_LAYER_CANVAS_KEYS) {
    const candidate = layerRecord[key];
    const resolved = extractCanvasFromValue(candidate);
    if (resolved) {
      return resolved;
    }
  }

  for (const value of Object.values(layerRecord)) {
    const resolved = extractCanvasFromValue(value);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const resolveLayerImageBitmap = (layer: Layer): ImageBitmap | undefined => {
  const layerRecord = layer as unknown as Record<string, unknown>;

  const direct = layerRecord.imageBitmap ?? layerRecord.bitmap;
  if (isImageBitmapLike(direct)) {
    return direct;
  }

  const colorCycleData = layer.colorCycleData as unknown as Record<string, unknown> | undefined;
  if (colorCycleData) {
    const colorCycleBitmap = colorCycleData.bitmap ?? colorCycleData.imageBitmap;
    if (isImageBitmapLike(colorCycleBitmap)) {
      return colorCycleBitmap;
    }
  }

  for (const value of Object.values(layerRecord)) {
    if (isImageBitmapLike(value)) {
      return value;
    }
    if (!value || typeof value !== 'object') {
      continue;
    }
    const nestedRecord = value as Record<string, unknown>;
    const nestedBitmap = nestedRecord.imageBitmap ?? nestedRecord.bitmap;
    if (isImageBitmapLike(nestedBitmap)) {
      return nestedBitmap;
    }
  }

  return undefined;
};

const imageBitmapToDataURL = async (bitmap: ImageBitmap): Promise<string | undefined> => {
  try {
    const width = Math.max(1, bitmap.width || (bitmap as { width?: number }).width || 1);
    const height = Math.max(1, bitmap.height || (bitmap as { height?: number }).height || 1);

    let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else if (typeof document !== 'undefined') {
      const htmlCanvas = document.createElement('canvas');
      htmlCanvas.width = width;
      htmlCanvas.height = height;
      canvas = htmlCanvas;
    }

    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!isCanvas2DContext(ctx)) {
      return undefined;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { dataUrl } = await canvasToDataURL(canvas);
    return normalizeImageDataUrl(dataUrl);
  } catch (error) {
    console.warn('[webglExporter] Failed to serialize ImageBitmap for layer export', error);
    return undefined;
  } finally {
    try {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    } catch {
      // ignore
    }
  }
};

const captureLayerTexture = async (layer: Layer): Promise<string | undefined> => {
  try {
    const surface = resolveLayerCanvasSurface(layer);
    if (surface) {
      const { dataUrl } = await canvasToDataURL(surface);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from canvas surface for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    if (layer.imageData) {
      const dataUrl = await imageDataToDataURL(layer.imageData);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from ImageData for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    const bitmap = resolveLayerImageBitmap(layer);
    if (bitmap) {
      const normalized = await imageBitmapToDataURL(bitmap);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  } catch (error) {
    console.warn('[webglExporter] Failed to capture texture for layer', layer.id, error);
    return undefined;
  }
};

type RGBAColor = { r: number; g: number; b: number; a: number };

const DEFAULT_BRUSH_COLOR: RGBAColor = { r: 255, g: 255, b: 255, a: 255 };

const numericPaletteEntryToRGBA = (entry: number): RGBAColor => {
  const value = Number(entry) >>> 0;
  return {
    r: value & 0xff,
    g: (value >>> 8) & 0xff,
    b: (value >>> 16) & 0xff,
    a: (value >>> 24) & 0xff
  };
};

const paletteEntryToRGBA = (entry: string | number): RGBAColor => {
  if (typeof entry === 'number' && Number.isFinite(entry)) {
    return numericPaletteEntryToRGBA(entry);
  }
  if (typeof entry === 'string') {
    return parseCssColor(entry, DEFAULT_BRUSH_COLOR);
  }
  return { ...DEFAULT_BRUSH_COLOR };
};

const buildBrushPaletteLUT = (palette?: Array<string | number>): RGBAColor[] => {
  if (!Array.isArray(palette) || palette.length === 0) {
    return [];
  }
  return palette.map((entry) => paletteEntryToRGBA(entry));
};

const hashIndexToColor = (value: number): RGBAColor => {
  const colorSeed = (value * 47) & 0xff;
  return {
    r: (colorSeed + 64) & 0xff,
    g: (colorSeed * 3) & 0xff,
    b: (colorSeed * 7) & 0xff,
    a: 255
  };
};

const synthesizeBrushTextureFromIndices = async (
  source: BrushStateRuntimePayload
): Promise<string | undefined> => {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  if (source.indices.length === 0) {
    return undefined;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!isCanvas2DContext(ctx)) {
      return undefined;
    }

    const imageData = ctx.createImageData(width, height);
    const { data } = imageData;
    const limit = Math.min(source.indices.length, width * height);
    const paletteLut = buildBrushPaletteLUT(source.palette);
    for (let index = 0; index < limit; index += 1) {
      const value = Number(source.indices[index]) || 0;
      if (value <= 0) {
        continue;
      }
      const base = index * 4;
      let rgba: RGBAColor | undefined;
      if (paletteLut.length > 0) {
        const paletteIndex = value < paletteLut.length ? value : (value % paletteLut.length);
        rgba = paletteLut[paletteIndex] ?? paletteLut[paletteIndex % paletteLut.length];
      }
      if (!rgba) {
        rgba = hashIndexToColor(value);
      }
      const alpha = rgba.a > 0 ? rgba.a : 255;
      data[base] = rgba.r;
      data[base + 1] = rgba.g;
      data[base + 2] = rgba.b;
      data[base + 3] = alpha;
    }

    ctx.putImageData(imageData, 0, 0);
    const { dataUrl } = await canvasToDataURL(canvas);
    return normalizeImageDataUrl(dataUrl);
  } catch (error) {
    console.warn('[webglExporter] Failed to synthesize brush texture from indices', error);
    return undefined;
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

type GobletAssetName =
  | 'index.html'
  | 'goblet.js'
  | 'alignFitResolver.js'
  | 'num.js'
  | 'fflate-inflate.js'
  | 'goblet-inline.js';

const gobletAssetCache = new Map<string, Promise<string>>();

const getDefaultAssetPrefix = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const extendedWindow = window as typeof window & {
    __NEXT_DATA__?: {
      assetPrefix?: string;
      runtimeConfig?: { basePath?: string };
    };
  };

  const assetPrefix = extendedWindow.__NEXT_DATA__?.assetPrefix;
  if (typeof assetPrefix === 'string' && assetPrefix.length > 0) {
    return assetPrefix;
  }

  const runtimeBasePath = extendedWindow.__NEXT_DATA__?.runtimeConfig?.basePath;
  if (typeof runtimeBasePath === 'string' && runtimeBasePath.length > 0) {
    return runtimeBasePath;
  }

  const baseEl = document.querySelector('base');
  if (baseEl?.href) {
    try {
      const parsed = new URL(baseEl.href);
      const pathname = parsed.pathname;
      if (pathname && pathname !== '/') {
        return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      }
    } catch {}
  }

  return '';
};

const resolveGobletAssetUrl = (asset: GobletAssetName, assetPrefix?: string): string => {
  const prefix = assetPrefix ?? getDefaultAssetPrefix();
  const normalizedAsset = asset.startsWith('/') ? asset.slice(1) : asset;
  const assetPath = `goblet/${normalizedAsset}`;

  if (!prefix) {
    return `/${assetPath}`;
  }

  if (/^https?:\/\//.test(prefix)) {
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return `${trimmed}/${assetPath}`;
  }

  const trimmedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const ensuredPrefix = trimmedPrefix.startsWith('/') ? trimmedPrefix : `/${trimmedPrefix}`;
  return `${ensuredPrefix}/${assetPath}`;
};

const fetchGobletAsset = (asset: GobletAssetName, assetPrefix?: string): Promise<string> => {
  const cacheKey = `${assetPrefix ?? '__default__'}::${asset}`;
  const cached = gobletAssetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const url = resolveGobletAssetUrl(asset, assetPrefix);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load Goblet asset ${asset} from ${url} (${response.status})`);
    }
    return await response.text();
  })();

  gobletAssetCache.set(cacheKey, promise);
  return promise;
};

const transformModuleScript = (html: string, transform: (scriptContent: string) => string): string => {
  const scriptOpen = '<script type="module">';
  const scriptStart = html.indexOf(scriptOpen);
  if (scriptStart === -1) {
    throw new Error('Goblet template missing module script tag');
  }
  const contentStart = scriptStart + scriptOpen.length;
  const scriptEnd = html.indexOf('</script>', contentStart);
  if (scriptEnd === -1) {
    throw new Error('Goblet template missing module script closing tag');
  }

  const originalContent = html.slice(contentStart, scriptEnd);
  const nextContent = transform(originalContent);
  return `${html.slice(0, contentStart)}${nextContent}${html.slice(scriptEnd)}`;
};

const encodeMetadataForInlineScript = (metadataJson: string): string => {
  return metadataJson
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E');
};

const DEFAULT_HTML_TITLE = 'Goblet';

const sanitizeHtmlTitle = (value: unknown): string => {
  if (typeof value !== 'string') {
    return DEFAULT_HTML_TITLE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_HTML_TITLE;
  }
  return trimmed.slice(0, 120);
};

const escapeHtmlEntities = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const applyHtmlTitleToTemplate = (html: string, title: string): string => {
  const escapedTitle = escapeHtmlEntities(title);
  const titlePattern = /<title>[\s\S]*?<\/title>/i;
  if (titlePattern.test(html)) {
    return html.replace(titlePattern, `<title>${escapedTitle}</title>`);
  }
  const headClose = html.indexOf('</head>');
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}<title>${escapedTitle}</title>${html.slice(headClose)}`;
  }
  return `<title>${escapedTitle}</title>${html}`;
};

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\$&');

const stripModuleImportStatement = (content: string, modulePath: string): string => {
  const escaped = escapeForRegExp(modulePath);
  const pattern = new RegExp(
    `\\s*import\\s+(?:[\\w*$\\s{},]+?)\\s+from\\s+['\"']${escaped}['\"'];?\\s*`,
    'g'
  );
  return content.replace(pattern, '\n');
};

const stripAllStaticImports = (content: string): string => {
  // Remove any remaining static import statements, including multiline named imports.
  return content.replace(/\s*import\s+(?:[\w*$\s{},]+?\s+from\s+)?['\"][^'\"]+['\"];?\s*/g, '\n');
};

const stripGobletImport = (content: string): string => {
  return stripModuleImportStatement(content, './goblet.js');
};

const appendZipAutoloadSnippet = (
  scriptContent: string,
  bundleFilename: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const diagnosticsLiteral = diagnosticsEnabled ? 'true' : 'false';
  const snippet = `
      const diagnosticsDefault = ${diagnosticsLiteral};
      let enableDiagnostics = diagnosticsDefault;
      if (diagnosticsDefault) {
        try {
          if (typeof window !== 'undefined') {
            if (window.__VESSEL_GOBLET_DEBUG__ === true) {
              enableDiagnostics = true;
            } else if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              enableDiagnostics = true;
            } else if (window.localStorage && window.localStorage.getItem('vesselGobletDebug') === 'true') {
              enableDiagnostics = true;
            }
          }
        } catch {
          // ignore resolution errors (e.g., file:// without localStorage)
        }
      }
      if (typeof window !== 'undefined') {
        window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
        window.vesselGobletSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('vesselGobletDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
            }
          : () => {
              console.warn('Goblet diagnostics are disabled in this build.');
            };
      }
      const emitLog = enableDiagnostics
        ? (...args) => {
            console.log('[Vessel Goblet]', ...args);
          }
        : () => {};
      const emitWarn = enableDiagnostics
        ? (...args) => {
            console.warn('[Vessel Goblet]', ...args);
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandVesselMetadata === 'function') {
          try {
            return expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandVesselMetadata === 'function') {
          try {
            return window.expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via Goblet helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = JSON.parse(\`${metadataLiteral}\`);
      console.log('Parsed metadata layers (raw):', packagedMetadataRaw.layers || packagedMetadataRaw.l);
      console.log('Layer details (raw):', (packagedMetadataRaw.layers || packagedMetadataRaw.l)?.map((layer) => ({
        id: layer?.id ?? layer?.i,
        hasTexture: Boolean(layer?.assets?.texture ?? layer?.as?.txr),
        visible: layer?.visible ?? layer?.vi
      })));
      const packagedMetadata = expandPackagedMetadata(packagedMetadataRaw);
      if (enableDiagnostics) {
        emitLog('[DEBUG] Checking parsed metadata:');
        packagedMetadata.layers?.forEach((layer) => {
          if (layer.colorCycle?.brushState) {
            const bs = layer.colorCycle.brushState;
            emitLog('[DEBUG] Layer diagnostics', {
              id: layer.id,
              hasIndexBuffer: Boolean(bs.indexBuffer),
              indexBufferType: typeof bs.indexBuffer,
              indexBufferIsArray: Array.isArray(bs.indexBuffer),
              indexBufferLength: typeof bs.indexBuffer === 'string' ? bs.indexBuffer.length : bs.indexBuffer?.length,
              preview: Array.isArray(bs.indexBuffer)
                ? bs.indexBuffer.slice(0, 6)
                : typeof bs.indexBuffer === 'string'
                  ? bs.indexBuffer.slice(0, 48)
                  : null
            });
          }
        });
      }
      const autoBundleName = ${JSON.stringify(bundleFilename)};
      const renderPackagedMetadata = async (metadata) => {
        console.log('Incoming metadata layers (pre-expand):', metadata.layers || metadata.l);
        const normalizedMetadata = expandPackagedMetadata(metadata);
        console.log('Expanded metadata layers:', normalizedMetadata.layers);
        setStatus('Rendering packaged bundle…');
        emitLog('Loaded metadata for auto-render:', normalizedMetadata);
        emitLog('Canvas element reference:', canvas);
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Preview canvas element is unavailable');
        }
        const scale = computeScale(normalizedMetadata);
        if (normalizedMetadata?.viewport?.mode) {
          document.body.dataset.viewportMode = normalizedMetadata.viewport.mode;
        } else {
          delete document.body.dataset.viewportMode;
        }
        const opts = normalizedMetadata?.viewport?.mode === 'fixed' ? {} : { scale };
        const renderResult = await renderVesselWebGL(normalizedMetadata, canvas, opts);
        summarizeMetadata(normalizedMetadata, renderResult);
        lastMetadata = normalizedMetadata;
        const rendererHandle = canvas && canvas[Symbol.for('VesselRenderer')];
        if (rendererHandle && typeof rendererHandle.setSourceMetadata === 'function') {
          rendererHandle.setSourceMetadata(normalizedMetadata);
        }
        emitLog('[DEBUG] packaged Goblet stored metadata', {
          hasMetadata: Boolean(lastMetadata),
          scale
        });
        if (enableDiagnostics) {
          emitLog('Render summary:', {
            scale,
            layerCount: normalizedMetadata.layers?.length ?? 0
          });
        }
        setStatus('Packaged bundle rendered.');
      };
      const autoLoadPackagedBundle = async () => {
        try {
          setStatus('Loading packaged bundle…');
          const response = await fetch(autoBundleName, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const metadata = await response.json();
          await renderPackagedMetadata(metadata);
          return;
        } catch (error) {
          if (error instanceof Error) {
            emitWarn('Automatic bundle load failed', error);
          }
          if (packagedMetadata) {
            try {
              await renderPackagedMetadata(packagedMetadata);
              return;
            } catch (secondaryError) {
              emitWarn('Failed to render embedded metadata', secondaryError);
            }
          }
          setStatus('Goblet ready. Drop a bundle to preview.');
        }
      };
      void autoLoadPackagedBundle();
`;
  return `${scriptContent}${snippet}`;
};

const buildInlineAlignRuntime = (alignJs: string): string => {
  const withoutSpecificImports = stripModuleImportStatement(alignJs, './num.js');
  const withoutAliasImports = stripModuleImportStatement(withoutSpecificImports, '@/utils/num');
  const withoutImports = stripAllStaticImports(withoutAliasImports);
  const sanitized = withoutImports
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .trim();

  if (!sanitized) {
    return '';
  }

  const exports = ['normalizeAlignment', 'computeLayerTransform', 'computeLayerDestination'];
  const exportList = exports.join(', ');

  return `const { ${exportList} } = (() => {\n${sanitized}\nreturn { ${exportList} };\n})();`;
};

const buildInlineInflateRuntime = (inflateJs: string): string => {
  let sanitized = inflateJs
    .replace(/export\s+default\s+inflateRaw;?/g, '')
    .replace(/export\s+\{\s*inflateRaw\s*\};?/g, '')
    .replace(/export\s+const\s+inflateRaw\s*=/g, 'const inflateRaw =');
  sanitized = sanitized.trimEnd();
  return `const inflateRaw = (() => {\n${sanitized}\nreturn inflateRaw;\n})();`;
};

const buildInlineNumRuntime = (numJs: string): string => {
  const sanitized = numJs
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .trim();
  return sanitized ? `${sanitized}\n` : '';
};

const buildSingleFileRenderSnippet = (metadataJson: string, diagnosticsEnabled: boolean): string => {
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const diagnosticsLiteral = diagnosticsEnabled ? 'true' : 'false';
  return `
      const diagnosticsDefault = ${diagnosticsLiteral};
      const resolveDiagnostics = () => {
        if (!diagnosticsDefault) {
          return false;
        }
        try {
          if (typeof window !== 'undefined') {
            if (window.__VESSEL_GOBLET_DEBUG__ === true) {
              return true;
            }
            if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              return true;
            }
            if (window.localStorage && window.localStorage.getItem('vesselGobletDebug') === 'true') {
              return true;
            }
          }
        } catch {
          // ignore resolution errors (e.g., file:// without localStorage)
        }
        return diagnosticsDefault;
      };
      let enableDiagnostics = resolveDiagnostics();
      if (typeof window !== 'undefined') {
        window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
        window.vesselGobletSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('vesselGobletDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
            }
          : () => {
              console.warn('Goblet diagnostics are disabled in this build.');
            };
      }
      const emitLog = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              console.log('[Vessel Goblet]', ...args);
            }
          }
        : () => {};
      const emitWarn = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              console.warn('[Vessel Goblet]', ...args);
            }
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandVesselMetadata === 'function') {
          try {
            return expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandVesselMetadata === 'function') {
          try {
            return window.expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via Goblet helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = JSON.parse(\`${metadataLiteral}\`);
      console.log('Parsed metadata layers (raw):', packagedMetadataRaw.layers || packagedMetadataRaw.l);
      console.log('Layer details (raw):', (packagedMetadataRaw.layers || packagedMetadataRaw.l)?.map((layer) => ({
        id: layer?.id ?? layer?.i,
        hasTexture: Boolean(layer?.assets?.texture ?? layer?.as?.txr),
        visible: layer?.visible ?? layer?.vi
      })));
      const packagedMetadata = expandPackagedMetadata(packagedMetadataRaw);
      if (enableDiagnostics) {
        emitLog('[DEBUG] Prepared Goblet metadata for single-file bundle', {
          layerCount: packagedMetadata.layers?.length ?? 0,
          hasFallback: Boolean(packagedMetadata.fallback)
        });
      }
      const renderPackagedBundle = async () => {
        try {
          console.log('[goblet] Starting render, metadata:', packagedMetadata);
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Preview canvas element is unavailable');
          }
          setStatus('Rendering packaged bundle…');
          console.log('Expanded metadata layers (single-file):', packagedMetadata.layers);
          if (Array.isArray(packagedMetadata.layers)) {
          console.log('[goblet] Full layer data:', packagedMetadata.layers.map((layer) => ({
            id: layer.id,
            documentBoundsPx: layer.documentBoundsPx,
            layoutPlacement: layer.layoutPlacement,
            source: layer.source,
            contentBounds: layer.contentBounds,
            opacity: layer.opacity,
            visible: layer.visible,
            hasTexture: Boolean(layer.assets?.texture),
            textureStart: typeof layer.assets?.texture === 'string' ? layer.assets.texture.substring(0, 50) : undefined
          })));
          }
          const scale = computeScale(packagedMetadata);
          console.log('[goblet] Computed scale:', scale);
          const opts = packagedMetadata?.viewport?.mode === 'fixed' ? {} : { scale };
          const renderResult = await renderVesselWebGL(packagedMetadata, canvas, opts);
          console.log('[goblet] Render complete:', renderResult);
          summarizeMetadata(packagedMetadata, renderResult);
          if (enableDiagnostics) {
            emitLog('Goblet render summary:', {
              scale,
              layers: packagedMetadata.layers?.length ?? 0
            });
          }
          setStatus('Packaged bundle rendered.');
        } catch (error) {
          console.error('[goblet] Render failed:', error);
          console.error('[goblet] Stack trace:', error?.stack);
          emitWarn('Failed to render packaged bundle', error);
          setStatus(error instanceof Error ? error.message : 'Failed to render bundle', 'error');
        }
      };
      void renderPackagedBundle();
`;
};

const buildSingleFileScript = (
  scriptContent: string,
  gobletRuntime: string,
  alignRuntime: string,
  numRuntime: string,
  inflateRuntime: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const withoutImport = stripGobletImport(scriptContent);
  const runtimeWithoutAlignImport = stripModuleImportStatement(gobletRuntime, './alignFitResolver.js');
  const runtimeWithoutNumImport = stripModuleImportStatement(runtimeWithoutAlignImport, './num.js');
  const runtimeWithoutInflateImport = stripModuleImportStatement(runtimeWithoutNumImport, './fflate-inflate.js');
  const inlineInflateAlreadyPresent = /const\s+inflateRaw\s*=\s*\(\s*\(\s*\)\s*=>/.test(runtimeWithoutInflateImport);
  const inlineInflate = inlineInflateAlreadyPresent ? '' : buildInlineInflateRuntime(inflateRuntime);
  const inlineAlign = buildInlineAlignRuntime(alignRuntime);
  const inlineNum = buildInlineNumRuntime(numRuntime);
  const runtimePrefixParts = [] as string[];
  if (inlineNum) {
    runtimePrefixParts.push(inlineNum);
  }
  if (inlineAlign) {
    runtimePrefixParts.push(inlineAlign);
  }
  if (inlineInflate) {
    runtimePrefixParts.push(inlineInflate);
  }
  const runtimePrefix = runtimePrefixParts.length > 0 ? `\n${runtimePrefixParts.join('\n')}\n` : '\n';
  const runtime = `${runtimePrefix}${runtimeWithoutInflateImport}\n`;
  const snippet = buildSingleFileRenderSnippet(metadataJson, diagnosticsEnabled);
  return `${runtime}${withoutImport}${snippet}`;
};

const buildSingleFileScriptFromBundledRuntime = (
  scriptContent: string,
  bundledRuntime: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const withoutImport = stripGobletImport(scriptContent);
  const runtime = bundledRuntime.endsWith('\n') ? bundledRuntime : `${bundledRuntime}\n`;
  const snippet = buildSingleFileRenderSnippet(metadataJson, diagnosticsEnabled);
  return `${runtime}${withoutImport}${snippet}`;
};

const createZipGobletHtml = (
  template: string,
  bundleFilename: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  return transformModuleScript(template, (script) => appendZipAutoloadSnippet(script, bundleFilename, metadataJson, diagnosticsEnabled));
};

const stripGobletExports = (gobletJs: string): string => {
  return gobletJs.replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+\{[^}]*\};?/g, '');
};

const createSingleFileGobletHtml = (
  template: string,
  gobletJs: string,
  alignJs: string,
  numJs: string,
  inflateJs: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  if (diagnosticsEnabled) {
    gobletDebugLog('[webglExporter] Building single-file Goblet bundle', {
      templateLength: template.length,
      gobletRuntimeLength: gobletJs.length,
      inflateRuntimeLength: inflateJs.length,
      metadataLength: metadataJson.length
    });
    try {
      const metadata = JSON.parse(metadataJson) as {
        layers?: Array<{ id: string; assets?: { texture?: string } }>;
        l?: Array<{ i?: string; as?: { txr?: string } }>;
      };
      const layersRaw = Array.isArray(metadata.layers)
        ? metadata.layers
        : Array.isArray(metadata.l)
          ? metadata.l.map((layer) => ({
              id: (layer as { id?: string; i?: string }).id ?? (layer as { i?: string }).i ?? 'unknown',
              assets: layer.as?.txr ? { texture: layer.as.txr } : undefined
            }))
          : [];
      gobletDebugLog('[webglExporter] Metadata summary', {
        layerCount: layersRaw.length,
        textures: layersRaw
          .filter((layer) => typeof layer?.assets?.texture === 'string')
          .slice(0, 8)
          .map((layer) => ({ id: layer.id, texturePreview: layer.assets!.texture!.slice(0, 48) }))
      });
    } catch (error) {
      gobletDebugWarn('[webglExporter] Failed to parse metadata JSON for diagnostics', error);
    }
  }

  const runtime = stripGobletExports(gobletJs);
  return transformModuleScript(template, (script) =>
    buildSingleFileScript(script, runtime, alignJs, numJs, inflateJs, metadataJson, diagnosticsEnabled)
  );
};

const createSingleFileGobletHtmlFromBundledRuntime = (
  template: string,
  bundledRuntime: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  return transformModuleScript(template, (script) =>
    buildSingleFileScriptFromBundledRuntime(script, bundledRuntime, metadataJson, diagnosticsEnabled)
  );
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

  try {
    const resolvedHtmlTitle = sanitizeHtmlTitle(options.htmlTitle ?? DEFAULT_HTML_TITLE);

  const metricsMap = new Map<string, LayerExportMetrics>();
  options.layers.forEach((layer) => {
    try {
      metricsMap.set(layer.id, computeLayerExportMetrics(layer, options.project));
    } catch (error) {
      console.warn('[webglExporter] Failed to compute export metrics for layer', layer.id, error);
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

  const metadataLayers: WebGLLayerMetadata[] = [];
  const layoutInputs: LayoutLayerInput[] = [];
  const documentSize = {
    width: options.project.width,
    height: options.project.height
  };

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

    let texture = await captureLayerTexture(layer);
    const colorCycleResult = await serializeColorCycleData(layer, options.project);
    const colorCycle = colorCycleResult?.colorCycle;
    const colorCycleRuntime = colorCycleResult?.runtime;
    const brushRuntime = colorCycleRuntime?.brushState;

    if (brushRuntime) {
      surfaceSize.width = Math.max(surfaceSize.width, Math.max(1, brushRuntime.width));
      surfaceSize.height = Math.max(surfaceSize.height, Math.max(1, brushRuntime.height));
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
      layer.alignment?.positioning === 'auto' ? 'auto' : 'anchor';

    const offsetPercent: LayerAlignmentSettings['offsetPercent'] | undefined =
      positioning === 'anchor'
        ? undefined
        : normalizedAlignment.offsetPercent
            ? { x: normalizedAlignment.offsetPercent.x, y: normalizedAlignment.offsetPercent.y }
            : undefined;

    const alignmentPayload: AlignmentExportPayload = {
      fit: normalizedAlignment.fit as AlignmentExportPayload['fit'],
      horizontal: normalizedAlignment.horizontal ?? 'left',
      vertical: normalizedAlignment.vertical ?? 'top',
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

    const surfaceBounds = colorCycle?.coverageBoundsSourcePx
      ? clampBoundsToSurface(colorCycle.coverageBoundsSourcePx, surfaceSize)
      : metrics.contentBounds;

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

    const baseLayerMetadata: WebGLLayerMetadata = {
      id: layer.id,
      name: layer.name,
      type: layer.layerType,
      visible: layer.visible !== false,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      source: {
        width: Math.max(1, Math.round(surfaceSize.width)),
        height: Math.max(1, Math.round(surfaceSize.height))
      },
      pixelBoundsPx: contentBoundsPayload,
      documentBoundsPx: {
        x: round3(documentBoundsPx.x),
        y: round3(documentBoundsPx.y),
        width: round3(documentBoundsPx.width),
        height: round3(documentBoundsPx.height)
      },
      documentBoundsPercent: {
        x: round3(documentBoundsPercent.x),
        y: round3(documentBoundsPercent.y),
        width: round3(documentBoundsPercent.width),
        height: round3(documentBoundsPercent.height)
      },
      alignment: alignmentPayload,
      contentBounds: contentBoundsPayload,
      paintedSize: {
        width: contentBoundsPayload.width,
        height: contentBoundsPayload.height
      },
      assets: texture ? { texture } : undefined,
      colorCycle,
      stackIndex: Number.isFinite(layer.order) ? layer.order : index,
      version: layer.version
    };

    metadataLayers.push(stripLayerDefaults(baseLayerMetadata));
  }

  let placementByLayerId: Map<string, ResolvedLayerLayout> | null = null;
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

  let fallback: WebGLExportMetadata['fallback'];
  if (options.embedCanvasFallback && typeof document !== 'undefined' && options.compositeLayersToCanvas) {
    try {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = Math.max(1, options.project.width);
      fallbackCanvas.height = Math.max(1, options.project.height);
      options.compositeLayersToCanvas(fallbackCanvas);
      const { dataUrl, format } = await canvasToDataURL(fallbackCanvas);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error(`[webglExporter] Invalid data URL generated for ${format} fallback`);
      } else {
        fallback = {
          type: format,
          dataUrl: normalized
        };
      }
    } catch (error) {
      console.warn('[webglExporter] Failed to capture Canvas2D fallback', error);
    }
  }

  const bundleFormat: WebGLExportBundleFormat = options.bundleFormat ?? 'zip';

  const metadata: WebGLExportMetadata = {
    format: 'vessel-goblet',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: options.project.id,
      name: options.project.name,
      width: options.project.width,
      height: options.project.height,
      backgroundColor: options.project.backgroundColor
    },
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
      perfectLoop: options.perfectLoop,
      bundleFormat,
      htmlTitle: resolvedHtmlTitle
    },
    layers: metadataLayers
  };

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
    indexHtml = await fetchGobletAsset('index.html', options.assetPrefix);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet template: ${message}`);
  }
  const indexHtmlWithTitle = applyHtmlTitleToTemplate(indexHtml, resolvedHtmlTitle);

  let baseRuntimeAssetsPromise: Promise<[string, string, string, string]> | null = null;
  const ensureBaseRuntimeAssets = () => {
    if (!baseRuntimeAssetsPromise) {
      baseRuntimeAssetsPromise = Promise.all([
        fetchGobletAsset('goblet.js', options.assetPrefix),
        fetchGobletAsset('alignFitResolver.js', options.assetPrefix),
        fetchGobletAsset('num.js', options.assetPrefix),
        fetchGobletAsset('fflate-inflate.js', options.assetPrefix)
      ]);
    }
    return baseRuntimeAssetsPromise;
  };

  const loadBundledRuntime = async (): Promise<string | null> => {
    try {
      return await fetchGobletAsset('goblet-inline.js', options.assetPrefix);
    } catch (error) {
      gobletDebugWarn('[webglExporter] Failed to load prebundled Goblet runtime, using legacy inline path', error);
      return null;
    }
  };

  if (bundleFormat === 'single-html') {
    const bundledRuntime = await loadBundledRuntime();
    if (bundledRuntime) {
      const singleFileHtml = createSingleFileGobletHtmlFromBundledRuntime(
        indexHtmlWithTitle,
        bundledRuntime,
        json,
        diagnosticsEnabled
      );
      const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
      downloadBlob(htmlBlob, `${options.filenameBase}-goblet.html`);
      return metadata;
    }

    let gobletJs: string;
    let alignJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const singleFileHtml = createSingleFileGobletHtml(
      indexHtmlWithTitle,
      gobletJs,
      alignJs,
      numJs,
      inflateJs,
      json,
      diagnosticsEnabled
    );
    const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
    downloadBlob(htmlBlob, `${options.filenameBase}-goblet.html`);
    return metadata;
  }

  if (bundleFormat === 'zip') {
    let gobletJs: string;
    let alignJs: string;
    let numJs: string;
    let inflateJs: string;
    try {
      [gobletJs, alignJs, numJs, inflateJs] = await ensureBaseRuntimeAssets();
    } catch (error) {
      baseRuntimeAssetsPromise = null;
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      throw new Error(`[webglExporter] Failed to load Goblet assets: ${message}`);
    }

    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('index.html', createZipGobletHtml(indexHtmlWithTitle, jsonFilename, json, diagnosticsEnabled));
    zip.file('goblet.js', gobletJs);
    zip.file('alignFitResolver.js', alignJs);
    zip.file('num.js', numJs);
    zip.file('fflate-inflate.js', inflateJs);
    zip.file(jsonFilename, json);
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: options.minify ? 9 : 6
      }
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
  }
};
