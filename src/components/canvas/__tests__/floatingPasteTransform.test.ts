import {
  computeFloatingPasteResize,
  computeFloatingPasteRotation,
  computeHandleAnchoredRect,
} from '@/components/canvas/floatingPasteTransform';
import type { CropHandle } from '@/types';

const rotatePoint = (x: number, y: number, rotationDeg: number) => {
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
};

const getTopRightWorld = (
  rect: { x: number; y: number; width: number; height: number },
  rotation: number,
) => {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const local = { x: rect.width / 2, y: -rect.height / 2 };
  const rotated = rotatePoint(local.x, local.y, rotation);
  return {
    x: center.x + rotated.x,
    y: center.y + rotated.y,
  };
};

const getOppositeAnchorWorld = (
  rect: { x: number; y: number; width: number; height: number },
  handle: CropHandle,
  rotation: number,
) => {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const local = {
    x: handle.includes('left') ? rect.width / 2 : handle.includes('right') ? -rect.width / 2 : 0,
    y: handle.includes('top') ? rect.height / 2 : handle.includes('bottom') ? -rect.height / 2 : 0,
  };
  const rotated = rotatePoint(local.x, local.y, rotation);
  return {
    x: center.x + rotated.x,
    y: center.y + rotated.y,
  };
};

describe('computeHandleAnchoredRect', () => {
  const handles: CropHandle[] = [
    'top-left',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
  ];

  it.each(handles)('keeps opposite anchor fixed for %s without rotation', (handle) => {
    const initialRect = { x: 10, y: 20, width: 40, height: 30 };
    const initialAnchor = getOppositeAnchorWorld(initialRect, handle, 0);

    const nextRect = computeHandleAnchoredRect({
      initialRect,
      handle,
      nextWidth: 62,
      nextHeight: 47,
      rotation: 0,
    });

    const nextAnchor = getOppositeAnchorWorld(nextRect, handle, 0);
    expect(nextAnchor.x).toBeCloseTo(initialAnchor.x, 6);
    expect(nextAnchor.y).toBeCloseTo(initialAnchor.y, 6);
  });

  it.each(handles)('keeps opposite anchor fixed for %s with rotation', (handle) => {
    const rotation = 30;
    const initialRect = { x: 10, y: 20, width: 40, height: 30 };
    const initialAnchor = getOppositeAnchorWorld(initialRect, handle, rotation);

    const nextRect = computeHandleAnchoredRect({
      initialRect,
      handle,
      nextWidth: 70,
      nextHeight: 45,
      rotation,
    });

    const nextAnchor = getOppositeAnchorWorld(nextRect, handle, rotation);
    expect(nextAnchor.x).toBeCloseTo(initialAnchor.x, 6);
    expect(nextAnchor.y).toBeCloseTo(initialAnchor.y, 6);
  });

  it('keeps top-right fixed for bottom-left explicitly', () => {
    const initialRect = { x: 10, y: 20, width: 40, height: 30 };
    const initialTopRight = getTopRightWorld(initialRect, 0);

    const nextRect = computeHandleAnchoredRect({
      initialRect,
      handle: 'bottom-left',
      nextWidth: 60,
      nextHeight: 50,
      rotation: 0,
    });

    const nextTopRight = getTopRightWorld(nextRect, 0);
    expect(nextTopRight.x).toBeCloseTo(initialTopRight.x, 6);
    expect(nextTopRight.y).toBeCloseTo(initialTopRight.y, 6);
  });
});

describe('computeFloatingPasteResize', () => {
  it('preserves the visual-handle grab offset and applies only pointer delta', () => {
    const initialRect = { x: 10, y: 20, width: 40, height: 30 };

    expect(computeFloatingPasteResize({
      initialRect,
      handle: 'right',
      start: { x: 55, y: 35 },
      current: { x: 65, y: 35 },
      rotation: 0,
    })).toEqual({ x: 10, y: 20, width: 50, height: 30 });
  });

  it('keeps the opposite world anchor fixed for rotated corner resizing', () => {
    const initialRect = { x: 10, y: 20, width: 40, height: 30 };
    const rotation = 30;
    const initialAnchor = getOppositeAnchorWorld(initialRect, 'bottom-right', rotation);
    const nextRect = computeFloatingPasteResize({
      initialRect,
      handle: 'bottom-right',
      start: { x: 45, y: 55 },
      current: { x: 60, y: 70 },
      rotation,
    });

    const nextAnchor = getOppositeAnchorWorld(nextRect, 'bottom-right', rotation);
    expect(nextAnchor.x).toBeCloseTo(initialAnchor.x, 6);
    expect(nextAnchor.y).toBeCloseTo(initialAnchor.y, 6);
    expect(nextRect.width / nextRect.height).toBeCloseTo(initialRect.width / initialRect.height, 5);
  });
});

describe('computeFloatingPasteRotation', () => {
  it('continues rotation from the initial pointer and supports shift snapping', () => {
    expect(computeFloatingPasteRotation({
      rect: { x: 10, y: 10, width: 20, height: 20 },
      start: { x: 20, y: 0 },
      current: { x: 40, y: 20 },
      initialRotation: 0,
      snapIncrement: 15,
    })).toBe(90);
  });
});
