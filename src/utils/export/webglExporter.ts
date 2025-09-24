import { cloneExportLayout, cloneLayerAlignment } from '@/utils/layoutDefaults';
import { resolveContainerLayout, type LayerTransform, type ResolvedLayerLayout } from '@/utils/layerAlignment';
import { computeContentBoundsFromImageData } from '@/utils/imageBounds';
import type { ContentBounds, ExportContainerLayout, Layer, Project, WebGLExportBundleFormat } from '@/types';
import { packArrayToB64Z } from '@/utils/export/b64z';

const viewerDiagnosticsDefault =
  process.env.NEXT_PUBLIC_TINYBRUSH_VIEWER_DEBUG === 'true'
  || process.env.NODE_ENV !== 'production';

let viewerDiagnosticsActive = viewerDiagnosticsDefault;

const viewerDebugLog = (...args: Array<unknown>) => {
  if (viewerDiagnosticsActive) {
    console.log(...args);
  }
};

const viewerDebugWarn = (...args: Array<unknown>) => {
  if (viewerDiagnosticsActive) {
    console.warn(...args);
  }
};

type JSZipConstructor = any;

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

interface WebGLViewport {
  width: number;
  height: number;
}

interface WebGLLayerAsset {
  texture?: string;
}

interface LayerExportMetrics {
  surfaceSize: { width: number; height: number };
  contentBounds: ContentBounds;
}

type CanvasExportMimeType = 'image/avif' | 'image/webp' | 'image/png';

type SerializedGradientStops = Array<{ position: number; color: string }>;

interface CanvasExportFormatOption {
  type: CanvasExportMimeType;
  quality?: number;
}

const CANVAS_EXPORT_FORMATS: readonly CanvasExportFormatOption[] = [
  { type: 'image/avif', quality: 0.6 },
  { type: 'image/webp', quality: 0.75 },
  { type: 'image/png' }
];

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
  alignment: 'al',
  frame: 'fr',
  transform: 'tr',
  sourceSize: 'ss',
  contentBounds: 'cb',
  assets: 'as',
  colorCycle: 'cc',
  stackIndex: 'si',
  width: 'w',
  height: 'h',
  x: 'x',
  y: 'y',
  translateX: 'tx',
  translateY: 'ty',
  scaleX: 'sx',
  scaleY: 'sy',
  texture: 'txr',
  mode: 'md',
  isAnimating: 'ia',
  brushState: 'bs',
  gradientStops: 'gs',
  indexBuffer: 'ib',
  palette: 'pl',
  animationOffset: 'ao',
  targetFPS: 'tf',
  flowDirection: 'fd',
  recolorSettings: 'rs',
  gradient: 'gr',
  gradientRef: 'grf',
  brushSpeed: 'spd',
  bundleFormat: 'bf',
  includeHiddenLayers: 'ihl',
  embedCanvasFallback: 'ecf',
  minifyOutput: 'mo',
  perfectLoop: 'plp',
  fps: 'fps',
  totalFrames: 'tfm',
  durationSeconds: 'ds',
  phaseMap: 'pm'
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

interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: number[] | string;
  gradientStops: SerializedGradientStops;
  palette?: Array<string | number>;
  animationOffset: number;
  targetFPS?: number;
  flowDirection?: 'forward' | 'reverse';
}

interface WebGLSerializedColorCycle {
  mode: NonNullable<Layer['colorCycleData']>['mode'] | 'brush';
  gradient?: SerializedGradientStops;
  gradientRef?: number;
  brushSpeed?: number | null;
  isAnimating: boolean;
  recolorSettings?: Record<string, unknown>;
  brushState?: WebGLSerializedBrushState;
}

export interface WebGLLayerMetadata {
  id: string;
  name: string;
  type: Layer['layerType'];
  visible?: boolean;
  opacity?: number;
  blendMode?: Layer['blendMode'];
  alignment?: Layer['alignment'];
  frame: ResolvedLayerLayout['frame'];
  transform?: Partial<LayerTransform>;
  sourceSize: { width: number; height: number };
  contentBounds?: ContentBounds;
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
  format: 'tinybrush-webgl';
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
  viewport: WebGLViewport;
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
  includeHiddenLayers: boolean;
  embedCanvasFallback: boolean;
  minify: boolean;
  filenameBase: string;
  bundleFormat?: WebGLExportBundleFormat;
  enableViewerDiagnostics?: boolean;
  assetPrefix?: string;
  compositeLayersToCanvas?: (targetCanvas: HTMLCanvasElement) => void;
}

