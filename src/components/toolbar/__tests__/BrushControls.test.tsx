/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BrushControls from '@/components/toolbar/BrushControls';

const mockStore = {
  tools: {
    brushSettings: {
      brushShape: 'round',
      customBrushSizePercent: 100,
      opacity: 1,
      size: 12,
      spacing: 2,
      color: '#000000',
    },
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
  const useAppStore = (selector: any) => selector(mockStore);
  (useAppStore as any).getState = api.getState;
  (useAppStore as any).subscribe = api.subscribe;
  return { useAppStore, useAppStoreApi: () => api };
});

describe('BrushControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders and updates brush size slider', () => {
    render(<BrushControls />);
    const sizeSlider = screen.getAllByLabelText(/Brush Size/i)[0];

    fireEvent.change(sizeSlider, { target: { value: '20' } });

    expect(mockStore.setGlobalBrushSize).toHaveBeenCalled();
  });
});
