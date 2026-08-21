import type { InterlaceGroupSettings, Layer, Project } from '@/types';
import {
  drawLayerOwnedProjectObjectsForLayer,
  hasLayerOwnedProjectObjects,
} from '@/utils/layerOwnedProjectObjects';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import {
  coalesceColorCycleDirtyRects,
  type ColorCycleDirtyRect,
  type ColorCycleLayerDirtyBatch,
} from '@/lib/colorCycle/document/ColorCycleLayerDocument';

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

export type InterlaceCompositeSegment = {
  kind: 'interlace';
  id: string;
  groupId: string;
  layerIds: string[];
  settings: InterlaceGroupSettings;
};

export type CompositeSegment =
  | StaticCompositeSegment
  | ColorCycleCompositeSegment
  | SequentialCompositeSegment
  | InterlaceCompositeSegment;

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

export type InterlaceSegmentDescriptor = {
  kind: 'interlace';
  groupId: string;
  layerIds: string[];
  settings: InterlaceGroupSettings;
};

export type SegmentDescriptor = StaticSegmentDescriptor | DynamicSegmentDescriptor | InterlaceSegmentDescriptor;

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type CreateStaticCompositeCanvas = (
  width: number,
  height: number
) => HTMLCanvasElement;

export type CreateLayerTransferCanvas = (
  width: number,
  height: number
) => HTMLCanvasElement | OffscreenCanvas | null;

const normalizeDirtyRect = (
  rect: ColorCycleDirtyRect,
  width: number,
  height: number
): ColorCycleDirtyRect | null => {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

const collectStaticSegmentDirtyRects = (
  segment: StaticCompositeSegment,
  dirtyBatches: ColorCycleLayerDirtyBatch[] | undefined,
  width: number,
  height: number
): ColorCycleDirtyRect[] => {
  if (!dirtyBatches?.length) {
    return [];
  }
  const segmentLayerIds = new Set(segment.layerIds);
  const rects: ColorCycleDirtyRect[] = [];
  dirtyBatches.forEach((batch) => {
    if (!segmentLayerIds.has(batch.layerId)) {
      return;
    }
    batch.rects.forEach((rect) => {
      const normalized = normalizeDirtyRect(rect, width, height);
      if (normalized) {
        rects.push(normalized);
      }
    });
  });
  return coalesceColorCycleDirtyRects(rects);
};

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
  const layerGroups = new Map((project.layerGroups ?? []).map((group) => [group.id, group]));
  const interlaceMembers = new Map<string, Layer[]>();
  sortedLayers.forEach((layer) => {
    const group = layer.groupId ? layerGroups.get(layer.groupId) : undefined;
    if (layer.visible && layer.layerType !== 'sequential' && isInterlaceGroup(group)) {
      interlaceMembers.set(group.id, [...(interlaceMembers.get(group.id) ?? []), layer]);
    }
  });
  const emittedInterlaceGroups = new Set<string>();

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

    const group = layer.groupId ? layerGroups.get(layer.groupId) : undefined;
    const groupMembers = group ? interlaceMembers.get(group.id) : undefined;
    if (isInterlaceGroup(group) && groupMembers && groupMembers.length >= 2) {
      if (!emittedInterlaceGroups.has(group.id)) {
        flushStaticSegment();
        descriptors.push({
          kind: 'interlace',
          groupId: group.id,
          layerIds: groupMembers.map((member) => member.id),
          settings: { ...group.interlace },
        });
        emittedInterlaceGroups.add(group.id);
      }
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

    if (descriptor.kind === 'interlace' && segment.kind === 'interlace') {
      return segment.groupId === descriptor.groupId
        && segment.layerIds.length === descriptor.layerIds.length
        && segment.layerIds.every((id, layerIndex) => id === descriptor.layerIds[layerIndex]);
    }

    if (descriptor.kind === 'color-cycle' && segment.kind === 'color-cycle') {
      return segment.layerId === descriptor.layerId;
    }

    if (descriptor.kind === 'sequential' && segment.kind === 'sequential') {
      return segment.layerId === descriptor.layerId;
    }

    return false;
  });

const interlaceSettingsMatch = (
  current: InterlaceGroupSettings,
  next: InterlaceGroupSettings,
): boolean =>
  current.cellSize === next.cellSize &&
  current.dominance === next.dominance &&
  current.patternPreset === next.patternPreset &&
  current.motionMode === next.motionMode &&
  current.direction === next.direction &&
  current.travelCycles === next.travelCycles &&
  current.loopDurationSeconds === next.loopDurationSeconds &&
  current.seed === next.seed;

