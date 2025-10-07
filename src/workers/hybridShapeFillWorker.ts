import earcut from 'earcut';
import ClipperLib from 'clipper-lib';
import type {
  BuildRequest,
  Fill,
  FillContour,
  FillImage,
  FillLinear,
  FillSolid,
  Mesh,
  MeshLayout,
  SerializedPath,
  WorkerMessage,
  WorkerResponse,
} from '@/lib/shapeFill/hybrid/types';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const PREVIEW_VERTEX_TOLERANCE = 0.5;
const PREVIEW_MAX_RINGS = 16;
const CLIPPER_SCALE = 1024;
const MIN_TRI_VERTEX_COUNT = 3;

const EMPTY_MESH: Mesh = {
  verts: new Float32Array(),
  indices: new Uint32Array(),
  layout: 'pos2',
  aabb: [0, 0, 0, 0],
  revision: 0,
};

type Ring = Float64Array;

type Polygon = {
  outer: Ring;
  holes: Ring[];
};

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const createEmptyMesh = (revision: number): Mesh => ({
  ...EMPTY_MESH,
  revision,
});

const closeAndNormalizeRing = (points: number[]): Ring | null => {
  if (points.length < MIN_TRI_VERTEX_COUNT * 2) {
    return null;
  }

  const firstX = points[0];
  const firstY = points[1];
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];

  if (Math.abs(firstX - lastX) < 1e-6 && Math.abs(firstY - lastY) < 1e-6) {
    points.length -= 2;
  }

  if (points.length < MIN_TRI_VERTEX_COUNT * 2) {
    return null;
  }

  return Float64Array.from(points);
};

const parsePath = (path: SerializedPath): Polygon | null => {
  const { commands, data } = path;
  let dataIndex = 0;
  let active: number[] | null = null;
  const rings: Ring[] = [];

  for (const command of commands) {
    switch (command) {
      case 'moveTo': {
        if (active) {
          const ring = closeAndNormalizeRing(active);
          if (ring) {
            rings.push(ring);
          }
        }
        const x = data[dataIndex++];
        const y = data[dataIndex++];
        if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
          active = null;
          break;
        }
        active = [x, y];
        break;
      }
      case 'lineTo': {
        if (!active) {
          dataIndex += 2;
          break;
        }
        const x = data[dataIndex++];
        const y = data[dataIndex++];
        if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
          break;
        }
        active.push(x, y);
        break;
      }
      case 'closePath': {
        if (active) {
          const ring = closeAndNormalizeRing(active);
          if (ring) {
            rings.push(ring);
          }
        }
        active = null;
        break;
      }
      default: {
        // Skip unsupported commands but keep data index in sync if needed later.
        break;
      }
    }
  }

  if (active) {
    const ring = closeAndNormalizeRing(active);
    if (ring) {
      rings.push(ring);
    }
  }

  if (!rings.length) {
    return null;
  }

  const [outer, ...holes] = rings;
  return { outer, holes };
};

const polygonSignedArea = (ring: Ring): number => {
  let area = 0;
  const length = ring.length;
  if (length < 6) {
    return 0;
  }
  for (let i = 0, j = length - 2; i < length; i += 2) {
    const x0 = ring[j];
    const y0 = ring[j + 1];
    const x1 = ring[i];
    const y1 = ring[i + 1];
    area += x0 * y1 - x1 * y0;
    j = i;
  }
  return area * 0.5;
};

const ensureOrientation = (ring: Ring, positive: boolean): Ring => {
  const area = polygonSignedArea(ring);
  if ((positive && area < 0) || (!positive && area > 0)) {
    const reversed = new Float64Array(ring.length);
    const lastIndex = ring.length - 2;
    for (let i = 0; i < ring.length; i += 2) {
      const sourceIndex = lastIndex - i;
      reversed[i] = ring[sourceIndex];
      reversed[i + 1] = ring[sourceIndex + 1];
    }
    return reversed;
  }
  return ring;
};

const decimateRing = (ring: Ring, tolerance: number): Ring => {
  if (ring.length <= 6) {
    return ring;
  }

  const toleranceSq = tolerance * tolerance;
  const result: number[] = [];
  let prevX = ring[0];
  let prevY = ring[1];
  result.push(prevX, prevY);

  for (let i = 2; i < ring.length; i += 2) {
    const x = ring[i];
    const y = ring[i + 1];
    const dx = x - prevX;
    const dy = y - prevY;
    if (dx * dx + dy * dy >= toleranceSq) {
      result.push(x, y);
      prevX = x;
      prevY = y;
    }
  }

  if (result.length < 6) {
    return ring;
  }

  return Float64Array.from(result);
};

