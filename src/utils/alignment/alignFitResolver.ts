import type { LayerAlignmentSettings } from '@/types';
import { clamp, round3, toNum } from '@/utils/num';

export interface Size2D {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PercentPoint {
  x: number;
  y: number;
}

export interface LayerTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export interface LayerDestination {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_DIMENSION = 1e-6;
const HUNDRED = 100;

const horizontalAnchorPercent: Record<NonNullable<LayerAlignmentSettings['horizontal']>, number> = {
  left: 0,
  center: 50,
  right: 100
};

const verticalAnchorPercent: Record<NonNullable<LayerAlignmentSettings['vertical']>, number> = {
  top: 0,
  center: 50,
  bottom: 100
};

export const clampDimension = (value: unknown, fallback = MIN_DIMENSION): number => {
  const fallbackSafe = fallback > 0 ? fallback : MIN_DIMENSION;
  const numeric = toNum(value, fallbackSafe);
  return numeric > 0 ? numeric : fallbackSafe;
};

export const clampPercent = (value: unknown): number => {
  return clamp(toNum(value, 0), -HUNDRED, HUNDRED);
};

export const roundPlacementValue = (value: unknown): number => {
  return round3(value);
};

const normalizeOffsetPercent = (
  alignment: Partial<LayerAlignmentSettings> | null | undefined,
  normalizedHorizontal: NonNullable<LayerAlignmentSettings['horizontal']>,
  normalizedVertical: NonNullable<LayerAlignmentSettings['vertical']>
): PercentPoint => {
  const fallback: PercentPoint = {
    x: horizontalAnchorPercent[normalizedHorizontal],
    y: verticalAnchorPercent[normalizedVertical]
  };

  const offset = alignment?.offsetPercent;
  if (!offset) {
    return fallback;
  }

  return {
    x: clampPercent(offset.x ?? fallback.x),
    y: clampPercent(offset.y ?? fallback.y)
  };
};

const normalizeFit = (fit?: string): LayerAlignmentSettings['fit'] => {
  switch (fit) {
    case 'contain':
    case 'cover':
    case 'fill':
    case 'tile':
    case 'none':
      return fit;
    case 'uniform':
      return 'contain';
    default:
      return 'none';
  }
};

export const normalizeAlignment = (
  alignment?: Partial<LayerAlignmentSettings> | null
): LayerAlignmentSettings => {
  // Default to centered placement so layers without explicit anchors remain centered in the viewport.
  const defaultHorizontal = 'center';
  const defaultVertical = 'center';
  const horizontal = alignment?.horizontal ?? defaultHorizontal;
  const vertical = alignment?.vertical ?? defaultVertical;
  const normalized: LayerAlignmentSettings = {
    fit: normalizeFit(alignment?.fit),
    horizontal,
    vertical,
    positioning: alignment?.positioning ?? 'anchor',
    offsetPercent: normalizeOffsetPercent(alignment, horizontal, vertical)
  };

  return normalized;
};

const resolveViewport = (viewport: Size2D): Size2D => ({
  width: clampDimension(viewport.width),
  height: clampDimension(viewport.height)
});

const resolveDocument = (document: Size2D): Size2D => ({
  width: clampDimension(document.width),
  height: clampDimension(document.height)
});

const resolvePaintedBounds = (bounds?: Rect | null, fallback?: Size2D): Rect => {
  const width = clampDimension(bounds?.width, fallback?.width ?? MIN_DIMENSION);
  const height = clampDimension(bounds?.height, fallback?.height ?? MIN_DIMENSION);

  return {
    x: toNum(bounds?.x, 0),
    y: toNum(bounds?.y, 0),
    width,
    height
  };
};

// Fit modes share a single sizing basis so contain/cover/fill behave consistently:
// - By default we respect the full document bounds, but once painted bounds exist we
//   scale against the visible pixels so AUTO/ANCHOR don't drift from the user's crop.
// - Anchor never scales; it just positions the raw painted rectangle inside the viewport.
const getBasisSize = (
  document: Size2D,
  paintedBounds: Rect | null,
  alignment: LayerAlignmentSettings
): { w: number; h: number } => {
  const usePaintedBounds = alignment.positioning === 'anchor' || alignment.fit === 'tile';

  const w = usePaintedBounds
    ? clampDimension(paintedBounds?.width ?? document.width)
    : clampDimension(document.width);
  const h = usePaintedBounds
    ? clampDimension(paintedBounds?.height ?? document.height)
    : clampDimension(document.height);

  return { w, h };
};

export interface ComputeLayerTransformOptions {
  paintedBounds?: Rect | null;
}

export const computeLayerTransform = (
  document: Size2D,
  viewport: Size2D,
  alignment: LayerAlignmentSettings,
  _options: ComputeLayerTransformOptions = {}
): LayerTransform => {
  const normalized = normalizeAlignment(alignment);
  const safeViewport = resolveViewport(viewport);
  const safeDocument = resolveDocument(document);
  const painted = _options.paintedBounds
    ? resolvePaintedBounds(_options.paintedBounds, safeDocument)
    : null;

  const percentX = normalized.offsetPercent?.x ?? 0;
  const percentY = normalized.offsetPercent?.y ?? 0;

  const { w: basisWidth, h: basisHeight } = getBasisSize(safeDocument, painted, normalized);
  const viewportWidth = safeViewport.width;
  const viewportHeight = safeViewport.height;
  const isAnchor = normalized.positioning === 'anchor';
  let scaleX = 1;
  let scaleY = 1;

  switch (normalized.fit) {
    case 'contain': {
      // Uniform scale so the content fits within the viewport; letterboxing is fine.
      const scale = Math.min(viewportWidth / basisWidth, viewportHeight / basisHeight);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'cover': {
      // Uniform scale so the viewport is completely filled; excess pixels crop.
      const scale = Math.max(viewportWidth / basisWidth, viewportHeight / basisHeight);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'fill': {
      // Non-uniform stretch; aspect ratio may change per axis.
      scaleX = viewportWidth / basisWidth;
      scaleY = viewportHeight / basisHeight;
      break;
    }
    case 'tile': {
      // Preserve native pixels; tiling happens through translation offsets.
      scaleX = 1;
      scaleY = 1;
      break;
    }
    case 'none':
    default: {
      // Explicitly preserve source pixel size.
      scaleX = 1;
      scaleY = 1;
      break;
    }
  }

  if (isAnchor) {
    scaleX = 1;
    scaleY = 1;
  }

  const renderedWidth = basisWidth * scaleX;
  const renderedHeight = basisHeight * scaleY;
  const leftoverX = viewportWidth - renderedWidth;
  const leftoverY = viewportHeight - renderedHeight;
  let translateX: number;
  let translateY: number;

  if (isAnchor) {
    const horizontal = normalized.horizontal;
    const vertical = normalized.vertical;
    const fallbackPercentX = horizontalAnchorPercent[horizontal];
    const fallbackPercentY = verticalAnchorPercent[vertical];
    const pivotX = horizontal === 'center' ? leftoverX / 2 : horizontal === 'right' ? leftoverX : 0;
    const pivotY = vertical === 'center' ? leftoverY / 2 : vertical === 'bottom' ? leftoverY : 0;
    const offsetPercentX = (normalized.offsetPercent?.x ?? fallbackPercentX) - fallbackPercentX;
    const offsetPercentY = (normalized.offsetPercent?.y ?? fallbackPercentY) - fallbackPercentY;
    const offsetX = (offsetPercentX / HUNDRED) * leftoverX;
    const offsetY = (offsetPercentY / HUNDRED) * leftoverY;
    translateX = pivotX + offsetX;
    translateY = pivotY + offsetY;
  } else {
    translateX = leftoverX * (percentX / HUNDRED);
    translateY = leftoverY * (percentY / HUNDRED);
  }

  return {
    scaleX,
    scaleY,
    translateX,
    translateY
  };
};

export interface ComputeLayerDestinationInput {
  document: Size2D;
  viewport: Size2D;
  alignment: LayerAlignmentSettings;
  paintedBounds?: Rect | null;
}

export const computeLayerDestination = (
  input: ComputeLayerDestinationInput
): LayerDestination => {
  const safeDocument = resolveDocument(input.document);
  const safeViewport = resolveViewport(input.viewport);
  const normalized = normalizeAlignment(input.alignment);
  const painted = resolvePaintedBounds(input.paintedBounds, safeDocument);

  const usePaintedBounds = normalized.positioning === 'anchor' || normalized.fit === 'tile';
  const basisWidth = usePaintedBounds ? Math.max(MIN_DIMENSION, painted.width) : safeDocument.width;
  const basisHeight = usePaintedBounds ? Math.max(MIN_DIMENSION, painted.height) : safeDocument.height;

  let width: number;
  let height: number;

  switch (normalized.fit) {
    case 'contain': {
      const scale = Math.min(safeViewport.width / basisWidth, safeViewport.height / basisHeight);
      width = basisWidth * scale;
      height = basisHeight * scale;
      break;
    }
    case 'cover': {
      const scale = Math.max(safeViewport.width / basisWidth, safeViewport.height / basisHeight);
      width = basisWidth * scale;
      height = basisHeight * scale;
      break;
    }
    case 'fill': {
      width = safeViewport.width;
      height = safeViewport.height;
      break;
    }
    case 'tile': {
      width = safeViewport.width;
      height = safeViewport.height;
      break;
    }
    case 'none':
    default: {
      width = basisWidth;
      height = basisHeight;
      break;
    }
  }

  if (normalized.positioning === 'anchor') {
    const freeX = safeViewport.width - width;
    const freeY = safeViewport.height - height;

    const horizontal = normalized.horizontal ?? 'left';
    const vertical = normalized.vertical ?? 'top';

    let x = 0;
    if (horizontal === 'center') {
      x = freeX / 2;
    } else if (horizontal === 'right') {
      x = freeX;
    }

    let y = 0;
    if (vertical === 'center') {
      y = freeY / 2;
    } else if (vertical === 'bottom') {
      y = freeY;
    }

    const offsetPercent = input.alignment?.offsetPercent;
    const offsetPercentX = clampPercent(offsetPercent?.x ?? 0);
    const offsetPercentY = clampPercent(offsetPercent?.y ?? 0);

    const offsetX = (offsetPercentX / HUNDRED) * freeX;
    const offsetY = (offsetPercentY / HUNDRED) * freeY;

    return {
      x: Math.round(x + offsetX),
      y: Math.round(y + offsetY),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  const scaleX = width / basisWidth;
  const scaleY = height / basisHeight;
  const percentX = (normalized.offsetPercent?.x ?? 0) / HUNDRED;
  const percentY = (normalized.offsetPercent?.y ?? 0) / HUNDRED;
  const leftoverX = safeViewport.width - width;
  const leftoverY = safeViewport.height - height;
  const translateX = leftoverX * percentX;
  const translateY = leftoverY * percentY;

  return {
    x: translateX + painted.x * scaleX,
    y: translateY + painted.y * scaleY,
    width: Math.round(width),
    height: Math.round(height)
  };
};

export const derivePercentBounds = (bounds: Rect, document: Size2D): Rect => {
  const safeDocument = resolveDocument(document);
  const safeBounds = resolvePaintedBounds(bounds);

  return {
    x: (safeBounds.x / safeDocument.width) * HUNDRED,
    y: (safeBounds.y / safeDocument.height) * HUNDRED,
    width: (safeBounds.width / safeDocument.width) * HUNDRED,
    height: (safeBounds.height / safeDocument.height) * HUNDRED
  };
};

export const deriveAutoPercentOffset = (bounds: Rect, document: Size2D): PercentPoint => {
  const safeDocument = resolveDocument(document);
  const safeBounds = resolvePaintedBounds(bounds);

  const availableX = safeDocument.width - safeBounds.width;
  const availableY = safeDocument.height - safeBounds.height;

  const percentX = availableX > MIN_DIMENSION
    ? clampPercent((safeBounds.x / availableX) * HUNDRED)
    : 0;

  const percentY = availableY > MIN_DIMENSION
    ? clampPercent((safeBounds.y / availableY) * HUNDRED)
    : 0;

  return {
    x: percentX,
    y: percentY
  };
};

export const AlignFitResolver = {
  clampDimension,
  clampPercent,
  roundPlacementValue,
  normalizeAlignment,
  computeLayerTransform,
  computeLayerDestination,
  deriveAutoPercentOffset,
  derivePercentBounds
};

export type AlignFitResolverType = typeof AlignFitResolver;

export default AlignFitResolver;
