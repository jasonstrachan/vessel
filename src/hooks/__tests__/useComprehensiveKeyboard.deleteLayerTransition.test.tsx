import { act, fireEvent, render } from '@testing-library/react';

import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { flushPendingToolWork, registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

const KeyboardHarness = () => {
  useComprehensiveKeyboard({ enabled: true });
  return null;
};

const createLayer = (id: string, color: string): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = 4;
  const ctx = framebuffer.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  return {
    id, name: id, visible: true, opacity: 1, blendMode: 'source-over',
    locked: false, order: 0, layerType: 'normal', framebuffer,
    imageData: ctx.getImageData(0, 0, 4, 4),
    alignment: createDefaultLayerAlignment(),
  };
};

const bytes = (layerId: string) =>
  new Uint8ClampedArray(useAppStore.getState().layers.find(layer => layer.id === layerId)!.imageData!.data);

describe('useComprehensiveKeyboard Delete during layer activation', () => {
  const flushKey = 'keyboard-delete-layer-transition-test';
  const initialState = useAppStore.getState();
  let releaseFlush: (() => void) | undefined;
  let sourceBytes: Uint8ClampedArray;
  let targetBytes: Uint8ClampedArray;

  beforeEach(async () => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    const layers = [createLayer('delete-source', '#ff0000'), createLayer('delete-target', '#00ff00')];
    useAppStore.setState(state => ({
      project: {
        id: 'delete-transition', name: 'Delete transition', width: 4, height: 4,
        layers, backgroundColor: '#fff', customBrushes: [],
        createdAt: new Date(0), updatedAt: new Date(0),
      },
      layers, activeLayerId: 'delete-source', selectedLayerIds: ['delete-source'],
      tools: {
        ...state.tools, currentTool: 'selection', shapeMode: false,
        brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE },
      },
      ui: { ...state.ui, keyboardScope: { ...state.ui.keyboardScope, active: 'canvas' } },
      floatingPaste: null, floatingPasteHistoryContext: null,
      layersNeedRecomposition: false, currentCompositeBitmap: null,
      compositeSegments: [], pendingCompositeDirtyBatches: [],
    }));
    useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
    sourceBytes = bytes('delete-source');
    targetBytes = bytes('delete-target');
    const heldFlush = new Promise<void>(resolve => { releaseFlush = resolve; });
    registerToolFlush(flushKey, () => heldFlush);
  });

  afterEach(async () => {
    await act(async () => {
      releaseFlush?.();
      await flushPendingToolWork();
      await waitForPendingHistoryCommits();
    });
    unregisterToolFlush(flushKey);
    historyManager.clear();
    useAppStore.setState(initialState);
  });

  const requestLayerActivation = async () => {
    await flushPendingToolWork();
    useAppStore.getState().setActiveLayer('delete-target');
  };

  it.each(['Delete', 'Backspace'])(
    'waits for source finalization, then %s deletes only the newly active layer once', async key => {
      render(<KeyboardHarness />);
      const activating = requestLayerActivation();
      const event = new KeyboardEvent('keydown', { key, code: key, cancelable: true });
      act(() => {
        fireEvent(window, event);
        fireEvent.keyDown(window, { key, code: key, repeat: true });
        fireEvent.keyUp(window, { key, code: key });
        fireEvent.keyDown(window, { key, code: key });
      });

      expect(event.defaultPrevented).toBe(true);
      expect(useAppStore.getState().activeLayerId).toBe('delete-source');
      expect(bytes('delete-source')).toEqual(sourceBytes);
      expect(bytes('delete-target')).toEqual(targetBytes);
      expect(historyManager.entries()).toHaveLength(0);

      await act(async () => {
        releaseFlush!();
        await activating;
        await flushPendingToolWork();
        await waitForPendingHistoryCommits();
      });

      expect(bytes('delete-source')).toEqual(sourceBytes);
      const expectedTarget = targetBytes.slice();
      for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
        expectedTarget.fill(0, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
      }
      expect(bytes('delete-target')).toEqual(expectedTarget);
      expect(useAppStore.getState().selectionStart).toBeNull();
      expect(historyManager.entries()).toHaveLength(1);
      await act(async () => { await historyManager.undo(); });
      expect(bytes('delete-source')).toEqual(sourceBytes);
      expect(bytes('delete-target')).toEqual(targetBytes);
    },
  );

  it('does not delete stale selection bounds cleared while finalization is pending', async () => {
    render(<KeyboardHarness />);
    act(() => { fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' }); });
    expect(bytes('delete-source')).toEqual(sourceBytes);

    await act(async () => {
      useAppStore.getState().clearSelection();
      releaseFlush!();
      await flushPendingToolWork();
      await waitForPendingHistoryCommits();
    });

    expect(bytes('delete-source')).toEqual(sourceBytes);
    expect(bytes('delete-target')).toEqual(targetBytes);
    expect(historyManager.entries()).toHaveLength(0);
  });

  it('deletes the floating paste created during the flush without deleting layer pixels', async () => {
    render(<KeyboardHarness />);
    act(() => { fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' }); });
    expect(bytes('delete-source')).toEqual(sourceBytes);

    await act(async () => {
      useAppStore.getState().setFloatingPaste({
        imageData: new ImageData(2, 2), position: { x: 1, y: 1 }, width: 2, height: 2,
      });
      releaseFlush!();
      await flushPendingToolWork();
      await waitForPendingHistoryCommits();
    });

    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(bytes('delete-source')).toEqual(sourceBytes);
    expect(bytes('delete-target')).toEqual(targetBytes);
    expect(historyManager.entries()).toHaveLength(0);
  });
});
