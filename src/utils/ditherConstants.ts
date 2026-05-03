export const LOST_EDGE_TILE_MIN = 2;
export const LOST_EDGE_TILE_MAX = 8;
export const LOST_EDGE_TILE_DEFAULT = 2;

export const LOST_EDGE_BAND_MIN_PX = 2;
// Allow a wider fade when users crank the falloff slider; larger strokes were clipping at ~100px.
export const LOST_EDGE_BAND_MAX_PX = 220;
export const LOST_EDGE_MAX_DIM_FRACTION = 0.7; // prevent mid values from consuming small shapes
export const LOST_EDGE_INTENSITY_EXP = 1.5; // slower low-end slider ramp for smoother edge falloff
export const LOST_EDGE_SEARCH_SCALE = 1.1; // bandRadius multiplier
export const LOST_EDGE_FADE_FRACTION = 0.9; // portion of band used for fade

// Small-region bailout threshold multiplier
export const LOST_EDGE_MIN_DIM_TILE_MULTIPLIER = 2;

// Fast-path thresholds
export const LOST_EDGE_SOLID_SKIP_BAND_PX = 32; // if band below and coverage full, skip erosion
export const LOST_EDGE_CACHE_LIMIT = 3;
