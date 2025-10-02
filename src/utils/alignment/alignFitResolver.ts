import type { LayerAlignmentSettings } from '@/types';

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
const ROUND_PRECISION = 1e3;

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

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
};

export const clampDimension = (value: unknown, fallback = MIN_DIMENSION): number => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
};

export const clampPercent = (value: unknown): number => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(-HUNDRED, Math.min(HUNDRED, numeric));
};

export const roundPlacementValue = (value: unknown): number => {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * ROUND_PRECISION) / ROUND_PRECISION;
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

const normalizeFit = (fit: LayerAlignmentSettings['fit'] | undefined): LayerAlignmentSettings['fit'] => {
  switch (fit) {
    case 'uniform':
    case 'contain':
    case 'contain-up':
    case 'cover':
    case 'fill':
    case 'tile':
    case 'none':
      return fit;
    default:
      return 'none';
  }
};

export const normalizeAlignment = (
  alignment?: Partial<LayerAlignmentSettings> | null
): LayerAlignmentSettings => {
  const desiredFit = alignment?.fit;
  const defaultHorizontal = desiredFit === 'tile' ? 'center' : 'left';
  const defaultVertical = desiredFit === 'tile' ? 'center' : 'top';
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
    x: toNumber(bounds?.x) || 0,
    y: toNumber(bounds?.y) || 0,
    width,
    height
  };
};

export interface ComputeLayerTransformOptions {
  paintedBounds?: Rect | null;
}

export const computeLayerTransform = (
  document: Size2D,
  viewport: Size2D,
  alignment: LayerAlignmentSettings,
  options: ComputeLayerTransformOptions = {}
): LayerTransform => {
  const normalized = normalizeAlignment(alignment);
  const safeViewport = resolveViewport(viewport);
  const safeDocument = resolveDocument(document);
  const bounds = resolvePaintedBounds(options.paintedBounds, safeDocument);

  const percentX = normalized.offsetPercent?.x ?? 0;
  const percentY = normalized.offsetPercent?.y ?? 0;

  const documentWidth = safeDocument.width;
  const documentHeight = safeDocument.height;
  const viewportWidth = safeViewport.width;
  const viewportHeight = safeViewport.height;
  const boundsWidth = bounds.width;
  const boundsHeight = bounds.height;

  let basisWidth = documentWidth;
  let basisHeight = documentHeight;
  let scaleX = 1;
  let scaleY = 1;

  switch (normalized.fit) {
    case 'uniform': {
      basisWidth = boundsWidth;
      basisHeight = boundsHeight;
      const uniformScale = Math.min(
        viewportWidth / basisWidth,
        viewportHeight / basisHeight
      );
      scaleX = uniformScale;
      scaleY = uniformScale;
      break;
    }
    case 'contain-up': {
      const scale = Math.max(
        1,
        Math.min(viewportWidth / documentWidth, viewportHeight / documentHeight)
      );
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'contain': {
      const scale = Math.min(viewportWidth / documentWidth, viewportHeight / documentHeight);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'cover': {
      const scale = Math.max(viewportWidth / documentWidth, viewportHeight / documentHeight);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'fill': {
      scaleX = viewportWidth / documentWidth;
      scaleY = viewportHeight / documentHeight;
      break;
    }
    case 'tile': {
      // Tile maintains the source scale; translation is all that matters
      scaleX = 1;
      scaleY = 1;
      break;
    }
    case 'none':
    default: {
      scaleX = 1;
      scaleY = 1;
      break;
    }
  }

  const renderedWidth = basisWidth * scaleX;
  const renderedHeight = basisHeight * scaleY;
  const leftoverX = viewportWidth - renderedWidth;
  const leftoverY = viewportHeight - renderedHeight;

  const translateX = leftoverX * (percentX / HUNDRED);
  const translateY = leftoverY * (percentY / HUNDRED);

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
  const bounds = resolvePaintedBounds(input.paintedBounds);
  const normalized = normalizeAlignment(input.alignment);
  const anchorContent = normalized.positioning === 'anchor';

  const document = anchorContent
    ? {
        width: Math.max(MIN_DIMENSION, bounds.width),
        height: Math.max(MIN_DIMENSION, bounds.height)
      }
    : resolveDocument(input.document);

  // Feed the resolved document (content basis for anchors) into the transform so
  // fit math scales relative to the anchored pixels.
  const transform = computeLayerTransform(
    document,
    input.viewport,
    normalized,
    { paintedBounds: bounds }
  );

  const basisWidth = document.width;
  const basisHeight = document.height;

  const width = basisWidth * transform.scaleX;
  const height = basisHeight * transform.scaleY;

  // Skip painted-bounds offsets when anchoring content, and also for uniform
  // fits where anchor/auto positioning already incorporates the cropped bounds.
  const addBoundsOffset = !(
    anchorContent || (
      normalized.fit === 'uniform' &&
      (normalized.positioning === 'anchor' || normalized.positioning === 'auto')
    )
  );
  const adjustedOffsetX = addBoundsOffset ? bounds.x * transform.scaleX : 0;
  const adjustedOffsetY = addBoundsOffset ? bounds.y * transform.scaleY : 0;

  return {
    x: transform.translateX + adjustedOffsetX,
    y: transform.translateY + adjustedOffsetY,
    width,
    height
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
