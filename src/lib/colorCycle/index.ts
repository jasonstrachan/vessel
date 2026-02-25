/**
 * Color Cycle Recolor Feature - Phases 1 & 2 Complete
 * 
 * This module implements the "Recolor & Animate" mode for the Color Cycle tool,
 * converting any layer to an animated 256-color cycling effect with high-performance
 * rendering and advanced memory management.
 * 
 * Phase 1 - Core Foundation:
 * - Data model extensions
 * - RGB332 fast quantization 
 * - Index buffer system & cache management
 * - Basic animation loop with tick system
 * 
 * Phase 2 - Rendering Pipeline:
 * - Hot path optimization & fast remapping
 * - Advanced memory optimization & pooling
 * - Comprehensive performance monitoring & metrics
 */

// Phase 1: Core Foundation
export { ColorQuantizer } from './ColorQuantizer';
export type { QuantizedResult } from './ColorQuantizer';

export { RecolorEngine } from './RecolorEngine';
export type { RecolorEngineConfig } from './RecolorEngine';

export { RecolorAnimationController } from './RecolorAnimationController';
export type { AnimatedLayer, AnimationStats } from './RecolorAnimationController';

export { RecolorManager } from './RecolorManager';
export type { RecolorOptions, ExtractColorsOptions } from './RecolorManager';

// Phase 2: Rendering Pipeline
export * from './rendering';
export * from './memory';
export * from './performance';

// Re-export related types from the main types file
export type {
  Layer,
} from '../../types';