import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import BrushEditorUI from '@/components/BrushEditorUI';
import { BrushShape } from '@/types';

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: () => ({
    resetStroke: jest.fn(),
    drawBrush: jest.fn(),
  }),
}));

const sliderMock = (testId: string) => (props: any) => {
  const { value = [0], onValueChange, min = -180, max = 180, step = 1 } = props;
  return (
    <input
      data-testid={testId}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0] ?? 0}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
    />
  );
};

jest.mock('@/components/ui/HueSlider', () => ({ HueSlider: sliderMock('hue-slider') }));
jest.mock('@/components/ui/LightnessSlider', () => ({ LightnessSlider: sliderMock('lightness-slider') }));
jest.mock('@/components/ui/SaturationSlider', () => ({ SaturationSlider: sliderMock('saturation-slider') }));

const setupStore = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;

  useAppStore.setState((state) => ({
    ...state,
    brushEditor: {
      ...state.brushEditor,
      status: 'EDITING',
      editingBrushId: 'custom-1',
      editingBounds: { x: 0, y: 0, width: 16, height: 16 },
      hueShift: 0,
      lightness: 0,
      saturation: 100,
    },
    currentOffscreenCanvas: canvas,
    tools: {
      ...state.tools,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.CUSTOM,
        selectedCustomBrush: 'custom-1',
        size: 4,
        hueShift: 0,
        lightnessAdjust: 0,
        saturationAdjust: 100,
      },
    },
    project: {
      id: 'p1',
      name: 'demo',
      width: 32,
      height: 32,
      backgroundColor: '#000',
      layers: [],
      customBrushes: [
        {
          id: 'custom-1',
          name: 'Custom One',
          imageData: new ImageData(16, 16),
          thumbnail: '',
          width: 16,
          height: 16,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }));
};

describe('BrushEditorUI sliders', () => {
  afterEach(() => {
    useAppStore.setState({ project: null });
  });

  it('updates brush editor hue/lightness/saturation and mirrors into brush settings', () => {
    setupStore();
    render(<BrushEditorUI />);

    fireEvent.change(screen.getByTestId('hue-slider'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('lightness-slider'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('saturation-slider'), { target: { value: '80' } });

    const state = useAppStore.getState();
    expect(state.brushEditor.hueShift).toBe(45);
    expect(state.brushEditor.lightness).toBe(10);
    expect(state.brushEditor.saturation).toBe(80);
    expect(state.tools.brushSettings.hueShift).toBe(45);
    expect(state.tools.brushSettings.lightnessAdjust).toBe(10);
    expect(state.tools.brushSettings.saturationAdjust).toBe(80);
  });
});
