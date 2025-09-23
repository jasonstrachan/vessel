import { cloneExportLayout, cloneLayerAlignment } from '@/utils/layoutDefaults';
import {
  computeLayerTransform,
  type LayerTransform,
  type ResolvedLayerLayout
} from '@/utils/layerAlignment';
import type { ExportContainerLayout, Layer, Project, WebGLExportBundleFormat } from '@/types';

type JSZipModule = typeof import('jszip');

let jszipCtorPromise: Promise<JSZipModule> | null = null;

const loadJSZip = async (): Promise<JSZipModule> => {
  if (!jszipCtorPromise) {
    jszipCtorPromise = import('jszip').then((mod) => {
      const candidate = mod as { default?: JSZipModule };
      return candidate.default ?? (mod as JSZipModule);
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

interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: number[];
  gradientStops: Array<{ position: number; color: string }>;
  palette?: Array<string | number>;
  animationOffset: number;
  targetFPS?: number;
}

interface WebGLSerializedColorCycle {
  mode: NonNullable<Layer['colorCycleData']>['mode'] | 'brush';
  gradient?: Array<{ position: number; color: string }>;
  brushSpeed?: number | null;
  isAnimating: boolean;
  recolorSettings?: Record<string, unknown>;
  brushState?: WebGLSerializedBrushState;
}

type ExportableColorCycleBrush = {
  render?: () => void;
  renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  commitCurrentStroke?: (layerId?: string) => void;
  compositeCanvas?: HTMLCanvasElement | OffscreenCanvas;
  webglCanvas?: HTMLCanvasElement | OffscreenCanvas;
} | undefined;

export interface WebGLLayerMetadata {
  id: string;
  name: string;
  type: Layer['layerType'];
  visible: boolean;
  opacity: number;
  blendMode: Layer['blendMode'];
  stackIndex: number;
  alignment: Layer['alignment'];
  frame: ResolvedLayerLayout['frame'];
  transform: LayerTransform;
  sourceSize: { width: number; height: number };
  assets: WebGLLayerAsset;
  colorCycle?: WebGLSerializedColorCycle;
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
  fallback?: {
    type: 'image/png';
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

const canvasToDataURL = async (canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> => {
  if (isHTMLCanvas(canvas)) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) {
          reject(new Error('Failed to create PNG blob from canvas'));
          return;
        }
        resolve(b);
      }, 'image/png');
    });
    return blobToDataURL(blob);
  }

  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blobToDataURL(blob);
  }

  throw new Error('Unsupported canvas instance for export');
};

const imageDataToDataURL = (imageData: ImageData): string => {
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
  return canvas.toDataURL('image/png');
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
    const view = source as ArrayLike<number> & { length?: number };
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

    const brushState: WebGLSerializedBrushState = {
      width,
      height,
      indexBuffer: indexBufferData,
      gradientStops,
      palette,
      animationOffset,
      targetFPS
    };

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
            let indexArray: number[] = [];
            try {
              indexArray = Array.from(ib.data as ArrayLike<number>);
            } catch (conversionError) {
              console.warn('[webglExporter] Failed to convert indexBuffer data via Array.from, falling back to normalizeIndexBufferValues', conversionError);
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              console.warn(`[webglExporter] Brush serialize() returned an empty index buffer for layer ${layer.id}`);
              return undefined;
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

const serializeColorCycleData = (layer: Layer): WebGLSerializedColorCycle | undefined => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }

  const serialized: WebGLSerializedColorCycle = {
    mode: data.mode ?? 'brush',
    gradient: data.gradient,
    brushSpeed: data.brushSpeed ?? null,
    isAnimating: !!data.isAnimating
  };

  if (data.recolorSettings) {
    const { recolorSettings } = data;
    const animation = { ...recolorSettings.animation };
    if (animation && typeof animation.isPlaying === 'undefined') {
      animation.isPlaying = serialized.isAnimating;
    }

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
      indexBuffer: recolorSettings.indexBuffer ? Array.from(recolorSettings.indexBuffer) : undefined,
      palette: recolorSettings.palette ? Array.from(recolorSettings.palette) : undefined,
      indexPhaseMap: recolorSettings.indexPhaseMap ? Array.from(recolorSettings.indexPhaseMap) : undefined,
      phaseMap: recolorSettings.phaseMap ? Array.from(recolorSettings.phaseMap) : undefined,
      colorMap: recolorSettings.colorMap ? Array.from(recolorSettings.colorMap.entries()) : undefined
    };
  }

  if (!data.recolorSettings) {
    const brushState = serializeBrushState(layer);
    if (brushState) {
      serialized.brushState = brushState;
      if (!serialized.gradient || serialized.gradient.length === 0) {
        serialized.gradient = brushState.gradientStops;
      }
    } else {
      console.warn('[webglExporter] No brush state could be extracted for layer', layer.id);
    }
  }

  return serialized;
};

