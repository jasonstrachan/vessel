'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { useCropState } from '@/hooks/useCropState';
import type { CropHandle, CropState, Rectangle } from '@/types';

interface CropOverlayProps {
  projectWidth: number;
  projectHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
}

type InteractionState =
  | { type: 'idle' }
  | { type: 'creating'; start: Point; handle: CropHandle }
  | { type: 'resizing'; start: Point; initialRect: Rectangle; handle: CropHandle }
  | { type: 'moving'; start: Point; initialRect: Rectangle };

type Point = { x: number; y: number };

const MIN_CROP_SIZE = 1;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const rectEquals = (a: Rectangle | null, b: Rectangle | null): boolean => {
  if (!a || !b) {
    return a === b;
  }
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
};

const normalizeRect = (start: Point, end: Point): Rectangle => {
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

const snapRectToBounds = (rect: Rectangle, maxWidth: number, maxHeight: number): Rectangle => {
  let x = rect.x;
  let y = rect.y;
  let width = Math.max(rect.width, MIN_CROP_SIZE);
  let height = Math.max(rect.height, MIN_CROP_SIZE);

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

  width = Math.max(MIN_CROP_SIZE, Math.min(width, maxWidth));
  height = Math.max(MIN_CROP_SIZE, Math.min(height, maxHeight));

  return {
    x: Math.round(clamp(x, 0, maxWidth - MIN_CROP_SIZE)),
    y: Math.round(clamp(y, 0, maxHeight - MIN_CROP_SIZE)),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const deriveHandleFromDrag = (start: Point, current: Point): CropHandle => {
  const horizontal = current.x >= start.x ? 'right' : 'left';
  const vertical = current.y >= start.y ? 'bottom' : 'top';
  return `${vertical}-${horizontal}` as CropHandle;
};

const resizeRect = (
  initialRect: Rectangle,
  handle: CropHandle,
  current: Point,
  maxWidth: number,
  maxHeight: number,
): Rectangle => {
  const leftInitial = initialRect.x;
  const topInitial = initialRect.y;
  const rightInitial = initialRect.x + initialRect.width;
  const bottomInitial = initialRect.y + initialRect.height;

  let left = leftInitial;
  let right = rightInitial;
  let top = topInitial;
  let bottom = bottomInitial;

  if (handle.includes('left')) {
    const clamped = clamp(Math.round(current.x), 0, rightInitial - MIN_CROP_SIZE);
    left = Math.min(clamped, rightInitial - MIN_CROP_SIZE);
  }

  if (handle.includes('right')) {
    const clamped = clamp(Math.round(current.x), left + MIN_CROP_SIZE, maxWidth);
    right = Math.max(clamped, left + MIN_CROP_SIZE);
  }

  if (handle.includes('top')) {
    const clamped = clamp(Math.round(current.y), 0, bottomInitial - MIN_CROP_SIZE);
    top = Math.min(clamped, bottomInitial - MIN_CROP_SIZE);
  }

  if (handle.includes('bottom')) {
    const clamped = clamp(Math.round(current.y), top + MIN_CROP_SIZE, maxHeight);
    bottom = Math.max(clamped, top + MIN_CROP_SIZE);
  }

  return snapRectToBounds(
    {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    },
    maxWidth,
    maxHeight,
  );
};

const moveRect = (
  initialRect: Rectangle,
  start: Point,
  current: Point,
  maxWidth: number,
  maxHeight: number,
): Rectangle => {
  const deltaX = Math.round(current.x - start.x);
  const deltaY = Math.round(current.y - start.y);

  let nextX = initialRect.x + deltaX;
  let nextY = initialRect.y + deltaY;

  nextX = clamp(nextX, 0, maxWidth - initialRect.width);
  nextY = clamp(nextY, 0, maxHeight - initialRect.height);

  return {
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: initialRect.width,
    height: initialRect.height,
  };
};

const handleCursor = (handle: CropHandle): React.CSSProperties['cursor'] => {
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

const HANDLE_SIZE = 10;

const handleDefinitions: Array<{ handle: CropHandle; offsetX: number; offsetY: number }> = [
  { handle: 'top-left', offsetX: -0.5, offsetY: -0.5 },
  { handle: 'top', offsetX: 0, offsetY: -0.5 },
  { handle: 'top-right', offsetX: 0.5, offsetY: -0.5 },
  { handle: 'right', offsetX: 0.5, offsetY: 0 },
  { handle: 'bottom-right', offsetX: 0.5, offsetY: 0.5 },
  { handle: 'bottom', offsetX: 0, offsetY: 0.5 },
  { handle: 'bottom-left', offsetX: -0.5, offsetY: 0.5 },
  { handle: 'left', offsetX: -0.5, offsetY: 0 },
];

const CropOverlay: React.FC<CropOverlayProps> = ({
  projectWidth,
  projectHeight,
  zoom,
  offsetX,
  offsetY,
  active,
}) => {
  const { crop, setCropState } = useCropState();
  const overlayRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<InteractionState>({ type: 'idle' });

  const getWorldPoint = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLDivElement>): Point | null => {
      if (!active) {
        return null;
      }

      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return null;
      }

      const rect = overlayEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const safeZoom = zoom || 1;

      const worldX = clamp(Math.round((localX - offsetX) / safeZoom), 0, projectWidth);
      const worldY = clamp(Math.round((localY - offsetY) / safeZoom), 0, projectHeight);

      return { x: worldX, y: worldY };
    },
    [active, offsetX, offsetY, projectHeight, projectWidth, zoom],
  );

  const applyRectUpdate = useCallback(
    (nextRect: Rectangle, status: CropState['status'], handle: CropHandle | null) => {
      if (rectEquals(crop.marquee, nextRect) && crop.status === status && crop.activeHandle === handle) {
        return;
      }

      setCropState({
        marquee: nextRect,
        status,
        activeHandle: handle,
        commitInFlight: false,
      });
    },
    [crop.activeHandle, crop.marquee, crop.status, setCropState],
  );

  const handleOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active) {
        return;
      }

      if (event.target !== event.currentTarget) {
        return;
      }

      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      overlayEl.setPointerCapture(event.pointerId);
      interactionRef.current = {
        type: 'creating',
        start: worldPoint,
        handle: 'bottom-right',
      };

      const initialRect = snapRectToBounds(
        {
          x: worldPoint.x,
          y: worldPoint.y,
          width: MIN_CROP_SIZE,
          height: MIN_CROP_SIZE,
        },
        projectWidth,
        projectHeight,
      );

      applyRectUpdate(initialRect, 'creating', 'bottom-right');
      event.preventDefault();
    },
    [active, applyRectUpdate, getWorldPoint, projectHeight, projectWidth],
  );

  const handleMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !crop.marquee) {
        return;
      }

      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      overlayEl.setPointerCapture(event.pointerId);

      interactionRef.current = {
        type: 'moving',
        start: worldPoint,
        initialRect: crop.marquee,
      };

      setCropState({
        status: 'adjusting',
        activeHandle: 'center',
        commitInFlight: false,
      });

      event.preventDefault();
      event.stopPropagation();
    },
    [active, crop.marquee, getWorldPoint, setCropState],
  );

  const handleResizePointerDown = useCallback(
    (handle: CropHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !crop.marquee) {
        return;
      }

      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      overlayEl.setPointerCapture(event.pointerId);

      interactionRef.current = {
        type: 'resizing',
        start: worldPoint,
        initialRect: crop.marquee,
        handle,
      };

      setCropState({
        status: 'adjusting',
        activeHandle: handle,
        commitInFlight: false,
      });

      event.preventDefault();
      event.stopPropagation();
    },
    [active, crop.marquee, getWorldPoint, setCropState],
  );

  const finalizeInteraction = useCallback(
    (pointerId: number) => {
      const overlayEl = overlayRef.current;
      if (overlayEl && overlayEl.hasPointerCapture(pointerId)) {
        overlayEl.releasePointerCapture(pointerId);
      }

      interactionRef.current = { type: 'idle' };

      if (crop.marquee) {
        setCropState({ status: 'ready', activeHandle: null });
      } else {
        setCropState({ status: 'idle', activeHandle: null });
      }
    },
    [crop.marquee, setCropState],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (interaction.type === 'idle' || !active) {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      if (interaction.type === 'creating') {
        const rawRect = normalizeRect(interaction.start, worldPoint);
        const nextRect = snapRectToBounds(rawRect, projectWidth, projectHeight);
        const handle = deriveHandleFromDrag(interaction.start, worldPoint);
        applyRectUpdate(nextRect, 'creating', handle);
      } else if (interaction.type === 'resizing') {
        const nextRect = resizeRect(
          interaction.initialRect,
          interaction.handle,
          worldPoint,
          projectWidth,
          projectHeight,
        );
        applyRectUpdate(nextRect, 'adjusting', interaction.handle);
      } else if (interaction.type === 'moving') {
        const nextRect = moveRect(
          interaction.initialRect,
          interaction.start,
          worldPoint,
          projectWidth,
          projectHeight,
        );
        applyRectUpdate(nextRect, 'adjusting', 'center');
      }

      event.preventDefault();
    },
    [active, applyRectUpdate, getWorldPoint, projectHeight, projectWidth],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finalizeInteraction(event.pointerId);
      event.preventDefault();
    },
    [finalizeInteraction],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finalizeInteraction(event.pointerId);
    },
    [finalizeInteraction],
  );

  const marqueeScreenRect = useMemo(() => {
    if (!crop.marquee) {
      return null;
    }

    const { x, y, width, height } = crop.marquee;
    return {
      left: x * zoom + offsetX,
      top: y * zoom + offsetY,
      width: Math.max(width * zoom, 1),
      height: Math.max(height * zoom, 1),
    };
  }, [crop.marquee, offsetX, offsetY, zoom]);

  const handleElements = useMemo(() => {
    if (!marqueeScreenRect) {
      return [] as Array<{ handle: CropHandle; style: React.CSSProperties }>;
    }

    const { left, top, width, height } = marqueeScreenRect;
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    return handleDefinitions.map(({ handle, offsetX: ox, offsetY: oy }) => {
      const positionX = handle.includes('left')
        ? left
        : handle.includes('right')
          ? left + width
          : centerX;
      const positionY = handle.includes('top')
        ? top
        : handle.includes('bottom')
          ? top + height
          : centerY;

      return {
        handle,
        style: {
          position: 'absolute' as const,
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          left: positionX + ox * HANDLE_SIZE - HANDLE_SIZE / 2,
          top: positionY + oy * HANDLE_SIZE - HANDLE_SIZE / 2,
          backgroundColor: '#FFFFFF',
          border: '1px solid #0F172A',
          borderRadius: 2,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.35)',
          cursor: handleCursor(handle),
        } as React.CSSProperties,
      };
    });
  }, [marqueeScreenRect]);

  if (!active) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        zIndex: 5,
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {crop.marquee && marqueeScreenRect && (
        <>
          <div
            className="absolute"
          style={{
              left: marqueeScreenRect.left,
              top: marqueeScreenRect.top,
              width: marqueeScreenRect.width,
              height: marqueeScreenRect.height,
              border: '1px dashed rgba(255, 255, 255, 0.9)',
              boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
              pointerEvents: 'auto',
              cursor: handleCursor('center'),
            }}
            onPointerDown={handleMovePointerDown}
          />
          {handleElements.map(({ handle, style }) => (
            <div
              key={handle}
              role="presentation"
              data-handle={handle}
              style={style}
              onPointerDown={handleResizePointerDown(handle)}
            />
          ))}
        </>
      )}
    </div>
  );
};

export default CropOverlay;
