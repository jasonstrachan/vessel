import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import SelectionMarqueeHandles from '@/components/canvas/SelectionMarqueeHandles';
import { useAppStore } from '@/stores/useAppStore';

const ensurePointerEventPolyfill = (): void => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventShim extends MouseEvent {
      constructor(type: string, props?: PointerEventInit) {
        super(type, props);
      }
    }
    // @ts-expect-error - assign shim for test environment
    window.PointerEvent = PointerEventShim;
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
};

describe('SelectionMarqueeHandles', () => {
  beforeAll(() => {
    ensurePointerEventPolyfill();
  });

  beforeEach(() => {
    act(() => {
      const store = useAppStore.getState();
      store.clearSelection();
      store.setFloatingPaste(null);
      store.setCurrentTool('selection');
      store.setSelectionBounds({ x: 10, y: 10 }, { x: 30, y: 30 });
    });
  });

  afterEach(() => {
    act(() => {
      const store = useAppStore.getState();
      store.clearSelection();
      store.setFloatingPaste(null);
    });
  });

  it('renders selection handles for mask-driven selections', () => {
    act(() => {
      const mask = new ImageData(4, 4);
      mask.data[3] = 255;
      useAppStore.setState({
        selectionStart: { x: 12, y: 8 },
        selectionEnd: { x: 18, y: 14 },
        selectionMask: mask,
        selectionMaskBounds: { x: 12, y: 8, width: 6, height: 6 },
      });
    });

    render(
      <SelectionMarqueeHandles
        zoom={1}
        offsetX={0}
        offsetY={0}
        projectWidth={100}
        projectHeight={100}
      />,
    );

    const overlay = screen.getByTestId('selection-marquee-overlay');
    expect(overlay.querySelector('[data-handle="right"]')).toBeTruthy();
    expect(overlay.querySelector('[data-handle="rotate"]')).toBeTruthy();
  });

  it('updates the selection bounds when dragging a resize handle', () => {
    render(
      <SelectionMarqueeHandles
        zoom={1}
        offsetX={0}
        offsetY={0}
        projectWidth={100}
        projectHeight={100}
      />,
    );

    const overlay = screen.getByTestId('selection-marquee-overlay');

    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }),
    });

    const rightHandle = overlay.querySelector('[data-handle="right"]');
    expect(rightHandle).toBeTruthy();
    if (!rightHandle) {
      throw new Error('Right handle not found');
    }

    act(() => {
      fireEvent.pointerDown(rightHandle, {
        pointerId: 1,
        clientX: 30,
        clientY: 20,
        button: 0,
      });
    });

    act(() => {
      fireEvent.pointerMove(overlay, {
        pointerId: 1,
        clientX: 40,
        clientY: 20,
      });
    });

    act(() => {
      fireEvent.pointerUp(overlay, {
        pointerId: 1,
        clientX: 40,
        clientY: 20,
      });
    });

    const state = useAppStore.getState();
    expect(state.selectionEnd?.x).toBe(40);
    expect(state.selectionEnd?.y).toBe(30);
  });

  it('allows resizing the selection beyond project bounds', () => {
    render(
      <SelectionMarqueeHandles
        zoom={1}
        offsetX={0}
        offsetY={0}
        projectWidth={100}
        projectHeight={100}
      />,
    );

    const overlay = screen.getByTestId('selection-marquee-overlay');

    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }),
    });

    const topLeftHandle = overlay.querySelector('[data-handle="top-left"]');
    expect(topLeftHandle).toBeTruthy();
    if (!topLeftHandle) {
      throw new Error('Top-left handle not found');
    }

    act(() => {
      fireEvent.pointerDown(topLeftHandle, {
        pointerId: 2,
        clientX: 10,
        clientY: 10,
        button: 0,
      });
    });

    act(() => {
      fireEvent.pointerMove(overlay, {
        pointerId: 2,
        clientX: -20,
        clientY: -15,
      });
    });

    act(() => {
      fireEvent.pointerUp(overlay, {
        pointerId: 2,
        clientX: -20,
        clientY: -15,
      });
    });

    const state = useAppStore.getState();
    expect(state.selectionStart?.x).toBe(-20);
    expect(state.selectionStart?.y).toBe(-15);
    expect(state.selectionEnd?.x).toBe(30);
    expect(state.selectionEnd?.y).toBe(30);
  });

  it('allows handle resize even when current tool is not selection', () => {
    act(() => {
      useAppStore.setState((state) => ({
        tools: {
          ...state.tools,
          currentTool: 'brush',
        },
      }));
    });

    render(
      <SelectionMarqueeHandles
        zoom={1}
        offsetX={0}
        offsetY={0}
        projectWidth={100}
        projectHeight={100}
      />,
    );

    const overlay = screen.getByTestId('selection-marquee-overlay');

    Object.defineProperty(overlay, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }),
    });

    const rightHandle = overlay.querySelector('[data-handle="right"]');
    expect(rightHandle).toBeTruthy();
    if (!rightHandle) {
      throw new Error('Right handle not found');
    }

    act(() => {
      fireEvent.pointerDown(rightHandle, {
        pointerId: 3,
        clientX: 30,
        clientY: 20,
        button: 0,
      });
    });

    act(() => {
      fireEvent.pointerMove(overlay, {
        pointerId: 3,
        clientX: 45,
        clientY: 20,
      });
    });

    act(() => {
      fireEvent.pointerUp(overlay, {
        pointerId: 3,
        clientX: 45,
        clientY: 20,
      });
    });

    const state = useAppStore.getState();
    expect(state.selectionEnd?.x).toBe(45);
  });

  it('forwards rotate handle interaction into floating paste rotate control', () => {
    const originalExtract = useAppStore.getState().extractSelectionToFloatingPaste;
    const extractSelectionToFloatingPaste = jest.fn(() => true);
    const forwardedRotatePointerDown = jest.fn();
    const requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    act(() => {
      useAppStore.setState({ extractSelectionToFloatingPaste });
    });
    try {
      render(
        <div>
          <SelectionMarqueeHandles
            zoom={1}
            offsetX={0}
            offsetY={0}
            projectWidth={100}
            projectHeight={100}
          />
          <div
            data-floating-rotate-handle
            onPointerDown={forwardedRotatePointerDown}
          />
        </div>,
      );

      const overlay = screen.getByTestId('selection-marquee-overlay');
      Object.defineProperty(overlay, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
          toJSON: () => ({}),
        }),
      });

      const rotateHandle = overlay.querySelector('[data-handle="rotate"]');
      expect(rotateHandle).toBeTruthy();
      if (!rotateHandle) {
        throw new Error('Rotate handle not found');
      }

      act(() => {
        fireEvent.pointerDown(rotateHandle, {
          pointerId: 41,
          clientX: 20,
          clientY: 10,
          button: 0,
        });
      });

      expect(extractSelectionToFloatingPaste).toHaveBeenCalledTimes(1);
      expect(forwardedRotatePointerDown).toHaveBeenCalledTimes(1);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      act(() => {
        useAppStore.setState({ extractSelectionToFloatingPaste: originalExtract });
      });
    }
  });
});
