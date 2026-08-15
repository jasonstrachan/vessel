import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { DEFAULT_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import * as colorCycleGradients from '@/utils/colorCycleGradients';
import { sliderPositionToBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';

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
  GradientEditor: ({
    stops,
    onChange,
    onEditStart,
    onEditEnd,
  }: {
    stops: Array<{ position: number; color: string }>;
    onChange?: (stops: Array<{ position: number; color: string }>) => void;
    onEditStart?: () => void;
    onEditEnd?: () => void;
  }) => (
    <div data-testid="gradient-editor">
      {stops.length}
      <button
        type="button"
        aria-label="Edit manual gradient"
        onClick={() => {
          onEditStart?.();
          onChange?.([
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#0000ff' },
          ]);
          onEditEnd?.();
        }}
      >
        Edit
      </button>
    </div>
  ),
}));

jest.mock('@/presets/brushPresets', () => ({
  __esModule: true,
  getPresetCapabilities: jest.fn(() => ({ components: [] })),
  isCcGradientPreset: (id?: string | null) =>
    id === 'color-cycle-gradient' || id === 'color-cycle-flat-dither',
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
    velocityAnimationSpeedEnabled: false,
    useSwatchColor: false,
    flow: 1,
    gridSnapEnabled: false,
    roundedCornersEnabled: false,
    cornerRadiusPx: 8,
    shapeEnabled: false,
    hueShift: 0,
    lightnessAdjust: 0,
    saturationAdjust: 0,
    colorJitter: 0,
    risographIntensity: 0,
    risographOutline: false,
    ditherEnabled: true,
    ditherPaletteSpread: 0,
    ditherPatternDiversity: 100,
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
    brushPresets: [
      { id: 'color-cycle-stroke', name: 'CC Stroke' } as unknown as AppState['brushPresets'][number],
      { id: 'checkered', name: 'Checkered' } as unknown as AppState['brushPresets'][number],
    ],
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
    setColorCycleGradientDraft: jest.fn((stops: NonNullable<BrushSettings['colorCycleGradient']>) =>
      store.setState((state) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, colorCycleGradient: stops },
        },
      }))
    ),
    commitColorCycleGradientDraft: jest.fn((stops: NonNullable<BrushSettings['colorCycleGradient']>) =>
      store.setState((state) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, colorCycleGradient: stops },
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
    setBrushPreset: jest.fn(),
    updateLayer: jest.fn(),
    addNotification: () => {},
    playColorCycle: () => {},
    pauseColorCycle: () => {},
    colorCycleRuntimeHandlers: {},
    pendingColorCycleGradientHandoff: null,
    setPendingColorCycleGradientHandoff: jest.fn((pending) =>
      store.setState(() => ({
        pendingColorCycleGradientHandoff: pending,
      }))
    ),
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

  it('keeps gradient editing out of brush controls while retaining stroke controls', () => {
    render(<BrushControls />);

    expect(screen.queryByTestId('gradient-editor')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Grid Snap' })).toBeInTheDocument();
    expect(screen.getByLabelText('Speed')).toBeInTheDocument();
    expect(screen.getByLabelText('Gradient Bands')).toBeInTheDocument();
  });

  it('toggles grid snap for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    await user.click(screen.getByRole('checkbox', { name: 'Grid Snap' }));

    expect(useAppStore.getState().tools.brushSettings.gridSnapEnabled).toBe(true);
  });

  it('updates grid snap size for color cycle stroke', () => {
    render(<BrushControls />);

    const input = screen.getByTitle('Grid size in pixels') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '24' } });

    expect(useAppStore.getState().tools.brushSettings.gridSnapSize).toBe(24);
  });

  it('renders rounded corner controls under grid snap for color cycle stroke', () => {
    render(<BrushControls />);

    expect(screen.getByRole('checkbox', { name: /rounded/i })).toBeInTheDocument();
    expect(screen.getByTitle('Rounded corner radius in pixels')).toBeInTheDocument();
  });

  it('toggles rounded corners for color cycle stroke', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    await user.click(screen.getByRole('checkbox', { name: /rounded/i }));

    expect(useAppStore.getState().tools.brushSettings.roundedCornersEnabled).toBe(true);
  });

  it('updates corner radius for color cycle stroke', () => {
    render(<BrushControls />);

    const input = screen.getByTitle('Rounded corner radius in pixels') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '18' } });

    expect(useAppStore.getState().tools.brushSettings.cornerRadiusPx).toBe(18);
  });

  it('updates brush speed without mutating the active layer CC base speed', async () => {
    const updateLayer = useAppStore.getState().updateLayer as jest.Mock;
    render(<BrushControls />);

    const speedInput = screen.getByLabelText('Speed');
    fireEvent.change(speedInput, { target: { value: '0.2' } });
    fireEvent.blur(speedInput);

    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBeCloseTo(
      sliderPositionToBrushColorCycleSpeed(0.2),
      4,
    );
    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBeLessThan(0.1);
    expect(updateLayer).not.toHaveBeenCalled();
  });

  it('toggles velocity-linked animation speed for color cycle strokes', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const toggle = document.getElementById('velocity-animation-speed-cc') as HTMLInputElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(false);

    if (!toggle) {
      throw new Error('Missing velocity-animation-speed-cc toggle');
    }
    await user.click(toggle);
    expect(useAppStore.getState().tools.brushSettings.velocityAnimationSpeedEnabled).toBe(true);
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

  it('switches to the dedicated checkered CC preset', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const checkeredButton = screen.getByRole('button', { name: 'Checkered' });
    await user.click(checkeredButton);

    expect(useAppStore.getState().setBrushPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'checkered' }),
      true,
    );
    expect(useAppStore.getState().tools.brushSettings.colorCycleStampShape).toBe('checkered');
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

  it('updates Variety for Sierra Lite CC stamp dithering', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          ditherEnabled: false,
          colorCycleStampDitherEnabled: true,
          colorCycleStampDitherAlgorithm: 'sierra-lite',
          ditherPatternDiversity: 100,
        },
      },
    }));

    render(<BrushControls />);
    fireEvent.change(screen.getByLabelText('Dither Pattern Diversity'), {
      target: { value: '24' },
    });

    expect(useAppStore.getState().tools.brushSettings.ditherPatternDiversity).toBe(24);
  });

  it('does not force stamp dither resolution back to 6 when enabling pressure-linked mode', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleStampDitherEnabled: true,
          colorCycleStampDitherPixelSize: 4,
          colorCycleStampDitherPressureLinked: false,
        },
      },
    }));

    render(<BrushControls />);

    const toggle = document.getElementById('stamp-dither-pressure-linked-color-cycle') as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    if (!toggle) {
      throw new Error('stamp dither pressure-linked toggle not found');
    }
    await user.click(toggle);

    const active = useAppStore.getState().tools.brushSettings;
    expect(active.colorCycleStampDitherPressureLinked).toBe(true);
    expect(active.colorCycleStampDitherPixelSize).toBe(4);
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

    await user.click(screen.getByRole('button', { name: 'Palette' }));

    expect(useAppStore.getState().tools.ccGradientSource).toBe('manual');
    const lastCall = setSharedSpy.mock.calls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall?.[1]).toEqual({ fork: true });
  });

  it('switches between foreground and sampled gradient source panels', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      palette: {
        ...(state as unknown as { palette?: Record<string, unknown> }).palette,
        foregroundColor: '#336699',
        backgroundColor: '#ffffff',
        activeSlot: 'foreground',
      },
    }));
    render(<BrushControls />);

    await user.click(screen.getByRole('button', { name: 'FG Grad' }));
    expect(screen.getByText('Foreground Gradient')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Foreground Gradient Lightness' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sample' }));
    expect(screen.getByText('Sampled Gradient')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('exposes the shared seam brush setting for sampled color cycle strokes', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        ccGradientSource: 'sampled',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle' as BrushSettings['brushShape'],
          colorCycleGradientSeamProfile: 'soft',
        },
      },
      currentBrushPreset: {
        id: 'color-cycle-stroke',
        name: 'CC Stroke',
      } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    const hardSeamButton = screen.getByRole('button', { name: 'Hard' });
    expect(screen.getByRole('button', { name: 'Soft' })).toBeInTheDocument();
    expect(screen.getByText('Contrast')).toBeInTheDocument();

    await user.click(hardSeamButton);
    fireEvent.change(screen.getByLabelText('Gradient Contrast'), {
      target: { value: '42' },
    });

    expect(useAppStore.getState().tools.brushSettings.colorCycleGradientSeamProfile).toBe('hard');
    expect(useAppStore.getState().tools.brushSettings.ccGradientRangeContrast).toBe(42);
  });

  it('does not flush gradient on unmount when there are no pending edits', () => {
    const setSharedSpy = jest.spyOn(colorCycleGradients, 'setSharedColorCycleGradient');
    const { unmount } = render(<BrushControls />);
    unmount();
    expect(setSharedSpy).not.toHaveBeenCalled();
  });
});

