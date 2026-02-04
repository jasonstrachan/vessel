import { createGoblet2Bundle } from './fixtures/goblet2Bundle';

describe('goblet2 bundle fixture', () => {
  it('emits a v2 format bundle with brush speed buffer', () => {
    const bundle = createGoblet2Bundle();
    expect(bundle.format).toBe('vessel-goblet2');
    expect(bundle.colorCycle?.schemaVersion).toBe(2);
    const layer = bundle.layers[0];
    const brushState = layer.colorCycle?.brushState as { speedBuffer?: number[] } | undefined;
    expect(Array.isArray(brushState?.speedBuffer)).toBe(true);
    expect(brushState?.speedBuffer).toHaveLength(4);
  });
});
