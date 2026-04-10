/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { GradientEditor, type GradientEditorHandle } from '../GradientEditor';

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

type ColorPickerProps = { onChange?: (value: string) => void; onCommit?: () => void };

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

  it('does not own saved gradient persistence or sampling actions', () => {
    render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={jest.fn()}
      />
    );

    expect(screen.queryByTestId('action-add')).not.toBeInTheDocument();
    expect(startRecolorSampling).not.toHaveBeenCalled();
    expect(setBrushSettings).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
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
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
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

  it('exposes an imperative draft flush for parent-owned commit boundaries', () => {
    const ref = React.createRef<GradientEditorHandle>();
    const onChange = jest.fn();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(((cb: FrameRequestCallback) => {
      window.setTimeout(() => cb(0), 0);
      return 22;
    }) as any);

    const { container } = render(
      <GradientEditor
        ref={ref}
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={onChange}
      />
    );

    const stopHandle = container.querySelector('.gradient-editor div[style*="background-color"]');
    expect(stopHandle).toBeTruthy();

    fireEvent.doubleClick(stopHandle!);
    fireEvent.click(screen.getByTestId('color-change'));
    expect(onChange).not.toHaveBeenCalled();

    ref.current?.flushDraft();
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ color: '#00FF00' }),
    ]));
  });
});
