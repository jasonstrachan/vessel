import { debugLog, debugWarn, logError } from '@/utils/debug';
import { parseCssColor } from '@/utils/color/parseCssColor';
import type { Layer } from '@/types';
import type { BrushStateRuntimePayload, CanvasExportFormatOption, CanvasExportMimeType, WebGLLayerBounds } from '@/utils/export/goblet/gobletTypes';
const DEFAULT_GOBLET_PREVIEW_MAX_SIZE = 500;

const CANVAS_EXPORT_FORMATS: readonly CanvasExportFormatOption[] = [
  { type: 'image/avif', quality: 0.6 },
  { type: 'image/webp', quality: 0.75 },
  { type: 'image/png' }
];

export const isCanvas2DContext = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | RenderingContext | null
): ctx is CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  return Boolean(ctx && typeof (ctx as CanvasRenderingContext2D).clearRect === 'function');
};

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

export type CanvasSurfaceLike = {
  width: number;
  height: number;
  getContext: (
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings
  ) => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
};

const isCanvasSurfaceLike = (value: unknown): value is CanvasSurfaceLike => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CanvasSurfaceLike>;
  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    typeof candidate.getContext === 'function'
  );
};

const isCanvas2DReadContextLike = (
  value: unknown
): value is Pick<CanvasRenderingContext2D, 'getImageData'> => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CanvasRenderingContext2D>;
  return typeof candidate.getImageData === 'function';
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

export const normalizeCanvasSurfaceForExport = (
  canvas: unknown
): HTMLCanvasElement | OffscreenCanvas | undefined => {
  if (isHTMLCanvas(canvas)) {
    return canvas;
  }
  if (!isCanvasSurfaceLike(canvas)) {
    return undefined;
  }
  if (typeof document === 'undefined') {
    return isOffscreenCanvas(canvas) ? canvas : undefined;
  }

  try {
    const width = Math.max(1, Math.floor(canvas.width));
    const height = Math.max(1, Math.floor(canvas.height));
    const sourceCtx = canvas.getContext('2d', { willReadFrequently: true });
    if (!isCanvas2DReadContextLike(sourceCtx)) {
      return undefined;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!exportCtx) {
      return undefined;
    }

    const imageData = sourceCtx.getImageData(0, 0, width, height);
    exportCtx.putImageData(imageData, 0, 0);
    return exportCanvas;
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to normalize canvas-like surface for export', error);
    return undefined;
  }
};

const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

const normalizeCanvasExportMimeType = (value: unknown): CanvasExportMimeType | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image/avif' || normalized === 'image/webp' || normalized === 'image/png') {
    return normalized;
  }
  return undefined;
};

const extractCanvasExportMimeTypeFromDataUrl = (dataUrl: unknown): CanvasExportMimeType | undefined => {
  if (typeof dataUrl !== 'string') {
    return undefined;
  }
  const match = dataUrl.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (!match) {
    return undefined;
  }
  return normalizeCanvasExportMimeType(match[1]);
};

export const normalizeImageDataUrl = (dataUrl: unknown): string | undefined => {
  if (typeof dataUrl !== 'string') {
    return undefined;
  }
  const trimmed = dataUrl.trim();
  if (!IMAGE_DATA_URL_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
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
      debugLog('raw-console', `[webglExporter] HTMLCanvas toBlob failed for ${format.type}`, error);
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
      debugLog('raw-console', `[webglExporter] OffscreenCanvas convertToBlob failed for ${format.type}`, error);
    }
  }

  return null;
};

export const canvasToDataURL = async (
  canvas: HTMLCanvasElement | OffscreenCanvas | CanvasSurfaceLike
): Promise<{ dataUrl: string; format: CanvasExportMimeType }> => {
  const normalizedCanvas = normalizeCanvasSurfaceForExport(canvas);
  if (!normalizedCanvas) {
    throw new Error('Unsupported canvas instance for export');
  }

  for (const format of CANVAS_EXPORT_FORMATS) {
    try {
      const blob = await encodeCanvasToBlob(normalizedCanvas, format);
      if (!blob) {
        continue;
      }
      const dataUrl = await blobToDataURL(blob);
      const actualFormat =
        normalizeCanvasExportMimeType(blob.type) ??
        extractCanvasExportMimeTypeFromDataUrl(dataUrl) ??
        format.type;
      return { dataUrl, format: actualFormat };
    } catch (error) {
      debugLog('raw-console', `[webglExporter] Failed to encode canvas as ${format.type}`, error);
    }
  }

  if (isHTMLCanvas(normalizedCanvas)) {
    try {
      const dataUrl = normalizedCanvas.toDataURL('image/png');
      return { dataUrl, format: 'image/png' };
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Final HTMLCanvas toDataURL fallback failed', error);
    }
  }

  throw new Error('Unsupported canvas instance for export');
};

export const imageDataToDataURL = async (
  imageData: ImageData,
  crop?: TextureCropOptions
): Promise<string> => {
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
  const croppedCanvas = cropDrawableSource(canvas, canvas.width, canvas.height, crop);
  const { dataUrl } = await canvasToDataURL(croppedCanvas ?? canvas);
  return dataUrl;
};

