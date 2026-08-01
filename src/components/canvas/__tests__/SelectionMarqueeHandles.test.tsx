import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import SelectionMarqueeHandles from '@/components/canvas/SelectionMarqueeHandles';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

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

  it('does not offer rotation for a color-cycle selection', () => {
    const previousLayers = useAppStore.getState().layers;
    const previousActiveLayerId = useAppStore.getState().activeLayerId;
    const colorCycleLayer = {
      id: 'cc-layer',
      name: 'CC Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: null,
      alignment: {
        positioning: 'anchor',
        horizontal: 'left',
        vertical: 'top',
        offsetPx: { x: 0, y: 0 },
      },
      layerType: 'color-cycle',
      colorCycleData: {},
    } as unknown as Layer;

    act(() => {
      useAppStore.setState({
        layers: [colorCycleLayer],
        activeLayerId: colorCycleLayer.id,
      });
    });
    try {
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
      expect(overlay.querySelector('[data-handle="rotate"]')).toBeNull();
    } finally {
      act(() => {
        useAppStore.setState({
          layers: previousLayers,
          activeLayerId: previousActiveLayerId,
        });
      });
    }
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

  it('continues a resize on the original pointer gesture after extracting a floating paste', () => {
    const originalExtract = useAppStore.getState().extractSelectionToFloatingPaste;
    const extractSelectionToFloatingPaste = jest.fn(() => {
      useAppStore.setState({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: {
          active: true,
          imageData: new ImageData(20, 20),
          position: { x: 10, y: 10 },
          originalPosition: { x: 10, y: 10 },
          width: 20,
          height: 20,
          displayWidth: 20,
          displayHeight: 20,
          rotation: 0,
          sourceLayerId: 'layer-1',
        },
      });
      return true;
    });

    act(() => {
      useAppStore.setState({ extractSelectionToFloatingPaste });
    });
    try {
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
          pointerId: 41,
          clientX: 30,
          clientY: 20,
          button: 0,
        });
      });
      act(() => {
        fireEvent.pointerMove(overlay, {
          pointerId: 41,
          clientX: 40,
          clientY: 20,
          buttons: 1,
        });
      });

      expect(extractSelectionToFloatingPaste).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().floatingPaste).toMatchObject({
        position: { x: 10, y: 10 },
        displayWidth: 30,
        displayHeight: 20,
      });

      act(() => {
        fireEvent.pointerUp(overlay, {
          pointerId: 41,
          clientX: 40,
          clientY: 20,
        });
      });
      expect(screen.queryByTestId('selection-marquee-overlay')).toBeNull();
    } finally {
      act(() => {
        useAppStore.setState({ extractSelectionToFloatingPaste: originalExtract });
      });
    }
  });

  it('continues rotation on the original pointer gesture after extraction', () => {
    const originalExtract = useAppStore.getState().extractSelectionToFloatingPaste;
    const extractSelectionToFloatingPaste = jest.fn(() => {
      useAppStore.setState({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: {
          active: true,
          imageData: new ImageData(20, 20),
          position: { x: 10, y: 10 },
          originalPosition: { x: 10, y: 10 },
          width: 20,
          height: 20,
          displayWidth: 20,
          displayHeight: 20,
          rotation: 0,
          sourceLayerId: 'layer-1',
        },
      });
      return true;
    });

    act(() => {
      useAppStore.setState({ extractSelectionToFloatingPaste });
    });
    try {
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
      const rotateHandle = overlay.querySelector('[data-handle="rotate"]');
      expect(rotateHandle).toBeTruthy();
      if (!rotateHandle) {
        throw new Error('Rotate handle not found');
      }

      act(() => {
        fireEvent.pointerDown(rotateHandle, {
          pointerId: 42,
          clientX: 20,
          clientY: -10,
          button: 0,
        });
      });
      act(() => {
        fireEvent.pointerMove(overlay, {
          pointerId: 42,
          clientX: 50,
          clientY: 20,
          buttons: 1,
        });
      });

      expect(useAppStore.getState().floatingPaste?.rotation).toBeCloseTo(90, 5);
    } finally {
      act(() => {
        useAppStore.setState({ extractSelectionToFloatingPaste: originalExtract });
      });
    }
  });
});
