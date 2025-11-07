export const EDGE_PADDING_EPSILON = 1e-3;

export const applyEdgePadding = (value: number): number => {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped <= EDGE_PADDING_EPSILON) return EDGE_PADDING_EPSILON;
  if (clamped >= 1 - EDGE_PADDING_EPSILON) return 1 - EDGE_PADDING_EPSILON;
  return clamped;
};
