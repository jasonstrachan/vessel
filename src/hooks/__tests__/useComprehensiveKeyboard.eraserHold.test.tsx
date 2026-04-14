import { act, render, fireEvent } from '@testing-library/react';
import React from 'react';

import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
type KeyboardProps = Parameters<typeof useComprehensiveKeyboard>[0];

const KeyboardHarness: React.FC<Partial<KeyboardProps>> = (props) => {
  useComprehensiveKeyboard({ enabled: true, ...(props ?? {}) });
  return null;
};

const resetStore = (): void => {
  useAppStore.setState(state => ({
    currentBrushPreset: null,
    tools: {
      ...state.tools,
      currentTool: 'brush',
      previousTool: 'brush',
      shapeMode: false,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.SQUARE
      }
    }
  }));
};

describe('useComprehensiveKeyboard – temporary eraser hold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => {
      resetStore();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    act(() => {
      resetStore();
    });
  });

  it('restores the previous brush + shape mode after holding E', async () => {
    const finalizeSpy = jest.fn().mockImplementation(async () => {
      await Promise.resolve();
    });

    const keyboard = render(React.createElement(KeyboardHarness, { onEraserPressed: finalizeSpy }));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('brush');
      store.setShapeMode(true);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'e', code: 'KeyE' });
      await Promise.resolve();
    });

    expect(finalizeSpy).toHaveBeenCalled();
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    expect(useAppStore.getState().tools.shapeMode).toBe(false);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await act(async () => {
      fireEvent.keyUp(window, { key: 'e', code: 'KeyE' });
      await Promise.resolve();
    });

    const finalState = useAppStore.getState();
    expect(finalState.tools.currentTool).toBe('brush');
    expect(finalState.tools.shapeMode).toBe(true);

    keyboard.unmount();
  });
});

