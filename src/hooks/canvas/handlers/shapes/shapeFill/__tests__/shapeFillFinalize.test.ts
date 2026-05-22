import type { ShapeFillFinalizePayload } from '@/shapeFill';
import type { FillStrategy } from '@/shapeFill/types';
import { renderShapeFillFinalOverlay, validateShapeFillFinalizeTarget } from '../shapeFillFinalize';

const makeLayer = (layerType?: 'color-cycle') => ({
  id: layerType === 'color-cycle' ? 'cc-layer' : 'raster-layer',
  name: 'Layer',
  visible: true,
  opacity: 1,
  imageData: null,
  layerType,
});

const fillRectStrategy: FillStrategy = {
  id: 'hatch',
  label: 'Hatch',
  defaults: {
    spacing: 4,
    rotation: 0,
    thickness: 1,
  },
  apply: () => ({
    dotInstances: [
      {
        center: { x: 8, y: 8 },
        radius: 4,
        size: 8,
        shape: 'square',
      },
    ],
  }),
  ui: [],
};

const payload: ShapeFillFinalizePayload = {
  shape: {
    id: 'shape-1',
    points: [
      { x: 2, y: 2 },
      { x: 14, y: 2 },
      { x: 14, y: 14 },
      { x: 2, y: 14 },
    ],
    centroid: { x: 8, y: 8 },
    bounds: { minX: 2, minY: 2, maxX: 14, maxY: 14 },
  },
  params: fillRectStrategy.defaults,
  result: { polygons: [] },
  strategy: fillRectStrategy,
  fillId: 'hatch',
};

describe('shapeFillFinalize', () => {
  it('validates target before session finalization can mutate state', () => {
    expect(validateShapeFillFinalizeTarget({
      activeLayer: undefined,
      project: { width: 16, height: 16 },
    })).toMatchObject({ ok: false, outcome: 'failed-missing-target' });

    expect(validateShapeFillFinalizeTarget({
      activeLayer: makeLayer('color-cycle') as never,
      project: { width: 16, height: 16 },
    })).toMatchObject({ ok: false, outcome: 'blocked-unsupported-layer' });

    expect(validateShapeFillFinalizeTarget({
      activeLayer: makeLayer() as never,
      project: { width: 0, height: 16 },
    })).toMatchObject({ ok: false, outcome: 'failed-invalid-project-size' });

    expect(validateShapeFillFinalizeTarget({
      activeLayer: makeLayer() as never,
      project: { width: 16, height: 16 },
    })).toMatchObject({ ok: true });
  });

  it('renders final overlay and proves visible pixels before commit', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const result = renderShapeFillFinalOverlay({
      canvas,
      ctx,
      payload,
      fillParams: fillRectStrategy.defaults,
      primaryColor: '#ff0000',
      pixelPerfect: false,
      showOutline: false,
      opacity: 1,
      boundingBox: payload.shape.bounds,
      project: { width: 20, height: 20 },
      applyTransparencyLock: jest.fn(),
    });

    expect(result.roi).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(result.hasVisibleOverlay).toBe(true);
    expect(result.params.fillColor).toBe('#ff0000');
  });
});
