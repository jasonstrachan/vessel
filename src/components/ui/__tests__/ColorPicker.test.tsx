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

  it('calls onCommit when the user releases SV pointer', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const { container } = render(
      <ColorPicker color="#336699" onChange={onChange} onCommit={onCommit} />
    );

    const canvases = container.querySelectorAll('canvas');
    const svCanvas = canvases[0];
    expect(svCanvas).toBeTruthy();

    fireEvent.pointerDown(svCanvas!, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(svCanvas!, { clientX: 12, clientY: 12, pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('calls onCommit when pressing Enter in the hex input', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const { getByDisplayValue } = render(
      <ColorPicker color="#336699" onChange={onChange} onCommit={onCommit} showHexInput />
    );

    const hexInput = getByDisplayValue('#336699');
    fireEvent.change(hexInput, { target: { value: '#445566' } });
    fireEvent.keyDown(hexInput, { key: 'Enter', code: 'Enter', charCode: 13 });

    expect(onCommit).toHaveBeenCalledTimes(3);
  });
});
