import { applyEdgePadding } from './fillMath';

type Point = { x: number; y: number };

type BBox = { minX: number; minY: number; width: number; height: number };

type RowSpan = { start: number; end: number };

const sortAscending = (a: number, b: number) => a - b;

const INF = 1e12;

interface CoverageWindow {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  width: number;
  height: number;
}

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

const buildMaskAndRowSpans = (vertices: Point[], bbox: BBox, width: number, height: number) => {
  const rowSpans: RowSpan[][] = Array.from({ length: height }, () => []);
  if (!vertices.length) {
    return { rowSpans, mask: new Uint8Array(0), maskWidth: 0, maskHeight: 0, coverage: null as CoverageWindow | null };
  }
  let minRow = height;
  let maxRow = -1;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < height; row++) {
    const y = bbox.minY + row;
    const intersections: number[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      if (Math.abs(b.y - a.y) < 0.0001) continue;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        const x = a.x + t * (b.x - a.x);
        intersections.push(x);
      }
    }
    if (!intersections.length) {
      continue;
    }
    intersections.sort(sortAscending);
    const spansForRow: RowSpan[] = rowSpans[row];
    for (let i = 0; i < intersections.length - 1; i += 2) {
      let startX = Math.floor(intersections[i]);
      let endX = Math.ceil(intersections[i + 1]);
      if (endX < bbox.minX || startX > bbox.minX + width - 1) continue;
      startX = Math.max(startX, bbox.minX);
      endX = Math.min(endX, bbox.minX + width - 1);
      if (startX > endX) continue;
      spansForRow.push({ start: startX, end: endX });
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (startX < minCol) minCol = startX;
      if (endX > maxCol) maxCol = endX;
    }
  }
  if (minRow > maxRow || !Number.isFinite(minCol) || !Number.isFinite(maxCol)) {
    return { rowSpans, mask: new Uint8Array(0), maskWidth: 0, maskHeight: 0, coverage: null as CoverageWindow | null };
  }
  const maskWidth = Math.max(1, Math.floor(maxCol - minCol + 1));
  const maskHeight = Math.max(1, Math.floor(maxRow - minRow + 1));
  const mask = new Uint8Array(maskWidth * maskHeight);
  for (let row = minRow; row <= maxRow; row++) {
    const spans = rowSpans[row];
    if (!spans || spans.length === 0) continue;
    const localY = row - minRow;
    const rowOffset = localY * maskWidth;
    for (const span of spans) {
      const startX = Math.max(span.start, minCol);
      const endX = Math.min(span.end, maxCol);
      for (let x = startX; x <= endX; x++) {
        const localX = x - minCol;
        if (localX < 0 || localX >= maskWidth) continue;
        mask[rowOffset + localX] = 1;
      }
    }
  }
  const coverage: CoverageWindow = {
    minRow,
    maxRow,
    minCol,
    maxCol,
    width: maskWidth,
    height: maskHeight,
  };
  return { rowSpans, mask, maskWidth, maskHeight, coverage };
};

