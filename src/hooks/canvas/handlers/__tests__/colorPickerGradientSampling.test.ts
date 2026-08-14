import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document';
import type { Layer } from '@/types';

import {
  createColorPickerGradientSampleController,
  resolvePickedColorCycleGradientFromSnapshot,
} from '../colorPickerGradientSampling';

const makeSnapshot = (
  overrides: Partial<ColorCycleLayerDocumentSnapshot> = {},
): ColorCycleLayerDocumentSnapshot => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: Uint8Array.from([1, 1, 0, 0]).buffer,
  gradientIdBuffer: Uint8Array.from([4, 7, 0, 0]).buffer,
  gradientDefIdBuffer: Uint16Array.from([12, 0, 0, 0]).buffer,
  slotPalettes: [{
    slot: 7,
    stops: [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff', opacity: 0.5 },
    ],
    seamProfile: 'hard',
  }],
  gradientDefs: [],
  gradientDefStore: [{
    id: 12,
    kind: 'linear',
    stops: [
      { position: 0, color: '#ff0000' },
      { position: 0.4, color: '#00ff00', opacity: 0.75 },
      { position: 1, color: '#0000ff' },
    ],
    hash: 'picked-definition',
    source: 'sampled',
    seamProfile: 'soft',
    createdAtMs: 1,
    slot: 4,
  }],
  hasContent: true,
  sources: {
    brushStateSnapshot: true,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
  ...overrides,
});

describe('color picker CC gradient sampling', () => {
  it('resolves and clones the complete definition bound to the clicked pixel', () => {
    const snapshot = makeSnapshot();
    const picked = resolvePickedColorCycleGradientFromSnapshot({ snapshot, x: 0.9, y: 0.2 });

    expect(picked).toEqual({
      stops: snapshot.gradientDefStore?.[0]?.stops,
      runtimeStops: snapshot.gradientDefStore?.[0]?.stops,
      seamProfile: 'soft',
    });
    expect(picked?.stops).not.toBe(snapshot.gradientDefStore?.[0]?.stops);
    expect(picked?.stops[1]).not.toBe(snapshot.gradientDefStore?.[0]?.stops[1]);
  });

  it('falls back to the painted pixel slot palette for legacy unbound CC pixels', () => {
    const snapshot = makeSnapshot();
    expect(resolvePickedColorCycleGradientFromSnapshot({ snapshot, x: 1, y: 0 })).toEqual({
      stops: snapshot.slotPalettes?.[0]?.stops,
      runtimeStops: snapshot.slotPalettes?.[0]?.stops,
      seamProfile: 'hard',
    });
  });

  it('prefers authored source stops when the definition retains them', () => {
    const sourceStops = [
      { position: 0, color: '#123456' },
      { position: 1, color: '#abcdef', opacity: 0.4 },
    ];
    const snapshot = makeSnapshot({
      gradientDefStore: [{
        ...makeSnapshot().gradientDefStore![0],
        sourceStops,
      }],
    });

    expect(resolvePickedColorCycleGradientFromSnapshot({ snapshot, x: 0, y: 0 })).toEqual({
      stops: sourceStops,
      runtimeStops: snapshot.gradientDefStore?.[0]?.stops,
      seamProfile: 'soft',
    });
  });

  it('does not pick from transparent, out-of-bounds, or malformed buffer positions', () => {
    const snapshot = makeSnapshot();

    expect(resolvePickedColorCycleGradientFromSnapshot({ snapshot, x: 0, y: 1 })).toBeNull();
    expect(resolvePickedColorCycleGradientFromSnapshot({ snapshot, x: 2, y: 0 })).toBeNull();
    expect(resolvePickedColorCycleGradientFromSnapshot({
      snapshot: makeSnapshot({ gradientDefIdBuffer: new ArrayBuffer(1) }),
      x: 0,
      y: 0,
    })).toBeNull();
  });

  it('hydrates a cold active CC layer before retrying the complete gradient pick', async () => {
    const pickedGradient = {
      stops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
      runtimeStops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
      seamProfile: 'soft' as const,
    };
    const layer = {
      id: 'cold-cc',
      layerType: 'color-cycle',
      colorCycleData: {
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
      },
    } as Layer;
    const ensureColorCycleLayerRuntime = jest.fn(async () => true);
    const resolveGradient = jest.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(pickedGradient);
    const rememberGradient = jest.fn();
    const sampleRegularColor = jest.fn();
    const controller = createColorPickerGradientSampleController({
      getSourceState: () => ({
        activeLayerId: layer.id,
        currentTool: 'color-picker',
        layers: [layer],
      }),
      ensureColorCycleLayerRuntime,
      resolveGradient,
      rememberGradient,
      sampleRegularColor,
    });

    controller.sample({ x: 4, y: 8 });
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith(layer.id);
    expect(resolveGradient).toHaveBeenLastCalledWith(layer.id, 4, 8);
    expect(rememberGradient).toHaveBeenCalledWith(pickedGradient);
    expect(sampleRegularColor).not.toHaveBeenCalled();
  });

  it('ignores a cold-layer completion after the active source changes', async () => {
    let finishHydration: (ready: boolean) => void = () => {};
    const hydration = new Promise<boolean>((resolve) => {
      finishHydration = resolve;
    });
    const layer = {
      id: 'cold-cc',
      layerType: 'color-cycle',
      colorCycleData: {
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
      },
    } as Layer;
    let activeLayerId: string | null = layer.id;
    const rememberGradient = jest.fn();
    const sampleRegularColor = jest.fn();
    const controller = createColorPickerGradientSampleController({
      getSourceState: () => ({
        activeLayerId,
        currentTool: 'color-picker',
        layers: [layer],
      }),
      ensureColorCycleLayerRuntime: jest.fn(() => hydration),
      resolveGradient: jest.fn(() => null),
      rememberGradient,
      sampleRegularColor,
    });

    controller.sample({ x: 2, y: 3 });
    activeLayerId = 'another-layer';
    finishHydration(true);
    await hydration;
    await Promise.resolve();

    expect(rememberGradient).not.toHaveBeenCalled();
    expect(sampleRegularColor).not.toHaveBeenCalled();
  });
});
