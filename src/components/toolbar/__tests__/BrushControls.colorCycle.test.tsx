import React from 'react';
import { render, screen } from '@testing-library/react';
import { create } from 'zustand';
import userEvent from '@testing-library/user-event';

jest.mock('@/types', () => ({
  __esModule: true,
  BrushShape: {
    ROUND: 'round',
    PIXEL_ROUND: 'pixel_round',
    PIXEL_DITHER: 'pixel_dither',
    SQUARE: 'square',
    TRIANGLE: 'triangle',
    POLYGON: 'polygon',
    CUSTOM: 'custom',
    RECTANGLE_GRADIENT: 'rectangle_gradient',
    POLYGON_GRADIENT: 'polygon_gradient',
    CONTOUR_POLYGON: 'contour_polygon',
    CONTOUR_LINES2: 'contour_lines2',
    RISOGRAPH_SOFT: 'risograph_soft',
    RISOGRAPH_ULTRA: 'risograph_ultra',
    RESAMPLER: 'resampler',
    COLOR_CYCLE: 'color_cycle',
    COLOR_CYCLE_TRIANGLE: 'color_cycle_triangle',
    COLOR_CYCLE_SHAPE: 'color_cycle_shape',
    SPAM_TEXT: 'spam_text',
    SHAPE_FILL: 'shape_fill',
  },
}));
// ts-jest transpiles the path in BrushControls to a relative import; double-mock for that path too.
jest.mock('../../../types', () => ({
  __esModule: true,
  BrushShape: {
    ROUND: 'round',
    PIXEL_ROUND: 'pixel_round',
    PIXEL_DITHER: 'pixel_dither',
    SQUARE: 'square',
    TRIANGLE: 'triangle',
    POLYGON: 'polygon',
    CUSTOM: 'custom',
    RECTANGLE_GRADIENT: 'rectangle_gradient',
    POLYGON_GRADIENT: 'polygon_gradient',
    CONTOUR_POLYGON: 'contour_polygon',
    CONTOUR_LINES2: 'contour_lines2',
    RISOGRAPH_SOFT: 'risograph_soft',
    RISOGRAPH_ULTRA: 'risograph_ultra',
    RESAMPLER: 'resampler',
    COLOR_CYCLE: 'color_cycle',
    COLOR_CYCLE_TRIANGLE: 'color_cycle_triangle',
    COLOR_CYCLE_SHAPE: 'color_cycle_shape',
    SPAM_TEXT: 'spam_text',
    SHAPE_FILL: 'shape_fill',
  },
}));

import BrushControls from '../BrushControls';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';

// Lightweight mocks to keep the test focused on wiring
jest.mock('@/components/ui/ProgressSlider', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value: number;
    onChange: (v: number) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="range"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  ),
}));

jest.mock('@/components/ui/Dropdown', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <select aria-label="dropdown" value={value} />,
}));

