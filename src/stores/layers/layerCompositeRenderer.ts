import type { Layer, Project } from '@/types';

export type StaticCompositeSegment = {
  kind: 'static';
  id: string;
  layerIds: string[];
  includeBackground: boolean;
  orderRange: { start: number; end: number };
  canvas: HTMLCanvasElement;
  bitmap: ImageBitmap | null;
  dirty: boolean;
};

export type ColorCycleCompositeSegment = {
  kind: 'color-cycle';
  id: string;
  layerId: string;
  blendMode: GlobalCompositeOperation;
  opacity: number;
};

export type SequentialCompositeSegment = {
  kind: 'sequential';
  id: string;
  layerId: string;
  blendMode: GlobalCompositeOperation;
  opacity: number;
};

export type CompositeSegment =
  | StaticCompositeSegment
  | ColorCycleCompositeSegment
  | SequentialCompositeSegment;

export type StaticSegmentDescriptor = {
  kind: 'static';
  layerIds: string[];
  includeBackground: boolean;
  orderRange: { start: number; end: number };
};

export type DynamicSegmentDescriptor = {
  kind: 'color-cycle' | 'sequential';
  layerId: string;
  blendMode: GlobalCompositeOperation;
  opacity: number;
};

export type SegmentDescriptor = StaticSegmentDescriptor | DynamicSegmentDescriptor;

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type CreateStaticCompositeCanvas = (
  width: number,
  height: number
) => HTMLCanvasElement;

export type CreateLayerTransferCanvas = (
  width: number,
  height: number
) => HTMLCanvasElement | OffscreenCanvas | null;

export const buildCompositeSegmentDescriptors = (
  sortedLayers: Layer[],
  project: Project
): SegmentDescriptor[] => {
  const descriptors: SegmentDescriptor[] = [];
  let pendingStatic: Layer[] = [];
  const shouldPaintBackground = Boolean(
    project.backgroundColor && project.backgroundColor !== 'transparent'
  );
  let includeBackgroundNext = shouldPaintBackground;

  const flushStaticSegment = () => {
    if (!pendingStatic.length && !includeBackgroundNext) {
      return;
    }

    const layerIds = pendingStatic.map((layer) => layer.id);
    const orderStart = pendingStatic.length ? pendingStatic[0].order : Number.NEGATIVE_INFINITY;
    const orderEnd = pendingStatic.length
      ? pendingStatic[pendingStatic.length - 1].order
      : orderStart;
    descriptors.push({
      kind: 'static',
      layerIds,
      includeBackground: includeBackgroundNext,
      orderRange: {
        start: orderStart,
        end: orderEnd,
      },
    });
    includeBackgroundNext = false;
    pendingStatic = [];
  };

  for (const layer of sortedLayers) {
    if (!layer.visible) {
      continue;
    }

    if (layer.layerType === 'color-cycle') {
      flushStaticSegment();
      descriptors.push({
        kind: 'color-cycle',
        layerId: layer.id,
        blendMode: layer.blendMode,
        opacity: layer.opacity,
      });
      continue;
    }

    if (layer.layerType === 'sequential') {
      flushStaticSegment();
      descriptors.push({
        kind: 'sequential',
        layerId: layer.id,
        blendMode: layer.blendMode,
        opacity: layer.opacity,
      });
      continue;
    }

    pendingStatic.push(layer);
  }

  flushStaticSegment();

  if (!descriptors.length) {
    descriptors.push({
      kind: 'static',
      layerIds: [],
      includeBackground: includeBackgroundNext,
      orderRange: { start: Number.NEGATIVE_INFINITY, end: Number.NEGATIVE_INFINITY },
    });
  }

  return descriptors;
};

export const compositeSegmentStructureMatches = (
  segments: CompositeSegment[],
  descriptors: SegmentDescriptor[]
): boolean =>
  segments.length === descriptors.length &&
  segments.every((segment, index) => {
    const descriptor = descriptors[index];
    if (!descriptor || segment.kind !== descriptor.kind) {
      return false;
    }

    if (descriptor.kind === 'static' && segment.kind === 'static') {
      if (segment.includeBackground !== descriptor.includeBackground) {
        return false;
      }
      if (segment.layerIds.length !== descriptor.layerIds.length) {
        return false;
      }
      for (let idx = 0; idx < descriptor.layerIds.length; idx += 1) {
        if (segment.layerIds[idx] !== descriptor.layerIds[idx]) {
          return false;
        }
      }
      return true;
    }

    if (descriptor.kind === 'color-cycle' && segment.kind === 'color-cycle') {
      return segment.layerId === descriptor.layerId;
    }

    if (descriptor.kind === 'sequential' && segment.kind === 'sequential') {
      return segment.layerId === descriptor.layerId;
    }

    return false;
  });

const makeStaticSegment = (
  descriptor: StaticSegmentDescriptor,
  index: number,
  width: number,
  height: number,
  createStaticCanvas: CreateStaticCompositeCanvas,
  now: () => number
): StaticCompositeSegment => {
  const canvas = createStaticCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  return {
    kind: 'static',
    id: `static-${now()}-${index}`,
    layerIds: descriptor.layerIds,
    includeBackground: descriptor.includeBackground,
    orderRange: descriptor.orderRange,
    canvas,
    bitmap: null,
    dirty: true,
  };
};

