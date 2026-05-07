import {
  buildSampledCcShapePreviewShapeKey,
  clearSampledCcShapePreviewStops,
  consumeSampledCcShapePreviewStops,
  rememberSampledCcShapePreviewStops,
} from '@/hooks/canvas/utils/sampledCcShapePreviewStops';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

const stops: StoredStop[] = [
  { position: 0, color: '#112233' },
  { position: 1, color: '#ddeeff' },
];

describe('sampledCcShapePreviewStops', () => {
  beforeEach(() => {
    clearSampledCcShapePreviewStops();
  });

  it('consumes cached stops only for the same finalized shape geometry', () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    const shapeKey = buildSampledCcShapePreviewShapeKey(points);

    rememberSampledCcShapePreviewStops({
      layerId: 'layer-1',
      stops,
      replayKey: 'preview-a',
      shapeKey,
      rawPointCount: points.length,
      seq: 7,
      pointCount: 3,
    });

    expect(consumeSampledCcShapePreviewStops({
      layerId: 'layer-1',
      shapeKey,
      rawPointCount: points.length + 1,
    })).toBeNull();

    expect(consumeSampledCcShapePreviewStops({
      layerId: 'layer-1',
      shapeKey,
      rawPointCount: points.length,
    })).toBeNull();

    rememberSampledCcShapePreviewStops({
      layerId: 'layer-1',
      stops,
      replayKey: 'preview-b',
      shapeKey,
      rawPointCount: points.length,
      seq: 8,
      pointCount: 3,
    });

    const consumed = consumeSampledCcShapePreviewStops({
      layerId: 'layer-1',
      shapeKey,
      rawPointCount: points.length,
    });

    expect(consumed?.stops).toEqual(stops);
    expect(consumed?.replayKey).toBe('preview-b');
  });
});