const limitPreviewRings = (polygons: Polygon[]): Polygon[] => {
  let remaining = PREVIEW_MAX_RINGS;
  const limited: Polygon[] = [];

  for (const polygon of polygons) {
    if (remaining <= 0) {
      break;
    }

    const holes: Ring[] = [];
    for (const hole of polygon.holes) {
      if (remaining <= 1) {
        break;
      }
      holes.push(hole);
      remaining -= 1;
    }

    limited.push({
      outer: polygon.outer,
      holes,
    });
    remaining -= 1;
  }

  return limited;
};

const parsePaths = (paths: SerializedPath[], preview: boolean): Polygon[] => {
  const polygons: Polygon[] = [];
  for (const path of paths) {
    const polygon = parsePath(path);
    if (!polygon) {
      continue;
    }
    polygons.push(polygon);
  }

  if (preview) {
    const decimated = polygons.map(polygon => ({
      outer: decimateRing(polygon.outer, PREVIEW_VERTEX_TOLERANCE),
      holes: polygon.holes.map(hole => decimateRing(hole, PREVIEW_VERTEX_TOLERANCE)),
    }));
    return limitPreviewRings(decimated);
  }

  return polygons;
};

const flattenPolygon = (polygon: Polygon): {
  vertices: number[];
  holes: number[];
} => {
  const vertices: number[] = [];
  const holes: number[] = [];

  const outer = ensureOrientation(polygon.outer, true);
  vertices.push(...outer);

  for (const hole of polygon.holes) {
    holes.push(vertices.length / 2);
    const orientedHole = ensureOrientation(hole, false);
    vertices.push(...orientedHole);
  }

  return { vertices, holes };
};

const computeAabb = (positions: number[]): [number, number, number, number] => {
  if (!positions.length) {
    return [0, 0, 0, 0];
  }

  let minX = positions[0];
  let minY = positions[1];
  let maxX = positions[0];
  let maxY = positions[1];

  for (let i = 2; i < positions.length; i += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return [minX, minY, maxX, maxY];
};

const computeUvs = (positions: number[], fill: FillImage): Float32Array => {
  const uvs = new Float32Array((positions.length / 2) * 2);
  if (!positions.length) {
    return uvs;
  }

  const [minX, minY, maxX, maxY] = computeAabb(positions);
  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);

  let scaleX = 1 / width;
  let scaleY = 1 / height;
  let offsetU = 0;
  let offsetV = 0;

  if (fill.uv === 'contain' || fill.uv === 'cover') {
    const uniformScale = fill.uv === 'contain'
      ? Math.min(scaleX, scaleY)
      : Math.max(scaleX, scaleY);
    const scaledWidth = width * uniformScale;
    const scaledHeight = height * uniformScale;
    offsetU = (1 - scaledWidth) * 0.5;
    offsetV = (1 - scaledHeight) * 0.5;
    scaleX = uniformScale;
    scaleY = uniformScale;
  }

  const tx = fill.tx;
  const hasTransform = tx && tx.length >= 6;

  for (let i = 0, j = 0; i < positions.length; i += 2, j += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    let u = (x - minX) * scaleX + offsetU;
    let v = (y - minY) * scaleY + offsetV;

    if (hasTransform) {
      const m = tx as Float32Array;
      const uPrime = m[0] * u + m[1] * v + m[2];
      const vPrime = m[3] * u + m[4] * v + m[5];
      u = uPrime;
      v = vPrime;
    }

    uvs[j] = u;
    uvs[j + 1] = v;
  }

  return uvs;
};

const buildMeshFromPolygons = (
  polygons: Polygon[],
  layout: MeshLayout,
  fill: Fill | null,
  revision: number
): Mesh => {
  if (!polygons.length) {
    return createEmptyMesh(revision);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const polygon of polygons) {
    const { vertices, holes } = flattenPolygon(polygon);
    if (vertices.length < MIN_TRI_VERTEX_COUNT * 2) {
      continue;
    }
    const localIndices = earcut(vertices, holes, 2);
    if (!localIndices.length) {
      continue;
    }
    for (const index of localIndices) {
      indices.push(vertexOffset + index);
    }
    positions.push(...vertices);
    vertexOffset += vertices.length / 2;
  }

  if (!indices.length || !positions.length) {
    return createEmptyMesh(revision);
  }

  const vertexCount = positions.length / 2;
  const stride = layout === 'pos2uv2' ? 4 : 2;
  const verts = new Float32Array(vertexCount * stride);

  if (layout === 'pos2uv2' && fill && fill.type === 'image') {
    const uvs = computeUvs(positions, fill);
    for (let i = 0, j = 0; i < vertexCount; i += 1, j += 1) {
      const posIndex = i * 2;
      const vertIndex = i * stride;
      verts[vertIndex] = positions[posIndex];
      verts[vertIndex + 1] = positions[posIndex + 1];
      verts[vertIndex + 2] = uvs[posIndex];
      verts[vertIndex + 3] = uvs[posIndex + 1];
    }
  } else {
    for (let i = 0; i < vertexCount; i += 1) {
      const posIndex = i * 2;
      const vertIndex = i * stride;
      verts[vertIndex] = positions[posIndex];
      verts[vertIndex + 1] = positions[posIndex + 1];
    }
  }

  return {
    verts,
    indices: new Uint32Array(indices),
    layout,
    aabb: computeAabb(positions),
    revision,
  };
};

