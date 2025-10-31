// Project input/output utilities for Vessel
// Handles serialization, deserialization, and file operations

import type {
  Project,
  Layer,
  CustomBrush,
  BrushSettings,
  LayerAlignmentSettings,
  ExportContainerLayout,
  PaletteState
} from '@/types';
import { cloneExportLayout, cloneLayerAlignment, normalizePalette } from '@/utils/layoutDefaults';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import {
  LEGACY_PROJECT_FILE_EXTENSION,
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_MIME
} from '@/constants/projectFiles';

// Vessel project file format version
const PROJECT_VERSION = '1.0.0';

function ensureProjectFilename(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return `untitled${PROJECT_FILE_EXTENSION}`;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.endsWith(PROJECT_FILE_EXTENSION) ||
    lower.endsWith(LEGACY_PROJECT_FILE_EXTENSION)
  ) {
    return normalized;
  }

  return `${normalized}${PROJECT_FILE_EXTENSION}`;
}

export interface VesselProject {
  version: string;
  metadata: {
    name: string;
    created: string;
    modified: string;
    appVersion: string;
  };
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    layers: SerializedLayer[];
    customBrushes: SerializedCustomBrush[];
    defaultCustomBrushId?: string | null;
    thumbnail?: string;
    brushSpecificSettings?: Record<string, unknown>;
    globalBrushSize?: number;
    exportLayout?: ExportContainerLayout;
    palette?: PaletteState;
  };
}

interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  transparencyLocked?: boolean;
  order: number;
  imageDataUrl: string; // Base64 encoded ImageData
  layerType?: 'normal' | 'color-cycle' | 'colorCycle';
  alignment?: LayerAlignmentSettings;
  colorCycleData?: SerializedColorCycleLayerData;
}

type SerializedColorMapEntry = [number, number];

interface SerializedAnimatorSnapshot {
  indexBuffer: {
    width: number;
    height: number;
    data?: string; // base64 encoded Uint8Array
    palette: string[];
  };
  gradient: {
    gradientStops: Array<{ position: number; color: string }>;
    paletteSize?: number;
  };
  animation: {
    offset: number;
    stats: {
      targetFPS: number;
      actualFPS: number;
      frameCount: number;
      totalTime: number;
      averageFrameTime: number;
      isAnimating: boolean;
    };
  };
}

interface SerializedStrokeSnapshot {
  paintBuffer?: string; // base64 encoded ArrayBuffer
  hasContent?: boolean;
  strokeCounter?: number;
}

interface SerializedBrushLayerSnapshot {
  layerId: string;
  strokeData?: SerializedStrokeSnapshot;
  animator?: SerializedAnimatorSnapshot;
}

interface PersistedColorCycleBrushState {
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
  layers: SerializedBrushLayerSnapshot[];
}

interface SerializedColorCycleRecolorSettings {
  quantizationMode: 'rgb332' | 'oklab-median-cut';
  ditherMode: 'off' | 'bayer4' | 'bayer8';
  animation: {
    speed: number;
    fps: number;
    ticksPerFrame: number;
    isPlaying: boolean;
    currentTick: number;
    flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  };
  cycleColors: number;
  gradient: Array<{ position: number; color: string }>;
  mappingMode?: 'banded' | 'continuous';
  flowMapping?: 'palette' | 'directional' | 'luminance';
  directionAngle?: number;
  bandWidthPx?: number;
  currentLOD?: 'full' | 'half' | 'quarter';
  indexBuffer?: string; // base64 encoded Uint8Array
  palette?: number[];
  indexPhaseMap?: string; // base64 encoded Uint8Array
  phaseMap?: string; // base64 encoded Uint8Array
  colorMap?: SerializedColorMapEntry[];
  originalImageData?: string; // Same raw JSON data URL format as layer imageData
}

interface SerializedColorCycleLayerData {
  gradient?: Array<{ position: number; color: string }>;
  isAnimating?: boolean;
  mode?: 'brush' | 'recolor';
  brushSpeed?: number;
  recolorSettings?: SerializedColorCycleRecolorSettings;
  brushState?: PersistedColorCycleBrushState;
  canvasImageData?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  eraseMaskImageData?: string;
  eraseMaskVersion?: number;
  // Legacy fallback data retained for backward compatibility
  webGLState?: {
    gradients: Array<{ gradientStops: Array<{ position: number; color: string }> }>;
    animationState: { cycleOffset: number; speed: number; fps: number; isPaused: boolean };
    layerSnapshots: Array<{ layerId: string; data: string }>; // Base64 encoded ArrayBuffer
  };
}

