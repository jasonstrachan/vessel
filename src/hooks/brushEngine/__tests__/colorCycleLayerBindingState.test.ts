import { ColorCycleLayerBindingState } from '../colorCycleLayerBindingState';

describe('ColorCycleLayerBindingState', () => {
  it('keeps active layer and owning layer bindings explicit', () => {
    const state = new ColorCycleLayerBindingState();

    expect(state.getActiveLayerId()).toBeNull();
    expect(state.getLayerId()).toBeNull();

    state.setActiveLayerId('active-layer');
    expect(state.getActiveLayerId()).toBe('active-layer');
    expect(state.getLayerId()).toBeNull();

    state.setLayerId('owned-layer');
    expect(state.getLayerId()).toBe('owned-layer');
    expect(state.getActiveLayerId()).toBe('owned-layer');
  });

  it('tracks isolation as service-local composition state', () => {
    const state = new ColorCycleLayerBindingState();

    expect(state.isIsolated()).toBe(false);
    state.setIsolated(true);
    expect(state.isIsolated()).toBe(true);
  });
});
