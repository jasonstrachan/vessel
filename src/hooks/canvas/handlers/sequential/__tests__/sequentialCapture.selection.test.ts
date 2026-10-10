import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import {
  captureSequentialStampsForActiveLayer, createSequentialStampCapRuntime, createSequentialEventBufferRuntime,
  flushBufferedSequentialEvents, noteSequentialCaptureActivity, getBufferedSequentialLayerFrameEvents,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { clearSequentialLivePreview, getSequentialLivePreviewFrame } from '@/lib/sequential/SequentialLivePreviewRuntime';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const stamp = { x: 8, y: 8, pressure: 1, rotation: 0, size: 12, alpha: 1 };

describe('sequential capture selection snapshot', () => {
  let previousFlag = false;
  beforeEach(() => {
    previousFlag = isFeatureFlagEnabled('enableSequentialRecordMode');
    setFeatureFlag('enableSequentialRecordMode', true);
    clearSequentialLivePreview();
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 8, timestampMs: 0 });
    const layer: Layer = {
      id: 'selection-seq', name: 'SEQ', visible: true, opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      imageData: null, framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 8, fps: 1, durationMs: 8000, events: [] },
    };
    useAppStore.setState((state) => ({
      layers: [layer], activeLayerId: layer.id,
      project: { id: 'selection-project', name: 'Selection', width: 16, height: 16, layers: [layer], backgroundColor: '#000000', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] },
      selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null,
      sequentialRecord: { ...state.sequentialRecord, frameCount: 8, fps: 1, currentFrame: 0, temporalSpreadFrames: 1, trailFalloff: 0, burstFrames: 1, gapFrames: 0, isPointerDown: true, recordArmed: true, isCaptureActive: true, sessionStartMs: 1000 },
      tools: { ...state.tools, currentTool: 'brush', brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE, color: '#00ff00', size: 12, opacity: 1 } },
    }));
  });
  afterEach(() => {
    setFeatureFlag('enableSequentialRecordMode', previousFlag);
    clearSequentialLivePreview();
  });

  it('shares one immutable snapshot with buffered preview and canonical events, then invalidates selection between strokes', () => {
    const runtime = createSequentialStampCapRuntime();
    const eventBufferRuntime = createSequentialEventBufferRuntime();
    const selectionMask = new ImageData(new Uint8ClampedArray([22, 3, 7, 80, 255, 255, 255, 0]), 2, 1);
    useAppStore.setState({ selectionMask, selectionMaskBounds: { x: 7, y: 8, width: 2, height: 1 } });
    const capture = (nowMs: number) => captureSequentialStampsForActiveLayer({ state: useAppStore.getState(), stamps: [stamp], nowMs, runtime, eventBufferRuntime });
    expect(capture(1100)).toBe(1);
    expect(capture(1150)).toBe(1);
    const buffered = getBufferedSequentialLayerFrameEvents({ layerId: 'selection-seq', frameIndex: 0, runtime: eventBufferRuntime });
    expect(buffered[0].brush.selectionClip).toBe(buffered[1].brush.selectionClip);
    const preview = getSequentialLivePreviewFrame({ layerId: 'selection-seq', sessionKey: 'selection-seq:1000', width: 16, height: 16, frameIndex: 0, frameCount: 8 });
    expect(preview).not.toBeNull();
    const previewPixels = preview!.canvas.getContext('2d')!.getImageData(0, 0, 16, 16).data;
    expect(Array.from(previewPixels.slice((8 * 16 + 7) * 4, (8 * 16 + 7) * 4 + 4))).toEqual([0, 255, 0, 255]);
    expect(previewPixels[(8 * 16 + 8) * 4 + 3]).toBe(0);
    flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime, preserveLivePreview: true });
    const events = useAppStore.getState().layers[0].sequentialData!.events;
    expect(events).toHaveLength(2);
    expect(events[0].brush.selectionClip).toBe(events[1].brush.selectionClip);
    expect(Object.isFrozen(events[0].brush.selectionClip)).toBe(true);

    const original = JSON.stringify(events);
    selectionMask.data.fill(0);
    expect(JSON.stringify(events)).toBe(original);

    useAppStore.setState({ selectionMask: null, selectionMaskBounds: null, selectionStart: { x: 10, y: 9 }, selectionEnd: { x: 2, y: 3 } });
    noteSequentialCaptureActivity({ runtime, isActive: false });
    expect(capture(1200)).toBe(1);
    flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime });
    const nextEvents = useAppStore.getState().layers[0].sequentialData!.events;
    expect(nextEvents[2].brush.selectionClip).toEqual({ kind: 'rect', minX: 2, minY: 3, maxX: 10, maxY: 9 });
    expect(nextEvents[2].strokeId).not.toBe(events[0].strokeId);
    expect(nextEvents.slice(0, 2)).toEqual(events);

    useAppStore.setState({ selectionStart: null, selectionEnd: null });
    expect(capture(1250)).toBe(1);
    flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime });
    expect(useAppStore.getState().layers[0].sequentialData!.events[3].brush.selectionClip).toBeNull();
  });
});
