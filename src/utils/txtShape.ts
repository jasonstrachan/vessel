import type {
  Layer,
  TxtShape,
  TxtShapeColorSource,
  TxtShapeRegionPoint,
  TxtShapeSelectionRange,
  TxtShapeTextAlign,
} from '@/types';
import {
  layoutTxtShapeText,
  type TxtShapeLayoutLine,
} from '@/utils/txtShapeLayout';
import {
  getTxtShapeFontDefinition,
  getTxtShapeFontMinimumSize,
  isTxtShapeFontFamily,
} from '@/utils/txtShapeFonts';

export const TXT_SHAPE_MIN_SIZE = 16;
export const TXT_SHAPE_DEFAULT_CONTENT = 'SELECTED TEXT';

let transientSelectionOverrides = new Map<string, readonly TxtShapeSelectionRange[]>();
let transientSelectionRevision = 0;

export const setTxtShapeTransientSelectionOverrides = (
  overrides: ReadonlyMap<string, readonly TxtShapeSelectionRange[]> | null,
): number => {
  transientSelectionOverrides = overrides ? new Map(overrides) : new Map();
  transientSelectionRevision += 1;
  return transientSelectionRevision;
};

export const clearTxtShapeTransientSelectionOverrides = (): number =>
  setTxtShapeTransientSelectionOverrides(null);

export const getTxtShapeTransientSelectionRevision = (): number => transientSelectionRevision;

const resolveTxtShapeSelections = (shape: TxtShape): readonly TxtShapeSelectionRange[] =>
  transientSelectionOverrides.get(shape.id) ?? shape.selections;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const isCssColor = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128;

export const getTxtShapeRegionPathArea = (points: readonly TxtShapeRegionPoint[]): number => {
  if (points.length < 3) return 0;
  const doubledArea = points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(doubledArea) / 2;
};

const normalizeRegionPath = (value: unknown): TxtShapeRegionPoint[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const points = value.slice(0, 4_096).reduce<TxtShapeRegionPoint[]>((result, point) => {
    if (!point || typeof point !== 'object') return result;
    const candidate = point as Partial<TxtShapeRegionPoint>;
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return result;
    result.push({
      x: clamp(candidate.x as number, 0, 1),
      y: clamp(candidate.y as number, 0, 1),
    });
    return result;
  }, []);
  return points.length >= 3 && getTxtShapeRegionPathArea(points) >= 0.0001
    ? points
    : undefined;
};

export const normalizeTxtShapeSelections = (
  ranges: unknown,
  contentLength: number,
): TxtShapeSelectionRange[] => {
  if (!Array.isArray(ranges) || contentLength <= 0) {
    return [];
  }

  const normalized = ranges
    .map((range) => {
      const candidate = range as Partial<TxtShapeSelectionRange> | null;
      const start = clamp(Math.round(finite(candidate?.start, 0)), 0, contentLength);
      const end = clamp(Math.round(finite(candidate?.end, 0)), 0, contentLength);
      return start < end ? { start, end } : null;
    })
    .filter((range): range is TxtShapeSelectionRange => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return normalized.reduce<TxtShapeSelectionRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []);
};

export const updateTxtShapeSelectionsForContent = (
  previousContent: string,
  nextContent: string,
  selections: readonly TxtShapeSelectionRange[],
): TxtShapeSelectionRange[] => {
  const previousSelections = normalizeTxtShapeSelections(selections, previousContent.length);
  const wasFullySelected = previousContent.length > 0
    && previousSelections.length === 1
    && previousSelections[0].start === 0
    && previousSelections[0].end === previousContent.length;
  if (wasFullySelected) {
    return nextContent.length > 0 ? [{ start: 0, end: nextContent.length }] : [];
  }

  let editStart = 0;
  while (
    editStart < previousContent.length
    && editStart < nextContent.length
    && previousContent[editStart] === nextContent[editStart]
  ) {
    editStart += 1;
  }
  let commonSuffixLength = 0;
  while (
    commonSuffixLength < previousContent.length - editStart
    && commonSuffixLength < nextContent.length - editStart
    && previousContent[previousContent.length - 1 - commonSuffixLength]
      === nextContent[nextContent.length - 1 - commonSuffixLength]
  ) {
    commonSuffixLength += 1;
  }
  const previousEditEnd = previousContent.length - commonSuffixLength;
  const nextEditEnd = nextContent.length - commonSuffixLength;
  const delta = nextContent.length - previousContent.length;

  return normalizeTxtShapeSelections(previousSelections.map((selection) => {
    if (previousEditEnd <= selection.start) {
      return { start: selection.start + delta, end: selection.end + delta };
    }
    if (editStart >= selection.end) {
      return selection;
    }
    return {
      start: Math.min(selection.start, editStart),
      end: Math.max(nextEditEnd, selection.end + delta),
    };
  }), nextContent.length);
};

