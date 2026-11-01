// Default canvas dimensions used throughout the application
// Using 1000x1000 square canvas as default
export const DEFAULT_CANVAS_WIDTH = 1000;
export const DEFAULT_CANVAS_HEIGHT = 1000;

export const DEFAULT_NEW_DOCUMENT_WIDTH = 768;
export const DEFAULT_NEW_DOCUMENT_HEIGHT = 960;

// Canvas zoom boundaries – min avoids numerical instability, max keeps transforms precise
export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 40;
export const DEFAULT_PIXEL_GRID_ZOOM_THRESHOLD = 30;
export const PIXEL_GRID_ZOOM_THRESHOLDS = [10, 20, 30, 40] as const;

export const isPixelGridZoomThreshold = (value: unknown): value is number =>
  typeof value === 'number' && PIXEL_GRID_ZOOM_THRESHOLDS.some((zoom) => zoom === value);

// Canvas rendering settings
export const CANVAS_CONTEXT_SETTINGS = {
  willReadFrequently: true,
  imageSmoothingEnabled: false,
} as const;
