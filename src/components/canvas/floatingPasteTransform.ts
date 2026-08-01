import type { CropHandle, Rectangle } from '@/types';

import {
  applyCornerAspectLock,
  isCornerHandle,
  resizeRectFromDrag,
  type Point,
} from './RectHandles';

const rotatePoint = (point: Point, rotationDeg: number): Point => {
  if (!rotationDeg) {
    return point;
  }

  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
};

const getOppositeAnchorLocalPoint = (handle: CropHandle, width: number, height: number): Point => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  return {
    x: handle.includes('left') ? halfWidth : handle.includes('right') ? -halfWidth : 0,
    y: handle.includes('top') ? halfHeight : handle.includes('bottom') ? -halfHeight : 0,
  };
};

export const computeHandleAnchoredRect = ({
  initialRect,
  handle,
  nextWidth,
  nextHeight,
  rotation,
}: {
  initialRect: Rectangle;
  handle: CropHandle;
  nextWidth: number;
  nextHeight: number;
  rotation: number;
}): Rectangle => {
  const initialCenter = {
    x: initialRect.x + initialRect.width / 2,
    y: initialRect.y + initialRect.height / 2,
  };

  const anchorInitialLocal = getOppositeAnchorLocalPoint(handle, initialRect.width, initialRect.height);
  const anchorInitialWorldOffset = rotatePoint(anchorInitialLocal, rotation);
  const anchorWorld = {
    x: initialCenter.x + anchorInitialWorldOffset.x,
    y: initialCenter.y + anchorInitialWorldOffset.y,
  };

  const anchorNextLocal = getOppositeAnchorLocalPoint(handle, nextWidth, nextHeight);
  const anchorNextWorldOffset = rotatePoint(anchorNextLocal, rotation);
  const nextCenter = {
    x: anchorWorld.x - anchorNextWorldOffset.x,
    y: anchorWorld.y - anchorNextWorldOffset.y,
  };

  return {
    x: nextCenter.x - nextWidth / 2,
    y: nextCenter.y - nextHeight / 2,
    width: nextWidth,
    height: nextHeight,
  };
};

const toLocalPoint = (world: Point, center: Point, rotation: number): Point => {
  const translated = {
    x: world.x - center.x,
    y: world.y - center.y,
  };
  return rotatePoint(translated, -rotation);
};

export const computeFloatingPasteResize = ({
  initialRect,
  handle,
  start,
  current,
  rotation,
}: {
  initialRect: Rectangle;
  handle: CropHandle;
  start: Point;
  current: Point;
  rotation: number;
}): Rectangle => {
  const center = {
    x: initialRect.x + initialRect.width / 2,
    y: initialRect.y + initialRect.height / 2,
  };
  const localStartRect: Rectangle = {
    x: -initialRect.width / 2,
    y: -initialRect.height / 2,
    width: initialRect.width,
    height: initialRect.height,
  };
  let nextLocalRect = resizeRectFromDrag(
    localStartRect,
    handle,
    toLocalPoint(start, center, rotation),
    toLocalPoint(current, center, rotation),
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    { clampToBounds: false },
  );
  if (isCornerHandle(handle)) {
    nextLocalRect = applyCornerAspectLock({
      handle,
      initialRect: localStartRect,
      currentRect: nextLocalRect,
      boundsWidth: Number.POSITIVE_INFINITY,
      boundsHeight: Number.POSITIVE_INFINITY,
    });
  }

  return computeHandleAnchoredRect({
    initialRect,
    handle,
    nextWidth: nextLocalRect.width,
    nextHeight: nextLocalRect.height,
    rotation,
  });
};

export const computeFloatingPasteRotation = ({
  rect,
  start,
  current,
  initialRotation,
  snapIncrement,
}: {
  rect: Rectangle;
  start: Point;
  current: Point;
  initialRotation: number;
  snapIncrement?: number;
}): number => {
  const center = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  let rotation = initialRotation + ((currentAngle - startAngle) * 180) / Math.PI;
  if (snapIncrement && snapIncrement > 0) {
    rotation = Math.round(rotation / snapIncrement) * snapIncrement;
  }

  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};
