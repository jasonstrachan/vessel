import {
  buildFgBgPalette,
  computeGradientAxisFromPolygon,
  getBayerTile,
  pixelateImageData,
  renderDitherGradientToImageData,
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

  it('applies transparent tail based on explicit transparent count', () => {
    const paletteRGBA = resolveDitherGradPalette(
      fg,
      bg,
      true,
      ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
      2
    );
    expect(paletteRGBA).toHaveLength(4);
    expect(paletteRGBA[2]?.[3]).toBe(0);
    expect(paletteRGBA[3]?.[3]).toBe(0);
  });

  it('does not force transparency when transparent count is zero', () => {
    const paletteRGBA = resolveDitherGradPalette(
      fg,
      bg,
      false,
      ['#ff0000', '#00ff00'],
      0
    );
    expect(paletteRGBA[1]?.[3]).toBe(255);
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

  it('samples gradient at world-anchored cell centers', () => {
    const axis = {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      dir: { x: 1, y: 0 },
      length: 1,
    } as const;

    const image = renderOrderedDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA: palette,
      tile: new Float32Array([0.5]),
      tileSize: 1,
      pixelSize: 4,
      origin: { x: 1.5, y: 0 },
    });

    expect(Array.from(image.data.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it('locks Bayer phase to world-anchored cell indices', () => {
    const axis = {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 10 },
      dir: { x: 0, y: 1 },
      length: 10,
    } as const;

    const tile = new Float32Array([0.05, 0.9, 0.9, 0.9]);

    const base = renderOrderedDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA: palette,
      tile,
      tileSize: 2,
      pixelSize: 2,
      origin: { x: 0, y: 0 },
    });

    const shifted = renderOrderedDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA: palette,
      tile,
      tileSize: 2,
      pixelSize: 2,
      origin: { x: 1, y: 0 }, // stay in same cell
    });

    expect(Array.from(base.data)).toEqual(Array.from(shifted.data));
  });

  it('applies transparent tail for non-bayer algorithms', () => {
    const axis = {
      start: { x: -0.5, y: 0 },
      end: { x: 0.5, y: 0 },
      dir: { x: 1, y: 0 },
      length: 1,
    } as const;

    const paletteRGBA: [number, number, number, number][] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ];

    const image = renderDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
      origin: { x: 0, y: 0 },
      algorithm: 'floyd-steinberg',
    });

    expect(image.data[3]).toBe(0);
  });

  it('anchors pattern phase to world cell coordinates', () => {
    const axis = {
      start: { x: -0.1, y: 0 },
      end: { x: 0.9, y: 0 },
      dir: { x: 1, y: 0 },
      length: 1,
    } as const;

    const paletteRGBA: [number, number, number, number][] = [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ];

    const base = renderDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
      origin: { x: 0, y: 0 },
      algorithm: 'pattern',
      patternStyle: 'vertical-lines',
    });

    const shifted = renderDitherGradientToImageData({
      width: 1,
      height: 1,
      axis,
      paletteRGBA,
      tile: getBayerTile(4),
      tileSize: 4,
      pixelSize: 1,
      origin: { x: 2, y: 0 },
      algorithm: 'pattern',
      patternStyle: 'vertical-lines',
    });

    expect(Array.from(base.data.slice(0, 4))).not.toEqual(Array.from(shifted.data.slice(0, 4)));
  });

  it('aligns pixelation grid to origin', () => {
    const width = 4;
    const height = 2;
    const source = new ImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        source.data[offset] = x * 64;
        source.data[offset + 1] = y * 64;
        source.data[offset + 2] = 0;
        source.data[offset + 3] = 255;
      }
    }

    const base = pixelateImageData(source, 2, { x: 0, y: 0 });
    const shifted = pixelateImageData(source, 2, { x: 1, y: 0 });

    const pixel = (data: Uint8ClampedArray, x: number, y: number) => {
      const idx = (y * width + x) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    };

    expect(pixel(base.data, 1, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(shifted.data, 1, 0)).toEqual([64, 0, 0, 255]);
  });

  it('renders with error diffusion algorithms via renderDitherGradientToImageData', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 16, y: 0 },
    ]);
    const paletteRGBA: Array<[number, number, number, number]> = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ];

    const image = renderDitherGradientToImageData({
      width: 16,
      height: 8,
      axis,
      paletteRGBA,
      pixelSize: 1,
      algorithm: 'sierra-lite',
    });

    const colors = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}-${image.data[i + 3]}`);
    }

    expect(colors.size).toBeGreaterThan(1);
    const paletteSet = new Set(paletteRGBA.map((c) => `${c[0]}-${c[1]}-${c[2]}-${c[3]}`));
    for (const color of colors) {
      expect(paletteSet.has(color)).toBe(true);
    }
  });

  it('renders with blue-noise dithering', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const paletteRGBA: Array<[number, number, number, number]> = [
      [10, 10, 10, 255],
      [240, 240, 240, 255],
    ];

    const image = renderDitherGradientToImageData({
      width: 10,
      height: 6,
      axis,
      paletteRGBA,
      pixelSize: 1,
      algorithm: 'blue-noise',
    });

    const colors = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}-${image.data[i + 3]}`);
    }

    expect(colors.size).toBeGreaterThan(1);
  });

  it('supports pattern dithering styles in renderDitherGradientToImageData', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
    ]);
    const paletteRGBA: Array<[number, number, number, number]> = [
      [20, 20, 20, 255],
      [200, 200, 200, 255],
    ];

    const image = renderDitherGradientToImageData({
      width: 12,
      height: 6,
      axis,
      paletteRGBA,
      pixelSize: 1,
      algorithm: 'pattern',
      patternStyle: 'lines',
    });

    const colors = new Set<string>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add(`${image.data[i]}-${image.data[i + 1]}-${image.data[i + 2]}-${image.data[i + 3]}`);
    }

    expect(colors.size).toBeGreaterThan(1);
  });

  it('routes bayer algorithm through ordered dither renderer', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ]);
    const paletteRGBA = buildFgBgPalette([0, 0, 0, 255], [255, 255, 255, 255]);
    const tile = getBayerTile(4);

    const ordered = renderOrderedDitherGradientToImageData({
      width: 8,
      height: 4,
      axis,
      paletteRGBA,
      tile,
      tileSize: 4,
      pixelSize: 1,
    });

    const dithered = renderDitherGradientToImageData({
      width: 8,
      height: 4,
      axis,
      paletteRGBA,
      tile,
      tileSize: 4,
      pixelSize: 1,
      algorithm: 'bayer',
    });

    expect(Array.from(dithered.data)).toEqual(Array.from(ordered.data));
  });

  it('preserves transparent palette entries for non-bayer algorithms', () => {
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    const paletteRGBA: Array<[number, number, number, number]> = [
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ];

    const image = renderDitherGradientToImageData({
      width: 4,
      height: 1,
      axis,
      paletteRGBA,
      pixelSize: 1,
      algorithm: 'sierra-lite',
    });

    const hasTransparent = image.data.some((_, idx) => (idx + 1) % 4 === 0 && image.data[idx] === 0);
    expect(hasTransparent).toBe(true);
  });
});
