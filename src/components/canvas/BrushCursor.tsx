'use client';

import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { BrushShape } from '../../types';
import type { BrushCursorDescriptor } from './useDrawingCanvasCursorModel';

interface BrushCursorProps {
  descriptor: BrushCursorDescriptor;
  zoom: number;
  visible: boolean;
}

export interface BrushCursorHandle {
  setPosition: (screenX: number, screenY: number) => void;
}

// Cache for cursor data URLs to prevent recreation
const cursorCache = new Map<string, string>();
const customBrushCursorCache = new WeakMap<ImageData, string>();

const useCursorAssetDataURL = (
  descriptor: BrushCursorDescriptor,
  screenWidth: number,
  screenHeight: number
) => {
  return useMemo(() => {
    if (typeof document === 'undefined') {
      return null;
    }

    if (descriptor.kind === 'custom-brush') {
      if (!descriptor.imageData) {
        return null;
      }

      const cached = customBrushCursorCache.get(descriptor.imageData);
      if (cached) {
        return cached;
      }

      const canvas = document.createElement('canvas');
      canvas.width = descriptor.imageData.width;
      canvas.height = descriptor.imageData.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return null;
      }

      ctx.putImageData(descriptor.imageData, 0, 0);
      const dataUrl = canvas.toDataURL();
      customBrushCursorCache.set(descriptor.imageData, dataUrl);
      return dataUrl;
    }

    const screenSize = Math.max(screenWidth, screenHeight);
    const cacheKey = `${descriptor.shape}-${Math.ceil(screenSize)}`;
    const cached = cursorCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement('canvas');
    const size = Math.ceil(screenSize);
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });

    if (!ctx) {
      return '';
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;

    const center = size / 2;
    const radius = Math.max(0.5, (screenSize - ctx.lineWidth) / 2);

    ctx.beginPath();

    switch (descriptor.shape) {
      case BrushShape.ROUND:
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        break;
      case BrushShape.SQUARE:
      case BrushShape.PIXEL_ROUND:
      case BrushShape.PIXEL_DITHER:
      case BrushShape.RECTANGLE_GRADIENT:
      case BrushShape.RESAMPLER:
      case BrushShape.MOSAIC:
      case BrushShape.COLOR_CYCLE:
        ctx.rect(center - radius, center - radius, screenSize - ctx.lineWidth, screenSize - ctx.lineWidth);
        break;
      case BrushShape.COLOR_CYCLE_TRIANGLE:
        ctx.moveTo(center, center - radius);
        ctx.lineTo(center - radius, center + radius);
        ctx.lineTo(center + radius, center + radius);
        ctx.closePath();
        break;
      case BrushShape.TRIANGLE:
      case BrushShape.POLYGON_GRADIENT:
      case BrushShape.COLOR_CYCLE_SHAPE: {
        const sides = 6;
        ctx.moveTo(center + radius, center);
        for (let i = 1; i <= sides; i++) {
          const angle = (i * 2 * Math.PI) / sides;
          ctx.lineTo(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
        }
        ctx.closePath();
        break;
      }
    }

    ctx.stroke();
    const dataUrl = canvas.toDataURL();
    if (cursorCache.size > 50) {
      const firstKey = cursorCache.keys().next().value;
      if (firstKey !== undefined) {
        cursorCache.delete(firstKey);
      }
    }
    cursorCache.set(cacheKey, dataUrl);
    return dataUrl;
  }, [descriptor, screenHeight, screenWidth]);
};

const BrushCursorComponent = ({
  descriptor,
  zoom,
  visible,
}: BrushCursorProps, ref: React.Ref<BrushCursorHandle>) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const isCustomBrushCursor = descriptor.kind === 'custom-brush';
  const baseCursorWidth = Math.max(
    1,
    isCustomBrushCursor ? descriptor.pixelWidth : descriptor.pixelSize
  );
  const baseCursorHeight = Math.max(
    1,
    isCustomBrushCursor ? descriptor.pixelHeight : descriptor.pixelSize
  );
  const screenWidth = Math.max(4, baseCursorWidth * zoom);
  const screenHeight = Math.max(4, baseCursorHeight * zoom);
  const cursorDataURL = useCursorAssetDataURL(descriptor, screenWidth, screenHeight);

  const applyTransform = useCallback((screenX: number, screenY: number) => {
    lastPositionRef.current = { x: screenX, y: screenY };
    const element = cursorRef.current;
    if (!element) return;

    const halfWidth = Math.ceil(screenWidth) / 2;
    const halfHeight = Math.ceil(screenHeight) / 2;
    element.style.transform = `translate(${screenX - halfWidth}px, ${screenY - halfHeight}px)`;
  }, [screenHeight, screenWidth]);

  useImperativeHandle(ref, () => ({
    setPosition: (screenX: number, screenY: number) => {
      applyTransform(screenX, screenY);
    }
  }), [applyTransform]);

  useLayoutEffect(() => {
    if (!visible) return;
    const { x, y } = lastPositionRef.current;
    applyTransform(x, y);
  }, [applyTransform, visible]);

  if (!visible) return null;

  if (isCustomBrushCursor) {
    return (
      <div
        ref={cursorRef}
        className="pointer-events-none fixed"
        style={{
          left: 0,
          top: 0,
          width: `${Math.ceil(screenWidth)}px`,
          height: `${Math.ceil(screenHeight)}px`,
          zIndex: 1000,
          mixBlendMode: 'difference',
          backgroundImage: cursorDataURL ? `url(${cursorDataURL})` : 'none',
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          imageRendering: 'pixelated',
          outline: '1px solid white',
          outlineOffset: '1px',
        }}
      />
    );
  }

  // Render the fast, pre-baked cursor image for default brushes
  return (
    <div
      ref={cursorRef}
      className="pointer-events-none fixed"
      style={{
        left: 0,
        top: 0,
        width: `${Math.ceil(screenWidth)}px`,
        height: `${Math.ceil(screenHeight)}px`,
        zIndex: 1000,
        mixBlendMode: 'difference',
        imageRendering: 'pixelated',
        backgroundImage: cursorDataURL ? `url(${cursorDataURL})` : 'none',
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }}
    />
  );
};

const BrushCursor = memo(forwardRef<BrushCursorHandle, BrushCursorProps>(BrushCursorComponent));

export default BrushCursor;
