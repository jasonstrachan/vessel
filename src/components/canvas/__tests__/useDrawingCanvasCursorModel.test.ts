import { renderHook } from '@testing-library/react';
import { BrushShape, type Tool } from '@/types';
import { useDrawingCanvasCursorModel } from '../useDrawingCanvasCursorModel';

describe('useDrawingCanvasCursorModel', () => {
  const isSpacePressedRef = { current: false };

  it('returns a shape descriptor for standard brushes', () => {
    const { result } = renderHook(() =>
      useDrawingCanvasCursorModel({
        tools: {
          currentTool: 'brush' as Tool,
          brushSettings: {
            brushShape: BrushShape.SQUARE,
            size: 18,
            antialiasing: true,
            rotationEnabled: false,
          },
          eraserSettings: {
            size: 10,
          },
        },
        globalBrushSize: 12,
        showBrushCursor: true,
        panIsPanning: false,
        isSpacePressedRef,
        cursorStyle: 'none',
      })
    );

    expect(result.current.cursorDescriptor).toEqual({
      kind: 'shape',
      shape: BrushShape.SQUARE,
      pixelSize: 18,
    });
    expect(result.current.brushCursorVisible).toBe(true);
  });

  it('returns an aspect-correct descriptor for custom brushes', () => {
    const imageData = {
      width: 20,
      height: 10,
      data: new Uint8ClampedArray(20 * 10 * 4),
    } as ImageData;

    const { result } = renderHook(() =>
      useDrawingCanvasCursorModel({
        tools: {
          currentTool: 'brush' as Tool,
          brushSettings: {
            brushShape: BrushShape.CUSTOM,
            size: 40,
            antialiasing: true,
            rotationEnabled: false,
            currentBrushTip: {
              brushId: 'custom-1',
              imageData,
              width: 20,
              height: 10,
              naturalWidth: 20,
              naturalHeight: 10,
              maxDimension: 20,
              isColorizable: false,
            },
          },
          eraserSettings: {
            size: 10,
          },
        },
        globalBrushSize: 12,
        showBrushCursor: true,
        panIsPanning: false,
        isSpacePressedRef,
        cursorStyle: 'none',
      })
    );

    expect(result.current.cursorDescriptor).toEqual({
      kind: 'custom-brush',
      pixelSize: 40,
      pixelWidth: 40,
      pixelHeight: 20,
      imageData,
    });
  });

  it('uses eraser custom tip metadata when eraser is active', () => {
    const imageData = {
      width: 12,
      height: 24,
      data: new Uint8ClampedArray(12 * 24 * 4),
    } as ImageData;

    const { result } = renderHook(() =>
      useDrawingCanvasCursorModel({
        tools: {
          currentTool: 'eraser' as Tool,
          brushSettings: {
            brushShape: BrushShape.ROUND,
            size: 30,
            antialiasing: true,
            rotationEnabled: false,
          },
          eraserSettings: {
            brushShape: BrushShape.CUSTOM,
            size: 60,
            linkSizeToBrush: false,
            currentBrushTip: {
              brushId: 'custom-eraser',
              imageData,
              width: 12,
              height: 24,
              naturalWidth: 12,
              naturalHeight: 24,
              maxDimension: 24,
              isColorizable: false,
            },
          },
        },
        globalBrushSize: 12,
        showBrushCursor: true,
        panIsPanning: false,
        isSpacePressedRef,
        cursorStyle: 'none',
      })
    );

    expect(result.current.cursorDescriptor).toEqual({
      kind: 'custom-brush',
      pixelSize: 60,
      pixelWidth: 30,
      pixelHeight: 60,
      imageData,
    });
  });
});
