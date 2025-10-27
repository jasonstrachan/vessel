import type { CropHandle, Rectangle } from '@/types';

export type RectHandle = CropHandle;

export type Point = { x: number; y: number };

export const MIN_RECT_SIZE = 1;

export const clampValue = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const rectEquals = (a: Rectangle | null, b: Rectangle | null): boolean => {
  if (!a || !b) {
    return a === b;
  }
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
};

export const normalizeRect = (start: Point, end: Point): Rectangle => {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const snapRectToBounds = (
  rect: Rectangle,
  maxWidth: number,
  maxHeight: number
): Rectangle => {
  let x = rect.x;
  let y = rect.y;
  let width = Math.max(rect.width, MIN_RECT_SIZE);
  let height = Math.max(rect.height, MIN_RECT_SIZE);

  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }

  if (x + width > maxWidth) {
    width = maxWidth - x;
  }
  if (y + height > maxHeight) {
    height = maxHeight - y;
  }

  width = Math.max(MIN_RECT_SIZE, Math.min(width, maxWidth));
  height = Math.max(MIN_RECT_SIZE, Math.min(height, maxHeight));

  return {
    x: Math.round(clampValue(x, 0, maxWidth - MIN_RECT_SIZE)),
    y: Math.round(clampValue(y, 0, maxHeight - MIN_RECT_SIZE)),
    width: Math.round(width),
    height: Math.round(height),
  };
};

export const deriveHandleFromDrag = (start: Point, current: Point): RectHandle => {
  const horizontal = current.x >= start.x ? 'right' : 'left';
  const vertical = current.y >= start.y ? 'bottom' : 'top';
  return `${vertical}-${horizontal}` as RectHandle;
};

type ClampOptions = {
  clampToBounds?: boolean;
};

export const resizeRect = (
  initialRect: Rectangle,
  handle: RectHandle,
  current: Point,
  maxWidth: number,
  maxHeight: number,
  options?: ClampOptions
): Rectangle => {
  const clampToBounds = options?.clampToBounds !== false;
  const leftInitial = initialRect.x;
  const topInitial = initialRect.y;
  const rightInitial = initialRect.x + initialRect.width;
  const bottomInitial = initialRect.y + initialRect.height;

  let left = leftInitial;
  let right = rightInitial;
  let top = topInitial;
  let bottom = bottomInitial;

  if (handle.includes('left')) {
    const raw = Math.round(current.x);
    const clamped = clampToBounds ? clampValue(raw, 0, rightInitial - MIN_RECT_SIZE) : raw;
    left = Math.min(clamped, rightInitial - MIN_RECT_SIZE);
  }

  if (handle.includes('right')) {
    const raw = Math.round(current.x);
    const clamped = clampToBounds ? clampValue(raw, left + MIN_RECT_SIZE, maxWidth) : raw;
    right = Math.max(clamped, left + MIN_RECT_SIZE);
  }

  if (handle.includes('top')) {
    const raw = Math.round(current.y);
    const clamped = clampToBounds ? clampValue(raw, 0, bottomInitial - MIN_RECT_SIZE) : raw;
    top = Math.min(clamped, bottomInitial - MIN_RECT_SIZE);
  }

  if (handle.includes('bottom')) {
    const raw = Math.round(current.y);
    const clamped = clampToBounds ? clampValue(raw, top + MIN_RECT_SIZE, maxHeight) : raw;
    bottom = Math.max(clamped, top + MIN_RECT_SIZE);
  }

  const rect = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };

  return clampToBounds ? snapRectToBounds(rect, maxWidth, maxHeight) : rect;
};

export const moveRect = (
  initialRect: Rectangle,
  start: Point,
  current: Point,
  maxWidth: number,
  maxHeight: number,
  options?: ClampOptions
): Rectangle => {
  const clampToBounds = options?.clampToBounds !== false;
  const deltaX = Math.round(current.x - start.x);
  const deltaY = Math.round(current.y - start.y);

  let nextX = initialRect.x + deltaX;
  let nextY = initialRect.y + deltaY;

  if (clampToBounds) {
    nextX = clampValue(nextX, 0, maxWidth - initialRect.width);
    nextY = clampValue(nextY, 0, maxHeight - initialRect.height);
  }

  return {
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: initialRect.width,
    height: initialRect.height,
  };
};

