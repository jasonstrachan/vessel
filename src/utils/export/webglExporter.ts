import { cloneExportLayout, cloneLayerAlignment } from '@/utils/layoutDefaults';
import { resolveContainerLayout, type LayerTransform, type ResolvedLayerLayout } from '@/utils/layerAlignment';
import type { ExportContainerLayout, Layer, Project } from '@/types';

interface WebGLViewport {
  width: number;
  height: number;
}

interface WebGLLayerAsset {
  texture?: string;
}

interface WebGLSerializedColorCycle {
  mode: NonNullable<Layer['colorCycleData']>['mode'] | 'brush';
  gradient?: Array<{ position: number; color: string }>;
  brushSpeed?: number | null;
  isAnimating: boolean;
  recolorSettings?: Record<string, unknown>;
}

export interface WebGLLayerMetadata {
  id: string;
  name: string;
  type: Layer['layerType'];
  visible: boolean;
  opacity: number;
  blendMode: Layer['blendMode'];
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
    serialized.recolorSettings = {
      quantizationMode: recolorSettings.quantizationMode,
      ditherMode: recolorSettings.ditherMode,
      animation: { ...recolorSettings.animation },
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

  return serialized;
};

const captureLayerTexture = async (layer: Layer): Promise<string | undefined> => {
  try {
    if (layer.framebuffer) {
      return await canvasToDataURL(layer.framebuffer as HTMLCanvasElement | OffscreenCanvas);
    }
    if (layer.imageData) {
      return imageDataToDataURL(layer.imageData);
    }
    if (layer.colorCycleData?.canvas) {
      return await canvasToDataURL(layer.colorCycleData.canvas as HTMLCanvasElement | OffscreenCanvas);
    }
    return undefined;
  } catch (error) {
    console.warn('[webglExporter] Failed to capture texture for layer', layer.id, error);
    return undefined;
  }
};

const collectLayout = (
  layers: Layer[],
  layout: ExportContainerLayout,
  viewport: WebGLViewport,
  includeHiddenLayers: boolean,
  project: Project
) => {
  const inputs = layers
    .filter((layer) => includeHiddenLayers || layer.visible)
    .map((layer) => ({
      layerId: layer.id,
      surface: getLayerSurfaceSize(layer, project),
      alignment: layer.alignment,
      hidden: false
    }));

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
  for (const layer of options.layers) {
    if (!options.includeHiddenLayers && !layer.visible) {
      continue;
    }
    const placement = placementMap.get(layer.id);
    if (!placement) {
      continue;
    }

    const sourceSize = getLayerSurfaceSize(layer, options.project);
    const texture = await captureLayerTexture(layer);

    metadataLayers.push({
      id: layer.id,
      name: layer.name,
      type: layer.layerType,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      alignment: cloneLayerAlignment(layer.alignment),
      frame: placement.frame,
      transform: placement.transform,
      sourceSize,
      assets: texture ? { texture } : {},
      colorCycle: serializeColorCycleData(layer),
      version: layer.version
    });
  }

  let fallback: WebGLExportMetadata['fallback'];
  if (options.embedCanvasFallback && typeof document !== 'undefined' && options.compositeLayersToCanvas) {
    try {
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = Math.max(1, options.project.width);
      fallbackCanvas.height = Math.max(1, options.project.height);
      options.compositeLayersToCanvas(fallbackCanvas);
      const dataUrl = await canvasToDataURL(fallbackCanvas);
      fallback = {
        type: 'image/png',
        dataUrl
      };
    } catch (error) {
      console.warn('[webglExporter] Failed to capture Canvas2D fallback', error);
    }
  }

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
      perfectLoop: options.perfectLoop
    },
    layers: metadataLayers
  };

  if (fallback) {
    metadata.fallback = fallback;
  }

  const json = JSON.stringify(metadata, null, options.minify ? undefined : 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = `${options.filenameBase}-webgl.json`;
  downloadBlob(blob, filename);

  return metadata;
};