describe('useComprehensiveKeyboard – brush size shortcuts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => {
      resetStore();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('handles bracket shortcuts when a numeric input has focus', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));
    const initialSize = 12;

    act(() => {
      useAppStore.getState().setGlobalBrushSize(initialSize);
    });

    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    document.body.appendChild(numericInput);
    numericInput.focus();

    await act(async () => {
      fireEvent.keyDown(numericInput, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(initialSize - 1);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(numericInput, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(initialSize);

    numericInput.blur();
    document.body.removeChild(numericInput);
    keyboard.unmount();
  });

  it('routes bracket shortcuts to cc gradient colors instead of size for color-cycle-gradient', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      useAppStore.setState(state => ({
        currentBrushPreset: {
          ...(state.currentBrushPreset ?? {}),
          id: 'color-cycle-gradient',
          name: 'CC Gradient',
        } as NonNullable<typeof state.currentBrushPreset>,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          brushSettings: {
            ...state.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
            size: 12,
            gradientBands: 8,
          },
        },
      }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings.gradientBands).toBe(7);
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings.gradientBands).toBe(8);
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);

    keyboard.unmount();
  });

  it('allows Enter to trigger floating paste commit while a numeric input is focused', async () => {
    const onEnterPressed = jest.fn();
    const keyboard = render(React.createElement(KeyboardHarness, { onEnterPressed }));

    act(() => {
      useAppStore.getState().setFloatingPaste({
        imageData: new ImageData(2, 2),
        position: { x: 1, y: 1 },
        originalPosition: { x: 1, y: 1 },
        width: 2,
        height: 2,
        displayWidth: 2,
        displayHeight: 2,
        rotation: 0,
        sourceLayerId: null,
        colorCycleIndices: null,
      });
    });

    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    document.body.appendChild(numericInput);
    numericInput.focus();

    await act(async () => {
      fireEvent.keyDown(numericInput, { key: 'Enter', code: 'Enter' });
    });

    expect(onEnterPressed).toHaveBeenCalledTimes(1);

    numericInput.blur();
    document.body.removeChild(numericInput);
    act(() => {
      useAppStore.getState().setFloatingPaste(null);
    });
    keyboard.unmount();
  });

  it('treats Backspace as delete for active selections', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));
    const deleteSpy = jest.fn();
    const originalDelete = useAppStore.getState().deleteSelectedPixels;

    act(() => {
      useAppStore.setState({
        selectionStart: { x: 1, y: 1 },
        selectionEnd: { x: 4, y: 4 },
        deleteSelectedPixels: deleteSpy,
      });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' });
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.setState({ deleteSelectedPixels: originalDelete });
      useAppStore.getState().clearSelection();
    });
    keyboard.unmount();
  });

  it('switches to color-adjust tool on U', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      useAppStore.getState().setCurrentTool('brush');
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'u', code: 'KeyU' });
    });

    expect(useAppStore.getState().tools.currentTool).toBe('color-adjust');
    keyboard.unmount();
  });

  it('changes eraser size with bracket shortcuts when eraser is active', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('eraser');
      store.setEraserSettings({ size: 10, linkSizeToBrush: false });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(9);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(10);

    keyboard.unmount();
  });

  it('changes eraser size with bracket shortcuts while a text input is focused', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('eraser');
      store.setEraserSettings({ size: 10, linkSizeToBrush: false });
    });

    const textInput = document.createElement('input');
    textInput.type = 'text';
    document.body.appendChild(textInput);
    textInput.focus();

    await act(async () => {
      fireEvent.keyDown(textInput, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(9);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(textInput, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(10);

    textInput.blur();
    document.body.removeChild(textInput);
    keyboard.unmount();
  });

  it('changes eraser size from bracket key codes even when key char differs', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('eraser');
      store.setEraserSettings({ size: 10, linkSizeToBrush: false });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Unidentified', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(9);

    await act(async () => {
      fireEvent.keyUp(window, { key: 'Unidentified', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Unidentified', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(10);

    keyboard.unmount();
  });

  it('changes eraser size from legacy bracket keyCode values', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('eraser');
      store.setEraserSettings({ size: 10, linkSizeToBrush: false });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Unidentified', code: '', keyCode: 219, which: 219 });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(9);

    await act(async () => {
      fireEvent.keyUp(window, { key: 'Unidentified', code: 'BracketLeft', keyCode: 219, which: 219 });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Unidentified', code: '', keyCode: 221, which: 221 });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(10);

    keyboard.unmount();
  });

  it('changes linked eraser size by adjusting global brush size', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setCurrentTool('eraser');
      store.setGlobalBrushSize(12);
      store.setEraserSettings({ linkSizeToBrush: true });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.brushSettings.size).toBe(11);
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(11);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().tools.brushSettings.size).toBe(12);
    expect(useAppStore.getState().tools.eraserSettings.size).toBe(12);

    keyboard.unmount();
  });

  it('coalesces repeated bracket keydown events into paced size changes', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      useAppStore.getState().setGlobalBrushSize(12);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', repeat: true });
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', repeat: true });
      jest.advanceTimersByTime(40);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(11);

    await act(async () => {
      jest.advanceTimersByTime(180);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(11);

    await act(async () => {
      jest.advanceTimersByTime(60);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(10);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(80);
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(10);
    keyboard.unmount();
  });
});

describe('useComprehensiveKeyboard – space safety release', () => {
  beforeEach(() => {
    act(() => {
      resetStore();
    });
  });

  it('releases space interaction when pointer leaves the window', async () => {
    const onSpacePressed = jest.fn();
    const onSpaceReleased = jest.fn();
    const keyboard = render(
      React.createElement(KeyboardHarness, { onSpacePressed, onSpaceReleased })
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    });
    expect(onSpacePressed).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.pointerLeave(window);
    });

    expect(onSpaceReleased).toHaveBeenCalledTimes(1);
    keyboard.unmount();
  });

  it('releases space interaction when document becomes hidden', async () => {
    const onSpacePressed = jest.fn();
    const onSpaceReleased = jest.fn();
    const keyboard = render(
      React.createElement(KeyboardHarness, { onSpacePressed, onSpaceReleased })
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    });
    expect(onSpacePressed).toHaveBeenCalledTimes(1);

    const hiddenSpy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    hiddenSpy.mockRestore();

    expect(onSpaceReleased).toHaveBeenCalledTimes(1);
    keyboard.unmount();
  });
});
