import { useAppStore } from '@/stores/useAppStore';
import {
  createDefaultToolState,
  defaultBrushSettingsForStore,
  defaultPressureSettings,
  defaultBrushEditorState,
  createDefaultRecolorSamplingState,
  createDefaultPolygonGradientState,
} from '@/stores/slices/toolsSlice';
import { brushPresets } from '@/presets/brushPresets';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { BrushShape, Project, type CustomBrush } from '@/types';
import { defaultCropState } from '@/stores/slices/cropSlice';

const createMockProject = (): Project => ({
  id: 'test-project',
  name: 'Test Project',
  width: 256,
  height: 256,
  layers: [],
  backgroundColor: '#ffffff',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
});

const resetToolsState = () => {
  const defaultPreset = brushPresets[0];
  useAppStore.setState((state) => ({
    ...state,
    project: createMockProject(),
    tools: createDefaultToolState(),
    pressureSettings: defaultPressureSettings,
    globalBrushSize: defaultBrushSettingsForStore.size ?? 5,
    temporaryCustomBrush: null,
    polygonGradientState: createDefaultPolygonGradientState(),
    recolorSampling: createDefaultRecolorSamplingState(),
    brushEditor: defaultBrushEditorState,
    brushSpecificSettings: {},
    currentBrushPreset: defaultPreset,
    activeBrushComponents: defaultPreset.components,
    palette: createDefaultPalette(),
  }));
};

