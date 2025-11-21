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
  const originalSetPointerCapture = HTMLCanvasElement.prototype.setPointerCapture;
  const originalReleasePointerCapture = HTMLCanvasElement.prototype.releasePointerCapture;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
      if (kind === '2d') return createCtx();
      return null;
    };
    HTMLCanvasElement.prototype.setPointerCapture = jest.fn();
    HTMLCanvasElement.prototype.releasePointerCapture = jest.fn();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.setPointerCapture = originalSetPointerCapture;
    HTMLCanvasElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    jest.restoreAllMocks();
  });

  it('dispatches dither warmup on color slider release', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const { getAllByRole } = render(<ColorPickerPanel />);

    // First range is the red slider
    const sliders = getAllByRole('slider') as HTMLInputElement[];
    const redSlider = sliders[0];

    fireEvent.pointerDown(redSlider, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(redSlider, { clientX: 10, clientY: 0, pointerId: 1 });

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'vessel:dither-warmup-request' }));
  });
});
