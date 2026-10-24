/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react';
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

  it('delegates stop color editing without opening its inline picker', () => {
    const onChange = jest.fn();
    const onSelectedStopChange = jest.fn();
    render(
      <GradientEditor
        stops={[
          { position: 0, color: '#FF0000' },
          { position: 1, color: '#00FF00' },
        ]}
        onChange={onChange}
        colorEditingMode="external"
        onSelectedStopChange={onSelectedStopChange}
      />
    );

    fireEvent.doubleClick(screen.getByRole('button', {
      name: 'Gradient stop 1 #FF0000',
    }));

    expect(onSelectedStopChange).toHaveBeenLastCalledWith(0);
    expect(screen.queryByTestId('color-change')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('makes a stop transparent without replacing its stored RGB with black', () => {
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

    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ color: '#FF0000', opacity: 0 }),
    ]));

    const transparentHandle = container.querySelector('.gradient-editor div[style*="background-color: rgba(255, 0, 0, 0)"]') as HTMLDivElement | null;
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

  describe('minimum two stops', () => {
    let pendingFrames: Map<number, FrameRequestCallback>;

    const flushGradientFrame = () => {
      act(() => {
        const callbacks = [...pendingFrames.values()];
        pendingFrames.clear();
        callbacks.forEach((callback) => callback(0));
      });
    };

    const twoStops = [
      { position: 0, color: '#FF0000', opacity: 1 },
      { position: 1, color: '#0000FF', opacity: 1 },
    ];
    const threeStops = [
      twoStops[0],
      { position: 0.5, color: '#00FF00', opacity: 1 },
      twoStops[1],
    ];
    const getBar = (container: HTMLElement) => {
      const bar = container.querySelector<HTMLElement>('.gradient-editor [tabindex="0"]');
      if (!bar) throw new Error('Gradient bar missing');
      return bar;
    };
    const stopLabels = () => screen.getAllByRole('button', { name: /^Gradient stop / })
      .map((button) => button.getAttribute('aria-label'));

    beforeEach(() => {
      pendingFrames = new Map();
      let frameId = 0;
      jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frameId += 1;
        pendingFrames.set(frameId, callback);
        return frameId;
      });
      jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        pendingFrames.delete(id);
      });
    });

    it.each([
      ['Delete', 'inline'],
      ['Backspace', 'inline'],
      ['Delete', 'external'],
      ['Backspace', 'external'],
    ] as const)('rejects %s at two stops in %s mode without leaking a canvas key', (key, mode) => {
      const onChange = jest.fn();
      const onSelectedStopChange = jest.fn();
      const globalKey = jest.fn();
      const { container } = render(
        <GradientEditor
          stops={twoStops}
          onChange={onChange}
          colorEditingMode={mode}
          onSelectedStopChange={onSelectedStopChange}
        />,
      );
      const selected = screen.getByRole('button', { name: 'Gradient stop 1 #FF0000' });
      fireEvent.click(selected);
      onSelectedStopChange.mockClear();
      document.addEventListener('keydown', globalKey);
      try {
        fireEvent.keyDown(getBar(container), { key });
        flushGradientFrame();
        expect(stopLabels()).toEqual(['Gradient stop 1 #FF0000', 'Gradient stop 2 #0000FF']);
        expect(selected).toHaveAttribute('aria-pressed', 'true');
        expect(onChange).not.toHaveBeenCalled();
        expect(onSelectedStopChange).not.toHaveBeenCalled();
        expect(globalKey).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', globalKey);
      }
    });

    it.each(['Delete', 'Backspace'])('preserves valid three-to-two %s and local undo/redo', (key) => {
      const onChange = jest.fn();
      const { container } = render(<GradientEditor stops={threeStops} onChange={onChange} />);
      const bar = getBar(container);
      fireEvent.click(screen.getByRole('button', { name: 'Gradient stop 2 #00FF00' }));
      fireEvent.keyDown(bar, { key });
      flushGradientFrame();
      expect(onChange).toHaveBeenLastCalledWith(twoStops);
      expect(stopLabels()).toEqual(['Gradient stop 1 #FF0000', 'Gradient stop 2 #0000FF']);
      fireEvent.keyDown(bar, { key: 'z', ctrlKey: true });
      flushGradientFrame();
      expect(onChange).toHaveBeenLastCalledWith(threeStops);
      expect(stopLabels()).toEqual([
        'Gradient stop 1 #FF0000', 'Gradient stop 2 #00FF00', 'Gradient stop 3 #0000FF',
      ]);
      fireEvent.keyDown(bar, { key: 'z', ctrlKey: true, shiftKey: true });
      flushGradientFrame();
      expect(onChange).toHaveBeenLastCalledWith(twoStops);
      expect(stopLabels()).toEqual(['Gradient stop 1 #FF0000', 'Gradient stop 2 #0000FF']);
    });

    it.each(['Delete', 'Backspace'])('does not consume an existing redo when %s is rejected', (key) => {
      const onChange = jest.fn();
      const { container } = render(<GradientEditor stops={twoStops} onChange={onChange} />);
      const bar = getBar(container);
      jest.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 16, width: 200, height: 16,
        toJSON: () => ({}),
      });
      fireEvent.click(bar, { clientX: 50, clientY: 8 });
      flushGradientFrame();
      const added = [twoStops[0], { position: 0.25, color: '#bf0040', opacity: 1 }, twoStops[1]];
      expect(onChange).toHaveBeenLastCalledWith(added);
      fireEvent.keyDown(bar, { key: 'z', ctrlKey: true });
      flushGradientFrame();
      expect(onChange).toHaveBeenLastCalledWith(twoStops);
      // Select through the click handler without starting an unrelated drag edit.
      fireEvent.click(screen.getByRole('button', { name: 'Gradient stop 1 #FF0000' }));
      onChange.mockClear();
      fireEvent.keyDown(bar, { key });
      flushGradientFrame();
      expect(onChange).not.toHaveBeenCalled();
      expect(stopLabels()).toEqual(['Gradient stop 1 #FF0000', 'Gradient stop 2 #0000FF']);
      fireEvent.keyDown(bar, { key: 'z', ctrlKey: true, shiftKey: true });
      flushGradientFrame();
      expect(onChange).toHaveBeenLastCalledWith(added);
      expect(stopLabels()).toEqual([
        'Gradient stop 1 #FF0000', 'Gradient stop 2 #bf0040', 'Gradient stop 3 #0000FF',
      ]);
    });
  });
});