interface SerializedCustomBrush {
  id: string;
  name: string;
  width: number;
  height: number;
  imageDataUrl: string; // Base64 encoded ImageData
  thumbnail: string;
  createdAt: number;
}

interface ColorCycleBrushState {
  layers?: Array<{
    layerId: string;
    data: {
      indexBuffer: {
        width: number;
        height: number;
        data: Uint8Array;
        palette: string[];
      };
      gradient: {
        gradientStops: Array<{ position: number; color: string }>;
        paletteSize?: number;
      };
      animation: {
        offset: number;
        stats: {
          targetFPS: number;
          actualFPS: number;
          frameCount: number;
          totalTime: number;
          averageFrameTime: number;
          isAnimating: boolean;
        };
      };
    };
    strokeData?: {
      hasContent?: boolean;
      strokeCounter?: number;
      paintBuffer: ArrayBuffer;
    };
  }>;
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
}

type SerializedColorCycleWebGLState = NonNullable<SerializedLayer['colorCycleData']>['webGLState'];

const savedWebGLStates = new WeakMap<Layer, SerializedColorCycleWebGLState | undefined>();
const savedBrushStates = new WeakMap<Layer, PersistedColorCycleBrushState | undefined>();

function imageDataHasVisiblePixels(imageData: ImageData | null | undefined): boolean {
  if (!imageData) return false;
  const { data } = imageData;
  const length = data.length;
  // Sample every 4th pixel by default, but bail fast if we find anything opaque
  for (let i = 3; i < length; i += 16) {
    if (data[i] > 0) {
      return true;
    }
  }
  // If coarse sampling did not find anything, perform a final sparse check to avoid false negatives
  for (let i = 3; i < length; i += Math.max(4, Math.floor(length / 4096))) {
    if (data[i] > 0) {
      return true;
    }
  }
  return false;
}

// Convert ImageData to base64 encoded raw pixel data (lossless)
function imageDataToDataUrl(imageData: ImageData): string {
  // Serialize ImageData as raw RGBA pixel data to preserve exact values
  const rawData = {
    width: imageData.width,
    height: imageData.height,
    data: Array.from(imageData.data) // Convert Uint8ClampedArray to regular array for JSON
  };
  
  // Encode as base64 JSON to avoid PNG compression artifacts
  const jsonString = JSON.stringify(rawData);
  const base64 = btoa(jsonString);
  return `data:application/json;base64,${base64}`;
}

// Convert base64 raw pixel data back to ImageData (lossless)
function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    try {
      // Check if this is raw pixel data format
      if (dataUrl.startsWith('data:application/json;base64,')) {
        const base64 = dataUrl.substring('data:application/json;base64,'.length);
        const jsonString = atob(base64);
        const rawData = JSON.parse(jsonString);
        
        // Recreate ImageData from raw pixel data
        const imageData = new ImageData(
          new Uint8ClampedArray(rawData.data),
          rawData.width,
          rawData.height
        );
        resolve(imageData);
        return;
      }
      
      // Fallback: handle old PNG format for backward compatibility
      if (dataUrl.startsWith('data:image/png;base64,')) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(imageData);
        };
        img.onerror = () => reject(new Error('Failed to load image data'));
        img.src = dataUrl;
        return;
      }
      
      reject(new Error('Unsupported data format'));
    } catch (error) {
      reject(error);
    }
  });
}

// Helper to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function typedArrayToBase64(view: ArrayBufferView): string {
  return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function base64ToUint8Array(base64?: string): Uint8Array | undefined {
  if (!base64) {
    return undefined;
  }
  return new Uint8Array(base64ToArrayBuffer(base64));
}


