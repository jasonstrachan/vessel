import { Renderer2D } from '@/lib/colorCycle/Renderer2D';
import { decodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

describe('Renderer2D forward-only flow', () => {
  const packGray = (value: number) => {
    const v = value & 0xff;
    return (((0xff << 24) | (v << 16) | (v << 8) | v) >>> 0);
  };

  const mixPackedGray = (a: number, b: number, t: number) => {
    const av = a & 0xff;
    const bv = b & 0xff;
    return packGray(Math.round(av + (bv - av) * t));
  };

  const buildPalette = () => {
    const palette = new Uint32Array(256);
    for (let i = 0; i < palette.length; i += 1) {
      palette[i] = packGray(i);
    }
    return palette;
  };

  const resolveAnimatedMix = (colorIndex: number, phase: number, dir: number, palette: Uint32Array) => {
    const palettePos = ((((colorIndex - 1 + dir * phase * 256) % 256) + 256) % 256);
    const lower = Math.floor(palettePos) & 255;
    const upper = (lower + 1) & 255;
    const frac = palettePos - Math.floor(palettePos);
    return mixPackedGray(palette[lower], palette[upper], frac);
  };

  it('treats speed byte 0 as static when speed data exists', () => {
    const renderer = new Renderer2D({ width: 1, height: 1 });
    const palette = buildPalette();
    const paletteSlots = Array.from({ length: 256 }, () => palette);

    renderer.render({
      indexData: new Uint8Array([1]),
      gradientIdData: new Uint8Array([5]),
      speedData: new Uint8Array([0]),
      paletteSlots,
      basePalette: palette,
      phase: 0.1,
      baseOffset: 0,
      baseTime: 0,
      flowMode: 'reverse',
    });

    const imageData = renderer.getImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    expect(pixels32[0]).toBe(palette[0]);
    renderer.cleanup();
  });

  it('uses legacy shift when no speed data exists', () => {
    const renderer = new Renderer2D({ width: 1, height: 1 });
    const palette = buildPalette();
    const paletteSlots = Array.from({ length: 256 }, () => palette);

    renderer.render({
      indexData: new Uint8Array([1]),
      gradientIdData: new Uint8Array([5]),
      paletteSlots,
      basePalette: palette,
      phase: 0.1,
      baseOffset: 0,
      baseTime: 0,
      flowMode: 'reverse',
    });

    const imageData = renderer.getImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    const shift = (0.1 * 256) | 0;
    expect(pixels32[0]).toBe(palette[(0 - shift) & 255]);
    renderer.cleanup();
  });

  it('uses speed-based forward shift when speed data is present', () => {
    const renderer = new Renderer2D({ width: 1, height: 1 });
    const palette = buildPalette();
    const paletteSlots = Array.from({ length: 256 }, () => palette);
    const speedByte = 128;
    const speed = decodeColorCycleSpeedByte(speedByte);
    const baseTime = 1.25;
    const speedOffset = (baseTime * speed) % 1;

    renderer.render({
      indexData: new Uint8Array([1]),
      gradientIdData: new Uint8Array([5]),
      speedData: new Uint8Array([speedByte]),
      paletteSlots,
      basePalette: palette,
      phase: 0.05,
      baseOffset: 0,
      baseTime,
      flowMode: 'pingpong',
    });

    const imageData = renderer.getImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    expect(pixels32[0]).toBe(resolveAnimatedMix(1, speedOffset, -1, palette));
    renderer.cleanup();
  });

  it('applies per-pixel phase offsets on top of animated speed', () => {
    const renderer = new Renderer2D({ width: 1, height: 1 });
    const palette = buildPalette();
    const paletteSlots = Array.from({ length: 256 }, () => palette);
    const speedByte = 128;
    const speed = decodeColorCycleSpeedByte(speedByte);
    const baseTime = 0.75;
    const phaseByte = 64;
    const phaseOffset = phaseByte / 256;
    const phase = (((baseTime * speed) % 1) + phaseOffset) % 1;

    renderer.render({
      indexData: new Uint8Array([1]),
      gradientIdData: new Uint8Array([5]),
      speedData: new Uint8Array([speedByte]),
      flowData: new Uint8Array([1]),
      phaseData: new Uint8Array([phaseByte]),
      paletteSlots,
      basePalette: palette,
      phase: 0,
      baseOffset: 0,
      baseTime,
      flowMode: 'forward',
    });

    const imageData = renderer.getImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    expect(pixels32[0]).toBe(resolveAnimatedMix(1, phase, -1, palette));
    renderer.cleanup();
  });

  it('interpolates animated colors from definition palettes too', () => {
    const renderer = new Renderer2D({ width: 1, height: 1 });
    const basePalette = buildPalette();
    const defPalette = new Uint32Array(256);
    for (let i = 0; i < defPalette.length; i += 1) {
      defPalette[i] = packGray((255 - i) & 0xff);
    }
    const paletteSlots = Array.from({ length: 256 }, () => basePalette);
    const speedByte = 160;
    const speed = decodeColorCycleSpeedByte(speedByte);
    const baseTime = 0.625;
    const phase = (baseTime * speed) % 1;

    renderer.render({
      indexData: new Uint8Array([32]),
      gradientIdData: new Uint8Array([5]),
      defIdData: new Uint16Array([9]),
      defPalettesById: new Map([[9, defPalette]]),
      speedData: new Uint8Array([speedByte]),
      paletteSlots,
      basePalette,
      phase: 0,
      baseOffset: 0,
      baseTime,
      flowMode: 'forward',
    });

    const imageData = renderer.getImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    expect(pixels32[0]).toBe(resolveAnimatedMix(32, phase, -1, defPalette));
    renderer.cleanup();
  });
});
