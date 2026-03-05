/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecolorPanel } from '@/components/colorCycle/RecolorPanel';
import { Layer } from '@/types';

const clearError = jest.fn();

jest.mock('../hooks/useRecolorState', () => ({
  useRecolorState: () => ({
    state: {
      mode: 'recolor',
      error: 'Something went wrong',
      gradientStops: [],
      selectedGradientId: 'default',
    },
    actions: {
      clearError,
    },
    processLayer: jest.fn(),
    toggleAnimation: jest.fn(),
    updateLayerSpeed: jest.fn(),
    updateLayerCycleColors: jest.fn(),
    updateLayerFlowDirection: jest.fn(),
    updateLayerMappingMode: jest.fn(),
    updateGradient: jest.fn(),
    updateGlobalFPS: jest.fn(),
    successMessage: '',
  }),
}));

jest.mock('@/components/ui/GradientEditor', () => ({ GradientEditor: () => <div data-testid="gradient-editor" /> }));
jest.mock('../controls/AnimationControls', () => ({ AnimationControls: () => <div data-testid="animation-controls" /> }));
jest.mock('../dialogs/ConfirmationDialog', () => ({
  ConfirmationDialog: () => <div data-testid="confirmation-dialog" />,
}));

const makeLayer = (): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: new ImageData(2, 2),
  framebuffer: (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    return canvas;
  })(),
  alignment: {
    fit: 'contain',
    horizontal: 'center',
    vertical: 'center',
    positioning: 'anchor',
    offsetPx: { x: 0, y: 0 },
  },
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'recolor',
    gradient: [],
    recolorSettings: {
      gradient: [] as any,
      quantizationMode: 'rgb332',
      ditherMode: 'off',
      currentLOD: 'full',
      animation: {
        speed: 1,
        fps: 60,
        ticksPerFrame: 1,
        isPlaying: true,
        currentTick: 0,
        flowDirection: 'reverse',
      },
      cycleColors: 8,
      mappingMode: 'banded',
      flowMapping: 'palette',
    },
  },
});

describe('RecolorPanel', () => {
  afterEach(() => {
    clearError.mockClear();
  });

  it('shows no-layer hint when no active layer is provided', () => {
    render(<RecolorPanel activeLayer={null} isVisible onCommit={jest.fn()} />);

    expect(screen.getByText(/No Layer Selected/i)).toBeInTheDocument();
  });

  it('renders error banner and clears on dismiss', () => {
    render(<RecolorPanel activeLayer={makeLayer()} isVisible onCommit={jest.fn()} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByText('×'));
    expect(clearError).toHaveBeenCalled();
  });
});
