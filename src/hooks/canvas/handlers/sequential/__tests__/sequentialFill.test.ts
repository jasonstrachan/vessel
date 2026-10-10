import { setFeatureFlag } from '@/config/featureFlags';
import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { runFillToolPointerDown } from '@/hooks/canvas/handlers/fillTool';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import { clearSequentialLayerRendererAll, getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type Project, type SequentialStrokeEvent } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const WIDTH = 6;
const HEIGHT = 4;

const render = (frameIndex: number): Uint8ClampedArray => {
  const layer = useAppStore.getState().layers[0];
  const canvas = getSequentialLayerRenderCanvas({
    layer, width: WIDTH, height: HEIGHT, frameIndex, holdPreviousOnEmptyFrames: false,
  });
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx || !('getImageData' in ctx)) throw new Error('Missing actual sequence presentation');
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data.slice();
};

const dispatch = (): void => {
  const state = useAppStore.getState();
  const dynamic = { ...state, canvas: state.canvas } as unknown as EventHandlerDynamicDeps;
  const deps = {
    updateLayer: state.updateLayer,
    compositeCanvasDirtyRef: { current: false },
    compositeCanvasRef: { current: null },
  } as unknown as EventHandlerDependencies;
  runFillToolPointerDown({ deps, dynamic, worldPos: { x: 0, y: 0 } });
};