// Serialize a layer for saving
function serializeLayer(layer: Layer): SerializedLayer {
  
  let imageDataUrl = '';
  if (layer.imageData) {
    try {
      imageDataUrl = imageDataToDataUrl(layer.imageData);
    } catch {
    }
  }
  
  const serialized: SerializedLayer = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    transparencyLocked: layer.transparencyLocked === true,
    order: layer.order,
    imageDataUrl,
    layerType: layer.layerType,
    alignment: cloneLayerAlignment(layer.alignment)
  };
  
  // Serialize color cycle data if present
  if (layer.layerType === 'color-cycle') {
    const sourceColorCycleData = layer.colorCycleData || {};
    const canvasImageData = sourceColorCycleData.canvasImageData ?? captureCanvasImageData(sourceColorCycleData.canvas ?? null);
    const eraseMaskImageData = sourceColorCycleData.eraseMaskImageData ?? captureCanvasImageData(sourceColorCycleData.eraseMask ?? null);
    const colorCycleData = {
      ...sourceColorCycleData,
      canvasImageData: canvasImageData ?? sourceColorCycleData.canvasImageData,
      eraseMaskImageData: eraseMaskImageData ?? sourceColorCycleData.eraseMaskImageData
    };
    const serializedColorCycle: SerializedColorCycleLayerData = {
      gradient: colorCycleData.gradient,
      isAnimating: Boolean(colorCycleData.isAnimating),
      mode: colorCycleData.mode,
      brushSpeed: colorCycleData.brushSpeed
    };

    if (colorCycleData.canvasImageData) {
      try {
        serializedColorCycle.canvasImageData = imageDataToDataUrl(colorCycleData.canvasImageData);
        serializedColorCycle.canvasWidth = colorCycleData.canvasImageData.width;
        serializedColorCycle.canvasHeight = colorCycleData.canvasImageData.height;
      } catch (error) {
        console.warn('[projectIO] Failed to serialize color cycle canvas image data:', error);
      }
    } else if (colorCycleData.canvas?.width && colorCycleData.canvas?.height) {
      serializedColorCycle.canvasWidth = colorCycleData.canvas.width;
      serializedColorCycle.canvasHeight = colorCycleData.canvas.height;
    }

    if (colorCycleData.eraseMaskImageData) {
      try {
        serializedColorCycle.eraseMaskImageData = imageDataToDataUrl(colorCycleData.eraseMaskImageData);
      } catch (error) {
        console.warn('[projectIO] Failed to serialize color cycle erase mask:', error);
      }
    }

    if (typeof colorCycleData.eraseMaskVersion === 'number') {
      serializedColorCycle.eraseMaskVersion = colorCycleData.eraseMaskVersion;
    }

    if (colorCycleData.recolorSettings) {
      const recolor = colorCycleData.recolorSettings;
      const serializedRecolor: SerializedColorCycleRecolorSettings = {
        quantizationMode: recolor.quantizationMode,
        ditherMode: recolor.ditherMode,
        animation: { ...recolor.animation },
        cycleColors: recolor.cycleColors,
        gradient: recolor.gradient,
        mappingMode: recolor.mappingMode,
        flowMapping: recolor.flowMapping,
        directionAngle: recolor.directionAngle,
        bandWidthPx: recolor.bandWidthPx,
        currentLOD: recolor.currentLOD
      };

      if (recolor.indexBuffer) {
        serializedRecolor.indexBuffer = typedArrayToBase64(recolor.indexBuffer);
      }
      if (recolor.palette) {
        serializedRecolor.palette = Array.from(recolor.palette);
      }
      if (recolor.indexPhaseMap) {
        serializedRecolor.indexPhaseMap = typedArrayToBase64(recolor.indexPhaseMap);
      }
      if (recolor.phaseMap) {
        serializedRecolor.phaseMap = typedArrayToBase64(recolor.phaseMap);
      }
      if (recolor.colorMap) {
        serializedRecolor.colorMap = Array.from(recolor.colorMap.entries());
      }
      if (recolor.originalImageData) {
        try {
          serializedRecolor.originalImageData = imageDataToDataUrl(recolor.originalImageData);
        } catch {
        }
      }

      serializedColorCycle.recolorSettings = serializedRecolor;
    }

    if (colorCycleData.colorCycleBrush) {
      try {
        const brush = colorCycleData.colorCycleBrush;
        const fullState = brush.getFullState() as ColorCycleBrushState;
        const serializedBrushState = serializeBrushState(fullState);
        if (serializedBrushState) {
          serializedColorCycle.brushState = serializedBrushState;
        }
      } catch (error) {
        console.warn('[projectIO] Failed to serialize color cycle brush state:', error);
      }
    }

    serialized.colorCycleData = serializedColorCycle;
  }
  
  return serialized;
}

