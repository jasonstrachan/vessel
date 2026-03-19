'use client';

import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
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

type CursorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const getDescriptorCacheKey = (descriptor: BrushCursorDescriptor): string => {
  if (descriptor.kind === 'custom-brush') {
    return `custom:${descriptor.pixelWidth}x${descriptor.pixelHeight}:${descriptor.pixelSize}`;
  }
  return `shape:${descriptor.shape}:${descriptor.pixelSize}`;
};

const getCursorScreenDimensions = (
  descriptor: BrushCursorDescriptor,
  zoom: number
) => ({
  width: Math.max(
    4,
    (descriptor.kind === 'custom-brush' ? descriptor.pixelWidth : descriptor.pixelSize) * zoom
  ),
  height: Math.max(
    4,
    (descriptor.kind === 'custom-brush' ? descriptor.pixelHeight : descriptor.pixelSize) * zoom
  ),
});

const getCursorRect = (
  centerX: number,
  centerY: number,
  width: number,
  height: number
): CursorRect => {
  const padding = 4;
  return {
    x: Math.floor(centerX - width / 2 - padding),
    y: Math.floor(centerY - height / 2 - padding),
    width: Math.ceil(width + padding * 2),
    height: Math.ceil(height + padding * 2),
  };
};

const drawShapeCursor = (
  ctx: CanvasRenderingContext2D,
  descriptor: BrushCursorDescriptor,
  centerX: number,
  centerY: number,
  screenWidth: number,
  screenHeight: number
) => {
  const halfWidth = screenWidth / 2;
  const halfHeight = screenHeight / 2;
  const lineOffset = 0.5;

  ctx.beginPath();

  if (descriptor.kind === 'custom-brush') {
    ctx.rect(
      Math.round(centerX - halfWidth) + lineOffset,
      Math.round(centerY - halfHeight) + lineOffset,
      Math.max(1, Math.round(screenWidth) - 1),
      Math.max(1, Math.round(screenHeight) - 1)
    );
    ctx.stroke();
    return;
  }

  switch (descriptor.shape) {
    case BrushShape.ROUND:
      ctx.arc(centerX, centerY, Math.max(0.5, (Math.min(screenWidth, screenHeight) - 1) / 2), 0, Math.PI * 2);
      break;
    case BrushShape.SQUARE:
    case BrushShape.PIXEL_ROUND:
    case BrushShape.PIXEL_DITHER:
    case BrushShape.RECTANGLE_GRADIENT:
    case BrushShape.RESAMPLER:
    case BrushShape.MOSAIC:
    case BrushShape.COLOR_CYCLE:
      ctx.rect(
        Math.round(centerX - halfWidth) + lineOffset,
        Math.round(centerY - halfHeight) + lineOffset,
        Math.max(1, Math.round(screenWidth) - 1),
        Math.max(1, Math.round(screenHeight) - 1)
      );
      break;
    case BrushShape.COLOR_CYCLE_TRIANGLE:
      ctx.moveTo(centerX, centerY - halfHeight);
      ctx.lineTo(centerX - halfWidth, centerY + halfHeight);
      ctx.lineTo(centerX + halfWidth, centerY + halfHeight);
      ctx.closePath();
      break;
    case BrushShape.TRIANGLE:
    case BrushShape.POLYGON_GRADIENT:
    case BrushShape.COLOR_CYCLE_SHAPE: {
      const radius = Math.min(screenWidth, screenHeight) / 2;
      const sides = 6;
      ctx.moveTo(centerX + radius, centerY);
      for (let i = 1; i <= sides; i += 1) {
        const angle = (i * 2 * Math.PI) / sides;
        ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
      }
      ctx.closePath();
      break;
    }
  }

  ctx.stroke();
};

const BrushCursorComponent = ({
  descriptor,
  zoom,
  visible,
}: BrushCursorProps, ref: React.Ref<BrushCursorHandle>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPaintedRectRef = useRef<CursorRect | null>(null);
  const dprRef = useRef(1);
  const lastZoomRef = useRef<number | null>(null);
  const lastVisibleRef = useRef<boolean | null>(null);
  const lastDescriptorKeyRef = useRef<string | null>(null);

  const paintCursor = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const width = canvas.width / dprRef.current;
    const height = canvas.height / dprRef.current;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    const descriptorKey = getDescriptorCacheKey(descriptor);
    const shouldClearWholeCanvas =
      lastZoomRef.current !== zoom ||
      lastVisibleRef.current !== visible ||
      lastDescriptorKeyRef.current !== descriptorKey;

    if (shouldClearWholeCanvas) {
      ctx.clearRect(0, 0, width, height);
      lastPaintedRectRef.current = null;
    }

    const previousRect = lastPaintedRectRef.current;
    if (previousRect) {
      ctx.clearRect(previousRect.x, previousRect.y, previousRect.width, previousRect.height);
      lastPaintedRectRef.current = null;
    }

    lastZoomRef.current = zoom;
    lastVisibleRef.current = visible;
    lastDescriptorKeyRef.current = descriptorKey;

    if (!visible) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const centerX = lastPositionRef.current.x - rect.left;
    const centerY = lastPositionRef.current.y - rect.top;
    const { width: screenWidth, height: screenHeight } =
      getCursorScreenDimensions(descriptor, zoom);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.imageSmoothingEnabled = false;

    drawShapeCursor(ctx, descriptor, centerX, centerY, screenWidth, screenHeight);
    lastPaintedRectRef.current = getCursorRect(centerX, centerY, screenWidth, screenHeight);
  }, [descriptor, visible, zoom]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const nextDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * nextDpr));
    const nextHeight = Math.max(1, Math.round(rect.height * nextDpr));

    dprRef.current = nextDpr;
    if (canvas.width !== nextWidth) {
      canvas.width = nextWidth;
    }
    if (canvas.height !== nextHeight) {
      canvas.height = nextHeight;
    }
    lastPaintedRectRef.current = null;

    paintCursor();
  }, [paintCursor]);

  useImperativeHandle(ref, () => ({
    setPosition: (screenX: number, screenY: number) => {
      lastPositionRef.current = { x: screenX, y: screenY };
      paintCursor();
    },
  }), [paintCursor]);

  useLayoutEffect(() => {
    resizeCanvas();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [resizeCanvas]);

  useLayoutEffect(() => {
    paintCursor();
  }, [paintCursor]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
        zIndex: 1000,
      }}
      aria-hidden="true"
    />
  );
};

const BrushCursor = memo(forwardRef<BrushCursorHandle, BrushCursorProps>(BrushCursorComponent));

export default BrushCursor;