export const normalizeTxtShape = (
  value: unknown,
  projectWidth: number,
  projectHeight: number,
  index = 0,
  layerId = '',
): TxtShape | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<TxtShape>;
  const content = typeof candidate.content === 'string'
    ? candidate.content.slice(0, 20_000)
    : TXT_SHAPE_DEFAULT_CONTENT;
  const width = clamp(
    finite(candidate.width, Math.min(320, projectWidth)),
    TXT_SHAPE_MIN_SIZE,
    Math.max(TXT_SHAPE_MIN_SIZE, projectWidth),
  );
  const height = clamp(
    finite(candidate.height, Math.min(160, projectHeight)),
    TXT_SHAPE_MIN_SIZE,
    Math.max(TXT_SHAPE_MIN_SIZE, projectHeight),
  );
  const now = Date.now();
  const fontFamily = isTxtShapeFontFamily(candidate.fontFamily)
    ? candidate.fontFamily
    : 'monospace';
  const textAlign: TxtShapeTextAlign = candidate.textAlign === 'center' || candidate.textAlign === 'right'
    ? candidate.textAlign
    : 'left';
  const colorSource: TxtShapeColorSource = candidate.colorSource === 'palette'
    || candidate.colorSource === 'sample'
    || candidate.colorSource === 'manual'
    ? candidate.colorSource
    : 'foreground';
  const requestedRegionKind = candidate.regionKind === 'oval' || candidate.regionKind === 'freehand'
    ? candidate.regionKind
    : 'rectangle';
  const regionPath = requestedRegionKind === 'freehand'
    ? normalizeRegionPath(candidate.regionPath)
    : undefined;
  const regionKind = requestedRegionKind === 'freehand' && !regionPath
    ? 'rectangle'
    : requestedRegionKind;
  const padding = clamp(
    finite(candidate.padding, 0),
    0,
    Math.max(0, Math.min(width, height) / 2 - 0.5),
  );

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `txt-shape-${now}-${index}`,
    layerId,
    x: clamp(finite(candidate.x, 0), 0, Math.max(0, projectWidth - width)),
    y: clamp(finite(candidate.y, 0), 0, Math.max(0, projectHeight - height)),
    width,
    height,
    ...(padding > 0 ? { padding } : {}),
    ...(regionKind === 'rectangle' ? {} : { regionKind }),
    ...(regionPath ? { regionPath } : {}),
    content,
    fontFamily,
    fontSize: clamp(
      finite(candidate.fontSize, 24),
      getTxtShapeFontMinimumSize(fontFamily),
      512,
    ),
    lineHeight: clamp(finite(candidate.lineHeight, 1.2), 0.75, 4),
    textAlign,
    colorSource,
    color: isCssColor(candidate.color) ? candidate.color : '#000000',
    selectionColor: isCssColor(candidate.selectionColor) ? candidate.selectionColor : '#ffffff',
    selectionBackgroundColor: isCssColor(candidate.selectionBackgroundColor)
      ? candidate.selectionBackgroundColor
      : '#000000',
    selections: normalizeTxtShapeSelections(candidate.selections, content.length),
    createdAt: finite(candidate.createdAt, now),
    updatedAt: finite(candidate.updatedAt, now),
  };
};

export interface TxtShapeHorizontalSpan {
  left: number;
  right: number;
}

export const getTxtShapePadding = (
  shape: Pick<TxtShape, 'width' | 'height' | 'padding'>,
): number => clamp(
  finite(shape.padding, 0),
  0,
  Math.max(0, Math.min(shape.width, shape.height) / 2 - 0.5),
);

