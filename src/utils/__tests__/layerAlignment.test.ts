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

  test('uniform preserves surface scale and alignment offsets', () => {
    const transform = computeLayerTransform(
      { width: 200, height: 100 },
      { width: 120, height: 200 },
      { ...baseAlignment, fit: 'uniform' }
    );

    expect(transform.scaleX).toBeCloseTo(1);
    expect(transform.scaleY).toBeCloseTo(1);
    // Center alignment shifts the layer negatively when the surface exceeds the viewport.
    expect(transform.translateX).toBeCloseTo(-40);
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

  test('uniform auto positioning falls back to pixel offsets when no leftover space', () => {
    const autoUniform: LayerAlignmentSettings = {
      fit: 'uniform',
      horizontal: 'left',
      vertical: 'top',
      positioning: 'auto',
      offsetPercent: { x: 25, y: 0 },
      offsetPx: { x: 50, y: 0 }
    };

    const transform = computeLayerTransform(
      { width: 200, height: 100 },
      { width: 200, height: 300 },
      autoUniform
    );

    expect(transform.translateX).toBeCloseTo(50);
    expect(transform.translateY).toBeCloseTo(0);
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
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizeMode: 'fixed',
    width: 400,
    height: 200,
    flow: 'stack',
    wrap: false,
    gap: 0,
    align: 'start',
    justify: 'start',
    ...overrides
  });

  const baseAlignment: LayerAlignmentSettings = {
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
    offsetPx: { x: 0, y: 0 }
  };

  test('assigns the full inner frame to each visible layer', () => {
    const layout = createLayout();

    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 120, height: 60 }, alignment: baseAlignment },
        { layerId: 'b', surface: { width: 80, height: 40 }, alignment: baseAlignment, hidden: true },
        { layerId: 'c', surface: { width: 160, height: 100 }, alignment: baseAlignment }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result.map((entry) => entry.layerId)).toEqual(['a', 'c']);
    expect(result.every((entry) => entry.frame.x === 0 && entry.frame.y === 0)).toBe(true);
    expect(result.every((entry) => entry.frame.width === 400 && entry.frame.height === 200)).toBe(true);
  });

  test('honors container padding when determining the frame', () => {
    const layout = createLayout({
      padding: { top: 10, right: 20, bottom: 30, left: 40 },
      width: 500,
      height: 300
    });

    const result = resolveContainerLayout(
      [
        { layerId: 'layer', surface: { width: 50, height: 50 }, alignment: baseAlignment }
      ],
      layout,
      { width: 500, height: 300 }
    );

    expect(result).toHaveLength(1);
    expect(result[0].frame).toEqual({ x: 40, y: 10, width: 440, height: 260 });
  });

  test('stacks every visible layer on the same inner frame', () => {
    const layout = createLayout();

    const result = resolveContainerLayout(
      [
        { layerId: 'a', surface: { width: 100, height: 100 }, alignment: baseAlignment },
        { layerId: 'b', surface: { width: 80, height: 120 }, alignment: baseAlignment }
      ],
      layout,
      { width: 400, height: 200 }
    );

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.frame)).toEqual([
      { x: 0, y: 0, width: 400, height: 200 },
      { x: 0, y: 0, width: 400, height: 200 }
    ]);
  });

  test('uniform fit uses surface dimensions when computing transform', () => {
    const uniformAlignment: LayerAlignmentSettings = {
      fit: 'uniform',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'anchor',
      offsetPx: { x: 0, y: 0 }
    };

    const layout = createLayout({
      width: 150,
      height: 150
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
    expect(result[0].frame).toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(result[0].transform.scaleX).toBeCloseTo(1);
    expect(result[0].transform.scaleY).toBeCloseTo(1);
  });
});
