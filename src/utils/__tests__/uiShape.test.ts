import type { UiShape } from '@/types';
import {
  cloneUiShapes,
  drawUiShape,
  drawUiShapeComponent,
  MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE,
  MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE,
  normalizeUiShapes,
  resolveUiShapeScrollbarGeometry,
  resolveUiShapeScrollbarOffset,
  WINDOWS_31_UI_SHAPE_PALETTE,
  WINDOWS_95_UI_SHAPE_PALETTE,
} from '@/utils/uiShape';

const createShape = (updates: Partial<UiShape> = {}): UiShape => ({
  id: 'ui-1',
  layerId: 'layer-1',
  x: 8,
  y: 10,
  width: 48,
  height: 72,
  gridSize: 8,
  theme: 'windows-3.1',
  drawMode: 'fill',
  regionKind: 'rectangle',
  componentKinds: ['scrollbar-vertical'],
  colorSource: 'default',
  palette: { ...WINDOWS_31_UI_SHAPE_PALETTE },
  components: [{
    id: 'scroll-1',
    kind: 'scrollbar-vertical',
    x: 0,
    y: 0,
    width: 16,
    height: 64,
    canonicalState: { value: 0.25 },
    animation: {
      enabled: true,
      kind: 'scroll',
      speed: 0.2,
      direction: 1,
      rangeStart: 0.1,
      rangeEnd: 0.9,
      phaseOffset: 0,
    },
  }],
  createdAt: 1,
  updatedAt: 1,
  ...updates,
});