export const getTxtShapeHorizontalSpan = (
  shape: Pick<TxtShape, 'width' | 'height' | 'regionKind' | 'regionPath'>,
  y: number,
): TxtShapeHorizontalSpan | null => {
  if (shape.width <= 0 || shape.height <= 0 || y < 0 || y > shape.height) return null;
  if (shape.regionKind === 'oval') {
    const normalizedY = (y / shape.height - 0.5) * 2;
    const halfSpan = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)) * shape.width / 2;
    return { left: shape.width / 2 - halfSpan, right: shape.width / 2 + halfSpan };
  }
  if (shape.regionKind !== 'freehand' || !shape.regionPath || shape.regionPath.length < 3) {
    return { left: 0, right: shape.width };
  }

  const normalizedY = y / shape.height;
  const intersections: number[] = [];
  shape.regionPath.forEach((point, index) => {
    const next = shape.regionPath?.[(index + 1) % shape.regionPath.length];
    if (!next || point.y === next.y) return;
    const crosses = (point.y <= normalizedY && next.y > normalizedY)
      || (next.y <= normalizedY && point.y > normalizedY);
    if (!crosses) return;
    const ratio = (normalizedY - point.y) / (next.y - point.y);
    intersections.push((point.x + (next.x - point.x) * ratio) * shape.width);
  });
  intersections.sort((a, b) => a - b);
  let widest: TxtShapeHorizontalSpan | null = null;
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const span = { left: intersections[index], right: intersections[index + 1] };
    if (!widest || span.right - span.left > widest.right - widest.left) widest = span;
  }
  return widest;
};

export const getTxtShapeHorizontalSpanForBand = (
  shape: Pick<TxtShape, 'width' | 'height' | 'regionKind' | 'regionPath'>,
  top: number,
  bottom: number,
): TxtShapeHorizontalSpan | null => {
  if (bottom <= top || top < 0 || bottom > shape.height) return null;
  if (shape.regionKind !== 'oval' && shape.regionKind !== 'freehand') {
    return { left: 0, right: shape.width };
  }

  const bandYs = [top, bottom];
  if (shape.regionKind === 'freehand') {
    shape.regionPath?.forEach((point) => {
      const y = point.y * shape.height;
      if (y > top && y < bottom) bandYs.push(y);
    });
  }
  bandYs.sort((left, right) => left - right);
  const sampleYs = bandYs.flatMap((y, index) => {
    const nextY = bandYs[index + 1];
    return nextY === undefined ? [y] : [y, y + (nextY - y) / 2];
  });
  const freehandBottomEpsilon = Math.min(0.001, shape.height * 0.000001);
  let left = 0;
  let right = shape.width;
  for (const sampleY of sampleYs) {
    const y = shape.regionKind === 'freehand' && sampleY === shape.height
      ? Math.max(0, sampleY - freehandBottomEpsilon)
      : sampleY;
    const span = getTxtShapeHorizontalSpan(shape, y);
    if (!span) return null;
    left = Math.max(left, span.left);
    right = Math.min(right, span.right);
    if (right - left <= 0.01) return null;
  }
  return { left, right };
};

export const getTxtShapeClipPath = (
  shape: Pick<TxtShape, 'regionKind' | 'regionPath'>,
): string | undefined => {
  if (shape.regionKind === 'oval') return 'ellipse(50% 50% at 50% 50%)';
  if (shape.regionKind !== 'freehand' || !shape.regionPath?.length) return undefined;
  return `polygon(${shape.regionPath.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(', ')})`;
};

export const getTxtShapeFlowInsetPath = (
  shape: Pick<
    TxtShape,
    'width' | 'height' | 'padding' | 'fontSize' | 'lineHeight' | 'regionKind' | 'regionPath'
  >,
  side: 'left' | 'right',
): string => {
  const padding = getTxtShapePadding(shape);
  const contentWidth = Math.max(1, shape.width - padding * 2);
  const contentHeight = Math.max(1, shape.height - padding * 2);
  const lineHeight = Math.max(1, shape.fontSize * shape.lineHeight);
  const bandCount = Math.max(1, Math.floor(contentHeight / lineHeight));
  const points: string[] = [side === 'left' ? '0% 0%' : '100% 0%'];
  for (let index = 0; index <= bandCount; index += 1) {
    const y = Math.min(contentHeight, index * lineHeight);
    const outerTop = Math.min(shape.height - padding, padding + y);
    const outerBottom = Math.min(shape.height - padding, outerTop + lineHeight);
    const span = getTxtShapeHorizontalSpanForBand(shape, outerTop, outerBottom);
    const inset = side === 'left'
      ? Math.max(0, (span?.left ?? shape.width / 2) - padding)
      : Math.max(0, shape.width - padding - (span?.right ?? shape.width / 2));
    const amount = Math.max(0, Math.min(100, inset / Math.max(1, contentWidth / 2) * 100));
    points.push(`${side === 'left' ? amount : 100 - amount}% ${y / contentHeight * 100}%`);
  }
  points.push(side === 'left' ? '0% 100%' : '100% 100%');
  return `polygon(${points.join(', ')})`;
};

