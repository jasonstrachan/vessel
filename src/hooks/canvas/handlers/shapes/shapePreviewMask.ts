import { buildNonZeroWindingRowSpans } from '@/utils/colorCycle/ccGradientDither';

type PolygonMaskOptions = {
  hardEdges?: boolean;
  origin?: { x: number; y: number };
  pixelSize?: number;
  wholeCells?: boolean;
};

const appendRowSpanMask = (
  targetCtx: CanvasRenderingContext2D,
  vertices: Array<{ x: number; y: number }>,
  useWholeEdgeCells: boolean,
): void => {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  const rowSpans = buildNonZeroWindingRowSpans({
    vertices,
    minX: 0,
    minY: 0,
    maxX: Math.max(0, width - 1),
    maxY: Math.max(0, height - 1),
    useWholeEdgeCells,
  });

  for (let y = 0; y < rowSpans.length; y += 1) {
    for (const [startX, endX] of rowSpans[y]) {
      targetCtx.rect(startX, y, endX - startX + 1, 1);
    }
  }
};

export const applyColorCycleRasterFootprintMaskToCanvasContext = (
  targetCtx: CanvasRenderingContext2D,
  vertices: Array<{ x: number; y: number }>,
): void => {
  if (vertices.length < 3) {
    return;
  }

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';
  targetCtx.beginPath();
  appendRowSpanMask(targetCtx, vertices, false);
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fill();
  targetCtx.restore();
};

export const applyPolygonMaskToCanvasContext = (
  targetCtx: CanvasRenderingContext2D,
  vertices: Array<{ x: number; y: number }>,
  options: PolygonMaskOptions = {}
): void => {
  if (vertices.length < 3) {
    return;
  }

  const cellSize = Math.max(1, Math.floor(options.pixelSize ?? 1));
  const useWholeCells = options.wholeCells === true && cellSize > 1;
  const useHardEdges = options.hardEdges === true;

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';
  targetCtx.beginPath();

  if (useWholeCells) {
    const width = targetCtx.canvas.width;
    const height = targetCtx.canvas.height;
    const origin = options.origin ?? { x: 0, y: 0 };
    const phaseX = ((Math.floor(origin.x) % cellSize) + cellSize) % cellSize;
    const phaseY = ((Math.floor(origin.y) % cellSize) + cellSize) % cellSize;
    const rowSpans = buildNonZeroWindingRowSpans({
      vertices,
      minX: 0,
      minY: 0,
      maxX: Math.max(0, width - 1),
      maxY: Math.max(0, height - 1),
      useWholeEdgeCells: true,
    });
    const gridWidth = Math.max(1, Math.ceil((width + phaseX) / cellSize));
    const activeCells = new Uint8Array(gridWidth);

    for (let gridY = 0; gridY < Math.ceil((height + phaseY) / cellSize); gridY += 1) {
      activeCells.fill(0);
      const cellY = gridY * cellSize - phaseY;
      const rowStart = Math.max(0, cellY);
      const rowEnd = Math.min(height, cellY + cellSize);
      for (let y = rowStart; y < rowEnd; y += 1) {
        const spans = rowSpans[y] ?? [];
        for (const [startX, endX] of spans) {
          const startCell = Math.max(0, Math.floor((startX + phaseX) / cellSize));
          const endCell = Math.min(
            gridWidth - 1,
            Math.floor((endX + phaseX) / cellSize)
          );
          for (let cellX = startCell; cellX <= endCell; cellX += 1) {
            activeCells[cellX] = 1;
          }
        }
      }

      for (let cellX = 0; cellX < gridWidth; cellX += 1) {
        if (!activeCells[cellX]) {
          continue;
        }
        const rawCellX = cellX * cellSize - phaseX;
        const rectX = Math.max(0, rawCellX);
        targetCtx.rect(
          rectX,
          rowStart,
          Math.min(width, rawCellX + cellSize) - rectX,
          rowEnd - rowStart
        );
      }
    }
  } else if (useHardEdges) {
    appendRowSpanMask(targetCtx, vertices, true);
  } else {
    targetCtx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i += 1) {
      targetCtx.lineTo(vertices[i].x, vertices[i].y);
    }
    targetCtx.closePath();
  }

  targetCtx.fillStyle = '#ffffff';
  targetCtx.fill();
  targetCtx.restore();
};
