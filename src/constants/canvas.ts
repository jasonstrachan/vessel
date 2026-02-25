// Default canvas dimensions used throughout the application
// Using 1000x1000 square canvas as default
export const DEFAULT_CANVAS_WIDTH = 1000;
export const DEFAULT_CANVAS_HEIGHT = 1000;

// Canvas zoom boundaries – min avoids numerical instability, max keeps transforms precise
export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 40;

// Canvas rendering settings
export const CANVAS_CONTEXT_SETTINGS = {
  willReadFrequently: true,
  imageSmoothingEnabled: false,
} as const;
