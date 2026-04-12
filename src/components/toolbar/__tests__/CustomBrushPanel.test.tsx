import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import { CustomBrushPanel } from '@/components/toolbar/CustomBrushPanel';
import type { Layer } from '@/types';

const mockCaptureBrushFromCanvas = jest.fn();
const mockCaptureBrushFromPath = jest.fn();
const mockCaptureColorCycleDataFromLayer = jest.fn();
const mockBuildCapturedColorCycleDataFromImage = jest.fn();

jest.mock('@/utils/customBrushCapture', () => ({
  __esModule: true,
  selectionToCaptureBounds: () => ({ x: 0, y: 0, width: 4, height: 4 }),
  captureBrushFromCanvas: (...args: unknown[]) => mockCaptureBrushFromCanvas(...args),
  captureBrushFromPath: (...args: unknown[]) => mockCaptureBrushFromPath(...args),
  captureColorCycleDataFromLayer: (...args: unknown[]) => mockCaptureColorCycleDataFromLayer(...args),
  buildCapturedColorCycleDataFromImage: (...args: unknown[]) =>
    mockBuildCapturedColorCycleDataFromImage(...args),
}));

jest.mock('@/components/ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({
    checked,
    onChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onChange: (value: boolean) => void;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
}));

type MockState = {
  project: {
    customBrushes: unknown[];
  } | null;
  layers: Layer[];
  activeLayerId: string | null;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  currentOffscreenCanvas: HTMLCanvasElement | null;
  temporaryCustomBrush: unknown | null;
  tools: {
    customBrushCapture: {
      sampleAllLayers: boolean;
      mode: 'rectangle' | 'freehand';
      freehandPath: null;
    };
    brushSettings: {
      brushShape: string;
      selectedCustomBrush: string | null;
      currentBrushTip?: unknown;
    };
  };
  addCustomBrush: jest.Mock;
  clearSelection: jest.Mock;
  setTemporaryCustomBrush: jest.Mock;
  setBrushSettings: jest.Mock;
  setGlobalBrushSize: jest.Mock;
  setCustomBrushSizePercent: jest.Mock;
  setCustomBrushSampleAllLayers: jest.Mock;
  setCustomBrushCaptureMode: jest.Mock;
  setCustomBrushFreehandPath: jest.Mock;
  setCurrentTool: jest.Mock;
};

function makeColorCycleLayer(): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  return {
    id: 'layer-cc',
    name: 'CC',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    framebuffer: canvas,
    imageData: null,
    alignment: {
      fit: 'contain',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'anchor',
    },
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'brush',
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      brushSpeed: 0.5,
    },
  };
}

function makeBaseState(): MockState {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  return {
    project: { customBrushes: [] },
    layers: [makeColorCycleLayer()],
    activeLayerId: 'layer-cc',
    selectionStart: { x: 0, y: 0 },
    selectionEnd: { x: 4, y: 4 },
    currentOffscreenCanvas: canvas,
    temporaryCustomBrush: null,
    tools: {
      customBrushCapture: {
        sampleAllLayers: false,
        mode: 'rectangle',
        freehandPath: null,
      },
      brushSettings: {
        brushShape: 'round',
        selectedCustomBrush: null,
      },
    },
    addCustomBrush: jest.fn(),
    clearSelection: jest.fn(),
    setTemporaryCustomBrush: jest.fn(),
    setBrushSettings: jest.fn(),
    setGlobalBrushSize: jest.fn(),
    setCustomBrushSizePercent: jest.fn(),
    setCustomBrushSampleAllLayers: jest.fn(),
    setCustomBrushCaptureMode: jest.fn(),
    setCustomBrushFreehandPath: jest.fn(),
    setCurrentTool: jest.fn(),
  };
}

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = create<MockState>(() => makeBaseState());
  return { useAppStore };
});

import { useAppStore } from '@/stores/useAppStore';

const createCaptureResult = () => ({
  imageData: new ImageData(4, 4),
  width: 4,
  height: 4,
  naturalWidth: 4,
  naturalHeight: 4,
  maxDimension: 4,
  thumbnail: 'data:image/png;base64,aaaa',
});

