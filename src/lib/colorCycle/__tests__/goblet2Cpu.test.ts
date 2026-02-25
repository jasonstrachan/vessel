import { bakePaletteTable, decodeSpeedByte, renderBrushFrame } from '@/lib/colorCycle/goblet2Cpu';

describe('goblet2Cpu helpers', () => {
  it('decodes speed bytes with v2 semantics', () => {
    expect(decodeSpeedByte(0, 0.1, 0.5)).toBe(0);
    expect(decodeSpeedByte(255, 0.1, 0.5)).toBeCloseTo(0.5, 6);
    expect(decodeSpeedByte(128, 0.1, 0.5)).toBeCloseTo(0.3, 6);
  });

  it('renders brush frames with palette shift and zero transparency', () => {
    const slotPalettes = new Map<number, { position: number; color: string }[]>();
    slotPalettes.set(0, [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' }
    ]);

    const paletteTable = bakePaletteTable(slotPalettes, [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' }
    ], 4, 2);

    const indexBuffer = new Uint8Array([1, 2, 0, 4]);
    const gradientIdBuffer = new Uint8Array([0, 0, 0, 0]);
    const speedBuffer = new Uint8Array([255, 255, 255, 255]);

    const output = renderBrushFrame({
      indexBuffer,
      gradientIdBuffer,
      speedBuffer,
      paletteTable,
      speedMin: 1,
      speedMax: 1,
      timeSeconds: 0.25,
      legacyOffset01: 0
    });

    const pixel = (idx: number) => output.slice(idx * 4, idx * 4 + 4);

    expect(Array.from(pixel(0))).toEqual([255, 255, 255, 255]);
    expect(Array.from(pixel(1))).toEqual([0, 0, 0, 255]);
    expect(Array.from(pixel(2))).toEqual([0, 0, 0, 0]);
    expect(Array.from(pixel(3))).toEqual([170, 170, 170, 255]);
  });
});