function serializeBrushState(state: ColorCycleBrushState | undefined): PersistedColorCycleBrushState | undefined {
  if (!state) {
    return undefined;
  }

  const layers: SerializedBrushLayerSnapshot[] = [];
  for (const layer of state.layers ?? []) {
    const snapshot: SerializedBrushLayerSnapshot = {
      layerId: layer.layerId
    };

    if (layer.strokeData) {
      const { strokeData } = layer;
      snapshot.strokeData = {
        hasContent: strokeData.hasContent,
        strokeCounter: strokeData.strokeCounter,
        paintBuffer: strokeData.paintBuffer ? arrayBufferToBase64(strokeData.paintBuffer) : undefined
      };
    }

    if (layer.data) {
      const { data } = layer;
      snapshot.animator = {
        indexBuffer: {
          width: data.indexBuffer.width,
          height: data.indexBuffer.height,
          data: data.indexBuffer.data ? typedArrayToBase64(data.indexBuffer.data) : undefined,
          palette: [...data.indexBuffer.palette]
        },
        gradient: {
          gradientStops: [...(data.gradient.gradientStops || [])],
          paletteSize: data.gradient.paletteSize
        },
        animation: {
          offset: data.animation.offset,
          stats: { ...data.animation.stats }
        }
      };
    }

    layers.push(snapshot);
  }

  const hasMetadata =
    state.cycleSpeed !== undefined ||
    state.fps !== undefined ||
    state.brushSize !== undefined;

  if (layers.length === 0 && !hasMetadata) {
    return undefined;
  }

  return {
    cycleSpeed: state.cycleSpeed,
    fps: state.fps,
    brushSize: state.brushSize,
    layers
  };
}

// Deserialize a layer from saved data
async function deserializeLayer(serializedLayer: SerializedLayer, projectWidth: number, projectHeight: number): Promise<Layer> {
  
  let imageData: ImageData | null = null;
  if (serializedLayer.imageDataUrl) {
    try {
      imageData = await dataUrlToImageData(serializedLayer.imageDataUrl);
    } catch {
    }
  } else {
  }
  
  // Create framebuffer with project dimensions
  const framebuffer = new OffscreenCanvas(projectWidth, projectHeight);
  
  const rawLayerType = serializedLayer.layerType === 'colorCycle'
    ? 'color-cycle'
    : serializedLayer.layerType;

  const layer: Layer = {
    id: serializedLayer.id,
    name: serializedLayer.name,
    visible: serializedLayer.visible,
    opacity: serializedLayer.opacity,
    blendMode: serializedLayer.blendMode as GlobalCompositeOperation,
    locked: serializedLayer.locked,
    transparencyLocked: serializedLayer.transparencyLocked === true,
    order: serializedLayer.order,
    imageData,
    framebuffer,
    alignment: cloneLayerAlignment(serializedLayer.alignment),
    layerType: rawLayerType || (
      console.warn('🟡 Layer missing layerType during load, defaulting to normal:', serializedLayer.id?.substring(0, 20)),
      'normal' as const
    ),
    version: Date.now()
  };

  if (imageData) {
    try {
      const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null);
      fbCtx?.clearRect(0, 0, framebuffer.width, framebuffer.height);
      fbCtx?.putImageData(imageData, 0, 0);
    } catch (error) {
      console.warn('[projectIO] Failed to hydrate layer framebuffer from image data during load:', error);
    }
  }

  // Restore color cycle data if present (including legacy files without layerType set)
  if (serializedLayer.colorCycleData) {
    // Create canvas for color cycle rendering
    const colorCycleCanvas = document.createElement('canvas');
    const canvasWidth = serializedLayer.colorCycleData.canvasWidth ?? projectWidth;
    const canvasHeight = serializedLayer.colorCycleData.canvasHeight ?? projectHeight;
    colorCycleCanvas.width = Math.max(1, canvasWidth);
    colorCycleCanvas.height = Math.max(1, canvasHeight);

    const baseColorCycleData: NonNullable<Layer['colorCycleData']> = {
      gradient: serializedLayer.colorCycleData.gradient,
      isAnimating: serializedLayer.colorCycleData.isAnimating,
      mode: serializedLayer.colorCycleData.mode,
      brushSpeed: serializedLayer.colorCycleData.brushSpeed,
      canvas: colorCycleCanvas
      // Note: colorCycleBrush will be restored later when the layer is added to the project
    };

    if (serializedLayer.colorCycleData.recolorSettings) {
      try {
        baseColorCycleData.recolorSettings = await deserializeRecolorSettings(serializedLayer.colorCycleData.recolorSettings);
      } catch (error) {
        console.error('[projectIO] Failed to restore color cycle recolor settings:', error);
      }
    }

    if (serializedLayer.colorCycleData.canvasImageData) {
      try {
        const imageData = await dataUrlToImageData(serializedLayer.colorCycleData.canvasImageData);
        baseColorCycleData.canvasImageData = imageData;
        const ctx = colorCycleCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
        ctx?.putImageData(imageData, 0, 0);
      } catch (error) {
        console.warn('[projectIO] Failed to restore color cycle canvas image data:', error);
      }
    }

    if (serializedLayer.colorCycleData.eraseMaskImageData) {
      try {
        const eraseMaskData = await dataUrlToImageData(serializedLayer.colorCycleData.eraseMaskImageData);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = eraseMaskData.width;
        maskCanvas.height = eraseMaskData.height;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
        maskCtx?.putImageData(eraseMaskData, 0, 0);
        baseColorCycleData.eraseMask = maskCanvas;
        baseColorCycleData.eraseMaskImageData = eraseMaskData;
        baseColorCycleData.eraseMaskVersion = serializedLayer.colorCycleData.eraseMaskVersion ?? 0;
      } catch (error) {
        console.warn('[projectIO] Failed to restore color cycle erase mask:', error);
      }
    }

    layer.layerType = 'color-cycle';
    layer.colorCycleData = baseColorCycleData;

    // Store WebGL state for later restoration
    if (serializedLayer.colorCycleData.webGLState) {
      savedWebGLStates.set(layer, serializedLayer.colorCycleData.webGLState);
    }

    if (serializedLayer.colorCycleData.brushState) {
      savedBrushStates.set(layer, serializedLayer.colorCycleData.brushState);
    }
  }

  return layer;
}

