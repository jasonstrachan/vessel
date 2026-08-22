import { act, render, fireEvent } from '@testing-library/react';
import React from 'react';

import {
  __keyboardTestUtils,
  useComprehensiveKeyboard,
} from '@/hooks/useComprehensiveKeyboard';
import studioExtension from '@/extensions/studioExtension';
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

describe('useComprehensiveKeyboard – Studio clipboard shortcuts', () => {
  afterEach(() => {
    studioExtension.handleClipboardAction = undefined;
    jest.restoreAllMocks();
  });

  it('lets the active Studio extension claim copy and cut', async () => {
    const handler = jest.fn(() => true);
    studioExtension.handleClipboardAction = handler;
    const keyboard = render(React.createElement(KeyboardHarness));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });
      fireEvent.keyDown(window, { key: 'x', code: 'KeyX', metaKey: true });
      await Promise.resolve();
    });

    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'copy' }));
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'cut' }));
    keyboard.unmount();
  });

  it('lets the active Studio extension claim paste in place and duplicate', async () => {
    const handler = jest.fn(() => true);
    studioExtension.handleClipboardAction = handler;
    const keyboard = render(React.createElement(KeyboardHarness));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'v', code: 'KeyV', metaKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: 'd', code: 'KeyD', metaKey: true });
      await Promise.resolve();
    });

    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'paste-in-place' }));
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'duplicate' }));
    keyboard.unmount();
  });

  it('routes the non-native paste modifier to Studio clipboard handling', async () => {
    const handler = jest.fn(() => true);
    studioExtension.handleClipboardAction = handler;
    const keyboard = render(React.createElement(KeyboardHarness));

    const macControlPaste = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
    });
    const macCommandPaste = new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      metaKey: true,
    });
    jest.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');

    expect(__keyboardTestUtils.shouldHandleExtensionPasteKeyDown(macControlPaste)).toBe(true);
    expect(__keyboardTestUtils.shouldHandleExtensionPasteKeyDown(macCommandPaste)).toBe(false);

    await act(async () => {
      fireEvent(window, macControlPaste);
      fireEvent(window, macCommandPaste);
      await Promise.resolve();
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ action: 'paste' }));
    keyboard.unmount();
  });

  it('leaves native text copy and cut alone', async () => {
    const handler = jest.fn(() => true);
    studioExtension.handleClipboardAction = handler;
    const keyboard = render(React.createElement(KeyboardHarness));
    const input = document.createElement('input');
    document.body.appendChild(input);

    await act(async () => {
      fireEvent.keyDown(input, { key: 'c', code: 'KeyC', metaKey: true });
      fireEvent.keyDown(input, { key: 'x', code: 'KeyX', metaKey: true });
      await Promise.resolve();
    });

    expect(handler).not.toHaveBeenCalled();
    input.remove();
    keyboard.unmount();
  });

  it('leaves text paste, paste in place, and duplicate shortcuts alone', async () => {
    const handler = jest.fn(() => true);
    studioExtension.handleClipboardAction = handler;
    const keyboard = render(React.createElement(KeyboardHarness));
    const input = document.createElement('input');
    document.body.appendChild(input);

    await act(async () => {
      fireEvent.keyDown(input, { key: 'v', code: 'KeyV', ctrlKey: true });
      fireEvent.keyDown(input, { key: 'v', code: 'KeyV', metaKey: true, shiftKey: true });
      fireEvent.keyDown(input, { key: 'd', code: 'KeyD', metaKey: true });
      await Promise.resolve();
    });

    expect(handler).not.toHaveBeenCalled();
    input.remove();
    keyboard.unmount();
  });
});

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

  it('routes bracket shortcuts to cc shape resolution instead of colors or size', async () => {
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
            fillResolution: 6,
          },
        },
      }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings).toMatchObject({
      fillResolution: 5,
      gradientBands: 8,
      size: 12,
    });

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings).toMatchObject({
      fillResolution: 6,
      gradientBands: 8,
      size: 12,
    });

    keyboard.unmount();
  });

  it('routes brackets to resolution for the original color-cycle-shape preset', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      useAppStore.setState(state => ({
        currentBrushPreset: {
          ...(state.currentBrushPreset ?? {}),
          id: 'color-cycle-shape',
          name: 'Color Cycle Shape',
        } as NonNullable<typeof state.currentBrushPreset>,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          brushSettings: {
            ...state.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
            size: 12,
            gradientBands: 8,
            fillResolution: 6,
          },
        },
      }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings).toMatchObject({
      fillResolution: 7,
      gradientBands: 8,
      size: 12,
    });

    await act(async () => {
      fireEvent.keyUp(window, { key: ']', code: 'BracketRight' });
    });

    keyboard.unmount();
  });

  it.each([
    {
      presetId: 'saved-dither-variant',
      presetName: 'Dither Shape',
      brushShape: BrushShape.PIXEL_DITHER,
      shapeEnabled: true,
      pressureLinked: true,
      fillResolution: 28,
      maxResolution: 28,
      expectedFillResolution: 28,
      expectedMaxResolution: 29,
    },
    {
      presetId: 'dither-grad',
      presetName: 'Dither Grad',
      brushShape: BrushShape.DITHER_GRADIENT,
      shapeEnabled: false,
      pressureLinked: false,
      fillResolution: 6,
      maxResolution: undefined,
      expectedFillResolution: 7,
      expectedMaxResolution: undefined,
    },
  ])(
    'routes brackets to the effective resolution for $presetName',
    async ({
      presetId,
      presetName,
      brushShape,
      shapeEnabled,
      pressureLinked,
      fillResolution,
      maxResolution,
      expectedFillResolution,
      expectedMaxResolution,
    }) => {
      const keyboard = render(React.createElement(KeyboardHarness));

      act(() => {
        useAppStore.setState(state => ({
          currentBrushPreset: {
            ...(state.currentBrushPreset ?? {}),
            id: presetId,
            name: presetName,
          } as NonNullable<typeof state.currentBrushPreset>,
          tools: {
            ...state.tools,
            currentTool: 'brush',
            shapeMode: shapeEnabled,
            brushSettings: {
              ...state.tools.brushSettings,
              brushShape,
              shapeEnabled,
              size: 12,
              fillResolution,
              pressureLinkedFillResolution: pressureLinked,
              pressureLinkedFillMaxResolution: maxResolution,
            },
          },
        }));
      });

      await act(async () => {
        fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
        jest.advanceTimersByTime(20);
      });

      expect(useAppStore.getState().tools.brushSettings).toMatchObject({
        fillResolution: expectedFillResolution,
        size: 12,
      });
      expect(
        useAppStore.getState().tools.brushSettings.pressureLinkedFillMaxResolution
      ).toBe(expectedMaxResolution);

      await act(async () => {
        fireEvent.keyUp(window, { key: ']', code: 'BracketRight' });
      });

      keyboard.unmount();
    }
  );

  it('keeps bracket shortcuts on brush size for Dither Stroke', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      useAppStore.setState(state => ({
        currentBrushPreset: {
          ...(state.currentBrushPreset ?? {}),
          id: 'dither-stroke',
          name: 'Dither Stroke',
        } as NonNullable<typeof state.currentBrushPreset>,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          shapeMode: false,
          brushSettings: {
            ...state.tools.brushSettings,
            brushShape: BrushShape.PIXEL_DITHER,
            shapeEnabled: false,
            size: 12,
            fillResolution: 28,
            pressureLinkedFillResolution: true,
            pressureLinkedFillMaxResolution: 28,
          },
        },
      }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    expect(useAppStore.getState().tools.brushSettings).toMatchObject({
      size: 13,
      fillResolution: 28,
      pressureLinkedFillMaxResolution: 28,
    });

    await act(async () => {
      fireEvent.keyUp(window, { key: ']', code: 'BracketRight' });
    });

    keyboard.unmount();
  });

  it('does not change cc shape resolution while a shape preview is active', async () => {
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
            fillResolution: 6,
          },
        },
      }));
      useAppStore.getState().setShapeDrawing(true);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft' });
      fireEvent.keyDown(window, { key: '[', code: 'BracketLeft', repeat: true });
      jest.advanceTimersByTime(400);
    });

    expect(useAppStore.getState().tools.brushSettings.fillResolution).toBe(6);

    await act(async () => {
      fireEvent.keyUp(window, { key: '[', code: 'BracketLeft' });
      jest.advanceTimersByTime(80);
    });

    expect(useAppStore.getState().tools.brushSettings.fillResolution).toBe(6);
    act(() => {
      useAppStore.getState().setShapeDrawing(false);
    });
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

  it('routes Delete through the undoable floating-selection delete action', async () => {
    const deleteFloatingPaste = jest.fn().mockResolvedValue(undefined);
    const originalDeleteFloatingPaste = useAppStore.getState().deleteFloatingPaste;

    act(() => {
      useAppStore.setState({ deleteFloatingPaste });
      useAppStore.getState().setFloatingPaste({
        imageData: new ImageData(2, 2),
        position: { x: 1, y: 1 },
        originalPosition: { x: 1, y: 1 },
        width: 2,
        height: 2,
        displayWidth: 2,
        displayHeight: 2,
        rotation: 0,
        sourceLayerId: 'layer-1',
      });
    });
    const keyboard = render(React.createElement(KeyboardHarness));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
      await Promise.resolve();
    });

    expect(deleteFloatingPaste).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.setState({ deleteFloatingPaste: originalDeleteFloatingPaste });
      useAppStore.getState().setFloatingPaste(null);
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

  it('uses bracket shortcuts for brush size in CC gradient stroke mode', async () => {
    const keyboard = render(React.createElement(KeyboardHarness));

    act(() => {
      const store = useAppStore.getState();
      store.setGlobalBrushSize(12);
      store.setBrushSettings({
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        colorCycleFillMode: 'stroke',
        gradientBands: 7,
      });
      useAppStore.setState({
        currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as ReturnType<typeof useAppStore.getState>['currentBrushPreset'],
      });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ']', code: 'BracketRight' });
      jest.advanceTimersByTime(20);
    });

    const state = useAppStore.getState();
    expect(state.tools.brushSettings.size).toBe(13);
    expect(state.tools.brushSettings.gradientBands).toBe(7);

    await act(async () => {
      fireEvent.keyUp(window, { key: ']', code: 'BracketRight' });
    });

    keyboard.unmount();
  });
});

