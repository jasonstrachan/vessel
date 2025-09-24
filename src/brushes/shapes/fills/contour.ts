import { resolveCoordinateSnap } from './common';
import type { ContourFillParams } from './types';

export const drawContourFill = ({
  ctx,
  vertices,
  brushSettings,
  dependencies,
  isPreview = false,
  spacingOverride,
  randomSeed,
  previewDetail,
}: ContourFillParams): void => {
  const {
    createSignedDistanceField,
    extractContour,
    connectSegments,
    applyRisographEffect,
  } = dependencies;

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);

  if (vertices.length < 3) {
    return;
  }

  ctx.strokeStyle = brushSettings.color;
  ctx.lineWidth = lineWidth;
  ctx.imageSmoothingEnabled = !pixelMode;

  const fieldData = createSignedDistanceField(vertices, ctx.canvas.width, ctx.canvas.height, 2);

  const createRandomGenerator = (seed?: number) => {
    if (seed == null) {
      return Math.random;
    }
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0x100000000;
    };
  };

  const random = createRandomGenerator(randomSeed);
  const allowFullDetail = !isPreview || previewDetail === 'full';

  let maxDistance = 0;
  for (let y = 0; y < fieldData.rows; y++) {
    const row = fieldData.field[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] > maxDistance) {
        maxDistance = row[x];
      }
    }
  }
  const safeMinStep = Math.max(0.5, maxDistance * 0.02);
  const hasSpacingOverride = spacingOverride != null;
  const spacingBase = spacingOverride ?? brushSettings.contourSpacing ?? 5;
  const spacing = Math.max(0.5, hasSpacingOverride ? spacingBase : spacingBase * 2);
  const variancePercent = (brushSettings.contourVariance ?? 5) / 10;

  const maxStartDistance = Math.min(maxDistance * 0.95, Math.max(spacing * 2, safeMinStep * 6));
  const minStartDistance = Math.max(safeMinStep * 1.5, spacing * 0.5);
  const startDistance = Math.min(maxStartDistance, Math.max(minStartDistance, spacing * 1.5));

  let currentDistance = startDistance;
  let drewAnyContours = false;
  const actualPeakX = fieldData.peakX;
  const actualPeakY = fieldData.peakY;

  const maxElevation = Math.max(maxDistance * 36, 200);
  const snapElevation = (value: number) => Math.max(1, Math.round((value / maxElevation) * 1000) / 2);

  const baseNoise = (random() * 2 - 1) * variancePercent;
  let randomWalk = (random() * 2 - 1) * variancePercent * 0.5;
  let clusterPhase = random() * Math.PI * 2;
  const clusterStrength = variancePercent * 0.5;
  const clusterFreq = 0.2 + variancePercent * 0.4;
  const walkSpeed = 0.05 + variancePercent * 0.2;
  const noiseScale = 0.4 + variancePercent * 0.6;

  while (currentDistance < maxDistance) {
    const contourSegments = extractContour(
      fieldData.field,
      fieldData.cols,
      fieldData.rows,
      fieldData.resolution,
      currentDistance,
      fieldData.extension
    );

    if (!contourSegments || contourSegments.length === 0) {
      currentDistance += spacing;
      continue;
    }

    const loops = connectSegments(contourSegments);

    loops.forEach(loop => {
      if (loop.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(snap(loop[0].x), snap(loop[0].y));
      for (let i = 1; i < loop.length; i++) {
        ctx.lineTo(snap(loop[i].x), snap(loop[i].y));
      }
      ctx.lineTo(snap(loop[0].x), snap(loop[0].y));
      ctx.stroke();
      drewAnyContours = true;

      const elevation = snapElevation(currentDistance * 100);
      if (random() < 0.08) {
        const labelIndex = Math.floor(loop.length * 0.25 + random() * loop.length * 0.5);
        const point = loop[Math.min(loop.length - 1, Math.max(0, labelIndex))];
        const text = `${Math.round(elevation)}m`;

        ctx.save();
        ctx.font = '8px monospace';
        ctx.globalCompositeOperation = 'destination-out';
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const padding = 2;
        const textX = snap(point.x);
        const textY = snap(point.y);
        ctx.fillRect(
          Math.floor(textX - textWidth / 2 - padding),
          Math.floor(textY - 5),
          Math.ceil(textWidth + padding * 2),
          10
        );
        ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
        ctx.fillStyle = brushSettings.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, textX, textY);
        ctx.restore();
      }
    });

    const clusterEffect = Math.sin(clusterPhase) * clusterStrength;
    const jumpChance = 0.15 * variancePercent;
    const jump = random() < jumpChance ? (random() * 2 - 0.5) : 0;
    const localNoise = (random() * 2 - 1) * noiseScale;
    const totalVariance = (
      randomWalk * 0.4 +
      clusterEffect * 0.3 +
      localNoise * 0.2 +
      jump * 0.5 +
      baseNoise * 0.1
    ) * variancePercent;

    const baseSpacing = spacing * (1 + totalVariance * 2.0);
    const minSpacing = spacing * (0.1 + (1 - variancePercent) * 0.4);
    const maxSpacingAdjusted = spacing * (1.5 + variancePercent * 3.5);

    currentDistance += Math.max(minSpacing, Math.min(maxSpacingAdjusted, baseSpacing));
    clusterPhase += clusterFreq;
    randomWalk += (random() * 2 - 1) * walkSpeed;
    randomWalk = Math.max(-1, Math.min(1, randomWalk));
  }

  if (!drewAnyContours) {
    let fallbackDistance = Math.max(
      Math.min(maxDistance * 0.66, maxStartDistance),
      Math.max(0.1, safeMinStep * 0.5)
    );
    if (fallbackDistance >= maxDistance) {
      fallbackDistance = Math.max(maxDistance * 0.5, maxDistance - 0.01);
    }
    fallbackDistance = Math.max(0.005, Math.min(fallbackDistance, Math.max(0.005, maxDistance * 0.95)));
    const fallbackSegments = extractContour(
      fieldData.field,
      fieldData.cols,
      fieldData.rows,
      fieldData.resolution,
      fallbackDistance,
      fieldData.extension
    );
    const fallbackLoops = connectSegments(fallbackSegments);

    fallbackLoops.forEach(loop => {
      if (loop.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(snap(loop[0].x), snap(loop[0].y));
      for (let i = 1; i < loop.length; i++) {
        ctx.lineTo(snap(loop[i].x), snap(loop[i].y));
      }
      ctx.lineTo(snap(loop[0].x), snap(loop[0].y));
      ctx.stroke();
    });

    if (!drewAnyContours && vertices.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  if (allowFullDetail && random() < 0.1) {
    ctx.save();
    ctx.imageSmoothingEnabled = !pixelMode;

    ctx.strokeStyle = brushSettings.color;
    ctx.lineWidth = lineWidth;

    const snappedPeakX = snap(actualPeakX);
    const snappedPeakY = snap(actualPeakY);

    ctx.beginPath();
    ctx.moveTo(snappedPeakX, snappedPeakY - 6);
    ctx.lineTo(snappedPeakX - 4, snappedPeakY + 3);
    ctx.lineTo(snappedPeakX + 4, snappedPeakY + 3);
    ctx.closePath();
    ctx.stroke();

    const peakElevation = Math.round(100 + maxElevation * 3);
    const peakText = `${peakElevation}m`;

    ctx.font = '9px monospace';
    const metrics = ctx.measureText(peakText);
    const textWidth = metrics.width;
    const padding = 1;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fillRect(
      Math.floor(snappedPeakX - textWidth / 2 - padding),
      Math.floor(snappedPeakY + 10),
      Math.ceil(textWidth + padding * 2),
      10
    );

    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    ctx.fillStyle = brushSettings.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(peakText, snappedPeakX, snap(snappedPeakY + 15));

    ctx.restore();
  }

  const risographIntensity = brushSettings.risographIntensity || 0;
  if (risographIntensity > 0 && allowFullDetail) {
    applyRisographEffect(ctx, vertices, risographIntensity);
  }
};
