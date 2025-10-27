import { applyCornerAspectLock, moveRect, resizeRect } from '../RectHandles';
import type { CropHandle, Rectangle } from '@/types';

describe('applyCornerAspectLock', () => {
  const bounds = { width: 400, height: 300 };

  const run = (
    handle: CropHandle,
    initialRect: Rectangle,
    currentRect: Rectangle,
  ) => applyCornerAspectLock({
    handle,
    initialRect,
    currentRect,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  });

  it('keeps aspect ratio when expanding from top-left', () => {
    const initial: Rectangle = { x: 200, y: 100, width: 80, height: 40 };
    const pointerRect: Rectangle = { x: 140, y: 40, width: 140, height: 120 };

    const result = run('top-left', initial, pointerRect);

    expect(result.width / result.height).toBeCloseTo(2, 5);
    // Opposite corner (bottom-right) stays anchored
    const originalRight = pointerRect.x + pointerRect.width;
    const originalBottom = pointerRect.y + pointerRect.height;
    expect(result.x + result.width).toBe(originalRight);
    expect(result.y + result.height).toBe(originalBottom);
  });

  it('limits scale to fit bounds while preserving ratio', () => {
    const initial: Rectangle = { x: 10, y: 20, width: 150, height: 75 };
    const pointerRect: Rectangle = { x: -200, y: -100, width: 400, height: 350 };

    const result = run('top-left', initial, pointerRect);

    expect(result.width).toBeLessThanOrEqual(bounds.width);
    expect(result.height).toBeLessThanOrEqual(bounds.height);
    expect(result.width / result.height).toBeCloseTo(2, 5);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
  });
});

describe('moveRect clamp options', () => {
  it('allows moving outside bounds when clamp disabled', () => {
    const initial: Rectangle = { x: 50, y: 60, width: 20, height: 20 };
    const result = moveRect(initial, { x: 0, y: 0 }, { x: -30, y: 400 }, 200, 200, {
      clampToBounds: false,
    });
    expect(result.x).toBe(20);
    expect(result.y).toBe(460);
  });
});

describe('resizeRect clamp options', () => {
  it('allows stretching beyond canvas when clamp disabled', () => {
    const initial: Rectangle = { x: 10, y: 10, width: 40, height: 40 };
    const result = resizeRect(initial, 'right', { x: 500, y: 10 }, 200, 200, {
      clampToBounds: false,
    });
    expect(result.width).toBe(490);
    expect(result.x).toBe(10);
  });
});
