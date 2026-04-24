import type { LayerContentMetrics } from '@/utils/layerMetrics';
import { toNum } from '@/utils/num';
import type { Layer, Project } from '@/types';
import type {
  AlignmentExportPayload,
  WebGLLayerBounds,
  WebGLLayerMetadata,
  WebGLSerializedColorCycle,
  WebGLSerializedSequential,
} from '@/utils/export/goblet/gobletTypes';

type LegacyLayerBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type GobletSequentialTextureFrames = {
  frames: string[];
  frameMap: number[];
};

export const resolveDocumentBoundsPx = (
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

export const getLayerSurfaceSize = (layer: Layer, project?: Project | null) => {
  const framebuffer = layer.framebuffer;
  const fallbackWidth = project?.width ?? layer.imageData?.width ?? 1;
  const fallbackHeight = project?.height ?? layer.imageData?.height ?? 1;

  const width = Math.max(1, framebuffer?.width ?? fallbackWidth);
  const height = Math.max(1, framebuffer?.height ?? fallbackHeight);

  return { width, height };
};

export const createLayerMetadata = ({
  layer,
  index,
  surfaceSize,
  stackBoundsPayload,
  documentBoundsPx,
  documentBoundsPercent,
  alignment,
  texture,
  sequentialFrames,
  colorCycle,
  sequential,
}: {
  layer: Layer;
  index: number;
  surfaceSize: { width: number; height: number };
  stackBoundsPayload: WebGLLayerBounds;
  documentBoundsPx: WebGLLayerBounds;
  documentBoundsPercent: WebGLLayerBounds;
  alignment: AlignmentExportPayload;
  texture?: string;
  sequentialFrames?: GobletSequentialTextureFrames;
  colorCycle?: WebGLSerializedColorCycle;
  sequential?: WebGLSerializedSequential;
}): WebGLLayerMetadata => ({
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
  pixelBoundsPx: stackBoundsPayload,
  documentBoundsPx,
  documentBoundsPercent,
  alignment,
  contentBounds: stackBoundsPayload,
  paintedSize: {
    width: stackBoundsPayload.width,
    height: stackBoundsPayload.height
  },
  assets: texture || sequentialFrames
    ? {
        ...(texture ? { texture } : {}),
        ...(sequentialFrames
          ? {
              textureFrames: sequentialFrames.frames,
              textureFrameMap: sequentialFrames.frameMap
            }
          : {}),
      }
    : undefined,
  colorCycle,
  sequential,
  stackIndex: Number.isFinite(layer.order) ? layer.order : index,
  version: layer.version
});

export const stripLayerDefaults = (layer: WebGLLayerMetadata): WebGLLayerMetadata => layer;
