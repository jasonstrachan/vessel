import { ColorCycleGradientSlotState } from '../colorCycleGradientSlotState';

describe('ColorCycleGradientSlotState', () => {
  it('tracks slot cache versions', () => {
    const state = new ColorCycleGradientSlotState();
    const stops = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];

    state.setSlot('layer-1', 2, stops, 'sig-1', 'soft', 7);

    expect(state.getSlotStops('layer-1', 2)).toBe(stops);
    expect(state.getSlotSignature('layer-1', 2)).toBe('sig-1');
    expect(state.getSlotSeamProfile('layer-1', 2)).toBe('soft');
    expect(state.getSlotBuiltFromVersion('layer-1', 2)).toBe(7);
  });

  it('tracks active slot and active signature versions', () => {
    const state = new ColorCycleGradientSlotState();

    state.setActiveSlot('layer-1', 3, 9);
    state.setActiveGradientSignature('layer-1', 'sig-active', 10);

    expect(state.getActiveSlot('layer-1')).toBe(3);
    expect(state.getActiveSlotBuiltFromVersion('layer-1')).toBe(9);
    expect(state.getActiveGradientSignature('layer-1')).toBe('sig-active');
    expect(state.getActiveGradientSignatureBuiltFromVersion('layer-1')).toBe(10);
  });

  it('clears version metadata with the cache', () => {
    const state = new ColorCycleGradientSlotState();

    state.setActiveSlot('layer-1', 3, 9);
    state.setActiveGradientSignature('layer-1', 'sig-active', 10);
    state.setSlot('layer-1', 2, [{ position: 0, color: '#111111' }], 'sig-1', 'hard', 7);

    state.clear();

    expect(state.getActiveSlot('layer-1')).toBe(0);
    expect(state.getActiveSlotBuiltFromVersion('layer-1')).toBeNull();
    expect(state.getActiveGradientSignature('layer-1')).toBeUndefined();
    expect(state.getActiveGradientSignatureBuiltFromVersion('layer-1')).toBeNull();
    expect(state.getSlotStops('layer-1', 2)).toBeUndefined();
    expect(state.getSlotBuiltFromVersion('layer-1', 2)).toBeNull();
  });
});