const isHTMLCanvas = (canvas: unknown): canvas is HTMLCanvasElement => {
  return typeof window !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && canvas instanceof HTMLCanvasElement;
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

const normalizeBrushFlowDirection = (direction: unknown): 'forward' | 'reverse' | undefined => {
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

  return undefined;
};

const DEFAULT_LAYER_OPACITY = 1;
const DEFAULT_LAYER_VISIBILITY = true;
const DEFAULT_BLEND_MODES = new Set<Layer['blendMode'] | 'normal'>(['source-over', 'normal']);

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

const stripLayerDefaults = (layer: WebGLLayerMetadata): WebGLLayerMetadata => {
  const stripped: WebGLLayerMetadata = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    frame: layer.frame,
    sourceSize: layer.sourceSize
  };

  if (layer.alignment) {
    stripped.alignment = layer.alignment;
  }

  if (layer.contentBounds) {
    const bounds = layer.contentBounds;
    const source = layer.sourceSize;
    const matchesSurface = bounds.x === 0
      && bounds.y === 0
      && bounds.width === source.width
      && bounds.height === source.height;
    if (!matchesSurface) {
      stripped.contentBounds = bounds;
    }
  }

  if (layer.visible === false && DEFAULT_LAYER_VISIBILITY) {
    stripped.visible = false;
  }

  if (typeof layer.opacity === 'number' && layer.opacity !== DEFAULT_LAYER_OPACITY) {
    stripped.opacity = layer.opacity;
  }

  const blendMode = layer.blendMode;
  if (blendMode && !DEFAULT_BLEND_MODES.has(blendMode)) {
    stripped.blendMode = blendMode;
  }

  if (layer.transform) {
    const trimmedTransform: Partial<LayerTransform> = {};
    if (layer.transform.translateX !== 0) {
      trimmedTransform.translateX = layer.transform.translateX;
    }
    if (layer.transform.translateY !== 0) {
      trimmedTransform.translateY = layer.transform.translateY;
    }
    if (layer.transform.scaleX !== 1) {
      trimmedTransform.scaleX = layer.transform.scaleX;
    }
    if (layer.transform.scaleY !== 1) {
      trimmedTransform.scaleY = layer.transform.scaleY;
    }
    if (Object.keys(trimmedTransform).length > 0) {
      stripped.transform = trimmedTransform;
    }
  }

  if (layer.assets && Object.keys(layer.assets).length > 0) {
    stripped.assets = layer.assets;
  }

  if (layer.colorCycle) {
    stripped.colorCycle = layer.colorCycle;
  }

  if (typeof layer.stackIndex === 'number') {
    stripped.stackIndex = layer.stackIndex;
  }

  if (layer.version !== undefined) {
    stripped.version = layer.version;
  }

  return stripped;
};

const detectFlowDirectionFromAnimator = (animator: unknown): 'forward' | 'reverse' | undefined => {
  if (!animator || typeof animator !== 'object') {
    return undefined;
  }

  const animatorAny = animator as {
    getFlowDirection?: () => unknown;
    flowDirection?: unknown;
    animationController?: {
      getDirection?: () => unknown;
      flowDirection?: unknown;
    };
  };

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

  const direct = normalizeBrushFlowDirection(animatorAny.flowDirection);
  if (direct) {
    return direct;
  }

  const controller = animatorAny.animationController;
  if (controller) {
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

    const controllerDirect = normalizeBrushFlowDirection(controller.flowDirection);
    if (controllerDirect) {
      return controllerDirect;
    }
  }

  return undefined;
};

