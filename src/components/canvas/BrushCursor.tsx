'use client';

import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { BrushShape, type BrushSettings } from '@/types';
import { resolvePressureSizing } from '@/utils/pressureSizing';
import { getSelectionMaskContourPath } from '@/utils/selectionMaskContourPath';

import type { BrushCursorDescriptor } from './useDrawingCanvasCursorModel';

interface BrushCursorProps {
  descriptor: BrushCursorDescriptor;
  zoom: number;
  visible: boolean;
  participant?: { label: string; color: string };
}

export interface BrushCursorHandle {
  setPosition: (
    screenX: number,
    screenY: number,
    sample?: { pressure: number; isDrawing: boolean }
  ) => void;
}

type CursorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const STROKE_LINE_ANGLE_SMOOTHING = 0.35;
const CURSOR_OUTER_STROKE = 'rgba(0, 0, 0, 0.9)';
const CURSOR_INNER_STROKE = 'rgba(255, 255, 255, 0.95)';

const normalizeAngleDelta = (angle: number): number => {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
};

const smoothAngle = (current: number, target: number): number =>
  current + normalizeAngleDelta(target - current) * STROKE_LINE_ANGLE_SMOOTHING;

const getDescriptorCacheKey = (descriptor: BrushCursorDescriptor): string => {
  if (descriptor.kind === 'custom-brush') {
    return `custom:${descriptor.pixelWidth}x${descriptor.pixelHeight}:${descriptor.pixelSize}`;
  }
  if (descriptor.kind === 'stroke-line') {
    return `stroke-line:${descriptor.pixelSize}:${descriptor.rotationEnabled}:${descriptor.rotationRadians}`;
  }
  return [
    'shape',
    descriptor.shape,
    descriptor.pixelSize,
    descriptor.pixelWidth ?? '',
    descriptor.pixelHeight ?? '',
    descriptor.tipShape ?? '',
    descriptor.rotationEnabled ?? false,
  ].join(':');
};

const getEffectivePixelSize = (
  descriptor: BrushCursorDescriptor,
  pressure: number,
  isDrawing: boolean
): number => {
  if (!isDrawing || !descriptor.pressureSizing) {
    return descriptor.pixelSize;
  }
  const sizing = resolvePressureSizing(descriptor.pixelSize, {
    enabled: true,
    minPercent: descriptor.pressureSizing.minPercent,
    maxPercent: descriptor.pressureSizing.maxPercent,
  });
  return Math.max(1, Math.round(sizing.sample(pressure) * 2));
};

const getCursorScreenDimensions = (
  descriptor: BrushCursorDescriptor,
  zoom: number,
  effectivePixelSize: number
) => {
  const sizeScale = effectivePixelSize / Math.max(1, descriptor.pixelSize);
  const pixelWidth =
    descriptor.kind === 'custom-brush'
      ? descriptor.pixelWidth
      : descriptor.pixelWidth ?? descriptor.pixelSize;
  const pixelHeight =
    descriptor.kind === 'custom-brush'
      ? descriptor.pixelHeight
      : descriptor.pixelHeight ?? descriptor.pixelSize;
  return {
    width: Math.max(1, pixelWidth * sizeScale * zoom),
    height: Math.max(1, pixelHeight * sizeScale * zoom),
  };
};

const getRotatedDimensions = (
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } => {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
};

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

