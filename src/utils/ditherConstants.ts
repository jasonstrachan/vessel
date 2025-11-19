export const LOST_EDGE_TILE_MIN = 2;
export const LOST_EDGE_TILE_MAX = 8;
export const LOST_EDGE_TILE_DEFAULT = 4;

export const LOST_EDGE_BAND_MIN_PX = 2;
export const LOST_EDGE_BAND_MAX_PX = 100;
export const LOST_EDGE_INTENSITY_EXP = 0.75; // easing curve for slider mapping
export const LOST_EDGE_SEARCH_SCALE = 1.1; // bandRadius multiplier
export const LOST_EDGE_FADE_FRACTION = 0.6; // portion of band used for fade

// Small-region bailout threshold multiplier
export const LOST_EDGE_MIN_DIM_TILE_MULTIPLIER = 2;

// Fast-path thresholds
export const LOST_EDGE_SOLID_SKIP_BAND_PX = 32; // if band below and coverage full, skip erosion
export const LOST_EDGE_CACHE_LIMIT = 3;