const detectBrushFlowDirection = (brush: unknown, layerId: string): 'forward' | 'reverse' | undefined => {
  if (!brush || typeof brush !== 'object') {
    return undefined;
  }

  const brushAny = brush as {
    flowDirection?: unknown;
    getFlowDirection?: () => unknown;
    animators?: Map<string, unknown> | {
      get?: (key: string) => unknown;
      size?: number;
      values?: () => Iterable<unknown>;
    };
  };

  const direct = normalizeBrushFlowDirection(brushAny.flowDirection);
  if (direct) {
    return direct;
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

const getCanvasDimensions = (canvas: HTMLCanvasElement | OffscreenCanvas | undefined | null) => {
  if (!canvas) {
    return null;
  }
  const width = 'width' in canvas ? (canvas.width ?? 0) : 0;
  const height = 'height' in canvas ? (canvas.height ?? 0) : 0;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height))
  };
};

const getLayerSurfaceSize = (layer: Layer, project: Project) => {
  const framebufferDims = getCanvasDimensions(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | null);
  if (framebufferDims) {
    return framebufferDims;
  }
  if (layer.imageData) {
    return {
      width: Math.max(1, layer.imageData.width),
      height: Math.max(1, layer.imageData.height)
    };
  }
  const colorCycleCanvas = getCanvasDimensions(layer.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | null);
  if (colorCycleCanvas) {
    return colorCycleCanvas;
  }
  return {
    width: Math.max(1, project.width),
    height: Math.max(1, project.height)
  };
};

const normalizeContentBounds = (
  bounds: ContentBounds | null,
  surface: { width: number; height: number }
): ContentBounds => {
  const defaultBounds: ContentBounds = {
    x: 0,
    y: 0,
    width: Math.max(1, surface.width),
    height: Math.max(1, surface.height)
  };

  if (!bounds) {
    return defaultBounds;
  }

  const clampedX = Math.max(0, Math.min(Math.floor(bounds.x), Math.max(0, surface.width - 1)));
  const clampedY = Math.max(0, Math.min(Math.floor(bounds.y), Math.max(0, surface.height - 1)));
  const maxWidth = Math.max(1, surface.width - clampedX);
  const maxHeight = Math.max(1, surface.height - clampedY);
  const width = Math.min(Math.max(1, Math.floor(bounds.width)), maxWidth);
  const height = Math.min(Math.max(1, Math.floor(bounds.height)), maxHeight);

  return {
    x: clampedX,
    y: clampedY,
    width,
    height
  };
};

const computeCanvasContentBounds = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null
): ContentBounds | null => {
  if (!canvas) {
    return null;
  }

  const dimensions = getCanvasDimensions(canvas);
  if (!dimensions) {
    return null;
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true } as CanvasRenderingContext2DSettings);
    if (!ctx) {
      return null;
    }
    const imageData = ctx.getImageData(0, 0, dimensions.width, dimensions.height);
    return computeContentBoundsFromImageData(imageData);
  } catch (error) {
    console.warn('[webglExporter] Failed to compute canvas content bounds', error);
    return null;
  }
};

const computeLayerExportMetrics = (layer: Layer, project: Project): LayerExportMetrics => {
  const surfaceSize = getLayerSurfaceSize(layer, project);

  let bounds: ContentBounds | null = null;

  if (layer.imageData) {
    try {
      bounds = computeContentBoundsFromImageData(layer.imageData);
    } catch (error) {
      console.warn('[webglExporter] Failed to compute bounds from layer.imageData', error);
    }
  }

  if (!bounds) {
    bounds = computeCanvasContentBounds(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | null);
  }

  if (!bounds && layer.colorCycleData?.canvas) {
    bounds = computeCanvasContentBounds(layer.colorCycleData.canvas as HTMLCanvasElement | OffscreenCanvas | null);
  }

  const normalizedBounds = normalizeContentBounds(bounds, surfaceSize);

  return {
    surfaceSize,
    contentBounds: normalizedBounds
  };
};