const compositeSegmentPresentationMatches = (
  segment: CompositeSegment,
  descriptor: SegmentDescriptor,
): boolean => {
  if (segment.kind !== descriptor.kind) {
    return false;
  }
  if (segment.kind === 'interlace' && descriptor.kind === 'interlace') {
    return interlaceSettingsMatch(segment.settings, descriptor.settings);
  }
  if (segment.kind === 'color-cycle' && descriptor.kind === 'color-cycle') {
    return segment.blendMode === descriptor.blendMode && segment.opacity === descriptor.opacity;
  }
  if (segment.kind === 'sequential' && descriptor.kind === 'sequential') {
    return segment.blendMode === descriptor.blendMode && segment.opacity === descriptor.opacity;
  }
  return true;
};

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
      const previous = previousSegments[index] as
        | ColorCycleCompositeSegment
        | SequentialCompositeSegment
        | InterlaceCompositeSegment;
      if (descriptor.kind === 'interlace') {
        return {
          ...previous,
          layerIds: descriptor.layerIds,
          settings: descriptor.settings,
        } as InterlaceCompositeSegment;
      }
      return {
        ...previous,
        blendMode: descriptor.blendMode,
        opacity: descriptor.opacity,
      };
    }


    if (descriptor.kind === 'interlace') {
      return {
        kind: 'interlace',
        id: `interlace-${descriptor.groupId}-${index}`,
        groupId: descriptor.groupId,
        layerIds: descriptor.layerIds,
        settings: descriptor.settings,
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
  dirtyRects,
}: {
  segment: StaticCompositeSegment;
  layerIds: string[];
  layerLookup: Map<string, Layer>;
  project: Project;
  width: number;
  height: number;
  createLayerTransferCanvas: CreateLayerTransferCanvas;
  dirtyRects?: ColorCycleDirtyRect[];
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

  const normalizedDirtyRects = dirtyRects
    ?.map((rect) => normalizeDirtyRect(rect, width, height))
    .filter((rect): rect is ColorCycleDirtyRect => Boolean(rect));
  const shouldPartialRepaint = Boolean(normalizedDirtyRects?.length);

  if (shouldPartialRepaint && normalizedDirtyRects) {
    normalizedDirtyRects.forEach((rect) => {
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
      if (segment.includeBackground && project.backgroundColor && project.backgroundColor !== 'transparent') {
        ctx.fillStyle = project.backgroundColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    });
    ctx.save();
    ctx.beginPath();
    normalizedDirtyRects.forEach((rect) => {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    });
    ctx.clip();
  } else {
    ctx.clearRect(0, 0, width, height);
    if (segment.includeBackground && project.backgroundColor && project.backgroundColor !== 'transparent') {
      ctx.fillStyle = project.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }
  }

  for (const layerId of layerIds) {
    const layer = layerLookup.get(layerId);
    if (
      !layer ||
      !layer.visible ||
      layer.layerType === 'adjustment' ||
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

    const hasSemanticObjects = layer.layerType === 'normal'
      && hasLayerOwnedProjectObjects(project, layer.id);
    if (!source && !hasSemanticObjects) continue;

    ctx.globalCompositeOperation = layer.blendMode;
    ctx.globalAlpha = layer.opacity;
    if (source) ctx.drawImage(source, 0, 0);
    if (layer.layerType === 'normal') {
      drawLayerOwnedProjectObjectsForLayer(
        ctx,
        project,
        layer.id,
        shouldPartialRepaint ? normalizedDirtyRects : undefined,
      );
    }
  }

  if (shouldPartialRepaint) {
    ctx.restore();
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
  dirtyBatches,
}: {
  sortedLayers: Layer[];
  project: Project;
  previousSegments: CompositeSegment[];
  width: number;
  height: number;
  createStaticCanvas: CreateStaticCompositeCanvas;
  createLayerTransferCanvas: CreateLayerTransferCanvas;
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
}): {
  segments: CompositeSegment[];
  anySegmentUpdated: boolean;
  fullStaticRedrawNeeded: boolean;
  staticDirtyRects: ColorCycleDirtyRect[];
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

  const presentationChanged = structuresMatch && previousSegments.some((segment, index) => (
    !compositeSegmentPresentationMatches(segment, descriptors[index])
  ));
  let anySegmentUpdated = !structuresMatch || presentationChanged;
  let fullStaticRedrawNeeded = !structuresMatch;
  const staticDirtyRects: ColorCycleDirtyRect[] = [];
  const segments = nextSegments.map((segment) => {
    if (segment.kind !== 'static') {
      return segment;
    }

    const segmentDirtyRects = structuresMatch
      ? collectStaticSegmentDirtyRects(segment, dirtyBatches, width, height)
      : [];
    if (segment.dirty || !structuresMatch) {
      anySegmentUpdated = true;
      fullStaticRedrawNeeded = true;
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

    if (segmentDirtyRects.length > 0) {
      anySegmentUpdated = true;
      staticDirtyRects.push(...segmentDirtyRects);
      return repaintStaticCompositeSegment({
        segment,
        layerIds: segment.layerIds,
        layerLookup,
        project,
        width,
        height,
        createLayerTransferCanvas,
        dirtyRects: segmentDirtyRects,
      });
    }

    return segment;
  });

  return {
    segments,
    anySegmentUpdated,
    fullStaticRedrawNeeded,
    staticDirtyRects,
  };
};
