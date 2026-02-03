import { Renderer2D } from '@/lib/colorCycle/Renderer2D';
import { decodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

describe('Renderer2D forward-only flow', () => {
  const buildPalette = () => {
    const palette = new Uint32Array(256);
    for (let i = 0; i < palette.length; i += 1) {
      palette[i] = i;
    }
    return palette;
  };

  it('uses forward legacy shift even when flowMode is reverse', () => {
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
    const shift = (speedOffset * 256) | 0;

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
    expect(pixels32[0]).toBe(palette[(0 - shift) & 255]);
    renderer.cleanup();
  });
});
