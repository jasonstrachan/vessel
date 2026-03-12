import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DitherControls from '../DitherControls';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';

jest.mock('../../ui/Dropdown', () => ({
  __esModule: true,
  default: ({
    options,
    value,
    onChange,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (v: string) => void;
  }) => {
    const isAlgorithm = options.some((opt) => opt.value === 'pattern');
    const testId = isAlgorithm ? 'dither-algorithm' : 'pattern-style';
    return (
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  },
}));

jest.mock('../../ui/ProgressSlider', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    value: number;
    onChange: (v: number) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="range"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  ),
}));

jest.mock('../../ui/CustomSwitch', () => ({
  __esModule: true,
  default: ({
    checked,
    onChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

const baseSettings: BrushSettings = {
  size: 1,
  opacity: 1,
  color: '#000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
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
  fillResolution: 4,
  brushShape: BrushShape.DITHER_GRADIENT,
};

describe('DitherControls wiring', () => {
  it('shows pattern dropdown when algorithm is pattern', () => {
    render(
      <DitherControls
        settings={{ ...baseSettings, ditherAlgorithm: 'pattern', patternStyle: 'dots' }}
        onChange={() => {}}
        forceOn
        hideToggle
      />
    );

    expect(screen.getByTestId('pattern-style')).toBeInTheDocument();
  });

  it('hides pattern dropdown for non-pattern algorithms', () => {
    render(
      <DitherControls
        settings={{ ...baseSettings, ditherAlgorithm: 'bayer' }}
        onChange={() => {}}
        forceOn
        hideToggle
      />
    );

    expect(screen.queryByTestId('pattern-style')).toBeNull();
  });

  it('disables resolution slider when pressure-linked and dither preset', () => {
    render(
      <DitherControls
        settings={{ ...baseSettings, pressureLinkedFillResolution: true }}
        onChange={() => {}}
        forceOn
        hideToggle
        isDitherPreset
      />
    );

    const slider = screen.getByLabelText('Dither Resolution') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect(screen.getByLabelText('Pressure-linked Max Pixel Size')).toBeInTheDocument();
  });

  it('enables resolution slider when not pressure-linked', () => {
    const onChange = jest.fn();
    render(
      <DitherControls
        settings={{ ...baseSettings, pressureLinkedFillResolution: false }}
        onChange={onChange}
        forceOn
        hideToggle
        isDitherPreset
      />
    );

    const slider = screen.getByLabelText('Dither Resolution') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({ fillResolution: 6 });
  });

  it('shows max pixel size control when pressure-linked and wires updates', () => {
    const onChange = jest.fn();
    render(
      <DitherControls
        settings={{
          ...baseSettings,
          pressureLinkedFillResolution: true,
          fillResolution: 4,
          pressureLinkedFillMaxResolution: 9,
        }}
        onChange={onChange}
        forceOn
        hideToggle
      />
    );

    const resolutionSlider = screen.getByLabelText('Dither Resolution') as HTMLInputElement;
    expect(resolutionSlider.disabled).toBe(true);
    const slider = screen.getByLabelText('Pressure-linked Max Pixel Size') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe('9');

    fireEvent.change(slider, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith({ pressureLinkedFillMaxResolution: 7 });
  });

  it('shows lost edge slider for dither gradient brush and wires updates', () => {
    const onChange = jest.fn();
    render(
      <DitherControls
        settings={{ ...baseSettings, lostEdge: 12 }}
        onChange={onChange}
        forceOn
        hideToggle
      />
    );

    const slider = screen.getByLabelText('Lost Edge') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.value).toBe('12');

    fireEvent.change(slider, { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith({ lostEdge: 25 });
  });

  it('shows and wires the pxl edge toggle when enabled for this control set', () => {
    const onChange = jest.fn();
    render(
      <DitherControls
        settings={{ ...baseSettings, pxlEdge: false }}
        onChange={onChange}
        forceOn
        hideToggle
        showPxlEdgeToggle
      />
    );

    const toggle = screen.getByLabelText('Pixel Edge') as HTMLInputElement;
    expect(toggle).toBeInTheDocument();
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ pxlEdge: true });
  });
});
