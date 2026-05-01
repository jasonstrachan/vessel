import {
  buildDefPaletteSignature,
  buildDefStopsSignature,
  createDefPaletteCache,
} from '@/hooks/brushEngine/colorCycleDefPaletteCache';

const stops = [
  { position: 0, color: '#000000' },
  { position: 1, color: '#ffffff', opacity: 0.5 },
];

describe('colorCycleDefPaletteCache', () => {
  it('builds stable signatures independent of def order', () => {
    const a = [
      { id: 2, hash: 'b', stops },
      { id: 1, hash: 'a', stops },
    ];
    const b = [
      { id: 1, hash: 'a', stops },
      { id: 2, hash: 'b', stops },
    ];

    expect(buildDefPaletteSignature(a)).toBe(buildDefPaletteSignature(b));
  });

  it('includes stop opacity in def stop signatures', () => {
    expect(buildDefStopsSignature(stops)).toBe('0:#000000:1|1:#ffffff:0.5');
  });

  it('creates palette, rgba, and signature maps by def id', () => {
    const cache = createDefPaletteCache([{ id: 4, hash: 'def-4', stops }]);

    expect(cache.signature).toContain('4:def-4');
    expect(cache.palettesById.has(4)).toBe(true);
    expect(cache.rgbaById.has(4)).toBe(true);
    expect(cache.signaturesById.get(4)).toContain('def-4');
  });
});
