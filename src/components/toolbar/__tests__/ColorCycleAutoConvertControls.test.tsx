import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

jest.mock('@/components/ui/LabeledRangeSlider', () => ({
  __esModule: true,
  default: ({
    label,
    value,
    min,
    max,
    onChange,
    minAriaLabel,
    maxAriaLabel,
  }: {
    label: string;
    value: [number, number];
    min: number;
    max: number;
    onChange: (value: [number, number]) => void;
    minAriaLabel: string;
    maxAriaLabel: string;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      <input
        type="range"
        aria-label={minAriaLabel}
        value={value[0]}
        min={min}
        max={max}
        onChange={(event) => onChange([Number(event.target.value), value[1]])}
      />
      <input
        type="range"
        aria-label={maxAriaLabel}
        value={value[1]}
        min={min}
        max={max}
        onChange={(event) => onChange([value[0], Number(event.target.value)])}
      />
    </fieldset>
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
    window.localStorage.clear();
    mockState.activeLayerId = 'source-layer';
    mockState.layers = [{ id: 'source-layer', layerType: 'normal' }];
    mockAddNotification.mockClear();
    mockedAutoConvert.mockReset();
  });

  it('restores the last control values after the controls remount', async () => {
    mockedAutoConvert.mockResolvedValue({ layerId: 'cc-layer', shapeCount: 492 });
    const firstRender = render(<ColorCycleAutoConvertControls />);

    fireEvent.change(screen.getByLabelText('Auto Convert Shapes'), { target: { value: '492' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Focus'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Coverage'), { target: { value: '37' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Resolution Minimum'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Auto Convert Resolution Maximum'), {
      target: { value: '11' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auto Convert' }));
    await waitFor(() => expect(mockedAutoConvert).toHaveBeenCalled());

    firstRender.unmount();
    render(<ColorCycleAutoConvertControls />);

    await waitFor(() => {
      expect(screen.getByLabelText('Auto Convert Shapes')).toHaveValue('492');
      expect(screen.getByLabelText('Auto Convert Focus')).toHaveValue('100');
      expect(screen.getByLabelText('Auto Convert Coverage')).toHaveValue('37');
      expect(screen.getByLabelText('Auto Convert Resolution Minimum')).toHaveValue('3');
      expect(screen.getByLabelText('Auto Convert Resolution Maximum')).toHaveValue('11');
    });
  });

  it('uses the requested shape, focus, and resolution range values', async () => {
    mockedAutoConvert.mockResolvedValue({ layerId: 'cc-layer', shapeCount: 37 });
    render(<ColorCycleAutoConvertControls />);

    expect(screen.getByLabelText('Auto Convert Shapes')).toHaveAttribute('max', '1000');
    expect(screen.getByLabelText('Auto Convert Resolution Minimum')).toHaveAttribute('max', '64');
    expect(screen.getByLabelText('Auto Convert Resolution Maximum')).toHaveAttribute('max', '64');
    fireEvent.change(screen.getByLabelText('Auto Convert Shapes'), { target: { value: '142' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Focus'), { target: { value: '73' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Coverage'), { target: { value: '62' } });
    fireEvent.change(screen.getByLabelText('Auto Convert Resolution Minimum'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Auto Convert Resolution Maximum'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auto Convert' }));

    await waitFor(() => {
      expect(mockedAutoConvert).toHaveBeenCalledWith({
        targetShapes: 142,
        focus: 73,
        coverage: 62,
        resolutionRange: [2, 12],
        onProgress: expect.any(Function),
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'Created 37 CC shapes in one Color Cycle layer.',
    }));
  });

  it('shows analysis and determinate painting progress inside the button', async () => {
    let reportProgress: Parameters<typeof autoConvertActiveImageToColorCycle>[0]['onProgress'];
    let resolveConversion!: (value: { layerId: string; shapeCount: number }) => void;
    mockedAutoConvert.mockImplementation(({ onProgress }) => {
      reportProgress = onProgress;
      return new Promise((resolve) => {
        resolveConversion = resolve;
      });
    });
    render(<ColorCycleAutoConvertControls />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto Convert' }));
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();

    act(() => {
      reportProgress?.({ phase: 'painting', completed: 120, total: 400 });
    });
    const convertingButton = screen.getByRole('button', { name: 'Painting 120 / 400' });
    const progressbar = screen.getByRole('progressbar', { name: 'Auto Convert progress' });
    expect(convertingButton).toBeDisabled();
    expect(progressbar).toHaveAttribute(
      'aria-valuenow',
      '30',
    );
    expect(convertingButton).not.toContainElement(progressbar);
    expect(convertingButton.querySelector('[aria-hidden="true"][style*="width: 30%"]'))
      .not.toBeNull();

    await act(async () => {
      resolveConversion({ layerId: 'cc-layer', shapeCount: 400 });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Auto Convert' })).toBeEnabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('requires a regular image layer', () => {
    mockState.layers = [{ id: 'source-layer', layerType: 'color-cycle' }];
    render(<ColorCycleAutoConvertControls />);

    expect(screen.getByRole('button', { name: 'Auto Convert' })).toBeDisabled();
  });
});
