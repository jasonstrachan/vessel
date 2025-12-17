import {
  buildFgBgPalette,
  computeGradientAxisFromPolygon,
  getBayerTile,
  renderOrderedDitherGradientToImageData,
  resolveDitherGradPalette
} from '../orderedDitherGradient';

describe('orderedDitherGradient', () => {
  const fg: [number, number, number, number] = [255, 0, 0, 255];
  const bg: [number, number, number, number] = [0, 0, 255, 255];
  const palette = buildFgBgPalette(fg, bg);

  it('produces deterministic output with the same inputs', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const params = {
      width: 8,
      height: 8,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
    } as const;

    const first = renderOrderedDitherGradientToImageData(params).data;
    const second = renderOrderedDitherGradientToImageData(params).data;

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('is not flat when foreground and background differ', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
    ]);
    const image = renderOrderedDitherGradientToImageData({
      width: 16,
      height: 16,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(8),
      tileSize: 8,
      pixelSize: 1,
    });

    const colors = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}-${image.data[i + 3]}`);
    }

    expect(colors.size).toBeGreaterThan(1);
  });

  it('increases foreground coverage along the gradient axis', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
    ]);
    const image = renderOrderedDitherGradientToImageData({
      width: 32,
      height: 8,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(8),
      tileSize: 8,
      pixelSize: 1,
    });

    const countForeground = (xStart: number, xEnd: number): number => {
      let count = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const offset = (y * image.width + x) * 4;
          if (
            image.data[offset] === fg[0] &&
            image.data[offset + 1] === fg[1] &&
            image.data[offset + 2] === fg[2] &&
            image.data[offset + 3] === fg[3]
          ) {
            count += 1;
          }
        }
      }
      return count;
    };

    const leftFg = countForeground(0, image.width / 2);
    const rightFg = countForeground(image.width / 2, image.width);

    expect(rightFg).toBeGreaterThan(leftFg);
  });

  it('respects transparent background pixels', () => {
    const transparentBg: [number, number, number, number] = [0, 0, 0, 0];
    const paletteRGBA = resolveDitherGradPalette(fg, transparentBg, false);
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const image = renderOrderedDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA,
      tile: getBayerTile(2),
      tileSize: 2,
      pixelSize: 1,
    });

    expect(image.data[3]).toBe(0); // alpha channel
  });

  it('resolveDitherGradPalette drops BG when disabled', () => {
    const transparentBg: [number, number, number, number] = [10, 20, 30, 40];
    const [fgOut, bgOut] = resolveDitherGradPalette(fg, transparentBg, false);
    expect(fgOut).toEqual(fg);
    expect(bgOut).toEqual<[number, number, number, number]>([0, 0, 0, 0]);
  });

  it('supports multi-stop palettes up to six colors', () => {
    const paletteRGBA = resolveDitherGradPalette(
      fg,
      bg,
      true,
      ['#ff0000', '#00ff00', '#0000ff', '#ffffff']
    );
    expect(paletteRGBA).toHaveLength(4);
    expect(paletteRGBA[1]).toEqual<[number, number, number, number]>([0, 255, 0, 255]);

    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
    ]);
    const image = renderOrderedDitherGradientToImageData({
      width: 32,
      height: 8,
      axis,
      paletteRGBA,
      tile: getBayerTile(8),
      tileSize: 8,
      pixelSize: 1,
    });

    const encountered = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      encountered.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}`);
    }
    expect(encountered.has('0-255-0')).toBe(true); // middle green stop appears
  });

  it('keeps visible dithering even with large pixelSize', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
    ]);
    const image = renderOrderedDitherGradientToImageData({
      width: 32,
      height: 32,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(8),
      tileSize: 8,
      pixelSize: 6,
    });

    const colors = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}-${image.data[i + 3]}`);
    }

    expect(colors.size).toBeGreaterThan(1);
  });

  it('anchors tile phase to origin', () => {
    const axis = {
      start: { x: 0, y: -2.5 },
      end: { x: 0, y: 7.5 },
      dir: { x: 0, y: 1 },
      length: 10,
    } as const;

    const base = renderOrderedDitherGradientToImageData({
      width: 4,
      height: 4,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
      origin: { x: 0, y: 0 },
    });

    const shifted = renderOrderedDitherGradientToImageData({
      width: 4,
      height: 4,
      axis,
      paletteRGBA: palette,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
      origin: { x: 1, y: 0 }, // shift tile phase horizontally
    });

    const pixelColor = (data: Uint8ClampedArray, idx: number) =>
      `${data[idx]}-${data[idx + 1]}-${data[idx + 2]}-${data[idx + 3]}`;

    // Same coverage, but origin shift should change Bayer lookup for x=0
    expect(pixelColor(base.data, 0)).not.toEqual(pixelColor(shifted.data, 0));
  });
});