export const handleCursor = (handle: RectHandle): React.CSSProperties['cursor'] => {
  switch (handle) {
    case 'top-left':
    case 'bottom-right':
      return 'nwse-resize';
    case 'top-right':
    case 'bottom-left':
      return 'nesw-resize';
    case 'left':
    case 'right':
      return 'ew-resize';
    case 'top':
    case 'bottom':
      return 'ns-resize';
    case 'center':
      return 'move';
    default:
      return 'crosshair';
  }
};

export const HANDLE_SIZE = 10;

export const handleDefinitions: Array<{ handle: RectHandle; offsetX: number; offsetY: number }> = [
  { handle: 'top-left', offsetX: -0.5, offsetY: -0.5 },
  { handle: 'top', offsetX: 0, offsetY: -0.5 },
  { handle: 'top-right', offsetX: 0.5, offsetY: -0.5 },
  { handle: 'right', offsetX: 0.5, offsetY: 0 },
  { handle: 'bottom-right', offsetX: 0.5, offsetY: 0.5 },
  { handle: 'bottom', offsetX: 0, offsetY: 0.5 },
  { handle: 'bottom-left', offsetX: -0.5, offsetY: 0.5 },
  { handle: 'left', offsetX: -0.5, offsetY: 0 },
];

const deltaFromUnity = (value: number): number => Math.abs(value - 1);

const clampScale = (scale: number, minScale: number, maxScale: number): number => {
  if (Number.isNaN(scale) || !Number.isFinite(scale)) {
    return minScale;
  }
  if (maxScale > 0) {
    return clampValue(scale, minScale, Math.max(minScale, maxScale));
  }
  return minScale;
};

export const isCornerHandle = (handle: CropHandle): boolean => {
  const horizontal = handle.includes('left') || handle.includes('right');
  const vertical = handle.includes('top') || handle.includes('bottom');
  return horizontal && vertical;
};

export const applyCornerAspectLock = ({
  handle,
  initialRect,
  currentRect,
  boundsWidth,
  boundsHeight,
}: {
  handle: CropHandle;
  initialRect: Rectangle;
  currentRect: Rectangle;
  boundsWidth: number;
  boundsHeight: number;
}): Rectangle => {
  const initialWidth = Math.max(initialRect.width, MIN_RECT_SIZE);
  const initialHeight = Math.max(initialRect.height, MIN_RECT_SIZE);
  const ratio = initialWidth / Math.max(initialHeight, MIN_RECT_SIZE);

  const widthCandidate = Math.max(currentRect.width, MIN_RECT_SIZE);
  const heightCandidate = Math.max(currentRect.height, MIN_RECT_SIZE);
  const scaleX = widthCandidate / initialWidth;
  const scaleY = heightCandidate / initialHeight;

  const scale = deltaFromUnity(scaleX) >= deltaFromUnity(scaleY) ? scaleX : scaleY;

  const minScale = MIN_RECT_SIZE / Math.max(initialWidth, initialHeight);
  const maxScale = Math.min(boundsWidth / initialWidth, boundsHeight / initialHeight);
  const clampedScale = clampScale(scale, minScale, maxScale);

  let width = Math.max(initialWidth * clampedScale, MIN_RECT_SIZE);
  let height = Math.max(initialHeight * clampedScale, MIN_RECT_SIZE);

  const oppositeX = handle.includes('left') ? currentRect.x + currentRect.width : currentRect.x;
  const oppositeY = handle.includes('top') ? currentRect.y + currentRect.height : currentRect.y;

  let x = handle.includes('left') ? oppositeX - width : oppositeX;
  let y = handle.includes('top') ? oppositeY - height : oppositeY;

  if (width > boundsWidth) {
    width = boundsWidth;
    height = Math.max(width / ratio, MIN_RECT_SIZE);
  }
  if (height > boundsHeight) {
    height = boundsHeight;
    width = Math.max(height * ratio, MIN_RECT_SIZE);
  }

  const maxX = Math.max(0, boundsWidth - width);
  const maxY = Math.max(0, boundsHeight - height);
  x = clampValue(x, 0, maxX);
  y = clampValue(y, 0, maxY);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MIN_RECT_SIZE, Math.round(width)),
    height: Math.max(MIN_RECT_SIZE, Math.round(height)),
  };
};
