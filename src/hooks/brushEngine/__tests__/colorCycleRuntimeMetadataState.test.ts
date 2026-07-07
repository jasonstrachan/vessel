import { ColorCycleRuntimeMetadataState } from '@/hooks/brushEngine/colorCycleRuntimeMetadataState';

describe('ColorCycleRuntimeMetadataState', () => {
  it('tracks active gradient stops with the document version they were built from', () => {
    const state = new ColorCycleRuntimeMetadataState();
    const stops = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];

    state.setGradientStops(stops, 9);

    expect(state.getGradientStops()).toEqual(stops);
    expect(state.getGradientStops()).not.toBe(stops);
    expect(state.getGradientStopsBuiltFromVersion()).toBe(9);
  });

  it('preserves the existing forward-only flow-mode compatibility behavior', () => {
    const state = new ColorCycleRuntimeMetadataState();

    state.setFlowMode('reverse');
    state.setLegacyFlowMode('pingpong');

    expect(state.getFlowMode()).toBe('forward');
    expect(state.getLegacyFlowMode()).toBe('forward');
  });
});
