import {
  evaluateColorCyclePersistencePolicy,
  getColorCycleStateFieldClass,
  getModernColorCycleDataFieldClass,
} from '@/utils/projectPersistence';

describe('projectPersistence color-cycle policy', () => {
  it('classifies strict V1 state and modern color-cycle fields explicitly', () => {
    expect(getColorCycleStateFieldClass('paintRef')).toBe('canonical');
    expect(getColorCycleStateFieldClass('dither')).toBe('metadata');
    expect(getModernColorCycleDataFieldClass('canvasImageData')).toBe('metadata');
    expect(getModernColorCycleDataFieldClass('fgDerivedKey')).toBeUndefined();
  });

  it('reports hard-fail dual-authority and unexpected-field issues', () => {
    const issues = evaluateColorCyclePersistencePolicy(
      {
        version: 1,
        dimensions: { width: 4, height: 4 },
        gradientIdRef: 'zip:buffers/color-cycle/layer/gradient-id.bin',
        isAnimating: true,
      },
      {
        gradientDefStore: [],
        fgDerivedKey: 'legacy',
        brushState: {
          layers: [{
            layerId: 'layer',
            strokeData: {
              flowBuffer: 'zip:buffers/color-cycle/layer/flow.bin',
            },
          }],
        },
      },
    );

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unexpected-state-fields',
        decision: 'hard-fail',
        fields: ['isAnimating'],
      }),
      expect.objectContaining({
        code: 'unexpected-color-cycle-data-fields',
        decision: 'hard-fail',
        fields: expect.arrayContaining(['gradientDefStore', 'fgDerivedKey', 'brushState']),
      }),
      expect.objectContaining({
        code: 'dual-authority-canonical-fields',
        decision: 'hard-fail',
      }),
      expect.objectContaining({
        code: 'dual-authority-runtime-stroke-buffers',
        decision: 'hard-fail',
      }),
    ]));
  });
});
