import historyManager from '@/history/historyService';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import type { SelectionSnapshot } from '@/history/selectionState';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const resetSelection = (): void => {
  useAppStore.setState({
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    selectionVectorPath: null,
    selectionLastAction: null,
    floatingPaste: null,
    floatingPasteHistoryContext: null,
  });
};

const seedLayer = (): Layer => {
  const imageData = new ImageData(6, 5);
  imageData.data.set([20, 40, 60, 255], (1 * 6 + 1) * 4);
  imageData.data.set([70, 80, 90, 80], (3 * 6 + 4) * 4);
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 6;
  framebuffer.height = 5;
  framebuffer.getContext('2d')?.putImageData(imageData, 0, 0);
  const layer: Layer = {
    id: 'selection-command-layer',
    name: 'Selection command layer',
    order: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
  };
  const project: Project = {
    id: 'selection-command-project',
    name: 'Selection command project',
    width: 6,
    height: 5,
    layers: [layer],
    backgroundColor: '#000',
    createdAt: new Date(),
    updatedAt: new Date(),
    customBrushes: [],
  };
  useAppStore.setState({ project, layers: [layer], activeLayerId: layer.id });
  return layer;
};

const seedMaskedSelection = (): SelectionSnapshot => {
  useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
  useAppStore.setState({
    selectionMask: new ImageData(new Uint8ClampedArray([
      12, 34, 56, 80, 1, 2, 3, 0,
      40, 50, 60, 255, 70, 80, 90, 128,
    ]), 2, 2),
    selectionMaskBounds: { x: 1, y: 1, width: 2, height: 2 },
    selectionMaskLayerId: 'original-selection-owner',
    selectionVectorPath: {
      mode: 'freehand',
      points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 }],
    },
  });
  return captureSelectionSnapshot();
};

const expectReplay = (snapshot: SelectionSnapshot, direction: 'backward' | 'forward'): void => {
  const expected = snapshot.start && snapshot.end ? {
    ...snapshot,
    provenance: {
      ...snapshot.provenance,
      source: `history-selection-${direction}`,
      ownerKind: 'history-restored',
      restoredFromHistory: true,
      maskLayerId: snapshot.provenance?.maskLayerId ?? snapshot.maskLayerId ?? null,
    },
  } : snapshot;
  expect(captureSelectionSnapshot()).toEqual(expected);
};

const commands = [
  ['select all', () => useAppStore.getState().selectAllActiveLayerPixels('keyboard-select-all')],
  ['select alpha', () => useAppStore.getState().selectLayerAlpha()],
  ['invert', () => useAppStore.getState().invertSelection()],
] as const;