jest.mock('@/components/ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({ checked, onChange, 'aria-label': ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

jest.mock('@/components/ui/ButtonGroup', () => ({
  __esModule: true,
  default: ({ options, value, onChange }: { options: Array<{ label: string; value: string }>; value: string; onChange: (v: string) => void }) => (
    <div role="group">
      {options.map(opt => (
        <button
          key={opt.value}
          aria-label={opt.label}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('@/components/ui/GradientEditor', () => ({
  __esModule: true,
  GradientEditor: ({ stops }: { stops: Array<{ position: number; color: string }> }) => (
    <div data-testid="gradient-editor">{stops.length}</div>
  ),
}));

jest.mock('@/presets/brushPresets', () => ({
  __esModule: true,
  getPresetCapabilities: jest.fn(() => ({ components: [] })),
}));

// Minimal mock store
jest.mock('@/stores/useAppStore', () => {
  const baseBrush: BrushSettings = {
    size: 10,
    opacity: 1,
    color: '#000',
    blendMode: 'source-over',
    spacing: 2,
    pressure: 1,
    rotation: 0,
    antialiasing: true,
    brushShape: 'color_cycle' as BrushSettings['brushShape'],
    selectedCustomBrush: null,
    customBrushSizePercent: 100,
    lastRegularBrushSize: 10,
    pressureEnabled: false,
    minPressure: 1,
    maxPressure: 1000,
    rotationEnabled: false,
    dashedEnabled: false,
    dashLength: 1,
    dashGap: 1,
    useSwatchColor: false,
    flow: 1,
    gridSnapEnabled: false,
    shapeEnabled: false,
    hueShift: 0,
    lightnessAdjust: 0,
    saturationAdjust: 0,
    colorJitter: 0,
    risographIntensity: 0,
    risographOutline: false,
    ditherEnabled: true,
    ditherPaletteSpread: 0,
    ditherPhaseJitter: 0,
    ditherAlgorithm: 'sierra-lite',
    patternStyle: 'dots',
    lostEdge: 0,
    fillResolution: 1,
    continuousSampling: false,
    resampleInterval: 5,
    autoSampleColor: false,
    colors: 2,
    rectGradientPresetId: 'none',
    polygonSampleColors: false,
    shapeFillMode: 'default',
    contourSpacing: 2,
    contourVariance: 0,
    contourSmoothness: 0,
    contourMaxDistance: 0,
    contourLines2Spacing: 2,
    contourLines2Density: 1,
    contourLines2Alternate: false,
    triangleFillSize: 16,
    triangleFillJitter: 0,
    triangleFillRotation: 0,
    crossHatchRotation: 0,
    crossHatchSpacing: 4,
    crossHatchLineWidth: 1,
    flowSeedSpacing: 8,
    flowStepSize: 1,
    flowMaxSteps: 10,
    flowUseOrthogonal: false,
    flowFieldResolution: 4,
    flowOrientationAngle: 0,
    flowSeedJitter: 0,
    ribbonSdfStep: 4,
    ribbonSeedSpacing: 8,
    ribbonStepSize: 1,
    ribbonMaxSteps: 10,
    ribbonTangentWeight: 0,
    ribbonBiasAngle: 0,
    ribbonNoiseStrength: 0,
    ribbonNoiseScale: 1,
    ribbonNoiseOctaves: 1,
    ribbonLineWidth: 1,
    ribbonJitter: 0,
    ribbonAnchorFalloff: 0,
    ribbonSeed: 1,
    colorCycleFlowMode: 'reverse',
    customBrushColorCycle: false,
    colorCycleSpeed: 0.1,
    colorCycleStampShape: 'square',
    colorCycleStampDitherPressureLinked: false,
    colorCycleUseForegroundGradient: false,
    colorCycleFgLightness: 50,
    colorCycleFgVariance: 0,
    colorCycleFgHueShift: 0,
    colorCycleFgSaturationShift: 0,
    colorCycleFgStops: 2,
    colorCycleGradient: [
      { position: 0, color: '#000' },
      { position: 1, color: '#fff' },
    ],
    colorCycleGradientVersion: 0,
    colorCycleFPS: 30,
    colorCycleFillMode: 'concentric',
    colorCycleBandSpacingPx: 12,
    autoSampleGradient: false,
    gradientBands: 12,
    polygonSides: 3,
    polygonDitherResolution: 1,
    spamFont: 'default',
    spamContentType: 'default',
    spamCustomText: '',
    shapeGradientMode: 'contour',
    linkSizeToBrush: true,
  };

  const initialState = {
    tools: {
      currentTool: 'brush',
      previousTool: 'brush',
      lastRegularTool: 'brush',
      lastRegularBrushShape: 'color_cycle',
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      brushSettings: baseBrush,
      eraserSettings: baseBrush,
      fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      shapeMode: false,
      customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
    },
    globalBrushSize: 10,
    activeLayerId: 'layer-1',
    layers: [{ id: 'layer-1', name: 'CC', layerType: 'color-cycle' } as unknown as AppState['layers'][number]],
    selectedLayerIds: [],
    referenceLayerId: null,
    layersNeedRecomposition: false,
    brushPresets: [{ id: 'color-cycle-stroke', name: 'CC Stroke' } as unknown as AppState['brushPresets'][number]],
    currentBrushPreset: { id: 'color-cycle-stroke', name: 'CC Stroke' } as AppState['currentBrushPreset'],
    temporaryCustomBrush: null,
    recolorSampling: { active: false, start: null, end: null, samples: undefined, target: 'brush' },
    polygonGradientState: { drawingState: 'idle', points: [], previewPath: undefined },
    brushEditor: { status: 'IDLE', editingBrushId: null, editingBounds: null, originalCanvasState: null, hueShift: 0, lightness: 0, saturation: 100 },
    pressureSettings: { enabled: false, min: 1, max: 1000 },
    colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    setBrushSettings: jest.fn((updates: Partial<BrushSettings>) =>
      store.setState((state) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, ...updates },
        },
      }))
    ),
    setEraserSettings: () => {},
    setGlobalBrushSize: () => {},
    setCustomBrushSizePercent: () => {},
    setShapeMode: () => {},
    setBrushPreset: () => {},
    updateLayer: jest.fn(),
    addNotification: () => {},
    playColorCycle: () => {},
    pauseColorCycle: () => {},
    colorCycleRuntimeHandlers: {},
    setLayersNeedRecomposition: () => {},
    setLayers: () => {},
    addLayer: () => 'layer-2',
    removeLayer: () => {},
    reorderLayers: () => {},
    setActiveLayer: () => {},
    setSelectedLayerIds: () => {},
    setReferenceLayer: () => {},
    updateLayerAlignment: () => {},
    initColorCycleForLayer: () => {},
    cleanupColorCycleForLayer: () => {},
    getLayerColorCycleBrush: () => null,
    compositeLayersToCanvas: () => {},
    captureCanvasToActiveLayer: () => Promise.resolve(),
    captureCanvasToLayer: () => Promise.resolve(),
    autosaveDirtyReasons: new Set(),
    markAutosaveDirty: () => {},
    clearDirtyState: () => {},
    setFileBackupMode: () => {},
    setFileBackupFile: () => {},
    setFileBackupDirectory: () => {},
    updateFileBackupTime: () => {},
    setAutosaveInterval: () => {},
    setHistorySize: () => {},
    currentCompositeBitmap: null,
    setCurrentCompositeBitmap: () => {},
    project: null,
    setProject: () => {},
    layersSnapshots: [],
    history: { undoStack: [], redoStack: [], maxHistorySize: 50, isCapturing: false },
    canUndo: () => false,
    canRedo: () => false,
    undo: () => Promise.resolve(null),
    redo: () => Promise.resolve(null),
    clearHistory: () => {},
    sampleColorAtPoint: () => Promise.resolve('#000'),
  } as unknown as AppState;

  const store = create<AppState>(() => initialState);
  return { useAppStore: store };
});

describe('BrushControls – Color Cycle stroke essentials', () => {
  it('shows gradient editor, speed, bands, and flow controls for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    expect(screen.getByTestId('gradient-editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Speed')).toBeInTheDocument();
    expect(screen.getByLabelText('Gradient Bands')).toBeInTheDocument();

    // Flow buttons should be present and toggle-able
    const forwardBtn = screen.getByRole('button', { name: 'Fwd' });
    expect(forwardBtn).toBeInTheDocument();
    await user.click(forwardBtn);

    expect(useAppStore.getState().tools.brushSettings.colorCycleFlowMode).toBe('reverse');
  });

  it('allows selecting the diamond stamp for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond' });
    await user.click(diamondButton);

    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('diamond');
  });

  it('disables stamp dither resolution when pressure-linked', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleStampDitherEnabled: true,
          colorCycleStampDitherPressureLinked: true,
        },
      },
    }));

    render(<BrushControls />);

    const slider = screen.getByLabelText('Stamp Dither Resolution') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });
});
