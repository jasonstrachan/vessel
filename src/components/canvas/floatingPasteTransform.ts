import type { CropHandle, Rectangle } from '@/types';

type Point = { x: number; y: number };

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
