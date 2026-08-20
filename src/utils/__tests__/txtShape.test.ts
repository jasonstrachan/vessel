import type { TxtShape } from '@/types';
import {
  clearTxtShapeTransientSelectionOverrides,
  composeTxtShapesIntoLayerSource,
  drawCanonicalTxtShapesToCanvas,
  drawTxtShapesToCanvas,
  drawUnselectedTxtShapesToCanvas,
  getContrastingTxtColor,
  getTxtShapeClipPath,
  getTxtShapeFlowInsetPath,
  getTxtShapeHorizontalSpan,
  getTxtShapeHorizontalSpanForBand,
  getTxtShapeLineBlockBands,
  getTxtShapeLineBlockClipPath,
  getTxtShapeLineHeightPx,
  getTxtShapePadding,
  getTxtShapeRegionPathArea,
  getTxtShapeTextLayout,
  getTxtShapeTransientSelectionRevision,
  normalizeTxtShapeSelections,
  normalizeTxtShapes,
  setTxtShapeTransientSelectionOverrides,
  splitTxtShapeSegments,
  thresholdTxtShapePixelAlpha,
  updateTxtShapeSelectionsForContent,
} from '@/utils/txtShape';
import { layoutTxtShapeText } from '@/utils/txtShapeLayout';
import {
  createTxtShapeFontFaceCss,
  getTxtShapeFontMinimumSize,
  getTxtShapeFontSizeStep,
  getTxtShapePixelScale,
  getTxtShapeRasterFontSize,
  isTxtShapeFontFamily,
  loadTxtShapeFont,
  normalizeTxtShapeFontFamily,
  normalizeTxtShapeFontSize,
  TXT_SHAPE_FONT_DEFINITIONS,
} from '@/utils/txtShapeFonts';
import * as txtShapeMonoRenderer from '@/utils/txtShapeMonoRenderer';