export const createNextCompositeSegments = ({
  descriptors,
  previousSegments,
  structuresMatch,
  width,
  height,
  createStaticCanvas,
  now = Date.now,
}: {
  descriptors: SegmentDescriptor[];
  previousSegments: CompositeSegment[];
  structuresMatch: boolean;
  width: number;
  height: number;
  createStaticCanvas: CreateStaticCompositeCanvas;
  now?: () => number;
}): CompositeSegment[] =>
  descriptors.map((descriptor, index) => {
    if (descriptor.kind === 'static') {
      if (structuresMatch) {
        const previous = previousSegments[index] as StaticCompositeSegment;
        return {
          ...previous,
          layerIds: descriptor.layerIds,
          includeBackground: descriptor.includeBackground,
          orderRange: descriptor.orderRange,
        };
      }
      return makeStaticSegment(descriptor, index, width, height, createStaticCanvas, now);
    }

    if (structuresMatch) {
      const previous = previousSegments[index] as ColorCycleCompositeSegment | SequentialCompositeSegment;
      return {
        ...previous,
        blendMode: descriptor.blendMode,
        opacity: descriptor.opacity,
      };
    }

    if (descriptor.kind === 'sequential') {
      return {
        kind: 'sequential',
        id: `seq-${descriptor.layerId}-${index}`,
        layerId: descriptor.layerId,
        blendMode: descriptor.blendMode,
        opacity: descriptor.opacity,
      };
    }

    return {
      kind: 'color-cycle',
      id: `cc-${descriptor.layerId}-${index}`,
      layerId: descriptor.layerId,
      blendMode: descriptor.blendMode,
      opacity: descriptor.opacity,
    };
  });

export const repaintStaticCompositeSegment = ({
  segment,
  layerIds,
  layerLookup,
  project,
  width,
  height,
  createLayerTransferCanvas,
}: {
  segment: StaticCompositeSegment;
  layerIds: string[];
  layerLookup: Map<string, Layer>;
  project: Project;
  width: number;
  height: number;
  createLayerTransferCanvas: CreateLayerTransferCanvas;
}): StaticCompositeSegment => {
  if (segment.canvas.width !== width || segment.canvas.height !== height) {
    segment.canvas.width = width;
    segment.canvas.height = height;
  }

  const ctx = segment.canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | null;
  if (!ctx) {
    return segment;
  }

  ctx.clearRect(0, 0, width, height);
  if (segment.includeBackground && project.backgroundColor && project.backgroundColor !== 'transparent') {
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  for (const layerId of layerIds) {
    const layer = layerLookup.get(layerId);
    if (
      !layer ||
      !layer.visible ||
      layer.layerType === 'color-cycle' ||
      layer.layerType === 'sequential'
    ) {
      continue;
    }

    let source: CanvasImageSource | null = null;
    if (layer.framebuffer) {
      source = layer.framebuffer as CanvasImageSource;
    } else if (layer.imageData) {
      const transferCanvas = createLayerTransferCanvas(
        layer.imageData.width,
        layer.imageData.height
      );
      if (transferCanvas) {
        const transferCtx = transferCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as Canvas2DContext | null;
        transferCtx?.putImageData(layer.imageData, 0, 0);
        source = transferCanvas as CanvasImageSource;
      }
    }

    if (!source) {
      continue;
    }

    ctx.globalCompositeOperation = layer.blendMode;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(source, 0, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  return { ...segment, dirty: false };
};

export const realizeCompositeSegments = ({
  sortedLayers,
  project,
  previousSegments,
  width,
  height,
  createStaticCanvas,
  createLayerTransferCanvas,
}: {
  sortedLayers: Layer[];
  project: Project;
  previousSegments: CompositeSegment[];
  width: number;
  height: number;
  createStaticCanvas: CreateStaticCompositeCanvas;
  createLayerTransferCanvas: CreateLayerTransferCanvas;
}): {
  segments: CompositeSegment[];
  anySegmentUpdated: boolean;
} => {
  const descriptors = buildCompositeSegmentDescriptors(sortedLayers, project);
  const structuresMatch = compositeSegmentStructureMatches(previousSegments, descriptors);
  const nextSegments = createNextCompositeSegments({
    descriptors,
    previousSegments,
    structuresMatch,
    width,
    height,
    createStaticCanvas,
  });
  const layerLookup = new Map(sortedLayers.map((layer) => [layer.id, layer]));

  let anySegmentUpdated = !structuresMatch;
  const segments = nextSegments.map((segment) => {
    if (segment.kind === 'static' && (segment.dirty || !structuresMatch)) {
      anySegmentUpdated = true;
      return repaintStaticCompositeSegment({
        segment,
        layerIds: segment.layerIds,
        layerLookup,
        project,
        width,
        height,
        createLayerTransferCanvas,
      });
    }

    return segment;
  });

  return {
    segments,
    anySegmentUpdated,
  };
};
