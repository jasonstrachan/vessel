import { performCanvasUndo } from '@/components/canvas/useDrawingCanvasKeyboard';
import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { FinalizeQueue } from '@/lib/canvas/FinalizeQueue';
import { clearSequentialLayerRendererAll } from '@/lib/sequential/SequentialLayerRenderer';
import { HISTORY_FINALIZE_LANE, registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

describe('performCanvasUndo', () => {
  it('cancels an active direction-selection operation before consulting history', async () => {
    const cancelActiveOperations = jest.fn(() => true);
    const canUndo = jest.fn(() => false);
    const undo = jest.fn(async () => undefined);

    await performCanvasUndo({ cancelActiveOperations, canUndo, undo });

    expect(cancelActiveOperations).toHaveBeenCalledWith({
      includeFloatingPaste: false,
      dispatchInteractionEnd: true,
    });
    expect(canUndo).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('replays history when no active operation needs cancellation', async () => {
    const cancelActiveOperations = jest.fn(() => false);
    const canUndo = jest.fn(() => true);
    const undo = jest.fn(async () => undefined);

    await performCanvasUndo({ cancelActiveOperations, canUndo, undo });

    expect(canUndo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe('canvas Undo with pending native sequence deletion', () => {
  let queue: FinalizeQueue;
  let releaseHistory: (() => void) | undefined;

  beforeEach(async () => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    clearSequentialLayerRendererAll();
    queue = new FinalizeQueue();
    registerFinalizeQueue(queue);
    releaseHistory = undefined;
    const framebuffer = document.createElement('canvas');
    framebuffer.width = framebuffer.height = 4;
    const layer: Layer = {
      id: 'pending-sequence-delete', name: 'Pending sequence', visible: true,
      opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      imageData: null, framebuffer, layerType: 'sequential',
      alignment: createDefaultLayerAlignment(),
      sequentialData: {
        frameCount: 1, fps: 12, durationMs: 83, eventChunks: [],
        events: [{
          id: 'before-delete', layerId: 'pending-sequence-delete', strokeId: 'before-delete',
          timestampMs: 0, frameIndex: 0,
          brush: {
            tool: 'brush', brushShape: BrushShape.SQUARE, size: 2, opacity: 1,
            blendMode: 'source-over', rotation: 0, spacing: 1, color: '#ff0000',
          },
          stamps: [{ x: 2, y: 2, pressure: 1, rotation: 0, size: 2, alpha: 1 }],
        }],
      },
    };
    useAppStore.setState((state) => ({
      project: {
        id: 'pending-delete-project', name: 'Pending delete', width: 4, height: 4,
        layers: [layer], backgroundColor: '#fff', customBrushes: [],
        createdAt: new Date(0), updatedAt: new Date(0),
      },
      layers: [layer], activeLayerId: layer.id,
      selectionStart: null, selectionEnd: null, selectionMask: null,
      selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
      selectionLastAction: null, floatingPaste: null, floatingPasteHistoryContext: null,
      layersNeedRecomposition: false, currentCompositeBitmap: null,
      compositeSegments: [], pendingCompositeDirtyBatches: [],
      sequentialRecord: { ...state.sequentialRecord, currentFrame: 0 },
    }));
    useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
  });

  afterEach(async () => {
    releaseHistory?.();
    await queue.whenIdle();
    await waitForPendingHistoryCommits();
    registerFinalizeQueue(null);
    historyManager.clear();
    clearSequentialLayerRendererAll();
  });

  it.each([false, true])('handles unpublished Delete history while preserving active cancellation: %s', async (cancelled) => {
    const beforeSequence = useAppStore.getState().layers[0].sequentialData;
    const beforeSelection = {
      start: useAppStore.getState().selectionStart,
      end: useAppStore.getState().selectionEnd,
    };
    const held = new Promise<void>((resolve) => { releaseHistory = resolve; });
    let enteredHistoryLane!: () => void;
    const historyLaneEntered = new Promise<void>((resolve) => { enteredHistoryLane = resolve; });
    const blocker = queue.enqueue(async () => {
      enteredHistoryLane();
      await held;
    }, HISTORY_FINALIZE_LANE);
    await historyLaneEntered;
    useAppStore.getState().deleteSelectedPixels('keyboard-delete');
    const deletedSequence = useAppStore.getState().layers[0].sequentialData;
    expect(deletedSequence?.events).toHaveLength(2);
    expect(deletedSequence?.events[1].brush.blendMode).toBe('destination-out');
    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().canUndo()).toBe(false);
    const cancelActiveOperations = jest.fn(() => cancelled);
    const canUndo = jest.fn(useAppStore.getState().canUndo);
    const undo = jest.fn(useAppStore.getState().undo);
    let settled = false;
    const requestedUndo = performCanvasUndo({ cancelActiveOperations, canUndo, undo })
      .then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforePublication = settled;
    const checksBeforePublication = canUndo.mock.calls.length;
    expect(useAppStore.getState().layers[0].sequentialData).toEqual(deletedSequence);
    expect(historyManager.entries()).toHaveLength(0);
    releaseHistory!();
    await Promise.all([blocker, requestedUndo, waitForPendingHistoryCommits()]);

    expect(settledBeforePublication).toBe(cancelled);
    expect(checksBeforePublication).toBe(0);
    expect(cancelActiveOperations).toHaveBeenCalledWith({
      includeFloatingPaste: false, dispatchInteractionEnd: true,
    });
    expect(canUndo).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    expect(undo).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    expect(historyManager.entries()).toHaveLength(cancelled ? 1 : 0);
    expect(historyManager.redoEntries()).toHaveLength(cancelled ? 0 : 1);
    expect(useAppStore.getState().layers[0].sequentialData).toEqual(cancelled ? deletedSequence : beforeSequence);
    expect(useAppStore.getState().selectionStart).toEqual(cancelled ? null : beforeSelection.start);
    expect(useAppStore.getState().selectionEnd).toEqual(cancelled ? null : beforeSelection.end);
    if (!cancelled) {
      await useAppStore.getState().redo();
      expect(useAppStore.getState().layers[0].sequentialData).toEqual(deletedSequence);
      expect(useAppStore.getState().selectionStart).toBeNull();
      expect(historyManager.entries()).toHaveLength(1);
      expect(historyManager.redoEntries()).toHaveLength(0);
    }
  });
});
