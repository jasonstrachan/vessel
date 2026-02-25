const OVERLAY_LAYER_SEEDED_FLAG = '__vesselOverlayLayerSeeded';

type SeedTrackedCanvas = HTMLCanvasElement & {
  [OVERLAY_LAYER_SEEDED_FLAG]?: boolean;
};

export const setOverlaySeededFromLayer = (
  canvas: HTMLCanvasElement | null,
  seeded: boolean
): void => {
  if (!canvas) {
    return;
  }
  (canvas as SeedTrackedCanvas)[OVERLAY_LAYER_SEEDED_FLAG] = seeded;
};

export const isOverlaySeededFromLayer = (canvas: HTMLCanvasElement | null): boolean => {
  if (!canvas) {
    return false;
  }
  return Boolean((canvas as SeedTrackedCanvas)[OVERLAY_LAYER_SEEDED_FLAG]);
};
