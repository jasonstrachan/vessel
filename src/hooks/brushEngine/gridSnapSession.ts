import type { GridSpacing } from './gridStroke';
import type { PixelQueue } from './types';

type GridSnapMode = 'grid' | 'custom';

export class GridSnapSession {
  private spacing: GridSpacing | null = null;
  private mode: GridSnapMode | null = null;

  resolve(mode: GridSnapMode, nextSpacing: GridSpacing, pixelQueue: PixelQueue): GridSpacing {
    if (!pixelQueue.initialized || !this.spacing || this.mode !== mode) {
      this.spacing = {
        x: Math.max(1, Math.round(nextSpacing.x)),
        y: Math.max(1, Math.round(nextSpacing.y)),
      };
      this.mode = mode;
    }

    return this.spacing;
  }

  reset(): void {
    this.spacing = null;
    this.mode = null;
  }
}
