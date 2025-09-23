import { computeLines2Defaults, generateLines2Paths } from '@/utils/contourLines';

import { snapToPixel } from './common';
import type { Lines2FillParams } from './types';

export const drawLines2Fill = ({
  ctx,
  vertices,
  brushSettings,
  lineOptions,
}: Lines2FillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const defaults = computeLines2Defaults(vertices, lineOptions?.lineBasis);
  const angle = lineOptions?.lines2Angle ?? defaults.defaultAngle;
  const convergenceA = lineOptions?.lines2ConvergenceA ?? defaults.convergenceA;
  const convergenceB = lineOptions?.lines2ConvergenceB ?? defaults.convergenceB;
  const spacingSetting = lineOptions?.lines2Spacing ?? brushSettings.contourLines2Spacing ?? 8;
  const densitySetting = lineOptions?.lines2Density ?? brushSettings.contourLines2Density ?? 5;
  const alternateSetting = lineOptions?.lines2Alternate ?? brushSettings.contourLines2Alternate ?? true;
  const centroidOverride = lineOptions?.centroid ?? defaults.centroid;

  ctx.strokeStyle = brushSettings.color;
  ctx.lineWidth = 1;
  ctx.imageSmoothingEnabled = false;

  const lines = generateLines2Paths(
    vertices,
    {
      angle,
      convergenceA,
      convergenceB,
      spacing: spacingSetting,
      density: densitySetting,
      alternate: alternateSetting,
    },
    centroidOverride ?? undefined
  );

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
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
