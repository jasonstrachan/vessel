/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { GradientEditor } from '../GradientEditor';
import { getPresetStops } from '@/utils/gradientPresets';

const startRecolorSampling = jest.fn();
const addNotification = jest.fn();
const setBrushSettings = jest.fn();

const mockState = {
  startRecolorSampling,
  addNotification,
  setBrushSettings,
  layers: [{ id: 'layer-1', colorCycleData: {} }],
  activeLayerId: 'layer-1',
  tools: { brushSettings: { autoSampleGradient: false } },
};

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: any) => selector(mockState);
  return { useAppStore };
});

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

type DropdownProps = { onAction?: (action: string) => void; onChange?: (value: string) => void };
type ColorPickerProps = { onChange?: (value: string) => void; onCommit?: () => void };

jest.mock('@/components/ui/Dropdown', () => {
  const DropdownMock = ({ onAction, onChange, value }: DropdownProps & { value?: string }) => (
    <div>
      <div data-testid="dropdown-value">{value ?? ''}</div>
      <button data-testid="action-add" onClick={() => onAction?.('add')}>add</button>
      <button data-testid="action-sample" onClick={() => onAction?.('sample')}>sample</button>
      <button data-testid="action-toggle" onClick={() => onAction?.('toggle-sampled')}>toggle</button>
      <button data-testid="select-rainbow" onClick={() => onChange?.('rainbow')}>rainbow</button>
      <button data-testid="select-default" onClick={() => onChange?.('bw-stripes')}>default</button>
    </div>
  );
  DropdownMock.displayName = 'DropdownMock';
  return { __esModule: true, default: DropdownMock };
});

jest.mock('@/components/ui/ColorPicker', () => {
  const ColorPickerMock = ({ onChange, onCommit }: ColorPickerProps) => (
    <div>
      <button data-testid="color-change" onClick={() => onChange?.('#00FF00')}>change</button>
      <button data-testid="color-transparent" onClick={() => onChange?.('transparent')}>transparent</button>
      <button data-testid="color-commit" onClick={() => onCommit?.()}>commit</button>
    </div>
  );
  ColorPickerMock.displayName = 'ColorPickerMock';
  return { __esModule: true, default: ColorPickerMock };
});

const raf = (cb: FrameRequestCallback) => {
  cb(0);
  return 1;
};

describe('GradientEditor', () => {
  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(raf as any);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined as any);
    jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {});
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => null);
    (window.localStorage.setItem as jest.Mock).mockClear();
    (window.localStorage.getItem as jest.Mock).mockClear();
    startRecolorSampling.mockClear();
    addNotification.mockClear();
    setBrushSettings.mockClear();
  });

  it('adds a custom gradient and saves it', () => {
    const onChange = jest.fn();
    render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByTestId('action-add'));
    expect(window.localStorage.setItem).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled(); // scheduled update for new gradient
  });

  it('triggers sampling actions', () => {
    render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('action-sample'));
    expect(startRecolorSampling).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('action-toggle'));
    expect(setBrushSettings).toHaveBeenCalledWith({ autoSampleGradient: true });
  });

  it('opens color picker on stop double click and updates color', () => {
    const onChange = jest.fn();
    const { container } = render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={onChange}
      />
    );

    const stopHandle = container.querySelector('.gradient-editor div[style*=\"background-color\"]');
    expect(stopHandle).toBeTruthy();

    fireEvent.doubleClick(stopHandle!);
    fireEvent.click(screen.getByTestId('color-change'));
    fireEvent.click(screen.getByTestId('color-commit'));

    expect(onChange).toHaveBeenCalled();
    expect(window.localStorage.setItem).toHaveBeenCalled();
  });

  it('keeps stop frame visible when stop color is set to transparent', () => {
    const onChange = jest.fn();
    const { container } = render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={onChange}
      />
    );

    const stopHandle = container.querySelector('.gradient-editor div[style*="background-color"]') as HTMLDivElement | null;
    expect(stopHandle).toBeTruthy();

    fireEvent.doubleClick(stopHandle!);
    fireEvent.click(screen.getByTestId('color-transparent'));

    const transparentHandle = container.querySelector('.gradient-editor div[style*="background-color: transparent"]') as HTMLDivElement | null;
    expect(transparentHandle).toBeTruthy();
    expect(transparentHandle?.style.opacity).toBe('');
  });

  it('uses adaptive border contrast for swatch boxes', () => {
    const { container } = render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FFFFFF' },
          { position: 0.5, color: '#000000' },
          { position: 1, color: 'transparent' },
        ]}
        onChange={jest.fn()}
      />
    );

    const borders = Array.from(container.querySelectorAll('.gradient-editor div[style*="border-color"]')) as HTMLDivElement[];
    expect(borders.length).toBeGreaterThanOrEqual(3);
    expect(borders.some((node) => node.style.borderColor.includes('0, 0, 0'))).toBe(true);
    expect(borders.some((node) => node.style.borderColor.includes('255, 255, 255'))).toBe(true);
  });

  it('persists edits made to preset dropdown gradients as overrides', () => {
    const { container } = render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('select-rainbow'));

    const stopHandle = container.querySelector('.gradient-editor div[style*="background-color"]');
    expect(stopHandle).toBeTruthy();

    fireEvent.doubleClick(stopHandle!);
    fireEvent.click(screen.getByTestId('color-change'));
    fireEvent.click(screen.getByTestId('color-commit'));

    const lastSetItemCall = (window.localStorage.setItem as jest.Mock).mock.calls.at(-1);
    expect(lastSetItemCall).toBeTruthy();
    const payload = JSON.parse(lastSetItemCall![1] as string) as Array<{ id: string }>;
    expect(payload.some((entry) => entry.id === 'rainbow')).toBe(true);
  });

  it('shows matching preset id after restoring stops from props', () => {
    const rainbow = getPresetStops('rainbow');
    expect(rainbow).toBeTruthy();

    render(
      <GradientEditor
        stops={(rainbow ?? []).map((stop) => ({ ...stop }))}
        onChange={jest.fn()}
      />
    );

    expect(screen.getByTestId('dropdown-value').textContent).toBe('rainbow');
  });

  it('does not overwrite black and white preset when restoring another preset on load', () => {
    const rainbow = getPresetStops('rainbow');
    expect(rainbow).toBeTruthy();

    render(
      <GradientEditor
        stops={(rainbow ?? []).map((stop) => ({ ...stop }))}
        onChange={jest.fn()}
      />
    );

    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('dropdown-value').textContent).toBe('rainbow');
  });
});
