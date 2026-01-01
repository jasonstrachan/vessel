import { StrokeOrderTracker } from '@/lib/colorCycle/StrokeOrderTracker';

describe('StrokeOrderTracker', () => {
  it('serializes flow state', () => {
    const tracker = new StrokeOrderTracker(4, 4);

    tracker.setFlowMode('pingpong', 0.25);

    const serialized = tracker.serialize();
    expect(serialized.flowMode).toBe('pingpong');
    expect(serialized.currentStrokeIndex).toBe(1);
    expect(serialized.maxStrokeIndex).toBe(0);
  });
});
