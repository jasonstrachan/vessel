// Default canvas dimensions used throughout the application
// Using common HD resolution as default for better performance
export const DEFAULT_CANVAS_WIDTH = 1920;
export const DEFAULT_CANVAS_HEIGHT = 1080;

// Canvas rendering settings
export const CANVAS_CONTEXT_SETTINGS = {
  willReadFrequently: true,
  imageSmoothingEnabled: false,
} as const;