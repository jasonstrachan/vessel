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
    act(() => {
      resetStore();
    });
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
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(initialSize - 1);

    await act(async () => {
      fireEvent.keyDown(numericInput, { key: ']', code: 'BracketRight' });
    });

    expect(useAppStore.getState().tools.brushSettings.size).toBe(initialSize);

    numericInput.blur();
    document.body.removeChild(numericInput);
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
