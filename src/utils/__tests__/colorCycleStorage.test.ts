import { DeltaCompressor, OptimizedColorCycleStorage } from '@/utils/colorCycleStorage';
import type { ColorCycleSnapshot } from '@/types';

const makeBuffer = (values: number[]) => new Uint8Array(values).buffer;

describe('DeltaCompressor', () => {
  it('returns empty delta when buffers match and applies back to identical copy', () => {
    const base = new Uint8Array([1, 2, 3]);
    const delta = DeltaCompressor.createDelta(base, new Uint8Array([1, 2, 3]));
    expect(delta.byteLength).toBe(0);

    const applied = DeltaCompressor.applyDelta(base, delta);
    expect(Array.from(applied)).toEqual([1, 2, 3]);
    expect(applied).not.toBe(base);
  });

  it('stores full buffer when delta would be larger than original', () => {
    const base = new Uint8Array([0, 0, 0, 0]);
    const current = new Uint8Array([1, 2, 3, 4]);

    const delta = DeltaCompressor.createDelta(base, current);
    // full buffer marker + data
    expect(delta.byteLength).toBe(current.length + 4);

    const restored = DeltaCompressor.applyDelta(base, delta);
    expect(Array.from(restored)).toEqual([1, 2, 3, 4]);
  });

  it('compresses sparse differences and restores them', () => {
    const base = new Uint8Array([1, 1, 1, 1, 1, 1]);
    const current = new Uint8Array([1, 1, 9, 9, 1, 1]);

    const delta = DeltaCompressor.createDelta(base, current);
    expect(delta.byteLength).toBeGreaterThan(0); // compressed delta

    const restored = DeltaCompressor.applyDelta(base, delta);
    expect(Array.from(restored)).toEqual(Array.from(current));
  });
});

describe('OptimizedColorCycleStorage', () => {
  const makeSnapshot = (
    paintValues: number[],
    gradientStops: Array<{ position: number; color: string }>
  ): ColorCycleSnapshot => ({
    layerId: 'layer-1',
    strokeData: new ArrayBuffer(0),
    gradients: [
      { layerIndex: 0, gradientStops, hasContent: true },
    ],
    animationState: { cycleOffset: 0, speed: 1, fps: 60, isPaused: false },
    layerStrokes: [
      {
        layerId: 'stroke-1',
        paintBuffer: makeBuffer(paintValues),
        hasContent: true,
        strokeCounter: 0,
        strokeLength: paintValues.length,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
      },
    ],
  });

  it('stores snapshots, reuses gradient pool IDs, and reconstructs deltas', () => {
    const storage = new OptimizedColorCycleStorage();
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    storage.addSnapshot('layer-1', makeSnapshot([1, 2, 3, 4], stops));
    storage.addSnapshot('layer-1', makeSnapshot([1, 2, 9, 4], stops));

    const s0 = storage.getSnapshot('layer-1', 0);
    const s1 = storage.getSnapshot('layer-1', 1);

    expect(s0?.gradients[0].gradientStops).toEqual(stops);
    expect(Array.from(new Uint8Array(s0?.layerStrokes[0].paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);

    expect(s1?.gradients[0].gradientStops).toEqual(stops);
    expect(Array.from(new Uint8Array(s1?.layerStrokes[0].paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 2, 9, 4]);

    const stats = storage.getStats();
    expect(stats.gradientPoolStats.uniqueGradients).toBe(1);
    expect(stats.gradientPoolStats.totalReferences).toBe(2);
    expect(stats.totalSnapshots).toBe(2);
  });

  it('clears a layer and releases gradient references', () => {
    const storage = new OptimizedColorCycleStorage();
    const stops = [{ position: 0, color: '#123456' }];
    storage.addSnapshot('layer-1', makeSnapshot([1, 1], stops));
    storage.addSnapshot('layer-1', makeSnapshot([2, 2], stops));

    storage.clearLayer('layer-1');

    const stats = storage.getStats();
    expect(stats.layerCount).toBe(0);
    expect(stats.totalSnapshots).toBe(0);
    expect(stats.gradientPoolStats.totalReferences).toBe(0);
  });
});
