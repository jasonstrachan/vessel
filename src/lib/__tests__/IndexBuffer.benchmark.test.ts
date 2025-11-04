import { IndexBuffer } from '../IndexBuffer';

const brushSize = 6;
const gridSize = 128;
const swings = 24;
const palette = Array.from({ length: 32 }, (_, i) => `rgba(${(i * 17) % 255}, ${(255 - i * 23) % 255}, ${(i * 53) % 255}, 1)`);

const measure = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe('IndexBuffer painting performance', () => {
  it('numeric helpers avoid palette-string overhead', () => {
    const buffer = new IndexBuffer(gridSize, gridSize);
    buffer.setPalette(palette);

    const coords = Array.from({ length: gridSize * swings }, (_, i) => [i % gridSize, (i * 3) % gridSize] as const);

    const paintWithStrings = () => {
      buffer.clear();
      coords.forEach((coord, idx) => {
        buffer.paint(coord[0], coord[1], brushSize, palette[idx % palette.length]);
      });
    };

    const paintWithIndices = () => {
      buffer.clear();
      coords.forEach((coord, idx) => {
        const paletteIndex = (idx % palette.length) + 1;
        buffer.paintWithIndex(coord[0], coord[1], brushSize, paletteIndex);
      });
    };

    // Warmups
    paintWithStrings();
    paintWithIndices();

    const stringTime = measure(() => {
      for (let i = 0; i < swings; i++) {
        paintWithStrings();
      }
    });

    const numericTime = measure(() => {
      for (let i = 0; i < swings; i++) {
        paintWithIndices();
      }
    });

    // Report for humans while keeping test deterministic
    console.log('[IndexBuffer bench] string path:', stringTime.toFixed(2), 'ms', 'numeric path:', numericTime.toFixed(2), 'ms');

    expect(numericTime).toBeLessThan(stringTime * 0.8);
  });
});
