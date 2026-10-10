jest.mock('@/stores/colorCycleBrushManager', () => ({
  ...jest.requireActual('@/stores/colorCycleBrushManager'),
  getColorCycleBrushManager: () => ({ getDocument: (id: string) => mockDocuments.get(id) }),
}));

import { rebuildGradientSlotUsageAndGC } from '@/utils/colorCycleSlotGC';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { ColorCycleLayerDocument, attachLegacyColorCycleTopLevelBuffers } from '@/lib/colorCycle/document';

const mockDocuments = new Map<string, ColorCycleLayerDocument>();

const createLayer = (overrides?: Partial<Layer>): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    gradientDefs: [],
    slotPalettes: [],
    gradientDefStore: [],
    nextGradientDefId: 1,
  },
  version: 1,
  ...(overrides ?? {}),
});

describe('colorCycleSlotGC', () => {
  beforeEach(() => mockDocuments.clear());
  it('frees dead def slots and assigns slots to used defs without one', () => {
    const stopsA = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const stopsB = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ];
    const stopsC = [
      { position: 0, color: '#0000ff' },
      { position: 1, color: '#ff00ff' },
    ];

    const defIdBuffer = new Uint16Array([1, 1, 3, 0]).buffer;

    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [
          { slot: 1, stops: stopsA },
          { slot: 2, stops: stopsB },
        ],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: stopsA,
            hash: 'linear:a',
            source: 'manual',
            createdAtMs: 0,
            slot: 1,
          },
          {
            id: 2,
            kind: 'linear',
            stops: stopsB,
            hash: 'linear:b',
            source: 'manual',
            createdAtMs: 0,
            slot: 2,
          },
          {
            id: 3,
            kind: 'linear',
            stops: stopsC,
            hash: 'linear:c',
            source: 'manual',
            createdAtMs: 0,
          },
        ],
      }, {
        gradientDefIdBuffer: defIdBuffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
    });

    expect(result).not.toBeNull();
    expect(result?.updates.length).toBe(1);

    const updated = result?.updates[0]?.colorCycleData;
    const updatedDefs = updated?.gradientDefStore ?? [];
    const updatedDef2 = updatedDefs.find((entry) => entry.id === 2);
    const updatedDef3 = updatedDefs.find((entry) => entry.id === 3);

    expect(updatedDef2?.slot).toBeUndefined();
    expect(typeof updatedDef3?.slot).toBe('number');

    const paletteSlots = (updated?.slotPalettes ?? []).map((entry) => entry.slot);
    expect(paletteSlots).not.toContain(2);
  });

  it('respects active session slots when assigning new slots', () => {
    const stops = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];
    const defIdBuffer = new Uint16Array([1, 0, 0, 0]).buffer;
    const gradientDefs = Array.from({ length: 5 }, (_, slot) => ({
      id: `g${slot}`,
      currentSlot: slot,
    }));
    const slotPalettes = Array.from({ length: 5 }, (_, slot) => ({
      slot,
      stops,
    }));
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs,
        slotPalettes,
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops,
            hash: 'linear:one',
            source: 'manual',
            createdAtMs: 0,
          },
          {
            id: 2,
            kind: 'linear',
            stops,
            hash: 'linear:two',
            source: 'manual',
            createdAtMs: 0,
            slot: 5,
          },
        ],
      }, {
        gradientDefIdBuffer: defIdBuffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
      activeSessionSlots: new Set([5]),
    });

    const updated = result?.updates[0]?.colorCycleData;
    const updatedDefs = updated?.gradientDefStore ?? [];
    const usedDef = updatedDefs.find((entry) => entry.id === 1);

    expect(usedDef?.slot).toBeGreaterThan(5);
  });

  it('preserves stop opacity and seam profile when rebuilding a def palette', () => {
    const stops = [
      { position: 0, color: '#111111', opacity: 0.25 },
      { position: 1, color: '#eeeeee', opacity: 0.75 },
    ];
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [{ slot: 4, stops }],
        gradientDefStore: [{
          id: 4,
          kind: 'linear',
          stops,
          hash: 'linear:opacity-soft',
          source: 'manual',
          seamProfile: 'soft',
          createdAtMs: 0,
          slot: 4,
        }],
      }, {
        gradientDefIdBuffer: new Uint16Array([4, 0, 0, 0]).buffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
    });
    const rebuilt = result?.updates[0]?.colorCycleData?.slotPalettes?.find(
      (palette) => palette.slot === 4,
    );

    expect(rebuilt?.stops).toEqual(stops);
    expect(rebuilt?.seamProfile).toBe('soft');
  });

  it('reassigns slots when a dead def is resurrected', () => {
    const stops = [
      { position: 0, color: '#222222' },
      { position: 1, color: '#dddddd' },
    ];
    const baseLayer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops,
            hash: 'linear:resurrect',
            source: 'manual',
            createdAtMs: 0,
            slot: 1,
          },
        ],
      }, {
        gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
      }),
    });

    const first = rebuildGradientSlotUsageAndGC({
      layers: [baseLayer],
      scope: 'layer',
      layerId: baseLayer.id,
    });
    const layerAfterFirst = {
      ...baseLayer,
      colorCycleData: first?.updates[0]?.colorCycleData ?? baseLayer.colorCycleData,
    };

    layerAfterFirst.colorCycleData = attachLegacyColorCycleTopLevelBuffers({
      ...layerAfterFirst.colorCycleData,
    }, {
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
    });
    const cleared = rebuildGradientSlotUsageAndGC({
      layers: [layerAfterFirst],
      scope: 'layer',
      layerId: baseLayer.id,
    });
    const layerAfterClear = {
      ...layerAfterFirst,
      colorCycleData: cleared?.updates[0]?.colorCycleData ?? layerAfterFirst.colorCycleData,
    };

    layerAfterClear.colorCycleData = attachLegacyColorCycleTopLevelBuffers({
      ...layerAfterClear.colorCycleData,
    }, {
      gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
    });
    const resurrect = rebuildGradientSlotUsageAndGC({
      layers: [layerAfterClear],
      scope: 'layer',
      layerId: baseLayer.id,
    });
    const finalDefs = resurrect?.updates[0]?.colorCycleData?.gradientDefStore ?? [];
    const resurrected = finalDefs.find((entry) => entry.id === 1);

    expect(typeof resurrected?.slot).toBe('number');
  });

  it('does not free defs used on another layer in project scope', () => {
    const stops = [
      { position: 0, color: '#123456' },
      { position: 1, color: '#654321' },
    ];
    const sharedDef = {
      id: 7,
      kind: 'linear' as const,
      stops,
      hash: 'linear:shared',
      source: 'manual' as const,
      createdAtMs: 0,
      slot: 7,
    };

    const layerA = createLayer({
      id: 'layer-a',
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [{ slot: 7, stops }],
        gradientDefStore: [sharedDef],
      }, {
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      }),
    });
    const layerB = createLayer({
      id: 'layer-b',
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [{ slot: 7, stops }],
        gradientDefStore: [sharedDef],
      }, {
        gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layerA, layerB],
      scope: 'project',
    });

    const updatedA = result?.updates.find((entry) => entry.layerId === layerA.id)?.colorCycleData ?? layerA.colorCycleData;
    const updatedB = result?.updates.find((entry) => entry.layerId === layerB.id)?.colorCycleData ?? layerB.colorCycleData;
    const defA = updatedA?.gradientDefStore?.find((entry) => entry.id === 7);
    const defB = updatedB?.gradientDefStore?.find((entry) => entry.id === 7);

    expect(defA?.slot).toBe(7);
    expect(defB?.slot).toBe(7);
  });

  it('aborts when missing def ids are found', () => {
    const defIdBuffer = new Uint16Array([42, 0, 0, 0]).buffer;
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [],
      }, {
        gradientDefIdBuffer: defIdBuffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
    });

    expect(result?.updates.length).toBe(0);
    expect(result?.missingDefLayers?.length).toBe(1);
    expect(result?.missingDefLayers?.[0]?.missingDefIds).toContain(42);
  });

  it('prevents noisy fills by healing stale slot palettes for used def-bound gradients', () => {
    const defStops = [
      { position: 0, color: '#000000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1, color: '#ffffff' },
    ];
    const staleStops = [
      { position: 0, color: '#ff00ff' },
      { position: 1, color: '#00ffff' },
    ];
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [{ slot: 7, stops: staleStops }],
        gradientDefStore: [
          {
            id: 7,
            kind: 'linear',
            stops: defStops,
            hash: 'linear:healed',
            source: 'manual',
            createdAtMs: 0,
            slot: 7,
          },
        ],
      }, {
        gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
    });

    const updated = result?.updates[0]?.colorCycleData ?? layer.colorCycleData;
    expect(updated?.slotPalettes).toEqual([{ slot: 7, stops: defStops }]);
  });

  it('keeps slot palettes that are still referenced by non-def gradient ids', () => {
    const liveStops = [
      { position: 0, color: '#101010' },
      { position: 1, color: '#f0f0f0' },
    ];
    const deadStops = [
      { position: 0, color: '#330000' },
      { position: 1, color: '#ff0000' },
    ];
    const layer = createLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        gradientDefs: [],
        slotPalettes: [
          { slot: 89, stops: liveStops },
          { slot: 7, stops: deadStops },
        ],
        gradientDefStore: [
          {
            id: 7,
            kind: 'linear',
            stops: deadStops,
            hash: 'linear:dead',
            source: 'manual',
            createdAtMs: 0,
            slot: 7,
          },
        ],
      }, {
        gradientIdBuffer: new Uint8Array([89, 89, 0, 0]).buffer,
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      }),
    });

    const result = rebuildGradientSlotUsageAndGC({
      layers: [layer],
      scope: 'layer',
      layerId: layer.id,
    });

    const updated = result?.updates[0]?.colorCycleData;
    const paletteSlots = (updated?.slotPalettes ?? []).map((entry) => entry.slot);
    const deadDef = updated?.gradientDefStore?.find((entry) => entry.id === 7);

    expect(deadDef?.slot).toBeUndefined();
    expect(paletteSlots).toContain(89);
    expect(paletteSlots).not.toContain(7);
  });
});


