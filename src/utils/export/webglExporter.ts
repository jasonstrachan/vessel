import { cloneExportLayout, cloneLayerAlignment } from '@/utils/layoutDefaults';
import { resolveContainerLayout, type LayerTransform, type ResolvedLayerLayout } from '@/utils/layerAlignment';
import type { ExportContainerLayout, Layer, Project, WebGLExportBundleFormat } from '@/types';

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

interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: number[];
  gradientStops: Array<{ position: number; color: string }>;
  palette?: string[];
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

const serializeBrushState = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const brush = layer.colorCycleData?.colorCycleBrush as { serialize?: () => unknown } | undefined;
  if (!brush || typeof brush.serialize !== 'function') {
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
          gradient?: { gradientStops?: Array<{ position: number; color: string }> };
          animation?: {
            offset?: number;
            stats?: { targetFPS?: number };
          };
        };
      }>;
    } | undefined;

    if (!raw?.layers || raw.layers.length === 0) {
      return undefined;
    }

    const entry = raw.layers.find((candidate) => candidate?.layerId === layer.id);
    const indexBuffer = entry?.data?.indexBuffer;
    if (!indexBuffer?.data || !Number.isFinite(Number(indexBuffer.width)) || !Number.isFinite(Number(indexBuffer.height))) {
      return undefined;
    }

    const indexData = Array.isArray(indexBuffer.data)
      ? indexBuffer.data.slice()
      : Array.from(indexBuffer.data);

    const gradientStops = entry?.data?.gradient?.gradientStops && entry.data.gradient.gradientStops.length > 0
      ? entry.data.gradient.gradientStops.map((stop) => ({
          position: typeof stop.position === 'number' ? stop.position : Number.parseFloat(String(stop.position ?? 0)) || 0,
          color: typeof stop.color === 'string' ? stop.color : '#ffffff'
        }))
      : layer.colorCycleData?.gradient ?? [];

    const animationOffset = typeof entry?.data?.animation?.offset === 'number'
      ? entry.data.animation.offset
      : 0;

    const targetFPS = entry?.data?.animation?.stats && typeof entry.data.animation.stats.targetFPS === 'number'
      ? entry.data.animation.stats.targetFPS
      : undefined;

    const width = Math.max(1, Math.round(Number(indexBuffer.width)));
    const height = Math.max(1, Math.round(Number(indexBuffer.height)));

    return {
      width,
      height,
      indexBuffer: indexData,
      gradientStops,
      palette: Array.isArray(indexBuffer.palette) ? [...indexBuffer.palette] : undefined,
      animationOffset,
      targetFPS
    };
  } catch (error) {
    console.warn('[webglExporter] Failed to serialize brush color cycle state for layer', layer.id, error);
    return undefined;
  }
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

  if (!data.recolorSettings) {
    const brushState = serializeBrushState(layer);
    if (brushState) {
      serialized.brushState = brushState;
      if (!serialized.gradient || serialized.gradient.length === 0) {
        serialized.gradient = brushState.gradientStops;
      }
    }
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
  const escaped = metadataJson
    .replace(/<\//g, (match) => (match === '</' ? '<\/' : match))
    .replace(/<!--/g, '\\u003C!--')
    .replace(/<script/gi, '<\\u0073cript')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return JSON.stringify(escaped);
};

const appendZipAutoloadSnippet = (scriptContent: string, bundleFilename: string, metadataJson: string): string => {
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const snippet = `
      const packagedMetadata = JSON.parse(${metadataLiteral});
      const autoBundleName = ${JSON.stringify(bundleFilename)};
      const renderPackagedMetadata = async (metadata) => {
        const projectName = metadata?.project?.name ?? 'packaged bundle';
        setStatus('Rendering packaged bundle…');
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
      const packagedMetadata = JSON.parse(${metadataLiteral});
      const renderPackagedBundle = async () => {
        try {
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
