import type { BoundingBox } from '../types';
import type { ContourPoint, ContourLoopResult } from './contourGeometry';

const FLOATS_PER_VERTEX = 4;
const VERTICES_PER_SEGMENT = 6; // two triangles per quad

export interface ContourMeshOptions {
  bounds: BoundingBox;
  pixelMode: boolean;
  baseLineWidth: number;
  alternateLineWidth?: number;
  alternateStride?: number;
  tolerance?: number;
}

export interface CpuQuadGeometry {
  vertexData: Float32Array;
  vertexCount: number;
  quadCount: number;
  layout: 'pos2uv2';
  coordinateSpace: 'canvas' | 'ndc';
}

export const buildContourMesh = (
  loops: ContourLoopResult[],
  options: ContourMeshOptions,
): CpuQuadGeometry | null => {
  if (!loops.length) {
    return null;
  }

  const segments: Array<{ a: ContourPoint; b: ContourPoint; level: number }> = [];
  const tolerance = Math.max(1e-3, options.tolerance ?? 1e-3);
  const closureThreshold = Math.max(tolerance * 4, 4);

  loops.forEach(loop => {
    const points = loop.loop;
    if (points.length < 2) {
      return;
    }
    const closingDistance = Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    );
    const segmentCount = closingDistance <= closureThreshold ? points.length : points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const nextIndex = index + 1 === points.length ? 0 : index + 1;
      const a = points[index];
      const b = points[nextIndex];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) < tolerance && Math.abs(dy) < tolerance) {
        continue;
      }
      segments.push({ a, b, level: loop.level });
    }
  });

  if (!segments.length) {
    return null;
  }

  const quadCount = segments.length;
  const vertexCount = quadCount * VERTICES_PER_SEGMENT;
  const vertexData = new Float32Array(vertexCount * FLOATS_PER_VERTEX);

  let writeOffset = 0;
  segments.forEach(({ a, b, level }) => {
    const dirX = b.x - a.x;
    const dirY = b.y - a.y;
    const length = Math.hypot(dirX, dirY) || 1e-6;
    const ux = dirX / length;
    const uy = dirY / length;
    const nx = -uy;
    const ny = ux;

    const useAlt = options.alternateStride && options.alternateStride > 0 && options.alternateLineWidth
      ? (level % options.alternateStride === 0)
      : false;
    const width = Math.max(1e-3, (useAlt ? options.alternateLineWidth ?? options.baseLineWidth : options.baseLineWidth) * 0.5);

    const axPos = a.x + nx * width;
    const ayPos = a.y + ny * width;
    const bxPos = b.x + nx * width;
    const byPos = b.y + ny * width;
    const cxPos = b.x - nx * width;
    const cyPos = b.y - ny * width;
    const dxPos = a.x - nx * width;
    const dyPos = a.y - ny * width;

    const writeVertex = (px: number, py: number, uvx: number, uvy: number) => {
      vertexData[writeOffset++] = px;
      vertexData[writeOffset++] = py;
      vertexData[writeOffset++] = uvx;
      vertexData[writeOffset++] = uvy;
    };

    writeVertex(axPos, ayPos, 0, 1);
    writeVertex(bxPos, byPos, 1, 1);
    writeVertex(cxPos, cyPos, 1, -1);
    writeVertex(axPos, ayPos, 0, 1);
    writeVertex(cxPos, cyPos, 1, -1);
    writeVertex(dxPos, dyPos, 0, -1);
  });

  return {
    vertexData,
    vertexCount,
    quadCount,
    layout: 'pos2uv2',
    coordinateSpace: 'canvas',
  };
};

export type { ContourLoopResult } from './contourGeometry';
