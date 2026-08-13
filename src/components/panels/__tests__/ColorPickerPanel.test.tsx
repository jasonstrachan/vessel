/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

import ColorPickerPanel from '../ColorPickerPanel';

// Minimal 2D context mock for canvas usage inside ColorPicker
const createCtx = () => {
  const ctx: any = {
    canvas: { width: 0, height: 0 },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: jest.fn(),
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    drawImage: jest.fn(),
    createLinearGradient: jest.fn(() => ({
      addColorStop: jest.fn(),
    })),
  };
  return ctx;
};

describe('ColorPickerPanel', () => {
  const initialState = useAppStore.getState();
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
  const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
      if (kind === '2d') return createCtx();
      return null;
    };
    HTMLElement.prototype.setPointerCapture = jest.fn();
    HTMLElement.prototype.releasePointerCapture = jest.fn();
  });

  afterEach(() => {
    act(() => useAppStore.setState(initialState, true));
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    jest.restoreAllMocks();
  });

  it('replaces recent colors with editable shared gradients for a CC layer', async () => {
    const user = userEvent.setup();
    const layer = {
      id: 'cc-layer',
      name: 'CC',
      layerType: 'color-cycle',
    } as Layer;
    useAppStore.setState({ layers: [layer], activeLayerId: layer.id });

    render(<ColorPickerPanel />);

    expect(screen.getByTestId('cc-gradient-palette')).toBeInTheDocument();
    const swatches = screen.getAllByRole('button', { name: /Use CC gradient/i });
    expect(swatches.length).toBeGreaterThan(1);
    await user.click(swatches[1]);

    const state = useAppStore.getState();
    const active = state.palette.colorCycleGradients?.find(
      (gradient) => gradient.id === state.palette.activeColorCycleGradientId,
    );
    expect(state.tools.brushSettings.colorCycleGradient).toEqual(active?.stops);
    expect(state.tools.brushSettings.ccGradientSource).toBe('manual');
    expect(screen.getByText('Seam')).toBeInTheDocument();
  });

  it('dispatches dither warmup on color slider release', () => {
    const eventSpy = jest.fn();
    window.addEventListener('vessel:dither-warmup-request', eventSpy);
    const { getAllByRole } = render(<ColorPickerPanel />);

    // First range is the red slider
    const sliders = getAllByRole('slider') as HTMLInputElement[];
    const redSlider = sliders[0];

    fireEvent.pointerDown(redSlider, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(redSlider, { clientX: 10, clientY: 0, pointerId: 1 });

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy.mock.calls[0]?.[0]?.type).toBe('vessel:dither-warmup-request');
  });
});
