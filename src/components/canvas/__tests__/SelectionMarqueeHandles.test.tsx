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
});
