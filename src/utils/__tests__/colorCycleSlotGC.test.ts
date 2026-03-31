import { rebuildGradientSlotUsageAndGC } from '@/utils/colorCycleSlotGC';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

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
      colorCycleData: {
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
        gradientDefIdBuffer: defIdBuffer,
      },
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
      colorCycleData: {
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
        gradientDefIdBuffer: defIdBuffer,
      },
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

  it('reassigns slots when a dead def is resurrected', () => {
    const stops = [
      { position: 0, color: '#222222' },
      { position: 1, color: '#dddddd' },
    ];
    const baseLayer = createLayer({
      colorCycleData: {
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
        gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
      },
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

    layerAfterFirst.colorCycleData = {
      ...layerAfterFirst.colorCycleData,
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
    };
    const cleared = rebuildGradientSlotUsageAndGC({
      layers: [layerAfterFirst],
      scope: 'layer',
      layerId: baseLayer.id,
    });
    const layerAfterClear = {
      ...layerAfterFirst,
      colorCycleData: cleared?.updates[0]?.colorCycleData ?? layerAfterFirst.colorCycleData,
    };

    layerAfterClear.colorCycleData = {
      ...layerAfterClear.colorCycleData,
      gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
    };
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
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [{ slot: 7, stops }],
        gradientDefStore: [sharedDef],
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      },
    });
    const layerB = createLayer({
      id: 'layer-b',
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [{ slot: 7, stops }],
        gradientDefStore: [sharedDef],
        gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
      },
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
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [],
        gradientDefIdBuffer: defIdBuffer,
      },
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
      colorCycleData: {
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
        gradientIdBuffer: new Uint8Array([89, 89, 0, 0]).buffer,
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      },
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
