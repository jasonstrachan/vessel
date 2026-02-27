import type { ExportContainerLayout, LayerAlignmentSettings } from '@/types';
import { computeLayerTransform, resolveContainerLayout } from '../layerAlignment';
import { computeLayerDestination, normalizeAlignment } from '@/utils/alignment/alignFitResolver';

describe('normalizeAlignment', () => {
  test('defaults tile fit to center anchors', () => {
    const normalized = normalizeAlignment({ fit: 'tile' });
    expect(normalized.horizontal).toBe('center');
    expect(normalized.vertical).toBe('center');
  });

  test('defaults unspecified axes to centered placement', () => {
    const normalized = normalizeAlignment({});
    expect(normalized.fit).toBe('contain');
    expect(normalized.positioning).toBe('auto');
    expect(normalized.horizontal).toBe('center');
    expect(normalized.vertical).toBe('center');
    expect(normalized.offsetPercent?.x).toBe(50);
    expect(normalized.offsetPercent?.y).toBe(50);
  });

  test('coerces legacy uniform fits to contain', () => {
    const normalized = normalizeAlignment({ fit: 'uniform' } as unknown as LayerAlignmentSettings);
    expect(normalized.fit).toBe('contain');
  });
});

const EPS = 1e-4;

const expectClose = (value: number, expected: number, epsilon = EPS) => {
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(epsilon);
};

