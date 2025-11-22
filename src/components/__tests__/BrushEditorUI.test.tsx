import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

// Heavy mocking to avoid real store/effects
const mockState = {
  brushEditor: {
    status: 'EDITING',
    editingBrushId: 'custom-1',
    editingBounds: { x: 0, y: 0, width: 16, height: 16 },
    hueShift: 0,
    lightness: 0,
    saturation: 100,
  },
  tools: {
    brushSettings: {
      brushShape: 'custom',
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
  listCustomBrushes: () => mockState.project.customBrushes,
  setBrushEditorHue: jest.fn(),
  setBrushEditorLightness: jest.fn(),
  setBrushEditorSaturation: jest.fn(),
  saveBrushEdit: jest.fn(),
  startBrushEdit: jest.fn(),
  refreshCurrentBrushTipFromSource: jest.fn(),
  updateCurrentBrushTip: jest.fn(),
  getCustomBrushById: () => mockState.project.customBrushes[0],
  pushKeyboardScope: jest.fn(),
  popKeyboardScope: jest.fn(),
};
const mockSetState = jest.fn((updater) => {
  const next = typeof updater === 'function' ? updater(mockState) : updater;
  Object.assign(mockState, next);
});
const mockGetState = jest.fn(() => mockState);

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: any) => selector(mockGetState());
  (useAppStore as any).getState = mockGetState;
  (useAppStore as any).setState = mockSetState;
  (useAppStore as any).subscribe = jest.fn();
  return { useAppStore };
});

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

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

jest.mock('@/components/BrushEditorUI', () => {
  // Re-export the default component to keep import paths intact
  const actual = jest.requireActual('@/components/BrushEditorUI');
  return actual;
});

import BrushEditorUI from '@/components/BrushEditorUI';

describe('BrushEditorUI sliders (mocked store)', () => {
  it('updates hue/lightness/saturation and mirrors into brush settings', () => {
    render(<BrushEditorUI />);

    fireEvent.change(screen.getByTestId('hue-slider'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('lightness-slider'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('saturation-slider'), { target: { value: '80' } });

    expect(mockState.setBrushEditorHue).toHaveBeenCalledWith(45);
    expect(mockState.setBrushEditorLightness).toHaveBeenCalledWith(10);
    expect(mockState.setBrushEditorSaturation).toHaveBeenCalledWith(80);
  });
});
