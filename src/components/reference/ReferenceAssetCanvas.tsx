'use client';

import React from 'react';

import {
  MAX_REFERENCE_ASSET_SCALE,
  MIN_REFERENCE_ASSET_SCALE,
  getReferenceAssetDisplayBounds,
  getReferenceAssetSourceRect,
} from '@/referenceStudio/referenceAssets';
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
  onSelect: (id: string) => void;
  onPreview: (id: string, updates: Partial<ReferenceAsset>) => void;
  onCommit: (id: string, updates: Partial<ReferenceAsset>) => void;
  onClearPreview: (id: string) => void;
}

export const ReferenceAssetCanvas = ({
  asset,
  originX,
  originY,
  viewScale,
  isSelected,
  onSelect,
  onPreview,
  onCommit,
  onClearPreview,
}: ReferenceAssetCanvasProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
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
  const bounds = getReferenceAssetDisplayBounds(asset);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof Image === 'undefined') return;
    const image = new Image();
    image.onload = () => {
      const source = getReferenceAssetSourceRect({
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        crop: asset.crop,
      });
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, source.width, source.height);
      context.save();
      context.translate(asset.flipX ? source.width : 0, asset.flipY ? source.height : 0);
      context.scale(asset.flipX ? -1 : 1, asset.flipY ? -1 : 1);
      context.drawImage(
        image,
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
    };
    image.src = asset.dataUrl;
  }, [asset.crop, asset.dataUrl, asset.flipX, asset.flipY, asset.naturalHeight, asset.naturalWidth]);

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
        className={`absolute touch-none select-none focus:outline-none ${asset.locked ? 'cursor-default' : 'cursor-move'}`}
        style={{ ...positionStyle, zIndex: 2 }}
        onFocus={() => onSelect(asset.id)}
        onPointerDown={(event) => {
          onSelect(asset.id);
          if (asset.locked) return;
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
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          drag.latestX = drag.x + (event.clientX - drag.clientX) / viewScale;
          drag.latestY = drag.y + (event.clientY - drag.clientY) / viewScale;
          onPreview(asset.id, { x: drag.latestX, y: drag.latestY });
        }}
        onPointerUp={(event) => finishDrag(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
        onLostPointerCapture={(event) => finishDrag(event.currentTarget, event.pointerId)}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ opacity: asset.opacity }}
          aria-hidden="true"
        />
      </div>
      {isSelected ? (
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