const createShape = (updates: Partial<TxtShape> = {}): TxtShape => ({
  id: 'txt-1',
  layerId: 'layer-1',
  x: 5,
  y: 6,
  width: 100,
  height: 50,
  columns: 1,
  colorCount: 2,
  content: 'LIGHT DARK',
  fontFamily: 'departure-mono',
  fontSize: 11,
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
      'mek-sans',
      'mek-mono',
      'jetbrains-mono',
      'ibm-plex-mono',
      'departure-mono',
      'tiny5',
      'm3x6',
      'monogram',
      'silkscreen',
      'spleen-6x12',
      'fusion-pixel-8px-mono',
    ]);
    expect(isTxtShapeFontFamily('mek-mono')).toBe(true);
    expect(isTxtShapeFontFamily('missing-font')).toBe(false);
    expect(normalizeTxtShapeFontFamily('serif')).toBe('mek-mono');
    expect(getTxtShapeFontMinimumSize('mek-sans')).toBe(10);
    expect(getTxtShapeFontSizeStep('mek-sans')).toBe(1);
    expect(getTxtShapeFontMinimumSize('mek-mono')).toBe(12);
    expect(getTxtShapeFontSizeStep('mek-mono')).toBe(1);
    expect(getTxtShapeFontMinimumSize('jetbrains-mono')).toBe(8);
    expect(getTxtShapeFontMinimumSize('ibm-plex-mono')).toBe(8);
    expect(getTxtShapeFontMinimumSize('departure-mono')).toBe(11);
    expect(getTxtShapeFontSizeStep('departure-mono')).toBe(11);
    expect(getTxtShapeFontMinimumSize('tiny5')).toBe(8);
    expect(getTxtShapeFontMinimumSize('m3x6')).toBe(16);
    expect(getTxtShapeFontMinimumSize('monogram')).toBe(16);
    expect(getTxtShapeFontMinimumSize('silkscreen')).toBe(8);
    expect(getTxtShapeFontMinimumSize('spleen-6x12')).toBe(12);
    expect(getTxtShapeFontMinimumSize('fusion-pixel-8px-mono')).toBe(8);
    expect(normalizeTxtShapeFontSize('departure-mono', 24)).toBe(22);
    expect(normalizeTxtShapeFontSize('departure-mono', 29)).toBe(33);
    expect(normalizeTxtShapeFontSize('mek-sans', 24)).toBe(24);
    expect(normalizeTxtShapeFontSize('mek-mono', 25)).toBe(25);
    expect(normalizeTxtShapeFontSize('jetbrains-mono', 2)).toBe(8);
    expect(normalizeTxtShapeFontSize('ibm-plex-mono', 25)).toBe(25);
    expect(normalizeTxtShapeFontSize('departure-mono', 512)).toBe(33);
    expect(normalizeTxtShapeFontSize('tiny5', 13)).toBe(16);
    expect(normalizeTxtShapeFontSize('m3x6', 40)).toBe(32);
    expect(normalizeTxtShapeFontSize('spleen-6x12', 40)).toBe(36);
    expect(getTxtShapeRasterFontSize('mek-sans', 24)).toBe(24);
    expect(getTxtShapeRasterFontSize('departure-mono', 33)).toBe(11);
    expect(getTxtShapePixelScale('mek-sans', 24)).toBe(1);
    expect(getTxtShapePixelScale('departure-mono', 33)).toBe(3);
    expect(getTxtShapeRasterFontSize('tiny5', 24)).toBe(8);
    expect(getTxtShapePixelScale('tiny5', 24)).toBe(3);
    expect(createTxtShapeFontFaceCss('/vessel')).toContain(
      "url('/vessel/assets/fonts/DEPARTURE-MONO-REGULAR.WOFF2')",
    );
    expect(createTxtShapeFontFaceCss('/vessel')).toContain(
      "url('/vessel/assets/fonts/JETBRAINS-MONO-REGULAR.WOFF2')",
    );
    expect(createTxtShapeFontFaceCss('/vessel')).toContain(
      "url('/vessel/assets/fonts/M3X6-REGULAR.TTF') format('truetype')",
    );
  });

  it('clamps font size against the selected face minimum', () => {
    const [departure, mekSans, legacySmooth] = normalizeTxtShapes([
      createShape({ id: 'departure', fontFamily: 'departure-mono', fontSize: 2 }),
      createShape({ id: 'mek-sans', fontFamily: 'mek-sans', fontSize: 2 }),
      { ...createShape({ id: 'legacy-smooth', fontSize: 2 }), fontFamily: 'monospace' },
    ], 200, 100);

    expect(departure?.fontSize).toBe(11);
    expect(mekSans?.fontSize).toBe(10);
    expect(legacySmooth).toEqual(expect.objectContaining({
      fontFamily: 'mek-mono',
      fontSize: 12,
    }));
    expect(normalizeTxtShapes([
      createShape({ fontFamily: 'departure-mono', fontSize: 24 }),
    ], 200, 100)[0]?.fontSize).toBe(22);
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
      columns: 1,
      colorCount: 2,
    }));
    expect(shapes[1]?.id).toMatch(/^txt-shape-/);
  });

  it('preserves valid optional shape fills without changing legacy transparency', () => {
    const [filled, legacy, invalid] = normalizeTxtShapes([
      createShape({ id: 'filled', backgroundColor: '#336699' }),
      createShape({ id: 'legacy' }),
      { ...createShape({ id: 'invalid' }), backgroundColor: 42 },
    ], 200, 100);

    expect(filled.backgroundColor).toBe('#336699');
    expect(legacy.backgroundColor).toBeUndefined();
    expect(invalid.backgroundColor).toBeUndefined();
  });

  it('preserves partially off-canvas authored geometry', () => {
    const [shape] = normalizeTxtShapes([
      createShape({ x: -20, y: 80, width: 120, height: 40 }),
    ], 200, 100);

    expect(shape).toEqual(expect.objectContaining({
      x: -20,
      y: 80,
      width: 120,
      height: 40,
    }));
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
    expect(getTxtShapeLineBlockBands(oval)).toHaveLength(4);
    expect(getTxtShapeLineBlockClipPath(oval)).toMatch(/^polygon\(/);
    expect(getTxtShapeLineBlockBands(oval)[0]).toEqual(expect.objectContaining({
      top: 0,
      bottom: 13,
    }));

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

  it('keeps mapped colour bands separate from canonical selection geometry', () => {
    const segments = splitTxtShapeSegments(createShape({
      colorRanges: [{ start: 6, end: 10, color: '#336699' }],
    }));

    expect(segments).toEqual([
      { text: 'LIGHT ', selected: false },
      { color: '#336699', text: 'DARK', selected: true },
    ]);
  });

  it('rasterizes mapped colour bands without changing their selected ranges', () => {
    const fillStyles: string[] = [];
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(ctx, 'fillStyle', {
      configurable: true,
      get: () => fillStyles.at(-1) ?? '',
      set: (value: string) => fillStyles.push(value),
    });
    const shape = createShape({
      content: 'AB',
      selections: [{ start: 1, end: 2 }],
      colorRanges: [{ start: 1, end: 2, color: '#336699' }],
    });

    drawTxtShapesToCanvas(ctx, [shape]);

    expect(fillStyles).toContain('#336699');
    expect(fillStyles).toContain('#ffffff');
    expect(shape.selections).toEqual([{ start: 1, end: 2 }]);
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

  it('flows a large text block down each authored column before moving right', () => {
    const layout = getTxtShapeTextLayout(createShape({
      width: 90,
      height: 28,
      columns: 2,
      content: 'AA BB CC DD EE FF GG HH',
      selections: [],
    }));

    expect(layout.lines.some((line) => line.columnIndex === 0)).toBe(true);
    expect(layout.lines.some((line) => line.columnIndex === 1)).toBe(true);
    const firstRightColumnLine = layout.lines.find((line) => line.columnIndex === 1);
    expect(firstRightColumnLine?.sourceStart).toBeGreaterThan(0);
    expect(firstRightColumnLine?.span.left).toBeGreaterThan(45);
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
      measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      font: '',
      textBaseline: 'alphabetic',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({ content: 'AB', selections: [{ start: 1, end: 2 }] })]);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 6, 5, 13);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'AB', 5, 6);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'AB', 5, 6);
    expect(ctx.rect).toHaveBeenCalledWith(5, 6, 5, 50);
    expect(ctx.rect).toHaveBeenCalledWith(10, 6, 5, 50);
  });

  it('fills the complete clipped TXT Shape region before drawing its text', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({
      content: 'AB',
      selections: [],
      backgroundColor: '#336699',
    })]);

    expect(ctx.fillRect).toHaveBeenCalledWith(5, 6, 100, 50);
    expect((ctx.fillRect as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (ctx.fillText as jest.Mock).mock.invocationCallOrder[0]!,
    );
  });

  it('collapses pixel-font coverage to fully on or fully off document pixels', () => {
    const pixels = new Uint8ClampedArray([
      80, 90, 100, 0,
      80, 90, 100, 127,
      80, 90, 100, 128,
      80, 90, 100, 220,
    ]);

    thresholdTxtShapePixelAlpha(pixels);

    expect([...pixels]).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      80, 90, 100, 255,
      80, 90, 100, 255,
    ]);
  });

  it('prepares one native strike per line and reuses it across selection colours', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    const drawImage = jest.spyOn(ctx!, 'drawImage');
    const fillText = jest.spyOn(ctx!, 'fillText');
    const getImageData = jest.spyOn(CanvasRenderingContext2D.prototype, 'getImageData');
    const shape = createShape({
      x: 5.4,
      y: 6.4,
      content: 'PIXEL',
      fontFamily: 'departure-mono',
      fontSize: 33,
      selections: [{ start: 1, end: 4 }],
    });

    drawTxtShapesToCanvas(ctx!, [shape]);

    const drawCall = drawImage.mock.calls[0] as unknown as [
      CanvasImageSource, number, number, number, number, number, number, number, number,
    ];
    expect(drawCall[1]).toBe(0);
    expect(drawCall[2]).toBe(0);
    expect(drawCall[5]).toBe(-1);
    expect(drawCall[6]).toBe(6);
    expect(drawCall[7]).toBe(drawCall[3] * 3);
    expect(drawCall[8]).toBe(drawCall[4] * 3);
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(getImageData).toHaveBeenCalledTimes(1);
    expect(fillText).not.toHaveBeenCalled();
    expect(getTxtShapeLineHeightPx(shape)).toBe(39);
    expect(getTxtShapeTextLayout(shape).lineHeightPx).toBe(39);
    getImageData.mockRestore();
  });

  it('reuses a monochrome glyph mask while playback selections change', () => {
    const measureMonoText = jest
      .spyOn(txtShapeMonoRenderer, 'measureTxtShapeMonoText')
      .mockImplementation((_family, _fontSize, text) => text.length * 5);
    const drawMonoTextMask = jest
      .spyOn(txtShapeMonoRenderer, 'drawTxtShapeMonoTextMask')
      .mockImplementation(({ context }) => {
        context.fillRect(0, 0, 4, 4);
        return true;
      });
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    const shape = createShape({
      content: 'CACHE MASK UNIQUE',
      fontFamily: 'departure-mono',
      fontSize: 33,
      selections: [],
      width: 220,
    });

    drawTxtShapesToCanvas(ctx!, [shape]);
    expect(drawMonoTextMask).toHaveBeenCalledTimes(1);
    setTxtShapeTransientSelectionOverrides(new Map([[shape.id, [{ start: 0, end: 5 }]]]));
    try {
      drawTxtShapesToCanvas(ctx!, [shape]);
    } finally {
      clearTxtShapeTransientSelectionOverrides();
    }

    expect(drawMonoTextMask).toHaveBeenCalledTimes(1);
    drawMonoTextMask.mockRestore();
    measureMonoText.mockRestore();
  });

  it('rasterizes MEK at its requested size without enlarging a smaller strike', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    const drawImage = jest.spyOn(ctx!, 'drawImage');
    const shape = createShape({
      content: 'MEK',
      fontFamily: 'mek-sans',
      fontSize: 24,
      selections: [],
    });

    drawTxtShapesToCanvas(ctx!, [shape]);

    const drawCall = drawImage.mock.calls[0] as unknown as [
      CanvasImageSource, number, number, number, number, number, number, number, number,
    ];
    const rasterSurface = drawCall[0] as HTMLCanvasElement;
    expect(rasterSurface.getContext('2d')?.font).toBe("24px 'MEK Sans', sans-serif");
    expect(drawCall[7]).toBe(drawCall[3]);
    expect(drawCall[8]).toBe(drawCall[4]);
    expect(getTxtShapeLineHeightPx(shape)).toBe(29);
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
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const padded = createShape({
      padding: 4,
      content: 'AB',
      selections: [{ start: 1, end: 2 }],
    });

    drawTxtShapesToCanvas(ctx, [padded]);

    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'AB', 9, 10);
    expect(ctx.fillRect).toHaveBeenCalledWith(14, 10, 5, 13);
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
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
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

  it('renders an unselected base raster for Goblet selection projection', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const shape = createShape({
      content: 'AB',
      selections: [{ start: 0, end: 2 }],
      backgroundColor: '#336699',
    });

    drawUnselectedTxtShapesToCanvas(ctx, [shape]);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(5, 6, 100, 50);
    expect(shape.selections).toEqual([{ start: 0, end: 2 }]);
  });

  it('reuses immutable text layout while transient selections advance', () => {
    const shape = createShape({ content: 'A LONGER LINE OF TEXT' });
    const initialLayout = getTxtShapeTextLayout(shape);

    setTxtShapeTransientSelectionOverrides(new Map([[shape.id, [{ start: 0, end: 4 }]]]));
    try {
      expect(getTxtShapeTextLayout(shape)).toBe(initialLayout);
    } finally {
      clearTxtShapeTransientSelectionOverrides();
    }
  });

  it('does not invalidate the raster cache for an unchanged transient projection', () => {
    clearTxtShapeTransientSelectionOverrides();
    const before = getTxtShapeTransientSelectionRevision();
    const first = setTxtShapeTransientSelectionOverrides(new Map([
      ['txt-1', [{ start: 0, end: 2 }]],
    ]));
    const repeated = setTxtShapeTransientSelectionOverrides(new Map([
      ['txt-1', [{ start: 0, end: 2 }]],
    ]));

    expect(first).toBe(before + 1);
    expect(repeated).toBe(first);
    expect(clearTxtShapeTransientSelectionOverrides()).toBe(first + 1);
    expect(clearTxtShapeTransientSelectionOverrides()).toBe(first + 1);
  });

  it('clips and flows raster text inside line-height blocks derived from an oval region', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
      fillRect: jest.fn(), fillText: jest.fn(), font: '', textBaseline: 'alphabetic', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawTxtShapesToCanvas(ctx, [createShape({ regionKind: 'oval', content: 'ABCD', selections: [] })]);

    expect(ctx.ellipse).not.toHaveBeenCalled();
    expect((ctx.rect as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect((ctx.rect as jest.Mock).mock.calls[0][0]).toBeGreaterThan(5);
    expect((ctx.rect as jest.Mock).mock.calls[0][1]).toBe(6);
    expect((ctx.rect as jest.Mock).mock.calls[0][3]).toBe(13);
    expect((ctx.fillText as jest.Mock).mock.calls[0][1]).toBeGreaterThan(5);
  });

  it('does not paint a vertically partial final line', () => {
    const ctx = {
      save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      ellipse: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), closePath: jest.fn(),
      clip: jest.fn(), measureText: jest.fn((text: string) => ({ width: text.length * 5 })),
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
