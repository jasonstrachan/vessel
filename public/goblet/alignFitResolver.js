// Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.

const MIN_DIMENSION = 1e-6;
const HUNDRED = 100;
const ROUND_PRECISION = 1e3;
const horizontalAnchorPercent = {
    left: 0,
    center: 50,
    right: 100
};
const verticalAnchorPercent = {
    top: 0,
    center: 50,
    bottom: 100
};
const toNumber = (value) => {
    if (typeof value === 'number') {
        return value;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
};
export const clampDimension = (value, fallback = MIN_DIMENSION) => {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback;
    }
    return numeric;
};
export const clampPercent = (value) => {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(-HUNDRED, Math.min(HUNDRED, numeric));
};
export const roundPlacementValue = (value) => {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.round(numeric * ROUND_PRECISION) / ROUND_PRECISION;
};
const normalizeOffsetPercent = (alignment, normalizedHorizontal, normalizedVertical) => {
    var _a, _b;
    const fallback = {
        x: horizontalAnchorPercent[normalizedHorizontal],
        y: verticalAnchorPercent[normalizedVertical]
    };
    const offset = alignment === null || alignment === void 0 ? void 0 : alignment.offsetPercent;
    if (!offset) {
        return fallback;
    }
    return {
        x: clampPercent((_a = offset.x) !== null && _a !== void 0 ? _a : fallback.x),
        y: clampPercent((_b = offset.y) !== null && _b !== void 0 ? _b : fallback.y)
    };
};
const normalizeFit = (fit) => {
    switch (fit) {
        case 'uniform':
        case 'contain':
        case 'contain-up':
        case 'cover':
        case 'fill':
        case 'none':
            return fit;
        default:
            return 'none';
    }
};
export const normalizeAlignment = (alignment) => {
    var _a, _b, _c;
    const horizontal = (_a = alignment === null || alignment === void 0 ? void 0 : alignment.horizontal) !== null && _a !== void 0 ? _a : 'left';
    const vertical = (_b = alignment === null || alignment === void 0 ? void 0 : alignment.vertical) !== null && _b !== void 0 ? _b : 'top';
    const normalized = {
        fit: normalizeFit(alignment === null || alignment === void 0 ? void 0 : alignment.fit),
        horizontal,
        vertical,
        positioning: (_c = alignment === null || alignment === void 0 ? void 0 : alignment.positioning) !== null && _c !== void 0 ? _c : 'anchor',
        offsetPercent: normalizeOffsetPercent(alignment, horizontal, vertical)
    };
    return normalized;
};
const resolveViewport = (viewport) => ({
    width: clampDimension(viewport.width),
    height: clampDimension(viewport.height)
});
const resolveDocument = (document) => ({
    width: clampDimension(document.width),
    height: clampDimension(document.height)
});
const resolvePaintedBounds = (bounds, fallback) => {
    var _a, _b;
    const width = clampDimension(bounds === null || bounds === void 0 ? void 0 : bounds.width, (_a = fallback === null || fallback === void 0 ? void 0 : fallback.width) !== null && _a !== void 0 ? _a : MIN_DIMENSION);
    const height = clampDimension(bounds === null || bounds === void 0 ? void 0 : bounds.height, (_b = fallback === null || fallback === void 0 ? void 0 : fallback.height) !== null && _b !== void 0 ? _b : MIN_DIMENSION);
    return {
        x: toNumber(bounds === null || bounds === void 0 ? void 0 : bounds.x) || 0,
        y: toNumber(bounds === null || bounds === void 0 ? void 0 : bounds.y) || 0,
        width,
        height
    };
};
export const computeLayerTransform = (document, viewport, alignment, options = {}) => {
    var _a, _b, _c, _d;
    const normalized = normalizeAlignment(alignment);
    const safeViewport = resolveViewport(viewport);
    const safeDocument = resolveDocument(document);
    const bounds = resolvePaintedBounds(options.paintedBounds, safeDocument);
    const percentX = (_b = (_a = normalized.offsetPercent) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0;
    const percentY = (_d = (_c = normalized.offsetPercent) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0;
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
            const uniformScale = Math.min(viewportWidth / basisWidth, viewportHeight / basisHeight);
            scaleX = uniformScale;
            scaleY = uniformScale;
            break;
        }
        case 'contain-up': {
            const scale = Math.max(1, Math.min(viewportWidth / documentWidth, viewportHeight / documentHeight));
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
export const computeLayerDestination = (input) => {
    const bounds = resolvePaintedBounds(input.paintedBounds);
    const normalized = normalizeAlignment(input.alignment);
    const anchorContent = normalized.positioning === 'anchor';
    const document = anchorContent
        ? {
            width: Math.max(MIN_DIMENSION, bounds.width),
            height: Math.max(MIN_DIMENSION, bounds.height)
        }
        : resolveDocument(input.document);
    const transform = computeLayerTransform(document, input.viewport, normalized, { paintedBounds: bounds });
    const basisWidth = document.width;
    const basisHeight = document.height;
    const width = basisWidth * transform.scaleX;
    const height = basisHeight * transform.scaleY;
    const addBoundsOffset = !(
        anchorContent || (
        normalized.fit === 'uniform' &&
            (normalized.positioning === 'anchor' || normalized.positioning === 'auto'))
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
export const derivePercentBounds = (bounds, document) => {
    const safeDocument = resolveDocument(document);
    const safeBounds = resolvePaintedBounds(bounds);
    return {
        x: (safeBounds.x / safeDocument.width) * HUNDRED,
        y: (safeBounds.y / safeDocument.height) * HUNDRED,
        width: (safeBounds.width / safeDocument.width) * HUNDRED,
        height: (safeBounds.height / safeDocument.height) * HUNDRED
    };
};
export const deriveAutoPercentOffset = (bounds, document) => {
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
export default AlignFitResolver;