describe('CustomBrushPanel CC capture hint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAppStore as unknown as { setState: (partial: unknown, replace?: boolean) => void }).setState(
      makeBaseState(),
      true
    );
    const setTemporaryCustomBrush = jest.fn((brush: unknown) => {
      (useAppStore as unknown as { setState: (partial: unknown) => void }).setState({
        temporaryCustomBrush: brush,
      });
    });
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState({
      setTemporaryCustomBrush,
    });
    mockCaptureBrushFromCanvas.mockReturnValue(createCaptureResult());
    mockCaptureBrushFromPath.mockReturnValue(createCaptureResult());
    mockCaptureColorCycleDataFromLayer.mockReturnValue({
      schemaVersion: 2,
      mode: 'captured-data',
      source: 'color-cycle-layer',
      sourceCycleLength: 256,
      mapWidth: 4,
      mapHeight: 4,
      phaseMap: new Uint16Array(16),
      alphaMask: new Uint8Array(16),
    });
    mockBuildCapturedColorCycleDataFromImage.mockReturnValue({
      schemaVersion: 2,
      mode: 'captured-data',
      source: 'color-cycle-layer',
      sourceCycleLength: 256,
      mapWidth: 4,
      mapHeight: 4,
      phaseMap: new Uint16Array(16),
      alphaMask: new Uint8Array(16),
    });
  });

  it('shows CC import hint when capturing from active color-cycle layer only', async () => {
    render(<CustomBrushPanel />);

    await waitFor(() => {
      expect(
        screen.getByText('Imported color-cycle gradient and speed from active CC layer.')
      ).toBeInTheDocument();
    });

    const setBrushSettings =
      (useAppStore as unknown as { getState: () => MockState }).getState().setBrushSettings as jest.Mock;
    expect(setBrushSettings).toHaveBeenCalled();
    const latestCallArg = setBrushSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestCallArg.customBrushColorCycle).toBe(true);
    expect(latestCallArg.pressureEnabled).toBe(false);
    expect(latestCallArg.minPressure).toBe(99);
    expect(latestCallArg.maxPressure).toBeUndefined();
    const setTemporaryCustomBrush =
      (useAppStore as unknown as { getState: () => MockState }).getState().setTemporaryCustomBrush as jest.Mock;
    const tempBrushArg = setTemporaryCustomBrush.mock.calls.at(-1)?.[0] as { colorCycle?: { source?: string; schemaVersion?: number; mode?: string } };
    expect(tempBrushArg.colorCycle?.source).toBe('color-cycle-layer');
    expect(tempBrushArg.colorCycle?.schemaVersion).toBe(2);
    expect(tempBrushArg.colorCycle?.mode).toBe('captured-data');
  });

  it('does not show CC import hint when capture source is all layers', async () => {
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState((state: MockState) => ({
      ...state,
      tools: {
        ...state.tools,
        customBrushCapture: {
          ...state.tools.customBrushCapture,
          sampleAllLayers: true,
        },
      },
    }));

    render(<CustomBrushPanel />);

    await waitFor(() => {
      expect(mockCaptureBrushFromCanvas).toHaveBeenCalled();
    });
    expect(
      screen.queryByText('Imported color-cycle gradient and speed from active CC layer.')
    ).toBeNull();

    const setBrushSettings =
      (useAppStore as unknown as { getState: () => MockState }).getState().setBrushSettings as jest.Mock;
    const latestCallArg = setBrushSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestCallArg.customBrushColorCycle).toBe(false);
    expect(latestCallArg.pressureEnabled).toBe(false);
    expect(latestCallArg.minPressure).toBe(99);
    expect(latestCallArg.maxPressure).toBeUndefined();
    const setTemporaryCustomBrush =
      (useAppStore as unknown as { getState: () => MockState }).getState().setTemporaryCustomBrush as jest.Mock;
    const tempBrushArg = setTemporaryCustomBrush.mock.calls.at(-1)?.[0] as { colorCycle?: unknown };
    expect(tempBrushArg.colorCycle).toBeUndefined();
  });

  it('shows selection dimensions for rectangle capture', () => {
    render(<CustomBrushPanel />);

    expect(screen.getByText('Selection')).toBeInTheDocument();
    expect(screen.getByText('4×4')).toBeInTheDocument();
  });

  it('shows CC import hint for freehand capture from active color-cycle layer', async () => {
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState((state: MockState) => ({
      ...state,
      tools: {
        ...state.tools,
        customBrushCapture: {
          ...state.tools.customBrushCapture,
          mode: 'freehand',
          freehandPath: {
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 2, y: 4 },
            ],
            bounds: { x: 0, y: 0, width: 4, height: 4 },
          },
        },
      },
    }));

    render(<CustomBrushPanel />);

    await waitFor(() => {
      expect(mockCaptureBrushFromPath).toHaveBeenCalled();
      expect(
        screen.getByText('Imported color-cycle gradient and speed from active CC layer.')
      ).toBeInTheDocument();
    });

    const setBrushSettings =
      (useAppStore as unknown as { getState: () => MockState }).getState().setBrushSettings as jest.Mock;
    const latestCallArg = setBrushSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestCallArg.customBrushColorCycle).toBe(true);
    expect(latestCallArg.pressureEnabled).toBe(false);
    expect(latestCallArg.minPressure).toBe(99);
    expect(latestCallArg.maxPressure).toBeUndefined();
    const setCurrentTool =
      (useAppStore as unknown as { getState: () => MockState }).getState().setCurrentTool as jest.Mock;
    expect(setCurrentTool).toHaveBeenCalledWith('brush');
  });

  it('shows capture bounds dimensions for freehand capture', () => {
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState((state: MockState) => ({
      ...state,
      currentOffscreenCanvas: null,
      selectionStart: null,
      selectionEnd: null,
      tools: {
        ...state.tools,
        customBrushCapture: {
          ...state.tools.customBrushCapture,
          mode: 'freehand',
          freehandPath: {
            points: [
              { x: 0, y: 0 },
              { x: 8, y: 0 },
              { x: 4, y: 6 },
            ],
            bounds: { x: 1, y: 2, width: 8, height: 6 },
          },
        },
      },
    }));

    render(<CustomBrushPanel />);

    expect(screen.getByText('Capture bounds')).toBeInTheDocument();
    expect(screen.getByText('8×6')).toBeInTheDocument();
  });

  it('falls back to image-derived captured payload when layer map extraction is unavailable', async () => {
    mockCaptureColorCycleDataFromLayer.mockReturnValue(undefined);

    render(<CustomBrushPanel />);

    await waitFor(() => {
      expect(mockBuildCapturedColorCycleDataFromImage).toHaveBeenCalled();
    });

    const setTemporaryCustomBrush =
      (useAppStore as unknown as { getState: () => MockState }).getState().setTemporaryCustomBrush as jest.Mock;
    const tempBrushArg = setTemporaryCustomBrush.mock.calls.at(-1)?.[0] as { colorCycle?: { schemaVersion?: number; mode?: string } };
    expect(tempBrushArg.colorCycle?.schemaVersion).toBe(2);
    expect(tempBrushArg.colorCycle?.mode).toBe('captured-data');
  });

  it('cancels temporary capture on Escape in rectangle mode', async () => {
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState((state: MockState) => ({
      ...state,
      selectionStart: null,
      selectionEnd: null,
      temporaryCustomBrush: {
        id: 'temp_brush_1',
        imageData: new ImageData(2, 2),
        width: 2,
        height: 2,
        thumbnail: 'data:image/png;base64,aaaa',
      },
      tools: {
        ...state.tools,
        customBrushCapture: {
          ...state.tools.customBrushCapture,
          mode: 'rectangle',
        },
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: 'custom',
          selectedCustomBrush: 'temp_brush_1',
        },
      },
    }));

    render(<CustomBrushPanel />);
    fireEvent.keyDown(window, { key: 'Escape' });

    const store = (useAppStore as unknown as { getState: () => MockState }).getState();
    expect(store.setTemporaryCustomBrush).toHaveBeenCalledWith(null);
    expect(store.clearSelection).toHaveBeenCalled();
    expect(store.setCustomBrushFreehandPath).toHaveBeenCalledWith(null);
    expect(store.setBrushSettings).toHaveBeenCalledWith({
      brushShape: 'round',
      selectedCustomBrush: null,
      currentBrushTip: undefined,
    });
  });

  it('cancels freehand capture path on Escape', async () => {
    (useAppStore as unknown as { setState: (partial: unknown) => void }).setState((state: MockState) => ({
      ...state,
      currentOffscreenCanvas: null,
      selectionStart: null,
      selectionEnd: null,
      tools: {
        ...state.tools,
        customBrushCapture: {
          ...state.tools.customBrushCapture,
          mode: 'freehand',
          freehandPath: {
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 2, y: 4 },
            ],
            bounds: { x: 0, y: 0, width: 4, height: 4 },
          },
        },
      },
    }));

    render(<CustomBrushPanel />);
    fireEvent.keyDown(window, { key: 'Escape' });

    const store = (useAppStore as unknown as { getState: () => MockState }).getState();
    expect(store.setCustomBrushFreehandPath).toHaveBeenCalledWith(null);
    expect(store.clearSelection).toHaveBeenCalled();
  });
});
