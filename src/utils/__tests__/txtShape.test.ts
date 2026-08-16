import type { TxtShape } from '@/types';
import {
  drawTxtShapesToCanvas,
  getContrastingTxtColor,
  normalizeTxtShapeSelections,
  normalizeTxtShapes,
  splitTxtShapeSegments,
} from '@/utils/txtShape';

const createShape = (updates: Partial<TxtShape> = {}): TxtShape => ({
  id: 'txt-1',
  x: 5,
  y: 6,
  width: 100,
  height: 50,
  content: 'LIGHT DARK',
  fontFamily: 'monospace',
  fontSize: 10,
  lineHeight: 1.2,
  textAlign: 'left',
  colorSource: 'palette',
  color: '#111111',
  selectionColor: '#ffffff',
  selectionBackgroundColor: '#000000',
  selections: [{ start: 6, end: 10 }],
  createdAt: 1,
  updatedAt: 1,
  ...updates,
});

describe('TXT Shape document helpers', () => {
  it('clamps and merges canonical selection ranges', () => {
    expect(normalizeTxtShapeSelections([
      { start: 5, end: 9 },
      { start: -2, end: 3 },
      { start: 2, end: 6 },
      { start: 12, end: 13 },
    ], 10)).toEqual([{ start: 0, end: 9 }]);
  });

  it('normalizes malformed boxes and removes duplicate ids', () => {
    const shapes = normalizeTxtShapes([
      createShape({ width: -4, height: 2, x: 999, y: 999 }),
      createShape({ content: 'duplicate' }),
      { content: 'generated id' },
    ], 200, 100);

    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toEqual(expect.objectContaining({
      id: 'txt-1',
      x: 184,
      y: 84,
      width: 16,
      height: 16,
    }));
    expect(shapes[1]?.id).toMatch(/^txt-shape-/);
  });

  it('splits authored selected and unselected text without losing content', () => {
    const segments = splitTxtShapeSegments(createShape());
    expect(segments).toEqual([
      { text: 'LIGHT ', selected: false },
      { text: 'DARK', selected: true },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe('LIGHT DARK');
  });

  it('rasterizes the canonical selected range using its authored light and dark colours', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      measureText: jest.fn(() => ({ width: 5 })),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      font: '',
      textBaseline: 'alphabetic',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({ content: 'AB', selections: [{ start: 1, end: 2 }] })]);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 6, 5, 12);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'A', 5, 6);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'B', 10, 6);
  });

  it('chooses readable selection text for sampled colours', () => {
    expect(getContrastingTxtColor('#f4f4f4')).toBe('#000000');
    expect(getContrastingTxtColor('#151515')).toBe('#ffffff');
  });
});