const drawMaskOutline = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  screenWidth: number,
  screenHeight: number,
  gridSize: number,
  isFilled: (row: number, col: number) => boolean
) => {
  const left = centerX - screenWidth / 2;
  const top = centerY - screenHeight / 2;
  const cellWidth = screenWidth / gridSize;
  const cellHeight = screenHeight / gridSize;

  const point = (col: number, row: number) => ({
    x: left + col * cellWidth,
    y: top + row * cellHeight,
  });

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      if (!isFilled(row, col)) {
        continue;
      }
      if (col === 0 || !isFilled(row, col - 1)) {
        const start = point(col, row);
        const end = point(col, row + 1);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
      if (col === gridSize - 1 || !isFilled(row, col + 1)) {
        const start = point(col + 1, row);
        const end = point(col + 1, row + 1);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
      if (row === 0 || !isFilled(row - 1, col)) {
        const start = point(col, row);
        const end = point(col + 1, row);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
      if (row === gridSize - 1 || !isFilled(row + 1, col)) {
        const start = point(col, row + 1);
        const end = point(col + 1, row + 1);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
    }
  }
};

const drawTipShapeCursor = (
  ctx: CanvasRenderingContext2D,
  tipShape: NonNullable<BrushSettings['ditherStrokeTipShape']>,
  centerX: number,
  centerY: number,
  screenWidth: number,
  screenHeight: number
): boolean => {
  const halfWidth = screenWidth / 2;
  const halfHeight = screenHeight / 2;

  if (tipShape === 'round') {
    ctx.ellipse(centerX, centerY, halfWidth, halfHeight, 0, 0, Math.PI * 2);
    return true;
  }
  if (tipShape === 'triangle') {
    ctx.moveTo(centerX, centerY - halfHeight);
    ctx.lineTo(centerX - halfWidth, centerY + halfHeight);
    ctx.lineTo(centerX + halfWidth, centerY + halfHeight);
    ctx.closePath();
    return true;
  }
  if (tipShape === 'diamond') {
    ctx.moveTo(centerX, centerY - halfHeight);
    ctx.lineTo(centerX + halfWidth, centerY);
    ctx.lineTo(centerX, centerY + halfHeight);
    ctx.lineTo(centerX - halfWidth, centerY);
    ctx.closePath();
    return true;
  }
  if (tipShape === 'checkered') {
    drawMaskOutline(
      ctx,
      centerX,
      centerY,
      screenWidth,
      screenHeight,
      4,
      (row, col) => (row + col) % 2 === 0
    );
    return true;
  }
  if (
    tipShape === 'diamond5' ||
    tipShape === 'diamond7' ||
    tipShape === 'diamond9'
  ) {
    const gridSize = tipShape === 'diamond9' ? 9 : tipShape === 'diamond7' ? 7 : 5;
    const centerCell = (gridSize - 1) / 2;
    drawMaskOutline(
      ctx,
      centerX,
      centerY,
      screenWidth,
      screenHeight,
      gridSize,
      (row, col) =>
        Math.abs(row - centerCell) + Math.abs(col - centerCell) <= centerCell
    );
    return true;
  }
  if (tipShape === 'square') {
    ctx.rect(centerX - halfWidth, centerY - halfHeight, screenWidth, screenHeight);
    return true;
  }
  return false;
};

const drawShapeCursor = (
  ctx: CanvasRenderingContext2D,
  descriptor: BrushCursorDescriptor,
  centerX: number,
  centerY: number,
  screenWidth: number,
  screenHeight: number,
  strokeLineRotationRadians: number
) => {
  const halfWidth = screenWidth / 2;
  const halfHeight = screenHeight / 2;
  const lineOffset = 0.5;

  ctx.beginPath();

  if (descriptor.kind === 'stroke-line') {
    const angle = strokeLineRotationRadians;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    const x0 = centerX - directionX * halfWidth;
    const y0 = centerY - directionY * halfWidth;
    const x1 = centerX + directionX * halfWidth;
    const y1 = centerY + directionY * halfWidth;
    const tick = Math.max(3, Math.min(12, screenHeight / 3));
    ctx.moveTo(Math.round(x0) + lineOffset, Math.round(y0) + lineOffset);
    ctx.lineTo(Math.round(x1) + lineOffset, Math.round(y1) + lineOffset);
    ctx.moveTo(
      Math.round(x0 - normalX * tick) + lineOffset,
      Math.round(y0 - normalY * tick) + lineOffset
    );
    ctx.lineTo(
      Math.round(x0 + normalX * tick) + lineOffset,
      Math.round(y0 + normalY * tick) + lineOffset
    );
    ctx.moveTo(
      Math.round(x1 - normalX * tick) + lineOffset,
      Math.round(y1 - normalY * tick) + lineOffset
    );
    ctx.lineTo(
      Math.round(x1 + normalX * tick) + lineOffset,
      Math.round(y1 + normalY * tick) + lineOffset
    );
    ctx.stroke();
    return;
  }

  if (descriptor.kind === 'custom-brush') {
    if (descriptor.imageData && typeof Path2D !== 'undefined') {
      const outline = getSelectionMaskContourPath(descriptor.imageData);
      const scaleX = screenWidth / Math.max(1, descriptor.imageData.width);
      const scaleY = screenHeight / Math.max(1, descriptor.imageData.height);
      const lineWidth = ctx.lineWidth;
      ctx.save();
      ctx.translate(centerX - screenWidth / 2, centerY - screenHeight / 2);
      ctx.scale(scaleX, scaleY);
      ctx.lineWidth = lineWidth / Math.max(scaleX, scaleY);
      ctx.stroke(outline);
      ctx.restore();
      return;
    }
    ctx.rect(
      Math.round(centerX - halfWidth) + lineOffset,
      Math.round(centerY - halfHeight) + lineOffset,
      Math.max(1, Math.round(screenWidth) - 1),
      Math.max(1, Math.round(screenHeight) - 1)
    );
    ctx.stroke();
    return;
  }

  if (
    descriptor.tipShape &&
    drawTipShapeCursor(
      ctx,
      descriptor.tipShape,
      centerX,
      centerY,
      screenWidth,
      screenHeight
    )
  ) {
    ctx.stroke();
    return;
  }

  switch (descriptor.shape) {
    case BrushShape.ROUND:
    case BrushShape.PIXEL_ROUND:
      ctx.ellipse(
        centerX,
        centerY,
        Math.max(0.5, (screenWidth - 1) / 2),
        Math.max(0.5, (screenHeight - 1) / 2),
        0,
        0,
        Math.PI * 2
      );
      break;
    case BrushShape.SQUARE:
    case BrushShape.PIXEL_DITHER:
    case BrushShape.RECTANGLE_GRADIENT:
    case BrushShape.RESAMPLER:
    case BrushShape.MOSAIC:
    case BrushShape.COLOR_CYCLE:
    case BrushShape.RISOGRAPH_SOFT:
    case BrushShape.RISOGRAPH_ULTRA:
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
  participant,
}: BrushCursorProps, ref: React.Ref<BrushCursorHandle>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasPositionRef = useRef(false);
  const strokeLineRotationRef = useRef(0);
  const hasStrokeLineDirectionRef = useRef(false);
  const pointerPressureRef = useRef(1);
  const isDrawingRef = useRef(false);
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
    const descriptorKey = `${getDescriptorCacheKey(descriptor)}:${participant?.label ?? ''}:${participant?.color ?? ''}`;
    const shouldClearWholeCanvas =
      lastZoomRef.current !== zoom ||
      lastVisibleRef.current !== visible ||
      lastDescriptorKeyRef.current !== descriptorKey;

    if (shouldClearWholeCanvas) {
      ctx.clearRect(0, 0, width, height);
      lastPaintedRectRef.current = null;
      strokeLineRotationRef.current =
        descriptor.kind === 'stroke-line'
          ? descriptor.rotationRadians
          : descriptor.initialRotationRadians ?? 0;
      hasStrokeLineDirectionRef.current = false;
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
    const effectivePixelSize = getEffectivePixelSize(
      descriptor,
      pointerPressureRef.current,
      isDrawingRef.current
    );
    const { width: screenWidth, height: screenHeight } =
      getCursorScreenDimensions(descriptor, zoom, effectivePixelSize);
    const cursorRotation =
      descriptor.kind === 'stroke-line' ? 0 : strokeLineRotationRef.current;
    const rotatedDimensions = getRotatedDimensions(
      screenWidth,
      screenHeight,
      cursorRotation
    );

    ctx.imageSmoothingEnabled = false;

    const drawCursorPass = (strokeStyle: string, lineWidth: number) => {
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      if (cursorRotation !== 0) {
        ctx.translate(centerX, centerY);
        ctx.rotate(cursorRotation);
        ctx.translate(-centerX, -centerY);
      }
      drawShapeCursor(
        ctx,
        descriptor,
        centerX,
        centerY,
        screenWidth,
        screenHeight,
        strokeLineRotationRef.current
      );
      ctx.restore();
    };

    drawCursorPass(CURSOR_OUTER_STROKE, 3);
    drawCursorPass(participant?.color ?? CURSOR_INNER_STROKE, participant ? 2 : 1);

    if (Math.max(screenWidth, screenHeight) < 4) {
      const drawCenterMarker = (strokeStyle: string, lineWidth: number) => {
        ctx.beginPath();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.moveTo(centerX - 2, centerY);
        ctx.lineTo(centerX + 2, centerY);
        ctx.moveTo(centerX, centerY - 2);
        ctx.lineTo(centerX, centerY + 2);
        ctx.stroke();
      };
      drawCenterMarker(CURSOR_OUTER_STROKE, 3);
      drawCenterMarker(participant?.color ?? CURSOR_INNER_STROKE, participant ? 2 : 1);
    }

    if (participant) {
      const labelX = centerX + Math.max(8, screenWidth / 2 + 5);
      const labelY = centerY + Math.max(12, screenHeight / 2 + 5);
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      const labelWidth = Math.ceil(ctx.measureText(participant.label).width) + 10;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillRect(labelX, labelY - 8, labelWidth, 16);
      ctx.fillStyle = participant.color;
      ctx.fillText(participant.label, labelX + 5, labelY);
    }

    lastPaintedRectRef.current = getCursorRect(
      centerX,
      centerY,
      Math.max(rotatedDimensions.width, participant ? 150 : 4),
      Math.max(rotatedDimensions.height, participant ? 54 : 4)
    );
  }, [descriptor, participant, visible, zoom]);

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
    setPosition: (screenX, screenY, sample) => {
      if (sample) {
        pointerPressureRef.current = sample.pressure;
        isDrawingRef.current = sample.isDrawing;
      }
      if (
        (descriptor.kind === 'stroke-line' || descriptor.rotationEnabled) &&
        hasPositionRef.current
      ) {
        const dx = screenX - lastPositionRef.current.x;
        const dy = screenY - lastPositionRef.current.y;
        if (Math.hypot(dx, dy) > 0.5) {
          const pointerAngle = Math.atan2(dy, dx);
          const rawTargetAngle =
            descriptor.kind === 'stroke-line'
              ? pointerAngle + Math.PI / 2
              : pointerAngle * (descriptor.rotationScale ?? 1) +
                (descriptor.rotationOffsetRadians ?? 0);
          const step = descriptor.rotationStepRadians;
          const targetLineAngle =
            step && step > 0
              ? Math.round(rawTargetAngle / step) * step
              : rawTargetAngle;
          strokeLineRotationRef.current =
            descriptor.kind === 'stroke-line' &&
            hasStrokeLineDirectionRef.current
              ? smoothAngle(strokeLineRotationRef.current, targetLineAngle)
              : targetLineAngle;
          hasStrokeLineDirectionRef.current = true;
        }
      }
      lastPositionRef.current = { x: screenX, y: screenY };
      hasPositionRef.current = true;
      paintCursor();
    },
  }), [descriptor, paintCursor]);

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
