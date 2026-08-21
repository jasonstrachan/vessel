import type { UiShape } from '@/types';
import {
  cloneUiShapes,
  drawUiShape,
  MACINTOSH_SYSTEM_1_UI_SHAPE_PALETTE,
  normalizeUiShapes,
  WINDOWS_31_UI_SHAPE_PALETTE,
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

  it('deep-clones component state and animation', () => {
    const original = createShape();
    const [clone] = cloneUiShapes([original]);
    clone!.components[0]!.canonicalState.value = 0.8;
    clone!.components[0]!.animation!.speed = 2;
    expect(original.components[0]!.canonicalState.value).toBe(0.25);
    expect(original.components[0]!.animation!.speed).toBe(0.2);
  });
});
