import { applyEdgePadding } from './fillMath';

type Point = { x: number; y: number };

type BBox = { minX: number; minY: number; width: number; height: number };

export interface ConcentricFillParams {
  vertices: Point[];
  bbox: BBox;
  bands: number;
  baseOffset: number;
  maxDist: number;
  ditherEnabled: boolean;
  ditherStrength: number;
  ditherPixelSize: number;
  noiseSeed?: number;
}

export interface ConcentricFillHooks {
  writeSample: (x: number, y: number, colorIndex: number) => void;
  yieldIfNeeded?: (iteration: number) => Promise<void> | void;
}

const buildEdges = (vertices: Point[]) => {
  return vertices.map((v, i) => {
    const next = vertices[(i + 1) % vertices.length];
    const dx = next.x - v.x;
    const dy = next.y - v.y;
    const len2 = dx * dx + dy * dy;
    return { v1x: v.x, v1y: v.y, dx, dy, len2 };
  });
};

const makeNoiseSampler = (seed: number) => {
  const seedInt = Math.floor(seed * 1_000_000) | 0;
  return (x: number, y: number): number => {
    let n = ((x | 0) * 374761393) + ((y | 0) * 668265263) + seedInt;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = (n ^ (n >>> 16)) >>> 0;
    return (n & 0xffff) / 65536;
  };
};

const clampIndex = (value: number) => Math.max(1, Math.min(255, value | 0));

const withinBounds = (x: number, y: number, bbox: BBox): boolean => {
  return (
    x >= bbox.minX &&
    x < bbox.minX + bbox.width &&
    y >= bbox.minY &&
    y < bbox.minY + bbox.height
  );
};

