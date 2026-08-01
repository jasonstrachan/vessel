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
  MIN_RECT_SIZE,
  type Point,
} from './RectHandles';
import {
  computeFloatingPasteResize,
  computeFloatingPasteRotation,
} from './floatingPasteTransform';

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
  | { type: 'moving'; start: Point; initialRect: Rectangle }
  | { type: 'rotating'; start: Point; initialRect: Rectangle; initialRotation: number };

const FloatingPasteOverlay: React.FC<FloatingPasteOverlayProps> = ({
  projectWidth,
  projectHeight,
  zoom,
  offsetX,
  offsetY,
}) => {
  const floatingPaste = useAppStore(selectFloatingPaste);
  const updateFloatingPasteRect = useAppStore((state) => state.updateFloatingPasteRect);
  const updateFloatingPasteRotation = useAppStore((state) => state.updateFloatingPasteRotation);
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

      const rotation = floatingPaste?.rotation ?? 0;

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
        const nextRect = computeFloatingPasteResize({
          initialRect: interactionRef.current.initialRect,
          handle: interactionRef.current.handle,
          start: interactionRef.current.start,
          current: worldPoint,
          rotation,
        });
        applyRectUpdate(nextRect);
      } else if (interactionRef.current.type === 'rotating') {
        updateFloatingPasteRotation(computeFloatingPasteRotation({
          rect: interactionRef.current.initialRect,
          start: interactionRef.current.start,
          current: worldPoint,
          initialRotation: interactionRef.current.initialRotation,
          snapIncrement: event.shiftKey ? 15 : undefined,
        }));
      }

      event.preventDefault();
    },
    [
      applyRectUpdate,
      floatingPaste?.rotation,
      getWorldPoint,
      projectHeight,
      projectWidth,
      rect,
      updateFloatingPasteRotation,
    ]
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
  const rotateHandleOffset = 26;
  const rotateHandleSize = 12;
  const canRotate = !floatingPaste.colorCycleIndices;
  const rotation = floatingPaste.rotation ?? 0;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 6 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <div
        className="absolute"
        style={{
          left: centerX,
          top: centerY,
          width,
          height,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          transformOrigin: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute' as const,
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            border: '1px solid transparent',
            boxShadow: 'none',
            pointerEvents: 'auto',
            cursor: handleCursor('center'),
          }}
          onPointerDown={handleMovePointerDown}
        />
        {canRotate ? (
          <>
            <div
              style={{
                position: 'absolute' as const,
                left: '50%',
                top: -rotateHandleOffset + rotateHandleSize / 2,
                width: 2,
                height: rotateHandleOffset - rotateHandleSize / 2,
                transform: 'translateX(-50%)',
                backgroundColor: '#FFFFFF',
                opacity: 0.7,
                pointerEvents: 'none',
              }}
            />
            <div
              role="presentation"
              data-floating-rotate-handle
              style={{
                position: 'absolute' as const,
                width: rotateHandleSize,
                height: rotateHandleSize,
                left: '50%',
                top: -rotateHandleOffset,
                transform: 'translateX(-50%)',
                backgroundColor: '#FFFFFF',
                border: '1px solid #0F172A',
                borderRadius: '999px',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.35)',
                cursor: 'grab',
                pointerEvents: 'auto',
              }}
              onPointerDown={(event) => {
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
                  type: 'rotating',
                  start: worldPoint,
                  initialRect: rect,
                  initialRotation: floatingPaste.rotation ?? 0,
                };
                event.preventDefault();
                event.stopPropagation();
              }}
            />
          </>
        ) : null}
        {handleDefinitions.map(({ handle, offsetX: ox, offsetY: oy }) => {
          const positionX = handle.includes('left')
            ? 0
            : handle.includes('right')
              ? width
              : width / 2;
          const positionY = handle.includes('top')
            ? 0
            : handle.includes('bottom')
              ? height
              : height / 2;

          return (
            <div
              key={handle}
              role="presentation"
              data-floating-handle={handle}
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
    </div>
  );
};

export default FloatingPasteOverlay;
