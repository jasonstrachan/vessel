import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ColorCycleAutoConvertControls } from '@/components/toolbar/ColorCycleAutoConvertControls';
import { autoConvertActiveImageToColorCycle } from '@/services/colorCycleAutoConvert';

jest.mock('@/stores/useAppStore', () => ({
  __mockState: {
    activeLayerId: 'source-layer',
    layers: [{ id: 'source-layer', layerType: 'normal' }],
    addNotification: jest.fn(),
  },
  useAppStore: (selector: (state: unknown) => unknown) => {
    const state = jest.requireMock('@/stores/useAppStore').__mockState;
    return selector(state);
  },
}));

jest.mock('@/services/colorCycleAutoConvert', () => ({
  autoConvertActiveImageToColorCycle: jest.fn(),
}));

jest.mock('@/components/ui/LabeledSlider', () => ({
  __esModule: true,
  default: ({
    label,
    value,
    min,
    max,
    onChange,
    ariaLabel,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
    ariaLabel: string;
  }) => (
    <label>
      {label}
      <input
        type="range"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  ),
}));

const mockedAutoConvert = autoConvertActiveImageToColorCycle as jest.MockedFunction<
  typeof autoConvertActiveImageToColorCycle
>;
const storeModule = jest.requireMock('@/stores/useAppStore') as {
  __mockState: {
    activeLayerId: string;
    layers: Array<{ id: string; layerType: string }>;
    addNotification: jest.Mock;
  };
};
const mockState = storeModule.__mockState;
const mockAddNotification = mockState.addNotification;

describe('ColorCycleAutoConvertControls', () => {
  beforeEach(() => {
    mockState.activeLayerId = 'source-layer';
    mockState.layers = [{ id: 'source-layer', layerType: 'normal' }];
    mockAddNotification.mockClear();
    mockedAutoConvert.mockReset();
  });

  it('uses the requested shape/detail values and reports one CC layer result', async () => {
    mockedAutoConvert.mockResolvedValue({ layerId: 'cc-layer', shapeCount: 37 });
    render(<ColorCycleAutoConvertControls />);

    expect(screen.getByLabelText('Auto Convert Shapes')).toHaveAttribute('max', '100');
    fireEvent.change(screen.getByLabelText('Auto Convert Shapes'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Detail'), { target: { value: '73' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auto Convert' }));

    await waitFor(() => {
      expect(mockedAutoConvert).toHaveBeenCalledWith({ targetShapes: 42, detail: 73 });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'Created 37 CC shapes in one Color Cycle layer.',
    }));
  });

  it('requires a regular image layer', () => {
    mockState.layers = [{ id: 'source-layer', layerType: 'color-cycle' }];
    render(<ColorCycleAutoConvertControls />);

    expect(screen.getByRole('button', { name: 'Auto Convert' })).toBeDisabled();
  });
});
