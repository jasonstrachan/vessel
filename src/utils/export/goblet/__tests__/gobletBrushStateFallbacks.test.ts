import {
  ensureOpaqueIndexAlphaMode,
  resolveGobletBrushStateFallback,
} from '@/utils/export/goblet/gobletBrushStateFallbacks';
import type { WebGLSerializedBrushState } from '@/utils/export/goblet/gobletTypes';

const makeBrushState = (index: number): WebGLSerializedBrushState => ({
  width: 1,
  height: 1,
  indexBuffer: [index],
  gradientStops: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  animationOffset: 0,
});

describe('gobletBrushStateFallbacks', () => {
  it('normalizes fallback brush states to opaque index alpha mode', () => {
    const brushState = makeBrushState(1);

    expect(ensureOpaqueIndexAlphaMode(brushState)).toMatchObject({
      alphaMode: 'opaque-indices',
    });
  });

  it('keeps the canonical Goblet fallback priority explicit', () => {
    expect(resolveGobletBrushStateFallback({
      documentState: () => makeBrushState(1),
      brushProperties: () => makeBrushState(2),
      animator: () => makeBrushState(3),
      savedSnapshot: () => makeBrushState(4),
    })?.indexBuffer).toEqual([1]);

    expect(resolveGobletBrushStateFallback({
      documentState: () => undefined,
      brushProperties: () => makeBrushState(2),
      animator: () => makeBrushState(3),
      savedSnapshot: () => makeBrushState(4),
    })?.indexBuffer).toEqual([2]);

    expect(resolveGobletBrushStateFallback({
      documentState: () => undefined,
      brushProperties: () => undefined,
      animator: () => makeBrushState(3),
      savedSnapshot: () => makeBrushState(4),
    })?.indexBuffer).toEqual([3]);

    expect(resolveGobletBrushStateFallback({
      documentState: () => undefined,
      brushProperties: () => undefined,
      animator: () => undefined,
      savedSnapshot: () => makeBrushState(4),
    })?.indexBuffer).toEqual([4]);
  });
});
