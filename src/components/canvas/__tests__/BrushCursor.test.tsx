import React from 'react';
import { render, renderHook } from '@testing-library/react';
import { BrushShape, type Tool } from '@/types';
import BrushCursor from '../BrushCursor';
import { useDrawingCanvasCursorModel } from '../useDrawingCanvasCursorModel';

describe('BrushCursor', () => {
  const context = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    arc: jest.fn(),
    ellipse: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
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
    expect(context.stroke).toHaveBeenCalled();
    expect(context.scale).toHaveBeenCalled();
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

  it('uses the custom brush alpha contour instead of only its bounds', () => {
    class MockPath2D {
      moveTo() {}
      lineTo() {}
    }
    const originalPath2D = global.Path2D;
    global.Path2D = MockPath2D as unknown as typeof Path2D;
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();
    const imageData = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    } as ImageData;

    try {
      render(
        <BrushCursor
          ref={ref}
          descriptor={{
            kind: 'custom-brush',
            pixelSize: 20,
            pixelWidth: 20,
            pixelHeight: 20,
            imageData,
          }}
          zoom={1}
          visible
        />
      );

      ref.current?.setPosition(110, 70);

      expect(context.stroke).toHaveBeenCalledWith(expect.any(MockPath2D));
      expect(context.scale).toHaveBeenCalledWith(10, 10);
    } finally {
      global.Path2D = originalPath2D;
    }
  });

  it('uses pressure-adjusted cursor size only while drawing', () => {
    const ref = React.createRef<{
      setPosition: (
        x: number,
        y: number,
        sample?: { pressure: number; isDrawing: boolean }
      ) => void;
    }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
          pressureSizing: {
            minPercent: 50,
            maxPercent: 150,
          },
        }}
        zoom={1}
        visible
      />
    );

    context.rect.mockClear();
    ref.current?.setPosition(110, 70, { pressure: 1, isDrawing: true });
    expect(context.rect).toHaveBeenCalledWith(85.5, 35.5, 29, 29);

    context.rect.mockClear();
    ref.current?.setPosition(110, 70, { pressure: 1, isDrawing: false });
    expect(context.rect).toHaveBeenCalledWith(90.5, 40.5, 19, 19);
  });

  it('rotates a stroke footprint from pointer direction', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
          rotationEnabled: true,
          rotationScale: 1,
        }}
        zoom={1}
        visible
      />
    );

    ref.current?.setPosition(110, 70);
    context.rotate.mockClear();
    ref.current?.setPosition(110, 90);

    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
  });

  it('draws a diamond tip as a diamond outline', () => {
    const ref = React.createRef<{ setPosition: (x: number, y: number) => void }>();

    render(
      <BrushCursor
        ref={ref}
        descriptor={{
          kind: 'shape',
          shape: BrushShape.SQUARE,
          pixelSize: 20,
          tipShape: 'diamond',
        }}
        zoom={1}
        visible
      />
    );

    context.rect.mockClear();
    context.moveTo.mockClear();
    ref.current?.setPosition(110, 70);

    expect(context.rect).not.toHaveBeenCalled();
    expect(context.moveTo).toHaveBeenCalledWith(100, 40);
  });

  it('projects pressure and rotation settings into the stroke cursor descriptor', () => {
    const { result } = renderHook(() =>
      useDrawingCanvasCursorModel({
        tools: {
          currentTool: 'brush' as Tool,
          brushSettings: {
            brushShape: BrushShape.SQUARE,
            size: 20,
            antialiasing: true,
            rotationEnabled: true,
            pressureEnabled: true,
            minPressure: 50,
            maxPressure: 50,
          },
          eraserSettings: {},
        },
        globalBrushSize: 20,
        showBrushCursor: true,
        panIsPanning: false,
        isSpacePressedRef: { current: false },
        cursorStyle: 'none',
      })
    );

    expect(result.current.cursorDescriptor).toMatchObject({
      kind: 'shape',
      pixelSize: 20,
      pressureSizing: {
        minPercent: 50,
        maxPercent: 150,
      },
      rotationEnabled: true,
      rotationScale: 0.5,
    });
  });

  it('uses the rectangular mosaic footprint with its rendered quarter-turn', () => {
    const { result } = renderHook(() =>
      useDrawingCanvasCursorModel({
        tools: {
          currentTool: 'brush' as Tool,
          brushSettings: {
            brushShape: BrushShape.MOSAIC,
            size: 60,
            mosaicTilePx: 8,
            mosaicBlocksCount: 6,
            antialiasing: false,
            rotationEnabled: false,
          },
          eraserSettings: {},
        },
        globalBrushSize: 60,
        showBrushCursor: true,
        panIsPanning: false,
        isSpacePressedRef: { current: false },
        cursorStyle: 'none',
      })
    );

    expect(result.current.cursorDescriptor).toMatchObject({
      kind: 'shape',
      shape: BrushShape.MOSAIC,
      pixelWidth: 48,
      pixelHeight: 8,
      initialRotationRadians: Math.PI / 2,
    });
  });
});
