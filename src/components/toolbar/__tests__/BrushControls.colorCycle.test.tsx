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
import * as colorCycleGradients from '@/utils/colorCycleGradients';

// Lightweight mocks to keep the test focused on wiring
jest.mock('@/components/ui/ProgressSlider', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    onCommit,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value: number;
    onChange: (v: number) => void;
    onCommit?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="range"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        onChange(Number(e.target.value));
      }}
      onBlur={() => {
        onCommit?.();
      }}
    />
  ),
}));

jest.mock('@/components/ui/Dropdown', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
  }) => (
    <select
      aria-label="dropdown"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

jest.mock('@/components/ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({
    checked,
    onChange,
    id,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    id?: string;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      id={id}
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
    colorCycleFlowMode: 'forward',
    customBrushColorCycle: false,
    colorCycleSpeed: 0.1,
    colorCycleLayerSpeedScale: 1,
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
      ccGradientSource: 'manual',
      brushSettings: baseBrush,
      eraserSettings: baseBrush,
      fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      shapeMode: false,
      customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
    },
    ccGradientSampleCount: 0,
    ccGradientSampleResetToken: 0,
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
    setCcGradientSource: jest.fn((source: 'manual' | 'fg' | 'sampled') =>
      store.setState((state) => ({
        tools: {
          ...state.tools,
          ccGradientSource: source,
        },
      }))
    ),
    setCcGradientSampleCount: jest.fn((count: number) =>
      store.setState(() => ({
        ccGradientSampleCount: count,
      }))
    ),
    resetCcGradientSample: jest.fn(() =>
      store.setState((state) => ({
        ccGradientSampleCount: 0,
        ccGradientSampleResetToken: state.ccGradientSampleResetToken + 1,
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
    getCustomBrushById: () => null,
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
  beforeEach(() => {
    jest.spyOn(colorCycleGradients, 'setSharedColorCycleGradient').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows gradient editor, speed, and bands for color cycle stroke', () => {
    render(<BrushControls />);

    expect(screen.getByTestId('gradient-editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Speed')).toBeInTheDocument();
    expect(screen.getByLabelText('Gradient Bands')).toBeInTheDocument();
  });

  it('allows selecting the diamond stamp for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond' });
    await user.click(diamondButton);

    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('diamond');
  });

  it('allows selecting the 5px diamond stamp for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond5' });
    await user.click(diamondButton);

    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('diamond5');
  });

  it('allows selecting the 7px diamond stamp for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond7' });
    await user.click(diamondButton);

    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('diamond7');
  });

  it('allows selecting the 9px diamond stamp for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond9' });
    await user.click(diamondButton);

    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('diamond9');
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

  it('exposes dashed toggle for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const dashedToggle = screen.getByRole('checkbox', { name: 'Dashed' });
    expect(dashedToggle).toBeInTheDocument();

    await user.click(dashedToggle);
    expect(useAppStore.getState().tools.brushSettings.dashedEnabled).toBe(true);
  });

  it('forks gradient when switching back to manual mode', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        ccGradientSource: 'fg',
      },
    }));

    const setSharedSpy = jest.spyOn(colorCycleGradients, 'setSharedColorCycleGradient');
    render(<BrushControls />);

    await user.click(screen.getByRole('button', { name: 'Man Grad' }));

    expect(useAppStore.getState().tools.ccGradientSource).toBe('manual');
    const lastCall = setSharedSpy.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall?.[1]).toEqual({ fork: true });
  });

  it('does not flush gradient on unmount when there are no pending edits', () => {
    const setSharedSpy = jest.spyOn(colorCycleGradients, 'setSharedColorCycleGradient');
    const { unmount } = render(<BrushControls />);
    unmount();
    expect(setSharedSpy).not.toHaveBeenCalled();
  });
});

describe('BrushControls – Custom brush captured data mode', () => {
  it('renders mode group and captured metadata panel', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'custom' as BrushSettings['brushShape'],
          selectedCustomBrush: 'brush-v2',
          customBrushColorCycle: true,
          customBrushColorCycleMode: 'tip',
        },
      },
      temporaryCustomBrush: {
        id: 'brush-v2',
        name: 'Brush V2',
        imageData: new ImageData(2, 2),
        thumbnail: '',
        width: 2,
        height: 2,
        createdAt: 1,
        colorCycle: {
          schemaVersion: 2,
          mode: 'captured-data',
          sourceCycleLength: 256,
          mapWidth: 2,
          mapHeight: 2,
          phaseMap: new Uint16Array([0, 1, 2, 3]),
        },
      } as unknown as AppState['temporaryCustomBrush'],
    }));

    render(<BrushControls />);
    expect(screen.getByRole('button', { name: 'Tip Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Color Cycle Data' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Color Cycle Data' }));
    expect(screen.getByText('Captured')).toBeInTheDocument();
    expect(screen.getByText('Map 2x2')).toBeInTheDocument();
    expect(screen.getByText('Cycle Length 256')).toBeInTheDocument();
  });
});

describe('BrushControls – Color Cycle gradient fill mode', () => {
  it('shows fill mode toggle only for the color cycle gradient preset', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    const { unmount } = render(<BrushControls />);
    expect(screen.getByRole('button', { name: 'Concentric' })).toBeInTheDocument();
    unmount();

    useAppStore.setState((state) => ({
      ...state,
      brushPresets: [{ id: 'color-cycle-stroke', name: 'CC Stroke' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-stroke', name: 'CC Stroke' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    expect(screen.queryByRole('button', { name: 'Concentric' })).not.toBeInTheDocument();
  });

  it('updates fill mode when toggled on the gradient preset', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          colorCycleFillMode: 'linear',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    await user.click(screen.getByRole('button', { name: 'Concentric' }));
    expect(useAppStore.getState().tools.brushSettings.colorCycleFillMode).toBe('concentric');
  });
});
