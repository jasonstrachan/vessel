import { renderHook } from '@testing-library/react';

import { resolveFinalizeEntryContext } from '@/hooks/canvas/handlers/finalizeEntryContext';
import { useDrawingPlaybackOverlayEffects } from '@/hooks/canvas/useDrawingPlaybackOverlayEffects';
import { setFeatureFlag } from '@/config/featureFlags';
import historyManager from '@/history/historyService';
import { commitStrokeHistoryIfNeeded } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import {
  __TESTING__,
  captureSequentialStampsForActiveLayer,
  flushBufferedSequentialEvents,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type SequentialLayerData } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const data = (): SequentialLayerData => useAppStore.getState().layers[0].sequentialData!;
const clone = (): SequentialLayerData => JSON.parse(JSON.stringify(data())) as SequentialLayerData;
const render = (snapshot: SequentialLayerData, frameIndex = 0): Uint8ClampedArray => new SequentialCpuMaterializer().materializeRect({
  frameIndex,
  width: 64,
  height: 32,
  events: snapshot.events,
  rect: { x: 0, y: 0, width: 64, height: 32 },
}).tiles[0]?.data ?? new Uint8ClampedArray(64 * 32 * 4);
const stamp = (x: number) => ({ x, y: 16, pressure: 1, rotation: 0, size: 4, alpha: 1 });
const capture = (x: number, nowMs: number): void => {
  expect(captureSequentialStampsForActiveLayer({ state: useAppStore.getState(), nowMs, stamps: [stamp(x)] })).toBe(1);
};
const commit = () => commitStrokeHistoryIfNeeded({
  shouldCommit: true,
  activeLayerId: 'sequence-history',
  layerBeforeImage: null,
  layerBeforeColorState: null,
  actionType: 'brush',
  description: 'Buffered Sequence stroke',
  tool: 'brush',
  shouldSkipBitmapDelta: true,
  isColorCycleLayer: false,
  isColorCycleBrush: false,
  deferredLayerCanvas: null,
}, {
  scheduleDeferredColorCycleSave: jest.fn(async () => {}),
  scheduleHistoryCommit: jest.fn(async () => {}),
  captureColorCycleBrushState: jest.fn(() => null),
  perfMark: jest.fn(),
  perfMeasure: jest.fn(),
  debugTime: jest.fn(),
  debugTimeEnd: jest.fn(),
  debugVerbose: jest.fn(),
});

