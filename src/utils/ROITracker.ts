export type ROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Tracks the smallest axis-aligned rectangle that bounds a set of points/segments.
 * Designed for fast updates during pointer move batches.
 */
export class ROITracker {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private lastPointValue: { x: number; y: number } | null = null;

  addPoint(point: { x: number; y: number }, padding = 0): void {
    this.minX = Math.min(this.minX, point.x - padding);
    this.minY = Math.min(this.minY, point.y - padding);
    this.maxX = Math.max(this.maxX, point.x + padding);
    this.maxY = Math.max(this.maxY, point.y + padding);
    this.lastPointValue = point;
  }

  addSegment(
    start: { x: number; y: number },
    end: { x: number; y: number },
    padding = 0
  ): void {
    this.addPoint(start, padding);
    this.addPoint(end, padding);
    this.lastPointValue = end;
  }

  lastPoint(): { x: number; y: number } | null {
    return this.lastPointValue;
  }

  rect(): ROI | null {
    if (!Number.isFinite(this.minX) || !Number.isFinite(this.minY)) {
      return null;
    }
    const x = Math.floor(this.minX);
    const y = Math.floor(this.minY);
    const width = Math.ceil(this.maxX) - x;
    const height = Math.ceil(this.maxY) - y;
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { x, y, width, height };
  }

  reset(): void {
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this.lastPointValue = null;
  }
}
