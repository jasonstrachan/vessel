"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyEdgePadding = exports.EDGE_PADDING_EPSILON = void 0;
exports.EDGE_PADDING_EPSILON = 1e-3;
const applyEdgePadding = (value) => {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped <= exports.EDGE_PADDING_EPSILON)
        return exports.EDGE_PADDING_EPSILON;
    if (clamped >= 1 - exports.EDGE_PADDING_EPSILON)
        return 1 - exports.EDGE_PADDING_EPSILON;
    return clamped;
};
exports.applyEdgePadding = applyEdgePadding;
