/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from 'zustand';
import BrushControls from '../BrushControls';
import { type BrushSettings } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('../../ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) => (
    <input
      type="checkbox"
      aria-label={id}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

jest.mock('../DitherControls', () => ({
  __esModule: true,
  default: ({
    beforeResolution,
    afterResolution,
  }: {
    beforeResolution?: React.ReactNode;
    afterResolution?: React.ReactNode;
  }) => (
    <div>
      {beforeResolution}
      {afterResolution}
    </div>
  ),
}));

jest.mock('../../ui/Input', () => ({
  __esModule: true,
  default: ({ value, onChange, type, 'aria-label': ariaLabel }: any) => (
    <input type={type} value={value} aria-label={ariaLabel} onChange={onChange} />
  ),
}));

jest.mock('@/presets/brushPresets', () => ({
  __esModule: true,
  getPresetCapabilities: jest.fn(() => ({ canDither: true, forceDither: true })),
}));

type StoreState = {
  tools: {
    brushSettings: BrushSettings;
    eraserSettings: BrushSettings;
    currentTool: 'brush';
    shapeMode: boolean;
    fillSettings: { threshold: number; contiguous: boolean; eraseInstead: boolean };
    customBrushCapture: { sampleAllLayers: boolean; mode: string; freehandPath: null };
  };
  currentBrushPreset: { id: string; name: string } | null;
  brushPresets: Array<{ id: string; name: string }>;
  globalBrushSize: number;
  palette: { foregroundColor: string; backgroundColor: string; activeSlot: 'foreground' };
  layers: Array<{ id: string; layerType: 'normal' }>;
  activeLayerId: string | null;
  colorCyclePlayback: { desiredPlaying: boolean; suspendDepth: number };
  playColorCycle: () => void;
  pauseColorCycle: () => void;
  colorCycleRuntimeHandlers: unknown;
  setBrushSettings: (updates: Partial<BrushSettings>) => void;
  setEraserSettings: () => void;
  setGlobalBrushSize: () => void;
  setCustomBrushSizePercent: () => void;
  setShapeMode: () => void;
  setBrushPreset: () => void;
  updateLayer: () => void;
  addNotification: () => void;
};

function getBaseBrush(): BrushSettings {
  return {
    size: 1,
    opacity: 1,
    color: '#000000',
    blendMode: 'source-over',
    spacing: 1,
    pressure: 1,
    rotation: 0,
    antialiasing: false,
    dashedEnabled: false,
    dashLength: 1,
    dashGap: 1,
    gridSnapEnabled: false,
    shapeEnabled: false,
    colorJitter: 0,
    risographIntensity: 0,
    risographOutline: false,
    ditherEnabled: true,
    pressureLinkedFillResolution: false,
    pressureEnabled: false,
    minPressure: 1,
    maxPressure: 1000,
    rotationEnabled: false,
    useSwatchColor: false,
    lastRegularBrushSize: 1,
    fillResolution: 1,
    brushShape: 'dither_gradient' as BrushSettings['brushShape'],
    ditherGradStops: ['#000000', '#ffffff'],
    ditherGradSampleEnabled: false,
    gradientLength: 100,
    trans: 0,
  };
}

function createStore() {
  return create<StoreState>((set) => {
    const initial: StoreState = {
      tools: {
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: { ...getBaseBrush() },
        eraserSettings: { ...getBaseBrush() },
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
        customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
      },
      currentBrushPreset: { id: 'dither-grad', name: 'Dither Grad' },
      brushPresets: [{ id: 'dither-grad', name: 'Dither Grad' }],
      globalBrushSize: 10,
      palette: { foregroundColor: '#000000', backgroundColor: '#ffffff', activeSlot: 'foreground' },
      layers: [{ id: 'layer-1', layerType: 'normal' }],
      activeLayerId: 'layer-1',
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
      playColorCycle: () => {},
      pauseColorCycle: () => {},
      colorCycleRuntimeHandlers: { updateGradient: jest.fn(), setFlowMode: jest.fn() },
      setBrushSettings: jest.fn((updates: Partial<BrushSettings>) =>
        set((state) => ({
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
      updateLayer: () => {},
      addNotification: () => {},
    };
    return initial;
  });
}

jest.mock('@/stores/useAppStore', () => {
  const store = createStore();
  const useAppStore = (selector?: any) =>
    typeof selector === 'function' ? selector(store.getState()) : store.getState();
  (useAppStore as any).getState = store.getState;
  (useAppStore as any).setState = store.setState;
  (useAppStore as any).subscribe = store.subscribe;
  return {
    useAppStore,
    selectEffectiveColorCyclePlaying: (state: StoreState) =>
      state.colorCyclePlayback.desiredPlaying,
  };
});

describe('BrushControls – Dither Gradient', () => {
  beforeEach(() => {
    const storeApi = useAppStore as unknown as {
      getState: () => StoreState;
      setState: (state: Partial<StoreState>) => void;
    };
    storeApi.setState({
      tools: {
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: { ...getBaseBrush() },
        eraserSettings: { ...getBaseBrush() },
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
        customBrushCapture: { sampleAllLayers: false, mode: 'rectangle', freehandPath: null },
      },
      currentBrushPreset: { id: 'dither-grad', name: 'Dither Grad' },
      brushPresets: [{ id: 'dither-grad', name: 'Dither Grad' }],
      globalBrushSize: 10,
      palette: { foregroundColor: '#000000', backgroundColor: '#ffffff', activeSlot: 'foreground' },
      layers: [{ id: 'layer-1', layerType: 'normal' }],
      activeLayerId: 'layer-1',
    });
    const storeState = storeApi.getState();
    (storeState.setBrushSettings as jest.Mock).mockClear();
  });

  it('toggles sample flag', () => {
    render(<BrushControls />);
    const sampleToggle = screen.getByLabelText('dither-grad-sample') as HTMLInputElement;

    expect(sampleToggle.checked).toBe(false);
    fireEvent.click(sampleToggle);

    const store = useAppStore.getState();
    expect(store.setBrushSettings).toHaveBeenCalledWith({ ditherGradSampleEnabled: true });
  });

  it('updates stop count via colors slider', () => {
    render(<BrushControls />);
    const slider = screen.getByLabelText('Dither Gradient Colors');

    fireEvent.change(slider, { target: { value: '3' } });
    fireEvent.blur(slider);

    const store = useAppStore.getState();
    expect(store.setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: ['#000000', '#808080', '#FFFFFF'],
    });
  });

  it('updates transparent count via trans slider', () => {
    render(<BrushControls />);
    const slider = screen.getByLabelText('Transparent Colors');

    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.blur(slider);

    const store = useAppStore.getState();
    expect(store.setBrushSettings).toHaveBeenCalledWith({ trans: 1 });
  });

  it('updates gradient length', () => {
    render(<BrushControls />);
    const slider = screen.getByLabelText('Gradient Length (%)');

    fireEvent.change(slider, { target: { value: '150' } });
    fireEvent.blur(slider);

    const store = useAppStore.getState();
    expect(store.setBrushSettings).toHaveBeenCalledWith({ gradientLength: 150 });
  });

  it('clamps trans when reducing color count', () => {
    const storeApi = useAppStore as unknown as {
      getState: () => StoreState;
      setState: (state: Partial<StoreState>) => void;
    };
    storeApi.setState({
      tools: {
        ...storeApi.getState().tools,
        brushSettings: {
          ...storeApi.getState().tools.brushSettings,
          ditherGradStops: [
            '#000000',
            '#333333',
            '#666666',
            '#999999',
            '#CCCCCC',
            '#FFFFFF',
          ],
          trans: 5,
        },
      },
    });

    render(<BrushControls />);
    const slider = screen.getByLabelText('Dither Gradient Colors');

    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.blur(slider);

    const store = useAppStore.getState();
    expect(store.setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: ['#000000', '#ffffff'],
      trans: 1,
    });
  });
});
