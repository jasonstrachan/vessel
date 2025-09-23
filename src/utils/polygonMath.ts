export interface PointLike {
  x: number;
  y: number;
}

export const computePolygonCentroid = (points: PointLike[]): PointLike => {
  if (!points.length) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length,
  };
};

export const distanceBetweenPoints = (a: PointLike, b: PointLike): number => {
  return Math.hypot(a.x - b.x, a.y - b.y);
};