async function deserializeRecolorSettings(serialized: SerializedColorCycleRecolorSettings) {
  const settings: NonNullable<NonNullable<Layer['colorCycleData']>['recolorSettings']> = {
    quantizationMode: serialized.quantizationMode,
    ditherMode: serialized.ditherMode,
    animation: { ...serialized.animation },
    cycleColors: serialized.cycleColors,
    gradient: serialized.gradient,
    mappingMode: serialized.mappingMode,
    flowMapping: serialized.flowMapping,
    directionAngle: serialized.directionAngle,
    bandWidthPx: serialized.bandWidthPx,
    currentLOD: serialized.currentLOD ?? 'full'
  };

  const indexBuffer = base64ToUint8Array(serialized.indexBuffer);
  if (indexBuffer) {
    settings.indexBuffer = indexBuffer;
  }

  const palette = serialized.palette;
  if (palette && palette.length > 0) {
    settings.palette = new Uint32Array(palette);
  }

  const indexPhaseMap = base64ToUint8Array(serialized.indexPhaseMap);
  if (indexPhaseMap) {
    settings.indexPhaseMap = indexPhaseMap;
  }

  const phaseMap = base64ToUint8Array(serialized.phaseMap);
  if (phaseMap) {
    settings.phaseMap = phaseMap;
  }

  if (serialized.colorMap) {
    settings.colorMap = new Map(serialized.colorMap);
  }

  if (serialized.originalImageData) {
    try {
      settings.originalImageData = await dataUrlToImageData(serialized.originalImageData);
    } catch (error) {
      console.warn('[projectIO] Failed to restore original recolor image data:', error);
    }
  }

  return settings;
}

// Serialize a custom brush for saving
function serializeCustomBrush(brush: CustomBrush): SerializedCustomBrush {
  return {
    id: brush.id,
    name: brush.name,
    width: brush.width,
    height: brush.height,
    imageDataUrl: imageDataToDataUrl(brush.imageData),
    thumbnail: brush.thumbnail,
    createdAt: brush.createdAt
  };
}

// Deserialize a custom brush from saved data
async function deserializeCustomBrush(serializedBrush: SerializedCustomBrush): Promise<CustomBrush> {
  
  const imageData = await dataUrlToImageData(serializedBrush.imageDataUrl);
  
  
  return {
    id: serializedBrush.id,
    name: serializedBrush.name,
    width: serializedBrush.width,
    height: serializedBrush.height,
    imageData,
    thumbnail: serializedBrush.thumbnail,
    createdAt: serializedBrush.createdAt
  };
}

// Generate thumbnail from project layers
export function generateProjectThumbnail(project: Project, layers: Layer[], maxSize: number = 256): string {
  const canvas = document.createElement('canvas');
  const aspectRatio = project.width / project.height;
  
  if (aspectRatio > 1) {
    canvas.width = maxSize;
    canvas.height = Math.round(maxSize / aspectRatio);
  } else {
    canvas.width = Math.round(maxSize * aspectRatio);
    canvas.height = maxSize;
  }
  
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) return '';
  
  const scaleX = canvas.width / project.width;
  const scaleY = canvas.height / project.height;
  
  ctx.scale(scaleX, scaleY);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  ctx.fillStyle = project.backgroundColor;
  ctx.fillRect(0, 0, project.width, project.height);
  
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible || !layer.imageData) continue;
    
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.imageData.width;
    layerCanvas.height = layer.imageData.height;
    const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (layerCtx) {
      layerCtx.putImageData(layer.imageData, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }
  
  return canvas.toDataURL('image/png', 0.8);
}

