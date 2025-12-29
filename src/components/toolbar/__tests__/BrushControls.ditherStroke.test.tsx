import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { create } from 'zustand';

import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';

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

jest.mock('@/components/ui/ButtonGroup', () => ({
  __esModule: true,
  default: ({
    options,
    value,
    onChange,
  }: {
    options: Array<{ label: string; value: string }>;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
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
  GradientEditor: () => <div data-testid="gradient-editor" />,
}));

jest.mock('@/components/ui/Input', () => ({
  __esModule: true,
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

jest.mock('@/stores/useAppStore', () => {
  const baseBrushSettings: BrushSettings = {
    size: 10,
    opacity: 1,
    color: '#000000',
    blendMode: 'source-over',
    spacing: 1,
    pressure: 1,
    rotation: 0,
    antialiasing: false,
    brushShape: BrushShape.PIXEL_DITHER,
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
    gridSnapEnabled: false,
    shapeEnabled: false,
    colorJitter: 0,
    risographIntensity: 0,
    risographOutline: false,
    ditherEnabled: true,
    ditherPaletteSpread: 0,
    ditherPhaseJitter: 0,
    ditherAlgorithm: 'sierra-lite',
    patternStyle: 'dots',
    ditherBackgroundFill: true,
    ditherGradBgFill: true,
    ditherGradSampleEnabled: false,
    lostEdge: 0,
    fillResolution: 1,
    pressureLinkedFillResolution: false,
    pressureDitherSmoosh: false,
    ditherStrokeTipShape: 'round',
    colorCycleGradient: [],
    colorCycleGradientVersion: 0,
    colorCycleFlowMode: 'forward',
    customBrushColorCycle: false,
    colorCycleSpeed: 0.1,
    colorCycleFPS: 30,
    colorCycleFillMode: 'concentric',
    colorCycleBandSpacingPx: 12,
    autoSampleGradient: false,
    gradientBands: 2,
    polygonSides: 3,
    polygonDitherResolution: 1,
    shapeGradientMode: 'contour',
    linkSizeToBrush: true,
  };

  const initialState = {
    tools: {
      currentTool: 'brush',
      previousTool: 'brush',
      lastRegularTool: 'brush',
      lastRegularBrushShape: BrushShape.SQUARE,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      brushSettings: baseBrushSettings,
      eraserSettings: baseBrushSettings,
      fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      shapeMode: false,
      customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
    },
    globalBrushSize: 10,
    activeLayerId: 'layer-1',
    layers: [
      { id: 'layer-1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0, layerType: 'normal' },
    ],
    selectedLayerIds: [],
    referenceLayerId: null,
    layersNeedRecomposition: false,
    brushPresets: [{ id: 'pixel-dither', name: 'Dither Stroke' }],
    currentBrushPreset: { id: 'pixel-dither', name: 'Dither Stroke' } as AppState['currentBrushPreset'],
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
    palette: { foregroundColor: '#000000', backgroundColor: '#ffffff' },
    setBrushSettings: jest.fn((updates: Partial<BrushSettings>) =>
      store.setState((state: AppState) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, ...updates },
        },
      }))
    ),
    setEraserSettings: jest.fn(),
    setGlobalBrushSize: jest.fn(),
    setCustomBrushSizePercent: jest.fn(),
    setShapeMode: jest.fn(),
    setBrushPreset: jest.fn(),
    updateLayer: jest.fn(),
    addNotification: jest.fn(),
    playColorCycle: jest.fn(),
    pauseColorCycle: jest.fn(),
    colorCycleRuntimeHandlers: {},
    setLayersNeedRecomposition: jest.fn(),
    setLayers: jest.fn(),
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    reorderLayers: jest.fn(),
    setActiveLayer: jest.fn(),
    setSelectedLayerIds: jest.fn(),
    setReferenceLayer: jest.fn(),
    updateLayerAlignment: jest.fn(),
    initColorCycleForLayer: jest.fn(),
    cleanupColorCycleForLayer: jest.fn(),
    getLayerColorCycleBrush: jest.fn(() => null),
    compositeLayersToCanvas: jest.fn(() => Promise.resolve(null)),
    captureCanvasToActiveLayer: jest.fn(() => Promise.resolve(null)),
    captureCanvasToLayer: jest.fn(() => Promise.resolve(null)),
    crashReports: [],
    addCrashReport: jest.fn(),
    autosaveDirtyReasons: new Set(),
    markAutosaveDirty: jest.fn(),
    clearDirtyState: jest.fn(),
    setFileBackupMode: jest.fn(),
    setFileBackupFile: jest.fn(),
    setFileBackupDirectory: jest.fn(),
    updateFileBackupTime: jest.fn(),
    setAutosaveInterval: jest.fn(),
    setHistorySize: jest.fn(),
    currentCompositeBitmap: null,
    setCurrentCompositeBitmap: jest.fn(),
    project: null,
    setProject: jest.fn(),
    layersSnapshots: [],
    history: { entries: [], pointer: -1 },
    pushHistory: jest.fn(),
    undo: jest.fn(),
    redo: jest.fn(),
    clearHistory: jest.fn(),
    sampleColorAtPoint: jest.fn(() => Promise.resolve('#000')),
  } as unknown as AppState;

  const store = create<AppState>(() => initialState);
  return { useAppStore: store };
});

import BrushControls from '../BrushControls';
import { useAppStore } from '@/stores/useAppStore';

describe('BrushControls dither stroke tip shapes', () => {
  it('updates the dither stroke tip shape when selection changes', async () => {
    const user = userEvent.setup();
    render(<BrushControls />);

    const diamondButton = screen.getByRole('button', { name: 'Diamond' });
    await user.click(diamondButton);

    expect(useAppStore.getState().setBrushSettings).toHaveBeenCalledWith({
      ditherStrokeTipShape: 'diamond',
    });
  });
});
