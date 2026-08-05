import { updateWarmingColorCycleLayerIds } from '@/stores/layerHydration';

describe('updateWarmingColorCycleLayerIds', () => {
  it('adds a warming layer once and preserves the current array for repeated updates', () => {
    const initial = ['layer-a'];
    const warming = updateWarmingColorCycleLayerIds(initial, 'layer-b', true);

    expect(warming).toEqual(['layer-a', 'layer-b']);
    expect(updateWarmingColorCycleLayerIds(warming, 'layer-b', true)).toBe(warming);
  });

  it('removes only the completed layer and preserves the current array when absent', () => {
    const initial = ['layer-a', 'layer-b'];
    const completed = updateWarmingColorCycleLayerIds(initial, 'layer-a', false);

    expect(completed).toEqual(['layer-b']);
    expect(updateWarmingColorCycleLayerIds(completed, 'layer-a', false)).toBe(completed);
  });
});
