import type { ContentBounds, LayerAlignmentSettings } from '@/types';

export interface Size2D {
  width: number;
  height: number;
}

export interface ViewportMapping {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  canvasWidth?: number;
  canvasHeight?: number;
  designWidth?: number;
  designHeight?: number;
}

export interface LayerBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchor?: string;
}

export interface LayerLike {
  id?: string | number;
  source?: { width?: number; height?: number } | null;
  bounds?: LayerBounds | null;
  placement?: LayerBounds | null;
  layoutMode?: string | null;
  alignment?: Partial<LayerAlignmentSettings> | null;
  contentBounds?: ContentBounds | null;
}

const MIN_DIMENSION = 1e-3;

export const toFinite = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

export const clampDimension = (value: number | undefined | null): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return MIN_DIMENSION;
  }
  return numeric;
};

export const roundPlacementValue = (value: unknown): number => {
  const numeric = toFinite(value, 0);
  return Math.round(numeric * 1000) / 1000;
};

export const clampPercent = (value: unknown): number => Math.max(-100, Math.min(100, toFinite(value, 0)));

const createDefaultAlignment = (): LayerAlignmentSettings => ({
  fit: 'none',
  horizontal: 'left',
  vertical: 'top',
  positioning: 'anchor',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 0, y: 0 }
});

const cloneAlignment = (alignment?: Partial<LayerAlignmentSettings> | null): LayerAlignmentSettings => {
  const base = alignment ?? createDefaultAlignment();
  const positioning = typeof base.positioning === 'string' ? base.positioning : 'anchor';
  const fit = typeof base.fit === 'string' ? base.fit : 'none';
  const shouldIncludePercent = positioning === 'auto' || fit === 'percent';

  return {
    fit,
    horizontal: typeof base.horizontal === 'string' ? base.horizontal : 'left',
    vertical: typeof base.vertical === 'string' ? base.vertical : 'top',
    positioning,
    offsetPx: base.offsetPx && typeof base.offsetPx === 'object'
      ? { x: toFinite(base.offsetPx.x, 0), y: toFinite(base.offsetPx.y, 0) }
      : { x: 0, y: 0 },
    offsetPercent: shouldIncludePercent
      ? {
          x: toFinite(base.offsetPercent?.x, 0),
          y: toFinite(base.offsetPercent?.y, 0)
        }
      : undefined
  };
};

export const normalizeAlignment = (alignment?: Partial<LayerAlignmentSettings> | null): LayerAlignmentSettings => {
  return cloneAlignment(alignment);
};

type AlignmentFit = LayerAlignmentSettings['fit'];

type FitTransformResult = {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
};

interface FitTransformContext {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  widthRatio: number;
  heightRatio: number;
  alignment: LayerAlignmentSettings;
}

interface TranslationContext {
  alignment: LayerAlignmentSettings;
  viewportWidth: number;
  viewportHeight: number;
  scaledWidth: number;
  scaledHeight: number;
}

