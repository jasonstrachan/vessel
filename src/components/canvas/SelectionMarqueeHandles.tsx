'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectFloatingPaste, selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import type { Rectangle } from '@/types';
import {
  computeFloatingPasteResize,
  computeFloatingPasteRotation,
} from './floatingPasteTransform';
import {
  HANDLE_SIZE,
  handleDefinitions,
  handleCursor,
  resizeRectFromDrag,
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
  | { type: 'resizing'; handle: RectHandle; start: Point; initialRect: Rectangle }
  | { type: 'floating-resize'; handle: RectHandle; start: Point; initialRect: Rectangle }
  | { type: 'floating-rotate'; start: Point; initialRect: Rectangle; initialRotation: number };

const SelectionMarqueeHandles: React.FC<SelectionMarqueeHandlesProps> = ({
  zoom,
  offsetX,
  offsetY,
  projectWidth,
  projectHeight,
}) => {
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const selectionMask = useAppStore((state) => state.selectionMask);
  const selectionMaskBounds = useAppStore((state) => state.selectionMaskBounds);
  const floatingPaste = useAppStore(selectFloatingPaste);
  const canRotateSelection = useAppStore((state) => {
    const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
    return activeLayer?.layerType !== 'color-cycle';
  });
  const setSelectionBounds = useAppStore((state) => state.setSelectionBounds);
  const extractSelectionToFloatingPaste = useAppStore((state) => state.extractSelectionToFloatingPaste);
  const updateFloatingPasteRect = useAppStore((state) => state.updateFloatingPasteRect);
  const updateFloatingPasteRotation = useAppStore((state) => state.updateFloatingPasteRotation);
  const [isFloatingHandoffActive, setIsFloatingHandoffActive] = useState(false);

  const selectionRect = useMemo(() => {
    if (selectionMask && selectionMaskBounds) {
      if (selectionMaskBounds.width <= 0 || selectionMaskBounds.height <= 0) {
        return null;
      }
      return {
        x: selectionMaskBounds.x,
        y: selectionMaskBounds.y,
        width: selectionMaskBounds.width,
        height: selectionMaskBounds.height,
      } satisfies Rectangle;
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
  }, [selectionEnd, selectionMask, selectionMaskBounds, selectionStart]);

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

  const canInteract =
    !floatingPaste &&
    Boolean(selectionRect) &&
    projectWidth > 0 &&
    projectHeight > 0;
  const canTrackPointer = canInteract || isFloatingHandoffActive;

  const getWorldPoint = useCallback(
    (event: PointerEvent | React.PointerEvent<Element>): Point | null => {
      const overlayEl = overlayRef.current;
      if (!overlayEl || !canTrackPointer) {
        return null;
      }

      const rect = overlayEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const safeZoom = zoom || 1;

      const worldX = Math.round((localX - offsetX) / safeZoom);
      const worldY = Math.round((localY - offsetY) / safeZoom);

      return { x: worldX, y: worldY };
    },
    [canTrackPointer, offsetX, offsetY, zoom],
  );

  const applyRectUpdate = useCallback(
    (rect: Rectangle) => {
      setSelectionBounds(
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        'selection-handle',
      );
    },
    [setSelectionBounds],
  );

  const finalizeInteraction = useCallback((pointerId: number) => {
    const overlayEl = overlayRef.current;
    const interaction = interactionRef.current;
    interactionRef.current = { type: 'idle' };
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

    if (interaction.type === 'floating-resize' || interaction.type === 'floating-rotate') {
      setIsFloatingHandoffActive(false);
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (interactionRef.current.type === 'idle') {
        return;
      }
      finalizeInteraction(event.pointerId);
      event.preventDefault();
    },
    [finalizeInteraction],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (interactionRef.current.type === 'idle') {
        return;
      }
      finalizeInteraction(event.pointerId);
    },
    [finalizeInteraction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current;
      if (interaction.type === 'idle') {
        return;
      }

      const worldPoint = getWorldPoint(event.nativeEvent);
      if (!worldPoint) {
        return;
      }

      if (interaction.type === 'resizing') {
        if (!canInteract) {
          return;
        }
        const nextRect = resizeRectFromDrag(
          interaction.initialRect,
          interaction.handle,
          interaction.start,
          worldPoint,
          projectWidth,
          projectHeight,
          { clampToBounds: false },
        );
        const currentRect = selectionRectRef.current;
        if (currentRect && rectEquals(currentRect, nextRect)) {
          return;
        }
        applyRectUpdate(nextRect);
      } else if (interaction.type === 'floating-resize') {
        const nextRect = computeFloatingPasteResize({
          initialRect: interaction.initialRect,
          handle: interaction.handle,
          start: interaction.start,
          current: worldPoint,
          rotation: 0,
        });
        updateFloatingPasteRect(nextRect);
      } else {
        updateFloatingPasteRotation(computeFloatingPasteRotation({
          rect: interaction.initialRect,
          start: interaction.start,
          current: worldPoint,
          initialRotation: interaction.initialRotation,
          snapIncrement: event.shiftKey ? 15 : undefined,
        }));
      }
      event.preventDefault();
    },
    [
      applyRectUpdate,
      canInteract,
      getWorldPoint,
      projectHeight,
      projectWidth,
      updateFloatingPasteRect,
      updateFloatingPasteRotation,
    ],
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

      overlayEl.setPointerCapture?.(event.pointerId);
      setIsFloatingHandoffActive(true);
      const extracted = extractSelectionToFloatingPaste();
      if (extracted) {
        interactionRef.current = {
          type: 'floating-resize',
          handle,
          start: worldPoint,
          initialRect: selectionRect,
        };
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      setIsFloatingHandoffActive(false);
      beforeSelectionRef.current = beforeSelectionRef.current ?? captureSelectionSnapshot();
      interactionRef.current = {
        type: 'resizing',
        handle,
        start: worldPoint,
        initialRect: selectionRect,
      };
      event.preventDefault();
      event.stopPropagation();
    },
    [canInteract, extractSelectionToFloatingPaste, getWorldPoint, selectionRect],
  );

  const handleRotatePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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

      overlayEl.setPointerCapture?.(event.pointerId);
      setIsFloatingHandoffActive(true);
      const extracted = extractSelectionToFloatingPaste();
      if (extracted) {
        interactionRef.current = {
          type: 'floating-rotate',
          start: worldPoint,
          initialRect: selectionRect,
          initialRotation: 0,
        };
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      setIsFloatingHandoffActive(false);
      if (overlayEl.hasPointerCapture?.(event.pointerId)) {
        overlayEl.releasePointerCapture(event.pointerId);
      }
    },
    [canInteract, extractSelectionToFloatingPaste, getWorldPoint, selectionRect],
  );

  if (isFloatingHandoffActive) {
    return (
      <div
        ref={overlayRef}
        data-testid="selection-marquee-overlay"
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 5 }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
      />
    );
  }

  if (floatingPaste || !selectionRect || !marqueeScreenRect) {
    return null;
  }

  const { left, top, width, height } = marqueeScreenRect;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const rotateHandleOffset = 26;
  const rotateHandleSize = 12;

  return (
    <div
      ref={overlayRef}
      data-testid="selection-marquee-overlay"
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
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
      {canRotateSelection ? (
        <>
          <div
            style={{
              position: 'absolute' as const,
              left: centerX,
              top: top - rotateHandleOffset + rotateHandleSize / 2,
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
            data-handle="rotate"
            style={{
              position: 'absolute' as const,
              width: rotateHandleSize,
              height: rotateHandleSize,
              left: centerX - rotateHandleSize / 2,
              top: top - rotateHandleOffset,
              backgroundColor: '#FFFFFF',
              border: '1px solid #0F172A',
              borderRadius: '999px',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.35)',
              cursor: 'grab',
              pointerEvents: canInteract ? ('auto' as const) : ('none' as const),
            }}
            onPointerDown={canInteract ? handleRotatePointerDown : undefined}
          />
        </>
      ) : null}
    </div>
  );
};

export default SelectionMarqueeHandles;
