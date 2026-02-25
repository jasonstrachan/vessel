/**
 * Central export for all built-in plugin brushes
 * This avoids dynamic import warnings in webpack
 */
import type { BrushSettings, SequentialBrushSnapshot } from '@/types';
import { serializeDitherPluginConfig } from './DitherBrushPlugin';
import { serializeParticlePluginConfig } from './ParticleBrushPlugin';
import { serializeSpamPluginConfig } from './SpamBrushPlugin';

export { DitherBrushPlugin } from './DitherBrushPlugin';
export { ParticleBrushPlugin } from './ParticleBrushPlugin';
export { SpamBrushPlugin } from './SpamBrushPlugin';
export { serializeDitherPluginConfig } from './DitherBrushPlugin';
export { serializeParticlePluginConfig } from './ParticleBrushPlugin';
export { serializeSpamPluginConfig } from './SpamBrushPlugin';

// Map of known brush plugins for static loading
export const BUILTIN_BRUSH_PLUGINS = {
  'dither-brush': () => import('./DitherBrushPlugin').then(m => new m.DitherBrushPlugin()),
  'particle-brush': () => import('./ParticleBrushPlugin').then(m => new m.ParticleBrushPlugin()),
  'spam-brush': () => import('./SpamBrushPlugin').then(m => new m.SpamBrushPlugin()),
} as const;

export type BuiltinBrushId = keyof typeof BUILTIN_BRUSH_PLUGINS;

export const serializeBuiltinPluginSequentialConfig = (
  pluginBrushId: string,
  settings: BrushSettings
): SequentialBrushSnapshot['pluginConfig'] | null => {
  switch (pluginBrushId) {
    case 'spam-brush':
      return serializeSpamPluginConfig(settings);
    case 'dither-brush':
      return serializeDitherPluginConfig(settings);
    case 'particle-brush':
      return serializeParticlePluginConfig(settings);
    default:
      return null;
  }
};
