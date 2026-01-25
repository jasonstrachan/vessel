type Point = { x: number; y: number };

export type CcGradientDitherOptions = {
  vertices: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelSize: number;
  levels: number;
  baseOffset: number;
  sampleNormalized: (x: number, y: number) => number;
  writeIndex: (x: number, y: number, index: number) => void;
  logSetIndexSample?: (x: number, y: number) => void;
  yieldIfNeeded?: (row: number) => Promise<void>;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const noiseAt = (x: number, y: number): number => {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n & 0xffff) / 65536;
};

const indexFromNormalized = (pos: number, baseOffset: number): number => {
  const raw = Math.round(pos * 254);
  const shifted = (raw + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

export const fillCcGradientDither = async ({
  vertices,
  minX,
  minY,
  maxX,
  maxY,
  pixelSize,
  levels,
  baseOffset,
  sampleNormalized,
  writeIndex,
  logSetIndexSample,
  yieldIfNeeded,
}: CcGradientDitherOptions): Promise<void> => {
  const clampedLevels = Math.max(2, Math.min(255, Math.floor(levels)));
  const cellSize = clampedLevels <= 2 ? 1 : Math.max(1, Math.floor(pixelSize));
  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const gridW = Math.max(1, Math.ceil(bboxWidth / cellSize));
  const gridH = Math.max(1, Math.ceil(bboxHeight / cellSize));

  const cellIndices = new Uint16Array(gridW * gridH);
  let errCurr = new Float32Array(gridW);
  let errNext = new Float32Array(gridW);

  const activeCells: number[] = [];
  const cellSeen = new Uint8Array(gridW);
  const thresholdJitter = 0.2;

  for (let cy = 0; cy < gridH; cy += 1) {
    const swapErr = errCurr;
    errCurr = errNext;
    errNext = swapErr;
    errNext.fill(0);

    cellSeen.fill(0);
    activeCells.length = 0;

    const rowStart = cy * cellSize + minY;
    const rowEnd = Math.min(maxY, rowStart + cellSize - 1);

    for (let y = rowStart; y <= rowEnd; y += 1) {
      const intersections: number[] = [];
      for (let i = 0; i < vertices.length; i += 1) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        if (Math.abs(v2.y - v1.y) < 1e-4) continue;
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const t = (y - v1.y) / (v2.y - v1.y);
          const x = v1.x + t * (v2.x - v1.x);
          intersections.push(x);
        }
      }

      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startFloat = intersections[i];
        const endFloat = intersections[i + 1];
        if (endFloat <= startFloat) continue;
        const startX = Math.floor(startFloat);
        const endX = Math.ceil(endFloat);
        const startCell = Math.floor((startX - minX) / cellSize);
        const endCell = Math.floor((endX - minX) / cellSize);
        for (let cx = startCell; cx <= endCell; cx += 1) {
          if (cx < 0 || cx >= gridW) continue;
          if (!cellSeen[cx]) {
            cellSeen[cx] = 1;
            activeCells.push(cx);
          }
        }
      }
    }

    if (!activeCells.length) {
      continue;
    }
    activeCells.sort((a, b) => a - b);

    const serpentine = (cy & 1) === 1;
    const start = serpentine ? activeCells.length - 1 : 0;
    const end = serpentine ? -1 : activeCells.length;
    const step = serpentine ? -1 : 1;

    const sampleY = minY + cy * cellSize + cellSize * 0.5;
    for (let i = start; i !== end; i += step) {
      const cx = activeCells[i];
      const sampleX = minX + cx * cellSize + cellSize * 0.5;
      let r = clamp01(sampleNormalized(sampleX, sampleY));
      if (clampedLevels > 1) {
        const j = (noiseAt(Math.floor(sampleX), Math.floor(sampleY)) - 0.5) * (0.35 / clampedLevels);
        r = clamp01(r + j);
      }
      const scaled = r * (clampedLevels - 1);
      const lower = Math.max(0, Math.min(clampedLevels - 1, Math.floor(scaled)));
      const frac = scaled - lower;
      const adj = frac + (errCurr[cx] || 0);
      const thr = 0.5 + (noiseAt(cx, cy) - 0.5) * thresholdJitter;
      const chooseUpper = lower < clampedLevels - 1 && adj >= thr;
      const q = chooseUpper ? 1 : 0;
      const err = frac - q;

      if (!serpentine) {
        if (cx + 1 < gridW) errCurr[cx + 1] += err * 0.5;
        if (cx - 1 >= 0) errNext[cx - 1] += err * 0.25;
      } else {
        if (cx - 1 >= 0) errCurr[cx - 1] += err * 0.5;
        if (cx + 1 < gridW) errNext[cx + 1] += err * 0.25;
      }
      errNext[cx] += err * 0.25;

      const level = chooseUpper ? lower + 1 : lower;
      const pos = clampedLevels > 1 ? level / (clampedLevels - 1) : 0;
      cellIndices[cy * gridW + cx] = indexFromNormalized(pos, baseOffset);
    }
  }

  for (let y = minY, row = 0; y <= maxY; y += 1, row += 1) {
    if (yieldIfNeeded) {
      await yieldIfNeeded(row);
    }
    const intersections: number[] = [];
    for (let i = 0; i < vertices.length; i += 1) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      if (Math.abs(v2.y - v1.y) < 1e-4) continue;
      if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
        const t = (y - v1.y) / (v2.y - v1.y);
        const x = v1.x + t * (v2.x - v1.x);
        intersections.push(x);
      }
    }

    intersections.sort((a, b) => a - b);
    if (intersections.length < 2) continue;

    const cy = Math.max(0, Math.min(gridH - 1, Math.floor((y - minY) / cellSize)));
    const rowOffset = cy * gridW;

    for (let i = 0; i < intersections.length - 1; i += 2) {
      const startFloat = intersections[i];
      const endFloat = intersections[i + 1];
      if (endFloat <= startFloat) continue;

      const startX = Math.floor(startFloat);
      const endX = Math.ceil(endFloat);
      const startCell = Math.floor((startX - minX) / cellSize);
      const endCell = Math.floor((endX - minX) / cellSize);

      for (let cx = startCell; cx <= endCell; cx += 1) {
        if (cx < 0 || cx >= gridW) continue;
        const index = cellIndices[rowOffset + cx];
        if (index <= 0) continue;

        const cellX = minX + cx * cellSize;
        const cellXEnd = Math.min(endX, cellX + cellSize - 1);
        const fillStart = Math.max(startX, cellX);
        if (fillStart > cellXEnd) continue;

        for (let x = fillStart; x <= cellXEnd; x += 1) {
          if (logSetIndexSample) {
            logSetIndexSample(x, y);
          }
          writeIndex(x, y, index);
        }
      }
    }
  }
};
