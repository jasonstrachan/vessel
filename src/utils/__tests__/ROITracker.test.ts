import { ROITracker } from '@/utils/ROITracker';

describe('ROITracker', () => {
  it('computes bounding rectangle with padding for points and segments', () => {
    const tracker = new ROITracker();
    tracker.addPoint({ x: 10, y: 10 }, 2);
    tracker.addSegment({ x: 20, y: 20 }, { x: 30, y: 35 }, 3);

    const roi = tracker.rect();
    expect(roi).toEqual({ x: 8, y: 8, width: 25, height: 30 });
  });

  it('returns null when no points have been added', () => {
    const tracker = new ROITracker();
    expect(tracker.rect()).toBeNull();
  });
});
