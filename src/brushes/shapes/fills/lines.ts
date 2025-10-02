import {
  generateContourLines,
  MAX_LINE_SPACING,
  MIN_LINE_SPACING,
  prepareContourLinesBasis,
} from '@/utils/contourLines';
import { clamp } from '@/utils/num';

import { resolveCoordinateSnap } from './common';
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

  const clampSpacing = (value: number) => clamp(value, MIN_LINE_SPACING, MAX_LINE_SPACING);
  const spacingA = clampSpacing(lineOptions?.lineSpacingA ?? (brushSettings.contourSpacing || 5) * 2);
  const spacingB = clampSpacing(lineOptions?.lineSpacingB ?? spacingA);
  const basis = lineOptions?.lineBasis ?? prepareContourLinesBasis(vertices);

  if (!basis) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);

  ctx.strokeStyle = brushSettings.color;
  ctx.lineWidth = lineWidth;
  ctx.imageSmoothingEnabled = !pixelMode;

  const lines = generateContourLines(vertices, basis, spacingA, spacingB);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
  }
  ctx.closePath();
  ctx.clip();

  for (const path of lines) {
    if (!path.points || path.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(snap(path.points[0].x), snap(path.points[0].y));
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(snap(path.points[i].x), snap(path.points[i].y));
    }
    ctx.stroke();
  }

  ctx.restore();
};
