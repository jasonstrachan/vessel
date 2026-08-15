'use client';

import React from 'react';

import {
  getReferenceAssetDisplayBounds,
  getReferenceAssetSourceRect,
} from '@/referenceStudio/referenceAssets';
import type { ReferenceAsset } from '@/types';

interface ReferenceAssetCanvasProps {
  asset: ReferenceAsset;
  originX: number;
  originY: number;
  viewScale: number;
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

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${asset.name}${asset.locked ? ', locked' : ''}`}
      data-testid={`reference-asset-${asset.id}`}
      className={`absolute touch-none select-none focus:outline-none ${asset.locked ? 'cursor-default' : 'cursor-move'}`}
      style={{
        left: originX + bounds.x * viewScale,
        top: originY + bounds.y * viewScale,
        width: Math.max(1, bounds.width * viewScale),
        height: Math.max(1, bounds.height * viewScale),
        opacity: asset.opacity,
        zIndex: 2,
      }}
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
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
    </div>
  );
};