export async function fillConcentricIndices(
  params: ConcentricFillParams,
  hooks: ConcentricFillHooks
): Promise<void> {
  if (!params.vertices.length || params.vertices.length < 3) {
    return;
  }
  const width = Math.max(1, Math.floor(params.bbox.width));
  const height = Math.max(1, Math.floor(params.bbox.height));
  if (width <= 0 || height <= 0) {
    return;
  }

  const bands = Math.max(2, params.bands);
  const indexFromNormalized = (pos: number): number => {
    const raw = Math.round(pos * 254);
    const shifted = (raw + params.baseOffset) % 255;
    return clampIndex(shifted + 1);
  };

  const edges = buildEdges(params.vertices);
  const noiseAt = makeNoiseSampler(params.noiseSeed ?? 0);
  const cellSize = Math.max(1, params.ditherEnabled ? Math.round(params.ditherPixelSize) : 1);
  const jitterScale = 0.35;
  const thresholdJitter = 0.2;
  const ditherStrength = params.ditherEnabled ? Math.max(0, params.ditherStrength) : 0;
  const maxDist = Math.max(1, params.maxDist);
  const ixBase = params.bbox.minX;
  const iyBase = params.bbox.minY;
  const writeSample = hooks.writeSample;
  const maybeYield = hooks.yieldIfNeeded;

  const requestYield = async (iteration: number) => {
    if (maybeYield) {
      await maybeYield(iteration);
    }
  };

  const clampNormalized = (value: number) => {
    return applyEdgePadding(value);
  };

  const processBlockDither = async () => {
    const y0 = iyBase;
    const yMax = iyBase + height - 1;
    const cellsAcross = Math.max(1, Math.ceil(width / cellSize));
    let cErrCurr = new Float32Array(cellsAcross);
    let cErrNext = new Float32Array(cellsAcross);

    for (let yb = y0, rowIdx = 0; yb <= yMax; yb += cellSize, rowIdx++) {
      await requestYield(rowIdx);
      const tmp = cErrCurr;
      cErrCurr = cErrNext;
      cErrNext = tmp;
      cErrNext.fill(0);

      const serpentine = (rowIdx & 1) === 1;
      const yCenter = Math.min(yMax, yb + Math.floor(cellSize / 2));
      const intersections: number[] = [];
      for (let i = 0; i < params.vertices.length; i++) {
        const a = params.vertices[i];
        const b = params.vertices[(i + 1) % params.vertices.length];
        if (Math.abs(b.y - a.y) < 0.0001) continue;
        if ((a.y <= yCenter && b.y > yCenter) || (b.y <= yCenter && a.y > yCenter)) {
          const t = (yCenter - a.y) / (b.y - a.y);
          const x = a.x + t * (b.x - a.x);
          intersections.push(x);
        }
      }
      intersections.sort((a, b) => a - b);

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);
        if (endX < ixBase || startX > ixBase + width) continue;
        const xStartCell = Math.floor((startX - ixBase) / cellSize);
        const xEndCell = Math.floor((endX - ixBase) / cellSize);

        const rowClips: Array<{ start: number; end: number } | null> = [];
        const yTo = Math.min(yMax, yb + cellSize - 1);
        for (let yy = yb; yy <= yTo; yy++) {
          const intsRow: number[] = [];
          for (let k = 0; k < params.vertices.length; k++) {
            const a = params.vertices[k];
            const b = params.vertices[(k + 1) % params.vertices.length];
            if (Math.abs(b.y - a.y) < 0.0001) continue;
            if ((a.y <= yy && b.y > yy) || (b.y <= yy && a.y > yy)) {
              const t = (yy - a.y) / (b.y - a.y);
              const x = a.x + t * (b.x - a.x);
              intsRow.push(x);
            }
          }
          intsRow.sort((a, b) => a - b);
          if (intsRow.length >= i + 2) {
            rowClips.push({ start: Math.floor(intsRow[i]), end: Math.ceil(intsRow[i + 1]) });
          } else {
            rowClips.push({ start: startX, end: endX });
          }
        }

        const processCell = (cx: number) => {
          const xBlock = ixBase + cx * cellSize;
          const xCenter = Math.min(endX, xBlock + Math.floor(cellSize / 2));
          let minDistSq = Infinity;
          const distLeft = xCenter - startX;
          const distRight = endX - xCenter;
          minDistSq = Math.min(distLeft * distLeft, distRight * distRight);
          for (let j = 0; j < edges.length; j++) {
            const e = edges[j];
            if (e.len2 <= 0) continue;
            const tNum = (xCenter - e.v1x) * e.dx + (yCenter - e.v1y) * e.dy;
            const t = Math.max(0, Math.min(1, tNum / e.len2));
            const projX = e.v1x + t * e.dx;
            const projY = e.v1y + t * e.dy;
            const dxp = xCenter - projX;
            const dyp = yCenter - projY;
            const d2 = dxp * dxp + dyp * dyp;
            if (d2 < minDistSq) {
              minDistSq = d2;
              if (minDistSq <= 1) break;
            }
          }
          let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
          if (params.ditherEnabled && ditherStrength > 0) {
            const quantLevels = bands;
            const j = (noiseAt(xCenter, yCenter) - 0.5) * (jitterScale / quantLevels);
            r = clampNormalized(r + j);
          }
          const quantLevels = bands;
          const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
          const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
          const lowerPos = Math.min(1, kLower * qStep);
          const upperPos = Math.min(1, (kLower + 1) * qStep);
          const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
          const adj = frac + (cErrCurr[cx] || 0);
          const thr = 0.5 + (noiseAt(xCenter, yCenter) - 0.5) * thresholdJitter;
          const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
          const q = chooseUpper ? 1 : 0;
          const err = (frac - q) * ditherStrength;
          if (!serpentine) {
            if (cx + 1 < cellsAcross) cErrCurr[cx + 1] += err * 0.5;
            if (cx - 1 >= 0) cErrNext[cx - 1] += err * 0.25;
          } else {
            if (cx - 1 >= 0) cErrCurr[cx - 1] += err * 0.5;
            if (cx + 1 < cellsAcross) cErrNext[cx + 1] += err * 0.25;
          }
          cErrNext[cx] += err * 0.25;
          const outIdx = chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
          const xTo = Math.min(endX, xBlock + cellSize - 1);
          for (let yy = yb; yy <= yTo; yy++) {
            const clip = rowClips[yy - yb];
            if (!clip) continue;
            const fillStart = Math.max(clip.start, xBlock);
            const fillEnd = Math.min(clip.end, xTo);
            if (fillStart > fillEnd) continue;
            for (let xx = fillStart; xx <= fillEnd; xx++) {
              if (!withinBounds(xx, yy, params.bbox)) continue;
              writeSample(xx, yy, outIdx);
            }
          }
        };

        if (!serpentine) {
          for (let cx = xStartCell; cx <= xEndCell; cx++) processCell(cx);
        } else {
          for (let cx = xEndCell; cx >= xStartCell; cx--) processCell(cx);
        }
      }
    }
  };

  const processScanline = async () => {
    const bboxW = width;
    let errCurr = params.ditherEnabled && ditherStrength > 0 ? new Float32Array(bboxW) : null;
    let errNext = params.ditherEnabled && ditherStrength > 0 ? new Float32Array(bboxW) : null;
    const thresholdJitterLocal = 0.2;

    const noiseAtTile = (x: number, y: number) => noiseAt(x, y);

    for (let y = iyBase, row = 0; y < iyBase + height; y++, row++) {
      await requestYield(row);
      if (errCurr && errNext) {
        const tmp = errCurr;
        errCurr = errNext;
        errNext = tmp;
        errNext!.fill(0);
      }

      const intersections: number[] = [];
      for (let i = 0; i < params.vertices.length; i++) {
        const v1 = params.vertices[i];
        const v2 = params.vertices[(i + 1) % params.vertices.length];
        if (Math.abs(v2.y - v1.y) < 0.0001) continue;
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const t = (y - v1.y) / (v2.y - v1.y);
          const x = v1.x + t * (v2.x - v1.x);
          intersections.push(x);
        }
      }
      intersections.sort((a, b) => a - b);

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);
        const serpentine = (row & 1) === 1;
        const xRangeStart = Math.max(startX, ixBase);
        const xRangeEnd = Math.min(endX, ixBase + width - 1);
        if (xRangeStart > xRangeEnd) continue;
        if (!serpentine) {
          for (let x = xRangeStart; x <= xRangeEnd; x++) {
            const tileXCenter = x;
            const tileYCenter = y;
            let minDistSq = Infinity;
            const distLeft = tileXCenter - startX;
            const distRight = endX - tileXCenter;
            minDistSq = Math.min(distLeft * distLeft, distRight * distRight);
            for (let j = 0; j < edges.length; j++) {
              const e = edges[j];
              if (e.len2 <= 0) continue;
              const tNum = (tileXCenter - e.v1x) * e.dx + (tileYCenter - e.v1y) * e.dy;
              const t = Math.max(0, Math.min(1, tNum / e.len2));
              const projX = e.v1x + t * e.dx;
              const projY = e.v1y + t * e.dy;
              const dxp = tileXCenter - projX;
              const dyp = tileYCenter - projY;
              const distSq = dxp * dxp + dyp * dyp;
              if (distSq < minDistSq) {
                minDistSq = distSq;
                if (minDistSq <= 1) break;
              }
            }
            let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
            if (params.ditherEnabled && ditherStrength > 0) {
              const quantLevels = bands;
              const j = (noiseAtTile(tileXCenter, tileYCenter) - 0.5) * (jitterScale / quantLevels);
              r = clampNormalized(r + j);
            }
            const quantLevels = bands;
            const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
            const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
            const lowerPos = Math.min(1, kLower * qStep);
            const upperPos = Math.min(1, (kLower + 1) * qStep);
            const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
            if (params.ditherEnabled && ditherStrength > 0 && errCurr && errNext) {
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAtTile(tileXCenter, tileYCenter) - 0.5) * thresholdJitterLocal;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * ditherStrength;
              if (ix + 1 < bboxW) errCurr[ix + 1] += err * 0.5;
              if (ix - 1 >= 0) errNext[ix - 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const lowerIdx = indexFromNormalized(lowerPos);
              const upperIdx = indexFromNormalized(upperPos);
              if (withinBounds(x, y, params.bbox)) {
                writeSample(x, y, chooseUpper ? upperIdx : lowerIdx);
              }
            } else {
              const colorIndex = indexFromNormalized(lowerPos);
              if (withinBounds(x, y, params.bbox)) {
                writeSample(x, y, colorIndex);
              }
            }
          }
        } else {
          for (let x = xRangeEnd; x >= xRangeStart; x--) {
            const tileXCenter = x;
            const tileYCenter = y;
            let minDistSq = Infinity;
            const distLeft = tileXCenter - startX;
            const distRight = endX - tileXCenter;
            minDistSq = Math.min(distLeft * distLeft, distRight * distRight);
            for (let j = 0; j < edges.length; j++) {
              const e = edges[j];
              if (e.len2 <= 0) continue;
              const tNum = (tileXCenter - e.v1x) * e.dx + (tileYCenter - e.v1y) * e.dy;
              const t = Math.max(0, Math.min(1, tNum / e.len2));
              const projX = e.v1x + t * e.dx;
              const projY = e.v1y + t * e.dy;
              const dxp = tileXCenter - projX;
              const dyp = tileYCenter - projY;
              const distSq = dxp * dxp + dyp * dyp;
              if (distSq < minDistSq) {
                minDistSq = distSq;
                if (minDistSq <= 1) break;
              }
            }
            let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
            if (params.ditherEnabled && ditherStrength > 0) {
              const quantLevels = bands;
              const j = (noiseAtTile(tileXCenter, tileYCenter) - 0.5) * (jitterScale / quantLevels);
              r = clampNormalized(r + j);
            }
            const quantLevels = bands;
            const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
            const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
            const lowerPos = Math.min(1, kLower * qStep);
            const upperPos = Math.min(1, (kLower + 1) * qStep);
            const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
            if (params.ditherEnabled && ditherStrength > 0 && errCurr && errNext) {
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAtTile(tileXCenter, tileYCenter) - 0.5) * thresholdJitterLocal;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * ditherStrength;
              if (ix - 1 >= 0) errCurr[ix - 1] += err * 0.5;
              if (ix + 1 < bboxW) errNext[ix + 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const lowerIdx = indexFromNormalized(lowerPos);
              const upperIdx = indexFromNormalized(upperPos);
              if (withinBounds(x, y, params.bbox)) {
                writeSample(x, y, chooseUpper ? upperIdx : lowerIdx);
              }
            } else {
              const colorIndex = indexFromNormalized(lowerPos);
              if (withinBounds(x, y, params.bbox)) {
                writeSample(x, y, colorIndex);
              }
            }
          }
        }
      }
    }
  };

  if (params.ditherEnabled && cellSize > 1) {
    await processBlockDither();
  } else {
    await processScanline();
  }
}

export async function fillConcentricToBuffer(
  params: ConcentricFillParams,
  hooks?: { yieldIfNeeded?: ConcentricFillHooks['yieldIfNeeded'] }
): Promise<Uint8Array> {
  const width = Math.max(1, Math.floor(params.bbox.width));
  const height = Math.max(1, Math.floor(params.bbox.height));
  const buffer = new Uint8Array(width * height);
  await fillConcentricIndices(params, {
    yieldIfNeeded: hooks?.yieldIfNeeded,
    writeSample: (x, y, colorIndex) => {
      const lx = x - params.bbox.minX;
      const ly = y - params.bbox.minY;
      if (lx < 0 || ly < 0 || lx >= width || ly >= height) return;
      buffer[ly * width + lx] = clampIndex(colorIndex);
    },
  });
  return buffer;
}
