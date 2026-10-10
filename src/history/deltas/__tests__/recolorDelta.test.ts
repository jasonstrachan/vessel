import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { cloneRecolorSettings, createRecolorDelta } from '@/history/deltas/recolorDelta';
import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleRecolorSettings, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const makeSettings = (width: number, tick: number): ColorCycleRecolorSettings => ({
  quantizationMode: 'oklab-median-cut',
  ditherMode: 'bayer4',
  animation: { speed: 0.3, fps: 30, ticksPerFrame: 0.4, isPlaying: false, currentTick: tick, flowDirection: 'reverse' },
  cycleColors: 16,
  gradient: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
  currentLOD: 'full',
  originalImageData: new ImageData(new Uint8ClampedArray(width * 4).fill(63), width, 1),
  indexBuffer: new Uint8Array(width).fill(2),
  palette: new Uint32Array([0, 0xff123456, 0xffabcdef]),
  phaseMap: new Uint8Array(width).fill(3),
  indexPhaseMap: new Uint8Array([0, 4, 7]),
  colorMap: new Map([[0x123456, 1]]),
});

describe('RecolorDelta', () => {
  beforeEach(() => {
    const layer: Layer = {
      id: 'recolor', name: 'Recolor', layerType: 'color-cycle', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: new ImageData(3, 1),
      framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
      colorCycleData: { mode: 'recolor', recolorSettings: makeSettings(3, 7.25) },
    };
    useAppStore.setState({ layers: [layer], layersNeedRecomposition: false });
  });

  it('deeply isolates captured and replayed source, arrays, maps and metadata', async () => {
    const before = makeSettings(3, 7.25);
    const after = makeSettings(2, 7.25);
    const expectedBefore = cloneRecolorSettings(before);
    const expectedAfter = cloneRecolorSettings(after);
    const delta = createRecolorDelta({ layerId: 'recolor', before, after })!;
    before.originalImageData!.data.fill(0);
    after.indexBuffer!.fill(99);
    after.palette!.fill(99);
    after.phaseMap!.fill(99);
    after.indexPhaseMap!.fill(99);
    after.colorMap!.clear();
    after.gradient[0].color = '#000000';
    after.animation.currentTick = 0;
    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(expectedAfter);
    useAppStore.getState().layers[0].colorCycleData!.recolorSettings!.indexBuffer!.fill(18);
    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(expectedBefore);
    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(expectedAfter);
    const targets = createRehydrationTargets();
    delta.collectRehydrationTargets!(targets);
    expect([...targets.layerIds]).toEqual(['recolor']);
    expect([...targets.colorCycleLayerIds]).toEqual(['recolor']);
  });

  it('compensates to actual pre-replay references and dirty state', async () => {
    const before = useAppStore.getState();
    const delta = createRecolorDelta({ layerId: 'recolor', before: makeSettings(3, 7), after: makeSettings(2, 8) })!;
    const prepared = await delta.prepare!('forward');
    await prepared.apply();
    expect(prepared.requiresCompensation()).toBe(true);
    await prepared.compensate();
    expect(useAppStore.getState().layers).toBe(before.layers);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(false);
  });

  it('preserves missing settings and avoids empty deltas', async () => {
    expect(createRecolorDelta({ layerId: 'recolor', before: undefined, after: undefined })).toBeNull();
    const delta = createRecolorDelta({ layerId: 'recolor', before: undefined, after: makeSettings(2, 3) })!;
    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toBeUndefined();
    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(makeSettings(2, 3));
  });
});
