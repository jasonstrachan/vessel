import type { ShapeFillFinalizePayload } from '@/shapeFill';
import type { FillStrategy } from '@/shapeFill/types';
import type { Layer } from '@/types';
import { renderShapeFillFinalOverlay, validateShapeFillFinalizeTarget } from '../shapeFillFinalize';

const makeLayer = (layerType: Layer['layerType'] = 'normal'): Layer => ({
  id: layerType === 'color-cycle' ? 'cc-layer' : 'raster-layer',
  name: 'Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: { fit: 'none', horizontal: 'center', vertical: 'center', positioning: 'anchor' },
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
      activeLayer: makeLayer('color-cycle'),
      project: { width: 16, height: 16 },
    })).toMatchObject({ ok: false, outcome: 'blocked-unsupported-layer' });

    expect(validateShapeFillFinalizeTarget({
      activeLayer: makeLayer(),
      project: { width: 0, height: 16 },
    })).toMatchObject({ ok: false, outcome: 'failed-invalid-project-size' });

    expect(validateShapeFillFinalizeTarget({
      activeLayer: makeLayer(),
      project: { width: 16, height: 16 },
    })).toMatchObject({ ok: true });
  });

  it('rejects a raster target locked after a valid draft began and admits it again after unlocking', () => {
    const layer = makeLayer();
    const project = { width: 16, height: 16 };

    expect(validateShapeFillFinalizeTarget({ activeLayer: layer, project })).toEqual({
      ok: true,
      layer,
      project,
    });

    const lockedLayer = { ...layer, locked: true };
    expect(validateShapeFillFinalizeTarget({ activeLayer: lockedLayer, project })).toEqual({
      ok: false,
      outcome: 'blocked-locked-layer',
      message: 'Shape Fill cannot commit to a locked layer. Unlock it to edit.',
    });
    expect(lockedLayer.locked).toBe(true);

    const unlockedLayer = { ...lockedLayer, locked: false };
    expect(validateShapeFillFinalizeTarget({ activeLayer: unlockedLayer, project })).toEqual({
      ok: true,
      layer: unlockedLayer,
      project,
    });
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
