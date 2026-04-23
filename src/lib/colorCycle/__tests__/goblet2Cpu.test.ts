import { bakePaletteTable, decodeSpeedByte, renderBrushFrame } from '@/lib/colorCycle/goblet2Cpu';

describe('goblet2Cpu helpers', () => {
  it('decodes speed bytes with v2 semantics', () => {
    expect(decodeSpeedByte(0, 0.1, 0.5)).toBe(0);
    expect(decodeSpeedByte(255, 0.1, 0.5)).toBeCloseTo(0.5, 6);
    expect(decodeSpeedByte(128, 0.1, 0.5)).toBeCloseTo(0.3, 6);
  });

  it('renders brush frames with palette shift and zero transparency', () => {
    const slotPalettes = new Map<number, { stops: { position: number; color: string }[]; seamProfile?: 'hard' | 'soft' }>();
    slotPalettes.set(0, {
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ],
    });

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

  it('softens the final palette slice back toward the first color', () => {
    const slotPalettes = new Map<number, { stops: { position: number; color: string }[]; seamProfile?: 'hard' | 'soft' }>();
    slotPalettes.set(0, {
      seamProfile: 'soft',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });

    const paletteTable = bakePaletteTable(slotPalettes, [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ], 256, 1);

    const last = paletteTable.data.slice((256 - 1) * 4, 256 * 4);
    expect(Array.from(last)).toEqual([0, 0, 0, 255]);
  });

  it('renders exported brush payloads with per-slot palettes and mixed speed sources', () => {
    const slotPalettes = new Map<number, { stops: { position: number; color: string }[]; seamProfile?: 'hard' | 'soft' }>();
    slotPalettes.set(0, {
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ],
    });
    slotPalettes.set(1, {
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' }
      ],
    });
    slotPalettes.set(2, {
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#0000ff' },
        { position: 1, color: '#ffff00' }
      ],
    });

    const paletteTable = bakePaletteTable(slotPalettes, [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' }
    ], 8, 4);

    const indexBuffer = new Uint8Array([1, 4, 7, 0]);
    const gradientIdBuffer = new Uint8Array([0, 1, 2, 2]);
    const speedBuffer = new Uint8Array([0, 255, 128, 255]);

    const output = renderBrushFrame({
      indexBuffer,
      gradientIdBuffer,
      speedBuffer,
      paletteTable,
      speedMin: 0.1,
      speedMax: 0.5,
      timeSeconds: 0.25,
      legacyOffset01: 0.25
    });

    const pixel = (idx: number) => output.slice(idx * 4, idx * 4 + 4);

    expect(pixel(0)[3]).toBe(255);
    expect(pixel(0)[0]).toBe(pixel(0)[1]);
    expect(pixel(0)[1]).toBe(pixel(0)[2]);
    expect(pixel(0)[0]).toBeGreaterThan(0);
    expect(Array.from(pixel(1))).not.toEqual([0, 0, 0, 0]);
    expect(Array.from(pixel(2))).not.toEqual(Array.from(pixel(1)));
    expect(Array.from(pixel(3))).toEqual([0, 0, 0, 0]);
  });
});