describe('useComprehensiveKeyboard – space safety release', () => {
  beforeEach(() => {
    act(() => {
      resetStore();
    });
  });

  it('starts space interaction when a numeric input has focus', async () => {
    const onSpacePressed = jest.fn();
    const onSpaceReleased = jest.fn();
    const keyboard = render(
      React.createElement(KeyboardHarness, { onSpacePressed, onSpaceReleased })
    );
    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    document.body.appendChild(numericInput);
    numericInput.focus();

    await act(async () => {
      fireEvent.keyDown(numericInput, { key: ' ', code: 'Space' });
    });

    expect(onSpacePressed).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyUp(numericInput, { key: ' ', code: 'Space' });
    });

    expect(onSpaceReleased).toHaveBeenCalledTimes(1);
    numericInput.blur();
    document.body.removeChild(numericInput);
    keyboard.unmount();
  });

  it('releases space interaction when keyup is routed through a text input', async () => {
    const onSpacePressed = jest.fn();
    const onSpaceReleased = jest.fn();
    const keyboard = render(
      React.createElement(KeyboardHarness, { onSpacePressed, onSpaceReleased })
    );
    const textInput = document.createElement('input');
    textInput.type = 'text';
    document.body.appendChild(textInput);

    await act(async () => {
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    });
    expect(onSpacePressed).toHaveBeenCalledTimes(1);

    textInput.focus();
    await act(async () => {
      fireEvent.keyUp(textInput, { key: ' ', code: 'Space' });
    });

    expect(onSpaceReleased).toHaveBeenCalledTimes(1);
    textInput.blur();
    document.body.removeChild(textInput);
    keyboard.unmount();
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