export interface NormalizedViewportMapping {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

export const deriveAutoPercentOffset = (
  bounds: Required<LayerBounds>,
  mapping: NormalizedViewportMapping,
  viewport: Size2D
): { x: number; y: number } => {
  const availableX = viewport.width - bounds.width;
  const availableY = viewport.height - bounds.height;

  const normalizedX = toFinite(bounds.x, 0) - mapping.offsetX;
  const normalizedY = toFinite(bounds.y, 0) - mapping.offsetY;

  const percentX = availableX > MIN_DIMENSION
    ? clampPercent((normalizedX / availableX) * 100)
    : 0;

  const percentY = availableY > MIN_DIMENSION
    ? clampPercent((normalizedY / availableY) * 100)
    : 0;

  return {
    x: percentX,
    y: percentY
  };
};

const getPercentOffset = (alignment: LayerAlignmentSettings) => {
  const percent = alignment.offsetPercent ?? { x: 0, y: 0 };
  return {
    x: clampPercent(percent.x),
    y: clampPercent(percent.y)
  };
};

const computeAnchorTranslation = ({ alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }: TranslationContext) => {
  const extraX = viewportWidth - scaledWidth;
  const extraY = viewportHeight - scaledHeight;

  let translateX = 0;
  let translateY = 0;

  switch (alignment.horizontal) {
    case 'center':
      translateX = extraX / 2;
      break;
    case 'right':
      translateX = extraX;
      break;
    case 'left':
    default:
      translateX = 0;
      break;
  }

  switch (alignment.vertical) {
    case 'center':
      translateY = extraY / 2;
      break;
    case 'bottom':
      translateY = extraY;
      break;
    case 'top':
    default:
      translateY = 0;
      break;
  }

  translateX += toFinite(alignment.offsetPx?.x, 0);
  translateY += toFinite(alignment.offsetPx?.y, 0);

  return { translateX, translateY };
};

const computeAutoTranslation = (
  { alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }: TranslationContext,
  options: { applyUniformOffsetPx?: boolean } = {}
) => {
  const percent = getPercentOffset(alignment);
  const extraX = viewportWidth - scaledWidth;
  const extraY = viewportHeight - scaledHeight;

  let translateX = extraX * (percent.x / 100);
  let translateY = extraY * (percent.y / 100);

  if (options.applyUniformOffsetPx && alignment.offsetPx) {
    const epsilon = 1e-3;
    if (Math.abs(extraX) <= epsilon && Number.isFinite(alignment.offsetPx.x)) {
      translateX += alignment.offsetPx.x;
    }
    if (Math.abs(extraY) <= epsilon && Number.isFinite(alignment.offsetPx.y)) {
      translateY += alignment.offsetPx.y;
    }
  }

  return { translateX, translateY };
};

const computePercentTranslation = ({ alignment, viewportWidth, viewportHeight }: TranslationContext) => {
  const percent = getPercentOffset(alignment);
  return {
    translateX: viewportWidth * (percent.x / 100),
    translateY: viewportHeight * (percent.y / 100)
  };
};

type FitTransformResolver = (context: FitTransformContext) => FitTransformResult;

const resolveScaledTransform = (
  context: FitTransformContext,
  scaleX: number,
  scaleY: number,
  options: { usePercentTranslation?: boolean; allowUniformOffsetPx?: boolean } = {}
): FitTransformResult => {
  const { alignment, viewportWidth, viewportHeight, contentWidth, contentHeight } = context;
  const scaledWidth = contentWidth * scaleX;
  const scaledHeight = contentHeight * scaleY;
  const translationContext: TranslationContext = {
    alignment,
    viewportWidth,
    viewportHeight,
    scaledWidth,
    scaledHeight
  };

  const translate = options.usePercentTranslation
    ? computePercentTranslation(translationContext)
    : alignment.positioning === 'auto'
      ? computeAutoTranslation(translationContext, { applyUniformOffsetPx: options.allowUniformOffsetPx })
      : computeAnchorTranslation(translationContext);

  return {
    scaleX,
    scaleY,
    translateX: translate.translateX,
    translateY: translate.translateY
  };
};

const fitTransformResolvers: Record<AlignmentFit, FitTransformResolver> = {
  none: (context) => resolveScaledTransform(context, 1, 1),
  contain: (context) => {
    const scale = Math.min(context.widthRatio, context.heightRatio);
    return resolveScaledTransform(context, scale, scale);
  },
  cover: (context) => {
    const scale = Math.max(context.widthRatio, context.heightRatio);
    return resolveScaledTransform(context, scale, scale);
  },
  fill: (context) => resolveScaledTransform(context, context.widthRatio, context.heightRatio),
  'fit-width': (context) => {
    const scale = context.widthRatio;
    return resolveScaledTransform(context, scale, scale);
  },
  'fit-height': (context) => {
    const scale = context.heightRatio;
    return resolveScaledTransform(context, scale, scale);
  },
  'scale-down': (context) => {
    const containScale = Math.min(context.widthRatio, context.heightRatio);
    const scale = containScale < 1 ? containScale : 1;
    return resolveScaledTransform(context, scale, scale);
  },
  percent: (context) => resolveScaledTransform(context, 1, 1, { usePercentTranslation: true }),
  uniform: (context) => resolveScaledTransform(context, 1, 1, { allowUniformOffsetPx: true })
};

export const computeLayerTransform = (surface: Size2D, viewport: Size2D, alignment: LayerAlignmentSettings) => {
  const normalized = normalizeAlignment(alignment);
  const contentWidth = clampDimension(surface.width);
  const contentHeight = clampDimension(surface.height);
  const viewportWidth = clampDimension(viewport.width);
  const viewportHeight = clampDimension(viewport.height);

  const context: FitTransformContext = {
    contentWidth,
    contentHeight,
    viewportWidth,
    viewportHeight,
    widthRatio: viewportWidth / contentWidth,
    heightRatio: viewportHeight / contentHeight,
    alignment: normalized
  };

  const resolver = fitTransformResolvers[normalized.fit] ?? fitTransformResolvers.none;
  return resolver(context);
};

export const resolveAutoViewportSize = (mapping: ViewportMapping) => {
  const canvasWidth = Math.max(0, toFinite(mapping?.canvasWidth, 0));
  const canvasHeight = Math.max(0, toFinite(mapping?.canvasHeight, 0));
  const designWidth = Math.max(0, toFinite(mapping?.designWidth, 0));
  const designHeight = Math.max(0, toFinite(mapping?.designHeight, 0));
  const scaleX = Math.max(0, toFinite(mapping?.scaleX, 1));
  const scaleY = Math.max(0, toFinite(mapping?.scaleY, 1));

  const viewportWidth = designWidth > 0 && scaleX > 0
    ? designWidth * scaleX
    : canvasWidth;
  const viewportHeight = designHeight > 0 && scaleY > 0
    ? designHeight * scaleY
    : canvasHeight;

  return {
    width: viewportWidth || canvasWidth,
    height: viewportHeight || canvasHeight
  };
};

const axisToPercent = (axis: string | undefined | null): number => {
  if (axis === 'center') {
    return 50;
  }
  if (axis === 'right' || axis === 'bottom') {
    return 100;
  }
  return 0;
};

const resolveBounds = (
  layer: LayerLike,
  srcWidth: number,
  srcHeight: number,
  fallbackAnchor: string
): Required<LayerBounds> => {
  const raw = (layer.bounds ?? layer.placement) ?? null;
  if (!raw) {
    return { x: 0, y: 0, width: srcWidth, height: srcHeight, anchor: fallbackAnchor };
  }

  return {
    x: toFinite(raw.x, 0),
    y: toFinite(raw.y, 0),
    width: Math.max(1, toFinite(raw.width, srcWidth)),
    height: Math.max(1, toFinite(raw.height, srcHeight)),
    anchor: raw.anchor ?? fallbackAnchor
  };
};

interface DestinationContext {
  alignment: LayerAlignmentSettings;
  bounds: Required<LayerBounds>;
  mapping: NormalizedViewportMapping;
  percent: { x: number; y: number };
  posMode: LayerAlignmentSettings['positioning'];
  viewport: Size2D;
  baseWidth: number;
  baseHeight: number;
  srcWidth: number;
  srcHeight: number;
}

interface DestinationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AutoPositionResult {
  x: number;
  y: number;
  availableX: number;
  availableY: number;
}

const finalizeDestination = (rect: DestinationRect) => ({
  x: roundPlacementValue(rect.x),
  y: roundPlacementValue(rect.y),
  width: roundPlacementValue(rect.width),
  height: roundPlacementValue(rect.height)
});

const computeAnchorPosition = (ctx: DestinationContext, posScaleX: number, posScaleY: number) => {
  const baseX = ctx.mapping.offsetX + ctx.bounds.x * posScaleX;
  const baseY = ctx.mapping.offsetY + ctx.bounds.y * posScaleY;

  return {
    x: baseX + toFinite(ctx.alignment.offsetPx?.x, 0),
    y: baseY + toFinite(ctx.alignment.offsetPx?.y, 0)
  };
};

const computeAutoPosition = (ctx: DestinationContext, width: number, height: number): AutoPositionResult => {
  const availableX = ctx.viewport.width - width;
  const availableY = ctx.viewport.height - height;

  return {
    x: ctx.mapping.offsetX + availableX * (ctx.percent.x / 100),
    y: ctx.mapping.offsetY + availableY * (ctx.percent.y / 100),
    availableX,
    availableY
  };
};

const applyUniformAutoOffsets = (ctx: DestinationContext, auto: AutoPositionResult) => {
  let { x, y } = auto;
  const offset = ctx.alignment.offsetPx;
  if (!offset) {
    return { x, y };
  }

  const offsetX = toFinite(offset.x, 0);
  const offsetY = toFinite(offset.y, 0);

  if (offsetX !== 0) {
    x += offsetX;
  }

  if (offsetY !== 0) {
    y += offsetY;
  }

  return { x, y };
};

type ScaleFactors = {
  sizeScaleX: number;
  sizeScaleY: number;
  posScaleX: number;
  posScaleY: number;
};

type DestinationResolver = (ctx: DestinationContext) => DestinationRect;

type DestinationResolverKey = AlignmentFit | 'default';

const createScaledDestinationResolver = (getScale: (ctx: DestinationContext) => ScaleFactors): DestinationResolver => {
  return (ctx) => {
    const { sizeScaleX, sizeScaleY, posScaleX, posScaleY } = getScale(ctx);
    const width = ctx.baseWidth * sizeScaleX;
    const height = ctx.baseHeight * sizeScaleY;

    if (ctx.posMode === 'auto') {
      const auto = computeAutoPosition(ctx, width, height);
      return {
        x: auto.x,
        y: auto.y,
        width,
        height
      };
    }

    const anchor = computeAnchorPosition(ctx, posScaleX, posScaleY);
    return {
      x: anchor.x,
      y: anchor.y,
      width,
      height
    };
  };
};

const uniformDestinationResolver: DestinationResolver = (ctx) => {
  const uniformScale = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
  const width = ctx.srcWidth * uniformScale;
  const height = ctx.srcHeight * uniformScale;

  if (ctx.posMode === 'auto') {
    const auto = computeAutoPosition(ctx, width, height);
    const adjusted = applyUniformAutoOffsets(ctx, auto);
    return {
      x: adjusted.x,
      y: adjusted.y,
      width,
      height
    };
  }

  const anchor = computeAnchorPosition(ctx, uniformScale, uniformScale);
  return {
    x: anchor.x,
    y: anchor.y,
    width,
    height
  };
};

const fillScaleResolver = createScaledDestinationResolver((ctx) => ({
  sizeScaleX: ctx.mapping.scaleX,
  sizeScaleY: ctx.mapping.scaleY,
  posScaleX: ctx.mapping.scaleX,
  posScaleY: ctx.mapping.scaleY
}));

const destinationResolvers: Record<DestinationResolverKey, DestinationResolver> = {
  none: createScaledDestinationResolver((ctx) => ({
    sizeScaleX: 1,
    sizeScaleY: 1,
    posScaleX: ctx.mapping.scaleX,
    posScaleY: ctx.mapping.scaleY
  })),
  contain: createScaledDestinationResolver((ctx) => {
    const scale = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
    return {
      sizeScaleX: scale,
      sizeScaleY: scale,
      posScaleX: scale,
      posScaleY: scale
    };
  }),
  cover: createScaledDestinationResolver((ctx) => {
    const scale = Math.max(ctx.mapping.scaleX, ctx.mapping.scaleY);
    return {
      sizeScaleX: scale,
      sizeScaleY: scale,
      posScaleX: scale,
      posScaleY: scale
    };
  }),
  fill: fillScaleResolver,
  'fit-width': createScaledDestinationResolver((ctx) => {
    const scale = ctx.mapping.scaleX;
    return {
      sizeScaleX: scale,
      sizeScaleY: scale,
      posScaleX: scale,
      posScaleY: scale
    };
  }),
  'fit-height': createScaledDestinationResolver((ctx) => {
    const scale = ctx.mapping.scaleY;
    return {
      sizeScaleX: scale,
      sizeScaleY: scale,
      posScaleX: scale,
      posScaleY: scale
    };
  }),
  'scale-down': createScaledDestinationResolver((ctx) => {
    const contain = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
    const scale = contain < 1 ? contain : 1;
    return {
      sizeScaleX: scale,
      sizeScaleY: scale,
      posScaleX: scale,
      posScaleY: scale
    };
  }),
  percent: fillScaleResolver,
  uniform: uniformDestinationResolver,
  default: fillScaleResolver
};

export const computeLayerDestination = (layer: LayerLike, mapping: ViewportMapping) => {
  const srcWidth = Math.max(1, toFinite(layer?.source?.width, toFinite(layer?.bounds?.width, toFinite(layer?.placement?.width, 1))));
  const srcHeight = Math.max(1, toFinite(layer?.source?.height, toFinite(layer?.bounds?.height, toFinite(layer?.placement?.height, 1))));
  const fallbackAnchor = layer?.bounds?.anchor ?? layer?.placement?.anchor ?? 'top-left';

  const layoutBounds = layer?.bounds ?? null;
  const hasLayoutBounds = Boolean(layoutBounds && Number.isFinite(layoutBounds.width) && Number.isFinite(layoutBounds.height));

  const offsetX = toFinite(mapping?.offsetX, 0);
  const offsetY = toFinite(mapping?.offsetY, 0);
  const scaleX = Math.max(0, toFinite(mapping?.scaleX, 1)) || 1;
  const scaleY = Math.max(0, toFinite(mapping?.scaleY, 1)) || 1;

  if (hasLayoutBounds) {
    const bx = toFinite(layoutBounds?.x, 0);
    const by = toFinite(layoutBounds?.y, 0);
    const bw = Math.max(1, toFinite(layoutBounds?.width, 1));
    const bh = Math.max(1, toFinite(layoutBounds?.height, 1));

    return {
      x: offsetX + bx * scaleX,
      y: offsetY + by * scaleY,
      width: Math.max(1, bw * scaleX),
      height: Math.max(1, bh * scaleY)
    };
  }

  const alignment = normalizeAlignment(layer.alignment);
  const posMode = alignment.positioning ?? 'anchor';
  const fit = (layer?.layoutMode as AlignmentFit | undefined) ?? alignment.fit ?? 'none';

  const percentWithFallback = (() => {
    const raw = alignment.offsetPercent ?? { x: 0, y: 0 };
    if (posMode !== 'auto') {
      return raw;
    }
    const x = Number.isFinite(raw.x) ? raw.x : axisToPercent(alignment.horizontal);
    const y = Number.isFinite(raw.y) ? raw.y : axisToPercent(alignment.vertical);
    return { x, y };
  })();

  const bounds = resolveBounds(layer, srcWidth, srcHeight, fallbackAnchor);
  const viewportSize = resolveAutoViewportSize(mapping);
  const normalizedMapping: NormalizedViewportMapping = { offsetX, offsetY, scaleX, scaleY };

  const percent = posMode === 'auto'
    ? deriveAutoPercentOffset(bounds, normalizedMapping, viewportSize)
    : {
        x: clampPercent(percentWithFallback.x),
        y: clampPercent(percentWithFallback.y)
      };

  const context: DestinationContext = {
    alignment,
    bounds,
    mapping: normalizedMapping,
    percent,
    posMode,
    viewport: viewportSize,
    baseWidth: bounds.width,
    baseHeight: bounds.height,
    srcWidth,
    srcHeight
  };

  const resolver = destinationResolvers[fit] ?? destinationResolvers.default;
  const rect = resolver(context);

  return finalizeDestination(rect);
};

export const AlignFitResolver = {
  normalizeAlignment,
  computeLayerTransform,
  computeLayerDestination,
  deriveAutoPercentOffset,
  clampPercent,
  resolveAutoViewportSize
};

export type AlignFitResolverType = typeof AlignFitResolver;

export default AlignFitResolver;
