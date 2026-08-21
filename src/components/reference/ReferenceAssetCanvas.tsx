'use client';

import React from 'react';

import {
  MAX_REFERENCE_ASSET_SCALE,
  MIN_REFERENCE_ASSET_SCALE,
  getReferenceAssetDisplayBounds,
  getReferenceAssetSourceRect,
} from '@/referenceStudio/referenceAssets';
import { applyLiquifyPushToContext } from '@/referenceStudio/referenceLiquify';
import type { ReferenceAsset } from '@/types';

type ResizeHandle = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

const resizeHandles: Array<{
  handle: ResizeHandle;
  className: string;
  cursor: string;
  directionX: -1 | 1;
  directionY: -1 | 1;
}> = [
  {
    handle: 'top-left',
    className: '-left-1.5 -top-1.5',
    cursor: 'nwse-resize',
    directionX: -1,
    directionY: -1,
  },
  {
    handle: 'top-right',
    className: '-right-1.5 -top-1.5',
    cursor: 'nesw-resize',
    directionX: 1,
    directionY: -1,
  },
  {
    handle: 'bottom-right',
    className: '-bottom-1.5 -right-1.5',
    cursor: 'nwse-resize',
    directionX: 1,
    directionY: 1,
  },
  {
    handle: 'bottom-left',
    className: '-bottom-1.5 -left-1.5',
    cursor: 'nesw-resize',
    directionX: -1,
    directionY: 1,
  },
];

interface ReferenceAssetCanvasProps {
  asset: ReferenceAsset;
  originX: number;
  originY: number;
  viewScale: number;
  isSelected: boolean;
  isLiquifyActive: boolean;
  liquifySize: number;
  liquifyStrength: number;
  onSelect: (id: string) => void;
  onPreview: (id: string, updates: Partial<ReferenceAsset>) => void;
  onCommit: (id: string, updates: Partial<ReferenceAsset>) => void;
  onClearPreview: (id: string) => void;
  onError?: (message: string) => void;
}

