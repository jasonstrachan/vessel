import type { UiShape } from '@/types';
import {
  cloneUiShapes,
  drawUiShape,
  drawUiShapeComponent,
  MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE,
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

  it('normalizes durable geometry, palette and animation state', () => {
    const [shape] = normalizeUiShapes([{
      ...createShape(),
      x: -10,
      width: 500,
      gridSize: 1,
      palette: { face: 'not-a-colour' },
      components: [{
        ...createShape().components[0],
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

    expect(pixel(start, center)).toEqual([0, 0, 0, 255]);
    expect(pixel(start, center - 1)).not.toEqual([0, 0, 0, 255]);
    expect(pixel(start + radius, center - radius)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start, center - radius)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start + radius, center)).toEqual([0, 0, 0, 255]);
    expect(pixel(rightButtonX + start + radius, center - 1)).not.toEqual([0, 0, 0, 255]);
    expect(pixel(18, 0)).toEqual(trackTop);
    expect(pixel(18, height - 1)).toEqual(trackBottom);
  });

  it('deep-clones component state and animation', () => {
    const original = createShape();
    const [clone] = cloneUiShapes([original]);
    clone!.components[0]!.canonicalState.value = 0.8;
    clone!.components[0]!.animation!.speed = 2;
    expect(original.components[0]!.canonicalState.value).toBe(0.25);
    expect(original.components[0]!.animation!.speed).toBe(0.2);
  });
});
