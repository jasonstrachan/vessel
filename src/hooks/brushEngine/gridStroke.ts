export type GridSpacing = {
  x: number;
  y: number;
};

export type GridPoint = {
  x: number;
  y: number;
};

const snapAxisToGrid = (value: number, step: number): number => {
  const safeStep = Math.max(1, Math.round(step));
  const snapped = Math.sign(value) * Math.round(Math.abs(value) / safeStep) * safeStep;
  return Number.isNaN(snapped) ? 0 : snapped;
};

export const snapPointToGrid = (
  point: GridPoint,
  spacing: GridSpacing
): GridPoint => ({
  x: snapAxisToGrid(point.x, spacing.x),
  y: snapAxisToGrid(point.y, spacing.y),
});

export const rasterizeGridPath = (
  from: GridPoint,
  to: GridPoint,
  spacing: GridSpacing
): GridPoint[] => {
  const safeSpacing = {
    x: Math.max(1, Math.round(spacing.x)),
    y: Math.max(1, Math.round(spacing.y)),
  };
  let cellX = Math.round(from.x / safeSpacing.x);
  let cellY = Math.round(from.y / safeSpacing.y);
  const targetCellX = Math.round(to.x / safeSpacing.x);
  const targetCellY = Math.round(to.y / safeSpacing.y);
  const deltaX = Math.abs(targetCellX - cellX);
  const deltaY = Math.abs(targetCellY - cellY);
  const stepX = cellX < targetCellX ? 1 : -1;
  const stepY = cellY < targetCellY ? 1 : -1;
  let error = deltaX - deltaY;
  const points: GridPoint[] = [];

  while (true) {
    points.push({
      x: cellX * safeSpacing.x,
      y: cellY * safeSpacing.y,
    });
    if (cellX === targetCellX && cellY === targetCellY) {
      break;
    }
    const doubleError = error * 2;
    if (doubleError > -deltaY) {
      error -= deltaY;
      cellX += stepX;
    }
    if (doubleError < deltaX) {
      error += deltaX;
      cellY += stepY;
    }
  }

  return points;
};
