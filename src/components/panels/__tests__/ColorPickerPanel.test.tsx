import React from 'react';
import { render, fireEvent } from '@testing-library/react';
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
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    jest.restoreAllMocks();
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