describe('UI Shape document helpers', () => {
  it('keeps canonical scrollbar positions pixel-snapped and allows smooth playback offsets', () => {
    expect(resolveUiShapeScrollbarOffset(16, 0.26)).toBe(4);
    expect(resolveUiShapeScrollbarOffset(16, 0.26, true)).toBeCloseTo(4.16);
  });

  it('shares native scrollbar travel geometry with direct manipulation', () => {
    expect(resolveUiShapeScrollbarGeometry({
      width: 16,
      height: 64,
      vertical: true,
      theme: 'windows-95',
    })).toEqual({
      crossSize: 16,
      thumbLength: 16,
      trackLength: 32,
      travel: 16,
    });
    expect(resolveUiShapeScrollbarGeometry({
      width: 64,
      height: 16,
      vertical: false,
      theme: 'windows-3.1',
    })).toEqual({
      crossSize: 16,
      thumbLength: 16,
      trackLength: 32,
      travel: 16,
    });
    expect(resolveUiShapeScrollbarGeometry({
      width: 2,
      height: 6,
      vertical: true,
      theme: 'macintosh-system-1',
    })).toEqual({
      crossSize: 2,
      thumbLength: 2,
      trackLength: 2,
      travel: 0,
    });
  });

  it('renders scrollbar arrow presses from transient draw interaction state', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 96;
    const context = canvas.getContext('2d')!;
    const shape = createShape({
      theme: 'windows-95',
      palette: { ...WINDOWS_95_UI_SHAPE_PALETTE },
    });

    drawUiShape(context, shape, undefined, {
      interactions: new Map([[
        'scroll-1',
        { scrollbarPressedPart: 'decrement' as const },
      ]]),
    });

    expect([...context.getImageData(shape.x, shape.y, 1, 1).data])
      .toEqual([0, 0, 0, 255]);
    expect(shape.components[0]?.canonicalState).toEqual({ value: 0.25 });
  });

  it('normalizes durable geometry, palette and animation state', () => {
    const [shape] = normalizeUiShapes([{
      ...createShape(),
      x: -10,
      width: 500,
      gridSize: 1,
      palette: { face: 'not-a-colour' },
      components: [{
        ...createShape().components[0],
        palette: { ...WINDOWS_31_UI_SHAPE_PALETTE, face: '#123456' },
        canonicalState: { value: 4 },
        animation: {
          enabled: true,
          kind: 'scroll',
          speed: 99,
          direction: -1,
          rangeStart: -1,
          rangeEnd: 2,
          phaseOffset: 3,
        },
      }],
    }], 100, 80, [{ id: 'layer-1', layerType: 'normal', order: 0 }]);

    expect(shape).toEqual(expect.objectContaining({
      x: 0,
      width: 100,
      gridSize: 2,
      theme: 'windows-3.1',
    }));
    expect(shape?.palette.face).toBe(WINDOWS_31_UI_SHAPE_PALETTE.face);
    expect(shape?.components[0]?.palette?.face).toBe('#123456');
    expect(shape?.components[0]?.canonicalState.value).toBe(1);
    expect(shape?.components[0]?.animation).toEqual(expect.objectContaining({
      speed: 8,
      direction: -1,
      rangeStart: 0,
      rangeEnd: 1,
      phaseOffset: 1,
    }));
  });

  it('preserves supported themes and applies their default role palette', () => {
    const [shape] = normalizeUiShapes([{
      ...createShape(),
      theme: 'macintosh-system-1',
      palette: {},
    }], 100, 80, [{ id: 'layer-1', layerType: 'normal', order: 0 }]);

    expect(shape?.theme).toBe('macintosh-system-1');
    expect(shape?.palette).toEqual(MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE);

    const [system7Shape] = normalizeUiShapes([{
      ...createShape(),
      theme: 'macintosh-system-7',
      palette: {},
    }], 100, 80, [{ id: 'layer-1', layerType: 'normal', order: 0 }]);

    expect(system7Shape?.theme).toBe('macintosh-system-7');
    expect(system7Shape?.palette).toEqual(MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE);
  });

  it('preserves a bounded grouping identifier without inventing one', () => {
    const [grouped, ungrouped] = normalizeUiShapes([
      { ...createShape({ id: 'grouped' }), groupId: `  ${'g'.repeat(200)}  ` },
      createShape({ id: 'ungrouped' }),
    ], 100, 80, [{ id: 'layer-1', layerType: 'normal', order: 0 }]);

    expect(grouped?.groupId).toBe('g'.repeat(160));
    expect(ungrouped).not.toHaveProperty('groupId');
  });

  it('renders an override without mutating the canonical portrait state', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    expect(context).not.toBeNull();
    const shape = createShape();
    const before = cloneUiShapes([shape]);

    drawUiShape(context!, shape, new Map([['scroll-1', { value: 0.9 }]]));

    expect(shape).toEqual(before[0]);
    expect(context!.getImageData(0, 0, 100, 100).data.some((value) => value !== 0)).toBe(true);
  });

  it('keeps freehand fill edges on the component grid instead of clipping to the raw path', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d')!;
    const shape = createShape({
      x: 0,
      y: 0,
      width: 32,
      height: 24,
      regionKind: 'freehand',
      regionPath: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 0, y: 24 }],
      componentKinds: ['panel'],
      components: [{
        id: 'panel-1',
        kind: 'panel',
        x: 16,
        y: 0,
        width: 8,
        height: 8,
        canonicalState: {},
      }],
    });

    drawUiShape(context, shape);

    expect(context.getImageData(23, 7, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(24, 7, 1, 1).data[3]).toBe(0);
  });

  it('renders each component with its own palette when present', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    const shape = createShape({
      x: 0,
      y: 0,
      width: 16,
      height: 8,
      componentKinds: ['menu-strip'],
      components: [
        {
          id: 'menu-red',
          kind: 'menu-strip',
          x: 0,
          y: 0,
          width: 8,
          height: 8,
          palette: { ...WINDOWS_31_UI_SHAPE_PALETTE, face: '#ff0000' },
          canonicalState: {},
        },
        {
          id: 'menu-blue',
          kind: 'menu-strip',
          x: 8,
          y: 0,
          width: 8,
          height: 8,
          palette: { ...WINDOWS_31_UI_SHAPE_PALETTE, face: '#0000ff' },
          canonicalState: {},
        },
      ],
    });

    drawUiShape(context, shape);

    expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
    expect([...context.getImageData(12, 4, 1, 1).data]).toEqual([0, 0, 255, 255]);
  });

  it('renders System 1 and Windows 95 as distinct component grammars', () => {
    const render = (shape: UiShape) => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const context = canvas.getContext('2d')!;
      drawUiShape(context, shape);
      return [...context.getImageData(0, 0, 100, 100).data];
    };
    const windowComponent = {
      ...createShape().components[0]!,
      kind: 'window' as const,
      width: 48,
      height: 72,
      canonicalState: { active: true, open: true },
    };
    const mac = createShape({
      theme: 'macintosh-system-1',
      palette: { ...MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE },
      components: [windowComponent],
    });
    const windows95 = createShape({
      theme: 'windows-95',
      components: [windowComponent],
    });

    expect(render(mac)).not.toEqual(render(windows95));
  });

  it('renders System 7 striped chrome without selection blue', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 20;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(context, {
      id: 'system-7-title',
      kind: 'title-bar',
      x: 0,
      y: 0,
      width: 64,
      height: 20,
      canonicalState: { active: true },
    }, 0, 0, MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE, undefined, 'macintosh-system-7');

    expect([...context.getImageData(1, 1, 1, 1).data]).toEqual([232, 232, 232, 255]);
    expect([...context.getImageData(30, 3, 1, 1).data]).toEqual([232, 232, 232, 255]);
    expect([...context.getImageData(30, 4, 1, 1).data]).toEqual([128, 128, 128, 255]);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      expect([...pixels.slice(offset, offset + 4)]).not.toEqual([0, 0, 255, 255]);
    }
  });

  it('keeps short System 7 windows inside their authored bounds', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 9;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(context, {
      id: 'short-system-7-window',
      kind: 'window',
      x: 0,
      y: 0,
      width: 16,
      height: 7,
      canonicalState: { active: true, open: true },
    }, 0, 0, MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE, undefined, 'macintosh-system-7');

    expect([...context.getImageData(1, 6, 1, 1).data]).toEqual([0, 0, 0, 255]);
    expect([...context.getImageData(1, 7, 1, 1).data]).toEqual([0, 0, 0, 0]);
  });

  it('renders exact theme-specific radio pixels from canonical checked state', () => {
    const render = (theme: UiShape['theme'], checked: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = 12;
      canvas.height = 12;
      const context = canvas.getContext('2d')!;
      const palette = theme === 'macintosh-system-1'
        ? MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE
        : theme === 'macintosh-system-7'
          ? MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE
        : theme === 'windows-95'
          ? WINDOWS_95_UI_SHAPE_PALETTE
          : WINDOWS_31_UI_SHAPE_PALETTE;
      drawUiShapeComponent(context, {
        id: `radio-${theme}`,
        kind: 'radio-button',
        x: 0,
        y: 0,
        width: 12,
        height: 12,
        canonicalState: { checked },
      }, 0, 0, palette, undefined, theme);
      return context;
    };
    const pixel = (context: CanvasRenderingContext2D, x: number, y: number) => (
      [...context.getImageData(x, y, 1, 1).data]
    );
    const mac = render('macintosh-system-1', false);
    const system7 = render('macintosh-system-7', false);
    const windows31 = render('windows-3.1', false);
    const windows95 = render('windows-95', false);

    expect(pixel(mac, 0, 4)).toEqual([0, 0, 0, 255]);
    expect(pixel(system7, 0, 4)).toEqual([0, 0, 0, 255]);
    expect(pixel(windows31, 0, 4)).toEqual([0, 0, 0, 255]);
    expect(pixel(windows95, 0, 4)).toEqual([128, 128, 128, 255]);
    expect(pixel(mac, 5, 5)).toEqual([255, 255, 255, 255]);
    expect(pixel(render('macintosh-system-1', true), 5, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(render('macintosh-system-7', true), 5, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(render('windows-3.1', true), 5, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(render('windows-95', true), 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it('uses the Windows 95 frame, caption, and field pixel order', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => {
      const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
      return `rgba(${red},${green},${blue},${alpha})`;
    };
    const windowComponent = {
      ...createShape().components[0]!,
      kind: 'window' as const,
      width: 48,
      height: 72,
      canonicalState: { active: true, open: true },
    };
    const windows95 = createShape({
      theme: 'windows-95',
      palette: { ...WINDOWS_95_UI_SHAPE_PALETTE },
      components: [windowComponent],
    });

    drawUiShape(context, windows95);

    expect(pixel(8, 10)).toBe('rgba(223,223,223,255)');
    expect(pixel(9, 11)).toBe('rgba(255,255,255,255)');
    expect(pixel(55, 81)).toBe('rgba(0,0,0,255)');
    expect(pixel(54, 80)).toBe('rgba(128,128,128,255)');
    expect(pixel(11, 13)).toBe('rgba(0,0,128,255)');
  });

  it('renders a checkerboard Windows 95 scrollbar track', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    const shape = createShape({
      theme: 'windows-95',
      palette: { ...WINDOWS_95_UI_SHAPE_PALETTE },
      components: [{
        ...createShape().components[0]!,
        canonicalState: { value: 0 },
      }],
    });

    drawUiShape(context, shape);

    const first = [...context.getImageData(8, 45, 1, 1).data];
    const adjacent = [...context.getImageData(9, 45, 1, 1).data];
    expect(first).not.toEqual(adjacent);
    expect([first, adjacent]).toEqual(expect.arrayContaining([
      [192, 192, 192, 255],
      [255, 255, 255, 255],
    ]));
  });

  it('matches the Windows 95 scrollbar bevel and arrow pixel grammar', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const vertical = {
      ...createShape().components[0]!,
      x: 0,
      y: 0,
      width: 16,
      height: 64,
      canonicalState: { value: 0.5 },
    };

    drawUiShapeComponent(
      context,
      vertical,
      0,
      0,
      WINDOWS_95_UI_SHAPE_PALETTE,
      undefined,
      'windows-95',
    );

    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    const blackInteriorPixels = (originX: number, originY: number) => {
      const pixels: string[] = [];
      for (let localY = 2; localY < 14; localY += 1) {
        for (let localX = 2; localX < 14; localX += 1) {
          if (pixel(originX + localX, originY + localY)[0] === 0) {
            pixels.push(`${localX},${localY}`);
          }
        }
      }
      return pixels;
    };

    expect(pixel(0, 0)).toEqual([223, 223, 223, 255]);
    expect(pixel(1, 1)).toEqual([255, 255, 255, 255]);
    expect(blackInteriorPixels(0, 0)).toEqual([
      '7,6',
      '6,7', '7,7', '8,7',
      '5,8', '6,8', '7,8', '8,8', '9,8',
      '4,9', '5,9', '6,9', '7,9', '8,9', '9,9', '10,9',
    ]);
    expect(blackInteriorPixels(0, 48)).toEqual([
      '4,6', '5,6', '6,6', '7,6', '8,6', '9,6', '10,6',
      '5,7', '6,7', '7,7', '8,7', '9,7',
      '6,8', '7,8', '8,8',
      '7,9',
    ]);
  });

  it.each([
    {
      theme: 'macintosh-system-1' as const,
      palette: MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE,
      height: 16,
      trackTop: [0, 0, 0, 255],
      trackBottom: [255, 255, 255, 255],
    },
    {
      theme: 'windows-3.1' as const,
      palette: WINDOWS_31_UI_SHAPE_PALETTE,
      height: 17,
      trackTop: [223, 223, 223, 255],
      trackBottom: [223, 223, 223, 255],
    },
    {
      theme: 'macintosh-system-7' as const,
      palette: MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE,
      height: 16,
      trackTop: [0, 0, 0, 255],
      trackBottom: [0, 0, 0, 255],
    },
    {
      theme: 'windows-95' as const,
      palette: WINDOWS_95_UI_SHAPE_PALETTE,
      height: 16,
      trackTop: [192, 192, 192, 255],
      trackBottom: [255, 255, 255, 255],
    },
  ])('points $theme arrows outward and paints the track to both edges', ({
    theme,
    palette,
    height,
    trackTop,
    trackBottom,
  }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(
      context,
      {
        id: `scroll-${theme}`,
        kind: 'scrollbar-horizontal',
        x: 0,
        y: 0,
        width: 64,
        height,
        canonicalState: { value: 0.5 },
      },
      0,
      0,
      palette,
      undefined,
      theme,
    );

    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    const radius = 3;
    const center = Math.floor((height - 1) / 2);
    const start = center - Math.floor(radius / 2);
    const rightButtonX = 64 - height;

    if (theme === 'macintosh-system-7') {
      const system7Center = Math.floor(height / 2);
      expect(pixel(system7Center - radius, system7Center)).toEqual([0, 0, 0, 255]);
      expect(pixel(system7Center - radius, system7Center - 1)).not.toEqual([0, 0, 0, 255]);
      expect(pixel(system7Center + radius, system7Center - radius)).toEqual([0, 0, 0, 255]);
      expect(pixel(rightButtonX + system7Center - radius, system7Center - radius)).toEqual([0, 0, 0, 255]);
      expect(pixel(rightButtonX + system7Center + radius, system7Center)).toEqual([0, 0, 0, 255]);
      expect(pixel(rightButtonX + system7Center + radius, system7Center - 1)).not.toEqual([0, 0, 0, 255]);
      expect(pixel(18, 0)).toEqual(trackTop);
      expect(pixel(18, height - 1)).toEqual(trackBottom);
      return;
    }

    expect(pixel(start, center)).toEqual([0, 0, 0, 255]);
    expect(pixel(start, center - 1)).not.toEqual([0, 0, 0, 255]);
    expect(pixel(start + radius, center - radius)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start, center - radius)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start + radius, center)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start + radius, center - 1)).not.toEqual([0, 0, 0, 255]);
    expect(pixel(18, 0)).toEqual(trackTop);
    expect(pixel(18, height - 1)).toEqual(trackBottom);
  });

  it('uses the System 7 source greys and grip geometry for scrollbars', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(context, {
      id: 'system-7-scrollbar',
      kind: 'scrollbar-horizontal',
      x: 0,
      y: 0,
      width: 160,
      height: 16,
      canonicalState: { value: 0.36 },
    }, 0, 0, MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE, undefined, 'macintosh-system-7');

    const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
    expect(pixel(4, 4)).toEqual([208, 208, 208, 255]);
    expect(pixel(18, 4)).toEqual([224, 224, 224, 255]);
    expect(pixel(66, 8)).toEqual([128, 128, 128, 255]);
    expect(pixel(67, 8)).toEqual([188, 188, 188, 255]);
    expect(pixel(68, 8)).toEqual([128, 128, 128, 255]);
  });

  it('draws the System 7 rounded default button and focused selection field', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 50;
    const context = canvas.getContext('2d')!;
    drawUiShapeComponent(context, {
      id: 'system-7-button',
      kind: 'button',
      x: 10,
      y: 10,
      width: 75,
      height: 20,
      canonicalState: { active: true, pressed: false },
    }, 0, 0, MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE, undefined, 'macintosh-system-7');
    expect([...context.getImageData(10, 10, 1, 1).data]).toEqual([255, 255, 255, 255]);
    expect([...context.getImageData(14, 10, 1, 1).data]).toEqual([0, 0, 0, 255]);
    expect([...context.getImageData(10, 6, 1, 1).data]).toEqual([0, 0, 0, 0]);
    expect([...context.getImageData(18, 6, 1, 1).data]).toEqual([0, 0, 0, 255]);

    drawUiShapeComponent(context, {
      id: 'system-7-field',
      kind: 'selection-field',
      x: 0,
      y: 34,
      width: 100,
      height: 16,
      canonicalState: { active: true },
    }, 0, 0, MACINTOSH_SYSTEM_7_UI_SHAPE_PALETTE, undefined, 'macintosh-system-7');
    expect([...context.getImageData(0, 34, 1, 1).data]).toEqual([0, 0, 0, 255]);
    expect([...context.getImageData(1, 35, 1, 1).data]).toEqual([0, 0, 0, 255]);
    expect([...context.getImageData(2, 36, 1, 1).data]).toEqual([0, 0, 255, 255]);
  });

  it('deep-clones component state and animation', () => {
    const original = createShape({
      components: [{
        ...createShape().components[0]!,
        palette: { ...WINDOWS_31_UI_SHAPE_PALETTE },
      }],
    });
    const [clone] = cloneUiShapes([original]);
    clone!.components[0]!.palette!.face = '#ff0000';
    clone!.components[0]!.canonicalState.value = 0.8;
    clone!.components[0]!.animation!.speed = 2;
    expect(original.components[0]!.palette!.face).toBe(WINDOWS_31_UI_SHAPE_PALETTE.face);
    expect(original.components[0]!.canonicalState.value).toBe(0.25);
    expect(original.components[0]!.animation!.speed).toBe(0.2);
  });
});
