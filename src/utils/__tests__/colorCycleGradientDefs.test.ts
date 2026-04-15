import { ensureGradientDefForStops, hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

describe('colorCycleGradientDefs', () => {
  const baseStops: StoredStop[] = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ];
  const altStops: StoredStop[] = [
    { position: 0, color: '#ff0000' },
    { position: 1, color: '#00ff00' },
  ];

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

  const initialState = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('returns null when no slots are available', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const slotPalettes = Array.from({ length: 255 }, (_, slot) => ({
      slot,
      stops: baseStops,
    }));
    const layer = createLayer({
      colorCycleData: {
        slotPalettes,
        gradientDefs: [],
        gradientDefStore: [],
        nextGradientDefId: 1,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
    });

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });

  it('heals a mismatched slot palette when reusing the same gradient def', () => {
    const defHash = hashStops(baseStops, 'linear');
    const layer = createLayer({
      colorCycleData: {
        slotPalettes: [{ slot: 2, stops: altStops }],
        gradientDefs: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: baseStops,
            hash: defHash,
            source: 'manual',
            createdAtMs: 0,
            slot: 2,
          },
        ],
        nextGradientDefId: 2,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
    });

    expect(result?.slot).toBe(2);
    const healedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(healedLayer?.colorCycleData?.slotPalettes).toEqual([
      { slot: 2, stops: baseStops },
    ]);
  });

  it('does not write back when an existing def and slot palette already match', () => {
    const defHash = hashStops(baseStops, 'linear');
    const layer = createLayer({
      colorCycleData: {
        slotPalettes: [{ slot: 2, stops: baseStops }],
        gradientDefs: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: baseStops,
            hash: defHash,
            source: 'manual',
            createdAtMs: 0,
            slot: 2,
          },
        ],
        nextGradientDefId: 2,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
    const updateSpy = jest.spyOn(useAppStore.getState(), 'updateLayer');

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
    });

    expect(result?.slot).toBe(2);
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it('forwards update options to updateLayer when allocating a new def', () => {
    const layer = createLayer();
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
    const updateSpy = jest.spyOn(useAppStore.getState(), 'updateLayer');

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
      updateOptions: { skipColorCycleSync: true },
    });

    expect(result).not.toBeNull();
    expect(updateSpy).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          gradientDefStore: expect.any(Array),
          slotPalettes: expect.any(Array),
        }),
      }),
      expect.objectContaining({ skipColorCycleSync: true }),
    );
    updateSpy.mockRestore();
  });

  it('rebuilds slots on allocation failure and succeeds', () => {
    const slotPalettes = Array.from({ length: 254 }, (_, slot) => ({
      slot,
      stops: baseStops,
    }));
    const defHash = hashStops(baseStops, 'linear');
    const gradientDefStore = Array.from({ length: 254 }, (_, index) => ({
      id: index + 1,
      kind: 'linear' as const,
      stops: baseStops,
      hash: defHash,
      source: 'manual' as const,
      createdAtMs: 0,
      slot: index,
    }));
    const gradientDefIdBuffer = new Uint16Array([1, 1, 1, 1]).buffer;
    const layer = createLayer({
      colorCycleData: {
        slotPalettes,
        gradientDefs: [],
        gradientDefStore,
        gradientDefIdBuffer,
        nextGradientDefId: 255,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });
    const stateLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(stateLayer?.colorCycleData?.gradientDefStore?.length).toBe(254);
    expect(stateLayer?.colorCycleData?.gradientDefIdBuffer).toBeDefined();

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: altStops,
      source: 'manual',
    });

    expect(result).not.toBeNull();
    const updatedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    const updatedStore = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    const deadDef = updatedStore.find((entry) => entry.id === 2);
    expect(deadDef?.slot).toBeUndefined();
  });

  it('stores seam profile per def and treats soft/hard variants as distinct defs', () => {
    const layer = createLayer();
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const hard = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
      seamProfile: 'hard',
    });
    const soft = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
      seamProfile: 'soft',
    });

    expect(hard?.def.seamProfile).toBe('hard');
    expect(soft?.def.seamProfile).toBe('soft');
    expect(soft?.def.id).not.toBe(hard?.def.id);
  });

  it('can persist a hard default seam profile for new defs', () => {
    const layer = createLayer();
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
      seamProfile: 'hard',
    });

    expect(result?.def.seamProfile).toBe('hard');
  });

  it('forks a new def instead of mutating a legacy speedless def when speed is provided', () => {
    const defHash = hashStops(baseStops, 'linear');
    const layer = createLayer({
      colorCycleData: {
        slotPalettes: [{ slot: 2, stops: baseStops }],
        gradientDefs: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: baseStops,
            hash: defHash,
            source: 'manual',
            createdAtMs: 0,
            slot: 2,
          },
        ],
        nextGradientDefId: 2,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: baseStops,
      source: 'manual',
      speedCps: 0.2,
    });

    expect(result?.def.id).toBe(2);
    expect(result?.def.speedCps).toBe(0.2);

    const updatedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    const updatedStore = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    const legacyDef = updatedStore.find((entry) => entry.id === 1);
    const speededDef = updatedStore.find((entry) => entry.id === 2);

    expect(updatedStore).toHaveLength(2);
    expect(legacyDef?.speedCps).toBeUndefined();
    expect(legacyDef?.slot).toBe(2);
    expect(speededDef?.speedCps).toBe(0.2);
    expect(speededDef?.slot).not.toBe(2);
  });

  it('reuses a free Uint16 def id when nextGradientDefId has overflowed past the storage limit', () => {
    const nearLimitId = 0xffff;
    const layer = createLayer({
      colorCycleData: {
        slotPalettes: [{ slot: 1, stops: baseStops }],
        gradientDefs: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: baseStops,
            hash: hashStops(baseStops, 'linear'),
            source: 'manual',
            createdAtMs: 0,
            slot: 1,
          },
          {
            id: nearLimitId,
            kind: 'linear',
            stops: altStops,
            hash: hashStops(altStops, 'linear'),
            source: 'manual',
            createdAtMs: 0,
            slot: 2,
          },
        ],
        nextGradientDefId: nearLimitId + 1,
      },
    });

    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    const result = ensureGradientDefForStops({
      layerId: layer.id,
      kind: 'linear',
      stops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      source: 'manual',
    });

    expect(result?.def.id).toBe(2);
    const updatedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(updatedLayer?.colorCycleData?.nextGradientDefId).toBe(3);
  });
});
