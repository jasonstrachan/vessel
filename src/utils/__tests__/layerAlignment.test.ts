import type { ExportContainerLayout, LayerAlignmentSettings } from '@/types';
import { computeLayerTransform, resolveContainerLayout } from '../layerAlignment';

describe('computeLayerTransform', () => {
  const baseAlignment: LayerAlignmentSettings = {
    fit: 'none',
    horizontal: 'center',
    vertical: 'center',
    positioning: 'anchor',
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

  test('uniform scales using the minimum ratio between surface and viewport', () => {
    const transform = computeLayerTransform(
      { width: 200, height: 100 },
      { width: 120, height: 200 },
      { ...baseAlignment, fit: 'uniform' }
    );

    expect(transform.scaleX).toBeCloseTo(0.6);
    expect(transform.scaleY).toBeCloseTo(0.6);
    expect(transform.translateX).toBeCloseTo(0);
    expect(transform.translateY).toBeCloseTo(70);
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

  test('cover scales uniformly until the frame is fully covered', () => {
    const transform = computeLayerTransform(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
      { ...baseAlignment, fit: 'cover' }
    );

    expect(transform.scaleX).toBeCloseTo(4);
    expect(transform.scaleY).toBeCloseTo(4);
    // With cover, the horizontal overflow is centered (extra space is negative).
    expect(transform.translateX).toBeCloseTo(-100);
    expect(transform.translateY).toBeCloseTo(0);
  });

  test('fill stretches independently on each axis', () => {
    const transform = computeLayerTransform(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
      { ...baseAlignment, fit: 'fill' }
    );

    expect(transform.scaleX).toBeCloseTo(2);
    expect(transform.scaleY).toBeCloseTo(4);
    expect(transform.translateX).toBeCloseTo(0);
    expect(transform.translateY).toBeCloseTo(0);
  });

  test('none fit leaves scaling at 1 and only adjusts alignment', () => {
    const transform = computeLayerTransform(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
      { ...baseAlignment, fit: 'none' }
    );

    expect(transform.scaleX).toBeCloseTo(1);
    expect(transform.scaleY).toBeCloseTo(1);
    expect(transform.translateX).toBeCloseTo(50);
    expect(transform.translateY).toBeCloseTo(75);
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
        positioning: 'anchor',
        offsetPercent: { x: 25, y: 75 }
      }
    );

    expect(percentTransform.translateX).toBeCloseTo(50);
    expect(percentTransform.translateY).toBeCloseTo(150);
  });

  test('auto positioning uses percent offsets with any fit', () => {
    const autoAlignment: LayerAlignmentSettings = {
      ...baseAlignment,
      positioning: 'auto',
      offsetPercent: { x: 30, y: 20 }
    };

    const transform = computeLayerTransform(
      { width: 50, height: 50 },
      { width: 200, height: 200 },
      autoAlignment
    );

    expect(transform.translateX).toBeCloseTo(45);
    expect(transform.translateY).toBeCloseTo(30);
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
    positioning: 'anchor',
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

  test('stack flow overlays layers within padded viewport', () => {
    const layout = createLayout({
      flow: 'stack',
      padding: { top: 10, right: 20, bottom: 10, left: 20 }
    });

    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 100, height: 50 }, alignment },
        { layerId: 'b', surface: { width: 80, height: 80 }, alignment },
        { layerId: 'c', surface: { width: 60, height: 60 }, alignment, hidden: true }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.frame)).toEqual([
      { x: 20, y: 10, width: 360, height: 180 },
      { x: 20, y: 10, width: 360, height: 180 }
    ]);
  });

  test('uniform fit scales using the layer surface when resolving layout', () => {
    const uniformAlignment: LayerAlignmentSettings = {
      fit: 'uniform',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'anchor',
      offsetPx: { x: 0, y: 0 }
    };

    const layout = createLayout({
      flow: 'stack',
      sizeMode: 'fixed',
      width: 150,
      height: 150,
      padding: { top: 0, right: 0, bottom: 0, left: 0 }
    });

    const result = resolveContainerLayout(
      [
        {
          layerId: 'uniform',
          surface: { width: 200, height: 100 },
          content: { width: 80, height: 60 },
          alignment: uniformAlignment
        }
      ],
      layout,
      { width: 150, height: 150 }
    );

    expect(result).toHaveLength(1);
    expect(result[0].transform.scaleX).toBeCloseTo(0.75);
    expect(result[0].transform.scaleY).toBeCloseTo(0.75);
  });
});
