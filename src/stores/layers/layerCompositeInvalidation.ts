type StaticCompositeSegment = {
  kind: 'static';
  layerIds: string[];
  dirty: boolean;
};

type CompositeSegmentLike = StaticCompositeSegment | { kind: string; [key: string]: unknown };

const isStaticCompositeSegment = (
  segment: CompositeSegmentLike
): segment is StaticCompositeSegment => segment.kind === 'static';

export const markStaticCompositeSegmentsDirty = <TSegment extends CompositeSegmentLike>(
  segments: TSegment[]
): TSegment[] =>
  segments.map((segment) =>
    isStaticCompositeSegment(segment)
      ? ({ ...segment, dirty: true } as TSegment)
      : segment
  );

export const hasCleanStaticCompositeSegments = (
  segments: CompositeSegmentLike[]
): boolean =>
  segments.some((segment) => isStaticCompositeSegment(segment) && !segment.dirty);

export const markCompositeSegmentsDirtyByLayerIds = <TSegment extends CompositeSegmentLike>(
  segments: TSegment[],
  layerIds: string[]
): TSegment[] => {
  if (layerIds.length === 0) {
    return segments;
  }
  const dirtyLayerIds = new Set(layerIds);
  return segments.map((segment) =>
    isStaticCompositeSegment(segment) && segment.layerIds.some((layerId) => dirtyLayerIds.has(layerId))
      ? ({ ...segment, dirty: true } as TSegment)
      : segment
  );
};
