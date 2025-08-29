/**
 * TinyBrush Color Cycle Animation Library
 * Efficient indexed color drawing with animated gradients
 */

// Core components
export { IndexBuffer } from './IndexBuffer';
export { GradientPalette } from './GradientPalette';
export { AnimationController } from './AnimationController';

// Integration layers
export { ColorCycleRenderer } from './ColorCycleRenderer';
export { ColorCycleAnimator } from './ColorCycleAnimator';

// Types
export type { GradientStop, RGBA } from './GradientPalette';
export type { AnimationConfig } from './AnimationController';
export type { ColorCycleConfig } from './ColorCycleRenderer';
export type { ColorCycleAnimatorConfig } from './ColorCycleAnimator';

// Demo
export { ColorCycleDemo, createColorCycleDemo } from './examples/ColorCycleDemo';