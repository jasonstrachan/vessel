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
});
