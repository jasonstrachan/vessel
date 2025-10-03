// Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.

import { clamp, round3, toNum } from './num.js';
const MIN_DIMENSION = 1e-6;
const HUNDRED = 100;
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
export const clampDimension = (value, fallback = MIN_DIMENSION) => {
    const fallbackSafe = fallback > 0 ? fallback : MIN_DIMENSION;
    const numeric = toNum(value, fallbackSafe);
    return numeric > 0 ? numeric : fallbackSafe;
};
export const clampPercent = (value) => {
    return clamp(toNum(value, 0), -HUNDRED, HUNDRED);
};
export const roundPlacementValue = (value) => {
    return round3(value);
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
export const normalizeAlignment = (alignment) => {
    var _a, _b, _c;
    const desiredFit = alignment === null || alignment === void 0 ? void 0 : alignment.fit;
    const defaultHorizontal = desiredFit === 'tile' ? 'center' : 'left';
    const defaultVertical = desiredFit === 'tile' ? 'center' : 'top';
    const horizontal = (_a = alignment === null || alignment === void 0 ? void 0 : alignment.horizontal) !== null && _a !== void 0 ? _a : defaultHorizontal;
    const vertical = (_b = alignment === null || alignment === void 0 ? void 0 : alignment.vertical) !== null && _b !== void 0 ? _b : defaultVertical;
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
        x: toNum(bounds === null || bounds === void 0 ? void 0 : bounds.x, 0),
        y: toNum(bounds === null || bounds === void 0 ? void 0 : bounds.y, 0),
        width,
        height
    };
};
// Fit modes share a single sizing basis so contain/cover/fill stay consistent with
// painted pixels; anchor positioning later decides whether scaling is applied.
const getBasisSize = (document, paintedBounds) => {
    const w = clampDimension((paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.width) !== null && (paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.width) !== void 0 ? paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.width : document.width);
    const h = clampDimension((paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.height) !== null && (paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.height) !== void 0 ? paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.height : document.height);
    return { w, h };
};
export const computeLayerTransform = (document, viewport, alignment, _options = {}) => {
    var _a, _b, _c, _d, _e, _f;
    const normalized = normalizeAlignment(alignment);
    const safeViewport = resolveViewport(viewport);
    const safeDocument = resolveDocument(document);
    const painted = _options.paintedBounds
        ? resolvePaintedBounds(_options.paintedBounds, safeDocument)
        : null;
    const percentX = (_b = (_a = normalized.offsetPercent) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0;
    const percentY = (_d = (_c = normalized.offsetPercent) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0;
    const { w: basisWidth, h: basisHeight } = getBasisSize(safeDocument, painted);
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
    let translateX;
    let translateY;
    if (isAnchor) {
        var _g, _h;
        const horizontal = normalized.horizontal;
        const vertical = normalized.vertical;
        const fallbackPercentX = horizontalAnchorPercent[horizontal];
        const fallbackPercentY = verticalAnchorPercent[vertical];
        const pivotX = horizontal === 'center' ? leftoverX / 2 : horizontal === 'right' ? leftoverX : 0;
        const pivotY = vertical === 'center' ? leftoverY / 2 : vertical === 'bottom' ? leftoverY : 0;
        const rawOffsetX = (_g = normalized.offsetPercent) === null || _g === void 0 ? void 0 : _g.x;
        const rawOffsetY = (_h = normalized.offsetPercent) === null || _h === void 0 ? void 0 : _h.y;
        const offsetPercentX = (rawOffsetX !== null && rawOffsetX !== void 0 ? rawOffsetX : fallbackPercentX) - fallbackPercentX;
        const offsetPercentY = (rawOffsetY !== null && rawOffsetY !== void 0 ? rawOffsetY : fallbackPercentY) - fallbackPercentY;
        const offsetX = (offsetPercentX / HUNDRED) * leftoverX;
        const offsetY = (offsetPercentY / HUNDRED) * leftoverY;
        translateX = pivotX + offsetX;
        translateY = pivotY + offsetY;
    }
    else {
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
export const computeLayerDestination = (input) => {
    const safeDocument = resolveDocument(input.document);
    const safeViewport = resolveViewport(input.viewport);
    const normalized = normalizeAlignment(input.alignment);
    const painted = resolvePaintedBounds(input.paintedBounds, safeDocument);
    const fitRaw = String((input.alignment?.fit ?? 'none')).trim().toLowerCase();
    const fit = fitRaw === 'uniform'
        ? 'contain'
        : fitRaw === 'contain-up'
            ? 'contain'
            : fitRaw;
    // Basis: always painted (visible) pixels if available
    const basisWidth = Math.max(1, painted.width);
    const basisHeight = Math.max(1, painted.height);
    let width;
    let height;
    switch (fit) {
        case 'none': {
            width = basisWidth;
            height = basisHeight;
            break;
        }
        case 'contain': {
            const scale = Math.min(safeViewport.width / basisWidth, safeViewport.height / basisHeight);
            width = Math.max(1, Math.round(basisWidth * scale));
            height = Math.max(1, Math.round(basisHeight * scale));
            break;
        }
        case 'cover': {
            const scale = Math.max(safeViewport.width / basisWidth, safeViewport.height / basisHeight);
            width = Math.max(1, Math.round(basisWidth * scale));
            height = Math.max(1, Math.round(basisHeight * scale));
            break;
        }
        case 'fill': {
            // Non-uniform stretch to viewport (by spec)
            width = safeViewport.width;
            height = safeViewport.height;
            break;
        }
        case 'tile': {
            width = safeViewport.width;
            height = safeViewport.height;
            break;
        }
        default: {
            width = basisWidth;
            height = basisHeight;
            break;
        }
    }
    if (fit === 'contain' || fit === 'cover') {
        const scaleX = width / basisWidth;
        const scaleY = height / basisHeight;
        if (Math.abs(scaleX - scaleY) > 1e-6) {
            console.warn('[fit]', fit, 'is not uniform', { scaleX, scaleY, basisWidth, basisHeight, width, height });
        }
    }
    if (normalized.positioning === 'anchor') {
        const freeX = safeViewport.width - width;
        const freeY = safeViewport.height - height;
        const horizontal = normalized.horizontal ?? 'left';
        const vertical = normalized.vertical ?? 'top';
        let x = horizontal === 'center' ? freeX / 2 : horizontal === 'right' ? freeX : 0;
        let y = (vertical === 'middle' || vertical === 'center') ? freeY / 2 : vertical === 'bottom' ? freeY : 0;
        const offsetPercent = input.alignment?.offsetPercent;
        x += ((Number(offsetPercent?.x) || 0) * 0.01 * freeX);
        y += ((Number(offsetPercent?.y) || 0) * 0.01 * freeY);
        return {
            x: Math.round(x),
            y: Math.round(y),
            width,
            height
        };
    }
    // AUTO: keep existing offset logic; width/height already final.
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
