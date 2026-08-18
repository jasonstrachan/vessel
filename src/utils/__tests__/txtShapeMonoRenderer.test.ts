import { layoutTxtShapeText } from '@/utils/txtShapeLayout';
import {
  calculateTxtShapeMonoBaseline,
  getTxtShapeMonoBitmapRuns,
} from '@/utils/txtShapeMonoRenderer';

describe('TXT Shape monochrome rendering', () => {
  it('unpacks FreeType 1-bit rows into horizontal paint runs', () => {
    expect(getTxtShapeMonoBitmapRuns({
      buffer: new Uint8Array([
        0b01101100,
        0b11110000,
      ]),
      pitch: 1,
      rows: 2,
      width: 8,
    })).toEqual([
      { x: 1, y: 0, width: 2 },
      { x: 4, y: 0, width: 2 },
      { x: 0, y: 1, width: 4 },
    ]);
  });

  it('normalizes bottom-up FreeType bitmap rows', () => {
    expect(getTxtShapeMonoBitmapRuns({
      buffer: new Uint8Array([
        0b10000000,
        0b01000000,
      ]),
      pitch: -1,
      rows: 2,
      width: 2,
    })).toEqual([
      { x: 1, y: 0, width: 1 },
      { x: 0, y: 1, width: 1 },
    ]);
  });

  it('centers the real face box inside the configured line height', () => {
    expect(calculateTxtShapeMonoBaseline({
      ascender: 1_000,
      descender: -300,
      unitsPerEm: 1_000,
      fontSize: 24,
      lineHeight: 29,
    })).toBe(23);
    expect(calculateTxtShapeMonoBaseline({
      ascender: 800,
      descender: -200,
      unitsPerEm: 1_000,
      fontSize: 12,
      lineHeight: 14,
    })).toBe(11);
  });

  it('uses renderer metrics to keep only complete words on each line', () => {
    const lines = layoutTxtShapeText({
      content: 'ONE THREE TWO',
      font: 'unused',
      lineCount: 3,
      getSpan: () => ({ left: 0, right: 10 }),
      measureText: (text) => text.length * 2,
    });

    expect(lines.map(({ text, width }) => ({ text, width }))).toEqual([
      { text: 'ONE', width: 6 },
      { text: 'THREE', width: 10 },
      { text: 'TWO', width: 6 },
    ]);
    expect(lines.map(({ sourceStart, sourceEnd }) => ({ sourceStart, sourceEnd }))).toEqual([
      { sourceStart: 0, sourceEnd: 3 },
      { sourceStart: 4, sourceEnd: 9 },
      { sourceStart: 10, sourceEnd: 13 },
    ]);
  });

  it('waits for a wider shape-flow line instead of clipping a word', () => {
    const lines = layoutTxtShapeText({
      content: 'WIDE WORD',
      font: 'unused',
      lineCount: 3,
      getSpan: (lineIndex) => ({ left: 0, right: lineIndex === 0 ? 3 : 8 }),
      measureText: (text) => text.length,
    });

    expect(lines.map(({ lineIndex, text }) => ({ lineIndex, text }))).toEqual([
      { lineIndex: 1, text: 'WIDE' },
      { lineIndex: 2, text: 'WORD' },
    ]);
  });
});