export const normalizeTxtShapes = (
  values: unknown,
  projectWidth: number,
  projectHeight: number,
  layers: readonly Pick<Layer, 'id' | 'layerType' | 'order'>[] = [],
): TxtShape[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalLayers = layers
    .filter((layer) => layer.layerType === 'normal')
    .sort((left, right) => right.order - left.order);
  const validLayerIds = new Set(normalLayers.map((layer) => layer.id));
  const fallbackLayerId = normalLayers[0]?.id ?? '';
  const ids = new Set<string>();
  return values.slice(0, 1_000).reduce<TxtShape[]>((shapes, value, index) => {
    const candidateLayerId = value && typeof value === 'object'
      && typeof (value as Partial<TxtShape>).layerId === 'string'
      ? (value as Partial<TxtShape>).layerId!.trim()
      : '';
    const layerId = validLayerIds.has(candidateLayerId)
      ? candidateLayerId
      : fallbackLayerId || candidateLayerId;
    const shape = normalizeTxtShape(value, projectWidth, projectHeight, index, layerId);
    if (!shape || ids.has(shape.id)) {
      return shapes;
    }
    ids.add(shape.id);
    shapes.push(shape);
    return shapes;
  }, []);
};

export const getTxtShapesForLayer = (
  shapes: readonly TxtShape[] | undefined,
  layerId: string,
): TxtShape[] => shapes?.filter((shape) => shape.layerId === layerId) ?? [];

export const getContrastingTxtColor = (color: string): '#000000' | '#ffffff' => {
  const match = color.trim().match(/^#([\da-f]{6})$/i);
  if (!match) {
    return '#ffffff';
  }
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.52 ? '#000000' : '#ffffff';
};

export const isTxtShapeIndexSelected = (
  selections: readonly TxtShapeSelectionRange[],
  index: number,
): boolean => selections.some((range) => index >= range.start && index < range.end);

export interface TxtShapeSegment {
  text: string;
  selected: boolean;
}

export const splitTxtShapeSegments = (shape: Pick<TxtShape, 'content' | 'selections'>): TxtShapeSegment[] => {
  if (!shape.content) {
    return [];
  }
  const boundaries = new Set<number>([0, shape.content.length]);
  normalizeTxtShapeSelections(shape.selections, shape.content.length).forEach(({ start, end }) => {
    boundaries.add(start);
    boundaries.add(end);
  });
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: TxtShapeSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    const text = shape.content.slice(start, end);
    if (!text) continue;
    segments.push({
      text,
      selected: isTxtShapeIndexSelected(shape.selections, start),
    });
  }
  return segments;
};

type TxtShapeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const clipTxtShapeRegion = (ctx: TxtShapeCanvasContext, shape: TxtShape): void => {
  ctx.beginPath();
  if (shape.regionKind === 'oval') {
    ctx.ellipse(
      shape.x + shape.width / 2,
      shape.y + shape.height / 2,
      shape.width / 2,
      shape.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else if (shape.regionKind === 'freehand' && shape.regionPath?.length) {
    shape.regionPath.forEach((point, index) => {
      const x = shape.x + point.x * shape.width;
      const y = shape.y + point.y * shape.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  } else {
    ctx.rect(shape.x, shape.y, shape.width, shape.height);
  }
  ctx.clip();
};

export interface TxtShapeTextLayout {
  lines: TxtShapeLayoutLine[];
  padding: number;
  lineHeightPx: number;
  didOverflow: boolean;
}

export const getTxtShapeTextLayout = (shape: TxtShape): TxtShapeTextLayout => {
  const padding = getTxtShapePadding(shape);
  const lineHeightPx = shape.fontSize * shape.lineHeight;
  const contentHeight = Math.max(0, shape.height - padding * 2);
  const maxLines = lineHeightPx > 0 ? Math.max(0, Math.floor(contentHeight / lineHeightPx)) : 0;
  const lines = layoutTxtShapeText({
    content: shape.content,
    font: `${shape.fontSize}px ${getTxtShapeFontDefinition(shape.fontFamily).stack}`,
    lineCount: maxLines,
    getSpan: (lineIndex) => {
      const lineTop = padding + lineIndex * lineHeightPx;
      const lineBottom = lineTop + lineHeightPx;
      const regionSpan = getTxtShapeHorizontalSpanForBand(shape, lineTop, lineBottom);
      if (!regionSpan) return null;
      const left = Math.max(regionSpan.left, padding);
      const right = Math.min(regionSpan.right, shape.width - padding);
      return right > left ? { left, right } : null;
    },
  });
  const consumedSourceEnd = lines.at(-1)?.sourceEnd ?? 0;
  return {
    lines,
    padding,
    lineHeightPx,
    didOverflow: consumedSourceEnd < shape.content.length,
  };
};

const drawTxtShapesToCanvasWithSelectionMode = (
  ctx: TxtShapeCanvasContext,
  shapes: readonly TxtShape[] | undefined,
  useTransientSelections: boolean,
): void => {
  if (!shapes?.length) {
    return;
  }

  shapes.forEach((shape) => {
    const renderedShape = useTransientSelections && transientSelectionOverrides.has(shape.id)
      ? {
          ...shape,
          selections: normalizeTxtShapeSelections(
            resolveTxtShapeSelections(shape),
            shape.content.length,
          ),
        }
      : shape;
    ctx.save();
    clipTxtShapeRegion(ctx, renderedShape);
    ctx.font = `${renderedShape.fontSize}px ${getTxtShapeFontDefinition(renderedShape.fontFamily).stack}`;
    ctx.textBaseline = 'top';
    const { lines, padding, lineHeightPx } = getTxtShapeTextLayout(renderedShape);

    lines.forEach((line) => {
      const y = shape.y + padding + line.lineIndex * lineHeightPx;
      const availableWidth = line.span.right - line.span.left;
      const boundaries = new Set<number>([0, line.text.length]);
      renderedShape.selections.forEach((selection) => {
        const start = clamp(selection.start - line.sourceStart, 0, line.text.length);
        const end = clamp(selection.end - line.sourceStart, 0, line.text.length);
        if (start < end) {
          boundaries.add(start);
          boundaries.add(end);
        }
      });
      const orderedBoundaries = [...boundaries].sort((a, b) => a - b);
      const fragments = [] as Array<{ selected: boolean; text: string; width: number }>;
      for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
        const start = orderedBoundaries[index];
        const end = orderedBoundaries[index + 1];
        const text = line.text.slice(start, end);
        if (!text) continue;
        const width = Math.max(0.01, ctx.measureText(text).width);
        const selected = isTxtShapeIndexSelected(renderedShape.selections, line.sourceStart + start);
        fragments.push({ selected, text, width });
      }

      const paintedWidth = fragments.reduce((total, fragment) => total + fragment.width, 0);
      let x = renderedShape.x + line.span.left;
      if (renderedShape.textAlign === 'center') x += (availableWidth - paintedWidth) / 2;
      if (renderedShape.textAlign === 'right') x += availableWidth - paintedWidth;
      fragments.forEach(({ selected, text, width }) => {
        if (selected) {
          ctx.fillStyle = renderedShape.selectionBackgroundColor;
          ctx.fillRect(x, y, width, lineHeightPx);
        }
        ctx.fillStyle = selected ? renderedShape.selectionColor : renderedShape.color;
        ctx.fillText(text, x, y);
        x += width;
      });
    });
    ctx.restore();
  });
};

export const drawTxtShapesToCanvas = (
  ctx: TxtShapeCanvasContext,
  shapes: readonly TxtShape[] | undefined,
): void => drawTxtShapesToCanvasWithSelectionMode(ctx, shapes, true);

export const drawCanonicalTxtShapesToCanvas = (
  ctx: TxtShapeCanvasContext,
  shapes: readonly TxtShape[] | undefined,
): void => drawTxtShapesToCanvasWithSelectionMode(ctx, shapes, false);

export const drawTxtShapesForLayer = (
  ctx: TxtShapeCanvasContext,
  shapes: readonly TxtShape[] | undefined,
  layerId: string,
): void => {
  drawTxtShapesToCanvas(ctx, getTxtShapesForLayer(shapes, layerId));
};

type TxtShapeCanvasSurface = HTMLCanvasElement | OffscreenCanvas;

const createTxtShapeCanvasSurface = (width: number, height: number): TxtShapeCanvasSurface | null => {
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : null;
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const getTxtShapeCanvasContext = (canvas: TxtShapeCanvasSurface): TxtShapeCanvasContext | null => (
  canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as TxtShapeCanvasContext | null
);

interface TxtShapeLayerRasterCacheEntry {
  shapes: readonly TxtShape[];
  transientSelectionRevision: number;
  width: number;
  height: number;
  textCanvas: TxtShapeCanvasSurface;
  combinedCanvas: TxtShapeCanvasSurface;
}

const txtShapeLayerRasterCache = new Map<string, TxtShapeLayerRasterCacheEntry>();

const enforceTxtShapeLayerRasterCacheLimit = (): void => {
  if (txtShapeLayerRasterCache.size <= 64) return;
  const oldestLayerId = txtShapeLayerRasterCache.keys().next().value;
  if (oldestLayerId) txtShapeLayerRasterCache.delete(oldestLayerId);
};

export const composeTxtShapesIntoLayerSource = ({
  source,
  shapes,
  layerId,
  width,
  height,
}: {
  source: CanvasImageSource | null;
  shapes: readonly TxtShape[] | undefined;
  layerId: string;
  width: number;
  height: number;
}): CanvasImageSource | null => {
  if (!shapes?.some((shape) => shape.layerId === layerId)) return source;

  let cache = txtShapeLayerRasterCache.get(layerId);
  let shouldRepaintText = false;
  if (!cache || cache.width !== width || cache.height !== height) {
    const textCanvas = createTxtShapeCanvasSurface(width, height);
    const combinedCanvas = createTxtShapeCanvasSurface(width, height);
    if (!textCanvas || !combinedCanvas) return source;
    cache = {
      shapes,
      transientSelectionRevision,
      width,
      height,
      textCanvas,
      combinedCanvas,
    };
    txtShapeLayerRasterCache.delete(layerId);
    txtShapeLayerRasterCache.set(layerId, cache);
    enforceTxtShapeLayerRasterCacheLimit();
    shouldRepaintText = true;
  }

  if (cache.shapes !== shapes) {
    cache.shapes = shapes;
    shouldRepaintText = true;
  }
  if (cache.transientSelectionRevision !== transientSelectionRevision) {
    cache.transientSelectionRevision = transientSelectionRevision;
    shouldRepaintText = true;
  }
  if (shouldRepaintText) {
    const textContext = getTxtShapeCanvasContext(cache.textCanvas);
    if (!textContext) return source;
    textContext.clearRect(0, 0, width, height);
    drawTxtShapesForLayer(textContext, shapes, layerId);
  }

  const combinedContext = getTxtShapeCanvasContext(cache.combinedCanvas);
  if (!combinedContext) return source;
  combinedContext.clearRect(0, 0, width, height);
  if (source) combinedContext.drawImage(source, 0, 0);
  combinedContext.drawImage(cache.textCanvas as CanvasImageSource, 0, 0);
  return cache.combinedCanvas as CanvasImageSource;
};

export const createTxtShapeLayerRasterCache = ({
  layer,
  shapes,
  width,
  height,
}: {
  layer: Pick<Layer, 'id' | 'framebuffer' | 'imageData'>;
  shapes: readonly TxtShape[] | undefined;
  width: number;
  height: number;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  if (getTxtShapesForLayer(shapes, layer.id).length === 0) return null;
  const canvas = createTxtShapeCanvasSurface(width, height);
  if (!canvas) return null;
  const context = getTxtShapeCanvasContext(canvas);
  if (!context) return null;
  if (layer.framebuffer) {
    context.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
  } else if (layer.imageData) {
    context.putImageData(layer.imageData, 0, 0);
  }
  drawCanonicalTxtShapesToCanvas(
    context,
    getTxtShapesForLayer(shapes, layer.id),
  );
  return canvas;
};

export const getTxtShapeFontStack = (fontFamily: TxtShape['fontFamily']): string =>
  getTxtShapeFontDefinition(fontFamily).stack;
