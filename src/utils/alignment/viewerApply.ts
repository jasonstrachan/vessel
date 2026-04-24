import { __DEV__, debugWarn } from '@/utils/debug';

import { computePlacement } from './alignFitCore';
import type { BasisInput, Placement, Rect, Size } from './alignFitCore';
import { normalizeAlign } from './normalizeAlign';
import type { RawAlignInput } from './normalizeAlign';

export interface DrawLayerOptions {
  surface: Size;
  painted: Size;
  paintedRect?: Rect;
  frame: Rect;
  design?: Size;
  doc: Size;
  alignRaw: unknown;
  autoOffsetPercent?: { x: number; y: number };
  isFixed: boolean;
  dpr: number;
}

export type DrawableSource = HTMLImageElement | HTMLCanvasElement;
export interface DrawLayerResult {
  ok: boolean;
  placement: Placement;
  destBacking: Rect;
  tileCanvas?: HTMLCanvasElement;
}

export function drawLayer(
  ctx: CanvasRenderingContext2D,
  source: DrawableSource,
  opts: DrawLayerOptions
): DrawLayerResult {
  const align = normalizeAlign(opts.alignRaw as RawAlignInput, opts.autoOffsetPercent);

  const surfaceWidth = Math.max(1, opts.surface.width);
  const surfaceHeight = Math.max(1, opts.surface.height);
  const paintedWidth = Math.max(1, opts.painted.width);
  const paintedHeight = Math.max(1, opts.painted.height);

  const painted = {
    width: paintedWidth,
    height: paintedHeight
  };

  if (painted.width > surfaceWidth || painted.height > surfaceHeight) {
    debugWarn('raw-console', '[align] painted exceeds surface; clamping');
    painted.width = Math.min(painted.width, surfaceWidth);
    painted.height = Math.min(painted.height, surfaceHeight);
  }

  const basis: BasisInput = {
    surface: { width: surfaceWidth, height: surfaceHeight },
    painted,
    frame: opts.frame,
    design: opts.design,
    doc: opts.doc,
    align
  };

  const placement = computePlacement(basis);
  const { dpr, isFixed } = opts;

  if (__DEV__ && !(placement.dest.width > 0 && placement.dest.height > 0)) {
    debugWarn('raw-console', '[align] non-positive dest size', {
      placement,
      alignRaw: opts.alignRaw,
      autoOffsetPercent: opts.autoOffsetPercent
    });
  }

  const toBackingPos = (value: number) => (isFixed ? Math.round(value * dpr) : Math.round(value));
  const toBackingSize = (value: number) => Math.max(1, isFixed ? Math.round(value * dpr) : Math.round(value));

  const destBacking: Rect = {
    x: toBackingPos(placement.dest.x),
    y: toBackingPos(placement.dest.y),
    width: toBackingSize(placement.dest.width),
    height: toBackingSize(placement.dest.height)
  };

  const fullSample = opts.paintedRect ?? {
    x: 0,
    y: 0,
    width: painted.width,
    height: painted.height
  };

  ctx.imageSmoothingEnabled = false;

  if (placement.tile) {
    const scaleFactor = isFixed ? dpr : 1;
    const tileWidth = Math.max(1, Math.round(fullSample.width * scaleFactor));
    const tileHeight = Math.max(1, Math.round(fullSample.height * scaleFactor));

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileWidth;
    tileCanvas.height = tileHeight;

    const tileCtx = tileCanvas.getContext('2d', { alpha: true });
    if (!tileCtx) {
      return { ok: false, placement, destBacking };
    }

    tileCtx.imageSmoothingEnabled = false;
    tileCtx.drawImage(
      source,
      fullSample.x,
      fullSample.y,
      fullSample.width,
      fullSample.height,
      0,
      0,
      tileWidth,
      tileHeight
    );

    const pattern = ctx.createPattern(tileCanvas, 'repeat');
    if (!pattern) {
      return { ok: false, placement, destBacking };
    }

    const phaseX = isFixed ? Math.round(placement.tile.phase.x * dpr) : Math.round(placement.tile.phase.x);
    const phaseY = isFixed ? Math.round(placement.tile.phase.y * dpr) : Math.round(placement.tile.phase.y);

    ctx.save();
    ctx.translate(-phaseX, -phaseY);
    ctx.fillStyle = pattern;
    ctx.fillRect(destBacking.x + phaseX, destBacking.y + phaseY, destBacking.width, destBacking.height);
    ctx.restore();

    return { ok: true, placement, destBacking, tileCanvas };
  }

  const destCss = placement.dest;
  let sampleRect = fullSample;

  if (align.fit === 'cover') {
    const sourceAspect = sampleRect.width / sampleRect.height;
    const targetAspect = Math.max(1e-6, destCss.width / destCss.height);

    if (sourceAspect < targetAspect) {
      const croppedHeight = Math.round(sampleRect.width / targetAspect);
      const offsetY = Math.round(sampleRect.y + (sampleRect.height - croppedHeight) / 2);
      sampleRect = { x: sampleRect.x, y: offsetY, width: sampleRect.width, height: croppedHeight };
    } else {
      const croppedWidth = Math.round(sampleRect.height * targetAspect);
      const offsetX = Math.round(sampleRect.x + (sampleRect.width - croppedWidth) / 2);
      sampleRect = { x: offsetX, y: sampleRect.y, width: croppedWidth, height: sampleRect.height };
    }
  }

  ctx.drawImage(
    source,
    sampleRect.x,
    sampleRect.y,
    sampleRect.width,
    sampleRect.height,
    destBacking.x,
    destBacking.y,
    destBacking.width,
    destBacking.height
  );

  return { ok: true, placement, destBacking };
}

export default drawLayer;