const clampFrameToViewport = (
  frame: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
) => {
  const viewportWidth = Math.max(1, Math.round(viewport.width));
  const viewportHeight = Math.max(1, Math.round(viewport.height));
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, viewportHeight - height);
  const clampedX = Math.min(Math.max(Math.round(frame.x), 0), maxX);
  const clampedY = Math.min(Math.max(Math.round(frame.y), 0), maxY);
  return {
    x: clampedX,
    y: clampedY,
    width,
    height
  };
};

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

  if (viewerDiagnosticsActive) {
    viewerDebugLog('[webglExporter] Created brush state from direct properties', {
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

  let animator = animators.get(layer.id);
  if (!animator && animators.size === 1) {
    animator = Array.from(animators.values())[0];
  }
  if (!animator) {
    return undefined;
  }

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

    const paletteValues = indexBuffer.palette ? toSerializablePaletteArray(indexBuffer.palette) : undefined;
    const palette = paletteValues && paletteValues.length > 0 ? paletteValues : undefined;

    if (viewerDiagnosticsActive) {
      viewerDebugLog('[webglExporter] Animator-derived index buffer', {
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

    if (viewerDiagnosticsActive) {
      viewerDebugLog('[webglExporter] Brush state extracted from animator fallback', {
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

const serializeBrushState = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const brush = layer.colorCycleData?.colorCycleBrush as { serialize?: () => unknown } | undefined;

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

    if (raw?.layers && raw.layers.length > 0) {
      const entry = raw.layers.find((candidate) => candidate?.layerId === layer.id);

      if (entry) {
        const indexBuffer = entry.data?.indexBuffer;
        if (indexBuffer) {
          const ib = indexBuffer;
          const widthRaw = Number(ib.width);
          const heightRaw = Number(ib.height);
          const fallbackWidth = layer.imageData?.width ?? layer.colorCycleData?.canvas?.width ?? 1;
          const fallbackHeight = layer.imageData?.height ?? layer.colorCycleData?.canvas?.height ?? 1;

          if (ib.data) {
            if (viewerDiagnosticsActive) {
              const dataType = (ib.data as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
              const sample = (() => {
                try {
                  const arrayLike = ib.data as ArrayLike<number>;
                  return Array.prototype.slice.call(arrayLike, 0, 16);
                } catch {
                  return 'unavailable';
                }
              })();
              viewerDebugLog('[webglExporter] Brush serialize() indexBuffer payload', {
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

            if (viewerDiagnosticsActive) {
              const totalLength = indexArray.length;
              const uniqueValues = new Set(indexArray);
              const firstNonZeroIndex = indexArray.findIndex((value) => value !== 0);
              viewerDebugLog('[webglExporter] Brush serialize() index analysis', {
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

            if (viewerDiagnosticsActive) {
              viewerDebugLog('[webglExporter] Brush serialize() final state', {
                layerId: layer.id,
                width,
                height,
                indices: indexArray.length,
                gradientStops: gradientStops.length,
                paletteSize: palette?.length ?? null,
                targetFPS
              });
            }

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
    return propertyState;
  }

  const animatorState = extractBrushStateFromAnimator(brush, layer);
  if (animatorState) {
    return animatorState;
  }

  return undefined;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const hasNonZeroMagnitude = (value: unknown): boolean => {
  const numeric = toFiniteNumber(value);
  return numeric !== null && Math.abs(numeric) > 0;
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

const serializeColorCycleData = async (layer: Layer): Promise<WebGLSerializedColorCycle | undefined> => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }

  const shouldAnimate = shouldExportLayerAsAnimating(layer);
  const serialized: WebGLSerializedColorCycle = {
    mode: data.mode ?? 'brush',
    gradient: data.gradient,
    brushSpeed: data.brushSpeed ?? null,
    isAnimating: shouldAnimate
  };

  if (viewerDiagnosticsActive) {
    viewerDebugLog('[webglExporter] Animation inference for layer', layer.id, {
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

  if (!data.recolorSettings) {
    const brushState = serializeBrushState(layer);
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
      if (viewerDiagnosticsActive) {
        const summary = summarizeEncodedBuffer(preparedBrushState.indexBuffer, Array.isArray(brushState.indexBuffer) ? brushState.indexBuffer.length : 0);
        viewerDebugLog('[webglExporter] Brush state included for layer via serialize()', {
          layerId: layer.id,
          width: preparedBrushState.width,
          height: preparedBrushState.height,
          indices: summary.length,
          encoding: summary.encoding,
          paletteSize: preparedBrushState.palette?.length ?? null,
          sample: summary.preview
        });
      }
    } else {
      console.warn('[webglExporter] No brush state could be extracted for layer', layer.id);
    }
  }

  if (viewerDiagnosticsActive) {
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

    viewerDebugLog('[webglExporter] Serialized color cycle layer', layer.id, {
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

  return serialized;
};

const captureLayerTexture = async (layer: Layer): Promise<string | undefined> => {
  try {
    if (layer.framebuffer) {
      const { dataUrl } = await canvasToDataURL(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from framebuffer for layer', layer.id);
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
    if (layer.colorCycleData?.canvas) {
      const { dataUrl } = await canvasToDataURL(layer.colorCycleData.canvas as HTMLCanvasElement | OffscreenCanvas);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from color cycle canvas for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    return undefined;
  } catch (error) {
    console.warn('[webglExporter] Failed to capture texture for layer', layer.id, error);
    return undefined;
  }
};

const collectLayout = (
  layers: Layer[],
  metricsMap: Map<string, LayerExportMetrics>,
  layout: ExportContainerLayout,
  viewport: WebGLViewport,
  includeHiddenLayers: boolean
) => {
  const inputs = layers
    .filter((layer) => includeHiddenLayers || layer.visible)
    .map((layer) => {
      const metrics = metricsMap.get(layer.id);
      if (!metrics) {
        throw new Error(`[webglExporter] Missing layout metrics for layer ${layer.id}`);
      }
      return {
        layerId: layer.id,
        surface: {
          width: Math.max(1, Math.round(metrics.surfaceSize.width)),
          height: Math.max(1, Math.round(metrics.surfaceSize.height))
        },
        content: {
          width: Math.max(1, Math.round(metrics.contentBounds.width)),
          height: Math.max(1, Math.round(metrics.contentBounds.height))
        },
        alignment: layer.alignment,
        hidden: false
      };
    });

  return resolveContainerLayout(inputs, layout, viewport);
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

type ViewerAssetName = 'index.html' | 'viewer.js' | 'fflate-inflate.js';

const viewerAssetCache = new Map<string, Promise<string>>();

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

const resolveViewerAssetUrl = (asset: ViewerAssetName, assetPrefix?: string): string => {
  const prefix = assetPrefix ?? getDefaultAssetPrefix();
  const normalizedAsset = asset.startsWith('/') ? asset.slice(1) : asset;
  const assetPath = `export-viewer/${normalizedAsset}`;

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

const fetchViewerAsset = (asset: ViewerAssetName, assetPrefix?: string): Promise<string> => {
  const cacheKey = `${assetPrefix ?? '__default__'}::${asset}`;
  const cached = viewerAssetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const url = resolveViewerAssetUrl(asset, assetPrefix);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load viewer asset ${asset} from ${url} (${response.status})`);
    }
    return await response.text();
  })();

  viewerAssetCache.set(cacheKey, promise);
  return promise;
};

const transformModuleScript = (html: string, transform: (scriptContent: string) => string): string => {
  const scriptOpen = '<script type="module">';
  const scriptStart = html.indexOf(scriptOpen);
  if (scriptStart === -1) {
    throw new Error('Viewer template missing module script tag');
  }
  const contentStart = scriptStart + scriptOpen.length;
  const scriptEnd = html.indexOf('</script>', contentStart);
  if (scriptEnd === -1) {
    throw new Error('Viewer template missing module script closing tag');
  }

  const originalContent = html.slice(contentStart, scriptEnd);
  const nextContent = transform(originalContent);
  return `${html.slice(0, contentStart)}${nextContent}${html.slice(scriptEnd)}`;
};

const encodeMetadataForInlineScript = (metadataJson: string): string => {
  return metadataJson
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
};

const stripViewerImport = (content: string): string => {
  return content.replace(/\s*import\s+\{[\s\S]*?\}\s+from\s+'\.\/viewer\.js';?\s*/g, '\n');
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
            if (window.__TINYBRUSH_VIEWER_DEBUG__ === true) {
              enableDiagnostics = true;
            } else if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              enableDiagnostics = true;
            } else if (window.localStorage && window.localStorage.getItem('tinybrushViewerDebug') === 'true') {
              enableDiagnostics = true;
            }
          }
        } catch {
          // ignore resolution errors (e.g., file:// without localStorage)
        }
      }
      if (typeof window !== 'undefined') {
        window.__TINYBRUSH_VIEWER_DEBUG__ = enableDiagnostics;
        window.tinybrushViewerSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('tinybrushViewerDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__TINYBRUSH_VIEWER_DEBUG__ = enableDiagnostics;
            }
          : () => {
              console.warn('Viewer diagnostics are disabled in this build.');
            };
      }
      const emitLog = enableDiagnostics
        ? (...args) => {
            console.log('[TinyBrush Viewer]', ...args);
          }
        : () => {};
      const emitWarn = enableDiagnostics
        ? (...args) => {
            console.warn('[TinyBrush Viewer]', ...args);
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandTinyBrushMetadata === 'function') {
          try {
            return expandTinyBrushMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandTinyBrushMetadata === 'function') {
          try {
            return window.expandTinyBrushMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via viewer helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = JSON.parse(\`${metadataLiteral}\`);
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
        const normalizedMetadata = expandPackagedMetadata(metadata);
        setStatus('Rendering packaged bundle…');
        emitLog('Loaded metadata for auto-render:', normalizedMetadata);
        emitLog('Canvas element reference:', canvas);
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Preview canvas element is unavailable');
        }
        const scale = computeScale(normalizedMetadata);
        const renderResult = await renderTinyBrushWebGL(normalizedMetadata, canvas, { scale });
        summarizeMetadata(normalizedMetadata, renderResult);
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
          setStatus('Viewer ready. Drop a bundle to preview.');
        }
      };
      void autoLoadPackagedBundle();
`;
  return `${scriptContent}${snippet}`;
};

const buildInlineInflateRuntime = (inflateJs: string): string => {
  let sanitized = inflateJs
    .replace(/export\s+default\s+inflateRaw;?/g, '')
    .replace(/export\s+\{\s*inflateRaw\s*\};?/g, '')
    .replace(/export\s+const\s+inflateRaw\s*=/g, 'const inflateRaw =');
  sanitized = sanitized.trimEnd();
  return `const inflateRaw = (() => {\n${sanitized}\nreturn inflateRaw;\n})();`;
};

const buildSingleFileScript = (
  scriptContent: string,
  viewerRuntime: string,
  inflateRuntime: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const withoutImport = stripViewerImport(scriptContent);
  const runtimeWithoutInflateImport = viewerRuntime.replace(/\s*import\s+\{\s*inflateRaw\s*\}\s+from\s+'\.\/fflate-inflate\.js';?\s*/, '\n');
  const inlineInflate = buildInlineInflateRuntime(inflateRuntime);
  const runtime = `\n${inlineInflate}\n${runtimeWithoutInflateImport}\n`;
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const diagnosticsLiteral = diagnosticsEnabled ? 'true' : 'false';
  const snippet = `
      const diagnosticsDefault = ${diagnosticsLiteral};
      const resolveDiagnostics = () => {
        if (!diagnosticsDefault) {
          return false;
        }
        try {
          if (typeof window !== 'undefined') {
            if (window.__TINYBRUSH_VIEWER_DEBUG__ === true) {
              return true;
            }
            if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              return true;
            }
            if (window.localStorage && window.localStorage.getItem('tinybrushViewerDebug') === 'true') {
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
        window.__TINYBRUSH_VIEWER_DEBUG__ = enableDiagnostics;
        window.tinybrushViewerSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('tinybrushViewerDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__TINYBRUSH_VIEWER_DEBUG__ = enableDiagnostics;
            }
          : () => {
              console.warn('Viewer diagnostics are disabled in this build.');
            };
      }
      const emitLog = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              console.log('[TinyBrush Viewer]', ...args);
            }
          }
        : () => {};
      const emitWarn = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              console.warn('[TinyBrush Viewer]', ...args);
            }
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandTinyBrushMetadata === 'function') {
          try {
            return expandTinyBrushMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandTinyBrushMetadata === 'function') {
          try {
            return window.expandTinyBrushMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via viewer helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = JSON.parse(\`${metadataLiteral}\`);
      const packagedMetadata = expandPackagedMetadata(packagedMetadataRaw);
      if (enableDiagnostics) {
        emitLog('[DEBUG] Prepared packaged metadata for single-file viewer', {
          layerCount: packagedMetadata.layers?.length ?? 0,
          hasFallback: Boolean(packagedMetadata.fallback)
        });
      }
      const renderPackagedBundle = async () => {
        try {
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Preview canvas element is unavailable');
          }
          setStatus('Rendering packaged bundle…');
          const scale = computeScale(packagedMetadata);
          const renderResult = await renderTinyBrushWebGL(packagedMetadata, canvas, { scale });
          summarizeMetadata(packagedMetadata, renderResult);
          if (enableDiagnostics) {
            emitLog('Single-file viewer render summary:', {
              scale,
              layers: packagedMetadata.layers?.length ?? 0
            });
          }
          setStatus('Packaged bundle rendered.');
        } catch (error) {
          emitWarn('Failed to render packaged bundle', error);
          setStatus(error instanceof Error ? error.message : 'Failed to render bundle', 'error');
        }
      };
      void renderPackagedBundle();
`;
  return `${runtime}${withoutImport}${snippet}`;
};

const createZipViewerHtml = (
  template: string,
  bundleFilename: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  return transformModuleScript(template, (script) => appendZipAutoloadSnippet(script, bundleFilename, metadataJson, diagnosticsEnabled));
};

const stripViewerExports = (viewerJs: string): string => {
  return viewerJs.replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+\{[^}]*\};?/g, '');
};

const createSingleFileViewerHtml = (
  template: string,
  viewerJs: string,
  inflateJs: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  if (diagnosticsEnabled) {
    viewerDebugLog('[webglExporter] Building single-file viewer', {
      templateLength: template.length,
      viewerRuntimeLength: viewerJs.length,
      inflateRuntimeLength: inflateJs.length,
      metadataLength: metadataJson.length
    });
    try {
      const metadata = JSON.parse(metadataJson) as { layers?: Array<{ id: string; assets?: { texture?: string } }> };
      const layers = Array.isArray(metadata.layers) ? metadata.layers : [];
      viewerDebugLog('[webglExporter] Metadata summary', {
        layerCount: layers.length,
        textures: layers
          .filter((layer) => typeof layer?.assets?.texture === 'string')
          .slice(0, 8)
          .map((layer) => ({ id: layer.id, texturePreview: layer.assets!.texture!.slice(0, 48) }))
      });
    } catch (error) {
      viewerDebugWarn('[webglExporter] Failed to parse metadata JSON for diagnostics', error);
    }
  }

  const runtime = stripViewerExports(viewerJs);
  return transformModuleScript(template, (script) => buildSingleFileScript(script, runtime, inflateJs, metadataJson, diagnosticsEnabled));
};

export const exportProjectAsWebGL = async (
  options: WebGLExportRequest
): Promise<WebGLExportMetadata> => {
  if (typeof window === 'undefined') {
    throw new Error('WebGL export is only available in the browser');
  }

  const diagnosticsEnabled = options.enableViewerDiagnostics ?? viewerDiagnosticsDefault;
  const previousDiagnostics = viewerDiagnosticsActive;
  viewerDiagnosticsActive = diagnosticsEnabled;

  try {

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
  const placements = collectLayout(
    options.layers,
    metricsMap,
    containerLayout,
    options.viewport,
    options.includeHiddenLayers
  );

  const placementMap = new Map<string, ResolvedLayerLayout>();
  placements.forEach((placement) => placementMap.set(placement.layerId, placement));

  const metadataLayers: WebGLLayerMetadata[] = [];
  for (const layer of options.layers) {
    if (!options.includeHiddenLayers && !layer.visible) {
      continue;
    }
    const placement = placementMap.get(layer.id);
    if (!placement) {
      continue;
    }

    const metrics = metricsMap.get(layer.id) ?? computeLayerExportMetrics(layer, options.project);
    const sourceSize = metrics.surfaceSize;
    const contentBounds = metrics.contentBounds;
    const texture = await captureLayerTexture(layer);

    const colorCycle = await serializeColorCycleData(layer);

    const clampedFrame = clampFrameToViewport(placement.frame, options.viewport);
    if (clampedFrame.x !== Math.round(placement.frame.x)
      || clampedFrame.y !== Math.round(placement.frame.y)) {
      console.warn('[webglExporter] Layer frame clamped to viewport bounds', {
        layerId: layer.id,
        originalFrame: placement.frame,
        clampedFrame,
        viewport: options.viewport
      });
    }

    const baseLayerMetadata: WebGLLayerMetadata = {
      id: layer.id,
      name: layer.name,
      type: layer.layerType,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      alignment: cloneLayerAlignment(layer.alignment),
      frame: clampedFrame,
      transform: placement.transform,
      sourceSize,
      contentBounds,
      assets: texture ? { texture } : undefined,
      colorCycle,
      stackIndex: Number.isFinite(layer.order) ? layer.order : metadataLayers.length,
      version: layer.version
    };

    metadataLayers.push(stripLayerDefaults(baseLayerMetadata));
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
    format: 'tinybrush-webgl',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: options.project.id,
      name: options.project.name,
      width: options.project.width,
      height: options.project.height,
      backgroundColor: options.project.backgroundColor
    },
    viewport: { ...options.viewport },
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
      bundleFormat
    },
    layers: metadataLayers
  };

  if (fallback) {
    metadata.fallback = fallback;
  }

  deduplicateGradients(metadata);

  if (viewerDiagnosticsActive) {
    metadata.layers.forEach((layer, index) => {
      const brushPayload = layer.colorCycle?.brushState?.indexBuffer;
      const brushStateSummary = summarizeEncodedBuffer(
        Array.isArray(brushPayload) || typeof brushPayload === 'string' ? brushPayload : undefined,
        Array.isArray(brushPayload) ? brushPayload.length : 0
      );
      viewerDebugLog('[webglExporter] Layer export summary', {
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
  if (viewerDiagnosticsActive) {
    viewerDebugLog('[webglExporter] JSON size after stringify', {
      bytes: json.length,
      minified: options.minify
    });
  }
  const jsonFilename = `${options.filenameBase}-webgl.json`;

  if (bundleFormat === 'json') {
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, jsonFilename);
    return metadata;
  }

  let indexHtml: string;
  let viewerJs: string;
  let inflateJs: string;
  try {
    [indexHtml, viewerJs, inflateJs] = await Promise.all([
      fetchViewerAsset('index.html', options.assetPrefix),
      fetchViewerAsset('viewer.js', options.assetPrefix),
      fetchViewerAsset('fflate-inflate.js', options.assetPrefix)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    throw new Error(`[webglExporter] Failed to load viewer assets: ${message}`);
  }

  if (bundleFormat === 'single-html') {
    const singleFileHtml = createSingleFileViewerHtml(indexHtml, viewerJs, inflateJs, json, diagnosticsEnabled);
    const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
    downloadBlob(htmlBlob, `${options.filenameBase}-webgl.html`);
    return metadata;
  }

  if (bundleFormat === 'zip') {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('index.html', createZipViewerHtml(indexHtml, jsonFilename, json, diagnosticsEnabled));
    zip.file('viewer.js', viewerJs);
    zip.file('fflate-inflate.js', inflateJs);
    zip.file(jsonFilename, json);
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: options.minify ? 9 : 6
      }
    });
    downloadBlob(zipBlob, `${options.filenameBase}-webgl-viewer.zip`);
    return metadata;
  }

  // Fallback to raw JSON if an unknown bundle format is supplied.
  const fallbackBlob = new Blob([json], { type: 'application/json' });
  downloadBlob(fallbackBlob, jsonFilename);

  return metadata;
  } finally {
    viewerDiagnosticsActive = previousDiagnostics;
  }
};
