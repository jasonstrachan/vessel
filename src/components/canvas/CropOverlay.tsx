'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { useCropState } from '@/hooks/useCropState';
import type { CropHandle, CropState } from '@/types';
import {
  HANDLE_SIZE,
  handleCursor,
  handleDefinitions,
  MIN_RECT_SIZE,
  moveRect,
  normalizeRect,
  rectEquals,
  resizeRect,
  snapRectToBounds,
  deriveHandleFromDrag,
  clampValue,
  type Point,
} from './RectHandles';

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

const clamp = clampValue;

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
          width: MIN_RECT_SIZE,
          height: MIN_RECT_SIZE,
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
