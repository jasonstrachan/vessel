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
});
