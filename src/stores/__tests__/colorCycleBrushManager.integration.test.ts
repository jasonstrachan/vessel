import {
  createColorCycleBrushManager,
  disposeColorCycleBrushManager,
  getColorCycleBrushManager,
  setColorCycleStoreStateGetter,
} from '@/stores/colorCycleBrushManager';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import { ColorCycleLayerDocument } from '@/lib/colorCycle/document';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { defaultBrushSettings } from '@/presets/brushPresets';

type MockBrush = ReturnType<typeof createMockBrush>;

const createdBrushes: MockBrush[] = [];

function createMockBrush() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    setGradientBands: jest.fn(),
    setBandSpacing: jest.fn(),
    setBrushSize: jest.fn(),
    setPressureEnabled: jest.fn(),
    setMinPressure: jest.fn(),
    setMaxPressure: jest.fn(),
    setDitherEnabled: jest.fn(),
    setDitherPixelSize: jest.fn(),
    applySettings: jest.fn(),
    setFPS: jest.fn(),
    setLayerBaseSpeed: jest.fn(),
    setPlaybackSpeedScale: jest.fn(),
    setDitherStrength: jest.fn(),
    setPxlEdgeEnabled: jest.fn(),
    setStampShape: jest.fn(),
    setStampDitherEnabled: jest.fn(),
    setStampDitherAlgorithm: jest.fn(),
    setStampDitherPatternStyle: jest.fn(),
    setStampDitherPatternTileSettings: jest.fn(),
    setStampDitherPressureLinked: jest.fn(),
    setStampDitherBgFill: jest.fn(),
    setStampDitherPixelSize: jest.fn(),
    setStampDitherClears: jest.fn(),
    setPreserveGradientPhase: jest.fn(),
    setLayerId: jest.fn(),
    getLayerId: jest.fn(() => 'layer-1'),
    setActiveLayer: jest.fn(),
    endStroke: jest.fn(),
    startStroke: jest.fn(),
    setTargetCanvas: jest.fn(),
    setSpeed: jest.fn(),
    setFlowMode: jest.fn(),
    setFlowDirection: jest.fn(),
    setLegacyFlowMode: jest.fn(),
    setPhase: jest.fn(),
    isPlaying: jest.fn(() => false),
    setPlaying: jest.fn(),
    startAnimation: jest.fn(),
    stopAnimation: jest.fn(),
    updateAnimation: jest.fn(),
    pause: jest.fn(),
    commitCurrentStroke: jest.fn(),
    finalizeCurrentStroke: jest.fn(),
    flush: jest.fn(),
    setGradient: jest.fn(),
    setGradientSlotStops: jest.fn(),
    setGradientSlot: jest.fn(),
    setActiveGradientSlot: jest.fn(),
    syncGradientDefRuntime: jest.fn(),
    bindGradientDefIdToSlot: jest.fn(),
    getColorCycleLayerDocument: jest.fn(() => undefined),
    setUseCanvas2D: jest.fn(),
    setColorCycleLayerDocument: jest.fn(),
    removeColorCycleLayerDocument: jest.fn(),
    isUsingWebGL: jest.fn(() => false),
    getCanvas: jest.fn(() => canvas),
    renderDirectToCanvas: jest.fn(),
    presentCurrentFrameToCanvas: jest.fn(),
    commitToLayer: jest.fn(),
    clearPaintBuffer: jest.fn(),
    updateColorCycleTexture: jest.fn(),
    render: jest.fn(),
    setOnFrameRendered: jest.fn(),
    fillShapeDispatch: jest.fn(),
    paint: jest.fn(),
    paintCustomStamp: jest.fn(),
    clear: jest.fn(),
    markLayerHasExternalBase: jest.fn(),
    cleanup: jest.fn(),
  };
}

const expectLastCallBefore = (first: jest.Mock, second: jest.Mock): void => {
  const firstCallOrder = first.mock.invocationCallOrder[first.mock.invocationCallOrder.length - 1];
  const secondCallOrder = second.mock.invocationCallOrder[second.mock.invocationCallOrder.length - 1];

  expect(firstCallOrder).toBeLessThan(secondCallOrder);
};

jest.mock('@/hooks/brushEngine/ColorCycleBrushCanvas2D', () => {
  return {
    ColorCycleBrushCanvas2D: jest.fn(() => {
      const brush = createMockBrush();
      createdBrushes.push(brush);
      return brush;
    }),
  };
});

