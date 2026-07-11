import {
  applyMergedColorCycleMetadata,
  consolidateCcLayerNamespaces,
  mergeColorCycleMetadata,
  type CcPackingLayerInput,
} from '@/lib/colorCycle/shapePacking';

const layer = (layerId: string): CcPackingLayerInput => ({
  layerId,
  width: 1,
  height: 1,
  channels: {
    paint: Uint8Array.of(1),
    gradientId: Uint8Array.of(2),
    gradientDefId: Uint16Array.of(10),
    speed: Uint8Array.of(1),
    flow: Uint8Array.of(1),
    phase: Uint8Array.of(1),
  },
});

describe('CC consolidation metadata', () => {
  it('clears stale destination metadata when the merged namespace is empty', () => {
    const target: Record<string, unknown> = {
      slotPalettes: [{ slot: 7 }],
      slotSpeeds: [{ slot: 7, speed: 1 }],
      gradientDefStore: [{ id: 9, slot: 7 }],
      nextGradientDefId: 10,
    };

    applyMergedColorCycleMetadata(target, {
      slotPalettes: [],
      slotSpeeds: [],
      gradientDefStore: [],
      nextGradientDefId: 1,
    });

    expect(target).toEqual({
      slotPalettes: [],
    });
  });

  it('preserves palette and speed metadata for an occupied source slot zero', () => {
    const source = layer('zero');
    source.channels.gradientId[0] = 0;
    const consolidated = consolidateCcLayerNamespaces([source]);

    const merged = mergeColorCycleMetadata([{
      layerId: 'zero',
      metadata: {
        slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#123456' }] }],
        slotSpeeds: [{ slot: 0, speed: 0.25 }],
        gradientDefStore: [{ id: 10, slot: 0, stops: [], source: 'sampled' }],
      },
    }], consolidated.remap);

    expect(consolidated.remap.gradientIdByLayerId.get('zero')?.get(0)).toBe(1);
    expect(merged.slotPalettes).toEqual([
      { slot: 1, stops: [{ position: 0, color: '#123456' }] },
    ]);
    expect(merged.slotSpeeds).toEqual([{ slot: 1, speed: 0.25 }]);
    expect(merged.gradientDefStore).toEqual([
      { id: 1, slot: 1, stops: [], source: 'sampled' },
    ]);
  });

  it('remaps colliding source slots and definition IDs into one metadata namespace', () => {
    const consolidated = consolidateCcLayerNamespaces([layer('a'), layer('b')]);

    const merged = mergeColorCycleMetadata([
      {
        layerId: 'a',
        metadata: {
          slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#111111' }] }],
          slotSpeeds: [{ slot: 2, speed: 0.1 }],
          gradientDefStore: [{ id: 10, slot: 2, stops: [], source: 'sampled' }],
        },
      },
      {
        layerId: 'b',
        metadata: {
          slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#eeeeee' }] }],
          slotSpeeds: [{ slot: 2, speed: 0.2 }],
          gradientDefStore: [{ id: 10, slot: 2, stops: [], source: 'sampled' }],
        },
      },
    ], consolidated.remap);

    expect(merged.slotPalettes.map((entry) => entry.slot)).toEqual([1, 2]);
    expect(merged.slotSpeeds).toEqual([{ slot: 1, speed: 0.1 }, { slot: 2, speed: 0.2 }]);
    expect(merged.gradientDefStore.map((entry) => ({ id: entry.id, slot: entry.slot }))).toEqual([
      { id: 1, slot: 1 },
      { id: 2, slot: 2 },
    ]);
    expect(merged.nextGradientDefId).toBe(3);
  });
});