describe('Sequence stroke history with the real capture queue', () => {
  beforeEach(() => {
    historyManager.clear();
    __TESTING__.resetDefaultRuntime();
    setFeatureFlag('enableSequentialRecordMode', true);
    setFeatureFlag('enableSequentialTemporalDistribution', true);
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 8, nextFps: 1 });
    const layer: Layer = {
      id: 'sequence-history', name: 'Sequence', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: null,
      framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(),
      layerType: 'sequential', sequentialData: { frameCount: 8, fps: 1, durationMs: 8000, events: [] },
    };
    layer.framebuffer!.width = 1;
    layer.framebuffer!.height = 1;
    useAppStore.setState(state => ({
      layers: [layer], activeLayerId: layer.id,
      project: state.project ? { ...state.project, width: 64, height: 32, layers: [layer] } : state.project,
      selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null,
      colorCyclePlayback: { ...state.colorCyclePlayback, desiredPlaying: false },
      sequentialRecord: {
        ...state.sequentialRecord, fps: 1, frameCount: 8, durationMs: 8000,
        currentFrame: 0, isPointerDown: true, recordArmed: true, isCaptureActive: true,
        sessionStartMs: 1000, temporalSpreadFrames: 1, trailFalloff: 0, burstFrames: 1, gapFrames: 0,
      },
      tools: {
        ...state.tools, currentTool: 'brush',
        brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE,
          color: '#ff0000', size: 4, opacity: 1, spacing: 1, blendMode: 'source-over', ditherEnabled: false },
      },
    }));
    capture(4, 1001);
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    useAppStore.setState(state => ({ sequentialRecord: { ...state.sequentialRecord, sessionStartMs: 2000 } }));
  });

  afterEach(() => {
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    __TESTING__.resetDefaultRuntime();
    historyManager.clear();
  });

  it.each([false, true])('captures every buffered event and restores exact chunks (tail preflushed: %s)', async preflushed => {
    const before = clone();
    capture(16, 2001);
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    setSequentialFrameCursor({ nextFrame: 7, nextFrameCount: 8, nextFps: 1 });
    capture(28, 2002);
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 8, nextFps: 1 });
    capture(40, 2003);
    if (preflushed) flushBufferedSequentialEvents({ state: useAppStore.getState() });
    expect(await commit()).toBe(true);
    const after = clone();
    expect(after.events).toHaveLength(4);
    expect(after.eventChunks?.at(-1)?.frameIndexes).toEqual([0, 7]);
    expect(historyManager.entries()).toHaveLength(1);
    const beforePixels = render(before);
    const afterPixels = render(after);
    expect(afterPixels).not.toEqual(beforePixels);
    await historyManager.undo();
    expect(clone()).toEqual(before);
    expect(render(data())).toEqual(beforePixels);
    expect(render(data(), 7)).toEqual(render(before, 7));
    await historyManager.redo();
    expect(clone()).toEqual(after);
    expect(render(data())).toEqual(afterPixels);
    expect(render(data(), 7)).toEqual(render(after, 7));
    expect(flushBufferedSequentialEvents({ state: useAppStore.getState() })).toBe(0);
    expect(clone()).toEqual(after);
  });

  it('restores exact chunks when one flush spans two brush segments', async () => {
    const before = clone();
    capture(16, 2001);
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    capture(28, 2002);
    useAppStore.getState().setBrushSettings({ color: '#00ff00' });
    capture(40, 2003);
    expect(await commit()).toBe(true);
    const after = clone();
    expect(after.events).toHaveLength(4);
    expect(historyManager.entries()).toHaveLength(2);
    await historyManager.undo();
    const firstSegment = clone();
    expect(firstSegment.events).toHaveLength(3);
    expect(firstSegment.eventChunks?.at(-1)?.eventCount).toBe(1);
    await historyManager.undo();
    expect(clone()).toEqual(before);
    await historyManager.redo();
    expect(clone()).toEqual(firstSegment);
    await historyManager.redo();
    expect(clone()).toEqual(after);
    expect(render(data())).toEqual(render(after));
  });

  const finalizeAfterOverlayClear = () => {
    const canvas = document.createElement('canvas');
    const content = { current: true };
    const hook = renderHook(() => useDrawingPlaybackOverlayEffects({
      drawingCtxRef: { current: canvas.getContext('2d') },
      drawingCanvasRef: { current: canvas },
      drawingCanvasHasContent: content,
      initDrawingCanvas: () => {},
      shapeMode: false,
    }));
    window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
    expect(content.current).toBe(false);
    hook.unmount();
    return resolveFinalizeEntryContext({
      snapshot: useAppStore.getState(), hasCanvas: true, busy: false,
      project: { width: 64, height: 32 }, isEraserV2: false,
      drawingCanvasHasContent: content.current, eraserToolRef: { current: null },
      endMaskHealingStroke: jest.fn(),
    });
  };

  it('finalizes the canonical multiframe stroke after playback clears its disposable overlay', async () => {
    const before = clone();
    const outside = { ...useAppStore.getState().layers[0], id: 'outside-sequence', alignment: { ...createDefaultLayerAlignment(), offsetPercent: { x: 0, y: 0 } } };
    useAppStore.setState(state => ({ layers: [...state.layers, outside] }));
    capture(16, 2001);
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    setSequentialFrameCursor({ nextFrame: 7, nextFrameCount: 8, nextFps: 1 });
    capture(28, 2002);
    const entry = finalizeAfterOverlayClear();
    expect(entry).not.toBeNull();
    if (!entry) return;
    expect(entry.overlayHasContent).toBe(false);
    expect(await commit()).toBe(true);
    const after = clone();
    expect(after.events).toHaveLength(3);
    expect([...new Set(after.events.slice(1).map(event => event.frameIndex))].sort()).toEqual([0, 7]);
    expect(historyManager.entries()).toHaveLength(1);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await historyManager.undo();
      expect(clone()).toEqual(before);
      for (const frame of [0, 7]) expect(render(data(), frame)).toEqual(render(before, frame));
      expect(useAppStore.getState().layers[1]).toEqual(outside);
      await historyManager.redo();
      expect(clone()).toEqual(after);
      for (const frame of [0, 7]) expect(render(data(), frame)).toEqual(render(after, frame));
      expect(useAppStore.getState().layers[1]).toEqual(outside);
    }
  });

  it.each([null, 3000])('does not create an entry without current-session events (%s)', async sessionStartMs => {
    useAppStore.setState(state => ({ sequentialRecord: { ...state.sequentialRecord, sessionStartMs } }));
    expect(finalizeAfterOverlayClear()).not.toBeNull();
    expect(await commit()).toBe(false);
    expect(historyManager.entries()).toHaveLength(0);
  });

  it.each(['busy', 'canvas', 'project', 'bitmap'])('preserves the %s finalization exclusion', reason => {
    const snapshot = useAppStore.getState();
    const normalSnapshot = reason === 'bitmap' ? { ...snapshot, layers: snapshot.layers.map(layer => ({ ...layer, layerType: 'normal' as const })) } : snapshot;
    expect(resolveFinalizeEntryContext({
      snapshot: normalSnapshot, hasCanvas: reason !== 'canvas', busy: reason === 'busy',
      project: reason === 'project' ? null : { width: 64, height: 32 },
      isEraserV2: false, drawingCanvasHasContent: false,
      eraserToolRef: { current: null }, endMaskHealingStroke: jest.fn(),
    })).toBeNull();
  });

});
