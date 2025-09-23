import {
  generateContourLines,
  MAX_LINE_SPACING,
  MIN_LINE_SPACING,
  prepareContourLinesBasis,
} from '@/utils/contourLines';

import { snapToPixel } from './common';
import type { LinesFillParams } from './types';

export const drawLinesFill = ({
  ctx,
  vertices,
  brushSettings,
  lineOptions,
}: LinesFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const clampSpacing = (value: number) => Math.min(MAX_LINE_SPACING, Math.max(MIN_LINE_SPACING, value));
  const spacingA = clampSpacing(lineOptions?.lineSpacingA ?? (brushSettings.contourSpacing || 5) * 2);
  const spacingB = clampSpacing(lineOptions?.lineSpacingB ?? spacingA);
  const basis = lineOptions?.lineBasis ?? prepareContourLinesBasis(vertices);

  if (!basis) {
    return;
  }

  ctx.strokeStyle = brushSettings.color;
  ctx.lineWidth = 1;
  ctx.imageSmoothingEnabled = false;

  const lines = generateContourLines(vertices, basis, spacingA, spacingB);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(snapToPixel(vertices[0].x), snapToPixel(vertices[0].y));
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(snapToPixel(vertices[i].x), snapToPixel(vertices[i].y));
  }
  ctx.closePath();
  ctx.clip();

  for (const path of lines) {
    if (!path.points || path.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(snapToPixel(path.points[0].x), snapToPixel(path.points[0].y));
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(snapToPixel(path.points[i].x), snapToPixel(path.points[i].y));
    }
    ctx.stroke();
  }

  ctx.restore();
};
