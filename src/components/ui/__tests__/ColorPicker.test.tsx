/* eslint-disable @typescript-eslint/no-explicit-any */
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

  beforeAll(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventShim extends MouseEvent {
        constructor(type: string, props?: PointerEventInit) {
          super(type, props);
        }
      }
      // @ts-expect-error - assign shim for test environment
      window.PointerEvent = PointerEventShim;
    }
  });

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

  const mockCanvasRect = (
    canvas: HTMLCanvasElement,
    { left, top, width, height }: { left: number; top: number; width: number; height: number },
  ) => {
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
  };

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

  it('maps pointer coordinates from the rendered SV canvas into canvas space', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const svCanvas = container.querySelectorAll('canvas')[0];
    mockCanvasRect(svCanvas, { left: 10, top: 20, width: 424, height: 424 });

    fireEvent.pointerDown(svCanvas, {
      clientX: 10 + (7.5 * 424) / 14,
      clientY: 20 + (7.5 * 424) / 14,
      pointerId: 1,
    });

    expect(onChange).toHaveBeenLastCalledWith('#804040');
  });

  it('maps pointer coordinates from the rendered hue canvas into canvas space', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const hueCanvas = container.querySelectorAll('canvas')[1];
    mockCanvasRect(hueCanvas, { left: 434, top: 20, width: 56, height: 424 });

    fireEvent.pointerDown(hueCanvas, {
      clientX: 462,
      clientY: 232,
      pointerId: 1,
    });

    expect(onChange).toHaveBeenLastCalledWith('#00FFFF');
  });

  it('preserves the selected hue when choosing pure white or black', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const [svCanvas, hueCanvas] = Array.from(container.querySelectorAll('canvas'));
    mockCanvasRect(svCanvas, { left: 0, top: 0, width: 212, height: 212 });
    mockCanvasRect(hueCanvas, { left: 212, top: 0, width: 28, height: 212 });

    fireEvent.pointerDown(hueCanvas, {
      clientX: 226,
      clientY: 212 / 3,
      pointerId: 1,
    });
    fireEvent.pointerDown(svCanvas, { clientX: 5, clientY: 5, pointerId: 2 });
    fireEvent.pointerDown(svCanvas, {
      clientX: (13.5 * 212) / 14,
      clientY: (0.5 * 212) / 14,
      pointerId: 3,
    });

    expect(onChange).toHaveBeenLastCalledWith('#12FF12');

    fireEvent.pointerDown(svCanvas, { clientX: 207, clientY: 207, pointerId: 4 });
    fireEvent.pointerDown(svCanvas, {
      clientX: (13.5 * 212) / 14,
      clientY: (0.5 * 212) / 14,
      pointerId: 5,
    });

    expect(onChange).toHaveBeenLastCalledWith('#12FF12');
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

  it('keeps SV indicator in-bounds for pure black', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#000000" onChange={onChange} />);
    const indicator = container.querySelector('div.pointer-events-none.absolute.left-0.top-0') as HTMLDivElement;

    expect(indicator).toBeTruthy();
    expect(indicator.style.transform).toMatch(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);

    const [, x, y] = indicator.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/) || [];
    expect(Number(x)).toBeLessThan(212);
    expect(Number(y)).toBeLessThan(212);
    expect(Number(x)).toBeGreaterThan(190);
    expect(Number(y)).toBeGreaterThan(190);
  });
});
