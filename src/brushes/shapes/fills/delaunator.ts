import Delaunator from 'delaunator';

import { debugLog } from '@/utils/debug';

import { isPointInPolygonSDF, resolveCoordinateSnap } from './common';
import type { DelaunayFillParams } from './types';

type Point = { x: number; y: number };

export const drawDelaunayFill = ({
  ctx,
  vertices,
  brushSettings,
  boundWidth,
  boundHeight,
  isPreview = false,
}: DelaunayFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);

  const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const rotationDeg = brushSettings.triangleFillRotation ?? 0;
  const rotationRad = (rotationDeg % 360) * Math.PI / 180;
  const estimatedSize = Math.max(12, Math.min(96, Math.min(boundWidth, boundHeight) / 2));
  const baseSizeSetting = brushSettings.triangleFillSize ?? estimatedSize;
  const cellSize = clampValue(baseSizeSetting, 8, 200);
  const jitterPct = clampValue((brushSettings.triangleFillJitter ?? 35) / 100, 0, 1);

  const polygonCentroid = (() => {
    let areaAcc = 0;
    let cxAcc = 0;
    let cyAcc = 0;
    for (let i = 0; i < vertices.length; i++) {
      const current = vertices[i];
      const next = vertices[(i + 1) % vertices.length];
      const cross = current.x * next.y - next.x * current.y;
      areaAcc += cross;
      cxAcc += (current.x + next.x) * cross;
      cyAcc += (current.y + next.y) * cross;
    }
    const area = areaAcc / 2;
    if (Math.abs(area) < 1e-5) {
      const avg = vertices.reduce(
        (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
        { x: 0, y: 0 }
      );
      return {
        x: avg.x / vertices.length,
        y: avg.y / vertices.length,
      };
    }
    return {
      x: cxAcc / (6 * area),
      y: cyAcc / (6 * area),
    };
  })();

  const sinR = Math.sin(rotationRad);
  const cosR = Math.cos(rotationRad);

  const toRotated = (point: Point) => {
    const dx = point.x - polygonCentroid.x;
    const dy = point.y - polygonCentroid.y;
    return {
      x: dx * cosR + dy * sinR,
      y: -dx * sinR + dy * cosR,
    };
  };

  const fromRotated = (point: Point): Point => ({
    x: polygonCentroid.x + point.x * cosR - point.y * sinR,
    y: polygonCentroid.y + point.x * sinR + point.y * cosR,
  });

  const rotatedPolygon = vertices.map(toRotated);

  const minXR = Math.min(...rotatedPolygon.map(p => p.x));
  const maxXR = Math.max(...rotatedPolygon.map(p => p.x));
  const minYR = Math.min(...rotatedPolygon.map(p => p.y));
  const maxYR = Math.max(...rotatedPolygon.map(p => p.y));

  const widthR = maxXR - minXR;
  const heightR = maxYR - minYR;

  const bounds = {
    minX: minXR - cellSize,
    maxX: maxXR + cellSize,
    minY: minYR - cellSize,
    maxY: maxYR + cellSize,
  };

  const isPointInside = (x: number, y: number) => {
    const rotated = { x, y };
    return isPointInPolygonSDF(rotated, rotatedPolygon);
  };

  const isFarEnough = (x: number, y: number, minDist: number, points: Point[]): boolean => {
    for (const point of points) {
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy < minDist * minDist) {
        return false;
      }
    }
    return true;
  };

  const nextRandom = (() => {
    let seed = Math.floor((Math.sin(vertices[0].x + vertices[0].y) + 1) * 10000);
    return () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  })();

  type IndexedPoint = Point & { key: string };

  const pointMap = new Map<string, IndexedPoint>();
  const keyForPoint = (point: Point) => `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;

  const addPoint = (point: Point, allowDuplicates: boolean = false) => {
    const key = keyForPoint(point);
    if (!allowDuplicates && pointMap.has(key)) {
      return;
    }
    pointMap.set(key, { ...point, key });
  };

  const triangulationPoints: Point[] = [];
  const insertPoint = (point: Point) => {
    addPoint(point);
    triangulationPoints.push(point);
  };

  const initialMinDist = cellSize * (0.85 + nextRandom() * 0.6);
  const queued: Point[] = [];

  const addSeedPoint = (point: Point) => {
    if (!isPointInside(point.x, point.y)) {
      return false;
    }

    const minDist = cellSize * (0.6 + nextRandom() * 0.3);
    if (!isFarEnough(point.x, point.y, minDist, queued)) {
      return false;
    }

    queued.push(point);
    insertPoint(point);
    return true;
  };

  for (let i = 0; i < 12; i++) {
    const candidate = {
      x: bounds.minX + nextRandom() * (bounds.maxX - bounds.minX),
      y: bounds.minY + nextRandom() * (bounds.maxY - bounds.minY),
    };
    addSeedPoint(candidate);
  }

  const generatePoissonPoints = () => {
    const samples: Point[] = [];
    const angleStep = Math.PI * (3 - Math.sqrt(5));

    let currentRadius = initialMinDist;
    const maxRadius = Math.max(widthR, heightR) * 1.2 + cellSize * 4;

    while (currentRadius < maxRadius) {
      const pointsThisRadius = Math.ceil((Math.PI * 2 * currentRadius) / (cellSize * 0.85));
      const jitter = cellSize * 0.3;

      for (let i = 0; i < pointsThisRadius; i++) {
        const angle = currentRadius / cellSize * angleStep + i * (Math.PI * 2 / pointsThisRadius);
        const offset = jitter * nextRandom();
        const baseX = polygonCentroid.x + Math.cos(angle) * (currentRadius + offset);
        const baseY = polygonCentroid.y + Math.sin(angle) * (currentRadius + offset);

        const rotated = toRotated({ x: baseX, y: baseY });
        if (!isPointInside(rotated.x, rotated.y)) {
          continue;
        }

        const minDist = cellSize * (0.6 + nextRandom() * 0.25);
        if (!isFarEnough(rotated.x, rotated.y, minDist, queued)) {
          continue;
        }

        const jitterX = (nextRandom() - 0.5) * cellSize * jitterPct * 4;
        const jitterY = (nextRandom() - 0.5) * cellSize * jitterPct * 4;
        const jittered = {
          x: rotated.x + jitterX,
          y: rotated.y + jitterY,
        };

        if (!isPointInside(jittered.x, jittered.y)) {
          continue;
        }

        samples.push(jittered);
      }

      currentRadius += cellSize * (0.75 + nextRandom() * 0.35);
    }

    return samples;
  };

  const poissonPoints = generatePoissonPoints();
  for (const samplePoint of poissonPoints) {
    if (nextRandom() < 0.18) {
      continue;
    }

    addPoint(samplePoint, false);

    if (nextRandom() < (0.25 + jitterPct * 0.45)) {
      const offsetMagnitude = cellSize * (0.12 + nextRandom() * 0.38);
      const offsetAngle = nextRandom() * Math.PI * 2;
      const companionPoint = {
        x: samplePoint.x + Math.cos(offsetAngle) * offsetMagnitude,
        y: samplePoint.y + Math.sin(offsetAngle) * offsetMagnitude,
      };
      if (isPointInside(companionPoint.x, companionPoint.y)) {
        addPoint(companionPoint, false);
      }
    }
  }

  const pointsForTriangulation = Array.from(pointMap.values());

  if (pointsForTriangulation.length < 3) {
    return;
  }

  let triangleIndices: Uint32Array | Uint16Array;
  try {
    const delaunay = Delaunator.from(
      pointsForTriangulation,
      (p: Point) => p.x,
      (p: Point) => p.y
    );
    triangleIndices = delaunay.triangles;
  } catch (error) {
    try {
      debugLog('triangle-fill', 'delaunay_failed', error);
    } catch {}
    return;
  }

  ctx.save();
  if (isPreview) {
    ctx.beginPath();
    ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
    }
    ctx.closePath();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.imageSmoothingEnabled = !pixelMode;
    ctx.stroke();
  }

  const drawnEdges = new Set<string>();
  const drawnVertices = new Set<string>();
  const edgeKey = (p1: Point, p2: Point) => `${snap(p1.x)}-${snap(p1.y)}_${snap(p2.x)}-${snap(p2.y)}`;
  const vertexKey = (p: Point) => `${snap(p.x)}-${snap(p.y)}`;

  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    drawnEdges.add(edgeKey(current, next));
    drawnVertices.add(vertexKey(current));
  }

  const triangleArea = (p0: Point, p1: Point, p2: Point) => {
    return Math.abs(
      (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y)) / 2
    );
  };

  for (let i = 0; i < triangleIndices.length; i += 3) {
    const p0 = pointsForTriangulation[triangleIndices[i]];
    const p1 = pointsForTriangulation[triangleIndices[i + 1]];
    const p2 = pointsForTriangulation[triangleIndices[i + 2]];

    if (!p0 || !p1 || !p2) continue;

    const centroidRot = {
      x: (p0.x + p1.x + p2.x) / 3,
      y: (p0.y + p1.y + p2.y) / 3,
    };

    if (!isPointInside(centroidRot.x, centroidRot.y)) {
      continue;
    }

    if (triangleArea(p0, p1, p2) < 0.5) {
      continue;
    }

    const a = fromRotated(p0);
    const b = fromRotated(p1);
    const c = fromRotated(p2);

    const edges: Array<[Point, Point]> = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [p1World, p2World] of edges) {
      const key = edgeKey(p1World, p2World);
      if (drawnEdges.has(key)) continue;
      drawnEdges.add(key);

      ctx.beginPath();
      ctx.moveTo(snap(p1World.x), snap(p1World.y));
      ctx.lineTo(snap(p2World.x), snap(p2World.y));
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      drawnVertices.add(vertexKey(p1World));
      drawnVertices.add(vertexKey(p2World));
    }
  }

  ctx.restore();
};
