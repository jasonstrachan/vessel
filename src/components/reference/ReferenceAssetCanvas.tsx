'use client';

import React from 'react';

import { getReferenceAssetDisplayBounds } from '@/referenceStudio/referenceAssets';
import type { ReferenceAsset } from '@/types';

interface ReferenceAssetCanvasProps {
  asset: ReferenceAsset;
  originX: number;
  originY: number;
  viewScale: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ReferenceAsset>) => void;
}

export const ReferenceAssetCanvas = ({
  asset,
  originX,
  originY,
  viewScale,
  selected,
  onSelect,
  onUpdate,
}: ReferenceAssetCanvasProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const bounds = getReferenceAssetDisplayBounds(asset);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof Image === 'undefined') return;
    const image = new Image();
    image.onload = () => {
      const sourceX = Math.round(asset.crop.x * asset.naturalWidth);
      const sourceY = Math.round(asset.crop.y * asset.naturalHeight);
      const sourceWidth = Math.max(1, Math.round(asset.crop.width * asset.naturalWidth));
      const sourceHeight = Math.max(1, Math.round(asset.crop.height * asset.naturalHeight));
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, sourceWidth, sourceHeight);
      context.save();
      context.translate(asset.flipX ? sourceWidth : 0, asset.flipY ? sourceHeight : 0);
      context.scale(asset.flipX ? -1 : 1, asset.flipY ? -1 : 1);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      context.restore();
    };
    image.src = asset.dataUrl;
  }, [asset.crop, asset.dataUrl, asset.flipX, asset.flipY, asset.naturalHeight, asset.naturalWidth]);

  if (!asset.visible) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${asset.name}${asset.locked ? ', locked' : ''}`}
      data-testid={`reference-asset-${asset.id}`}
      className={`absolute touch-none select-none border ${
        selected ? 'border-[#F2F2F2]' : 'border-transparent hover:border-[#8A8A8A]'
      } ${asset.locked ? 'cursor-default' : 'cursor-move'}`}
      style={{
        left: originX + bounds.x * viewScale,
        top: originY + bounds.y * viewScale,
        width: Math.max(1, bounds.width * viewScale),
        height: Math.max(1, bounds.height * viewScale),
        opacity: asset.opacity,
        zIndex: selected ? 3 : 2,
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
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onUpdate(asset.id, {
          x: drag.x + (event.clientX - drag.clientX) / viewScale,
          y: drag.y + (event.clientY - drag.clientY) / viewScale,
        });
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      {selected ? (
        <span className="absolute left-0 top-0 bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
          {asset.name}
        </span>
      ) : null}
    </div>
  );
};
