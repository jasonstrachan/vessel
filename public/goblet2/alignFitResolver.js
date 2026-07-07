// Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.

import { clamp, round3, toNum } from '@/utils/num';
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
            return 'contain';
    }
};
export const normalizeAlignment = (alignment) => {
    var _a, _b, _c;
    // Default to centered placement so layers without explicit anchors remain centered in the viewport.
    const defaultHorizontal = 'center';
    const defaultVertical = 'center';
    const horizontal = (_a = alignment === null || alignment === void 0 ? void 0 : alignment.horizontal) !== null && _a !== void 0 ? _a : defaultHorizontal;
    const vertical = (_b = alignment === null || alignment === void 0 ? void 0 : alignment.vertical) !== null && _b !== void 0 ? _b : defaultVertical;
    const normalized = {
        fit: normalizeFit(alignment === null || alignment === void 0 ? void 0 : alignment.fit),
        horizontal,
        vertical,
        positioning: (_c = alignment === null || alignment === void 0 ? void 0 : alignment.positioning) !== null && _c !== void 0 ? _c : 'auto',
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
// Fit modes share a single sizing basis so contain/cover/fill behave consistently:
// - By default we respect the full document bounds, but once painted bounds exist we
//   scale against the visible pixels so AUTO/ANCHOR don't drift from the user's crop.
// - Anchor affects translation only; fit mode remains responsible for scale.
const getBasisSize = (document, paintedBounds, alignment) => {
    var _a, _b;
    const usePaintedBounds = alignment.positioning === 'anchor' || alignment.fit === 'tile';
    const w = usePaintedBounds
        ? clampDimension((_a = paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.width) !== null && _a !== void 0 ? _a : document.width)
        : clampDimension(document.width);
    const h = usePaintedBounds
        ? clampDimension((_b = paintedBounds === null || paintedBounds === void 0 ? void 0 : paintedBounds.height) !== null && _b !== void 0 ? _b : document.height)
        : clampDimension(document.height);
    return { w, h };
};
export const computeLayerTransform = (document, viewport, alignment, _options = {}) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const normalized = normalizeAlignment(alignment);
    const safeViewport = resolveViewport(viewport);
    const safeDocument = resolveDocument(document);
    const painted = _options.paintedBounds
        ? resolvePaintedBounds(_options.paintedBounds, safeDocument)
        : null;
    const percentX = (_b = (_a = normalized.offsetPercent) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0;
    const percentY = (_d = (_c = normalized.offsetPercent) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0;
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
    const renderedWidth = basisWidth * scaleX;
    const renderedHeight = basisHeight * scaleY;
    const leftoverX = viewportWidth - renderedWidth;
    const leftoverY = viewportHeight - renderedHeight;
    let translateX;
    let translateY;
    if (isAnchor) {
        const horizontal = normalized.horizontal;
        const vertical = normalized.vertical;
        const fallbackPercentX = horizontalAnchorPercent[horizontal];
        const fallbackPercentY = verticalAnchorPercent[vertical];
        const pivotX = horizontal === 'center' ? leftoverX / 2 : horizontal === 'right' ? leftoverX : 0;
        const pivotY = vertical === 'center' ? leftoverY / 2 : vertical === 'bottom' ? leftoverY : 0;
        const offsetPercentX = ((_f = (_e = normalized.offsetPercent) === null || _e === void 0 ? void 0 : _e.x) !== null && _f !== void 0 ? _f : fallbackPercentX) - fallbackPercentX;
        const offsetPercentY = ((_h = (_g = normalized.offsetPercent) === null || _g === void 0 ? void 0 : _g.y) !== null && _h !== void 0 ? _h : fallbackPercentY) - fallbackPercentY;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const safeDocument = resolveDocument(input.document);
    const safeViewport = resolveViewport(input.viewport);
    const normalized = normalizeAlignment(input.alignment);
    const painted = resolvePaintedBounds(input.paintedBounds, safeDocument);
    const usePaintedBounds = normalized.positioning === 'anchor' || normalized.fit === 'tile';
    const basisWidth = usePaintedBounds ? Math.max(MIN_DIMENSION, painted.width) : safeDocument.width;
    const basisHeight = usePaintedBounds ? Math.max(MIN_DIMENSION, painted.height) : safeDocument.height;
    let width;
    let height;
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
        const horizontal = (_a = normalized.horizontal) !== null && _a !== void 0 ? _a : 'left';
        const vertical = (_b = normalized.vertical) !== null && _b !== void 0 ? _b : 'top';
        let x = 0;
        if (horizontal === 'center') {
            x = freeX / 2;
        }
        else if (horizontal === 'right') {
            x = freeX;
        }
        let y = 0;
        if (vertical === 'center') {
            y = freeY / 2;
        }
        else if (vertical === 'bottom') {
            y = freeY;
        }
        const offsetPercent = (_c = input.alignment) === null || _c === void 0 ? void 0 : _c.offsetPercent;
        const offsetPercentX = clampPercent((_d = offsetPercent === null || offsetPercent === void 0 ? void 0 : offsetPercent.x) !== null && _d !== void 0 ? _d : 0);
        const offsetPercentY = clampPercent((_e = offsetPercent === null || offsetPercent === void 0 ? void 0 : offsetPercent.y) !== null && _e !== void 0 ? _e : 0);
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
    const percentX = ((_g = (_f = normalized.offsetPercent) === null || _f === void 0 ? void 0 : _f.x) !== null && _g !== void 0 ? _g : 0) / HUNDRED;
    const percentY = ((_j = (_h = normalized.offsetPercent) === null || _h === void 0 ? void 0 : _h.y) !== null && _j !== void 0 ? _j : 0) / HUNDRED;
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
    // When there is no free space (content already fills the document) keep the
    // layer centered instead of snapping to the top-left. This preserves the
    // expected visual alignment when users draw edge-to-edge and then switch to
    // `contain` fit.
    const percentX = availableX > MIN_DIMENSION
        ? clampPercent((safeBounds.x / availableX) * HUNDRED)
        : 50;
    const percentY = availableY > MIN_DIMENSION
        ? clampPercent((safeBounds.y / availableY) * HUNDRED)
        : 50;
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
