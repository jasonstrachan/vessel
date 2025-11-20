import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import ColorPicker from '../ColorPicker';

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
    strokeStyle: '',
    stroke: jest.fn(),
    rect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    drawImage: jest.fn(),
    createLinearGradient: jest.fn(() => ({
      addColorStop: jest.fn(),
    })),
  };
  return ctx;
};

describe('ColorPicker', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
      if (kind === '2d') return createCtx();
      return null;
    };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('renders with provided color and calls onChange for hex input', () => {
    const onChange = jest.fn();
    const { getByDisplayValue } = render(
      <ColorPicker color="#336699" onChange={onChange} showHexInput />
    );

    const hexInput = getByDisplayValue('#336699');
    fireEvent.change(hexInput, { target: { value: '#112233' } });
    fireEvent.blur(hexInput);

    expect(onChange).toHaveBeenCalledWith('#112233');
  });
});