const edt1d = (
  f: Float32Array,
  n: number,
  d: Float32Array,
  v: Int32Array,
  z: Float32Array
) => {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = 0;
    while (k >= 0) {
      const vk = v[k];
      s = ((f[q] + q * q) - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
      if (s <= z[k]) {
        k--;
      } else {
        break;
      }
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
};

const computeDistanceField = (mask: Uint8Array, width: number, height: number) => {
  const total = width * height;
  const source = new Float32Array(total);
  const distances = new Float32Array(total);
  const v = new Int32Array(Math.max(width, height));
  const z = new Float32Array(Math.max(width, height) + 1);
  const rowBuffer = new Float32Array(Math.max(width, height));
  const rowOut = new Float32Array(Math.max(width, height));

  const isBoundary = (idx: number, x: number, y: number) => {
    if (!mask[idx]) return true;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
    const left = idx - 1;
    const right = idx + 1;
    const up = idx - width;
    const down = idx + width;
    return mask[left] === 0 || mask[right] === 0 || mask[up] === 0 || mask[down] === 0;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      source[idx] = isBoundary(idx, x, y) ? 0 : INF;
    }
  }

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      rowBuffer[x] = source[rowOffset + x];
    }
    edt1d(rowBuffer, width, rowOut, v, z);
    for (let x = 0; x < width; x++) {
      distances[rowOffset + x] = rowOut[x];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      rowBuffer[y] = distances[y * width + x];
    }
    edt1d(rowBuffer, height, rowOut, v, z);
    for (let y = 0; y < height; y++) {
      distances[y * width + x] = rowOut[y];
    }
  }

  for (let i = 0; i < total; i++) {
    const value = distances[i];
    distances[i] = value >= INF ? 0 : Math.sqrt(value);
  }

  return distances;
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

  const { rowSpans, mask, maskWidth, maskHeight, coverage } = buildMaskAndRowSpans(
    params.vertices,
    params.bbox,
    width,
    height
  );
  const hasCoverage = rowSpans.some((row) => row.length > 0);
  if (!hasCoverage || !coverage || maskWidth <= 0 || maskHeight <= 0) {
    return;
  }

  const distanceField = computeDistanceField(mask, maskWidth, maskHeight);

  const bands = Math.max(2, params.bands);
  const indexFromNormalized = (pos: number): number => {
    const raw = Math.round(pos * 254);
    const shifted = (raw + params.baseOffset) % 255;
    return clampIndex(shifted + 1);
  };

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

  const coverageMinRowWorld = iyBase + coverage.minRow;
  const coverageMaxRowWorld = iyBase + coverage.maxRow;
  const coverageMinX = coverage.minCol;
  const coverageMaxX = coverage.maxCol;

  const sampleDistance = (worldX: number, worldY: number) => {
    const lx = worldX - coverageMinX;
    const ly = worldY - coverageMinRowWorld;
    if (lx < 0 || ly < 0 || lx >= maskWidth || ly >= maskHeight) {
      return 0;
    }
    return distanceField[ly * maskWidth + lx];
  };

  const processBlockDither = async () => {
    const y0 = coverageMinRowWorld;
    const yMax = coverageMaxRowWorld;
    const cellsAcross = Math.max(1, Math.ceil(width / cellSize));
    let cErrCurr = new Float32Array(cellsAcross);
    let cErrNext = new Float32Array(cellsAcross);
    const cellSeen = new Uint8Array(cellsAcross);
    const activeCells: number[] = [];

    for (let yb = y0, rowIdx = 0; yb <= yMax; yb += cellSize, rowIdx++) {
      await requestYield(rowIdx);
      const tmp = cErrCurr;
      cErrCurr = cErrNext;
      cErrNext = tmp;
      cErrNext.fill(0);

      cellSeen.fill(0);
      activeCells.length = 0;

      const serpentine = (rowIdx & 1) === 1;
      const yCenter = Math.min(yMax, yb + Math.floor(cellSize / 2));
      const rowStartIdx = Math.max(coverage.minRow, Math.floor(yb - iyBase));
      const rowEndIdx = Math.min(coverage.maxRow, Math.floor(Math.min(yMax, yb + cellSize - 1) - iyBase));
      if (rowStartIdx > rowEndIdx) {
        continue;
      }

      for (let row = rowStartIdx; row <= rowEndIdx; row++) {
        const spans = rowSpans[row];
        if (spans && spans.length > 0) {
          for (let s = 0; s < spans.length; s++) {
            const span = spans[s];
            const localStart = span.start - ixBase;
            const localEnd = span.end - ixBase;
            const startCell = Math.max(0, Math.floor(localStart / cellSize));
            const endCell = Math.min(cellsAcross - 1, Math.floor(localEnd / cellSize));
            for (let cellIdx = startCell; cellIdx <= endCell; cellIdx++) {
              if (!cellSeen[cellIdx]) {
                cellSeen[cellIdx] = 1;
                activeCells.push(cellIdx);
              }
            }
          }
        }
      }

      if (!activeCells.length) {
        continue;
      }
      activeCells.sort(sortAscending);

      const quantLevels = bands;
      const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;

      const processCell = (cx: number) => {
        const xBlock = ixBase + cx * cellSize;
        const xBlockEnd = Math.min(ixBase + width - 1, xBlock + cellSize - 1);
        const xCenter = Math.min(xBlockEnd, xBlock + Math.floor(cellSize / 2));
        const dist = sampleDistance(xCenter, yCenter);
        let r = Math.min(1, dist / maxDist);
        if (params.ditherEnabled && ditherStrength > 0) {
          const j = (noiseAt(xCenter, yCenter) - 0.5) * (jitterScale / quantLevels);
          r = clampNormalized(r + j);
        }
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
        const lowerIdx = indexFromNormalized(lowerPos);
        const upperIdx = indexFromNormalized(upperPos);
        const outIdx = chooseUpper ? upperIdx : lowerIdx;

        for (let row = rowStartIdx; row <= rowEndIdx; row++) {
          const worldY = iyBase + row;
          const spans = rowSpans[row];
          if (spans && spans.length > 0) {
            for (let s = 0; s < spans.length; s++) {
              const span = spans[s];
              if (span.end >= xBlock && span.start <= xBlockEnd) {
                const fillStart = Math.max(span.start, xBlock, coverageMinX);
                const fillEnd = Math.min(span.end, xBlockEnd, coverageMaxX);
                for (let xx = fillStart; xx <= fillEnd; xx++) {
                  if (withinBounds(xx, worldY, params.bbox)) {
                    writeSample(xx, worldY, outIdx);
                  }
                }
              }
            }
          }
        }
      };

      if (!serpentine) {
        for (let idx = 0; idx < activeCells.length; idx++) {
          processCell(activeCells[idx]);
        }
      } else {
        for (let idx = activeCells.length - 1; idx >= 0; idx--) {
          processCell(activeCells[idx]);
        }
      }
    }
  };

  const processScanline = async () => {
    const bboxW = width;
    let errCurr = params.ditherEnabled && ditherStrength > 0 ? new Float32Array(bboxW) : null;
    let errNext = params.ditherEnabled && ditherStrength > 0 ? new Float32Array(bboxW) : null;
    const thresholdJitterLocal = 0.2;

    for (let row = coverage.minRow; row <= coverage.maxRow; row++) {
      const y = iyBase + row;
      await requestYield(row);
      if (errCurr && errNext) {
        const tmp = errCurr;
        errCurr = errNext;
        errNext = tmp;
        errNext!.fill(0);
      }

      const spans = rowSpans[row];
      if (!spans || spans.length === 0) {
        continue;
      }
      const serpentine = (row & 1) === 1;
      const quantLevels = bands;
      const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;

      const processPixel = (x: number) => {
        const localX = x - ixBase;
        if (localX < 0 || localX >= width) {
          return;
        }
        if (x < coverageMinX || x > coverageMaxX) {
          return;
        }
        const dist = sampleDistance(x, y);
        let r = Math.min(1, dist / maxDist);
        if (params.ditherEnabled && ditherStrength > 0) {
          const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
          r = clampNormalized(r + j);
        }
        const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
        const lowerPos = Math.min(1, kLower * qStep);
        const upperPos = Math.min(1, (kLower + 1) * qStep);
        const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
        if (params.ditherEnabled && ditherStrength > 0 && errCurr && errNext) {
          const adj = frac + (errCurr[localX] || 0);
          const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitterLocal;
          const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
          const q = chooseUpper ? 1 : 0;
          const err = (frac - q) * ditherStrength;
          if (localX + 1 < bboxW) errCurr[localX + 1] += err * 0.5;
          if (localX - 1 >= 0) errNext[localX - 1] += err * 0.25;
          errNext[localX] += err * 0.25;
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
      };

      if (!serpentine) {
        for (let s = 0; s < spans.length; s++) {
          const span = spans[s];
          const startX = Math.max(span.start, ixBase, coverageMinX);
          const endX = Math.min(span.end, ixBase + width - 1, coverageMaxX);
          for (let x = startX; x <= endX; x++) {
            processPixel(x);
          }
        }
      } else {
        for (let s = spans.length - 1; s >= 0; s--) {
          const span = spans[s];
          const startX = Math.max(span.start, ixBase, coverageMinX);
          const endX = Math.min(span.end, ixBase + width - 1, coverageMaxX);
          for (let x = endX; x >= startX; x--) {
            processPixel(x);
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
