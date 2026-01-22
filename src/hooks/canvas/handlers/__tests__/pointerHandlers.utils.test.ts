/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../pointerHandlers';
import { BrushShape } from '@/types';

describe('pointerHandlers utils', () => {
  const { shouldEnableContourDebug, isAdvancedShapeBrush, computeOpposingAxis } = __TESTING__;

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
});