describe('BrushControls – Custom brush captured data mode', () => {
  it('uses the authored default when enabling color cycling without a remembered speed', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'custom' as BrushSettings['brushShape'],
          selectedCustomBrush: 'brush-v2',
          customBrushColorCycle: false,
          colorCycleSpeed: undefined,
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
      } as unknown as AppState['temporaryCustomBrush'],
    }));

    render(<BrushControls />);
    await user.click(screen.getByRole('checkbox', { name: 'Color Cycle' }));

    expect(useAppStore.getState().tools.brushSettings.colorCycleSpeed).toBe(
      DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
    );
  });

  it('places custom CC speed controls below spacing and above mode selector', () => {
    useAppStore.setState((state) => ({
      ...state,
      layers: [{ id: 'layer-1', name: 'CC', layerType: 'color-cycle' } as unknown as AppState['layers'][number]],
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
      } as unknown as AppState['temporaryCustomBrush'],
    }));

    render(<BrushControls />);

    const spacing = screen.getByLabelText('Spacing');
    const speed = screen.getByLabelText('Custom Brush Color Cycle Speed');
    const modeButton = screen.getByRole('button', { name: 'Color Cycle + Recolor' });

    expect(
      spacing.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      speed.compareDocumentPosition(modeButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

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
    expect(screen.getByRole('button', { name: 'Color Cycle + Recolor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Captured CC Data' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Captured CC Data' }));
    expect(screen.getByText('Captured')).toBeInTheDocument();
    expect(screen.getByText('Map 2x2')).toBeInTheDocument();
    expect(screen.getByText('Cycle Length 256')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom Brush Color Cycle Speed')).toBeInTheDocument();
    const velocityToggle = document.getElementById('velocity-animation-speed-custom') as HTMLInputElement | null;
    expect(velocityToggle).toBeTruthy();
  });

  it('reads captured metadata from the saved brush when the raster tip omits it', () => {
    const colorCycle = {
      schemaVersion: 3 as const,
      payloadKind: 'indexed-tip' as const,
      sourceCycleLength: 256,
      mapWidth: 2,
      mapHeight: 2,
      paintIndexMap: new Uint16Array([1, 2, 3, 4]),
    };
    const savedBrush = {
      id: 'saved-v3',
      name: 'Saved V3',
      imageData: new ImageData(2, 2),
      thumbnail: '',
      width: 2,
      height: 2,
      createdAt: 1,
      colorCycle,
    };
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'custom' as BrushSettings['brushShape'],
          selectedCustomBrush: 'saved-v3',
          customBrushColorCycle: true,
          customBrushColorCycleMode: 'captured-data',
          currentBrushTip: {
            brushId: 'saved-v3',
            imageData: savedBrush.imageData,
            isColorizable: false,
            width: 2,
            height: 2,
          },
        },
      },
      project: {
        ...state.project,
        customBrushes: [savedBrush],
      } as AppState['project'],
      getCustomBrushByIdUnsafe: (id: string) => id === 'saved-v3' ? savedBrush : null,
    }));

    render(<BrushControls />);

    expect(screen.getByRole('button', { name: 'Captured CC Data' })).toBeEnabled();
    expect(screen.getByText('Map 2x2')).toBeInTheDocument();
  });

  it('promotes valid captured-data custom brushes out of tip mode', async () => {
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
          indexMap: new Uint16Array([0, 1, 0, 1]),
          capturedColors: ['#ff0000', '#00ff00'],
          useAlphaMask: false,
        },
      } as unknown as AppState['temporaryCustomBrush'],
    }));

    render(<BrushControls />);

    await waitFor(() => {
      expect(useAppStore.getState().tools.brushSettings.customBrushColorCycleMode).toBe('captured-data');
    });
    expect(useAppStore.getState().tools.brushSettings.customBrushUseCapturedAlphaMask).toBe(false);
  });
});