const mockUpdateLayer = jest.fn();
const mockLayer = ({
  id: 'layer-a',
  name: 'Layer A',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'source-over',
  imageData: null,
  layerType: 'color-cycle',
  colorCycleData: {
    brushSpeed: 1,
    flowMode: 'forward',
  },
} as unknown) as Layer;

const mockStoreState = {
  tools: {
    brushSettings: defaultBrushSettings,
  },
  layers: [mockLayer],
  colorCyclePlayback: {
    playbackSpeedScale: 1,
  },
  updateLayer: mockUpdateLayer,
} as unknown as AppState;

jest.mock('@/stores/useAppStore', () => {
  const actual = jest.requireActual('@/stores/useAppStore');
  const useAppStore = ((selector?: (state: AppState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockStoreState);
    }
    return mockStoreState;
  }) as typeof actual.useAppStore;

  useAppStore.getState = () => mockStoreState;
  useAppStore.setState = jest.fn();
  useAppStore.subscribe = jest.fn(() => () => {});

  return {
    ...actual,
    useAppStore,
    selectEffectiveColorCyclePlaying: jest.fn(() => false),
  };
});

describe('colorCycleBrushManager integration', () => {
  beforeEach(() => {
    createdBrushes.length = 0;
    mockUpdateLayer.mockClear();
    mockStoreState.layers = [mockLayer];
    setColorCycleStoreStateGetter(() => mockStoreState as unknown as Pick<AppState, 'tools' | 'layers' | 'colorCyclePlayback'>);
  });

  afterEach(() => {
    disposeColorCycleBrushManager();
  });

  it('initializes and retrieves brushes per layer', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);
    expect(manager.getBrush('layer-1')).toBeDefined();
    expect(manager.getRuntime('layer-1')).toEqual(expect.objectContaining({
      layerId: 'layer-1',
      brush: manager.getBrush('layer-1'),
      document: manager.getDocument('layer-1'),
    }));
    expect(manager.brushes.get('layer-1')).toBe(manager.getRuntime('layer-1')?.brush);
    expect(manager.documents.get('layer-1')).toBe(manager.getRuntime('layer-1')?.document);
    expect(manager.getDocument('layer-1')?.read()).toEqual(expect.objectContaining({
      version: 0,
      snapshot: expect.objectContaining({
        layerId: 'layer-1',
        width: 64,
        height: 64,
        hasContent: false,
      }),
    }));
    expect(createdBrushes).toHaveLength(1);
    expect(createdBrushes[0].setColorCycleLayerDocument).toHaveBeenCalledWith(
      'layer-1',
      manager.getDocument('layer-1'),
    );
    expect(createdBrushes[0].setLayerId).toHaveBeenCalledWith('layer-1');
    expectLastCallBefore(createdBrushes[0].setColorCycleLayerDocument, createdBrushes[0].setLayerId);
  });

  it('attaches the registry document before binding a restored brush layer id', () => {
    const manager = createColorCycleBrushManager();
    const brush = createMockBrush();

    manager.registerRestoredBrush('layer-restored', brush, {
      width: 32,
      height: 24,
      isActive: true,
    });

    expect(manager.getRuntime('layer-restored')).toEqual(expect.objectContaining({
      layerId: 'layer-restored',
      brush,
      document: manager.getDocument('layer-restored'),
    }));
    expect(brush.setColorCycleLayerDocument).toHaveBeenCalledWith(
      'layer-restored',
      manager.getDocument('layer-restored'),
    );
    expect(brush.setLayerId).toHaveBeenCalledWith('layer-restored');
    expectLastCallBefore(brush.setColorCycleLayerDocument, brush.setLayerId);
  });

  it('keeps the restored brush document instead of reusing a stale manager document', () => {
    const manager = createColorCycleBrushManager();
    const staleDocument = manager.ensureDocument('layer-restored', 32, 24);
    const restoredDocument = new ColorCycleLayerDocument({
      layerId: 'layer-restored',
      width: 32,
      height: 24,
      paintBuffer: new Uint8Array(32 * 24).buffer,
      gradientIdBuffer: new Uint8Array(32 * 24).buffer,
      gradientDefIdBuffer: new Uint16Array(32 * 24).buffer,
      speedBuffer: new Uint8Array(32 * 24).buffer,
      flowBuffer: new Uint8Array(32 * 24).buffer,
      phaseBuffer: new Uint8Array(32 * 24).buffer,
      hasContent: true,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    });
    const brush = createMockBrush();
    brush.getColorCycleLayerDocument.mockReturnValue(restoredDocument as never);

    manager.registerRestoredBrush('layer-restored', brush, {
      width: 32,
      height: 24,
      isActive: true,
    });

    expect(manager.getDocument('layer-restored')).toBe(restoredDocument);
    expect(manager.getDocument('layer-restored')).not.toBe(staleDocument);
    expect(brush.setColorCycleLayerDocument).toHaveBeenCalledWith(
      'layer-restored',
      restoredDocument,
    );
  });

  it('exposes a stable playback-only brush facade', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const playbackBrush = manager.getPlaybackBrush('layer-1');
    const secondPlaybackBrush = manager.getPlaybackBrush('layer-1');

    expect(playbackBrush).toBe(secondPlaybackBrush);
    expect(playbackBrush).not.toBe(brush);
    expect(Object.keys(playbackBrush ?? {}).sort()).toEqual([
      'isPlaying',
      'pause',
      'setFlowDirection',
      'setFlowMode',
      'setLegacyFlowMode',
      'setPlaying',
      'startAnimation',
      'stopAnimation',
      'updateAnimation',
    ]);
    expect('getCanvas' in (playbackBrush ?? {})).toBe(false);
    expect('renderDirectToCanvas' in (playbackBrush ?? {})).toBe(false);

    playbackBrush?.startAnimation?.();
    playbackBrush?.setLegacyFlowMode?.('forward');

    expect(brush.startAnimation).toHaveBeenCalledTimes(1);
    expect(brush.setLegacyFlowMode).toHaveBeenCalledWith('forward');
  });

  it('exposes a stable surface brush facade without lifecycle/settings controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const surfaceBrush = manager.getSurfaceBrush('layer-1');
    const secondSurfaceBrush = manager.getSurfaceBrush('layer-1');

    expect(surfaceBrush).toBe(secondSurfaceBrush);
    expect(surfaceBrush).not.toBe(brush);
    expect(Object.keys(surfaceBrush ?? {}).sort()).toEqual([
      'getCanvas',
      'isPlaying',
      'pause',
      'presentCurrentFrameToCanvas',
      'renderDirectToCanvas',
      'setFlowDirection',
      'setFlowMode',
      'setLegacyFlowMode',
      'setPlaying',
      'setTargetCanvas',
      'startAnimation',
      'stopAnimation',
      'updateAnimation',
    ]);
    expect('setBrushSize' in (surfaceBrush ?? {})).toBe(false);
    expect('cleanup' in (surfaceBrush ?? {})).toBe(false);

    const canvas = document.createElement('canvas');
    surfaceBrush?.setTargetCanvas?.(canvas);
    surfaceBrush?.renderDirectToCanvas?.(canvas, 'layer-1');

    expect(brush.setTargetCanvas).toHaveBeenCalledWith(canvas);
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, 'layer-1');
  });

  it('exposes a stable gradient-apply brush facade without surface or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const gradientApplyBrush = manager.getGradientApplyBrush('layer-1');
    const secondGradientApplyBrush = manager.getGradientApplyBrush('layer-1');

    expect(gradientApplyBrush).toBe(secondGradientApplyBrush);
    expect(gradientApplyBrush).not.toBe(brush);
    expect(Object.keys(gradientApplyBrush ?? {}).sort()).toEqual([
      'commitCurrentStroke',
      'flush',
      'setActiveGradientSlot',
      'setGradientSlot',
      'setGradientSlotStops',
      'syncGradientDefRuntime',
    ]);
    expect('getCanvas' in (gradientApplyBrush ?? {})).toBe(false);
    expect('cleanup' in (gradientApplyBrush ?? {})).toBe(false);

    gradientApplyBrush?.commitCurrentStroke?.('layer-1');
    gradientApplyBrush?.setActiveGradientSlot?.('layer-1', 2);
    gradientApplyBrush?.syncGradientDefRuntime?.('layer-1');

    expect(brush.commitCurrentStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.setActiveGradientSlot).toHaveBeenCalledWith('layer-1', 2);
    expect(brush.syncGradientDefRuntime).toHaveBeenCalledWith('layer-1');
  });

  it('exposes a stable history brush facade without settings or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const historyBrush = manager.getHistoryBrush('layer-1');
    const secondHistoryBrush = manager.getHistoryBrush('layer-1');

    expect(historyBrush).toBe(secondHistoryBrush);
    expect(historyBrush).not.toBe(brush);
    expect(Object.keys(historyBrush ?? {}).sort()).toEqual([
      'commitToLayer',
      'flush',
      'getCanvas',
      'getColorCycleLayerDocument',
      'render',
      'renderDirectToCanvas',
      'setTargetCanvas',
      'updateColorCycleTexture',
    ]);
    expect('setBrushSize' in (historyBrush ?? {})).toBe(false);
    expect('cleanup' in (historyBrush ?? {})).toBe(false);

    const canvas = document.createElement('canvas');
    historyBrush?.setTargetCanvas?.(canvas);
    historyBrush?.commitToLayer?.(canvas, 'layer-1');
    historyBrush?.flush?.('layer-1');

    expect(brush.setTargetCanvas).toHaveBeenCalledWith(canvas);
    expect(brush.commitToLayer).toHaveBeenCalledWith(canvas, 'layer-1');
    expect(brush.flush).toHaveBeenCalledWith('layer-1');
  });

  it('exposes a stable serialized-state brush facade without render or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const serializedStateBrush = manager.getSerializedStateBrush('layer-1');
    const secondSerializedStateBrush = manager.getSerializedStateBrush('layer-1');

    expect(serializedStateBrush).toBe(secondSerializedStateBrush);
    expect(serializedStateBrush).not.toBe(brush);
    expect(Object.keys(serializedStateBrush ?? {}).sort()).toEqual([
      'getColorCycleLayerDocument',
    ]);
    expect('serialize' in (serializedStateBrush ?? {})).toBe(false);
    expect('getCanvas' in (serializedStateBrush ?? {})).toBe(false);
    expect('renderDirectToCanvas' in (serializedStateBrush ?? {})).toBe(false);
    expect('setBrushSize' in (serializedStateBrush ?? {})).toBe(false);
    expect('cleanup' in (serializedStateBrush ?? {})).toBe(false);

    serializedStateBrush?.getColorCycleLayerDocument?.('layer-1');

    expect(brush.getColorCycleLayerDocument).toHaveBeenCalledWith('layer-1');
  });

  it('exposes a stable selection mutation brush facade without full runtime controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const selectionBrush = manager.getSelectionMutationBrush('layer-1');
    const secondSelectionBrush = manager.getSelectionMutationBrush('layer-1');

    expect(selectionBrush).toBe(secondSelectionBrush);
    expect(selectionBrush).not.toBe(brush);
    expect(Object.keys(selectionBrush ?? {}).sort()).toEqual([
      'getCanvas',
      'getColorCycleLayerDocument',
      'renderDirectToCanvas',
    ]);
    expect('applyLayerSnapshot' in (selectionBrush ?? {})).toBe(false);
    expect('setBrushSize' in (selectionBrush ?? {})).toBe(false);
    expect('cleanup' in (selectionBrush ?? {})).toBe(false);

    const canvas = document.createElement('canvas');
    selectionBrush?.renderDirectToCanvas?.(canvas, 'layer-1');
    selectionBrush?.getColorCycleLayerDocument?.('layer-1');

    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, 'layer-1');
    expect(brush.getColorCycleLayerDocument).toHaveBeenCalledWith('layer-1');
  });

  it('exposes a stable layer activation brush facade without render or settings controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const activationBrush = manager.getLayerActivationBrush('layer-1');
    const secondActivationBrush = manager.getLayerActivationBrush('layer-1');

    expect(activationBrush).toBe(secondActivationBrush);
    expect(activationBrush).not.toBe(brush);
    expect(Object.keys(activationBrush ?? {}).sort()).toEqual([
      'endStroke',
      'setActiveLayer',
    ]);
    expect('getCanvas' in (activationBrush ?? {})).toBe(false);
    expect('renderDirectToCanvas' in (activationBrush ?? {})).toBe(false);
    expect('setBrushSize' in (activationBrush ?? {})).toBe(false);
    expect('cleanup' in (activationBrush ?? {})).toBe(false);

    activationBrush?.endStroke?.('layer-1');
    activationBrush?.setActiveLayer?.('layer-1');

    expect(brush.endStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.setActiveLayer).toHaveBeenCalledWith('layer-1');
  });

  it('exposes stable narrow hook brush facades without document or teardown controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const drawBrush = manager.getDrawBrush('layer-1');
    const fillBrush = manager.getFillBrush('layer-1');
    const lifecycleBrush = manager.getStrokeLifecycleBrush('layer-1');
    const initBrush = manager.getInitBrush('layer-1');
    const clearBrush = manager.getClearBrush('layer-1');

    expect(manager.getDrawBrush('layer-1')).toBe(drawBrush);
    expect(manager.getFillBrush('layer-1')).toBe(fillBrush);
    expect(manager.getStrokeLifecycleBrush('layer-1')).toBe(lifecycleBrush);
    expect(manager.getInitBrush('layer-1')).toBe(initBrush);
    expect(manager.getClearBrush('layer-1')).toBe(clearBrush);
    expect(drawBrush).not.toBe(brush);
    expect(fillBrush).not.toBe(brush);
    expect(lifecycleBrush).not.toBe(brush);

    expect(Object.keys(drawBrush ?? {}).sort()).toEqual([
      'applySettings',
      'getCanvas',
      'getColorCycleLayerDocument',
      'paint',
      'paintCustomStamp',
      'renderDirectToCanvas',
      'setTargetCanvas',
      'startStroke',
    ]);
    expect(Object.keys(fillBrush ?? {}).sort()).toEqual([
      'applySettings',
      'endStroke',
      'fillShapeDispatch',
      'getCanvas',
      'getLayerId',
      'renderDirectToCanvas',
      'setActiveLayer',
      'setLayerId',
      'setTargetCanvas',
    ]);
    expect(Object.keys(lifecycleBrush ?? {}).sort()).toEqual([
      'clearPaintBuffer',
      'commitCurrentStroke',
      'commitToLayer',
      'endStroke',
      'finalizeCurrentStroke',
      'getCanvas',
      'renderDirectToCanvas',
      'setActiveLayer',
      'setLayerId',
      'setTargetCanvas',
      'startStroke',
    ]);
    expect(Object.keys(initBrush ?? {}).sort()).toEqual([
      'applySettings',
      'endStroke',
      'setOnFrameRendered',
    ]);
    expect(Object.keys(clearBrush ?? {}).sort()).toEqual(['clear']);

    for (const facade of [drawBrush, fillBrush, lifecycleBrush, initBrush, clearBrush]) {
      expect('removeColorCycleLayerDocument' in (facade ?? {})).toBe(false);
      expect('cleanup' in (facade ?? {})).toBe(false);
      expect('destroy' in (facade ?? {})).toBe(false);
    }

    drawBrush?.paint(1, 2, 'layer-1');
    lifecycleBrush?.commitCurrentStroke?.('layer-1');
    initBrush?.applySettings?.({ brushSize: 12 });
    clearBrush?.clear?.();

    expect(brush.commitCurrentStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.paint).toHaveBeenCalledWith(1, 2, 'layer-1');
    expect(brush.applySettings).toHaveBeenCalledWith({ brushSize: 12 });
    expect(brush.clear).toHaveBeenCalledTimes(1);
  });

  it('exposes a stable crop brush facade without render, settings, or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const cropBrush = manager.getCropBrush('layer-1');
    const secondCropBrush = manager.getCropBrush('layer-1');

    expect(cropBrush).toBe(secondCropBrush);
    expect(cropBrush).not.toBe(brush);
    expect(Object.keys(cropBrush ?? {}).sort()).toEqual([
      'getColorCycleLayerDocument',
      'isPlaying',
    ]);
    expect('serialize' in (cropBrush ?? {})).toBe(false);
    expect('getCanvas' in (cropBrush ?? {})).toBe(false);
    expect('renderDirectToCanvas' in (cropBrush ?? {})).toBe(false);
    expect('setBrushSize' in (cropBrush ?? {})).toBe(false);
    expect('cleanup' in (cropBrush ?? {})).toBe(false);

    cropBrush?.isPlaying?.();
    cropBrush?.getColorCycleLayerDocument?.('layer-1');

    expect(brush.isPlaying).toHaveBeenCalledTimes(1);
    expect(brush.getColorCycleLayerDocument).toHaveBeenCalledWith('layer-1');
  });

  it('exposes a stable commit brush facade without settings or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const commitBrush = manager.getCommitBrush('layer-1');
    const secondCommitBrush = manager.getCommitBrush('layer-1');

    expect(commitBrush).toBe(secondCommitBrush);
    expect(commitBrush).not.toBe(brush);
    expect(Object.keys(commitBrush ?? {}).sort()).toEqual([
      'bindGradientDefIdToSlot',
      'clearPaintBuffer',
      'commitCurrentStroke',
      'commitToLayer',
      'finalizeCurrentStroke',
      'flush',
      'getCanvas',
      'getColorCycleLayerDocument',
      'isPlaying',
      'pause',
      'presentCurrentFrameToCanvas',
      'renderDirectToCanvas',
      'setFlowDirection',
      'setFlowMode',
      'setGradientSlotStops',
      'setLegacyFlowMode',
      'setPlaying',
      'setTargetCanvas',
      'startAnimation',
      'stopAnimation',
      'updateAnimation',
      'updateColorCycleTexture',
    ]);
    expect('setBrushSize' in (commitBrush ?? {})).toBe(false);
    expect('applySettings' in (commitBrush ?? {})).toBe(false);
    expect('cleanup' in (commitBrush ?? {})).toBe(false);

    const canvas = document.createElement('canvas');
    commitBrush?.commitCurrentStroke?.('layer-1');
    commitBrush?.commitToLayer?.(canvas, 'layer-1', 0.5);
    commitBrush?.bindGradientDefIdToSlot?.('layer-1', 7, 2);

    expect(brush.commitCurrentStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.commitToLayer).toHaveBeenCalledWith(canvas, 'layer-1', 0.5);
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith('layer-1', 7, 2);
  });

  it('exposes a stable speed-settings brush facade without render or lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const speedBrush = manager.getSpeedSettingsBrush('layer-1');
    const secondSpeedBrush = manager.getSpeedSettingsBrush('layer-1');

    expect(speedBrush).toBe(secondSpeedBrush);
    expect(speedBrush).not.toBe(brush);
    expect(Object.keys(speedBrush ?? {}).sort()).toEqual([
      'applySettings',
      'setSpeed',
    ]);
    expect('getCanvas' in (speedBrush ?? {})).toBe(false);
    expect('renderDirectToCanvas' in (speedBrush ?? {})).toBe(false);
    expect('setBrushSize' in (speedBrush ?? {})).toBe(false);
    expect('cleanup' in (speedBrush ?? {})).toBe(false);

    speedBrush?.applySettings?.({ cycleSpeed: 1 });
    speedBrush?.setSpeed?.(2);

    expect(brush.applySettings).toHaveBeenCalledWith({ cycleSpeed: 1 });
    expect(brush.setSpeed).toHaveBeenCalledWith(2);
  });

  it('exposes a stable shape-fill brush facade without lifecycle controls', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);

    const brush = manager.getBrush('layer-1') as unknown as MockBrush;
    const shapeFillBrush = manager.getShapeFillBrush('layer-1');
    const secondShapeFillBrush = manager.getShapeFillBrush('layer-1');

    expect(shapeFillBrush).toBe(secondShapeFillBrush);
    expect(shapeFillBrush).not.toBe(brush);
    expect(Object.keys(shapeFillBrush ?? {}).sort()).toEqual([
      'applySettings',
      'bindGradientDefIdToSlot',
      'commitCurrentStroke',
      'commitToLayer',
      'flush',
      'getCanvas',
      'getColorCycleLayerDocument',
      'isPlaying',
      'pause',
      'presentCurrentFrameToCanvas',
      'renderDirectToCanvas',
      'setActiveGradientSlot',
      'setDitherPixelSize',
      'setFlowDirection',
      'setFlowMode',
      'setGradient',
      'setGradientSlot',
      'setGradientSlotStops',
      'setLegacyFlowMode',
      'setPlaying',
      'setTargetCanvas',
      'startAnimation',
      'stopAnimation',
      'updateAnimation',
    ]);
    expect('setBrushSize' in (shapeFillBrush ?? {})).toBe(false);
    expect('cleanup' in (shapeFillBrush ?? {})).toBe(false);

    const canvas = document.createElement('canvas');
    shapeFillBrush?.applySettings?.({ ditherPixelSize: 3 });
    shapeFillBrush?.bindGradientDefIdToSlot?.('layer-1', 5, 2);
    shapeFillBrush?.commitToLayer?.(canvas, 'layer-1', 0.5);

    expect(brush.applySettings).toHaveBeenCalledWith({ ditherPixelSize: 3 });
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith('layer-1', 5, 2);
    expect(brush.commitToLayer).toHaveBeenCalledWith(canvas, 'layer-1', 0.5);
  });

  it('owns cold documents before a brush runtime is materialized', () => {
    const manager = createColorCycleBrushManager();
    const coldDocument = manager.ensureDocument('layer-1', 64, 64, {
      residency: 'cold-archive-ref',
      archiveRefs: {
        paintRef: 'buffers/color-cycle/layer-1/paint.bin',
        gradientIdRef: 'buffers/color-cycle/layer-1/gid.bin',
      },
    });

    expect(manager.getBrush('layer-1')).toBeUndefined();
    expect(manager.getRuntime('layer-1')).toBeUndefined();
    expect(manager.getDocument('layer-1')).toBe(coldDocument);
    expect(coldDocument.residency).toBe('cold-archive-ref');
    expect(coldDocument.archiveRefs).toEqual({
      paintRef: 'buffers/color-cycle/layer-1/paint.bin',
      gradientIdRef: 'buffers/color-cycle/layer-1/gid.bin',
    });
    expect(coldDocument.runtimePolicy).toMatchObject({
      hasEditableSource: true,
      hasRuntimeRestoreSource: true,
      isPreviewOnly: false,
    });
    expect(coldDocument.read().version).toBe(0);

    const brush = manager.createBrush('layer-1', 64, 64);

    expect(manager.getRuntime('layer-1')).toEqual(expect.objectContaining({
      layerId: 'layer-1',
      brush,
      document: coldDocument,
    }));
    expect(coldDocument.residency).toBe('resident');
    expect(coldDocument.archiveRefs).toBeNull();
    expect(coldDocument.read().version).toBe(1);
    expect(coldDocument.getAuditLog()).toEqual([expect.objectContaining({
      reason: 'project-load-restore',
      versionBefore: 0,
      versionAfter: 1,
    })]);
  });

  it('transfers brushes between layers and updates metadata', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-1', 32, 32);
    const sourceDocument = manager.getDocument('layer-1');
    expect(sourceDocument).toBeDefined();

    const transferred = manager.transferColorCycleBrush('layer-1', 'layer-2');
    expect(transferred).toBe(true);
    expect(manager.getBrush('layer-1')).toBeUndefined();
    expect(manager.getBrush('layer-2')).toBeDefined();
    expect(manager.getRuntime('layer-1')).toBeUndefined();
    expect(manager.getRuntime('layer-2')).toEqual(expect.objectContaining({
      layerId: 'layer-2',
      brush: manager.getBrush('layer-2'),
      document: sourceDocument,
    }));
    expect(manager.getDocument('layer-1')).toBeUndefined();
    expect(manager.getDocument('layer-2')).toBe(sourceDocument);
    expect(manager.getDocument('layer-2')?.read()).toEqual(expect.objectContaining({
      version: 1,
      snapshot: expect.objectContaining({
        layerId: 'layer-2',
        width: 32,
        height: 32,
      }),
    }));
    expect(manager.getDocument('layer-2')?.getAuditLog()).toEqual([expect.objectContaining({
      reason: 'layer-transfer',
      versionBefore: 0,
      versionAfter: 1,
    })]);
    expect(createdBrushes[0].removeColorCycleLayerDocument).toHaveBeenCalledWith('layer-1');
    expect(createdBrushes[0].setColorCycleLayerDocument).toHaveBeenLastCalledWith(
      'layer-2',
      sourceDocument,
    );
    expectLastCallBefore(createdBrushes[0].setColorCycleLayerDocument, createdBrushes[0].setLayerId);
  });

  it('cleans up inactive brushes using configured thresholds without dropping resident documents', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-a', 16, 16);
    const documentBeforeCleanup = manager.getDocument('layer-a');
    expect(documentBeforeCleanup).toBeDefined();

    const metadata = manager.brushMetadata.get('layer-a');
    expect(metadata).toBeDefined();
    if (metadata) {
      metadata.lastUsed = Date.now() - 120_000;
      metadata.isActive = false;
    }

    manager.cleanupInactive(60_000);
    expect(manager.getBrush('layer-a')).toBeUndefined();
    expect(manager.getRuntime('layer-a')).toBeUndefined();
    expect(manager.getDocument('layer-a')).toBe(documentBeforeCleanup);
  });

  it('cleans up stale warm-layer runtimes even when the layer still has a canvas reference', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-a', 16, 16);

    mockStoreState.layers = [{
      ...mockLayer,
      id: 'layer-a',
      colorCycleData: {
        ...mockLayer.colorCycleData,
        canvas: document.createElement('canvas'),
        runtimeHydrationState: 'warm',
        isAnimating: false,
      },
    }] as unknown as Layer[];

    const metadata = manager.brushMetadata.get('layer-a');
    expect(metadata).toBeDefined();
    if (metadata) {
      metadata.lastUsed = Date.now() - 120_000;
      metadata.isActive = false;
    }

    manager.cleanupInactive(60_000);
    expect(manager.getBrush('layer-a')).toBeUndefined();
  });

  it('rebuilds a disposed warm runtime on the next init request', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-a', 16, 16);
    const firstBrush = manager.getBrush('layer-a');

    mockStoreState.layers = [{
      ...mockLayer,
      id: 'layer-a',
      colorCycleData: {
        ...mockLayer.colorCycleData,
        canvas: document.createElement('canvas'),
        runtimeHydrationState: 'warm',
        isAnimating: false,
      },
    }] as unknown as Layer[];

    const metadata = manager.brushMetadata.get('layer-a');
    if (metadata) {
      metadata.lastUsed = Date.now() - 120_000;
      metadata.isActive = false;
    }

    manager.cleanupInactive(60_000);
    expect(manager.getBrush('layer-a')).toBeUndefined();

    expect(manager.initColorCycleForLayer('layer-a', 16, 16)).toBe(true);
    const rebuiltBrush = manager.getBrush('layer-a');
    expect(rebuiltBrush).toBeDefined();
    expect(rebuiltBrush).not.toBe(firstBrush);
  });

  it('preserves stale active-layer runtimes during inactive cleanup', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-a', 16, 16);

    mockStoreState.layers = [{
      ...mockLayer,
      id: 'layer-a',
      colorCycleData: {
        ...mockLayer.colorCycleData,
        canvas: document.createElement('canvas'),
        runtimeHydrationState: 'active',
        isAnimating: false,
      },
    }] as unknown as Layer[];

    const metadata = manager.brushMetadata.get('layer-a');
    if (metadata) {
      metadata.lastUsed = Date.now() - 120_000;
      metadata.isActive = false;
    }

    manager.cleanupInactive(60_000);
    expect(manager.getBrush('layer-a')).toBeDefined();
  });

  it('responds to feature-flag events by toggling canvas implementation', () => {
    const manager = getColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-flag', 8, 8);
    const brush = manager.getBrush('layer-flag') as unknown as MockBrush;

    window.dispatchEvent(new CustomEvent('vessel:featureFlagChange', {
      detail: { key: 'useCanvas2DColorCycle', value: true },
    }));

    expect(brush.setUseCanvas2D).toHaveBeenCalledWith(true);
  });
});

describe('refreshLayerCCSurface', () => {
  beforeEach(() => {
    mockUpdateLayer.mockClear();
  });

  it('updates stored layer canvas when brush surface changes', () => {
    const newCanvas = document.createElement('canvas');
    const brush = {
      getCanvas: () => newCanvas,
    } as unknown as Parameters<typeof refreshLayerCCSurface>[0];

    const result = refreshLayerCCSurface(brush, 'layer-a');

    expect(result).toBe(newCanvas);
    expect(mockUpdateLayer).toHaveBeenCalledWith(
      'layer-a',
      expect.objectContaining({
        colorCycleData: expect.objectContaining({ canvas: newCanvas }),
      }),
      { skipColorCycleSync: true }
    );
  });
});
