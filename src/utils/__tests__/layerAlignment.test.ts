import type { ExportContainerLayout, LayerAlignmentSettings } from '@/types';
import { computeLayerTransform, resolveContainerLayout } from '../layerAlignment';

describe('computeLayerTransform', () => {
  const baseAlignment: LayerAlignmentSettings = {
    fit: 'none',
    horizontal: 'center',
    vertical: 'center',
    offsetPx: { x: 0, y: 0 }
  };

  test('contain fits within viewport and centers content', () => {
    const transform = computeLayerTransform(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
      { ...baseAlignment, fit: 'contain' }
    );

    expect(transform.scaleX).toBeCloseTo(2);
    expect(transform.scaleY).toBeCloseTo(2);
    expect(transform.translateX).toBeCloseTo(0);
    expect(transform.translateY).toBeCloseTo(50);
  });

  test('scale-down will not upscale content', () => {
    const transform = computeLayerTransform(
      { width: 50, height: 50 },
      { width: 25, height: 25 },
      { ...baseAlignment, fit: 'scale-down' }
    );

    expect(transform.scaleX).toBeCloseTo(0.5);
    expect(transform.scaleY).toBeCloseTo(0.5);
  });

  test('percent offsets are ignored unless fit is percent', () => {
    const containTransform = computeLayerTransform(
      { width: 50, height: 50 },
      { width: 100, height: 100 },
      {
        ...baseAlignment,
        fit: 'contain',
        offsetPercent: { x: 50, y: 50 }
      }
    );

    expect(containTransform.translateX).toBeCloseTo(0);
    expect(containTransform.translateY).toBeCloseTo(0);

    const noneTransform = computeLayerTransform(
      { width: 50, height: 50 },
      { width: 150, height: 150 },
      {
        ...baseAlignment,
        horizontal: 'left',
        vertical: 'top',
        fit: 'none',
        offsetPercent: { x: 50, y: 50 }
      }
    );

    expect(noneTransform.translateX).toBeCloseTo(0);
    expect(noneTransform.translateY).toBeCloseTo(0);

    const percentTransform = computeLayerTransform(
      { width: 100, height: 100 },
      { width: 200, height: 200 },
      {
        ...baseAlignment,
        horizontal: 'left',
        vertical: 'top',
        fit: 'percent',
        offsetPercent: { x: 25, y: 75 }
      }
    );

    expect(percentTransform.translateX).toBeCloseTo(50);
    expect(percentTransform.translateY).toBeCloseTo(150);
  });

  test('offsets are applied after alignment', () => {
    const transform = computeLayerTransform(
      { width: 100, height: 100 },
      { width: 200, height: 200 },
      { ...baseAlignment, fit: 'contain', offsetPx: { x: 10, y: -5 } }
    );

    expect(transform.translateX).toBeCloseTo(10);
    expect(transform.translateY).toBeCloseTo(-5);
  });
});

describe('resolveContainerLayout', () => {
  const createLayout = (overrides: Partial<ExportContainerLayout> = {}): ExportContainerLayout => ({
    flow: 'row',
    justify: 'start',
    align: 'start',
    wrap: false,
    gap: 10,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizeMode: 'fixed',
    width: 400,
    height: 200,
    ...overrides
  });

    const alignment: LayerAlignmentSettings = {
      fit: 'none',
      horizontal: 'left',
      vertical: 'top',
      offsetPx: { x: 0, y: 0 }
    };

  test('lays out layers horizontally with gaps', () => {
    const layout = createLayout();
    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'b', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'c', surface: { width: 100, height: 50 }, alignment }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result.map((r) => r.frame.x)).toEqual([0, 110, 220]);
    expect(result.map((r) => r.frame.y)).toEqual([0, 0, 0]);
    expect(result.every((r) => r.frame.width === 100 && r.frame.height === 50)).toBe(true);
  });

  test('centers line when justify is center', () => {
    const layout = createLayout({ justify: 'center' });
    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'b', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'c', surface: { width: 100, height: 50 }, alignment }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result.map((r) => r.frame.x)).toEqual([40, 150, 260]);
  });

  test('wraps onto multiple lines when width exceeded', () => {
    const layout = createLayout({ width: 200, wrap: true });
    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 120, height: 50 }, alignment },
        { layerId: 'b', surface: { width: 120, height: 50 }, alignment },
        { layerId: 'c', surface: { width: 120, height: 50 }, alignment }
      ],
      layout,
      { width: 200, height: 200 }
    );

    const framesById = Object.fromEntries(result.map((entry) => [entry.layerId, entry.frame]));
    expect(framesById.a).toEqual({ x: 0, y: 0, width: 120, height: 50 });
    expect(framesById.b).toEqual({ x: 0, y: 60, width: 120, height: 50 });
    expect(framesById.c).toEqual({ x: 0, y: 120, width: 120, height: 50 });
  });

  test('supports column flow with stretch alignment', () => {
    const layout = createLayout({
      flow: 'column',
      align: 'stretch',
      wrap: false,
      width: 200,
      height: 400
    });

    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 50, height: 100 }, alignment },
        { layerId: 'b', surface: { width: 50, height: 100 }, alignment }
      ],
      layout,
      { width: 200, height: 400 }
    );

    expect(result.map((r) => r.frame.y)).toEqual([0, 110]);
    expect(result.every((r) => r.frame.width === 200)).toBe(true);
  });

  test('places items starting at opposite edge for reverse flow', () => {
    const layout = createLayout({ flow: 'row-reverse' });
    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'b', surface: { width: 100, height: 50 }, alignment }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result.map((r) => r.frame.x)).toEqual([190, 300]);
  });
});