describe('BrushControls – Color Cycle gradient fill mode', () => {
  it('does not expose rounded corner controls', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          gridSnapEnabled: true,
        },
      },
      currentBrushPreset: {
        id: 'color-cycle-gradient',
        name: 'CC Gradient',
      } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    expect(screen.getByRole('checkbox', { name: 'Grid Snap' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /rounded/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Rounded corner radius in pixels')).not.toBeInTheDocument();
  });

  it('shows drawing shape toggle only for the color cycle gradient preset', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        ccGradientSource: 'sampled',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    const { unmount } = render(<BrushControls />);
    expect(screen.getByRole('button', { name: 'Free' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Click Line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poly' })).toBeInTheDocument();
    unmount();

    useAppStore.setState((state) => ({
      ...state,
      brushPresets: [{ id: 'color-cycle-stroke', name: 'CC Stroke' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-stroke', name: 'CC Stroke' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    expect(screen.queryByRole('button', { name: 'Rect' })).not.toBeInTheDocument();
  });

  it('updates drawing shape when toggled on the gradient preset', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          ccGradientDrawingShape: 'freehand',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    await user.click(screen.getByRole('button', { name: 'Oval' }));
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBe('ellipse');
    await user.click(screen.getByRole('button', { name: 'Line' }));
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBe('line');
    await user.click(screen.getByRole('button', { name: 'Click Line' }));
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBe('click-line');
  });

  it('shows fill mode toggle only for the color cycle gradient preset', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    const { unmount } = render(<BrushControls />);
    expect(screen.getByRole('button', { name: 'Grad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concentric' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stroke' })).toBeInTheDocument();
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
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
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
    await user.click(screen.getByRole('button', { name: 'Stroke' }));
    expect(useAppStore.getState().tools.brushSettings.colorCycleFillMode).toBe('stroke');
  });

  it('places stroke immediately after grad in the gradient fill mode tabs', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          colorCycleFillMode: 'linear',
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    const grad = screen.getByRole('button', { name: 'Grad' });
    const stroke = screen.getByRole('button', { name: 'Stroke' });
    const concentric = screen.getByRole('button', { name: 'Concentric' });
    expect(grad.compareDocumentPosition(stroke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stroke.compareDocumentPosition(concentric) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows pressure controls in CC gradient stroke mode', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          colorCycleFillMode: 'stroke',
          pressureEnabled: false,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    expect(screen.getByRole('button', { name: 'Stroke' })).toBeInTheDocument();
    expect(document.getElementById('pressure-enabled-color-cycle')).toBeInTheDocument();
    expect(document.getElementById('rotation-enabled-color-cycle')).toBeInTheDocument();
  });

  it('shows and applies the CC gradient Colors slider when concentric dither is off', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          colorCycleFillMode: 'concentric',
          ditherEnabled: false,
          gradientBands: 7,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    const slider = screen.getByLabelText('CC Gradient Colors');
    expect(slider).toBeInTheDocument();
    expect(screen.queryByLabelText('Dither Pattern Diversity')).not.toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '11' } });

    expect(useAppStore.getState().tools.brushSettings.gradientBands).toBe(11);
  });

  it('shows ink spread inside the CC gradient dither controls', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          ditherEnabled: true,
          ditherPaletteSpread: 24,
          ditherPatternDiversity: 80,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    expect(screen.getByRole('checkbox', { name: 'Grid Snap' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ink Spread')).toBeInTheDocument();
    expect(screen.getByLabelText('Gradient Contrast')).toBeInTheDocument();
    expect(screen.getByLabelText('Dither Pattern Diversity')).toBeInTheDocument();
    expect(screen.getByText('Variety')).toBeInTheDocument();
    expect(screen.getByText('Ink Spd')).toBeInTheDocument();
    expect(screen.getByText('Contrast')).toBeInTheDocument();
  });

  it('shows gradient contrast without ink spread when CC gradient dithering is off', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        ccGradientSource: 'sampled',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          ditherEnabled: false,
          ccGradientRangeContrast: 100,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    expect(screen.getByLabelText('Gradient Contrast')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ink Spread')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Gradient Contrast'), {
      target: { value: '22' },
    });

    expect(useAppStore.getState().tools.brushSettings.ccGradientRangeContrast).toBe(22);
  });

  it('shows gradient contrast when CC gradient dithering is off for manual and foreground sources', () => {
    (['manual', 'fg'] as const).forEach((ccGradientSource) => {
      useAppStore.setState((state) => ({
        ...state,
        tools: {
          ...state.tools,
          ccGradientSource,
          brushSettings: {
            ...state.tools.brushSettings,
            brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
            customBrushColorCycle: false,
            customBrushColorCycleMode: 'tip',
            ditherEnabled: false,
            ccGradientRangeContrast: 100,
          },
        },
        brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
        currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
      }));

      const { unmount } = render(<BrushControls />);

      expect(screen.getByLabelText('Gradient Contrast')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ink Spread')).not.toBeInTheDocument();

      unmount();
    });
  });

  it('hides Colors while showing gradient contrast in the CC Flat Dither brush settings', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        ccGradientSource: 'sampled',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          ditherEnabled: true,
          ccFlatCycleDither: true,
          ccFlatCycleBands: 7,
          ccGradientRangeContrast: 100,
        },
      },
      brushPresets: [{ id: 'color-cycle-flat-dither', name: 'CC Flat Dither' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-flat-dither', name: 'CC Flat Dither' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);

    expect(screen.queryByLabelText('CC Gradient Colors')).not.toBeInTheDocument();
    expect(screen.queryByText('Always on')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Gradient Contrast')).toBeInTheDocument();
    expect(screen.getByLabelText('Ink Spread')).toBeInTheDocument();
    expect(screen.getByLabelText('Flat Cycle Banding')).toBeInTheDocument();
    expect(screen.getByText('Seam')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soft' })).toBeInTheDocument();
  });

  it('updates dither pattern diversity from the CC gradient controls', () => {
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          customBrushColorCycle: false,
          customBrushColorCycleMode: 'tip',
          ditherEnabled: true,
          ditherPatternDiversity: 100,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    fireEvent.change(screen.getByLabelText('Dither Pattern Diversity'), {
      target: { value: '37' },
    });

    expect(useAppStore.getState().tools.brushSettings.ditherPatternDiversity).toBe(37);
  });

  it('toggles grid snap for color cycle gradient', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      ...state,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'color_cycle_shape' as BrushSettings['brushShape'],
          gridSnapEnabled: false,
        },
      },
      brushPresets: [{ id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['brushPresets'][number]],
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as AppState['currentBrushPreset'],
    }));

    render(<BrushControls />);
    await user.click(screen.getByRole('checkbox', { name: 'Grid Snap' }));

    expect(useAppStore.getState().tools.brushSettings.gridSnapEnabled).toBe(true);
  });
});
