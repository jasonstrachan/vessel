import { BoundingBox, FieldGeneratorConfig, StrokeJob, TileDescriptor } from './types';

const DEFAULT_TILE_SIZE = 1024;
const DEFAULT_TILE_OVERLAP = 64;
const DEFAULT_MARGIN = 96;
const DEFAULT_RESOLUTION = 1;

export const ensureFloat32Vertices = (
  vertices: StrokeJob['vertices'],
  pixelMode = true
): Float32Array => {
  if (vertices instanceof Float32Array) {
    if (!pixelMode) {
      return vertices;
    }
    const snapped = new Float32Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) {
      snapped[i] = Math.round(vertices[i]);
    }
    return snapped;
  }

  const out = new Float32Array(vertices.length * 2);
  for (let i = 0; i < vertices.length; i++) {
    const vx = pixelMode ? Math.round(vertices[i].x) : vertices[i].x;
    const vy = pixelMode ? Math.round(vertices[i].y) : vertices[i].y;
    out[i * 2] = vx;
    out[i * 2 + 1] = vy;
  }
  return out;
};

export const computeBoundingBox = (vertices: Float32Array): BoundingBox => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < vertices.length; i += 2) {
    const x = vertices[i];
    const y = vertices[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return { minX, minY, maxX, maxY };
};

export const expandBoundingBox = (bounds: BoundingBox, margin: number): BoundingBox => ({
  minX: bounds.minX - margin,
  minY: bounds.minY - margin,
  maxX: bounds.maxX + margin,
  maxY: bounds.maxY + margin,
});

export const computeTiles = (
  bounds: BoundingBox,
  config: FieldGeneratorConfig,
  strokeCenter: { x: number; y: number }
): TileDescriptor[] => {
  const tileSize = config.tileSize ?? DEFAULT_TILE_SIZE;
  const overlap = config.overlap ?? DEFAULT_TILE_OVERLAP;
  const margin = config.margin ?? DEFAULT_MARGIN;
  const resolution = config.defaultResolution ?? DEFAULT_RESOLUTION;
  const effectiveOverlap = Math.min(overlap, tileSize / 2);
  const step = Math.max(1, tileSize - effectiveOverlap);

  const expanded = expandBoundingBox(bounds, margin);

  const startX = expanded.minX - effectiveOverlap;
  const startY = expanded.minY - effectiveOverlap;
  const endX = expanded.maxX + effectiveOverlap;
  const endY = expanded.maxY + effectiveOverlap;

  const rawTiles: TileDescriptor[] = [];
  for (let y = startY; y <= endY; y += step) {
    for (let x = startX; x <= endX; x += step) {
      const gridWidth = Math.ceil(tileSize / resolution);
      const gridHeight = Math.ceil(tileSize / resolution);
      rawTiles.push({
        id: `${x}:${y}`,
        origin: { x, y },
        size: { x: tileSize, y: tileSize },
        resolution,
        gridWidth,
        gridHeight,
        overlap: effectiveOverlap,
        order: 0,
      });
    }
  }

  const centerX = strokeCenter.x;
  const centerY = strokeCenter.y;

  const sorted = rawTiles
    .map(tile => {
      const tileCenterX = tile.origin.x + tile.size.x * 0.5;
      const tileCenterY = tile.origin.y + tile.size.y * 0.5;
      const distance = Math.hypot(tileCenterX - centerX, tileCenterY - centerY);
      return { tile, distance };
    })
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      if (a.tile.origin.y !== b.tile.origin.y) {
        return a.tile.origin.y - b.tile.origin.y;
      }
      return a.tile.origin.x - b.tile.origin.x;
    })
    .map((entry, index) => ({
      ...entry.tile,
      order: index,
    }));

  return sorted;
};

export interface PreparedStrokeGeometry {
  vertices: Float32Array;
  bounds: BoundingBox;
  tiles: TileDescriptor[];
  resolution: number;
}

export const prepareStrokeGeometry = (
  job: StrokeJob,
  config: FieldGeneratorConfig = {}
): PreparedStrokeGeometry => {
  const pixelMode = job.pixelMode ?? true;
  const vertices = ensureFloat32Vertices(job.vertices, pixelMode);
  if (vertices.length < 6) {
    throw new Error('StrokeJob requires at least three vertices');
  }

  const bounds = job.bounds ?? computeBoundingBox(vertices);
  const resolution = job.previewResolution?.fieldResolution ??
    job.finalResolution?.fieldResolution ??
    config.defaultResolution ??
    DEFAULT_RESOLUTION;

  const centroid = {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
  };

  const tiles = computeTiles(bounds, { ...config, defaultResolution: resolution }, centroid);

  return {
    vertices,
    bounds,
    tiles,
    resolution,
  };
};
