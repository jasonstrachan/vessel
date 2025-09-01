/**
 * Central export for all built-in plugin brushes
 * This avoids dynamic import warnings in webpack
 */
export { DitherBrushPlugin } from './DitherBrushPlugin';
export { ParticleBrushPlugin } from './ParticleBrushPlugin';
export { SpamBrushPlugin } from './SpamBrushPlugin';

// Map of known brush plugins for static loading
export const BUILTIN_BRUSH_PLUGINS = {
  'dither-brush': () => import('./DitherBrushPlugin').then(m => new m.DitherBrushPlugin()),
  'particle-brush': () => import('./ParticleBrushPlugin').then(m => new m.ParticleBrushPlugin()),
  'spam-brush': () => import('./SpamBrushPlugin').then(m => new m.SpamBrushPlugin()),
} as const;

export type BuiltinBrushId = keyof typeof BUILTIN_BRUSH_PLUGINS;