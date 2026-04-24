import {
  hasCleanStaticCompositeSegments,
  markCompositeSegmentsDirtyByLayerIds,
  markStaticCompositeSegmentsDirty,
} from '@/stores/layers/layerCompositeInvalidation';

describe('layerCompositeInvalidation', () => {
  it('marks all static segments dirty and leaves dynamic segments unchanged', () => {
    const colorCycle = { kind: 'color-cycle', layerId: 'cc' };
    const segments = [
      { kind: 'static', layerIds: ['a'], dirty: false },
      colorCycle,
      { kind: 'static', layerIds: ['b'], dirty: true },
    ];

    const next = markStaticCompositeSegmentsDirty(segments);

    expect(next[0]).toEqual({ kind: 'static', layerIds: ['a'], dirty: true });
    expect(next[1]).toBe(colorCycle);
    expect(next[2]).toEqual({ kind: 'static', layerIds: ['b'], dirty: true });
  });

  it('detects clean static segments', () => {
    expect(hasCleanStaticCompositeSegments([
      { kind: 'static', layerIds: ['a'], dirty: true },
      { kind: 'color-cycle', layerId: 'cc' },
    ])).toBe(false);
    expect(hasCleanStaticCompositeSegments([
      { kind: 'static', layerIds: ['a'], dirty: false },
    ])).toBe(true);
  });

  it('marks only static segments containing matching layer ids dirty', () => {
    const segments = [
      { kind: 'static', layerIds: ['a', 'b'], dirty: false },
      { kind: 'static', layerIds: ['c'], dirty: false },
      { kind: 'sequential', layerId: 'a' },
    ];

    const next = markCompositeSegmentsDirtyByLayerIds(segments, ['b']);

    expect(next[0]).toEqual({ kind: 'static', layerIds: ['a', 'b'], dirty: true });
    expect(next[1]).toBe(segments[1]);
    expect(next[2]).toBe(segments[2]);
  });

  it('returns the original array when no layer ids are supplied', () => {
    const segments = [{ kind: 'static', layerIds: ['a'], dirty: false }];

    expect(markCompositeSegmentsDirtyByLayerIds(segments, [])).toBe(segments);
  });
});
