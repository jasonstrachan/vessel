import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { applyCroppedLayers } from '@/utils/crop/apply';
import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import * as cropHistory from '@/stores/helpers/cropHistory';
import type { Layer, Project } from '@/types';
import historyManager from '@/history/historyService';

jest.mock('@/utils/crop/apply', () => ({
  applyCroppedLayers: jest.fn(),
}));

jest.mock('@/utils/crop/ccRebuild', () => ({
  rebuildCCLayerAfterCrop: jest.fn(),
  rebuildRecolorLayersAfterCrop: jest.fn(),
}));

jest.mock('@/lib/colorCycle/RecolorManager', () => ({
  RecolorManager: {
    getInstance: jest.fn(() => ({
      restoreLayer: jest.fn(),
    })),
  },
}));

const applyCroppedLayersMock = applyCroppedLayers as jest.MockedFunction<typeof applyCroppedLayers>;
const rebuildCCLayerAfterCropMock = rebuildCCLayerAfterCrop as jest.MockedFunction<typeof rebuildCCLayerAfterCrop>;

const blankImageData = new ImageData(1, 1);

const baseProject: Project = {
  id: 'project-test',
  name: 'Test Project',
  width: 8,
  height: 6,
  layers: [],
  backgroundColor: '#ffffff',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
};

const snapshotStoreSlice = () => {
  const state = useAppStore.getState();
  return {
    project: state.project,
    layers: state.layers,
    crop: state.crop,
    canvas: state.canvas,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    floatingPaste: state.floatingPaste,
    activeLayerId: state.activeLayerId,
  };
};

const initialSnapshot = snapshotStoreSlice();

const resetStoreState = () => {
  useAppStore.setState({
    project: initialSnapshot.project,
    layers: initialSnapshot.layers,
    crop: initialSnapshot.crop,
    canvas: initialSnapshot.canvas,
    selectionStart: initialSnapshot.selectionStart,
    selectionEnd: initialSnapshot.selectionEnd,
    floatingPaste: initialSnapshot.floatingPaste,
    activeLayerId: initialSnapshot.activeLayerId,
  });
};

const seedCropState = () => {
  useAppStore.setState((state) => ({
    ...state,
    project: { ...baseProject, layers: [] },
    layers: [],
    crop: {
      status: 'ready',
      marquee: { x: 1, y: 1, width: 2, height: 2 },
      activeHandle: 'bottom-right',
      commitInFlight: false,
    },
    canvas: {
      zoom: 1,
      rotation: 0,
      gridSize: 8,
      showRulers: true,
      showFPSMeter: false,
      showPixelGridAtMaxZoom: true,
      transparencyBackgroundMode: 'checker',
      frameColor: state.canvas.frameColor,
      displayMode: 'smooth',
      displayFilters: state.canvas.displayFilters,
      canvasWidth: baseProject.width,
      canvasHeight: baseProject.height,
      offsetX: 0,
      offsetY: 0,
      selection: {
        active: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        pixels: blankImageData,
      },
      cursor: { x: 0, y: 0, pressure: 0 },
    },
    selectionStart: null,
    selectionEnd: null,
    floatingPaste: null,
    activeLayerId: null,
  }));
};

const createLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: overrides.id ?? 'layer-1',
  name: overrides.name ?? 'Layer 1',
  visible: overrides.visible ?? true,
  opacity: overrides.opacity ?? 1,
  blendMode: overrides.blendMode ?? 'source-over',
  locked: overrides.locked ?? false,
  order: overrides.order ?? 0,
  imageData: overrides.imageData ?? null,
  framebuffer: overrides.framebuffer ?? document.createElement('canvas'),
  alignment: overrides.alignment ?? createDefaultLayerAlignment(),
  layerType: overrides.layerType ?? 'normal',
  colorCycleData: overrides.colorCycleData,
});

