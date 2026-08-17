import type { TxtShape } from '@/types';
import {
  clearTxtShapeTransientSelectionOverrides,
  composeTxtShapesIntoLayerSource,
  drawCanonicalTxtShapesToCanvas,
  drawTxtShapesToCanvas,
  getContrastingTxtColor,
  getTxtShapeClipPath,
  getTxtShapeFlowInsetPath,
  getTxtShapeHorizontalSpan,
  getTxtShapeHorizontalSpanForBand,
  getTxtShapePadding,
  getTxtShapeRegionPathArea,
  getTxtShapeTextLayout,
  normalizeTxtShapeSelections,
  normalizeTxtShapes,
  setTxtShapeTransientSelectionOverrides,
  splitTxtShapeSegments,
  updateTxtShapeSelectionsForContent,
} from '@/utils/txtShape';
import { layoutTxtShapeText } from '@/utils/txtShapeLayout';
import {
  createTxtShapeFontFaceCss,
  getTxtShapeFontMinimumSize,
  isTxtShapeFontFamily,
  loadTxtShapeFont,
  TXT_SHAPE_FONT_DEFINITIONS,
} from '@/utils/txtShapeFonts';

const createShape = (updates: Partial<TxtShape> = {}): TxtShape => ({
  id: 'txt-1',
  layerId: 'layer-1',
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
  it('keeps bundled font metadata and minimum sizes authoritative', () => {
    expect(TXT_SHAPE_FONT_DEFINITIONS.map((font) => font.family)).toEqual([
      'monospace',
      'sans-serif',
      'serif',
      'mek-sans',
      'mek-mono',
      'jetbrains-mono',
      'ibm-plex-mono',
      'departure-mono',
    ]);
    expect(isTxtShapeFontFamily('mek-mono')).toBe(true);
    expect(isTxtShapeFontFamily('missing-font')).toBe(false);
    expect(getTxtShapeFontMinimumSize('departure-mono')).toBe(11);
    expect(createTxtShapeFontFaceCss('/vessel')).toContain(
      "url('/vessel/assets/fonts/DEPARTURE-MONO-REGULAR.WOFF2')",
    );
  });

  it('clamps font size against the selected face minimum', () => {
    const [departure, mekSans, system] = normalizeTxtShapes([
      createShape({ id: 'departure', fontFamily: 'departure-mono', fontSize: 2 }),
      createShape({ id: 'mek-sans', fontFamily: 'mek-sans', fontSize: 2 }),
      createShape({ id: 'system', fontFamily: 'monospace', fontSize: 2 }),
    ], 200, 100);

    expect(departure?.fontSize).toBe(11);
    expect(mekSans?.fontSize).toBe(8);
    expect(system?.fontSize).toBe(6);
  });

  it('activates a bundled face with its effective minimum descriptor', async () => {
    const load = jest.fn().mockResolvedValue([]);
    const check = jest.fn().mockReturnValue(true);
    const originalFonts = document.fonts;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, check },
    });

    try {
      await expect(loadTxtShapeFont('departure-mono', 2)).resolves.toBe(true);
      expect(load).toHaveBeenCalledWith('11px "Departure Mono"');
      expect(check).toHaveBeenCalledWith('11px "Departure Mono"');
    } finally {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it('clamps and merges canonical selection ranges', () => {
    expect(normalizeTxtShapeSelections([
      { start: 5, end: 9 },
      { start: -2, end: 3 },
      { start: 2, end: 6 },
      { start: 12, end: 13 },
    ], 10)).toEqual([{ start: 0, end: 9 }]);
  });

  it('preserves a complete canonical selection when text is replaced', () => {
    expect(updateTxtShapeSelectionsForContent(
      'OLD',
      'A LONGER PASTED VALUE',
      [{ start: 0, end: 3 }],
    )).toEqual([{ start: 0, end: 21 }]);
    expect(updateTxtShapeSelectionsForContent(
      'OLD TEXT',
      'NEW',
      [{ start: 1, end: 4 }],
    )).toEqual([{ start: 0, end: 3 }]);
    expect(updateTxtShapeSelectionsForContent(
      'LIGHT DARK',
      'VERY LIGHT DARK',
      [{ start: 6, end: 10 }],
    )).toEqual([{ start: 11, end: 15 }]);
    expect(updateTxtShapeSelectionsForContent(
      'LIGHT DARK',
      'LIGHT BRIGHT',
      [{ start: 6, end: 10 }],
    )).toEqual([{ start: 6, end: 12 }]);
  });

  it('normalizes malformed boxes and removes duplicate ids', () => {
    const shapes = normalizeTxtShapes([
      createShape({ width: -4, height: 2, x: 999, y: 999, padding: 100 }),
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
      padding: 7.5,
    }));
    expect(shapes[1]?.id).toMatch(/^txt-shape-/);
  });

  it('migrates unowned boxes to the top normal layer and preserves valid owners', () => {
    const shapes = normalizeTxtShapes([
      { ...createShape({ id: 'legacy' }), layerId: undefined },
      createShape({ id: 'owned', layerId: 'normal-lower' }),
      createShape({ id: 'invalid-owner', layerId: 'adjustment-top' }),
    ], 200, 100, [
      { id: 'normal-lower', layerType: 'normal', order: 0 },
      { id: 'normal-top', layerType: 'normal', order: 2 },
      { id: 'adjustment-top', layerType: 'adjustment', order: 3 },
    ]);

    expect(shapes.map((shape) => shape.layerId)).toEqual([
      'normal-top',
      'normal-lower',
      'normal-top',
    ]);
  });

  it('normalizes oval and freehand regions while legacy boxes remain rectangles', () => {
    const [oval, freehand, invalidFreehand] = normalizeTxtShapes([
      createShape({ id: 'oval', regionKind: 'oval' }),
      createShape({
        id: 'freehand',
        regionKind: 'freehand',
        regionPath: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 2 }],
      }),
      createShape({ id: 'invalid', regionKind: 'freehand', regionPath: [{ x: 0, y: 0 }] }),
    ], 200, 100);

    expect(oval.regionKind).toBe('oval');
    expect(freehand.regionPath).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ]);
    expect(invalidFreehand.regionKind).toBeUndefined();
    expect(normalizeTxtShapes([
      createShape({
        id: 'collinear',
        regionKind: 'freehand',
        regionPath: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      }),
    ], 200, 100)[0].regionKind).toBeUndefined();
  });

  it('resolves the usable line span and clip path inside shaped regions', () => {
    const oval = createShape({ regionKind: 'oval' });
    expect(getTxtShapeHorizontalSpan(oval, 25)).toEqual({ left: 0, right: 100 });
    expect(getTxtShapeHorizontalSpan(oval, 0)).toEqual({ left: 50, right: 50 });
    expect(getTxtShapeHorizontalSpanForBand(oval, 12.5, 25)).toEqual({
      left: expect.closeTo(6.69873, 5),
      right: expect.closeTo(93.30127, 5),
    });
    expect(getTxtShapeClipPath(oval)).toBe('ellipse(50% 50% at 50% 50%)');

    const triangle = createShape({
      regionKind: 'freehand',
      regionPath: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    });
    expect(getTxtShapeHorizontalSpan(triangle, 25)).toEqual({ left: 25, right: 75 });
    expect(getTxtShapeClipPath(triangle)).toContain('polygon(');
    expect(getTxtShapeRegionPathArea(triangle.regionPath ?? [])).toBeCloseTo(0.5);
    expect(getTxtShapeFlowInsetPath(oval, 'left')).toContain('polygon(');
    expect(getTxtShapePadding(createShape({ padding: 60 }))).toBe(24.5);
  });

  it('splits authored selected and unselected text without losing content', () => {
    const segments = splitTxtShapeSegments(createShape());
    expect(segments).toEqual([
      { text: 'LIGHT ', selected: false },
      { text: 'DARK', selected: true },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe('LIGHT DARK');
  });

  it('uses prepared text across variable shape widths while preserving hard-break offsets', () => {
    const lines = layoutTxtShapeText({
      content: 'AB\nCDE',
      font: '10px monospace',
      lineCount: 3,
      getSpan: (lineIndex) => ({
        left: lineIndex * 2,
        right: lineIndex === 0 ? 14 : 40,
      }),
    });

    expect(lines.map((line) => line.text)).toEqual(['AB', 'CDE']);
    expect(lines.map((line) => line.sourceStart)).toEqual([0, 3]);
    expect(lines.map((line) => line.span.left)).toEqual([0, 2]);
    expect(lines.every((line) => line.width <= line.span.right - line.span.left)).toBe(true);
  });

  it('moves an overlong whole word to a wider band instead of splitting it', () => {
    const lines = layoutTxtShapeText({
      content: 'ONE SUPERCALIFRAGILISTIC',
      font: '10px monospace',
      lineCount: 2,
      getSpan: (lineIndex) => ({
        left: 0,
        right: lineIndex === 0 ? 40 : 140,
      }),
    });

    expect(lines.map((line) => line.text)).toEqual(['ONE ', 'SUPERCALIFRAGILISTIC']);
    expect(lines.map((line) => line.lineIndex)).toEqual([0, 1]);
    expect(lines[0]?.width).toBeLessThan(40);
  });

  it('rasterizes the canonical selected range using its authored light and dark colours', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      ellipse: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
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

  it('reuses the live layer raster surfaces across compositor frames', () => {
    const shapes = [createShape({ id: 'txt-cache', layerId: 'cache-layer' })];
    const createElement = jest.spyOn(document, 'createElement');

    const first = composeTxtShapesIntoLayerSource({
      source: null,
      shapes,
      layerId: 'cache-layer',
      width: 100,
      height: 50,
    });
    const canvasCreationsAfterFirstFrame = createElement.mock.calls.filter(
      ([tagName]) => tagName === 'canvas',
    ).length;
    const second = composeTxtShapesIntoLayerSource({
      source: null,
      shapes,
      layerId: 'cache-layer',
      width: 100,
      height: 50,
    });

    expect(first).toBe(second);
    expect(createElement.mock.calls.filter(([tagName]) => tagName === 'canvas')).toHaveLength(
      canvasCreationsAfterFirstFrame,
    );
    createElement.mockRestore();
  });

  it('insets raster text by authored padding and reports clipped overflow', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn(() => ({ width: 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const padded = createShape({
      padding: 4,
      content: 'AB',
      selections: [{ start: 1, end: 2 }],
    });

    drawTxtShapesToCanvas(ctx, [padded]);

    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'A', 9, 10);
    expect(ctx.fillRect).toHaveBeenCalledWith(14, 10, 5, 12);
    expect(getTxtShapeTextLayout(padded).didOverflow).toBe(false);
    expect(getTxtShapeTextLayout(createShape({
      width: 20,
      height: 12,
      content: 'THIS CANNOT FIT',
      selections: [],
    })).didOverflow).toBe(true);
  });

  it('renders transient playback selections without changing the canonical shape', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn(() => ({ width: 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const shape = createShape({ content: 'AB', selections: [{ start: 0, end: 2 }] });

    setTxtShapeTransientSelectionOverrides(new Map([[shape.id, []]]));
    try {
      drawTxtShapesToCanvas(ctx, [shape]);
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(shape.selections).toEqual([{ start: 0, end: 2 }]);
      drawCanonicalTxtShapesToCanvas(ctx, [shape]);
      expect(ctx.fillRect).toHaveBeenCalled();
    } finally {
      clearTxtShapeTransientSelectionOverrides();
    }
  });

  it('clips and flows raster text inside an oval region', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn(() => ({ width: 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({ regionKind: 'oval', content: 'ABCD', selections: [] })]);

    expect(ctx.ellipse).toHaveBeenCalledWith(55, 31, 50, 25, 0, 0, Math.PI * 2);
    expect((ctx.fillText as jest.Mock).mock.calls[0][1]).toBeGreaterThan(5);
  });

  it('does not paint a vertically partial final line', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn(() => ({ width: 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({
      width: 7,
      height: 13,
      content: 'A B',
      selections: [],
      textAlign: 'center',
    })]);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect((ctx.fillText as jest.Mock).mock.calls[0][0]).toMatch(/^A/);
    expect(getTxtShapeTextLayout(createShape({
      width: 7,
      height: 13,
      content: 'A B',
      selections: [],
    })).didOverflow).toBe(true);
  });

  it('chooses readable selection text for sampled colours', () => {
    expect(getContrastingTxtColor('#f4f4f4')).toBe('#000000');
    expect(getContrastingTxtColor('#151515')).toBe('#ffffff');
  });
});