describe('Fill dispatch to canonical sequence events', () => {
  beforeEach(() => {
    historyManager.clear();
    clearSequentialLayerRendererAll();
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    const makeEvent = (frameIndex: number, color: string): SequentialStrokeEvent => ({
      id: `base-${frameIndex}`, layerId: 'sequence-fill', strokeId: `base-${frameIndex}`,
      timestampMs: 0, frameIndex,
      brush: {
        tool: 'brush', brushShape: BrushShape.SQUARE, size: 6, opacity: 1,
        blendMode: 'source-over', rotation: 0, spacing: 1, color,
      },
      stamps: [{ x: 3, y: 2, pressure: 1, rotation: 0, size: 6, alpha: 1 }],
    });
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const layer: Layer = {
      id: 'sequence-fill', name: 'Sequence', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: null, framebuffer,
      alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 3, fps: 12, durationMs: 250, events: [makeEvent(0, '#112233'), makeEvent(1, '#334455')] },
    };
    useAppStore.setState((state) => ({
      layers: [layer], activeLayerId: layer.id,
      project: { ...state.project, id: 'fill-test', width: WIDTH, height: HEIGHT, layers: [layer] } as Project,
      selectionStart: { x: 1, y: 1 }, selectionEnd: { x: 5, y: 3 },
      selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null,
      palette: { ...state.palette, activeSlot: 'foreground', foregroundColor: 'rgba(255, 0, 0, 0.2)', backgroundColor: '#00ff00' },
      tools: { ...state.tools, currentTool: 'fill', fillSettings: { threshold: 255, contiguous: false, eraseInstead: false } },
      sequentialRecord: { ...state.sequentialRecord, currentFrame: 1, isPointerDown: false },
      colorCyclePlayback: { ...state.colorCyclePlayback, desiredPlaying: false },
    }));
  });

  afterEach(async () => {
    await waitForPendingHistoryCommits();
    clearSequentialLayerRendererAll();
    historyManager.clear();
  });

  it.each(['foreground', 'background', 'erase'] as const)('edits only selected current-frame pixels with %s and replays exactly', async (mode) => {
    useAppStore.setState((state) => ({
      palette: { ...state.palette, activeSlot: mode === 'background' ? 'background' : 'foreground' },
      tools: { ...state.tools, fillSettings: { ...state.tools.fillSettings, eraseInstead: mode === 'erase' } },
    }));
    const before = render(1);
    const unrelatedFrame = render(0);
    const originalEvents = JSON.stringify(useAppStore.getState().layers[0].sequentialData?.events);
    dispatch();
    await waitForPendingHistoryCommits();
    expect(useAppStore.getState().layers[0].sequentialData?.events).toHaveLength(3);
    const expected = before.slice();
    const fill = mode === 'erase' ? [0, 0, 0, 0] : mode === 'background' ? [0, 255, 0, 255] : [255, 0, 0, 255];
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 5; x += 1) expected.set(fill, (y * WIDTH + x) * 4);
    }
    expect(render(1)).toEqual(expected);
    expect(render(0)).toEqual(unrelatedFrame);
    expect(render(2)).toEqual(new Uint8ClampedArray(WIDTH * HEIGHT * 4));
    expect(useAppStore.getState().layers[0].imageData).toBeNull();
    expect([useAppStore.getState().layers[0].framebuffer?.width, useAppStore.getState().layers[0].framebuffer?.height]).toEqual([1, 1]);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.entries()[0].deltas.some((delta) => delta._tag === 'sequential-frame-append')).toBe(true);
    await useAppStore.getState().undo();
    expect(JSON.stringify(useAppStore.getState().layers[0].sequentialData?.events)).toBe(originalEvents);
    expect(render(1)).toEqual(before);
    await useAppStore.getState().redo();
    expect(render(1)).toEqual(expected);
    expect(render(0)).toEqual(unrelatedFrame);
  });

  it('uses binary cross-layer mask membership and leaves holes exact', async () => {
    const mask = new ImageData(4, 2);
    for (let index = 3; index < mask.data.length; index += 4) mask.data[index] = 80;
    mask.data[(1 * 4 + 2) * 4 + 3] = 0;
    useAppStore.setState({ selectionMask: mask, selectionMaskBounds: { x: 1, y: 1, width: 4, height: 2 }, selectionMaskLayerId: 'different-layer' });
    const before = render(1);
    dispatch();
    await waitForPendingHistoryCommits();
    const expected = before.slice();
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 5; x += 1) {
        if (x === 3 && y === 2) continue;
        expected.set([255, 0, 0, 255], (y * WIDTH + x) * 4);
      }
    }
    expect(render(1)).toEqual(expected);
    expect(useAppStore.getState().selectionMask).toBe(mask);
  });

  it('does not append events or history for an unchanged selected fill', async () => {
    useAppStore.setState((state) => ({ palette: { ...state.palette, foregroundColor: '#334455' } }));
    dispatch();
    await waitForPendingHistoryCommits();
    expect(useAppStore.getState().layers[0].sequentialData?.events).toHaveLength(2);
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().layers[0].imageData).toBeNull();
  });

  it('uses the materialized frame for unrestricted flood fill', async () => {
    useAppStore.setState({ selectionStart: null, selectionEnd: null });
    dispatch();
    await waitForPendingHistoryCommits();
    expect(render(1)).toEqual(new Uint8ClampedArray(Array.from({ length: WIDTH * HEIGHT }, () => [255, 0, 0, 255]).flat()));
    expect(render(0)[0]).toBe(17);
  });

  it('keeps distinct masks with a collided legacy 32-bit hash exact through Fill and replay', async () => {
    useAppStore.setState((state) => ({
      project: { ...state.project, width: 8 } as Project,
      selectionStart: { x: 0, y: 0 }, selectionEnd: { x: 8, y: 4 },
    }));
    const renderWide = () => {
      const canvas = getSequentialLayerRenderCanvas({
        layer: useAppStore.getState().layers[0], width: 8, height: 4, frameIndex: 1,
        holdPreviousOnEmptyFrames: false,
      });
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (!ctx || !('getImageData' in ctx)) throw new Error('Missing collision fixture presentation');
      return ctx.getImageData(0, 0, 8, 4).data.slice();
    };
    const before = renderWide();
    const legacyHashes: number[] = [];
    for (const bits of [0x4b8aeaa5, 0x13858ff1]) {
      const mask = new ImageData(8, 4);
      const expected = before.slice();
      const payload = new Uint8Array(8 * 4 * 4);
      for (let index = 0; index < 32; index += 1) {
        if ((bits >>> index & 1) === 0) continue;
        mask.data[index * 4 + 3] = 80;
        expected.set([255, 0, 0, 255], index * 4);
        payload.set([255, 0, 0, 255], index * 4);
      }
      let legacyHash = 0x811c9dc5;
      for (const byte of payload) legacyHash = Math.imul(legacyHash ^ byte, 0x01000193) >>> 0;
      legacyHashes.push(legacyHash);
      useAppStore.setState({ selectionMask: mask, selectionMaskBounds: { x: 0, y: 0, width: 8, height: 4 } });
      dispatch();
      await waitForPendingHistoryCommits();
      expect(useAppStore.getState().layers[0].sequentialData?.events.at(-1)?.brush.customStampHash).toBeUndefined();
      expect(renderWide()).toEqual(expected);
      await useAppStore.getState().undo();
      expect(renderWide()).toEqual(before);
      await useAppStore.getState().redo();
      expect(renderWide()).toEqual(expected);
      await useAppStore.getState().undo();
      expect(renderWide()).toEqual(before);
    }
    expect(legacyHashes).toEqual([0xa7fccfc5, 0xa7fccfc5]);
  });
});
