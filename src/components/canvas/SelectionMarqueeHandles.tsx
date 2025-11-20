'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectFloatingPaste, selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import type { Rectangle } from '@/types';
import {
  HANDLE_SIZE,
  handleDefinitions,
  handleCursor,
  clampValue,
  resizeRect,
  type RectHandle,
  type Point,
  rectEquals,
} from './RectHandles';

interface SelectionMarqueeHandlesProps {
  zoom: number;
  offsetX: number;
  offsetY: number;
  projectWidth: number;
  projectHeight: number;
}

type InteractionState =
  | { type: 'idle' }
  | { type: 'resizing'; handle: RectHandle; initialRect: Rectangle };

const SelectionMarqueeHandles: React.FC<SelectionMarqueeHandlesProps> = ({
  zoom,
  offsetX,
  offsetY,
  projectWidth,
  projectHeight,
}) => {
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const selectionMask = useAppStore((state) => state.selectionMask);
  const floatingPaste = useAppStore(selectFloatingPaste);
  const setSelectionBounds = useAppStore((state) => state.setSelectionBounds);
  const currentTool = useAppStore(selectCurrentTool);

  const selectionRect = useMemo(() => {
    if (selectionMask) {
      return null; // mask-driven selection hides rectangular handles
    }
    if (!selectionStart || !selectionEnd) {
      return null;
    }

    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);
    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      x: Math.min(selectionStart.x, selectionEnd.x),
      y: Math.min(selectionStart.y, selectionEnd.y),
      width,
      height,
    } satisfies Rectangle;
  }, [selectionEnd, selectionStart]);

  const marqueeScreenRect = useMemo(() => {
    if (!selectionRect) {
      return null;
    }

    const safeZoom = zoom || 1;
    return {
      left: selectionRect.x * safeZoom + offsetX,
      top: selectionRect.y * safeZoom + offsetY,
      width: Math.max(selectionRect.width * safeZoom, 1),
      height: Math.max(selectionRect.height * safeZoom, 1),
    };
  }, [offsetX, offsetY, selectionRect, zoom]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<InteractionState>({ type: 'idle' });
  const beforeSelectionRef = useRef<ReturnType<typeof captureSelectionSnapshot> | null>(null);
  const selectionRectRef = useRef<Rectangle | null>(selectionRect);

  useEffect(() => {
    selectionRectRef.current = selectionRect;
  }, [selectionRect]);

  const isSelectionToolActive = currentTool === 'selection' || currentTool === 'custom';
  const canInteract =
    !floatingPaste &&
    Boolean(selectionRect) &&
    isSelectionToolActive &&
    projectWidth > 0 &&
    projectHeight > 0;

  const getWorldPoint = useCallback(
    (event: PointerEvent | React.PointerEvent<Element>): Point | null => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !canInteract) {
        return null;
      }

      const rect = overlayEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const safeZoom = zoom || 1;

      const worldX = clampValue(Math.round((localX - offsetX) / safeZoom), 0, projectWidth);
      const worldY = clampValue(Math.round((localY - offsetY) / safeZoom), 0, projectHeight);

      return { x: worldX, y: worldY };
    },
    [canInteract, offsetX, offsetY, projectHeight, projectWidth, zoom],
  );

  const applyRectUpdate = useCallback(
    (rect: Rectangle) => {
      setSelectionBounds(
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
      );
    },
    [setSelectionBounds],
  );

  const finalizeInteraction = useCallback((pointerId: number) => {
    const overlayEl = overlayRef.current;
    if (overlayEl && overlayEl.hasPointerCapture?.(pointerId)) {
      overlayEl.releasePointerCapture(pointerId);
    }

    if (beforeSelectionRef.current) {
      commitSelectionHistory({
        before: beforeSelectionRef.current,
        description: 'Adjust selection bounds',
        meta: { source: 'selection-handle' },
      });
      beforeSelectionRef.current = null;
    }

    interactionRef.current = { type: 'idle' };
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canInteract) {
        return;
      }
      finalizeInteraction(event.pointerId);
      event.preventDefault();
    },
    [canInteract, finalizeInteraction],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canInteract) {
        return;
      }
      finalizeInteraction(event.pointerId);
    },
    [canInteract, finalizeInteraction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canInteract) {
        return;
      }

      const interaction = interactionRef.current;
      if (interaction.type !== 'resizing') {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      const nextRect = resizeRect(
        interaction.initialRect,
        interaction.handle,
        worldPoint,
        projectWidth,
        projectHeight,
      );

      const currentRect = selectionRectRef.current;
      if (currentRect && rectEquals(currentRect, nextRect)) {
        return;
      }

      applyRectUpdate(nextRect);
      event.preventDefault();
    },
    [applyRectUpdate, canInteract, getWorldPoint, projectHeight, projectWidth],
  );

  const handleResizePointerDown = useCallback(
    (handle: RectHandle) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canInteract || !selectionRect) {
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

      beforeSelectionRef.current = beforeSelectionRef.current ?? captureSelectionSnapshot();
      interactionRef.current = {
        type: 'resizing',
        handle,
        initialRect: selectionRect,
      };

      overlayEl.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [canInteract, getWorldPoint, selectionRect],
  );

  if (floatingPaste || !selectionRect || !marqueeScreenRect) {
    return null;
  }

  const { left, top, width, height } = marqueeScreenRect;
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  return (
    <div
      ref={overlayRef}
      data-testid="selection-marquee-overlay"
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
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

        const interactiveProps = canInteract
          ? {
              onPointerDown: handleResizePointerDown(handle),
              style: {
                cursor: handleCursor(handle),
                pointerEvents: 'auto' as const,
              },
            }
          : {
              onPointerDown: undefined,
              style: {
                cursor: 'default',
                pointerEvents: 'none' as const,
              },
            };

        return (
          <div
            key={handle}
            role="presentation"
            data-handle={handle}
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
              ...interactiveProps.style,
            }}
            onPointerDown={interactiveProps.onPointerDown}
          />
        );
      })}
    </div>
  );
};

export default SelectionMarqueeHandles;