describe('cropSlice.commitCrop', () => {
  beforeEach(() => {
    historyManager.clear();
    seedCropState();
    jest.clearAllMocks();
  });

  afterEach(() => {
    historyManager.clear();
    jest.restoreAllMocks();
    resetStoreState();
  });

  it('records crop history and selection snapshots via helpers', async () => {
    const layerMap = new Map();
    const baseline = {
      projectSize: { width: 8, height: 6 },
      layerSnapshots: layerMap,
      selectionSnapshot: { start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
      txtShapes: [],
      uiShapes: [],
    };
    const captureSpy = jest
      .spyOn(cropHistory, 'captureCropHistoryBaseline')
      .mockReturnValue(baseline);
    const recordHistorySpy = jest
      .spyOn(cropHistory, 'recordCropHistory')
      .mockImplementation(async ({ txn }) => { txn.cancel(); });

    const updatedLayer = createLayer();
    applyCroppedLayersMock.mockReturnValue({
      updatedProject: { ...baseProject, width: 4, height: 4 },
      updatedLayers: [updatedLayer],
      colorCycleBrushResets: [],
      recolorRebuildQueue: [],
    });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captureSpy).toHaveBeenCalled();
    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeProject: baseline.projectSize,
        txn: expect.objectContaining({ push: expect.any(Function), commit: expect.any(Function), cancel: expect.any(Function) }),
        beforeLayers: baseline.layerSnapshots,
        beforeSelection: baseline.selectionSnapshot,
        afterSelection: expect.objectContaining({ start: null, end: null }),
      }),
    );
  });

  it('releases the admitted transaction when the crop owner throws before publication', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    applyCroppedLayersMock.mockImplementationOnce(() => {
      throw new Error('crop readback failed');
    });
    await useAppStore.getState().commitCrop();
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().crop.commitInFlight).toBe(false);
    expect(errorLog).toHaveBeenCalledWith('[crop] Failed to commit crop', expect.any(Error));
    const next = historyManager.begin('selection-change');
    next.cancel();
  });

  it('does not overwrite a replacement project when admitted history preparation rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let rejectPreparation!: (error: Error) => void;
    jest.spyOn(cropHistory, 'recordCropHistory').mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPreparation = reject;
    }));
    applyCroppedLayersMock.mockReturnValue({
      updatedProject: { ...baseProject, width: 2, height: 2 },
      updatedLayers: [createLayer()], colorCycleBrushResets: [], recolorRebuildQueue: [],
    });
    const pending = useAppStore.getState().commitCrop();
    const replacement = { ...baseProject, id: 'replacement-project', width: 17, height: 19 };
    const replacementCrop = { status: 'ready' as const, marquee: { x: 2, y: 3, width: 4, height: 5 }, activeHandle: null, commitInFlight: true };
    const replacementLayer = createLayer({ id: 'replacement-layer' });
    useAppStore.setState({ project: replacement, layers: [replacementLayer], crop: replacementCrop });
    rejectPreparation(new Error('late old-project blob rejection'));
    await pending;
    expect(useAppStore.getState().project).toBe(replacement);
    expect(useAppStore.getState().layers).toEqual([replacementLayer]);
    expect(useAppStore.getState().crop).toBe(replacementCrop);
  });

  it('retains unrelated settings changed while crop history awaits storage', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let rejectPreparation!: (error: Error) => void;
    jest.spyOn(cropHistory, 'recordCropHistory').mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectPreparation = reject;
    }));
    applyCroppedLayersMock.mockReturnValue({
      updatedProject: { ...baseProject, width: 2, height: 2 },
      updatedLayers: [createLayer()], colorCycleBrushResets: [], recolorRebuildQueue: [],
    });
    const before = useAppStore.getState();
    const pending = before.commitCrop();
    useAppStore.setState((current) => ({
      project: { ...current.project!, name: 'Renamed during preparation' },
      canvas: { ...current.canvas, showRulers: false },
    }));
    rejectPreparation(new Error('late blob rejection'));
    await pending;
    const failed = useAppStore.getState();
    expect(failed.project).toMatchObject({ width: baseProject.width, height: baseProject.height, name: 'Renamed during preparation' });
    expect(failed.canvas.showRulers).toBe(false);
    expect(failed.crop).toEqual(before.crop);
  });

  it('awaits Recolor restoration before publishing crop history', async () => {
    let finishRebuild!: () => void;
    jest.mocked(rebuildRecolorLayersAfterCrop).mockReturnValueOnce(new Promise<void>((resolve) => {
      finishRebuild = resolve;
    }));
    const recordSpy = jest.spyOn(cropHistory, 'recordCropHistory')
      .mockImplementation(async ({ txn }) => { txn.cancel(); });
    const layer = createLayer({ layerType: 'color-cycle', colorCycleData: { mode: 'recolor' } });
    applyCroppedLayersMock.mockReturnValue({
      updatedProject: { ...baseProject },
      updatedLayers: [layer],
      colorCycleBrushResets: [],
      recolorRebuildQueue: [{ id: layer.id }],
    });
    const pending = useAppStore.getState().commitCrop();
    await Promise.resolve();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().crop.commitInFlight).toBe(true);
    finishRebuild();
    await pending;
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().crop.commitInFlight).toBe(false);
  });

  it('invokes color-cycle rebuild when crop returns brush reset entries', async () => {
    let finishRebuild!: () => void;
    const rebuild = new Promise<void>((resolve) => { finishRebuild = resolve; });
    rebuildCCLayerAfterCropMock.mockReturnValueOnce(rebuild);
    const recordSpy = jest.spyOn(cropHistory, 'recordCropHistory')
      .mockImplementation(async ({ txn }) => { txn.cancel(); });

    const ccLayer = createLayer({
      id: 'layer-cc',
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        gradient: [
          { position: 0, color: '#000' },
          { position: 1, color: '#fff' },
        ],
        isAnimating: true,
        canvas: document.createElement('canvas'),
      },
    });

    applyCroppedLayersMock.mockReturnValue({
      updatedProject: { ...baseProject },
      updatedLayers: [ccLayer],
      colorCycleBrushResets: [
        {
          id: 'layer-cc',
          width: 4,
          height: 4,
          croppedCanvas: null,
          imageData: null,
          wasAnimating: true,
          wasPlaying: true,
          wasActiveLayer: true,
        },
      ],
      recolorRebuildQueue: [],
    });

    const pending = useAppStore.getState().commitCrop();
    await Promise.resolve();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().crop.commitInFlight).toBe(true);
    finishRebuild();
    await pending;
    expect(recordSpy).toHaveBeenCalledTimes(1);

    expect(rebuildCCLayerAfterCropMock).toHaveBeenCalledTimes(1);
    expect(rebuildCCLayerAfterCropMock.mock.calls[0][0].entries).toHaveLength(1);
  });
});