describe('selection command history', () => {
  beforeEach(() => {
    historyManager.clear();
    resetSelection();
    seedLayer();
  });

  afterEach(() => {
    historyManager.clear();
    resetSelection();
    useAppStore.setState({ project: null, layers: [], activeLayerId: null });
  });

  it.each(commands)('%s records one reversible transaction with exact prior mask/vector/provenance', async (_name, command) => {
    const before = seedMaskedSelection();
    const layer = useAppStore.getState().layers[0];
    const originalBytes = new Uint8ClampedArray(layer.imageData!.data);
    command();
    const after = captureSelectionSnapshot();
    expect(after).not.toEqual(before);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.peekUndo()?.action).toBe('selection-change');
    expect(historyManager.peekUndo()?.deltas.map(delta => delta._tag)).toEqual(['selection-bounds']);
    await historyManager.undo();
    expectReplay(before, 'backward');
    expect(useAppStore.getState().canUndo()).toBe(false);
    expect(useAppStore.getState().canRedo()).toBe(true);
    await historyManager.redo();
    expectReplay(after, 'forward');
    expect(useAppStore.getState().layers[0]).toBe(layer);
    expect(layer.imageData!.data).toEqual(originalBytes);
    expect(useAppStore.getState().floatingPaste).toBeNull();
  });

  it('select alpha records clearing a prior selection on a transparent layer', async () => {
    const before = seedMaskedSelection();
    useAppStore.getState().layers[0].imageData!.data.fill(0);
    useAppStore.getState().selectLayerAlpha();
    const after = captureSelectionSnapshot();
    expect(after.start).toBeNull();
    expect(after.mask).toBeNull();
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expectReplay(before, 'backward');
    await historyManager.redo();
    expectReplay(after, 'forward');
  });

  it('inverting a full selection records reversible clearing', async () => {
    useAppStore.getState().selectAllActiveLayerPixels();
    historyManager.clear();
    const before = captureSelectionSnapshot();
    useAppStore.getState().invertSelection();
    const after = captureSelectionSnapshot();
    expect(after.start).toBeNull();
    expect(after.provenance).toBeNull();
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expectReplay(before, 'backward');
    await historyManager.redo();
    expectReplay(after, 'forward');
  });

  it.each(commands)('%s invalidates redo only when selection changes', async (_name, command) => {
    const beforeFixture = captureSelectionSnapshot();
    seedMaskedSelection();
    commitSelectionHistory({ before: beforeFixture, description: 'Fixture selection' });
    await historyManager.undo();
    expect(useAppStore.getState().canRedo()).toBe(true);
    if (_name === 'invert') seedMaskedSelection();
    command();
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().canUndo()).toBe(true);
    expect(useAppStore.getState().canRedo()).toBe(false);
  });

  it.each(['select all', 'select alpha', 'invert', 'empty alpha'] as const)(
    '%s geometry no-op preserves pending redo without adding history',
    async name => {
      const store = useAppStore.getState();
      if (name === 'select all') store.selectAllActiveLayerPixels();
      if (name === 'select alpha') store.selectLayerAlpha();
      if (name === 'empty alpha') store.layers[0].imageData!.data.fill(0);
      historyManager.clear();
      const beforeFixture = captureSelectionSnapshot();
      seedMaskedSelection();
      commitSelectionHistory({ before: beforeFixture, description: 'Fixture selection for redo' });
      await historyManager.undo();
      const before = captureSelectionSnapshot();
      const redoEntry = historyManager.peekRedo();
      if (name === 'select all') store.selectAllActiveLayerPixels();
      else if (name === 'select alpha' || name === 'empty alpha') store.selectLayerAlpha();
      else store.invertSelection();
      expect({ ...captureSelectionSnapshot(), provenance: null }).toEqual({ ...before, provenance: null });
      expect(useAppStore.getState().canUndo()).toBe(false);
      expect(historyManager.peekRedo()).toBe(redoEntry);
      expect(useAppStore.getState().canRedo()).toBe(true);
      await historyManager.redo();
      expect(useAppStore.getState().selectionMask?.data).toEqual(new Uint8ClampedArray([
        12, 34, 56, 80, 1, 2, 3, 0, 40, 50, 60, 255, 70, 80, 90, 128,
      ]));
    },
  );

  it.each(['select all', 'select alpha', 'invert'] as const)('%s with no available operation leaves state and history unchanged', name => {
    seedMaskedSelection();
    if (name === 'invert') resetSelection();
    const before = captureSelectionSnapshot();
    useAppStore.setState({ project: null, layers: [], activeLayerId: null });
    if (name === 'select all') useAppStore.getState().selectAllActiveLayerPixels();
    else if (name === 'select alpha') useAppStore.getState().selectLayerAlpha('missing-layer');
    else useAppStore.getState().invertSelection();
    expect(captureSelectionSnapshot()).toEqual(before);
    expect(historyManager.entries()).toHaveLength(0);
  });

  it.each([['normal', 'select all'], ['normal', 'invert'], ['sequential', 'select all'], ['sequential', 'invert']] as const)('%s %s uses the project domain instead of its placeholder framebuffer', async (layerType, name) => {
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const sequenceLayer: Layer = {
      ...useAppStore.getState().layers[0],
      layerType,
      imageData: null,
      framebuffer,
      sequentialData: layerType === 'sequential'
        ? { frameCount: 1, fps: 12, durationMs: 83, events: [], eventChunks: [] }
        : undefined,
    };
    useAppStore.setState(state => ({
      layers: [sequenceLayer],
      project: state.project ? { ...state.project, layers: [sequenceLayer] } : null,
    }));
    if (name === 'invert') {
      useAppStore.getState().setSelectionBounds({ x: 1, y: 1 }, { x: 3, y: 3 }, 'selection-marquee-final');
    }
    const before = captureSelectionSnapshot();
    if (name === 'select all') useAppStore.getState().selectAllActiveLayerPixels();
    else useAppStore.getState().invertSelection();
    const after = captureSelectionSnapshot();
    expect(after.start).toEqual({ x: 0, y: 0 });
    expect(after.end).toEqual({ x: 6, y: 5 });
    if (name === 'select all') expect(after.mask).toBeNull();
    else {
      expect(after.maskBounds).toEqual({ x: 0, y: 0, width: 6, height: 5 });
      expect(after.mask?.width).toBe(6);
      expect(after.mask?.height).toBe(5);
      const expectedRGBA = new Uint8ClampedArray(6 * 5 * 4);
      for (let y = 0; y < 5; y += 1) for (let x = 0; x < 6; x += 1) {
        if (x >= 1 && x < 3 && y >= 1 && y < 3) continue;
        expectedRGBA.set([255, 255, 255, 255], (y * 6 + x) * 4);
      }
      expect(after.mask?.data).toEqual(expectedRGBA);
    }
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expectReplay(before, 'backward');
    await historyManager.redo();
    expectReplay(after, 'forward');
    expect(useAppStore.getState().layers[0]).toBe(sequenceLayer);
    expect(sequenceLayer.framebuffer).toBe(framebuffer);
    expect(framebuffer.width).toBe(1);
    expect(framebuffer.height).toBe(1);
    expect(sequenceLayer.imageData).toBeNull();
    expect(sequenceLayer.sequentialData?.events).toEqual(layerType === 'sequential' ? [] : undefined);
  });
});