export const createExportPreviewCanvas = (
  sourceCanvas: HTMLCanvasElement,
  maxSize = DEFAULT_GOBLET_PREVIEW_MAX_SIZE
): HTMLCanvasElement => {
  const sourceWidth = Math.max(1, Math.round(sourceCanvas.width));
  const sourceHeight = Math.max(1, Math.round(sourceCanvas.height));
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const scale = longestEdge > maxSize ? maxSize / longestEdge : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = width;
  previewCanvas.height = height;

  const previewCtx = previewCanvas.getContext('2d', { colorSpace: 'srgb' });
  if (!previewCtx) {
    throw new Error('Unable to obtain 2D context for Goblet preview');
  }

  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = 'high';
  previewCtx.drawImage(sourceCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);

  return previewCanvas;
};

export type TextureCropOptions = {
  bounds: WebGLLayerBounds;
  basis?: { width: number; height: number };
};

const createTextureCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas | undefined => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(safeWidth, safeHeight);
  }
  return undefined;
};

const normalizeTextureCrop = (
  sourceWidth: number,
  sourceHeight: number,
  crop?: TextureCropOptions
): WebGLLayerBounds | undefined => {
  if (!crop || crop.bounds.width <= 0 || crop.bounds.height <= 0) {
    return undefined;
  }

  const safeWidth = Math.max(1, Math.round(sourceWidth));
  const safeHeight = Math.max(1, Math.round(sourceHeight));
  const basisWidth = Math.max(1, Math.round(crop.basis?.width ?? safeWidth));
  const basisHeight = Math.max(1, Math.round(crop.basis?.height ?? safeHeight));
  const scaleX = safeWidth / basisWidth;
  const scaleY = safeHeight / basisHeight;
  const x = Math.max(0, Math.floor(crop.bounds.x * scaleX));
  const y = Math.max(0, Math.floor(crop.bounds.y * scaleY));
  const width = Math.min(safeWidth - x, Math.max(1, Math.round(crop.bounds.width * scaleX)));
  const height = Math.min(safeHeight - y, Math.max(1, Math.round(crop.bounds.height * scaleY)));

  if (x === 0 && y === 0 && width >= safeWidth && height >= safeHeight) {
    return undefined;
  }

  return { x, y, width, height };
};

const cropDrawableSource = (
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop?: TextureCropOptions
): HTMLCanvasElement | OffscreenCanvas | undefined => {
  const normalizedCrop = normalizeTextureCrop(sourceWidth, sourceHeight, crop);
  if (!normalizedCrop) {
    return undefined;
  }

  const canvas = createTextureCanvas(normalizedCrop.width, normalizedCrop.height);
  if (!canvas) {
    return undefined;
  }
  const ctx = canvas.getContext('2d');
  if (!isCanvas2DContext(ctx)) {
    return undefined;
  }
  ctx.clearRect(0, 0, normalizedCrop.width, normalizedCrop.height);
  ctx.drawImage(
    source,
    normalizedCrop.x,
    normalizedCrop.y,
    normalizedCrop.width,
    normalizedCrop.height,
    0,
    0,
    normalizedCrop.width,
    normalizedCrop.height
  );
  return canvas;
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

const imageBitmapToDataURL = async (
  bitmap: ImageBitmap,
  crop?: TextureCropOptions
): Promise<string | undefined> => {
  try {
    const width = Math.max(1, bitmap.width || (bitmap as { width?: number }).width || 1);
    const height = Math.max(1, bitmap.height || (bitmap as { height?: number }).height || 1);

    const croppedCanvas = cropDrawableSource(bitmap, width, height, crop);
    const canvas = croppedCanvas ?? createTextureCanvas(width, height);

    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!isCanvas2DContext(ctx)) {
      return undefined;
    }

    if (!croppedCanvas) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
    }

    const { dataUrl } = await canvasToDataURL(canvas);
    return normalizeImageDataUrl(dataUrl);
  } catch (error) {
    debugWarn('raw-console', '[webglExporter] Failed to serialize ImageBitmap for layer export', error);
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

export const captureLayerTexture = async (
  layer: Layer,
  crop?: TextureCropOptions
): Promise<string | undefined> => {
  try {
    const surface = resolveLayerCanvasSurface(layer);
    if (surface) {
      const sourceWidth = Math.max(1, Math.round(surface.width));
      const sourceHeight = Math.max(1, Math.round(surface.height));
      const croppedSurface = cropDrawableSource(surface, sourceWidth, sourceHeight, crop);
      const { dataUrl } = await canvasToDataURL(croppedSurface ?? surface);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        logError('[webglExporter] Invalid data URL generated from canvas surface for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    if (layer.imageData) {
      const dataUrl = await imageDataToDataURL(layer.imageData, crop);
      const normalized = normalizeImageDataUrl(dataUrl);
      if (!normalized) {
        logError('[webglExporter] Invalid data URL generated from ImageData for layer', layer.id);
        return undefined;
      }
      return normalized;
    }
    const bitmap = resolveLayerImageBitmap(layer);
    if (bitmap) {
      const normalized = await imageBitmapToDataURL(bitmap, crop);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  } catch (error) {
    debugWarn('raw-console', '[webglExporter] Failed to capture texture for layer', layer.id, error);
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

export const synthesizeBrushTextureFromIndices = async (
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
    debugWarn('raw-console', '[webglExporter] Failed to synthesize brush texture from indices', error);
    return undefined;
  }
};