const mapJoinType = (join: FillContour['join']) => {
  switch (join) {
    case 'round':
      return ClipperLib.JoinType.jtRound;
    case 'bevel':
      return ClipperLib.JoinType.jtSquare;
    case 'miter':
    default:
      return ClipperLib.JoinType.jtMiter;
  }
};

const toClipperPath = (ring: Ring): ClipperLib.Path => {
  const path = new ClipperLib.Path();
  for (let i = 0; i < ring.length; i += 2) {
    path.push({
      X: Math.round(ring[i] * CLIPPER_SCALE),
      Y: Math.round(ring[i + 1] * CLIPPER_SCALE),
    });
  }
  return path;
};

const fromClipperPath = (path: ClipperLib.Path): Ring => {
  const ring: number[] = [];
  for (const point of path) {
    ring.push(point.X / CLIPPER_SCALE, point.Y / CLIPPER_SCALE);
  }
  return Float64Array.from(ring);
};

const buildContourPolygons = (polygons: Polygon[], fill: FillContour): Polygon[] => {
  const joinType = mapJoinType(fill.join);
  const offsetter = new ClipperLib.ClipperOffset(fill.miterLimit, 0.25);
  const delta = -Math.max(0.5, fill.spacing) * CLIPPER_SCALE;

  const contourPolygons: Polygon[] = [];

  for (const polygon of polygons) {
    const outerPath = toClipperPath(polygon.outer);
    const holePaths = polygon.holes.map(toClipperPath);

    const paths = new ClipperLib.Paths();
    paths.push(outerPath);
    for (const hole of holePaths) {
      paths.push(hole);
    }

    offsetter.Clear();
    offsetter.AddPath(outerPath, joinType, ClipperLib.EndType.etClosedPolygon);
    const innerPaths = new ClipperLib.Paths();
    offsetter.Execute(innerPaths, delta);

    if (innerPaths.length) {
      const innerRing = fromClipperPath(innerPaths[0]);
      contourPolygons.push({
        outer: polygon.outer,
        holes: [innerRing, ...polygon.holes],
      });
    } else {
      contourPolygons.push(polygon);
    }
  }

  return contourPolygons;
};

const buildSolidMesh = (polygons: Polygon[], fill: FillSolid, revision: number): Mesh => {
  void fill;
  return buildMeshFromPolygons(polygons, 'pos2', null, revision);
};

const buildLinearMesh = (polygons: Polygon[], fill: FillLinear, revision: number): Mesh => {
  void fill;
  return buildMeshFromPolygons(polygons, 'pos2', null, revision);
};

const buildImageMesh = (polygons: Polygon[], fill: FillImage, revision: number): Mesh => {
  return buildMeshFromPolygons(polygons, 'pos2uv2', fill, revision);
};

const buildContourMesh = (polygons: Polygon[], fill: FillContour, revision: number): Mesh => {
  const contourPolygons = buildContourPolygons(polygons, fill);
  return buildMeshFromPolygons(contourPolygons, 'pos2', fill.base, revision);
};

const handleBuild = (message: BuildRequest): WorkerResponse => {
  const polygons = parsePaths(message.paths, message.preview);
  if (!polygons.length) {
    return {
      kind: 'mesh',
      mesh: createEmptyMesh(message.revision),
      preview: message.preview,
    };
  }

  let mesh: Mesh;
  const fill = message.fill as Fill;

  switch (fill.type) {
    case 'solid':
      mesh = buildSolidMesh(polygons, fill, message.revision);
      break;
    case 'linear':
      mesh = buildLinearMesh(polygons, fill, message.revision);
      break;
    case 'image':
      mesh = buildImageMesh(polygons, fill, message.revision);
      break;
    case 'contour':
      mesh = buildContourMesh(polygons, fill, message.revision);
      break;
    default:
      mesh = createEmptyMesh(message.revision);
      break;
  }

  return {
    kind: 'mesh',
    mesh,
    preview: message.preview,
  };
};

ctx.addEventListener('message', event => {
  const message = event.data as WorkerMessage;
  if (message.kind !== 'build') {
    return;
  }

  try {
    const response = handleBuild(message);
    const transfers: Transferable[] = [];
    if (response.mesh.verts.byteLength) {
      transfers.push(response.mesh.verts.buffer);
    }
    if (response.mesh.indices.byteLength) {
      transfers.push(response.mesh.indices.buffer);
    }
    ctx.postMessage(response, transfers);
  } catch (error) {
    console.error('[HybridShapeFillWorker] build failed', error);
    const response: WorkerResponse = {
      kind: 'mesh',
      mesh: createEmptyMesh(message.revision),
      preview: message.preview,
    };
    ctx.postMessage(response);
  }
});

export {};
