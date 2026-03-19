/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../pointerHandlers';
import { BrushShape } from '@/types';

describe('pointerHandlers utils', () => {
  const {
    shouldEnableContourDebug,
    isAdvancedShapeBrush,
    computeOpposingAxis,
    resolveCursorDisplayWorldPointForBrush,
  } = __TESTING__;

  it('flags advanced shape brushes', () => {
    expect(isAdvancedShapeBrush(BrushShape.CONTOUR_LINES2)).toBe(true);
    expect(isAdvancedShapeBrush(BrushShape.ROUND)).toBe(false);
  });

  it('reads contour debug flag from __CL_DEBUG or localStorage', () => {
    const original = (globalThis as any).__CL_DEBUG;
    (globalThis as any).__CL_DEBUG = true;
    expect(shouldEnableContourDebug()).toBe(true);
    (globalThis as any).__CL_DEBUG = original;
  });

  it('computes opposing axis endpoints for a point set', () => {
    const axis = computeOpposingAxis([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 5 },
    ]);
    const endpoints = [axis.start, axis.end];
    expect(endpoints).toContainEqual({ x: 10, y: 0 });
    expect(endpoints).toContainEqual({ x: 0, y: 5 });
  });

  it('centers odd-size pixel-perfect square brushes on half pixels', () => {
    expect(
      resolveCursorDisplayWorldPointForBrush(
        { x: 12, y: 8 },
        {
          brushShape: BrushShape.SQUARE,
          antialiasing: false,
          size: 11,
        }
      )
    ).toEqual({ x: 12.5, y: 8.5 });
  });

  it('keeps even-size pixel-perfect square brushes on integer centers', () => {
    expect(
      resolveCursorDisplayWorldPointForBrush(
        { x: 12, y: 8 },
        {
          brushShape: BrushShape.SQUARE,
          antialiasing: false,
          size: 10,
        }
      )
    ).toEqual({ x: 12, y: 8 });
  });

  it('centers odd-size square color-cycle stamps on half pixels', () => {
    expect(
      resolveCursorDisplayWorldPointForBrush(
        { x: 12, y: 8 },
        {
          brushShape: BrushShape.COLOR_CYCLE,
          colorCycleStampShape: 'square',
          size: 11,
        }
      )
    ).toEqual({ x: 12.5, y: 8.5 });
  });

  it('keeps round color-cycle stamps on pixel-center anchors', () => {
    expect(
      resolveCursorDisplayWorldPointForBrush(
        { x: 12, y: 8 },
        {
          brushShape: BrushShape.COLOR_CYCLE,
          colorCycleStampShape: 'round',
          size: 10,
        }
      )
    ).toEqual({ x: 12.5, y: 8.5 });
  });
});