// Serialize a project for saving
export async function serializeProject(project: Project, layers?: Layer[]): Promise<string> {
  // Use the passed layers parameter, falling back to project.layers if not provided
  const layersToSerialize = layers || project.layers || [];
  const serializedLayers = layersToSerialize.map(serializeLayer);
  const serializedCustomBrushes = project.customBrushes.map(serializeCustomBrush);
  
  let thumbnail = '';
  if (layers) {
    thumbnail = generateProjectThumbnail(project, layers);
  }
  
  const vesselProject: VesselProject = {
    version: PROJECT_VERSION,
    metadata: {
      name: project.name,
      created: project.createdAt.toISOString(),
      modified: new Date().toISOString(),
      appVersion: '1.0.0' // Could be pulled from package.json
    },
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      backgroundColor: project.backgroundColor,
      layers: serializedLayers,
      customBrushes: serializedCustomBrushes,
      defaultCustomBrushId: project.defaultCustomBrushId ?? null,
      thumbnail: thumbnail || undefined,
      brushSpecificSettings: project.brushSpecificSettings,
      globalBrushSize: project.globalBrushSize,
      exportLayout: cloneExportLayout(project.exportLayout),
      palette: normalizePalette(project.palette)
    }
  };
  
  return JSON.stringify(vesselProject, null, 2);
}

// Deserialize a project from saved data
export async function deserializeProject(projectData: string): Promise<Project> {
  let vesselProject: VesselProject;
  
  try {
    vesselProject = JSON.parse(projectData);
  } catch {
    throw new Error('Invalid project file format');
  }
  
  // Validate project format
  if (!vesselProject.version || !vesselProject.project) {
    throw new Error('Invalid Vessel project file');
  }
  
  // TODO: Add version migration logic here if needed
  
  const serializedProject = vesselProject.project;
  
  // Deserialize layers
  const layers = await Promise.all(
    serializedProject.layers.map(layer => deserializeLayer(layer, serializedProject.width, serializedProject.height))
  );
  
  // Deserialize custom brushes
  
  const customBrushes = await Promise.all(
    serializedProject.customBrushes.map(deserializeCustomBrush)
  );
  
  const serializedDefaultId = serializedProject.defaultCustomBrushId ?? null;
  const defaultCustomBrushId =
    serializedDefaultId && customBrushes.some((brush) => brush.id === serializedDefaultId)
      ? serializedDefaultId
      : null;
  
  
  return {
    id: serializedProject.id,
    name: serializedProject.name,
    width: serializedProject.width,
    height: serializedProject.height,
    backgroundColor: serializedProject.backgroundColor,
    layers,
    customBrushes,
    defaultCustomBrushId,
    createdAt: new Date(vesselProject.metadata.created),
    updatedAt: new Date(vesselProject.metadata.modified),
    brushSpecificSettings: serializedProject.brushSpecificSettings as Record<string, Partial<BrushSettings>> | undefined,
    globalBrushSize: serializedProject.globalBrushSize,
    exportLayout: cloneExportLayout(serializedProject.exportLayout),
    palette: normalizePalette(serializedProject.palette)
  };
}

