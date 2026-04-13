import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { applyCroppedLayers } from '@/utils/crop/apply';
import { rebuildCCLayerAfterCrop } from '@/utils/crop/ccRebuild';
import * as cropHistory from '@/stores/helpers/cropHistory';
import type { Layer, Project } from '@/types';

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
      processLayer: jest.fn(),
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
      transparencyBackgroundMode: 'checker',
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
    seedCropState();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetStoreState();
  });

  it('records crop history and selection snapshots via helpers', async () => {
    const layerMap = new Map();
    const baseline = {
      projectSize: { width: 8, height: 6 },
      layerSnapshots: layerMap,
      selectionSnapshot: { start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
    };
    const captureSpy = jest
      .spyOn(cropHistory, 'captureCropHistoryBaseline')
      .mockReturnValue(baseline);
    const recordHistorySpy = jest
      .spyOn(cropHistory, 'recordCropHistory')
      .mockResolvedValue();
    const recordSelectionSpy = jest.spyOn(cropHistory, 'recordCropSelectionHistory');

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
        beforeLayers: baseline.layerSnapshots,
      }),
    );
    expect(recordSelectionSpy).toHaveBeenCalledWith({
      before: baseline.selectionSnapshot,
      after: expect.objectContaining({ start: null, end: null }),
      description: 'Crop selection reset',
    });
  });

  it('invokes color-cycle rebuild when crop returns brush reset entries', async () => {
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
          wasActiveLayer: true,
        },
      ],
      recolorRebuildQueue: [],
    });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rebuildCCLayerAfterCropMock).toHaveBeenCalledTimes(1);
    expect(rebuildCCLayerAfterCropMock.mock.calls[0][0].entries).toHaveLength(1);
  });
});
