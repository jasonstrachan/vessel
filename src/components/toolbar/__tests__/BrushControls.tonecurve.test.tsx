import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';

import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';

// Mock light-weight UI primitives to keep test focused on state wiring
jest.mock('@/components/ui/ProgressSlider', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <input
      type="range"
      aria-label="slider"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  ),
}));

jest.mock('@/components/ui/Dropdown', () => ({
  __esModule: true,
  default: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (v: string) => void;
  }) => (
    <select
      data-testid="dropdown"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('@/components/ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <input
      type="checkbox"
      aria-label="switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

jest.mock('@/components/ui/ToneCurveEditor', () => ({
  __esModule: true,
  default: ({ points }: { points: Array<{ x: number; y: number }> }) => (
    <div data-testid="tone-curve">{JSON.stringify(points)}</div>
  ),
}));

// Mock useAppStore with a dedicated zustand store for this test
jest.mock('@/stores/useAppStore', () => {
  const baseBrushSettings: BrushSettings = {
    size: 10,
    opacity: 1,
    color: '#000000',
    blendMode: 'source-over',
    spacing: 1,
    pressure: 1,
    rotation: 0,
    antialiasing: true,
    brushShape: undefined,
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
    colorCycleGradient: [],
    colorCycleGradientVersion: 0,
    colorCycleFPS: 30,
    colorCycleFillMode: 'concentric',
    colorCycleBandSpacingPx: 12,
    autoSampleGradient: false,
    gradientBands: 2,
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
      lastRegularBrushShape: undefined,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      ccGradientSource: 'manual',
      brushSettings: baseBrushSettings,
      eraserSettings: baseBrushSettings,
      fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      shapeMode: false,
      customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
    },
    ccGradientSampleCount: 0,
    ccGradientSampleResetToken: 0,
    globalBrushSize: 10,
    activeLayerId: null,
    layers: [],
    selectedLayerIds: [],
    referenceLayerId: null,
    layersNeedRecomposition: false,
    brushPresets: [],
    currentBrushPreset: { id: 'dither-brush', name: 'Dither' } as unknown as AppState['currentBrushPreset'],
    temporaryCustomBrush: null,
    recolorSampling: { active: false, radius: 10, falloff: 0, start: null, end: null, samples: undefined, target: 'brush' },
    polygonGradientState: {
      drawingState: 'idle',
      points: [],
      previewPath: undefined,
    },
    brushEditor: {
      status: 'IDLE',
      editingBrushId: null,
      editingBounds: null,
      originalCanvasState: null,
      hueShift: 0,
      lightness: 0,
      saturation: 100,
    },
    pressureSettings: { enabled: false, min: 1, max: 1000 },
    colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    // Actions used in BrushControls
    setBrushSettings: jest.fn((updates: Partial<BrushSettings>) =>
      store.setState((state: AppState) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, ...updates },
        },
      }))
    ),
    setCcGradientSource: jest.fn((source: 'manual' | 'fg' | 'sampled') =>
      store.setState((state: AppState) => ({
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
      store.setState((state: AppState) => ({
        ccGradientSampleCount: 0,
        ccGradientSampleResetToken: state.ccGradientSampleResetToken + 1,
      }))
    ),
    setEraserSettings: () => {},
    setGlobalBrushSize: (value: number) => store.setState({ globalBrushSize: value }),
    setCustomBrushSizePercent: () => {},
    setShapeMode: (shapeMode: boolean) =>
      store.setState((state: AppState) => ({ tools: { ...state.tools, shapeMode } })),
    setBrushPreset: () => {},
    updateLayer: () => {},
    addNotification: () => {},
    playColorCycle: () => {},
    pauseColorCycle: () => {},
    colorCycleRuntimeHandlers: {},
    // Unused but required placeholders
    setLayersNeedRecomposition: () => {},
    setLayers: () => {},
    addLayer: () => {},
    removeLayer: () => {},
    reorderLayers: () => {},
    setActiveLayer: () => {},
    setSelectedLayerIds: () => {},
    setReferenceLayer: () => {},
    updateLayerAlignment: () => {},
    initColorCycleForLayer: () => {},
    cleanupColorCycleForLayer: () => {},
    getLayerColorCycleBrush: () => null,
    compositeLayersToCanvas: () => Promise.resolve(null),
    captureCanvasToActiveLayer: () => Promise.resolve(null),
    captureCanvasToLayer: () => Promise.resolve(null),
    crashReports: [],
    addCrashReport: () => {},
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
    history: { entries: [], pointer: -1 },
    pushHistory: () => {},
    undo: () => {},
    redo: () => {},
    clearHistory: () => {},
    // stroke and sampling placeholders
    sampleColorAtPoint: () => Promise.resolve('#000'),
  } as unknown as AppState;

  const store = create<AppState>(() => initialState);
  return { useAppStore: store };
});

import BrushControls from '../BrushControls';

describe('BrushControls per-algorithm tone curve selection', () => {
  it('updates dither algorithm when selection changes', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const dropdown = screen.getByRole('combobox');
    await user.selectOptions(dropdown, 'bayer');

    expect(useAppStore.getState().setBrushSettings).toHaveBeenCalledWith({ ditherAlgorithm: 'bayer' });
  });
});
// @ts-nocheck
