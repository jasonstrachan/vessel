import type React from 'react';

interface VisibleWorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderCanvasBackgroundOptions {
  ctx: CanvasRenderingContext2D;
  visibleRect: VisibleWorldRect | null;
  project: { width: number; height: number };
  offsetX: number;
  offsetY: number;
  scale: number;
  displayWidth: number;
  displayHeight: number;
  checkerPatternCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  checkerPatternCacheRef: React.MutableRefObject<WeakMap<CanvasRenderingContext2D, CanvasPattern | null>>;
  transparencyBackgroundMode: 'checker' | 'gray';
  solidBackgroundColor: string;
  checkerLight: string;
  checkerDark: string;
}

export const renderCanvasBackground = ({
  ctx,
  visibleRect,
  project,
  offsetX,
  offsetY,
  scale,
  displayWidth,
  displayHeight,
  checkerPatternCanvasRef,
  checkerPatternCacheRef,
  transparencyBackgroundMode,
  solidBackgroundColor,
  checkerLight,
  checkerDark,
}: RenderCanvasBackgroundOptions): void => {
  if (transparencyBackgroundMode === 'gray') {
    if (visibleRect) {
      ctx.fillStyle = solidBackgroundColor;
      ctx.fillRect(visibleRect.x, visibleRect.y, visibleRect.width, visibleRect.height);
      return;
    }

    ctx.fillStyle = solidBackgroundColor;
    ctx.fillRect(0, 0, project.width, project.height);
    return;
  }

  const checkerSize = 10;
  const checkerTileSize = checkerSize * 2;

  if (!checkerPatternCanvasRef.current) {
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = checkerTileSize;
    patternCanvas.height = checkerTileSize;
    const patternCtx = patternCanvas.getContext('2d');
    if (patternCtx) {
      patternCtx.fillStyle = checkerLight;
      patternCtx.fillRect(0, 0, checkerTileSize, checkerTileSize);
      patternCtx.fillStyle = checkerDark;
      patternCtx.fillRect(0, 0, checkerSize, checkerSize);
      patternCtx.fillRect(checkerSize, checkerSize, checkerSize, checkerSize);
    }
    checkerPatternCanvasRef.current = patternCanvas;
  }

  let checkerPattern: CanvasPattern | null | undefined;
  if (checkerPatternCanvasRef.current) {
    checkerPattern = checkerPatternCacheRef.current.get(ctx);
    if (!checkerPattern) {
      checkerPattern = ctx.createPattern(checkerPatternCanvasRef.current, 'repeat');
      checkerPatternCacheRef.current.set(ctx, checkerPattern);
    }
  }

  if (checkerPattern && visibleRect) {
    ctx.fillStyle = checkerPattern;
    ctx.fillRect(visibleRect.x, visibleRect.y, visibleRect.width, visibleRect.height);
    return;
  }

  const startX =
    Math.floor(Math.max(0, -offsetX / scale) / (checkerSize * 2)) * (checkerSize * 2);
  const startY =
    Math.floor(Math.max(0, -offsetY / scale) / (checkerSize * 2)) * (checkerSize * 2);
  const endX = Math.min(project.width, Math.ceil((displayWidth - offsetX) / scale));
  const endY = Math.min(project.height, Math.ceil((displayHeight - offsetY) / scale));

  ctx.fillStyle = checkerLight;
  ctx.fillRect(0, 0, project.width, project.height);
  ctx.fillStyle = checkerDark;

  for (let x = startX; x < endX; x += checkerSize * 2) {
    for (let y = startY; y < endY; y += checkerSize * 2) {
      const w1 = Math.min(checkerSize, project.width - x);
      const h1 = Math.min(checkerSize, project.height - y);
      const w2 = Math.min(checkerSize, project.width - (x + checkerSize));
      const h2 = Math.min(checkerSize, project.height - (y + checkerSize));

      if (w1 > 0 && h1 > 0) ctx.fillRect(x, y, w1, h1);
      if (w2 > 0 && h2 > 0) ctx.fillRect(x + checkerSize, y + checkerSize, w2, h2);
    }
  }
};
