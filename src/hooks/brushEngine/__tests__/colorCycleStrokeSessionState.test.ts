import { ColorCycleStrokeSessionState } from '../colorCycleStrokeSessionState';

describe('ColorCycleStrokeSessionState', () => {
  it('owns transient drawing state and stroke counters', () => {
    const state = new ColorCycleStrokeSessionState();

    expect(state.isDrawing()).toBe(false);
    state.setDrawing(true);
    expect(state.isDrawing()).toBe(true);

    expect(state.incrementStrokeCounter()).toBe(1);
    expect(state.getStrokeCounter()).toBe(1);
    state.setStrokeCounter(12);
    expect(state.getStrokeCounter()).toBe(12);
  });

  it('owns stamp sequencing separately from per-layer stroke data', () => {
    const state = new ColorCycleStrokeSessionState();

    expect(state.getStampCounter()).toBe(0);
    expect(state.advanceStampCounter(5)).toBe(5);
    expect(state.advanceStampCounter(3)).toBe(8);
    state.resetStampCounter();
    expect(state.getStampCounter()).toBe(0);
  });
});