describe('canonical slot usage authority', () => {
  const stops = [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }];
  const fixture = () => createLayer({ colorCycleData: {
    gradientDefs: [],
    gradientDefStore: [1, 2].map(id => ({ id, slot: id, kind: 'linear', stops, hash: `def-${id}`, source: 'manual', createdAtMs: 0 })),
    slotPalettes: [1, 2].map(slot => ({ slot, stops })),
  } });
  const canonical = (layer: Layer, ids: number[], slots: number[]) => {
    mockDocuments.set(layer.id, new ColorCycleLayerDocument({
      layerId: layer.id, width: 2, height: 1,
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientDefIdBuffer: new Uint16Array(ids).buffer,
      gradientIdBuffer: new Uint8Array(slots).buffer,
      hasContent: true,
      sources: { brushStateSnapshot: false, topLevelBuffers: false, legacyStateRefs: false },
    }));
  };
  const rebuild = (layer: Layer) => rebuildGradientSlotUsageAndGC({
    layers: [layer], scope: 'layer', layerId: layer.id,
  })?.updates[0]?.colorCycleData ?? layer.colorCycleData;

  beforeEach(() => mockDocuments.clear());

  it('keeps canonical live bindings with absent mirrors and releases only unused definitions', () => {
    const layer = fixture();
    canonical(layer, [2, 2], [2, 2]);
    const result = rebuild(layer);
    expect(result?.gradientDefStore?.find(d => d.id === 2)?.slot).toBe(2);
    expect(result?.slotPalettes).toContainEqual({ slot: 2, stops });
    expect(result?.gradientDefStore?.find(d => d.id === 1)?.slot).toBeUndefined();
    expect(layer.colorCycleData?.gradientDefStore?.[0].slot).toBe(1);
  });

  it('uses canonical empty usage instead of stale occupied legacy mirrors', () => {
    const layer = fixture();
    layer.colorCycleData = attachLegacyColorCycleTopLevelBuffers(layer.colorCycleData!, {
      gradientDefIdBuffer: new Uint16Array([2, 2]).buffer,
      gradientIdBuffer: new Uint8Array([2, 2]).buffer,
    });
    canonical(layer, [0, 0], [0, 0]);
    expect(rebuild(layer)?.gradientDefStore?.every(d => d.slot === undefined)).toBe(true);
  });

  it('protects non-definition canonical slots from palette deletion', () => {
    const layer = fixture();
    canonical(layer, [0, 0], [2, 2]);
    const result = rebuild(layer);
    expect(result?.gradientDefStore?.find(d => d.id === 2)?.slot).toBeUndefined();
    expect(result?.slotPalettes).toContainEqual({ slot: 2, stops });
  });

  it('does not treat unknown usage as empty', () => {
    const layer = fixture();
    expect(rebuild(layer)).toBe(layer.colorCycleData);
  });

  it('retains project bindings that may still be used by an unknown owner', () => {
    const resident = fixture();
    const unknown = { ...fixture(), id: 'unknown-owner' };
    canonical(resident, [0, 0], [0, 0]);
    const result = rebuildGradientSlotUsageAndGC({ layers: [resident, unknown], scope: 'project' });
    expect(result?.updates).toEqual([]);
  });

  it('does not fall back to stale mirrors for a cold canonical document', () => {
    const layer = fixture();
    layer.colorCycleData = attachLegacyColorCycleTopLevelBuffers(layer.colorCycleData!, {
      gradientDefIdBuffer: new Uint16Array([0, 0]).buffer,
    });
    mockDocuments.set(layer.id, new ColorCycleLayerDocument({
      layerId: layer.id, width: 2, height: 1, hasContent: true,
      sources: { brushStateSnapshot: false, topLevelBuffers: false, legacyStateRefs: false },
    }, { residency: 'cold-archive-ref', archiveRefs: { paintRef: 'paint' } }));
    expect(rebuild(layer)).toBe(layer.colorCycleData);
  });
});