const captureLayerTexture = async (layer: Layer): Promise<string | undefined> => {
  try {
    if (layer.framebuffer) {
      const dataUrl = await canvasToDataURL(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from framebuffer for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    if (layer.imageData) {
      const dataUrl = imageDataToDataURL(layer.imageData);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated from ImageData for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    if (layer.colorCycleData) {
      const brush = layer.colorCycleData.colorCycleBrush as ExportableColorCycleBrush;

      const primaryCanvas = layer.colorCycleData.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;

      if (brush) {
        try {
          brush.commitCurrentStroke?.(layer.id);
        } catch (commitError) {
          console.warn('[webglExporter] Failed to commit color cycle stroke before capture', commitError);
        }

        try {
          brush.render?.();
        } catch (renderError) {
          console.warn('[webglExporter] Failed to force render color cycle', renderError);
        }

        if (primaryCanvas instanceof HTMLCanvasElement && brush.renderDirectToCanvas) {
          try {
            brush.renderDirectToCanvas(primaryCanvas, layer.id);
          } catch (directError) {
            console.warn('[webglExporter] Failed to render color cycle directly to canvas', directError);
          }
        }
      }

      const candidateCanvases: Array<{ source: string; canvas?: HTMLCanvasElement | OffscreenCanvas }> = [
        { source: 'compositeCanvas', canvas: brush?.compositeCanvas },
        { source: 'webglCanvas', canvas: brush?.webglCanvas },
        { source: 'colorCycleData.canvas', canvas: primaryCanvas }
      ];

      for (const { source, canvas } of candidateCanvases) {
        if (!canvas) {
          continue;
        }
        try {
          const dataUrl = await canvasToDataURL(canvas);
          const normalized = normalizeImageDataUrl(dataUrl);
          if (normalized) {
            return normalized;
          }
        } catch (captureError) {
          console.warn('[webglExporter] Failed to capture texture from', source, 'for layer', layer.id, captureError);
        }
      }
    }
    return undefined;
  } catch (error) {
    console.warn('[webglExporter] Failed to capture texture for layer', layer.id, error);
    return undefined;
  }
};

const collectLayout = (
  layers: Layer[],
  _layout: ExportContainerLayout,
  viewport: WebGLViewport,
  includeHiddenLayers: boolean,
  project: Project
): ResolvedLayerLayout[] => {
  const visibleLayers = layers.filter((layer) => includeHiddenLayers || layer.visible);
  if (visibleLayers.length === 0) {
    return [];
  }

  // WebGL exports should mirror the editor stacking model: every layer is composited
  // against the same viewport origin. We therefore emit overlapping frames and rely on
  // the per-layer transform for alignment, rather than the sprite-sheet style layout
  // engine used by other export paths.
  return visibleLayers.map((layer) => {
    const surface = getLayerSurfaceSize(layer, project);
    const transform = computeLayerTransform(surface, viewport, layer.alignment);
    return {
      layerId: layer.id,
      frame: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height
      },
      transform
    } satisfies ResolvedLayerLayout;
  });
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

type ViewerAssetName = 'index.html' | 'viewer.js';

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

const appendZipAutoloadSnippet = (scriptContent: string, bundleFilename: string, metadataJson: string): string => {
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const snippet = `
      const packagedMetadata = JSON.parse(\`${metadataLiteral}\`);
      const autoBundleName = ${JSON.stringify(bundleFilename)};
      const renderPackagedMetadata = async (metadata) => {
        const projectName = metadata?.project?.name ?? 'packaged bundle';
        setStatus('Rendering packaged bundle…');
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Preview canvas element is unavailable');
        }
        const scale = computeScale(metadata);
        const renderResult = await renderTinyBrushWebGL(metadata, canvas, { scale });
        summarizeMetadata(metadata, renderResult);
        setStatus('Rendered ' + projectName);
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
            console.warn('Automatic bundle load failed', error);
          }
          if (packagedMetadata) {
            try {
              await renderPackagedMetadata(packagedMetadata);
              return;
            } catch (secondaryError) {
              console.error('Failed to render embedded metadata', secondaryError);
            }
          }
          setStatus('Viewer ready. Drop a bundle to preview.');
        }
      };
      void autoLoadPackagedBundle();
`;
  return `${scriptContent}${snippet}`;
};

const buildSingleFileScript = (scriptContent: string, viewerRuntime: string, metadataJson: string): string => {
  const withoutImport = scriptContent.replace(/\s*import\s+\{\s*renderTinyBrushWebGL\s*\}\s+from\s+'\.\/viewer\.js';?\s*/, '\n');
  const runtime = `\n${viewerRuntime}\n`;
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const snippet = `
      const packagedMetadata = JSON.parse(\`${metadataLiteral}\`);
      const renderPackagedBundle = async () => {
        try {
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Preview canvas element is unavailable');
          }
          const projectName = packagedMetadata?.project?.name ?? 'packaged bundle';
          setStatus('Rendering packaged bundle…');
          const scale = computeScale(packagedMetadata);
          const renderResult = await renderTinyBrushWebGL(packagedMetadata, canvas, { scale });
          summarizeMetadata(packagedMetadata, renderResult);
          setStatus('Rendered ' + projectName);
        } catch (error) {
          console.error('Failed to render packaged bundle', error);
          setStatus(error instanceof Error ? error.message : 'Failed to render bundle', 'error');
        }
      };
      void renderPackagedBundle();
`;
  return `${runtime}${withoutImport}${snippet}`;
};

const createZipViewerHtml = (template: string, bundleFilename: string, metadataJson: string): string => {
  return transformModuleScript(template, (script) => appendZipAutoloadSnippet(script, bundleFilename, metadataJson));
};

const stripViewerExports = (viewerJs: string): string => {
  return viewerJs.replace(/export\s+const\s+renderTinyBrushWebGL/, 'const renderTinyBrushWebGL')
    .replace(/export\s+\{[^}]*\};?/g, '');
};

const createSingleFileViewerHtml = (
  template: string,
  viewerJs: string,
  metadataJson: string
): string => {
  const runtime = stripViewerExports(viewerJs);
  return transformModuleScript(template, (script) => buildSingleFileScript(script, runtime, metadataJson));
};

export const exportProjectAsWebGL = async (
  options: WebGLExportRequest
): Promise<WebGLExportMetadata> => {
  if (typeof window === 'undefined') {
    throw new Error('WebGL export is only available in the browser');
  }

  const containerLayout = cloneExportLayout(options.layout);
  const placements = collectLayout(
    options.layers,
    containerLayout,
    options.viewport,
    options.includeHiddenLayers,
    options.project
  );

  const placementMap = new Map<string, ResolvedLayerLayout>();
  placements.forEach((placement) => placementMap.set(placement.layerId, placement));

  const metadataLayers: WebGLLayerMetadata[] = [];
  for (let layerIndex = 0; layerIndex < options.layers.length; layerIndex += 1) {
    const layer = options.layers[layerIndex];
    if (!options.includeHiddenLayers && !layer.visible) {
      continue;
    }
    const placement = placementMap.get(layer.id);
    if (!placement) {
      continue;
    }

    const sourceSize = getLayerSurfaceSize(layer, options.project);
    const texture = await captureLayerTexture(layer);
    const stackIndex = metadataLayers.length;

    metadataLayers.push({
      id: layer.id,
      name: layer.name,
      type: layer.layerType,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      stackIndex,
      alignment: cloneLayerAlignment(layer.alignment),
      frame: placement.frame,
      transform: placement.transform,
      sourceSize,
      assets: texture ? { texture } : {},
      colorCycle: serializeColorCycleData(layer),
      version: layer.version
    });

    if (layer.colorCycleData && !texture) {
      console.error(`[webglExporter] Color cycle layer ${layer.id} has no texture!`);
    }
  }

  let fallback: WebGLExportMetadata['fallback'];
  if (options.embedCanvasFallback && typeof document !== 'undefined' && options.compositeLayersToCanvas) {
    try {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = Math.max(1, options.project.width);
      fallbackCanvas.height = Math.max(1, options.project.height);
      options.compositeLayersToCanvas(fallbackCanvas);
      const dataUrl = await canvasToDataURL(fallbackCanvas);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        console.error('[webglExporter] Invalid data URL generated for PNG fallback');
      } else {
        fallback = {
          type: 'image/png',
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
      backgroundColor: options.project.backgroundColor || '#ffffff'
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

  const json = JSON.stringify(metadata, null, options.minify ? undefined : 2);
  const jsonFilename = `${options.filenameBase}-webgl.json`;

  if (bundleFormat === 'json') {
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, jsonFilename);
    return metadata;
  }

  let indexHtml: string;
  let viewerJs: string;
  try {
    [indexHtml, viewerJs] = await Promise.all([
      fetchViewerAsset('index.html', options.assetPrefix),
      fetchViewerAsset('viewer.js', options.assetPrefix)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    throw new Error(`[webglExporter] Failed to load viewer assets: ${message}`);
  }

  if (bundleFormat === 'single-html') {
    const singleFileHtml = createSingleFileViewerHtml(indexHtml, viewerJs, json);
    const htmlBlob = new Blob([singleFileHtml], { type: 'text/html' });
    downloadBlob(htmlBlob, `${options.filenameBase}-webgl.html`);
    return metadata;
  }

  if (bundleFormat === 'zip') {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('index.html', createZipViewerHtml(indexHtml, jsonFilename, json));
    zip.file('viewer.js', viewerJs);
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
};
