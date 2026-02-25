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

  it('throws when a slot palette exists with mismatched stops', () => {
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

    expect(() =>
      ensureGradientDefForStops({
        layerId: layer.id,
        kind: 'linear',
        stops: baseStops,
        source: 'manual',
      })
    ).toThrow(/Slot overwrite blocked/);
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
});