describe('tools slice', () => {
  beforeEach(() => {
    resetToolsState();
  });

  it('updates pressure settings and palette via setBrushSettings', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({
      color: '#112233',
      pressureEnabled: false,
      minPressure: 25,
      maxPressure: 75,
    });

    const nextState = useAppStore.getState();
    expect(nextState.pressureSettings.enabled).toBe(false);
    expect(nextState.pressureSettings.min).toBe(25);
    expect(nextState.pressureSettings.max).toBe(75);
    expect(nextState.palette.foregroundColor).toBe('#112233');
  });

  it('toggles auto-sample color on brush settings', () => {
    const store = useAppStore.getState();
    expect(store.tools.brushSettings.autoSampleColor).toBeFalsy();
    store.setBrushSettings({ autoSampleColor: true });
    expect(useAppStore.getState().tools.brushSettings.autoSampleColor).toBe(true);
  });

  it('enables dither background fill by default', () => {
    const store = useAppStore.getState();
    expect(store.tools.brushSettings.ditherBackgroundFill).not.toBe(false);
    store.setBrushSettings({ ditherBackgroundFill: false });
    expect(useAppStore.getState().tools.brushSettings.ditherBackgroundFill).toBe(false);
  });

  it('persists dither gradient sample settings per brush', () => {
    const store = useAppStore.getState();
    const preset = brushPresets.find((candidate) => candidate.id === 'dither-gradient-brush');
    expect(preset).toBeTruthy();
    store.setBrushPreset(preset!, true);

    store.setBrushSettings({
      ditherGradSampleEnabled: true,
      ditherGradStops: ['#111111', '#222222'],
      trans: 1,
    });

    const state = useAppStore.getState();
    expect(state.tools.brushSettings.ditherGradSampleEnabled).toBe(true);
    const saved = state.brushSpecificSettings[preset!.id];
    expect(saved?.ditherGradSampleEnabled).toBe(true);
    expect(saved?.ditherGradStops).toEqual(['#111111', '#222222']);
  });

  it('keeps eraser size in sync when linking to brush size', () => {
    const store = useAppStore.getState();
    store.setGlobalBrushSize(18);
    store.setEraserSettings({ linkSizeToBrush: true });

    const eraserSize = useAppStore.getState().tools.eraserSettings.size;
    expect(eraserSize).toBe(18);
  });

  it('toggles custom brush capture source', () => {
    const store = useAppStore.getState();
    expect(store.tools.customBrushCapture.sampleAllLayers).toBe(false);
    store.setCustomBrushSampleAllLayers(true);
    expect(useAppStore.getState().tools.customBrushCapture.sampleAllLayers).toBe(true);
  });

  it('switches custom brush capture modes and resets freehand path', () => {
    const store = useAppStore.getState();
    expect(store.tools.customBrushCapture.mode).toBe('rectangle');
    store.setCustomBrushFreehandPath({
      points: [{ x: 0, y: 0 }],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(useAppStore.getState().tools.customBrushCapture.freehandPath?.points).toHaveLength(1);
    store.setCustomBrushCaptureMode('freehand');
    const capture = useAppStore.getState().tools.customBrushCapture;
    expect(capture.mode).toBe('freehand');
    expect(capture.freehandPath).toBeNull();
  });

  it('reuses stored gradients when switching to color cycle presets', () => {
    const store = useAppStore.getState();
    const gradientStops = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ];
    store.saveBrushSettings('color-cycle-stroke', {
      colorCycleGradient: gradientStops,
      colorCycleGradientVersion: 2,
    });

    const preset = brushPresets.find((p) => p.id === 'color-cycle-stroke');
    expect(preset).toBeTruthy();
    if (preset) {
      store.setBrushPreset(preset);
    }

    const nextGradient = useAppStore.getState().tools.brushSettings.colorCycleGradient;
    expect(nextGradient).toEqual(gradientStops);
  });

  it('manages recolor sampling lifecycle', () => {
    const store = useAppStore.getState();
    store.startRecolorSampling(10, 'brush');
    expect(useAppStore.getState().recolorSampling.active).toBe(true);

    store.updateRecolorSampling({ start: { x: 1, y: 2 } });
    expect(useAppStore.getState().recolorSampling.start).toEqual({ x: 1, y: 2 });

    store.stopRecolorSampling();
    expect(useAppStore.getState().recolorSampling.active).toBe(false);
  });

  describe('custom brush helpers', () => {
    it('resolves brushes via getCustomBrushById', () => {
      const brush: CustomBrush = {
        id: 'helper-brush',
        name: 'Helper Brush',
        imageData: new ImageData(4, 4),
        width: 4,
        height: 4,
        createdAt: Date.now(),
        thumbnail: '',
        naturalWidth: 4,
        naturalHeight: 4,
        maxDimension: 4,
      };

      const store = useAppStore.getState();
      store.addCustomBrush(brush);

      const resolved = useAppStore.getState().getCustomBrushById('helper-brush');
      expect(resolved?.id).toBe('helper-brush');
    });

    it('returns defensive copies from listCustomBrushes', () => {
      const brush: CustomBrush = {
        id: 'list-brush',
        name: 'List Brush',
        imageData: new ImageData(2, 2),
        width: 2,
        height: 2,
        createdAt: Date.now(),
        thumbnail: '',
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      };

      const store = useAppStore.getState();
      store.addCustomBrush(brush);

      const firstList = store.listCustomBrushes();
      expect(firstList).toHaveLength(1);
      firstList[0].imageData.data[0] = 255;

      const secondList = useAppStore.getState().listCustomBrushes();
      expect(secondList).toHaveLength(1);
      expect(secondList[0].imageData.data[0]).toBe(0);
    });

    it('saves a temporary custom brush via currentBrushTip fallback when cache is cleared', () => {
      const store = useAppStore.getState();
      const brushId = 'temp_brush_fallback';
      const imageData = new ImageData(4, 4);

      useAppStore.setState((state) => ({
        ...state,
        temporaryCustomBrush: null,
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            brushShape: BrushShape.CUSTOM,
            selectedCustomBrush: brushId,
            currentBrushTip: {
              imageData,
              brushId,
              isColorizable: false,
              width: 4,
              height: 4,
              naturalWidth: 4,
              naturalHeight: 4,
              maxDimension: 4,
            },
          },
        },
      }));

      store.saveCustomBrushAsPreset(brushId);

      const nextState = useAppStore.getState();
      expect(nextState.project?.customBrushes).toHaveLength(1);
      const savedBrush = nextState.project?.customBrushes[0];
      expect(savedBrush?.id).toBe(brushId);
      expect(savedBrush?.imageData.width).toBe(4);
      expect(savedBrush?.thumbnail).toMatch(/^data:image\/png;base64,/);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBe(brushId);
    });
  });

  describe('brush editor lifecycle', () => {
    it('enters editing mode and centers the brush when startBrushEdit is called', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;

      const store = useAppStore.getState();
      store.startBrushEdit('pixel-brush', canvas);

      const nextState = useAppStore.getState();
      expect(nextState.brushEditor.status).toBe('EDITING');
      expect(nextState.brushEditor.editingBrushId).toBe('pixel-brush');
      expect(nextState.tools.brushSettings.brushShape).toBe(BrushShape.CUSTOM);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBe('pixel-brush');
      const editorBounds = nextState.brushEditor.editingBounds;
      const expectedCenter = ((nextState.project?.width ?? canvas.width) - 32) / 2;
      expect(editorBounds).toEqual({ x: expectedCenter, y: expectedCenter, width: 32, height: 32 });
    });

    it('saves edited brushes as custom entries and updates the active brush tip', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx?.fillRect(0, 0, 64, 64);

      const store = useAppStore.getState();
      store.startBrushEdit('pixel-brush', canvas);
      store.saveBrushEdit(canvas);

      const nextState = useAppStore.getState();
      expect(nextState.brushEditor.status).toBe('IDLE');
      const brushes = nextState.listCustomBrushes();
      expect(brushes).toHaveLength(1);
      const savedBrush = brushes[0];
      expect(savedBrush).toBeDefined();
      expect(nextState.tools.brushSettings.brushShape).toBe(BrushShape.CUSTOM);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBe(savedBrush?.id ?? null);
      expect(nextState.tools.brushSettings.currentBrushTip?.brushId).toBe(savedBrush?.id);
    });

    it('cancels editing and resets brush selection when cancelBrushEdit runs', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;

      const store = useAppStore.getState();
      store.startBrushEdit('pixel-brush', canvas);
      store.cancelBrushEdit();

      const nextState = useAppStore.getState();
      expect(nextState.brushEditor.status).toBe('IDLE');
      expect(nextState.tools.brushSettings.brushShape).toBe(BrushShape.ROUND);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBeNull();
      expect(nextState.tools.brushSettings.currentBrushTip).toBeUndefined();
    });
  });

  it('resets crop state when leaving the crop tool', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        currentTool: 'crop',
      },
      crop: {
        status: 'ready',
        marquee: { x: 0, y: 0, width: 10, height: 10 },
        activeHandle: 'bottom-right',
        commitInFlight: false,
      },
    }));

    useAppStore.getState().setCurrentTool('brush');

    expect(useAppStore.getState().crop).toEqual(defaultCropState);
  });

  it('clears marquee selection when switching away from the selection tool', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        currentTool: 'selection',
      },
      selectionStart: { x: 1, y: 2 },
      selectionEnd: { x: 3, y: 4 },
    }));

    useAppStore.getState().setCurrentTool('brush');

    const { selectionStart, selectionEnd } = useAppStore.getState();
    expect(selectionStart).toBeNull();
    expect(selectionEnd).toBeNull();
  });
});
