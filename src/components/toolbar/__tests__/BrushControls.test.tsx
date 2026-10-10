/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BrushControls from '@/components/toolbar/BrushControls';
import { BrushShape } from '@/types';

jest.mock('@/extensions/studioExtension', () => ({
  __esModule: true,
  default: {
    brushPresets: [{ id: 'txt-shape' }],
    BrushControls: () => <div data-testid="studio-brush-controls">Studio controls</div>,
  },
}));

jest.mock('@/components/toolbar/ShapeFillControls', () => ({
  __esModule: true,
  default: () => <div data-testid="shape-fill-controls" />,
}));

const baseBrushSettings = {
  brushShape: BrushShape.SQUARE,
  customBrushSizePercent: 100,
  opacity: 1,
  size: 12,
  spacing: 2,
  color: '#000000',
  ditherEnabled: false,
  pigmentLiftEnabled: false,
};
const mockStore = {
  globalBrushSize: 12,
  currentBrushPreset: { id: 'pixel-square', name: 'Pixel' },
  tools: {
    brushSettings: { ...baseBrushSettings },
    eraserSettings: {
      ...baseBrushSettings,
      brushShape: BrushShape.ROUND,
      size: 8,
      linkSizeToBrush: true,
      ditherPaletteSpread: 0,
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

  it.each(['brush', 'eraser'] as const)('keeps the %s maximum pressure display coherent when a clamp leaves the stored range unchanged', (tool) => {
    const savedEraserSettings = { ...mockStore.tools.eraserSettings };
    mockStore.tools.currentTool = tool;
    Object.assign(mockStore.tools.brushSettings, {
      pressureEnabled: true,
      minPressure: 1000,
      maxPressure: 1000,
    });
    Object.assign(mockStore.tools.eraserSettings, {
      pressureEnabled: true,
      minPressure: 1000,
      maxPressure: 1000,
    });

    const { unmount } = render(<BrushControls />);
    const maximum = screen.getByRole('spinbutton', { name: 'Pressure maximum percent' });
    fireEvent.change(maximum, { target: { value: '0' } });
    fireEvent.blur(maximum);

    expect(maximum).toHaveValue(1000);
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
    expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
    unmount();
    mockStore.tools.eraserSettings = savedEraserSettings;
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

  it('shows the combined soft tip selector first and selects the square tip', () => {
    mockStore.currentBrushPreset = { id: 'soft-round', name: 'Soft' };
    mockStore.tools.brushSettings = {
      ...baseBrushSettings,
      brushShape: BrushShape.ROUND,
    };

    render(<BrushControls />);

    const squareButton = screen.getByRole('button', { name: 'Square' });
    const roundButton = screen.getByRole('button', { name: 'Round' });
    const sizeSlider = screen.getAllByLabelText(/Brush Size/i)[0];

    expect(roundButton).toHaveClass('font-semibold');
    expect(
      roundButton.compareDocumentPosition(sizeSlider) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(squareButton);

    expect(mockStore.setBrushSettings).toHaveBeenCalledWith({
      brushShape: BrushShape.SQUARE,
    });

    mockStore.setBrushSettings.mockClear();
    fireEvent.click(roundButton);

    expect(mockStore.setBrushSettings).toHaveBeenCalledWith({
      brushShape: BrushShape.ROUND,
    });
  });

  it('renders and updates brush size slider', () => {
    render(<BrushControls />);
    const sizeSlider = screen.getAllByLabelText(/Brush Size/i)[0];

    fireEvent.change(sizeSlider, { target: { value: '20' } });
    fireEvent.blur(sizeSlider);

    expect(mockStore.setGlobalBrushSize).toHaveBeenCalled();
  });

  it('displays and edits independent eraser size without resizing the brush', () => {
    mockStore.tools.currentTool = 'eraser';
    mockStore.tools.eraserSettings = {
      ...mockStore.tools.eraserSettings,
      linkSizeToBrush: false,
      size: 40,
    };

    try {
      render(<BrushControls />);
      const sizeSlider = screen.getByLabelText('Brush Size (px)');
      expect(sizeSlider).toHaveValue('40');

      fireEvent.change(sizeSlider, { target: { value: '50' } });
      fireEvent.blur(sizeSlider);

      expect(mockStore.setEraserSettings).toHaveBeenCalledWith({ size: 50 });
      expect(mockStore.setGlobalBrushSize).not.toHaveBeenCalled();
      expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
    } finally {
      mockStore.tools.eraserSettings = {
        ...mockStore.tools.eraserSettings,
        linkSizeToBrush: true,
        size: 8,
      };
    }
  });

  it.each([
    ['dither-grad', 'Dither Grad', BrushShape.DITHER_GRADIENT],
    ['shape-fill', 'Shape Pattern', BrushShape.SHAPE_FILL],
  ] as const)('shows working eraser controls after selecting %s', (id, name, brushShape) => {
    mockStore.currentBrushPreset = { id, name };
    mockStore.tools.brushSettings = { ...baseBrushSettings, brushShape };
    mockStore.tools.currentTool = 'eraser';

    render(<BrushControls />);

    expect(screen.queryByTestId('shape-fill-controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Dither Gradient drawing shape' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Square$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Round$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Diamond5$/ }));
    expect(mockStore.setEraserSettings).toHaveBeenCalledWith({
      brushShape: BrushShape.PIXEL_DITHER,
      ditherStrokeTipShape: 'diamond5',
      antialiasing: false,
    });

    const sizeSlider = screen.getByLabelText('Brush Size (px)');
    fireEvent.change(sizeSlider, { target: { value: '20' } });
    fireEvent.blur(sizeSlider);
    expect(mockStore.setEraserSettings).toHaveBeenCalledWith({ size: 20 });

    const opacitySlider = screen.getByLabelText('Opacity');
    fireEvent.change(opacitySlider, { target: { value: '0.5' } });
    fireEvent.blur(opacitySlider);
    expect(mockStore.setEraserSettings).toHaveBeenCalledWith({ opacity: 0.5 });
    expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['pixel-square', BrushShape.SQUARE],
    ['dither-stroke', BrushShape.PIXEL_DITHER],
    ['dither-shape', BrushShape.PIXEL_DITHER],
    ['dither-grad', BrushShape.DITHER_GRADIENT],
    ['shape-fill', BrushShape.SHAPE_FILL],
  ] as const)('keeps eraser dithering independent of the %s painting preset', (id, brushShape) => {
    mockStore.currentBrushPreset = { id, name: id };
    mockStore.tools.brushSettings = { ...baseBrushSettings, brushShape, ditherEnabled: true };
    mockStore.tools.eraserSettings = { ...mockStore.tools.eraserSettings, ditherEnabled: false };
    mockStore.tools.currentTool = 'eraser';

    const { rerender } = render(<BrushControls key="dither-off" />);
    const ditherRow = screen.getByText('Dither', { selector: 'label' }).parentElement;
    const ditherSwitch = ditherRow?.querySelector('input[type="checkbox"]');

    expect(ditherSwitch).toBeInTheDocument();
    expect(ditherSwitch).not.toBeChecked();
    expect(screen.queryByLabelText('Dither Resolution')).not.toBeInTheDocument();

    fireEvent.click(ditherSwitch!);
    expect(mockStore.setEraserSettings).toHaveBeenLastCalledWith({ ditherEnabled: true });
    expect(mockStore.setBrushSettings).not.toHaveBeenCalled();

    mockStore.tools.eraserSettings = { ...mockStore.tools.eraserSettings, ditherEnabled: true };
    rerender(<BrushControls key="dither-on" />);

    const enabledDitherSwitch = screen.getByText('Dither', { selector: 'label' })
      .parentElement?.querySelector('input[type="checkbox"]');
    expect(enabledDitherSwitch).toBeChecked();
    expect(screen.getAllByLabelText('Dither Resolution')).not.toHaveLength(0);
    fireEvent.click(enabledDitherSwitch!);
    expect(mockStore.setEraserSettings).toHaveBeenLastCalledWith({ ditherEnabled: false });
    expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
    expect(mockStore.tools.brushSettings.ditherEnabled).toBe(true);
    mockStore.tools.eraserSettings = { ...mockStore.tools.eraserSettings, ditherEnabled: false };
  });

  it('preserves forced-on painting dither controls for the Dither Stroke preset', () => {
    mockStore.currentBrushPreset = { id: 'dither-stroke', name: 'Dither Stroke' };
    mockStore.tools.brushSettings = { ...baseBrushSettings, brushShape: BrushShape.PIXEL_DITHER };

    render(<BrushControls />);

    expect(screen.queryByText('Dither', { selector: 'label' })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Dither Resolution')).not.toHaveLength(0);
    expect(mockStore.setBrushSettings).toHaveBeenCalledWith({ ditherEnabled: true });
  });

  it.each([false, true])('hides unsupported eraser Riso hue and edges with dithering %s while keeping intensity usable', (ditherEnabled) => {
    const previousEraserSettings = { ...mockStore.tools.eraserSettings };
    mockStore.tools.currentTool = 'eraser';
    Object.assign(mockStore.tools.eraserSettings, {
      brushShape: BrushShape.SQUARE,
      ditherEnabled,
      risographIntensity: 100,
      risographColorShift: 10,
      risographOutline: true,
    });
    const savedEraserSettings = { ...mockStore.tools.eraserSettings };

    try {
      render(<BrushControls />);

      expect(screen.queryByLabelText('Riso Hue Jitter')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Edges' })).not.toBeInTheDocument();
      expect(mockStore.tools.eraserSettings).toEqual(savedEraserSettings);
      expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
      expect(mockStore.setBrushSettings).not.toHaveBeenCalled();

      const intensity = screen.getByLabelText('Risograph Intensity');
      expect(intensity).toHaveValue('100');
      fireEvent.change(intensity, { target: { value: '50' } });
      fireEvent.blur(intensity);
      expect(mockStore.setEraserSettings).toHaveBeenLastCalledWith({ risographIntensity: 50 });
      expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
      expect(mockStore.tools.eraserSettings).toEqual(savedEraserSettings);
    } finally {
      mockStore.tools.eraserSettings = previousEraserSettings;
    }
  });

  it('keeps painting Riso hue and edges usable without changing eraser settings', () => {
    Object.assign(mockStore.tools.brushSettings, {
      risographIntensity: 100,
      risographColorShift: 10,
      risographOutline: true,
    });
    const savedEraserSettings = { ...mockStore.tools.eraserSettings };

    render(<BrushControls />);

    const hue = screen.getByLabelText('Riso Hue Jitter');
    expect(hue).toHaveValue('10');
    fireEvent.change(hue, { target: { value: '7' } });
    fireEvent.blur(hue);
    expect(mockStore.setBrushSettings).toHaveBeenLastCalledWith({ risographColorShift: 7 });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Edges' }));
    expect(mockStore.setBrushSettings).toHaveBeenLastCalledWith({ risographOutline: false });
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
    expect(mockStore.tools.eraserSettings).toEqual(savedEraserSettings);
  });

  it.each([false, true])('hides unsupported eraser pigment lift controls with dithering %s', (ditherEnabled) => {
    mockStore.tools.currentTool = 'eraser';
    mockStore.tools.eraserSettings = {
      ...mockStore.tools.eraserSettings,
      ditherEnabled,
      pigmentLiftEnabled: true,
    };
    const savedEraserSettings = { ...mockStore.tools.eraserSettings };

    render(<BrushControls />);

    expect(screen.queryByText('PigLift', { selector: 'label' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pigment Lift Strength')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pigment Lift Feather')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pigment Lift Texture')).not.toBeInTheDocument();
    expect(mockStore.tools.eraserSettings).toEqual(savedEraserSettings);
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
    expect(mockStore.setBrushSettings).not.toHaveBeenCalled();
  });

  it('hides color-only palette spread for erasers and retains it for painting', () => {
    mockStore.tools.currentTool = 'eraser';
    mockStore.tools.eraserSettings = { ...mockStore.tools.eraserSettings, ditherPaletteSpread: 75 };
    const { rerender } = render(<BrushControls key="eraser-spread" />);

    expect(screen.queryByLabelText('Dither Palette Spread')).not.toBeInTheDocument();
    expect(mockStore.tools.eraserSettings.ditherPaletteSpread).toBe(75);
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();

    mockStore.tools.currentTool = 'brush';
    rerender(<BrushControls key="brush-spread" />);
    const spread = screen.getByLabelText('Dither Palette Spread');
    fireEvent.change(spread, { target: { value: '50' } });
    fireEvent.blur(spread);
    expect(mockStore.setBrushSettings).toHaveBeenLastCalledWith({ ditherPaletteSpread: 50 });
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
  });

  it('keeps pigment lift controls available for painting', () => {
    mockStore.tools.brushSettings = {
      ...baseBrushSettings,
      ditherEnabled: true,
      pigmentLiftEnabled: true,
    };

    render(<BrushControls />);

    expect(screen.getByText('PigLift', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pigment Lift Strength')).toBeInTheDocument();
    expect(screen.getByLabelText('Pigment Lift Feather')).toBeInTheDocument();
    expect(screen.getByLabelText('Pigment Lift Texture')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'PigLift' }));
    expect(mockStore.setBrushSettings).toHaveBeenLastCalledWith({ pigmentLiftEnabled: false });
    expect(mockStore.setEraserSettings).not.toHaveBeenCalled();
  });

  it.each(['eraser', 'color-picker'] as const)(
    'yields the settings panel to the %s tool while retaining a Studio brush preset',
    (currentTool) => {
      mockStore.currentBrushPreset = { id: 'txt-shape', name: 'TXT Shape' };
      mockStore.tools.brushSettings = {
        ...baseBrushSettings,
        brushShape: BrushShape.EXTENSION,
      };
      mockStore.tools.currentTool = currentTool;

      render(<BrushControls />);

      expect(screen.queryByTestId('studio-brush-controls')).not.toBeInTheDocument();
      expect(screen.getAllByLabelText(/Brush Size/i)).not.toHaveLength(0);
    },
  );

  it('keeps Studio brush controls active for the brush tool', () => {
    mockStore.currentBrushPreset = { id: 'txt-shape', name: 'TXT Shape' };
    mockStore.tools.brushSettings = {
      ...baseBrushSettings,
      brushShape: BrushShape.EXTENSION,
    };

    render(<BrushControls />);

    expect(screen.getByTestId('studio-brush-controls')).toBeInTheDocument();
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

  it('sets custom brush size in pixels down to one pixel', () => {
    (mockStore.tools as any).brushSettings = {
      ...mockStore.tools.brushSettings,
      brushShape: 'custom',
      selectedCustomBrush: 'custom-1',
      size: 16,
      currentBrushTip: {
        imageData: new ImageData(64, 64),
        brushId: 'custom-1',
        width: 64,
        height: 64,
        isColorizable: false,
      },
    };

    render(<BrushControls />);
    const sizeSlider = screen.getByLabelText('Custom Brush Size (px)');

    fireEvent.change(sizeSlider, { target: { value: '1' } });
    fireEvent.blur(sizeSlider);

    expect(mockStore.setGlobalBrushSize).toHaveBeenCalledWith(1);
    expect(mockStore.setCustomBrushSizePercent).not.toHaveBeenCalled();
  });
});
