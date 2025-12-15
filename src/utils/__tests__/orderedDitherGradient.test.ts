import { buildFgBgPalette, computeGradientAxisFromPolygon, getBayerTile, renderOrderedDitherGradientToImageData } from '../orderedDitherGradient';

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
});
