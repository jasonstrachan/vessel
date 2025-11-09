'use client';

import React, { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { selectFloatingPaste, selectSelectionRects } from '@/stores/selectors/pasteSelectors';
import { HANDLE_SIZE, handleDefinitions } from './RectHandles';

interface SelectionMarqueeHandlesProps {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const SelectionMarqueeHandles: React.FC<SelectionMarqueeHandlesProps> = ({ zoom, offsetX, offsetY }) => {
  const { selectionStart, selectionEnd } = useAppStore(selectSelectionRects);
  const floatingPaste = useAppStore(selectFloatingPaste);

  const marqueeScreenRect = useMemo(() => {
    if (!selectionStart || !selectionEnd) {
      return null;
    }

    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);
    if (width <= 0 || height <= 0) {
      return null;
    }

    const safeZoom = zoom || 1;
    const left = Math.min(selectionStart.x, selectionEnd.x) * safeZoom + offsetX;
    const top = Math.min(selectionStart.y, selectionEnd.y) * safeZoom + offsetY;
    return {
      left,
      top,
      width: Math.max(width * safeZoom, 1),
      height: Math.max(height * safeZoom, 1),
    };
  }, [offsetX, offsetY, selectionEnd, selectionStart, zoom]);

  if (floatingPaste || !marqueeScreenRect) {
    return null;
  }

  const { left, top, width, height } = marqueeScreenRect;
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
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
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </div>
  );
};

export default SelectionMarqueeHandles;
