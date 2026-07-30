/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BrushControls from '@/components/toolbar/BrushControls';
import { BrushShape } from '@/types';

const baseBrushSettings = {
  brushShape: BrushShape.SQUARE,
  customBrushSizePercent: 100,
  opacity: 1,
  size: 12,
  spacing: 2,
  color: '#000000',
};
const mockStore = {
  currentBrushPreset: { id: 'pixel-square', name: 'Pixel' },
  tools: {
    brushSettings: { ...baseBrushSettings },
    eraserSettings: {
      brushShape: 'round',
      size: 8,
      linkSizeToBrush: true,
      color: '#ffffff',
    },
    currentTool: 'brush',
    globalBrushSize: 12,
  },
  setBrushSettings: jest.fn(),
  setEraserSettings: jest.fn(),
  setGlobalBrushSize: jest.fn(),
  setCustomBrushSizePercent: jest.fn(),
  setShapeMode: jest.fn(),
  setBrushPreset: jest.fn(),
  brushPresets: [{ id: 'preset1', name: 'Preset 1', settings: { size: 10 } }],
  shapeMode: { fillMode: 'solid' },
  layers: [{ id: 'l1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0, layerType: 'normal' }],
  activeLayerId: 'l1',
  colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
  playColorCycle: jest.fn(),
  pauseColorCycle: jest.fn(),
  colorCycleRuntimeHandlers: {},
  updateLayer: jest.fn(),
  addNotification: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => {
  const api = {
    getState: () => mockStore,
    setState: () => {},
    subscribe: () => () => {},
  };
  const useAppStore = (selector?: any) =>
    typeof selector === 'function' ? selector(mockStore) : mockStore;
  (useAppStore as any).getState = api.getState;
  (useAppStore as any).subscribe = api.subscribe;
  return {
    useAppStore,
    useAppStoreApi: () => api,
    selectEffectiveColorCyclePlaying: (state: typeof mockStore) =>
      state.colorCyclePlayback.desiredPlaying,
  };
});

describe('BrushControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.currentBrushPreset = { id: 'pixel-square', name: 'Pixel' };
    mockStore.tools.brushSettings = { ...baseBrushSettings };
    mockStore.tools.currentTool = 'brush';
  });

  it('shows the combined pixel tip selector first and selects the round tip', () => {
    render(<BrushControls />);

    const squareButton = screen.getByRole('button', { name: 'Square' });
    const roundButton = screen.getByRole('button', { name: 'Round' });
    const sizeSlider = screen.getAllByLabelText(/Brush Size/i)[0];

    expect(squareButton).toHaveClass('font-semibold');
    expect(
      squareButton.compareDocumentPosition(sizeSlider) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(roundButton);

    expect(mockStore.setBrushSettings).toHaveBeenCalledWith({
      brushShape: BrushShape.PIXEL_ROUND,
    });
  });

  it('renders and updates brush size slider', () => {
    render(<BrushControls />);
    const sizeSlider = screen.getAllByLabelText(/Brush Size/i)[0];

    fireEvent.change(sizeSlider, { target: { value: '20' } });
    fireEvent.blur(sizeSlider);

    expect(mockStore.setGlobalBrushSize).toHaveBeenCalled();
  });

  it('shows brush snap toggle for custom brushes', () => {
    (mockStore.tools as any).brushSettings = {
      ...mockStore.tools.brushSettings,
      brushShape: 'custom',
      selectedCustomBrush: 'custom-1',
      customBrushSnapEnabled: true,
      currentBrushTip: {
        imageData: new ImageData(16, 8),
        brushId: 'custom-1',
        width: 16,
        height: 8,
        isColorizable: false,
      },
    };

    render(<BrushControls />);

    expect(screen.getByLabelText('Custom Brush Snap')).toBeChecked();
  });
});
