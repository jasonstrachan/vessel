import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { cloneRecolorSettings, createRecolorDelta, createRecolorGradientDelta, createRecolorControlDelta, createRecolorFPSDelta } from '@/history/deltas/recolorDelta';
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


describe('Recolor gradient history', () => {
  it('captures only gradient metadata and preserves all live source buffers on repeated replay', async () => {
    const settings = makeSettings(1024, 7.25);
    const layer: Layer = {
      id: 'gradient', name: 'Gradient', layerType: 'color-cycle', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: new ImageData(1024, 1),
      framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
      colorCycleData: { mode: 'recolor', recolorSettings: settings },
    };
    useAppStore.setState({ layers: [layer] });
    const before = [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }];
    const after = [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }];
    const delta = createRecolorGradientDelta({ layerId: layer.id, before, after })!;
    const expectedBefore = before.map((stop) => ({ ...stop }));
    const expectedAfter = after.map((stop) => ({ ...stop }));
    before[0].color = '#000000';
    after[1].color = '#ffffff';
    expect(delta.approxBytes).toBeLessThan(1024);

    for (let i = 0; i < 2; i += 1) {
      await replayDeltaForTest(delta, 'forward');
      let current = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
      expect(current.gradient).toEqual(expectedAfter);
      for (const key of ['originalImageData', 'indexBuffer', 'palette', 'phaseMap', 'indexPhaseMap', 'colorMap', 'animation'] as const) {
        expect(current[key]).toBe(settings[key]);
      }
      current.gradient[0].color = '#00ff00';
      await replayDeltaForTest(delta, 'backward');
      current = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
      expect(current.gradient).toEqual(expectedBefore);
      expect(current.indexBuffer).toBe(settings.indexBuffer);
    }
    const targets = createRehydrationTargets();
    delta.collectRehydrationTargets!(targets);
    expect([...targets.colorCycleLayerIds]).toEqual([layer.id]);
  });

  it('does not record an unchanged gradient', () => {
    const stops = [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }];
    expect(createRecolorGradientDelta({ layerId: 'gradient', before: stops, after: stops.map((stop) => ({ ...stop })) })).toBeNull();
  });
});


describe('bounded Recolor control metadata', () => {
  it('isolates control endpoints and merges only owned fields while preserving live source and clock', async () => {
    const settings = makeSettings(1024, 7.25);
    const layer: Layer = {
      id: 'controls', name: 'Controls', layerType: 'color-cycle', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: new ImageData(1024, 1),
      framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
      colorCycleData: { mode: 'recolor', recolorSettings: settings },
    };
    useAppStore.setState({ layers: [layer] });
    const before = { speed: 0.3, ticksPerFrame: 0.4 }, after = { speed: 0.7, ticksPerFrame: 0.8 };
    const delta = createRecolorControlDelta({ layerId: layer.id, before, after })!;
    before.speed = 99; after.speed = 99;
    expect(delta.approxBytes).toBe(128);
    expect(JSON.stringify(delta)).not.toContain('indexBuffer');
    for (const direction of ['forward', 'backward', 'forward'] as const) {
      await replayDeltaForTest(delta, direction);
      const current = useAppStore.getState().layers[0].colorCycleData!.recolorSettings!;
      expect(current.animation.speed).toBe(direction === 'forward' ? 0.7 : 0.3);
      expect(current.animation.currentTick).toBe(7.25);
      expect(current.animation.flowDirection).toBe(settings.animation.flowDirection);
      for (const key of ['originalImageData', 'indexBuffer', 'palette', 'colorMap', 'phaseMap', 'indexPhaseMap', 'gradient'] as const) expect(current[key]).toBe(settings[key]);
    }
    expect(createRecolorControlDelta({ layerId: layer.id, before: { speed: 0.3 }, after: { speed: 0.3 } })).toBeNull();
  });

  it('retains global FPS scalars proportional to layer count rather than source size', () => {
    const before = { fps: 60, layers: [{ id: 'a', fps: 60, ticksPerFrame: 0.1 }, { id: 'b', fps: 30, ticksPerFrame: 0.2 }] };
    const after = { fps: 15, layers: [{ id: 'a', fps: 15, ticksPerFrame: 0.4 }, { id: 'b', fps: 15, ticksPerFrame: 0.4 }] };
    const delta = createRecolorFPSDelta({ before, after })!;
    before.layers[0].fps = 99; after.layers[1].ticksPerFrame = 99;
    expect(delta.approxBytes).toBe(224);
    expect(JSON.stringify(delta)).not.toContain('99');
    expect(JSON.stringify(delta)).not.toContain('indexBuffer');
    expect(createRecolorFPSDelta({ before, after: before })).toBeNull();
  });
});
