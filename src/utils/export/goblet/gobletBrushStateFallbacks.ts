import type { WebGLSerializedBrushState } from '@/utils/export/goblet/gobletTypes';

export type GobletBrushStateFallbackSource = () => WebGLSerializedBrushState | undefined;

export type GobletBrushStateFallbackSources = {
  documentState: GobletBrushStateFallbackSource;
  brushProperties: GobletBrushStateFallbackSource;
  animator: GobletBrushStateFallbackSource;
  savedSnapshot: GobletBrushStateFallbackSource;
};

export const ensureOpaqueIndexAlphaMode = (
  brushState: WebGLSerializedBrushState | undefined
): WebGLSerializedBrushState | undefined => {
  if (brushState && !brushState.alphaMode) {
    brushState.alphaMode = 'opaque-indices';
  }
  return brushState;
};

export const resolveGobletBrushStateFallback = (
  sources: GobletBrushStateFallbackSources
): WebGLSerializedBrushState | undefined =>
  ensureOpaqueIndexAlphaMode(sources.documentState())
  ?? ensureOpaqueIndexAlphaMode(sources.brushProperties())
  ?? ensureOpaqueIndexAlphaMode(sources.animator())
  ?? ensureOpaqueIndexAlphaMode(sources.savedSnapshot());
