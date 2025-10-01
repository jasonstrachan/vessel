// Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.
const MIN_DIMENSION = 1e-3;
export const toFinite = (value, fallback = 0) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : fallback;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};
export const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
};
export const clampDimension = (value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return MIN_DIMENSION;
    }
    return numeric;
};
export const roundPlacementValue = (value) => {
    const numeric = toFinite(value, 0);
    return Math.round(numeric * 1000) / 1000;
};
export const clampPercent = (value) => Math.max(-100, Math.min(100, toFinite(value, 0)));
const createDefaultAlignment = () => ({
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
    offsetPx: { x: 0, y: 0 },
    offsetPercent: { x: 0, y: 0 }
});
const cloneAlignment = (alignment) => {
    var _a, _b;
    const base = alignment !== null && alignment !== void 0 ? alignment : createDefaultAlignment();
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
                x: toFinite((_a = base.offsetPercent) === null || _a === void 0 ? void 0 : _a.x, 0),
                y: toFinite((_b = base.offsetPercent) === null || _b === void 0 ? void 0 : _b.y, 0)
            }
            : undefined
    };
};
export const normalizeAlignment = (alignment) => {
    return cloneAlignment(alignment);
};
const getPercentOffset = (alignment) => {
    var _a;
    const percent = (_a = alignment.offsetPercent) !== null && _a !== void 0 ? _a : { x: 0, y: 0 };
    return {
        x: clampPercent(percent.x),
        y: clampPercent(percent.y)
    };
};
const computeAnchorTranslation = ({ alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }) => {
    var _a, _b;
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
    translateX += toFinite((_a = alignment.offsetPx) === null || _a === void 0 ? void 0 : _a.x, 0);
    translateY += toFinite((_b = alignment.offsetPx) === null || _b === void 0 ? void 0 : _b.y, 0);
    return { translateX, translateY };
};
const computeAutoTranslation = ({ alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }, options = {}) => {
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
const computePercentTranslation = ({ alignment, viewportWidth, viewportHeight }) => {
    const percent = getPercentOffset(alignment);
    return {
        translateX: viewportWidth * (percent.x / 100),
        translateY: viewportHeight * (percent.y / 100)
    };
};
const resolveScaledTransform = (context, scaleX, scaleY, options = {}) => {
    const { alignment, viewportWidth, viewportHeight, contentWidth, contentHeight } = context;
    const scaledWidth = contentWidth * scaleX;
    const scaledHeight = contentHeight * scaleY;
    const translationContext = {
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
const fitTransformResolvers = {
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
export const computeLayerTransform = (surface, viewport, alignment) => {
    var _a;
    const normalized = normalizeAlignment(alignment);
    const contentWidth = clampDimension(surface.width);
    const contentHeight = clampDimension(surface.height);
    const viewportWidth = clampDimension(viewport.width);
    const viewportHeight = clampDimension(viewport.height);
    const context = {
        contentWidth,
        contentHeight,
        viewportWidth,
        viewportHeight,
        widthRatio: viewportWidth / contentWidth,
        heightRatio: viewportHeight / contentHeight,
        alignment: normalized
    };
    const resolver = (_a = fitTransformResolvers[normalized.fit]) !== null && _a !== void 0 ? _a : fitTransformResolvers.none;
    return resolver(context);
};
export const resolveAutoViewportSize = (mapping) => {
    const canvasWidth = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.canvasWidth, 0));
    const canvasHeight = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.canvasHeight, 0));
    const designWidth = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.designWidth, 0));
    const designHeight = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.designHeight, 0));
    const scaleX = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleX, 1));
    const scaleY = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleY, 1));
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
const axisToPercent = (axis) => {
    if (axis === 'center') {
        return 50;
    }
    if (axis === 'right' || axis === 'bottom') {
        return 100;
    }
    return 0;
};
const resolveBounds = (layer, srcWidth, srcHeight, fallbackAnchor) => {
    var _a, _b, _c;
    const raw = (_b = ((_a = layer.bounds) !== null && _a !== void 0 ? _a : layer.placement)) !== null && _b !== void 0 ? _b : null;
    if (!raw) {
        return { x: 0, y: 0, width: srcWidth, height: srcHeight, anchor: fallbackAnchor };
    }
    return {
        x: toFinite(raw.x, 0),
        y: toFinite(raw.y, 0),
        width: Math.max(1, toFinite(raw.width, srcWidth)),
        height: Math.max(1, toFinite(raw.height, srcHeight)),
        anchor: (_c = raw.anchor) !== null && _c !== void 0 ? _c : fallbackAnchor
    };
};
const finalizeDestination = (rect) => ({
    x: roundPlacementValue(rect.x),
    y: roundPlacementValue(rect.y),
    width: roundPlacementValue(rect.width),
    height: roundPlacementValue(rect.height)
});
const computeAnchorPosition = (ctx, posScaleX, posScaleY) => {
    var _a, _b;
    const baseX = ctx.mapping.offsetX + ctx.bounds.x * posScaleX;
    const baseY = ctx.mapping.offsetY + ctx.bounds.y * posScaleY;
    return {
        x: baseX + toFinite((_a = ctx.alignment.offsetPx) === null || _a === void 0 ? void 0 : _a.x, 0),
        y: baseY + toFinite((_b = ctx.alignment.offsetPx) === null || _b === void 0 ? void 0 : _b.y, 0)
    };
};
const computeAutoPosition = (ctx, width, height) => {
    const availableX = ctx.viewport.width - width;
    const availableY = ctx.viewport.height - height;
    return {
        x: ctx.mapping.offsetX + availableX * (ctx.percent.x / 100),
        y: ctx.mapping.offsetY + availableY * (ctx.percent.y / 100),
        availableX,
        availableY
    };
};
const applyUniformAutoOffsets = (ctx, auto) => {
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
const createScaledDestinationResolver = (getScale) => {
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
const uniformDestinationResolver = (ctx) => {
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
const destinationResolvers = {
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
export const computeLayerDestination = (layer, mapping) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    const srcWidth = Math.max(1, toFinite((_a = layer === null || layer === void 0 ? void 0 : layer.source) === null || _a === void 0 ? void 0 : _a.width, toFinite((_b = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _b === void 0 ? void 0 : _b.width, toFinite((_c = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _c === void 0 ? void 0 : _c.width, 1))));
    const srcHeight = Math.max(1, toFinite((_d = layer === null || layer === void 0 ? void 0 : layer.source) === null || _d === void 0 ? void 0 : _d.height, toFinite((_e = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _e === void 0 ? void 0 : _e.height, toFinite((_f = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _f === void 0 ? void 0 : _f.height, 1))));
    const fallbackAnchor = (_k = (_h = (_g = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _g === void 0 ? void 0 : _g.anchor) !== null && _h !== void 0 ? _h : (_j = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _j === void 0 ? void 0 : _j.anchor) !== null && _k !== void 0 ? _k : 'top-left';
    const layoutBounds = (_l = layer === null || layer === void 0 ? void 0 : layer.bounds) !== null && _l !== void 0 ? _l : null;
    const hasLayoutBounds = Boolean(layoutBounds && Number.isFinite(layoutBounds.width) && Number.isFinite(layoutBounds.height));
    const offsetX = toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.offsetX, 0);
    const offsetY = toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.offsetY, 0);
    const scaleX = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleX, 1)) || 1;
    const scaleY = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleY, 1)) || 1;
    if (hasLayoutBounds) {
        const bx = toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.x, 0);
        const by = toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.y, 0);
        const bw = Math.max(1, toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.width, 1));
        const bh = Math.max(1, toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.height, 1));
        return {
            x: offsetX + bx * scaleX,
            y: offsetY + by * scaleY,
            width: Math.max(1, bw * scaleX),
            height: Math.max(1, bh * scaleY)
        };
    }
    const alignment = normalizeAlignment(layer.alignment);
    const posMode = (_m = alignment.positioning) !== null && _m !== void 0 ? _m : 'anchor';
    const fit = (_p = (_o = layer === null || layer === void 0 ? void 0 : layer.layoutMode) !== null && _o !== void 0 ? _o : alignment.fit) !== null && _p !== void 0 ? _p : 'none';
    const percentWithFallback = (() => {
        var _a;
        const raw = (_a = alignment.offsetPercent) !== null && _a !== void 0 ? _a : { x: 0, y: 0 };
        if (posMode !== 'auto') {
            return raw;
        }
        const x = Number.isFinite(raw.x) ? raw.x : axisToPercent(alignment.horizontal);
        const y = Number.isFinite(raw.y) ? raw.y : axisToPercent(alignment.vertical);
        return { x, y };
    })();
    const percent = {
        x: clampPercent(percentWithFallback.x),
        y: clampPercent(percentWithFallback.y)
    };
    const bounds = resolveBounds(layer, srcWidth, srcHeight, fallbackAnchor);
    const context = {
        alignment,
        bounds,
        mapping: { offsetX, offsetY, scaleX, scaleY },
        percent,
        posMode,
        viewport: resolveAutoViewportSize(mapping),
        baseWidth: bounds.width,
        baseHeight: bounds.height,
        srcWidth,
        srcHeight
    };
    const resolver = (_q = destinationResolvers[fit]) !== null && _q !== void 0 ? _q : destinationResolvers.default;
    const rect = resolver(context);
    return finalizeDestination(rect);
};
export const AlignFitResolver = {
    normalizeAlignment,
    computeLayerTransform,
    computeLayerDestination,
    clampPercent,
    resolveAutoViewportSize
};
export default AlignFitResolver;
