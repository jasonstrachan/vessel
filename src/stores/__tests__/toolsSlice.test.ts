import { useAppStore } from '@/stores/useAppStore';
import {
  createDefaultToolState,
  defaultBrushSettingsForStore,
  defaultPressureSettings,
  defaultBrushEditorState,
  createDefaultRecolorSamplingState,
  createDefaultPolygonGradientState,
  defaultShapeState,
} from '@/stores/slices/toolsSlice';
import { brushPresets, mosaicBrushPreset } from '@/presets/brushPresets';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';
import { BrushShape, Project, type CustomBrush } from '@/types';
import { defaultCropState } from '@/stores/slices/cropSlice';
import { DEFAULT_RECTANGLE_BRUSH_STATE } from '@/stores/helpers/toolsState';

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
    ccBrushDitherSelection: {
      ditherAlgorithm: defaultBrushSettingsForStore.ditherAlgorithm,
      patternStyle: defaultBrushSettingsForStore.patternStyle,
    },
    shapeState: defaultShapeState,
    rectangleBrushState: DEFAULT_RECTANGLE_BRUSH_STATE,
    currentBrushPreset: defaultPreset,
    activeBrushComponents: defaultPreset.components,
    palette: createDefaultPalette(),
  }));
};

describe('tools slice', () => {
  beforeEach(() => {
    resetToolsState();
  });

  it('restores the Dither Grad drawing shape after switching brushes', () => {
    const preset = brushPresets.find(entry => entry.id === 'dither-grad')!;
    useAppStore.getState().setBrushPreset(preset, true);
    useAppStore.getState().setBrushSettings({ ditherGradDrawingShape: 'ellipse' });
    expect(useAppStore.getState().brushSpecificSettings['dither-grad'].ditherGradDrawingShape).toBe('ellipse');
    useAppStore.getState().setBrushPreset(brushPresets[0], true);
    useAppStore.getState().setBrushPreset(preset, true);
    expect(useAppStore.getState().tools.brushSettings.ditherGradDrawingShape).toBe('ellipse');
  });

  it('shares the foreground recipe across CC and regular preset switches', () => {
    useAppStore.getState().setBrushSettings({ colorCycleFgContrast: 63, colorCycleFgColors: 6 });
    for (const id of ['color-cycle-stroke', 'color-cycle-gradient', 'color-cycle-flat-dither', 'color-cycle-triangle', 'color-cycle-shape', 'checkered', 'mosaic', 'color-cycle-stroke']) {
      const preset = brushPresets.find(entry => entry.id === id)!;
      expect(preset).toBeDefined();
      useAppStore.getState().setBrushPreset(preset, true);
      useAppStore.getState().setPaletteColor('foreground', '#775533');
      expect(useAppStore.getState().tools.brushSettings).toMatchObject({
        colorCycleFgContrast: 63, colorCycleFgColors: 6,
      });
    }
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

  it('returns early when setBrushSettings receives an empty patch', () => {
    const before = useAppStore.getState();
    before.setBrushSettings({});
    const after = useAppStore.getState();

    expect(after).toBe(before);
  });

  it('returns early when setBrushSettings receives the same color', () => {
    const before = useAppStore.getState();
    const currentColor = before.tools.brushSettings.color;
    before.setBrushSettings({ color: currentColor });
    const after = useAppStore.getState();

    expect(after).toBe(before);
  });

  it('toggles auto-sample color on brush settings', () => {
    const store = useAppStore.getState();
    expect(store.tools.brushSettings.autoSampleColor).toBeFalsy();
    store.setBrushSettings({ autoSampleColor: true });
    expect(useAppStore.getState().tools.brushSettings.autoSampleColor).toBe(true);
  });

  it('persists pencil controls without changing the selected dither mode', () => {
    const stroke = brushPresets.find((preset) => preset.id === 'color-cycle-stroke')!;
    const shape = brushPresets.find((preset) => preset.id === 'color-cycle-shape')!;
    useAppStore.getState().setBrushPreset(stroke, true);
    useAppStore.getState().setBrushSettings({ colorCycleStampDitherEnabled: true });
    useAppStore.getState().setBrushSettings({ colorCyclePencilEnabled: true, colorCyclePencilSensitivity: 75, colorCycleStampDitherPixelSize: 4 });
    expect(useAppStore.getState().tools.brushSettings.colorCycleStampDitherEnabled).toBe(true);
    useAppStore.getState().setBrushPreset(shape, true);
    useAppStore.getState().setBrushPreset(stroke, true);
    expect(useAppStore.getState().tools.brushSettings).toMatchObject({ colorCyclePencilEnabled: true, colorCyclePencilSensitivity: 75, colorCycleStampDitherPixelSize: 4 });
    useAppStore.getState().setBrushSettings({ colorCycleStampDitherEnabled: true });
    expect(useAppStore.getState().tools.brushSettings.colorCyclePencilEnabled).toBe(true);
  });

  it('retains bristles when returning to the CC Stroke preset', () => {
    const stroke = brushPresets.find((preset) => preset.id === 'color-cycle-stroke')!;
    const shape = brushPresets.find((preset) => preset.id === 'color-cycle-shape')!;
    useAppStore.getState().setBrushPreset(stroke, true);
    useAppStore.getState().setBrushSettings({ colorCycleBristlesEnabled: true, colorCycleBristleWidth: 1.5, colorCycleBristleStrength: 12 });
    useAppStore.getState().setBrushPreset(shape, true);
    useAppStore.getState().setBrushPreset(stroke, true);
    expect(useAppStore.getState().tools.brushSettings.colorCycleBristlesEnabled).toBe(true);
    expect(useAppStore.getState().tools.brushSettings.colorCycleBristleWidth).toBe(1.5);
    expect(useAppStore.getState().tools.brushSettings.colorCycleBristleStrength).toBe(12);
  });

  it.each([[NaN, 25], [Infinity, 25], [-5, 0], [120, 100], [0, 0]])(
    'normalizes bristle strength %s before saving the preset', (incoming, expected) => {
      const stroke = brushPresets.find((preset) => preset.id === 'color-cycle-stroke')!;
      const shape = brushPresets.find((preset) => preset.id === 'color-cycle-shape')!;
      useAppStore.getState().setBrushPreset(stroke, true);
      useAppStore.getState().setBrushSettings({ colorCycleBristleStrength: incoming });
      expect(useAppStore.getState().tools.brushSettings.colorCycleBristleStrength).toBe(expected);
      useAppStore.getState().setBrushPreset(shape, true);
      useAppStore.getState().setBrushPreset(stroke, true);
      expect(useAppStore.getState().tools.brushSettings.colorCycleBristleStrength).toBe(expected);
    },
  );

  it('persists colour pickup independently for each CC preset without changing its source', () => {
    const stroke = brushPresets.find((preset) => preset.id === 'color-cycle-stroke')!;
    const shape = brushPresets.find((preset) => preset.id === 'color-cycle-shape')!;
    expect(stroke).toBeTruthy();
    expect(shape).toBeTruthy();
    useAppStore.getState().setBrushPreset(stroke, true);
    const source = useAppStore.getState().tools.ccGradientSource;
    useAppStore.getState().setBrushSettings({ colorCyclePickupEnabled: true });
    expect(useAppStore.getState().tools.ccGradientSource).toBe(source);
    useAppStore.getState().setBrushPreset(shape, true);
    useAppStore.getState().setBrushSettings({ colorCyclePickupEnabled: false });
    useAppStore.getState().setBrushPreset(stroke, true);
    expect(useAppStore.getState().tools.brushSettings.colorCyclePickupEnabled).toBe(true);
    expect(useAppStore.getState().brushSpecificSettings[stroke.id]?.colorCyclePickupEnabled).toBe(true);
    useAppStore.getState().setBrushPreset(shape, true);
    expect(useAppStore.getState().tools.brushSettings.colorCyclePickupEnabled).toBe(false);
  });

  it('persists CC layer speed scale in brush settings overrides', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({ colorCycleLayerSpeedScale: 0.6 });

    const state = useAppStore.getState();
    expect(state.tools.brushSettings.colorCycleLayerSpeedScale).toBe(0.6);
    const presetId = state.currentBrushPreset?.id;
    expect(presetId).toBeTruthy();
    if (!presetId) {
      return;
    }
    expect(state.brushSpecificSettings[presetId]?.colorCycleLayerSpeedScale).toBe(0.6);
  });

  it('persists color cycle gradient timing and mode settings when changed incrementally', () => {
    const store = useAppStore.getState();
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(gradientPreset).toBeTruthy();
    if (!gradientPreset) {
      return;
    }

    store.setBrushPreset(gradientPreset, true);
    store.setBrushSettings({
      colorCycleSpeed: 0.42,
      colorCycleFPS: 48,
      colorCycleFillMode: 'concentric',
      colorCycleGradientSeamProfile: 'soft',
      velocityAnimationSpeedEnabled: true,
      fillResolution: 9,
      ccDitherInkColors: 7,
      pressureLinkedFillResolution: true,
      pressureLinkedFillMaxResolution: 21,
    });

    const state = useAppStore.getState();
    const saved = state.brushSpecificSettings['color-cycle-gradient'];
    expect(saved).toEqual(
      expect.objectContaining({
        colorCycleSpeed: 0.42,
        colorCycleFPS: 48,
        colorCycleFillMode: 'concentric',
        colorCycleGradientSeamProfile: 'soft',
        velocityAnimationSpeedEnabled: true,
        fillResolution: 9,
        ccDitherInkColors: 7,
        pressureLinkedFillResolution: true,
        pressureLinkedFillMaxResolution: 21,
      })
    );
  });

  it('keeps the brush seam when an authored Manual gradient is edited', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({
      colorCycleGradientSeamProfile: 'soft',
      colorCycleGradientIsRuntimePalette: true,
    });

    store.commitColorCycleGradientDraft([
      { position: 0, color: '#123456' },
      { position: 1, color: '#abcdef' },
    ]);

    expect(useAppStore.getState().tools.brushSettings).toEqual(
      expect.objectContaining({
        colorCycleGradient: [
          { position: 0, color: '#123456' },
          { position: 1, color: '#abcdef' },
        ],
        colorCycleGradientSeamProfile: 'soft',
        colorCycleGradientIsRuntimePalette: false,
      }),
    );
  });

  it('caps authored color cycle speed before storing it', () => {
    const store = useAppStore.getState();
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(gradientPreset).toBeTruthy();
    if (!gradientPreset) {
      return;
    }

    store.setBrushPreset(gradientPreset, true);
    store.setBrushSettings({ colorCycleSpeed: 2.2 });

    const state = useAppStore.getState();
    expect(state.tools.brushSettings.colorCycleSpeed).toBe(1.5);
    expect(state.brushSpecificSettings['color-cycle-gradient']?.colorCycleSpeed).toBe(1.5);
  });

  it('defaults standard color-cycle presets to 30 FPS', () => {
    const presetIds = [
      'color-cycle-stroke',
      'color-cycle-triangle',
      'color-cycle-shape',
      'color-cycle-gradient',
    ];

    presetIds.forEach((presetId) => {
      const preset = brushPresets.find((candidate) => candidate.id === presetId);
      expect(preset?.preferredSettings?.colorCycleFPS).toBe(30);
    });
  });

  it('mirrors playback speed scale into persisted brush settings', () => {
    const store = useAppStore.getState();
    const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
    expect(strokePreset).toBeTruthy();
    if (!strokePreset) {
      return;
    }

    store.setBrushPreset(strokePreset, true);
    store.setPlaybackSpeedScale(0.6);

    const state = useAppStore.getState();
    expect(state.colorCyclePlayback.playbackSpeedScale).toBe(0.6);
    expect(state.tools.brushSettings.colorCycleLayerSpeedScale).toBe(0.6);
    expect(state.brushSpecificSettings['color-cycle-stroke']?.colorCycleLayerSpeedScale).toBe(0.6);
  });

  it('enables dither background fill by default', () => {
    const store = useAppStore.getState();
    expect(store.tools.brushSettings.ditherBackgroundFill).not.toBe(false);
    store.setBrushSettings({ ditherBackgroundFill: false });
    expect(useAppStore.getState().tools.brushSettings.ditherBackgroundFill).toBe(false);
  });

  it('persists dither gradient sample settings per brush', () => {
    const store = useAppStore.getState();
    const preset = brushPresets.find((candidate) => candidate.id === 'dither-grad');
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

  it('retains project-local dither gradient tile settings in project brush state', () => {
    const store = useAppStore.getState();
    const preset = brushPresets.find((candidate) => candidate.id === 'dither-grad');
    expect(preset).toBeTruthy();
    store.setBrushPreset(preset!, true);

    store.saveBrushSettings(preset!.id, {
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
      patternTileId: 'old-tile',
      patternTilePackId: 'old-pack',
      patternTileSelectionMode: 'pack-random',
    });
    store.setBrushSettings({
      patternStyle: 'image-tile',
      patternTileId: 'new-tile',
      patternTilePackId: 'new-pack',
      patternTileSelectionMode: 'single',
      patternTileScale: 3,
      patternTileInvert: true,
      patternTileThreshold: 0.4,
      patternTileOffsetX: 2,
      patternTileOffsetY: -1,
    });

    const saved = useAppStore.getState().brushSpecificSettings[preset!.id];
    expect(saved?.ditherAlgorithm).toBe('pattern');
    expect(saved?.patternStyle).toBe('image-tile');
    expect(saved?.patternTileId).toBe('new-tile');
    expect(saved?.patternTilePackId).toBe('new-pack');
    expect(saved?.patternTileSelectionMode).toBe('single');
    expect(saved?.patternTileScale).toBe(3);
    expect(saved?.patternTileInvert).toBe(true);
    expect(saved?.patternTileThreshold).toBe(0.4);
    expect(saved?.patternTileOffsetX).toBe(2);
    expect(saved?.patternTileOffsetY).toBe(-1);

    const loaded = useAppStore.getState().loadBrushSettings(preset!.id);
    expect(loaded).toEqual(expect.objectContaining({
      patternStyle: 'image-tile',
      patternTileId: 'new-tile',
      patternTilePackId: 'new-pack',
      patternTileSelectionMode: 'single',
      patternTileScale: 3,
      patternTileInvert: true,
      patternTileThreshold: 0.4,
      patternTileOffsetX: 2,
      patternTileOffsetY: -1,
    }));
  });

  it('keeps pressure-linked dither resolution settings in sync across dither stroke and shape presets', () => {
    const store = useAppStore.getState();
    const ditherShapePreset = brushPresets.find((candidate) => candidate.id === 'dither-shape');
    expect(ditherShapePreset).toBeTruthy();
    store.setBrushPreset(ditherShapePreset!, true);

    store.setBrushSettings({
      pressureLinkedFillResolution: true,
      fillResolution: 137,
      pressureLinkedFillMaxResolution: 222,
      pressureDitherSmoosh: true,
    });

    const state = useAppStore.getState();
    expect(state.brushSpecificSettings['dither-shape']).toEqual(
      expect.objectContaining({
        pressureLinkedFillResolution: true,
        fillResolution: 137,
        pressureLinkedFillMaxResolution: 222,
        pressureDitherSmoosh: true,
      })
    );
    expect(state.brushSpecificSettings['dither-stroke']).toEqual(
      expect.objectContaining({
        pressureLinkedFillResolution: true,
        fillResolution: 137,
        pressureLinkedFillMaxResolution: 222,
        pressureDitherSmoosh: true,
      })
    );
  });

  it('persists algorithm and built-in pattern choices for dither stroke brushes', () => {
    const store = useAppStore.getState();
    const preset = brushPresets.find((candidate) => candidate.id === 'dither-stroke');
    expect(preset).toBeTruthy();
    store.setBrushPreset(preset!, true);

    store.setBrushSettings({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });

    expect(useAppStore.getState().brushSpecificSettings['dither-stroke']).toEqual(
      expect.objectContaining({
        ditherAlgorithm: 'pattern',
        patternStyle: 'crosshatch',
      })
    );
  });

  it('defaults Dither Shape to fill-only edges', () => {
    const ditherShapePreset = brushPresets.find((candidate) => candidate.id === 'dither-shape');

    expect(ditherShapePreset?.preferredSettings).toEqual(
      expect.objectContaining({ pxlEdge: false })
    );
  });

  it('stores CC dither selection globally instead of per brush', () => {
    const store = useAppStore.getState();
    const colorCycleStrokePreset = brushPresets.find((candidate) => candidate.id === 'color-cycle-stroke');
    expect(colorCycleStrokePreset).toBeTruthy();
    store.setBrushPreset(colorCycleStrokePreset!, true);

    store.setBrushSettings({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });

    const state = useAppStore.getState();
    expect(state.ccBrushDitherSelection).toEqual({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });
    expect(state.brushSpecificSettings[colorCycleStrokePreset!.id]?.ditherAlgorithm).toBeUndefined();
    expect(state.brushSpecificSettings[colorCycleStrokePreset!.id]?.patternStyle).toBeUndefined();
  });

  it('persists mosaic brush settings per brush', () => {
    const store = useAppStore.getState();
    store.setBrushPreset(mosaicBrushPreset);

    store.setBrushSettings({
      mosaicTilePx: 9,
      mosaicBlocksCount: 7,
      mosaicPaletteCount: 5,
      mosaicSegmentPx: 120,
      mosaicSegmentJitter: 42,
      mosaicDitherEnabled: true,
    });

    const saved = useAppStore.getState().brushSpecificSettings[mosaicBrushPreset.id];
    expect(saved?.mosaicTilePx).toBe(9);
    expect(saved?.mosaicBlocksCount).toBe(7);
    expect(saved?.mosaicPaletteCount).toBe(5);
    expect(saved?.mosaicSegmentPx).toBe(120);
    expect(saved?.mosaicSegmentJitter).toBe(42);
    expect(saved?.mosaicDitherEnabled).toBe(true);
  });

  it('persists custom brush snap in brush-specific settings', () => {
    const store = useAppStore.getState();
    const customBrush: CustomBrush = {
      id: 'grid-tip',
      name: 'Grid Tip',
      imageData: new ImageData(12, 6),
      width: 12,
      height: 6,
      createdAt: Date.now(),
      thumbnail: '',
      naturalWidth: 12,
      naturalHeight: 6,
      maxDimension: 12,
    };

    store.addCustomBrush(customBrush);
    store.setBrushPreset(createCustomBrushPreset(customBrush));
    store.setBrushSettings({ customBrushSnapEnabled: true });

    const state = useAppStore.getState();
    const presetId = state.currentBrushPreset?.id;
    expect(state.tools.brushSettings.customBrushSnapEnabled).toBe(true);
    expect(presetId).toBe(`custom_${customBrush.id}`);
    if (!presetId) {
      return;
    }
    expect(state.brushSpecificSettings[presetId]?.customBrushSnapEnabled).toBe(true);
  });

  it('keeps eraser size in sync when linking to brush size', () => {
    const store = useAppStore.getState();
    store.setGlobalBrushSize(18);
    store.setEraserSettings({ linkSizeToBrush: true });

    const eraserSize = useAppStore.getState().tools.eraserSettings.size;
    expect(eraserSize).toBe(18);
  });

  it('sanitizes eraser tip shape to supported options only', () => {
    const store = useAppStore.getState();
    store.setEraserSettings({ brushShape: BrushShape.MOSAIC, ditherStrokeTipShape: 'triangle' });

    const eraser = useAppStore.getState().tools.eraserSettings;
    expect(eraser.brushShape).toBe(BrushShape.SQUARE);
    expect(eraser.ditherStrokeTipShape).toBe('square');
    expect(eraser.antialiasing).toBe(false);
  });

  it('returns early when setEraserSettings receives an empty patch', () => {
    const before = useAppStore.getState();
    before.setEraserSettings({});
    const after = useAppStore.getState();

    expect(after).toBe(before);
  });

  it('returns early when setEraserSettings receives the same color', () => {
    const before = useAppStore.getState();
    const currentColor = before.tools.eraserSettings.color;
    before.setEraserSettings({ color: currentColor });
    const after = useAppStore.getState();

    expect(after).toBe(before);
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

  it('switches selection mode', () => {
    const store = useAppStore.getState();
    expect(store.tools.selectionMode).toBe('marquee');

    store.setSelectionMode('freehand');
    expect(useAppStore.getState().tools.selectionMode).toBe('freehand');

    store.setSelectionMode('click-line');
    expect(useAppStore.getState().tools.selectionMode).toBe('click-line');

    store.setSelectionMode('magic-wand');
    expect(useAppStore.getState().tools.selectionMode).toBe('magic-wand');
  });

  it('initializes magic wand settings with expected defaults', () => {
    const state = useAppStore.getState();
    expect(state.tools.wandSettings).toEqual({
      threshold: 0,
      contiguous: true,
    });
  });

  it('updates magic wand settings', () => {
    const store = useAppStore.getState();
    store.setWandSettings({ threshold: 24, contiguous: false });

    expect(useAppStore.getState().tools.wandSettings).toEqual({
      threshold: 24,
      contiguous: false,
    });
  });

  it('falls back to legacy stored gradients when the shared palette is unavailable', () => {
    const store = useAppStore.getState();
    const gradientStops = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ];
    store.saveBrushSettings('color-cycle-stroke', {
      colorCycleGradient: gradientStops,
      colorCycleGradientVersion: 2,
    });
    useAppStore.setState((state) => ({
      palette: {
        ...state.palette,
        colorCycleGradients: undefined,
        activeColorCycleGradientId: undefined,
      },
    }));

    const preset = brushPresets.find((p) => p.id === 'color-cycle-stroke');
    expect(preset).toBeTruthy();
    if (preset) {
      store.setBrushPreset(preset);
    }

    const nextGradient = useAppStore.getState().tools.brushSettings.colorCycleGradient;
    expect(nextGradient).toEqual(gradientStops);
  });

  it('treats color-cycle opacity-only gradient edits as distinct changes', () => {
    const store = useAppStore.getState();
    const baseStops = [
      { position: 0, color: '#ff0000', opacity: 1 },
      { position: 1, color: '#00ff00', opacity: 1 },
    ];
    const opacityEditedStops = [
      { position: 0, color: '#ff0000', opacity: 1 },
      { position: 1, color: '#00ff00', opacity: 0.25 },
    ];

    store.setBrushSettings({ colorCycleGradient: baseStops });
    const versionBefore = useAppStore.getState().tools.brushSettings.colorCycleGradientVersion ?? 0;

    store.setBrushSettings({ colorCycleGradient: opacityEditedStops });

    const state = useAppStore.getState().tools.brushSettings;
    expect(state.colorCycleGradient).toEqual(opacityEditedStops);
    expect((state.colorCycleGradientVersion ?? 0)).toBeGreaterThan(versionBefore);
  });

  it('prefers the active shared gradient when switching between color-cycle brushes', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({ colorCycleGradientSeamProfile: 'hard' });
    const paletteStops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#aabbcc' },
    ];
    const storedStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    store.saveBrushSettings('color-cycle-stroke', {
      colorCycleGradient: storedStops,
      colorCycleGradientVersion: 5,
    });

    useAppStore.setState((state) => ({
      ...state,
      palette: {
        ...state.palette,
        colorCycleGradients: [{
          id: 'shared-gradient',
          stops: paletteStops,
        }],
        activeColorCycleGradientId: 'shared-gradient',
      },
    }));

    const preset = brushPresets.find((p) => p.id === 'color-cycle-stroke');
    expect(preset).toBeTruthy();
    if (preset) {
      store.setBrushPreset(preset);
    }

    const nextGradient = useAppStore.getState().tools.brushSettings.colorCycleGradient;
    expect(nextGradient).toEqual(paletteStops);
    expect(nextGradient).not.toEqual(storedStops);
    expect(
      useAppStore.getState().tools.brushSettings.colorCycleGradientSeamProfile ?? 'hard',
    ).toBe('hard');
    expect(useAppStore.getState().tools.brushSettings.ccGradientSource).toBe('manual');
  });

  it.each(['sampled', 'fg'] as const)(
    'preserves %s source intent when switching between color-cycle brushes',
    (source) => {
      const store = useAppStore.getState();
      const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
      const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
      expect(gradientPreset).toBeTruthy();
      expect(strokePreset).toBeTruthy();
      if (!gradientPreset || !strokePreset) {
        return;
      }

      store.setBrushPreset(gradientPreset);
      useAppStore.getState().setCcGradientSource(source);
      useAppStore.getState().setBrushPreset(strokePreset);

      const state = useAppStore.getState();
      expect(state.tools.ccGradientSource).toBe(source);
      expect(state.tools.brushSettings.ccGradientSource).toBe(source);
      expect(state.tools.brushSettings.colorCycleUseForegroundGradient).toBe(source === 'fg');
    },
  );

  it.each(['sampled', 'fg'] as const)(
    'preserves %s through a regular preset with saved Palette settings',
    (source) => {
      const regular = brushPresets.find((preset) => preset.id === 'pixel-square')!;
      const stroke = brushPresets.find((preset) => preset.id === 'color-cycle-stroke')!;
      useAppStore.getState().setBrushPreset(regular);
      useAppStore.getState().setCcGradientSource('manual');
      useAppStore.getState().setBrushPreset(stroke);
      useAppStore.getState().setCcGradientSource(source);

      for (const preset of [regular, stroke, regular, stroke]) {
        useAppStore.getState().setBrushPreset(preset);
        const { tools } = useAppStore.getState();
        expect(tools.ccGradientSource).toBe(source);
        expect(tools.brushSettings.ccGradientSource).toBe(source);
        expect(tools.brushSettings.colorCycleUseForegroundGradient).toBe(source === 'fg');
      }
    },
  );

  it('stores color cycle fill mode only for the gradient preset', () => {
    const store = useAppStore.getState();
    store.saveBrushSettings('color-cycle-gradient', { colorCycleFillMode: 'concentric' });
    store.saveBrushSettings('color-cycle-stroke', { colorCycleFillMode: 'linear' });

    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
    expect(gradientPreset).toBeTruthy();
    expect(strokePreset).toBeTruthy();

    if (gradientPreset) {
      store.setBrushPreset(gradientPreset);
    }
    expect(useAppStore.getState().tools.brushSettings.colorCycleFillMode).toBe('concentric');

    if (strokePreset) {
      store.setBrushPreset(strokePreset);
    }
    expect(useAppStore.getState().tools.brushSettings.colorCycleFillMode).toBe(
      defaultBrushSettingsForStore.colorCycleFillMode
    );
  });

  it('stores CC gradient drawing shape only for the gradient preset', () => {
    const store = useAppStore.getState();
    store.saveBrushSettings('color-cycle-gradient', { ccGradientDrawingShape: 'ellipse' });
    store.saveBrushSettings('color-cycle-stroke', { ccGradientDrawingShape: 'rectangle' });

    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
    expect(gradientPreset).toBeTruthy();
    expect(strokePreset).toBeTruthy();

    if (gradientPreset) {
      store.setBrushPreset(gradientPreset);
    }
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBe('ellipse');

    if (strokePreset) {
      store.setBrushPreset(strokePreset);
    }
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBeUndefined();
    expect(useAppStore.getState().brushSpecificSettings['color-cycle-stroke']?.ccGradientDrawingShape).toBeUndefined();
  });

  it('forces shape mode for the color cycle gradient preset', () => {
    const store = useAppStore.getState();
    store.setShapeMode(false);

    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(gradientPreset).toBeTruthy();

    if (gradientPreset) {
      store.setBrushPreset(gradientPreset);
    }

    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

  it('derives dither shape mode from saved preset settings instead of preset id', () => {
    const basePreset = brushPresets.find((preset) => preset.id === 'dither-shape');
    expect(basePreset).toBeTruthy();
    if (!basePreset) {
      return;
    }

    const savedVariant = {
      ...basePreset,
      id: 'saved-dither-variant',
      name: 'Saved Dither Variant',
      preferredSettings: {
        ...basePreset.preferredSettings,
        brushShape: BrushShape.PIXEL_DITHER,
        shapeEnabled: true,
      },
    };

    const store = useAppStore.getState();
    store.setShapeMode(false);
    store.setBrushPreset(savedVariant);

    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

  it('uses 0.5 as the default color cycle speed for the gradient preset', () => {
    const store = useAppStore.getState();
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(gradientPreset).toBeTruthy();

    if (gradientPreset) {
      store.setBrushPreset(gradientPreset);
    }

    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBe(0.5);
  });

  it('keeps the gradient preset speed at 0.5 after switching from another color cycle brush', () => {
    const store = useAppStore.getState();
    const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(strokePreset).toBeTruthy();
    expect(gradientPreset).toBeTruthy();

    if (!strokePreset || !gradientPreset) {
      return;
    }

    store.setBrushPreset(strokePreset);
    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBe(0.5);

    store.setBrushPreset(gradientPreset);

    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBe(0.5);
  });

  it('restores saved color cycle speed for the gradient preset', () => {
    useAppStore.setState((state) => ({
      brushSpecificSettings: {
        ...state.brushSpecificSettings,
        'color-cycle-gradient': {
          colorCycleSpeed: 0.25,
        },
      },
    }));

    const store = useAppStore.getState();
    const strokePreset = brushPresets.find((preset) => preset.id === 'color-cycle-stroke');
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(strokePreset).toBeTruthy();
    expect(gradientPreset).toBeTruthy();

    if (!strokePreset || !gradientPreset) {
      return;
    }

    store.setBrushPreset(strokePreset);
    store.setBrushPreset(gradientPreset);

    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBe(0.25);
  });

  it('switches color cycle gradient source tabs in one action', () => {
    const store = useAppStore.getState();
    const gradientPreset = brushPresets.find((preset) => preset.id === 'color-cycle-gradient');
    expect(gradientPreset).toBeTruthy();
    if (!gradientPreset) {
      return;
    }

    store.setBrushPreset(gradientPreset);
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        ccGradientSource: 'fg',
        brushSettings: {
          ...state.tools.brushSettings,
          ccGradientSource: 'fg',
          colorCycleUseForegroundGradient: true,
          autoSampleGradientRealtime: false,
        },
      },
    }));

    useAppStore.getState().setCcGradientSource('sampled');
    let state = useAppStore.getState();
    expect(state.tools.ccGradientSource).toBe('sampled');
    expect(state.tools.brushSettings.ccGradientSource).toBe('sampled');
    expect(state.tools.brushSettings.colorCycleUseForegroundGradient).toBe(false);

    useAppStore.getState().setCcGradientSource('fg');
    state = useAppStore.getState();
    expect(state.tools.ccGradientSource).toBe('fg');
    expect(state.tools.brushSettings.ccGradientSource).toBe('fg');
    expect(state.tools.brushSettings.colorCycleUseForegroundGradient).toBe(true);
    expect(state.tools.brushSettings.autoSampleGradientRealtime).toBe(false);
  });

  it('forces shape mode off for regular pixel presets', () => {
    const store = useAppStore.getState();
    store.setShapeMode(true);

    const pixelSquarePreset = brushPresets.find((preset) => preset.id === 'pixel-square');
    expect(pixelSquarePreset).toBeTruthy();
    if (!pixelSquarePreset) {
      return;
    }

    store.setBrushPreset(pixelSquarePreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(false);
  });

  it('ignores setShapeMode(true) while a regular pixel preset is active', () => {
    const store = useAppStore.getState();
    const pixelPreset = brushPresets.find((preset) => preset.id === 'pixel-square');
    expect(pixelPreset).toBeTruthy();
    if (!pixelPreset) {
      return;
    }

    store.setBrushPreset(pixelPreset);
    store.setShapeMode(true);
    expect(useAppStore.getState().tools.shapeMode).toBe(false);
  });

  it('persists the selected tip shape for the combined pixel preset', () => {
    const store = useAppStore.getState();
    const pixelPreset = brushPresets.find((preset) => preset.id === 'pixel-square');
    const mosaicPreset = brushPresets.find((preset) => preset.id === 'mosaic');

    expect(brushPresets.find((preset) => preset.id === 'pixel-round')).toBeUndefined();
    expect(pixelPreset?.name).toBe('Pixel');
    expect(mosaicPreset).toBeTruthy();
    if (!pixelPreset || !mosaicPreset) {
      return;
    }

    store.setBrushPreset(pixelPreset);
    store.setBrushSettings({ brushShape: BrushShape.PIXEL_ROUND });
    expect(
      useAppStore.getState().brushSpecificSettings['pixel-square']?.brushShape
    ).toBe(BrushShape.PIXEL_ROUND);

    store.setBrushPreset(mosaicPreset);
    store.setBrushPreset(pixelPreset);
    expect(useAppStore.getState().tools.brushSettings.brushShape).toBe(
      BrushShape.PIXEL_ROUND
    );
  });

  it('persists the selected tip shape for the combined soft preset', () => {
    const store = useAppStore.getState();
    const softPreset = brushPresets.find((preset) => preset.id === 'soft-round');
    const mosaicPreset = brushPresets.find((preset) => preset.id === 'mosaic');

    expect(brushPresets.find((preset) => preset.id === 'soft-square')).toBeUndefined();
    expect(softPreset?.name).toBe('Soft');
    expect(mosaicPreset).toBeTruthy();
    if (!softPreset || !mosaicPreset) {
      return;
    }

    store.setBrushPreset(softPreset);
    store.setBrushSettings({ brushShape: BrushShape.SQUARE });
    expect(
      useAppStore.getState().brushSpecificSettings['soft-round']?.brushShape
    ).toBe(BrushShape.SQUARE);

    store.setBrushPreset(mosaicPreset);
    store.setBrushPreset(softPreset);
    expect(useAppStore.getState().tools.brushSettings.brushShape).toBe(
      BrushShape.SQUARE
    );
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

  it('updates shape drawing state and points', () => {
    const store = useAppStore.getState();
    store.setShapeDrawing(true);
    store.addShapePoint({ x: 5, y: 6 });

    const shapeState = useAppStore.getState().shapeState;
    expect(shapeState.isDrawing).toBe(true);
    expect(shapeState.points).toHaveLength(1);

    store.clearShapePoints();
    const cleared = useAppStore.getState().shapeState;
    expect(cleared.points).toHaveLength(0);
    expect(cleared.previewPath).toBeUndefined();
  });

  it('uses per-brush shape mode for the mosaic preset', () => {
    const store = useAppStore.getState();
    useAppStore.setState((state) => ({
      ...state,
      shapeModeByBrush: { mosaic: false },
      tools: {
        ...state.tools,
        lastRegularShapeMode: true,
        shapeMode: true,
      },
    }));

    store.setBrushPreset(mosaicBrushPreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(false);
  });

  it('keeps regular brush size stable after switching to a custom brush and back', () => {
    const store = useAppStore.getState();
    store.setGlobalBrushSize(12);

    const customBrush: CustomBrush = {
      id: 'size-switch-custom',
      name: 'Size Switch Custom',
      imageData: new ImageData(128, 64),
      width: 128,
      height: 64,
      naturalWidth: 128,
      naturalHeight: 64,
      maxDimension: 128,
      createdAt: Date.now(),
      thumbnail: '',
    };
    store.addCustomBrush(customBrush);

    const customPreset = createCustomBrushPreset(customBrush);
    store.setBrushPreset(customPreset);

    const afterCustom = useAppStore.getState();
    expect(afterCustom.globalBrushSize).toBe(12);
    expect(afterCustom.tools.brushSettings.size).toBe(128);
    expect(afterCustom.tools.brushSettings.lastRegularBrushSize).toBe(12);

    const regularPreset = brushPresets.find((candidate) => candidate.id === 'pixel-square');
    expect(regularPreset).toBeTruthy();
    if (!regularPreset) {
      return;
    }
    store.setBrushPreset(regularPreset);

    const afterRegular = useAppStore.getState();
    expect(afterRegular.globalBrushSize).toBe(12);
    expect(afterRegular.tools.brushSettings.size).toBe(12);
    expect(afterRegular.tools.brushSettings.brushShape).not.toBe(BrushShape.CUSTOM);
  });

  it('keeps brush size stable when switching through checkered and mosaic presets', () => {
    const store = useAppStore.getState();
    store.setGlobalBrushSize(12);

    const checkeredPreset = brushPresets.find((candidate) => candidate.id === 'checkered');
    const mosaicPreset = brushPresets.find((candidate) => candidate.id === 'mosaic');
    const pixelPreset = brushPresets.find((candidate) => candidate.id === 'pixel-square');

    expect(checkeredPreset).toBeTruthy();
    expect(mosaicPreset).toBeTruthy();
    expect(pixelPreset).toBeTruthy();
    if (!checkeredPreset || !mosaicPreset || !pixelPreset) {
      return;
    }

    store.setBrushPreset(checkeredPreset);
    expect(useAppStore.getState().globalBrushSize).toBe(12);
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);

    store.setBrushPreset(mosaicPreset);
    expect(useAppStore.getState().globalBrushSize).toBe(12);
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);

    store.setBrushPreset(pixelPreset);
    expect(useAppStore.getState().globalBrushSize).toBe(12);
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);
  });

  it('enables mosaic pressure defaults when selecting the mosaic preset', () => {
    const store = useAppStore.getState();
    store.setPressureSettings({ enabled: false, min: 0, max: 0 });

    store.setBrushPreset(mosaicBrushPreset);

    const state = useAppStore.getState();
    expect(state.pressureSettings.enabled).toBe(true);
    expect(state.pressureSettings.min).toBe(50);
    expect(state.pressureSettings.max).toBe(150);
    expect(state.tools.brushSettings.pressureEnabled).toBe(true);
    expect(state.tools.brushSettings.minPressure).toBe(50);
    expect(state.tools.brushSettings.maxPressure).toBe(150);
  });

  it('merges rectangle brush state updates', () => {
    const store = useAppStore.getState();
    store.setRectangleBrushState({ width: 42 });
    expect(useAppStore.getState().rectangleBrushState.width).toBe(42);
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
      const colorCycle = {
        schemaVersion: 2 as const,
        mode: 'captured-data' as const,
        source: 'color-cycle-layer' as const,
        sourceCycleLength: 256,
        mapWidth: 4,
        mapHeight: 4,
        phaseMap: new Uint16Array(16),
      };

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
              colorCycle,
            },
          },
        },
      }));

      store.saveCustomBrushAsPreset(brushId);

      const nextState = useAppStore.getState();
      expect(nextState.project?.customBrushes).toHaveLength(1);
      const savedBrush = nextState.project?.customBrushes[0];
      expect(savedBrush?.id).toBe(brushId);
      expect(savedBrush?.name).toBe('Custom 1');
      expect(savedBrush?.imageData.width).toBe(4);
      expect(savedBrush?.thumbnail).toMatch(/^data:image\/png;base64,/);
      expect(savedBrush?.colorCycle).toEqual(colorCycle);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBe(brushId);
      expect(nextState.tools.brushSettings.currentBrushTip?.brushId).toBe(brushId);
    });

    it('restores captured mode after saving and reselecting a schema v3 brush', () => {
      const store = useAppStore.getState();
      const brushId = 'temp_brush_v3_reselect';
      const imageData = new ImageData(2, 2);
      const colorCycle = {
        schemaVersion: 3 as const,
        payloadKind: 'indexed-tip' as const,
        source: 'color-cycle-layer' as const,
        sourceCycleLength: 256,
        mapWidth: 2,
        mapHeight: 2,
        paintIndexMap: new Uint16Array([1, 64, 128, 255]),
      };
      store.setTemporaryCustomBrush({
        id: brushId,
        name: 'Temp Brush',
        imageData,
        width: 2,
        height: 2,
        thumbnail: '',
        createdAt: Date.now(),
        colorCycle,
      });
      store.setBrushSettings({
        brushShape: BrushShape.CUSTOM,
        selectedCustomBrush: brushId,
        currentBrushTip: {
          imageData,
          brushId,
          isColorizable: false,
          width: 2,
          height: 2,
          colorCycle,
        },
      });

      store.saveCustomBrushAsPreset(brushId);
      const savedBrush = useAppStore.getState().project?.customBrushes[0];
      if (!savedBrush) {
        throw new Error('Expected saved schema v3 brush');
      }
      store.setBrushPreset(brushPresets[0]);
      store.setBrushPreset(createCustomBrushPreset(savedBrush));

      const settings = useAppStore.getState().tools.brushSettings;
      expect(settings.currentBrushTip?.colorCycle).toEqual(colorCycle);
      expect(settings.customBrushColorCycle).toBe(true);
      expect(settings.customBrushColorCycleMode).toBe('captured-data');
    });

    it('applies persisted custom-brush color cycle metadata within the authored speed cap', () => {
      const store = useAppStore.getState();
      const ccBrush: CustomBrush = {
        id: 'cc-brush',
        name: 'CC Brush',
        imageData: new ImageData(8, 8),
        width: 8,
        height: 8,
        createdAt: Date.now(),
        thumbnail: '',
        naturalWidth: 8,
        naturalHeight: 8,
        maxDimension: 8,
        colorCycle: {
          schemaVersion: 1,
          source: 'color-cycle-layer',
          gradient: [
            { position: 0, color: '#102030' },
            { position: 1, color: '#f0e0d0' },
          ],
          speed: 2.25,
          phaseMode: 'jittered',
          phaseJitter: 0.35,
        },
      };

      store.addCustomBrush(ccBrush);
      store.setBrushSettings({
        customBrushColorCycle: false,
        colorCycleSpeed: 0.1,
        customBrushCcPhaseMode: 'global',
        customBrushCcPhaseJitter: 0,
        colorCycleGradient: [{ position: 0, color: '#000000' }],
      });

      const preset = createCustomBrushPreset(ccBrush);
      const legacyPreset = {
        ...preset,
        customBrushData: preset.customBrushData
          ? {
              imageData: preset.customBrushData.imageData,
              width: preset.customBrushData.width,
              height: preset.customBrushData.height,
            }
          : undefined,
      };

      store.setBrushPreset(legacyPreset);

      const settings = useAppStore.getState().tools.brushSettings;
      expect(settings.selectedCustomBrush).toBe(ccBrush.id);
      expect(settings.customBrushColorCycle).toBe(true);
      expect(settings.colorCycleSpeed).toBe(1.5);
      expect(settings.customBrushCcPhaseMode).toBe('jittered');
      expect(settings.customBrushCcPhaseJitter).toBeCloseTo(0.35, 5);
      expect(settings.colorCycleGradient).toEqual([
        { position: 0, color: '#102030' },
        { position: 1, color: '#f0e0d0' },
      ]);
      expect(settings.customBrushSizePercent).toBe(100);
      expect(settings.size).toBe(8);
      expect(settings.pressureEnabled).toBe(false);
      expect(settings.minPressure).toBe(1);
      expect(settings.maxPressure).toBeUndefined();
    });
  });

  describe('brush editor lifecycle', () => {
    it('keeps a selected custom tip at captured scale when its editor opens and restarts', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const imageData = new ImageData(128, 64);
      imageData.data.set([210, 30, 70, 128]);
      const brush: CustomBrush = {
        id: 'editor-captured-scale', name: 'Captured scale', imageData,
        width: 128, height: 64, naturalWidth: 128, naturalHeight: 64,
        maxDimension: 128, createdAt: 1, thumbnail: '',
      };
      const store = useAppStore.getState();
      store.setGlobalBrushSize(12);
      store.addCustomBrush(brush);
      store.setBrushPreset(createCustomBrushPreset(brush));
      const before = useAppStore.getState();
      expect(before.tools.brushSettings.size).toBe(128);
      expect(before.globalBrushSize).toBe(12);

      for (let restart = 0; restart < 2; restart += 1) {
        useAppStore.getState().startBrushEdit(brush.id, canvas);
        const editing = useAppStore.getState();
        expect(editing.brushEditor.status).toBe('EDITING');
        expect(editing.tools.brushSettings).toMatchObject({
          selectedCustomBrush: brush.id, size: 128, customBrushSizePercent: 100,
        });
        expect(editing.globalBrushSize).toBe(12);
        expect(editing.getCustomBrushByIdUnsafe(brush.id)).toBe(before.getCustomBrushByIdUnsafe(brush.id));
        expect(editing.tools.brushSettings.currentBrushTip?.imageData).toEqual(imageData);
        expect(editing.layers).toBe(before.layers);
        expect(editing.history).toBe(before.history);
      }
    });

    it('preserves the active custom scale and separate regular size through a colour save and editor restart', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Expected editor canvas context');
      const source = new ImageData(128, 64);
      source.data.set([210, 30, 70, 128]);
      const edited = new ImageData(128, 64);
      edited.data.set([255, 255, 255, 128]);
      const brush: CustomBrush = {
        id: 'editor-scaled-colour', name: 'Scaled colour', imageData: source,
        width: 128, height: 64, naturalWidth: 128, naturalHeight: 64,
        maxDimension: 128, createdAt: 1, thumbnail: '',
        colorCycle: {
          schemaVersion: 2, mode: 'captured-data', source: 'color-cycle-layer',
          sourceCycleLength: 256, mapWidth: 128, mapHeight: 64,
          phaseMap: new Uint16Array(128 * 64),
        },
      };
      const store = useAppStore.getState();
      store.setGlobalBrushSize(12);
      store.addCustomBrush(brush);
      store.setBrushPreset(createCustomBrushPreset(brush));
      store.startBrushEdit(brush.id, canvas);
      // Custom size is separate from regular-brush memory, including after an explicit resize.
      useAppStore.getState().setBrushSettings({ size: 64 });
      useAppStore.getState().setBrushEditorLightness(40);
      const before = useAppStore.getState();
      expect(before.tools.brushSettings.customBrushSizePercent).toBe(50);
      expect(before.globalBrushSize).toBe(12);
      const readEditor = jest.spyOn(ctx, 'getImageData').mockReturnValue(edited);
      try {
        before.saveBrushEdit(canvas);
      } finally {
        readEditor.mockRestore();
      }

      const saved = useAppStore.getState();
      expect(saved.brushEditor.status).toBe('IDLE');
      expect(saved.tools.brushSettings).toMatchObject({
        selectedCustomBrush: brush.id, size: 64, customBrushSizePercent: 50,
      });
      expect(saved.globalBrushSize).toBe(12);
      expect(saved.getCustomBrushByIdUnsafe(brush.id)?.imageData).toBe(edited);
      expect(saved.tools.brushSettings.currentBrushTip?.imageData).toBe(edited);
      expect(saved.getCustomBrushByIdUnsafe(brush.id)?.colorCycle).toEqual(brush.colorCycle);
      expect(saved.tools.brushSettings.currentBrushTip?.colorCycle).toEqual(brush.colorCycle);
      expect([...source.data.slice(0, 4)]).toEqual([210, 30, 70, 128]);
      expect(saved.layers).toBe(before.layers);
      expect(saved.history).toBe(before.history);

      saved.startBrushEdit(brush.id, canvas);
      const restarted = useAppStore.getState();
      expect(restarted.tools.brushSettings.size).toBe(64);
      expect(restarted.tools.brushSettings.customBrushSizePercent).toBe(50);
      expect(restarted.globalBrushSize).toBe(12);
      expect(restarted.tools.brushSettings.currentBrushTip?.imageData).toEqual(edited);
      expect(restarted.layers).toBe(before.layers);
      expect(restarted.history).toBe(before.history);
    });

    it('retains regular size fallback when entering a built-in brush editor', () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const store = useAppStore.getState();
      store.setGlobalBrushSize(12);
      store.startBrushEdit('pixel-square', canvas);
      expect(useAppStore.getState().tools.brushSettings.size).toBe(12);
      expect(useAppStore.getState().globalBrushSize).toBe(12);
    });

    it('enters editing mode and centers the brush when startBrushEdit is called', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;

      const store = useAppStore.getState();
      store.startBrushEdit('pixel-square', canvas);

      const nextState = useAppStore.getState();
      expect(nextState.brushEditor.status).toBe('EDITING');
      expect(nextState.brushEditor.editingBrushId).toBe('pixel-square');
      expect(nextState.tools.brushSettings.brushShape).toBe(BrushShape.CUSTOM);
      expect(nextState.tools.brushSettings.selectedCustomBrush).toBe('pixel-square');
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
      store.startBrushEdit('pixel-square', canvas);
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

    it('preserves custom-brush color cycle metadata when saving brush edits', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx?.fillRect(0, 0, 64, 64);

      const store = useAppStore.getState();
      const brush: CustomBrush = {
        id: 'edit-cc-brush',
        name: 'Edit CC Brush',
        imageData: new ImageData(16, 16),
        width: 16,
        height: 16,
        createdAt: Date.now(),
        thumbnail: '',
        naturalWidth: 16,
        naturalHeight: 16,
        maxDimension: 16,
        colorCycle: {
          schemaVersion: 2,
          mode: 'captured-data',
          source: 'color-cycle-layer',
          sourceCycleLength: 256,
          mapWidth: 16,
          mapHeight: 16,
          phaseMap: new Uint16Array(256),
        },
      };

      store.addCustomBrush(brush);
      store.startBrushEdit(brush.id, canvas);
      store.saveBrushEdit(canvas);

      const nextState = useAppStore.getState();
      const savedBrush = nextState.getCustomBrushById(brush.id);
      expect(savedBrush?.colorCycle).toEqual(brush.colorCycle);
      expect(nextState.tools.brushSettings.currentBrushTip?.colorCycle).toEqual(brush.colorCycle);
    });

    it.each([true, false])('ends saved-brush editing before capture entry (offscreen canvas: %s) without changing source or saved ink', (hasOffscreenCanvas) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const imageData = new ImageData(8, 8);
      imageData.data.set([255, 0, 0, 128], 0);
      const brush: CustomBrush = {
        id: 'capture-entry-saved', name: 'Saved capture source', imageData,
        width: 8, height: 8, naturalWidth: 8, naturalHeight: 8, maxDimension: 8,
        createdAt: 1, thumbnail: '',
      };
      const store = useAppStore.getState();
      store.addCustomBrush(brush);
      store.startBrushEdit(brush.id, canvas);
      useAppStore.setState({ currentOffscreenCanvas: hasOffscreenCanvas ? canvas : null });
      const before = useAppStore.getState();
      expect(before.brushEditor.status).toBe('EDITING');
      expect(before.tools.brushSettings.selectedCustomBrush).toBe(brush.id);
      const saved = before.getCustomBrushByIdUnsafe(brush.id);
      const sourcePixels = canvas.getContext('2d')?.getImageData(0, 0, 64, 64).data.slice();
      const layers = before.layers;
      const history = before.history;
      const selection = { start: before.selectionStart, end: before.selectionEnd, mask: before.selectionMask };

      before.setCurrentTool('custom');

      const after = useAppStore.getState();
      expect(after.brushEditor).toEqual(defaultBrushEditorState);
      expect(after.tools.currentTool).toBe('custom');
      expect(after.tools.brushSettings.selectedCustomBrush).toBeNull();
      expect(after.tools.brushSettings.currentBrushTip).toBeUndefined();
      expect(after.getCustomBrushByIdUnsafe(brush.id)).toBe(saved);
      expect(after.getCustomBrushByIdUnsafe(brush.id)?.imageData.data).toEqual(imageData.data);
      expect(after.layers).toBe(layers);
      expect(after.history).toBe(history);
      expect({ start: after.selectionStart, end: after.selectionEnd, mask: after.selectionMask }).toEqual(selection);
      expect(canvas.getContext('2d')?.getImageData(0, 0, 64, 64).data).toEqual(sourcePixels);
      expect(after.currentOffscreenCanvas).toBe(hasOffscreenCanvas ? canvas : null);
    });

    it('keeps the active editor when a non-capture tool is selected', () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      useAppStore.getState().startBrushEdit('pixel-square', canvas);
      const editor = useAppStore.getState().brushEditor;
      expect(editor.status).toBe('EDITING');
      useAppStore.getState().setCurrentTool('eraser');
      expect(useAppStore.getState().brushEditor).toBe(editor);
    });

    it('cancels editing and resets brush selection when cancelBrushEdit runs', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;

      const store = useAppStore.getState();
      store.startBrushEdit('pixel-square', canvas);
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

  it('restores regular brush size when switching from custom tool to brush without an active custom brush', () => {
    useAppStore.setState((state) => ({
      ...state,
      globalBrushSize: 100,
      tools: {
        ...state.tools,
        currentTool: 'custom',
        lastRegularBrushShape: BrushShape.ROUND,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          size: 100,
          customBrushSizePercent: 100,
          selectedCustomBrush: null,
          lastRegularBrushSize: 12,
          currentBrushTip: undefined,
        },
      },
    }));

    useAppStore.getState().setCurrentTool('brush');

    const nextState = useAppStore.getState();
    expect(nextState.tools.currentTool).toBe('brush');
    expect(nextState.tools.brushSettings.brushShape).toBe(BrushShape.ROUND);
    expect(nextState.tools.brushSettings.size).toBe(12);
    expect(nextState.tools.brushSettings.customBrushSizePercent).toBeUndefined();
    expect(nextState.globalBrushSize).toBe(12);
  });

  it('clears active custom brush selection when entering the custom capture tool', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        currentTool: 'brush',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: 'saved-custom-1',
          currentBrushTip: {
            imageData: new ImageData(8, 8),
            brushId: 'saved-custom-1',
            isColorizable: false,
            width: 8,
            height: 8,
          },
        },
      },
      ui: {
        ...state.ui,
        brushPanelSection: 'filters',
      },
    }));

    useAppStore.getState().setCurrentTool('custom');

    const nextState = useAppStore.getState();
    expect(nextState.tools.currentTool).toBe('custom');
    expect(nextState.tools.brushSettings.selectedCustomBrush).toBeNull();
    expect(nextState.tools.brushSettings.currentBrushTip).toBeUndefined();
    expect(nextState.ui.brushPanelSection).toBe('tool');
  });

  it('supports one-pixel custom brushes while keeping percent state in sync', () => {
    const imageData = new ImageData(64, 64);
    useAppStore.setState((state) => ({
      ...state,
      temporaryCustomBrush: {
        id: 'temp_brush_64',
        name: 'Temp Brush',
        imageData,
        thumbnail: '',
        width: 64,
        height: 64,
        naturalWidth: 64,
        naturalHeight: 64,
        maxDimension: 64,
        createdAt: Date.now(),
      },
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: 'temp_brush_64',
          currentBrushTip: {
            imageData,
            brushId: 'temp_brush_64',
            width: 64,
            height: 64,
            naturalWidth: 64,
            naturalHeight: 64,
            maxDimension: 64,
            isColorizable: false,
          },
        },
      },
    }));

    useAppStore.getState().setGlobalBrushSize(1);

    const nextState = useAppStore.getState();
    expect(nextState.tools.brushSettings.size).toBe(1);
    expect(nextState.tools.brushSettings.customBrushSizePercent).toBeCloseTo(1.563, 3);
  });

  it('preserves marquee selection when switching away from the selection tool', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        currentTool: 'selection',
      },
      selectionStart: { x: 1, y: 2 },
      selectionEnd: { x: 3, y: 4 },
    }));

    useAppStore.getState().setCurrentTool('color-adjust');

    const { selectionStart, selectionEnd } = useAppStore.getState();
    expect(selectionStart).toEqual({ x: 1, y: 2 });
    expect(selectionEnd).toEqual({ x: 3, y: 4 });
  });
});
