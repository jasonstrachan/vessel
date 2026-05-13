import React from 'react';
import { render } from '@testing-library/react';
import { BrushShape } from '@/types';
import BrushCursor from '../BrushCursor';

describe('BrushCursor', () => {
  const context = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    arc: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(),
    imageSmoothingEnabled: false,
    strokeStyle: '',
    lineWidth: 1,
  };

  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => context),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: jest.fn(() => ({
        left: 10,
        top: 20,
        width: 200,
        height: 100,
      })),
    });
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });
  });

  beforeEach(() => {
    Object.values(context).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  });

  it('renders the cursor on a canvas overlay', () => {
    const imageData = {
      width: 20,
      height: 10,
      data: new Uint8ClampedArray(20 * 10 * 4),
    } as ImageData;
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    const { container } = render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'custom-brush',
          pixelSize: 40,
          pixelWidth: 40,
          pixelHeight: 20,
          imageData,
        }}
        zoom={2}
        visible
      />
    );

    ref.current?.setPosition(110, 70);

    const cursor = container.firstChild as HTMLCanvasElement;
    expect(cursor).not.toBeNull();
    expect(cursor.tagName).toBe('CANVAS');
    expect(context.rect).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it('clears the full cursor layer when zoom changes', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    const { rerender } = render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);
    context.clearRect.mockClear();

    rerender(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
        }}
        zoom={2}
        visible
      />
    );

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
  });

  it('clears the full cursor layer when the cursor descriptor changes size', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    const { rerender } = render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);
    context.clearRect.mockClear();

    rerender(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 8,
        }}
        zoom={1}
        visible
      />
    );

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
  });

  it('renders stroke mode as a line cursor', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'stroke-line',
          pixelSize: 24,
          rotationEnabled: false,
          rotationRadians: 0,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);

    expect(context.moveTo).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
    expect(context.arc).not.toHaveBeenCalled();
  });

  it('rotates the stroke mode line cursor when rotation is enabled', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'stroke-line',
          pixelSize: 24,
          rotationEnabled: true,
          rotationRadians: Math.PI / 2,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);

    expect(context.moveTo).toHaveBeenCalledWith(100.5, 38.5);
    expect(context.lineTo).toHaveBeenCalledWith(100.5, 62.5);
  });

  it('tracks stroke mode line cursor direction from pointer movement', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'stroke-line',
          pixelSize: 24,
          rotationEnabled: false,
          rotationRadians: 0,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);
    context.moveTo.mockClear();
    context.lineTo.mockClear();

    ref.current?.setPosition(110, 95);

    expect(context.moveTo).toHaveBeenCalledWith(112.5, 75.5);
    expect(context.lineTo).toHaveBeenCalledWith(88.5, 75.5);
  });

  it('smooths stroke mode line cursor direction after the first movement vector', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'stroke-line',
          pixelSize: 24,
          rotationEnabled: false,
          rotationRadians: 0,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);
    ref.current?.setPosition(110, 95);
    context.moveTo.mockClear();
    context.lineTo.mockClear();

    ref.current?.setPosition(135, 95);

    expect(context.moveTo).not.toHaveBeenCalledWith(135.5, 83.5);
    expect(context.lineTo).not.toHaveBeenCalledWith(135.5, 107.5);
    expect(context.moveTo).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
  });
});