describe('computeLayerTransform', () => {
  const anchorAlignment: LayerAlignmentSettings = {
    fit: 'none',
    horizontal: 'center',
    vertical: 'center',
    positioning: 'anchor',
    offsetPercent: { x: 50, y: 50 },
  };

  const documentSize = { width: 100, height: 50 };
  const viewport = { width: 200, height: 200 };

  const expectedAnchorTranslation = (
    rendered: { width: number; height: number },
    view: { width: number; height: number }
  ) => ({
    x: (view.width - rendered.width) / 2,
    y: (view.height - rendered.height) / 2,
  });

  test('anchor positioning applies contain scaling and centers leftover area', () => {
    const transform = computeLayerTransform(documentSize, viewport, { ...anchorAlignment, fit: 'contain' });

    const expectedScale = Math.min(viewport.width / documentSize.width, viewport.height / documentSize.height);
    expectClose(transform.scaleX, expectedScale);
    expectClose(transform.scaleY, expectedScale);
    const expected = expectedAnchorTranslation(
      {
        width: documentSize.width * expectedScale,
        height: documentSize.height * expectedScale
      },
      viewport
    );
    expectClose(transform.translateX, expected.x);
    expectClose(transform.translateY, expected.y);
  });

  test('anchor positioning honors fit scaling and percent offsets', () => {
    const percentShift: LayerAlignmentSettings = {
      ...anchorAlignment,
      fit: 'cover',
      offsetPercent: { x: 75, y: 25 },
      horizontal: 'left',
      vertical: 'top',
    };

    const transform = computeLayerTransform(documentSize, viewport, percentShift);
    const expectedScale = Math.max(viewport.width / documentSize.width, viewport.height / documentSize.height);
    expectClose(transform.scaleX, expectedScale);
    expectClose(transform.scaleY, expectedScale);

    const renderedWidth = documentSize.width * expectedScale;
    const renderedHeight = documentSize.height * expectedScale;
    const leftoverX = viewport.width - renderedWidth;
    const leftoverY = viewport.height - renderedHeight;
    expectClose(transform.translateX, leftoverX * 0.75);
    expectClose(transform.translateY, leftoverY * 0.25);
  });

  test('auto positioning applies fit scaling and percent offsets', () => {
    const autoAlignment: LayerAlignmentSettings = {
      fit: 'contain',
      horizontal: 'left',
      vertical: 'top',
      positioning: 'auto',
      offsetPercent: { x: 20, y: 40 },
    };

    const transform = computeLayerTransform(documentSize, viewport, autoAlignment);

    const expectedScale = Math.min(viewport.width / documentSize.width, viewport.height / documentSize.height);
    expectClose(transform.scaleX, expectedScale);
    expectClose(transform.scaleY, expectedScale);

    const renderedWidth = documentSize.width * expectedScale;
    const renderedHeight = documentSize.height * expectedScale;
    const leftoverX = viewport.width - renderedWidth;
    const leftoverY = viewport.height - renderedHeight;
    expectClose(transform.translateX, leftoverX * 0.2);
    expectClose(transform.translateY, leftoverY * 0.4);
  });

  test('auto positioning centers full-bleed layers when viewport is larger', () => {
    const alignment: LayerAlignmentSettings = {
      fit: 'contain',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'auto',
      offsetPercent: { x: 50, y: 50 }
    };

    const documentSize = { width: 100, height: 100 };
    const viewport = { width: 250, height: 200 };

    const transform = computeLayerTransform(documentSize, viewport, alignment);

    const expectedScale = Math.min(viewport.width / documentSize.width, viewport.height / documentSize.height);
    const renderedWidth = documentSize.width * expectedScale;
    const renderedHeight = documentSize.height * expectedScale;
    const leftoverX = viewport.width - renderedWidth;
    const leftoverY = viewport.height - renderedHeight;

    expectClose(transform.scaleX, expectedScale);
    expectClose(transform.scaleY, expectedScale);
    expectClose(transform.translateX, leftoverX / 2);
    expectClose(transform.translateY, leftoverY / 2);
  });

  test('tile fit leaves scale at 1 while translating by percent offsets', () => {
    const transform = computeLayerTransform(
      { width: 120, height: 80 },
      { width: 300, height: 200 },
      {
        ...anchorAlignment,
        fit: 'tile',
        horizontal: 'left',
        vertical: 'top',
        offsetPercent: { x: 50, y: 25 },
      }
    );

    expectClose(transform.scaleX, 1);
    expectClose(transform.scaleY, 1);
    expectClose(transform.translateX, (300 - 120) * 0.5);
    expectClose(transform.translateY, (200 - 80) * 0.25);
  });

  test('auto positioning derives percent from layer bounds when stored percent is neutral', () => {
    const layer = {
      alignment: {
        fit: 'none',
        horizontal: 'left',
        vertical: 'top',
        positioning: 'auto',
        offsetPx: { x: 0, y: 0 },
        offsetPercent: { x: 0, y: 0 }
      },
      bounds: {
        x: 64,
        y: 48,
        width: 128,
        height: 96,
        anchor: 'top-left'
      },
      source: { width: 128, height: 96 }
    } as const;

    const destination = computeLayerDestination({
      document: { width: 512, height: 512 },
      viewport: { width: 512, height: 512 },
      alignment: layer.alignment,
      paintedBounds: {
        x: layer.bounds.x,
        y: layer.bounds.y,
        width: layer.bounds.width,
        height: layer.bounds.height
      }
    });

    expect(destination.x).toBeCloseTo(64);
    expect(destination.y).toBeCloseTo(48);
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
        { layerId: 'a', surface: { width: 120, height: 60 }, document: { width: 400, height: 200 }, alignment: baseAlignment },
        { layerId: 'b', surface: { width: 80, height: 40 }, document: { width: 400, height: 200 }, alignment: baseAlignment, hidden: true },
        { layerId: 'c', surface: { width: 160, height: 100 }, document: { width: 400, height: 200 }, alignment: baseAlignment }
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
        { layerId: 'layer', surface: { width: 50, height: 50 }, document: { width: 500, height: 300 }, alignment: baseAlignment }
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
        { layerId: 'a', surface: { width: 100, height: 100 }, document: { width: 400, height: 200 }, alignment: baseAlignment },
        { layerId: 'b', surface: { width: 80, height: 120 }, document: { width: 400, height: 200 }, alignment: baseAlignment }
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

});
