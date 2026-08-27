import {
  createDefaultAdjustmentEffect,
  sanitizeAdjustmentEffect,
  sanitizeAdjustmentLayerData,
} from '@/lib/adjustmentLayers';

describe('adjustment layers', () => {
  it('creates stable defaults for every supported effect', () => {
    expect(createDefaultAdjustmentEffect('hue-sat')).toMatchObject({
      id: 'hue-sat',
      settings: { hue: 0, saturation: 0, hueRangeEnd: 360 },
    });
    expect(createDefaultAdjustmentEffect('color-grade')).toEqual({
      id: 'color-grade',
      settings: { brightness: 0, contrast: 0, saturation: 1 },
    });
    expect(createDefaultAdjustmentEffect('pixelate')).toEqual({
      id: 'pixelate',
      settings: { cellSize: 4 },
    });
    expect(createDefaultAdjustmentEffect('bloom')).toEqual({
      id: 'bloom',
      settings: { blurRadius: 2, intensity: 0.3 },
    });
  });

  it('clamps untrusted settings at the document boundary', () => {
    expect(sanitizeAdjustmentEffect({
      id: 'bloom',
      settings: { blurRadius: 50, intensity: -4 },
    })).toEqual({
      id: 'bloom',
      settings: { blurRadius: 12, intensity: 0 },
    });
    expect(sanitizeAdjustmentEffect({
      id: 'pixelate',
      settings: { cellSize: 4.6 },
    })).toEqual({
      id: 'pixelate',
      settings: { cellSize: 5 },
    });
  });

  it('preserves an explicit unique layer target list while legacy data targets all lower layers', () => {
    expect(sanitizeAdjustmentLayerData({
      effect: createDefaultAdjustmentEffect(),
      targetLayerIds: ['paint-1', '', 'paint-1', 'paint-2'],
    })).toMatchObject({
      targetLayerIds: ['paint-1', 'paint-2'],
    });
    expect(sanitizeAdjustmentLayerData({
      effect: createDefaultAdjustmentEffect(),
    })).not.toHaveProperty('targetLayerIds');
  });
});
