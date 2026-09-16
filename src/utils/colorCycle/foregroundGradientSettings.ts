export const DEFAULT_FG_CONTRAST = 40;
export const DEFAULT_FG_COLORS = 4;

export const clampForegroundContrast = (value?: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value!))) : DEFAULT_FG_CONTRAST;

export const clampForegroundColors = (value?: number): number =>
  Number.isFinite(value) ? Math.max(2, Math.min(16, Math.round(value!))) : DEFAULT_FG_COLORS;
