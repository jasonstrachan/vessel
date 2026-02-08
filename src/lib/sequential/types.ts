import type { SequentialStrokeEvent } from '@/types';

export type SequentialPixelFormat = 'rgba8';

export interface FrameTile {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface FrameTileSet {
  frameIndex: number;
  tileSize: number;
  pixelFormat: SequentialPixelFormat;
  premultipliedAlpha: true;
  colorSpace: 'srgb';
  tiles: FrameTile[];
}

export interface SequentialFrameCacheStats {
  entries: number;
  hits: number;
  misses: number;
  dirtyFrames: number;
}

export interface SequentialMaterializeFrameInput {
  width: number;
  height: number;
  frameIndex: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}