export const ReferenceAssetCanvas = ({
  asset,
  originX,
  originY,
  viewScale,
  isSelected,
  isLiquifyActive,
  liquifySize,
  liquifyStrength,
  onSelect,
  onPreview,
  onCommit,
  onClearPreview,
  onError,
}: ReferenceAssetCanvasProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sourceDataUrlRef = React.useRef<string | null>(null);
  const imageLoadRevisionRef = React.useRef(0);
  const [liquifyCursor, setLiquifyCursor] = React.useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    latestX: number;
    latestY: number;
  } | null>(null);
  const resizeRef = React.useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    anchorX: number;
    anchorY: number;
    directionX: -1 | 1;
    directionY: -1 | 1;
    width: number;
    height: number;
    x: number;
    y: number;
    scale: number;
    latestX: number;
    latestY: number;
    latestScale: number;
  } | null>(null);
  const liquifyRef = React.useRef<{
    pointerId: number;
    sourceX: number;
    sourceY: number;
    didChange: boolean;
  } | null>(null);
  const bounds = getReferenceAssetDisplayBounds(asset);

  const drawDisplayCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    if (!canvas || !sourceCanvas) return;
    const source = getReferenceAssetSourceRect({
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      crop: asset.crop,
    });
    if (canvas.width !== source.width) canvas.width = source.width;
    if (canvas.height !== source.height) canvas.height = source.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, source.width, source.height);
    context.save();
    context.translate(asset.flipX ? source.width : 0, asset.flipY ? source.height : 0);
    context.scale(asset.flipX ? -1 : 1, asset.flipY ? -1 : 1);
    context.drawImage(
      sourceCanvas,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      source.width,
      source.height,
    );
    context.restore();
  }, [asset.crop, asset.flipX, asset.flipY, asset.naturalHeight, asset.naturalWidth]);

  const loadSourceImage = React.useCallback((dataUrl: string) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    const revision = imageLoadRevisionRef.current + 1;
    imageLoadRevisionRef.current = revision;
    const image = new Image();
    image.onload = () => {
      if (imageLoadRevisionRef.current !== revision) return;
      const sourceCanvas = sourceCanvasRef.current ?? document.createElement('canvas');
      sourceCanvasRef.current = sourceCanvas;
      sourceCanvas.width = asset.naturalWidth;
      sourceCanvas.height = asset.naturalHeight;
      const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.clearRect(0, 0, asset.naturalWidth, asset.naturalHeight);
      context.drawImage(image, 0, 0, asset.naturalWidth, asset.naturalHeight);
      sourceDataUrlRef.current = dataUrl;
      drawDisplayCanvas();
    };
    image.onerror = () => {
      if (imageLoadRevisionRef.current === revision) {
        onError?.('Unable to decode the reference image.');
      }
    };
    image.src = dataUrl;
  }, [asset.naturalHeight, asset.naturalWidth, drawDisplayCanvas, onError]);

  React.useEffect(() => {
    if (sourceDataUrlRef.current === asset.dataUrl && sourceCanvasRef.current) {
      drawDisplayCanvas();
      return;
    }
    liquifyRef.current = null;
    loadSourceImage(asset.dataUrl);
    return () => {
      imageLoadRevisionRef.current += 1;
    };
  }, [asset.dataUrl, drawDisplayCanvas, loadSourceImage]);

  React.useEffect(() => {
    if (!isLiquifyActive) {
      liquifyRef.current = null;
      setLiquifyCursor(null);
    }
  }, [isLiquifyActive]);

  if (!asset.visible) return null;

  const finishDrag = (element: HTMLDivElement, pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    if (drag.latestX !== drag.x || drag.latestY !== drag.y) {
      onCommit(asset.id, { x: drag.latestX, y: drag.latestY });
    } else {
      onClearPreview(asset.id);
    }
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture can already be gone after cancellation or window blur.
    }
  };

  const finishResize = (element: HTMLDivElement, pointerId: number) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== pointerId) return;
    resizeRef.current = null;
    if (
      resize.latestX !== resize.x
      || resize.latestY !== resize.y
      || resize.latestScale !== resize.scale
    ) {
      onCommit(asset.id, {
        x: resize.latestX,
        y: resize.latestY,
        scale: resize.latestScale,
      });
    } else {
      onClearPreview(asset.id);
    }
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture can already be gone after cancellation or window blur.
    }
  };

  const readLiquifyPoint = (element: HTMLDivElement, clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const unitX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const unitY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const source = getReferenceAssetSourceRect(asset);
    const displayX = unitX * Math.max(0, source.width - 1);
    const displayY = unitY * Math.max(0, source.height - 1);
    return {
      sourceX: source.x + (asset.flipX ? source.width - 1 - displayX : displayX),
      sourceY: source.y + (asset.flipY ? source.height - 1 - displayY : displayY),
      cursor: {
        x: unitX * rect.width,
        y: unitY * rect.height,
        width: liquifySize * rect.width / source.width,
        height: liquifySize * rect.height / source.height,
      },
    };
  };

  const applyLiquifySegment = (sourceX: number, sourceY: number) => {
    const stroke = liquifyRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    const context = sourceCanvas?.getContext('2d', { willReadFrequently: true });
    if (!stroke || !sourceCanvas || !context) return;
    const deltaX = sourceX - stroke.sourceX;
    const deltaY = sourceY - stroke.sourceY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.01) return;
    const radius = Math.max(1, liquifySize / 2);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.25)));
    const stepX = deltaX / steps;
    const stepY = deltaY / steps;
    for (let step = 1; step <= steps; step += 1) {
      applyLiquifyPushToContext(
        context,
        sourceCanvas.width,
        sourceCanvas.height,
        {
          centerX: stroke.sourceX + stepX * step,
          centerY: stroke.sourceY + stepY * step,
          deltaX: stepX,
          deltaY: stepY,
          radius,
          strength: liquifyStrength,
        },
      );
    }
    stroke.sourceX = sourceX;
    stroke.sourceY = sourceY;
    stroke.didChange = true;
    drawDisplayCanvas();
  };

  const finishLiquify = (element: HTMLDivElement, pointerId: number) => {
    const stroke = liquifyRef.current;
    if (!stroke || stroke.pointerId !== pointerId) return;
    liquifyRef.current = null;
    const sourceCanvas = sourceCanvasRef.current;
    if (stroke.didChange && sourceCanvas) {
      try {
        const dataUrl = sourceCanvas.toDataURL('image/png');
        if (!dataUrl.startsWith('data:image/')) {
          throw new Error('Canvas encoding returned an invalid image.');
        }
        sourceDataUrlRef.current = dataUrl;
        onPreview(asset.id, { dataUrl });
        onCommit(asset.id, { dataUrl });
      } catch {
        sourceDataUrlRef.current = null;
        loadSourceImage(asset.dataUrl);
        onError?.('Unable to save the liquify stroke.');
      }
    }
    try {
      if (element.hasPointerCapture?.(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture can already be gone after cancellation or window blur.
    }
  };

  const positionStyle = {
    left: originX + bounds.x * viewScale,
    top: originY + bounds.y * viewScale,
    width: Math.max(1, bounds.width * viewScale),
    height: Math.max(1, bounds.height * viewScale),
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${asset.name}${asset.locked ? ', locked' : ''}`}
        data-testid={`reference-asset-${asset.id}`}
        data-reference-asset="true"
        data-liquify-active={isLiquifyActive ? 'true' : 'false'}
        className={`absolute touch-none select-none focus:outline-none ${asset.locked ? 'cursor-default' : isLiquifyActive ? 'cursor-none' : 'cursor-move'}`}
        style={{ ...positionStyle, zIndex: 2 }}
        onFocus={() => onSelect(asset.id)}
        onPointerDown={(event) => {
          onSelect(asset.id);
          if (asset.locked) return;
          if (isLiquifyActive) {
            const point = readLiquifyPoint(event.currentTarget, event.clientX, event.clientY);
            if (!point || !sourceCanvasRef.current) return;
            event.preventDefault();
            setLiquifyCursor(point.cursor);
            liquifyRef.current = {
              pointerId: event.pointerId,
              sourceX: point.sourceX,
              sourceY: point.sourceY,
              didChange: false,
            };
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              // Continue the stroke while the pointer remains over the image.
            }
            return;
          }
          dragRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            x: asset.x,
            y: asset.y,
            latestX: asset.x,
            latestY: asset.y,
          };
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // Continue the drag when pointer capture is unavailable.
          }
        }}
        onPointerMove={(event) => {
          if (isLiquifyActive && !asset.locked) {
            const point = readLiquifyPoint(event.currentTarget, event.clientX, event.clientY);
            if (!point) return;
            setLiquifyCursor(point.cursor);
            if (liquifyRef.current?.pointerId === event.pointerId) {
              event.preventDefault();
              applyLiquifySegment(point.sourceX, point.sourceY);
            }
            return;
          }
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.latestX = drag.x + (event.clientX - drag.clientX) / viewScale;
          drag.latestY = drag.y + (event.clientY - drag.clientY) / viewScale;
          onPreview(asset.id, { x: drag.latestX, y: drag.latestY });
        }}
        onPointerUp={(event) => {
          if (isLiquifyActive) {
            finishLiquify(event.currentTarget, event.pointerId);
            return;
          }
          finishDrag(event.currentTarget, event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (isLiquifyActive) {
            finishLiquify(event.currentTarget, event.pointerId);
            return;
          }
          finishDrag(event.currentTarget, event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          if (isLiquifyActive) {
            finishLiquify(event.currentTarget, event.pointerId);
            return;
          }
          finishDrag(event.currentTarget, event.pointerId);
        }}
        onPointerLeave={() => {
          if (!liquifyRef.current) setLiquifyCursor(null);
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ opacity: asset.opacity }}
          aria-hidden="true"
        />
        {isLiquifyActive && !asset.locked && liquifyCursor ? (
          <div
            className="pointer-events-none absolute border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
            data-testid={`reference-liquify-cursor-${asset.id}`}
            aria-hidden="true"
            style={{
              left: liquifyCursor.x - liquifyCursor.width / 2,
              top: liquifyCursor.y - liquifyCursor.height / 2,
              width: liquifyCursor.width,
              height: liquifyCursor.height,
              borderRadius: '50%',
            }}
          />
        ) : null}
      </div>
      {isSelected && !isLiquifyActive ? (
        <div
          className="pointer-events-none absolute touch-none select-none shadow-[inset_0_0_0_1px_#38BDF8]"
          data-testid={`reference-selection-${asset.id}`}
          aria-hidden="true"
          style={{ ...positionStyle, zIndex: 5 }}
        >
          {!asset.locked ? resizeHandles.map(({
            handle,
            className,
            cursor,
            directionX,
            directionY,
          }) => (
            <div
              key={handle}
              role="presentation"
              data-testid={`reference-resize-${handle}`}
              className={`pointer-events-auto absolute h-3 w-3 bg-white shadow-[inset_0_0_0_1px_#0F172A,0_1px_2px_rgba(15,23,42,0.35)] ${className}`}
              style={{ cursor }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(asset.id);
                resizeRef.current = {
                  pointerId: event.pointerId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  anchorX: bounds.x + (directionX < 0 ? bounds.width : 0),
                  anchorY: bounds.y + (directionY < 0 ? bounds.height : 0),
                  directionX,
                  directionY,
                  width: bounds.width,
                  height: bounds.height,
                  x: asset.x,
                  y: asset.y,
                  scale: asset.scale,
                  latestX: asset.x,
                  latestY: asset.y,
                  latestScale: asset.scale,
                };
                try {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                  // Continue resizing while the pointer remains over the handle.
                }
              }}
              onPointerMove={(event) => {
                const resize = resizeRef.current;
                if (!resize || resize.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const deltaX = (event.clientX - resize.clientX) / viewScale;
                const deltaY = (event.clientY - resize.clientY) / viewScale;
                const diagonalX = resize.directionX * resize.width;
                const diagonalY = resize.directionY * resize.height;
                const scaleFactor = (
                  diagonalX * (diagonalX + deltaX)
                  + diagonalY * (diagonalY + deltaY)
                ) / (resize.width ** 2 + resize.height ** 2);
                const nextScale = Math.max(
                  MIN_REFERENCE_ASSET_SCALE,
                  Math.min(MAX_REFERENCE_ASSET_SCALE, resize.scale * scaleFactor),
                );
                const nextWidth = resize.width * (nextScale / resize.scale);
                const nextHeight = resize.height * (nextScale / resize.scale);
                resize.latestScale = nextScale;
                resize.latestX = resize.directionX < 0
                  ? resize.anchorX - nextWidth
                  : resize.anchorX;
                resize.latestY = resize.directionY < 0
                  ? resize.anchorY - nextHeight
                  : resize.anchorY;
                onPreview(asset.id, {
                  x: resize.latestX,
                  y: resize.latestY,
                  scale: resize.latestScale,
                });
              }}
              onPointerUp={(event) => finishResize(event.currentTarget, event.pointerId)}
              onPointerCancel={(event) => finishResize(event.currentTarget, event.pointerId)}
              onLostPointerCapture={(event) => finishResize(event.currentTarget, event.pointerId)}
            />
          )) : null}
        </div>
      ) : null}
    </>
  );
};
