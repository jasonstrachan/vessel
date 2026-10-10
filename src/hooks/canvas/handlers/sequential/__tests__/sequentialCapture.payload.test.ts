import { setFeatureFlag } from '@/config/featureFlags';
import { captureSequentialStampsForActiveLayer, createSequentialStampCapRuntime, createSequentialEventBufferRuntime, createSequentialPayloadNotificationRuntime, flushBufferedSequentialEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { createSequentialPayloadBudgetRuntime, estimateSequentialLayerPayloadBytes, readSequentialProjectPayloadBytes, SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES } from '@/lib/sequential/SequentialPayloadBudget';
import { clearSequentialLivePreview } from '@/lib/sequential/SequentialLivePreviewRuntime';
import { encodeSequentialEventsToChunks } from '@/lib/sequential/SequentialStrokeChunk';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

test('localized real capture guard comparison', () => {
  setFeatureFlag('enableSequentialRecordMode', true);
  setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 8, timestampMs: 0 });
  const receipts = [];
  for (const scope of ['none', 'rect', 'mask']) {
    clearSequentialLivePreview();
    const layer: Layer = { id: `probe-${scope}`, name: 'Probe', visible: true, opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      imageData: null, framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 8, fps: 1, durationMs: 8000, events: [] } };
    const selectionMask = scope.startsWith('mask') ? new ImageData(2048, 2048) : null;
    if (selectionMask) for (let i = 3; i < selectionMask.data.length; i += 4) selectionMask.data[i] = 255;
    useAppStore.setState(state => ({
      layers: [layer], activeLayerId: layer.id,
      project: { id: `project-${scope}`, name: 'Probe', width: 2048, height: 2048, layers: [layer], backgroundColor: '#000000', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] },
      selectionStart: scope === 'rect' ? { x: 0, y: 0 } : null, selectionEnd: scope === 'rect' ? { x: 2048, y: 2048 } : null,
      selectionMask, selectionMaskBounds: selectionMask ? { x: 0, y: 0, width: 2048, height: 2048 } : null,
      ui: { ...state.ui, notifications: [] },
      sequentialRecord: { ...state.sequentialRecord, frameCount: 8, fps: 1, currentFrame: 0, temporalSpreadFrames: 1, trailFalloff: 0, burstFrames: 1, gapFrames: 0, isPointerDown: true, recordArmed: true, isCaptureActive: true, sessionStartMs: 1000 },
      tools: { ...state.tools, currentTool: 'brush', brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE, color: '#00ff00', size: 12, opacity: 1 } },
    }));
    const runtime = createSequentialStampCapRuntime(), eventBufferRuntime = createSequentialEventBufferRuntime(), payloadRuntime = createSequentialPayloadBudgetRuntime(), notificationRuntime = createSequentialPayloadNotificationRuntime();
    const admitted = Array.from({ length: 25 }, (_, index) => captureSequentialStampsForActiveLayer({ state: useAppStore.getState(),
      stamps: [{ x: 20 + index, y: 20, pressure: 1, rotation: 0, size: 12, alpha: 1 }], nowMs: 1100 + index,
      runtime, eventBufferRuntime, payloadRuntime, notificationRuntime,
       }));
    const pendingBytes = eventBufferRuntime.pendingPayloadBytes;
    flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime });
    const state = useAppStore.getState(), result = state.layers[0], events = result.sequentialData!.events;
    const encoded = encodeSequentialEventsToChunks({ layerId: layer.id, fps: 1, frameCount: 8, events });
    const clip = events[0]?.brush.selectionClip;
    const receipt = { scope, admitted, eventCount: events.length, recordedArmed: state.sequentialRecord.recordArmed,
      captureActive: state.sequentialRecord.isCaptureActive, pendingBytes, estimatedLayerBytes: estimateSequentialLayerPayloadBytes(result),
      hardLimit: SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES, clipBase64Chars: clip?.kind === 'mask' ? clip.alphaBase64.length : 0,
      distinctClipRefs: new Set(events.map(event => event.brush.selectionClip)).size,
      distinctBrushRefs: new Set(events.map(event => event.brush)).size,
      chunkCount: encoded.chunks.length, brushSnapshotCount: Object.keys(encoded.brushSnapshots).length,
      chunkJsonUtf8Bytes: Buffer.byteLength(JSON.stringify(encoded)),
      notifications: state.ui.notifications.map(notification => ({ title: notification.title, message: notification.message })) };
    receipts.push(receipt);
    expect(receipt.distinctClipRefs).toBe(1);
    expect(receipt.brushSnapshotCount).toBe(1);
    expect(receipt.eventCount).toBe(25);
    expect(receipt.recordedArmed).toBe(true);
    expect(receipt.notifications).toEqual([]);
    if (selectionMask) {
      const captureAgain = (nextMask: ImageData, session: number, hardLimitBytes?: number) => {
        useAppStore.setState(state => ({ selectionMask: nextMask,
          sequentialRecord: { ...state.sequentialRecord, sessionStartMs: session, recordArmed: true, isCaptureActive: true } }));
        return captureSequentialStampsForActiveLayer({ state: useAppStore.getState(),
          stamps: [{ x: 60, y: 20, pressure: 1, rotation: 0, size: 12, alpha: 1 }], nowMs: session + 100,
          runtime, eventBufferRuntime, payloadRuntime, notificationRuntime,
          ...(hardLimitBytes ? { payloadLimits: { softLimitBytes: 0, hardLimitBytes } } : {}) });
      };
      // Checkpoint rebuild and another stroke reuse the already retained mask payload.
      expect(captureAgain(selectionMask, 2000)).toBe(1);
      flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime });
      const equivalentMask = new ImageData(selectionMask.data.slice(), 2048, 2048);
      expect(captureAgain(equivalentMask, 3000)).toBe(1);
      flushBufferedSequentialEvents({ state: useAppStore.getState(), runtime: eventBufferRuntime });
      const current = useAppStore.getState().layers[0];
      expect(estimateSequentialLayerPayloadBytes(current)).toBeLessThan(12 * 1024 * 1024);
      expect(Object.keys(encodeSequentialEventsToChunks({ layerId: layer.id, fps: 1, frameCount: 8, events: current.sequentialData!.events }).brushSnapshots)).toHaveLength(1);
      const differentMask = new ImageData(selectionMask.data.slice(), 2048, 2048);
      differentMask.data[3] = 0;
      expect(captureAgain(differentMask, 4000, 14 * 1024 * 1024)).toBe(0);
      expect(useAppStore.getState().sequentialRecord.recordArmed).toBe(false);
      expect(eventBufferRuntime.selectionClipKeysByLayer.get(layer.id)?.size ?? 0).toBe(0);
      // Simulate removing canonical events (Undo/import rebuild): rejected masks are not remembered as paid.
      useAppStore.setState({ layers: [{ ...current, sequentialData: { ...current.sequentialData!, events: [], eventChunks: [] } }] });
      expect(readSequentialProjectPayloadBytes({ layers: useAppStore.getState().layers, runtime: payloadRuntime })).toBe(96);
      expect(captureAgain(differentMask, 5000, 14 * 1024 * 1024)).toBe(1);
      expect(eventBufferRuntime.pendingPayloadBytes).toBeGreaterThan(11 * 1024 * 1024 - 1024 * 1024);
    }
  }
  expect(receipts[2].estimatedLayerBytes).toBeLessThan(12 * 1024 * 1024);
  clearSequentialLivePreview();
});
