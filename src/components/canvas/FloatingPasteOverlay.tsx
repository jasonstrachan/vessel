'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectFloatingPaste } from '@/stores/selectors/pasteSelectors';
import type { CropHandle, Rectangle } from '@/types';
import {
  HANDLE_SIZE,
  handleCursor,
  handleDefinitions,
  moveRect,
  resizeRect,
  applyCornerAspectLock,
  isCornerHandle,
  MIN_RECT_SIZE,
  type Point,
} from './RectHandles';

interface FloatingPasteOverlayProps {
  projectWidth: number;
  projectHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type InteractionState =
  | { type: 'idle' }
  | { type: 'resizing'; start: Point; initialRect: Rectangle; handle: CropHandle }
  | { type: 'moving'; start: Point; initialRect: Rectangle };

const FloatingPasteOverlay: React.FC<FloatingPasteOverlayProps> = ({
  projectWidth,
  projectHeight,
  zoom,
  offsetX,
  offsetY,
}) => {
  const floatingPaste = useAppStore(selectFloatingPaste);
  const updateFloatingPasteRect = useAppStore((state) => state.updateFloatingPasteRect);
  const overlayRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<InteractionState>({ type: 'idle' });

  const rect = useMemo(() => {
    if (!floatingPaste) {
      return null;
    }
    return {
      x: floatingPaste.position.x,
      y: floatingPaste.position.y,
      width: floatingPaste.displayWidth,
      height: floatingPaste.displayHeight,
    };
  }, [floatingPaste]);

  const getWorldPoint = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLDivElement>): Point | null => {
      if (!rect) {
        return null;
      }

      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return null;
      }

      const bounds = overlayEl.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const safeZoom = zoom || 1;

      const worldX = Math.round((localX - offsetX) / safeZoom);
      const worldY = Math.round((localY - offsetY) / safeZoom);
      return { x: worldX, y: worldY };
    },
    [offsetX, offsetY, rect, zoom]
  );

  const applyRectUpdate = useCallback(
    (next: Rectangle) => {
      updateFloatingPasteRect({
        x: next.x,
        y: next.y,
        width: Math.max(MIN_RECT_SIZE, next.width),
        height: Math.max(MIN_RECT_SIZE, next.height),
      });
    },
    [updateFloatingPasteRect]
  );

  const handleMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!rect) {
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
        initialRect: rect,
      };

      event.preventDefault();
      event.stopPropagation();
    },
    [getWorldPoint, rect]
  );

  const handleResizePointerDown = useCallback(
    (handle: CropHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (!rect) {
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
        initialRect: rect,
        handle,
      };

      event.preventDefault();
      event.stopPropagation();
    },
    [getWorldPoint, rect]
  );

  const finalizeInteraction = useCallback((pointerId: number) => {
    const overlayEl = overlayRef.current;
    if (overlayEl?.hasPointerCapture(pointerId)) {
      overlayEl.releasePointerCapture(pointerId);
    }
    interactionRef.current = { type: 'idle' };
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (interactionRef.current.type === 'idle' || !rect) {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      if (interactionRef.current.type === 'moving') {
        const next = moveRect(
          interactionRef.current.initialRect,
          interactionRef.current.start,
          worldPoint,
          projectWidth,
          projectHeight,
          { clampToBounds: false }
        );
        applyRectUpdate(next);
      } else if (interactionRef.current.type === 'resizing') {
        let next = resizeRect(
          interactionRef.current.initialRect,
          interactionRef.current.handle,
          worldPoint,
          projectWidth,
          projectHeight,
          { clampToBounds: false }
        );
        if (isCornerHandle(interactionRef.current.handle)) {
          next = applyCornerAspectLock({
            handle: interactionRef.current.handle,
            initialRect: interactionRef.current.initialRect,
            currentRect: next,
            boundsWidth: Number.POSITIVE_INFINITY,
            boundsHeight: Number.POSITIVE_INFINITY,
          });
        }
        applyRectUpdate(next);
      }

      event.preventDefault();
    },
    [applyRectUpdate, getWorldPoint, projectHeight, projectWidth, rect]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finalizeInteraction(event.pointerId);
    },
    [finalizeInteraction]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finalizeInteraction(event.pointerId);
    },
    [finalizeInteraction]
  );

  const marqueeScreenRect = useMemo(() => {
    if (!rect) {
      return null;
    }
    return {
      left: rect.x * zoom + offsetX,
      top: rect.y * zoom + offsetY,
      width: Math.max(rect.width * zoom, 1),
      height: Math.max(rect.height * zoom, 1),
    };
  }, [offsetX, offsetY, rect, zoom]);

  if (!floatingPaste || !marqueeScreenRect) {
    return null;
  }

  const { left, top, width, height } = marqueeScreenRect;
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 6 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className="absolute"
        style={{
          left,
          top,
          width,
          height,
          border: '1px solid transparent',
          boxShadow: 'none',
          pointerEvents: 'auto',
          cursor: handleCursor('center'),
        }}
        onPointerDown={handleMovePointerDown}
      />
      {handleDefinitions.map(({ handle, offsetX: ox, offsetY: oy }) => {
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

        return (
          <div
            key={handle}
            role="presentation"
            style={{
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
              pointerEvents: 'auto',
            }}
            onPointerDown={handleResizePointerDown(handle)}
          />
        );
      })}
    </div>
  );
};

export default FloatingPasteOverlay;
