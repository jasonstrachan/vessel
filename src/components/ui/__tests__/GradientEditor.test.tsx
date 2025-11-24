/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { GradientEditor } from '../GradientEditor';

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

type DropdownProps = { onAction?: (action: string) => void };
type ColorPickerProps = { onChange?: (value: string) => void; onCommit?: () => void };

jest.mock('@/components/ui/Dropdown', () => {
  const DropdownMock = ({ onAction }: DropdownProps) => (
    <div>
      <button data-testid="action-add" onClick={() => onAction?.('add')}>add</button>
      <button data-testid="action-sample" onClick={() => onAction?.('sample')}>sample</button>
      <button data-testid="action-toggle" onClick={() => onAction?.('toggle-sampled')}>toggle</button>
    </div>
  );
  DropdownMock.displayName = 'DropdownMock';
  return { __esModule: true, default: DropdownMock };
});

jest.mock('@/components/ui/ColorPicker', () => {
  const ColorPickerMock = ({ onChange, onCommit }: ColorPickerProps) => (
    <div>
      <button data-testid="color-change" onClick={() => onChange?.('#00FF00')}>change</button>
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
  });
});
