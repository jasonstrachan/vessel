/**
 * Color Cycle Rendering Pipeline - Phase 2
 * 
 * High-performance rendering system with hot path optimization,
 * fast remapping, and intelligent gradient LUT management.
 */

export { HotPathRenderer } from './HotPathRenderer';
export type { RenderingContext, FastRemapOptions } from './HotPathRenderer';

export { FastGradientLUT } from './FastGradientLUT';
export type { GradientStop, LUTBuildOptions } from './FastGradientLUT';