// Save project to file using File System Access API with fallback
export async function saveProjectToFile(
  project: Project,
  filename?: string | null,
  layers?: Layer[],
  existingHandle?: FileSystemFileHandle | null
): Promise<{ fileName: string; fileHandle: FileSystemFileHandle | null }> {
  const projectData = await serializeProject(project, layers);
  const fileName = ensureProjectFilename((filename ?? project.name) || '');

  // Reuse existing handle when available
  if (existingHandle) {
    try {
      const writable = await existingHandle.createWritable();
      await writable.write(projectData);
      await writable.close();
      return { fileName: existingHandle.name ?? fileName, fileHandle: existingHandle };
    } catch {
      // If reuse fails (permission revoked, etc.), fall back to picker
    }
  }
  
  // Check if File System Access API is supported
  if ('showSaveFilePicker' in window) {
    try {
      const fileHandle = await (window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker!({
        suggestedName: fileName,
        types: [{
          description: 'Vessel Project Files',
          accept: { [PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT }
        }]
      });
      
      const writable = await fileHandle.createWritable();
      await writable.write(projectData);
      await writable.close();
      return { fileName: fileHandle.name ?? fileName, fileHandle };
    } catch {
      // User cancelled or API not supported, fall back to download
    }
  }
  
  // Fallback: create download link
  const blob = new Blob([projectData], { type: PROJECT_FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { fileName, fileHandle: null };
}

// Load project from file
export async function loadProjectFromFile(): Promise<{
  project: Project;
  fileName?: string;
  fileHandle?: FileSystemFileHandle | null;
}> {
  // Check if File System Access API is supported
  if ('showOpenFilePicker' in window) {
    try {
      const [fileHandle] = await (window as Window & {
        showOpenFilePicker?: (options: {
          types?: { description: string; accept: Record<string, string[]> }[];
          multiple?: boolean;
        }) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker!({
        types: [{
          description: 'Vessel Project Files',
          accept: { [PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT }
        }],
        multiple: false
      });
      
      const file = await fileHandle.getFile();
      const projectData = await file.text();
      const project = await deserializeProject(projectData);
      return { project, fileName: file.name, fileHandle };
    } catch {
      // User cancelled or API not supported, fall back to file input
    }
  }
  
  // Fallback: create file input
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_FILE_ACCEPT.join(',')},${PROJECT_FILE_MIME}`;
    
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      
      try {
        const projectData = await file.text();
        const project = await deserializeProject(projectData);
        resolve({ project, fileName: file.name, fileHandle: null });
      } catch (error) {
        reject(error);
      }
    };
    
    input.click();
  });
}

// Restore color cycle brushes after project load
export async function restoreColorCycleBrushes(layers: Layer[]): Promise<Layer[]> {
  // Import ColorCycleBrush factory dynamically to avoid circular dependencies
  const { createColorCycleBrush } = await import('../hooks/brushEngine/ColorCycleBrushMigration');
  
  for (const layer of layers) {
    if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
      const savedBrushState = savedBrushStates.get(layer);
      if (savedBrushState) {
        try {
          const colorCycleBrush = createColorCycleBrush(layer.colorCycleData.canvas!);

          const layerSnapshots = (savedBrushState.layers ?? []).map(snapshot => {
            const paintBuffer = snapshot.strokeData?.paintBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.paintBuffer)
              : undefined;
            const animatorIndex = snapshot.animator?.indexBuffer.data
              ? {
                  width: snapshot.animator.indexBuffer.width,
                  height: snapshot.animator.indexBuffer.height,
                  data: base64ToArrayBuffer(snapshot.animator.indexBuffer.data),
                  gradientStops: snapshot.animator.gradient.gradientStops
                }
              : undefined;

            return {
              layerId: snapshot.layerId,
              paintBuffer,
              hasContent: snapshot.strokeData?.hasContent,
              strokeCounter: snapshot.strokeData?.strokeCounter,
              animatorIndex
            };
          });

          colorCycleBrush.restoreFullState({
            cycleSpeed: savedBrushState.cycleSpeed,
            fps: savedBrushState.fps,
            brushSize: savedBrushState.brushSize,
            layerSnapshots
          });

          if (typeof colorCycleBrush.setLayerId === 'function') {
            try {
              colorCycleBrush.setLayerId(layer.id);
            } catch (error) {
              console.warn('[projectIO] Failed to assign layerId to restored color cycle brush:', error);
            }
          }

          if (layer.colorCycleData.gradient) {
            try {
              colorCycleBrush.setGradient(layer.colorCycleData.gradient);
            } catch {}
          }

          if (typeof layer.colorCycleData.brushSpeed === 'number') {
            colorCycleBrush.setSpeed(layer.colorCycleData.brushSpeed);
          } else if (typeof savedBrushState.cycleSpeed === 'number') {
            colorCycleBrush.setSpeed(savedBrushState.cycleSpeed);
          }

          layer.colorCycleData.colorCycleBrush = colorCycleBrush;
          savedBrushStates.delete(layer);

          if (layer.colorCycleData.isAnimating) {
            colorCycleBrush.setPlaying(true);
          } else {
            colorCycleBrush.setPlaying(false);
          }

          if (typeof colorCycleBrush.markLayerHasExternalBase === 'function') {
            try {
              colorCycleBrush.markLayerHasExternalBase(layer.id);
            } catch (error) {
              console.warn('[projectIO] Failed to flag restored color cycle base (brush state):', error);
            }
          }

          continue;
        } catch (error) {
          console.error('[projectIO] Failed to restore color cycle brush state:', error);
        }
      }
      // Check if we have saved WebGL state
      const savedState = savedWebGLStates.get(layer);
      if (savedState) {
        // Create new color cycle brush
        const colorCycleBrush = createColorCycleBrush(layer.colorCycleData.canvas!);
        if (typeof colorCycleBrush.setLayerId === 'function') {
          try {
            colorCycleBrush.setLayerId(layer.id);
          } catch (error) {
            console.warn('[projectIO] Failed to assign layerId to restored CC brush (WebGL state):', error);
          }
        }
        
        // Restore the WebGL state
        const layerSnapshots = new Map<string, ArrayBuffer>();
        for (const snapshot of savedState.layerSnapshots) {
          layerSnapshots.set(snapshot.layerId, base64ToArrayBuffer(snapshot.data));
        }
        
        colorCycleBrush.restoreFullState({
          gradients: savedState.gradients,
          animationState: savedState.animationState,
          layerSnapshots
        });
        
        // Attach the brush to the layer
        layer.colorCycleData.colorCycleBrush = colorCycleBrush;
        
        // Clean up the temporary saved state
        savedWebGLStates.delete(layer);
        
        // Start animation if it was animating
        if (layer.colorCycleData.isAnimating) {
          colorCycleBrush.setPlaying(!savedState.animationState.isPaused);
        }

        if (typeof colorCycleBrush.markLayerHasExternalBase === 'function') {
          try {
            colorCycleBrush.markLayerHasExternalBase(layer.id);
          } catch (error) {
            console.warn('[projectIO] Failed to flag restored color cycle base (WebGL state):', error);
          }
        }
      } else {
        // No saved state, create a new brush with the gradient
        const colorCycleBrush = createColorCycleBrush(layer.colorCycleData.canvas!);
        if (typeof colorCycleBrush.setLayerId === 'function') {
          try {
            colorCycleBrush.setLayerId(layer.id);
          } catch (error) {
            console.warn('[projectIO] Failed to assign layerId to restored CC brush (fallback):', error);
          }
        }
        if (layer.colorCycleData.gradient) {
          colorCycleBrush.setGradient(layer.colorCycleData.gradient);
        }
        if (typeof layer.colorCycleData.brushSpeed === 'number') {
          try {
            colorCycleBrush.setSpeed(layer.colorCycleData.brushSpeed);
          } catch (error) {
            console.warn('[projectIO] Failed to restore color cycle speed:', error);
          }
        }
        layer.colorCycleData.colorCycleBrush = colorCycleBrush;

        if (imageDataHasVisiblePixels(layer.imageData)) {
          if (layer.imageData) {
            try {
              const ctx = layer.colorCycleData.canvas?.getContext('2d', { willReadFrequently: true });
              ctx?.putImageData(layer.imageData, 0, 0);
            } catch {}
          }
          if (typeof colorCycleBrush.markLayerHasExternalBase === 'function') {
            try {
              colorCycleBrush.markLayerHasExternalBase(layer.id);
            } catch {}
          }
        }
      }
    }
  }
  
  // Return the modified layers
  return layers;
}

// Export project as PNG
export async function exportProjectAsPNG(
  project: Project, 
  layers: Layer[], 
  options: {
    includeBackground?: boolean;
    scale?: number;
    quality?: number;
  } = {}
): Promise<void> {
  const { includeBackground = true, scale = 1, quality = 1 } = options;
  
  const canvas = document.createElement('canvas');
  canvas.width = project.width * scale;
  canvas.height = project.height * scale;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Scale context if needed
  if (scale !== 1) {
    ctx.scale(scale, scale);
  }
  
  // Draw background if requested
  if (includeBackground) {
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  
  // Draw layers in order
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible || !layer.imageData) continue;
    
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    
    // Create temporary canvas for the layer
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.imageData.width;
    layerCanvas.height = layer.imageData.height;
    const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (layerCtx) {
      layerCtx.putImageData(layer.imageData, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }
  
  // Save as PNG
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png', quality);
}

// Validate project file format
export function validateProjectFile(projectData: string): { valid: boolean; error?: string } {
  try {
    const project = JSON.parse(projectData);
    
    if (!project.version) {
      return { valid: false, error: 'Missing version information' };
    }
    
    if (!project.project) {
      return { valid: false, error: 'Missing project data' };
    }
    
    const { project: projectInfo } = project;
    
    if (!projectInfo.id || !projectInfo.name || !projectInfo.width || !projectInfo.height) {
      return { valid: false, error: 'Missing required project properties' };
    }
    
    if (!Array.isArray(projectInfo.layers)) {
      return { valid: false, error: 'Invalid layers data' };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid JSON format' };
  }
}
