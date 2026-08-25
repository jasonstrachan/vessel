import {
  AUTO_CONVERT_MAX_FOCUS,
  AUTO_CONVERT_MAX_SHAPES,
  AUTO_CONVERT_MIN_FOCUS,
  AUTO_CONVERT_MIN_SHAPES,
} from '@/constants/colorCycleAutoConvert';

export type AutoConvertPoint = { x: number; y: number };

export type AutoConvertGradientStop = {
  position: number;
  color: string;
};

export type AutoConvertRegion = {
  points: AutoConvertPoint[];
  direction: AutoConvertPoint;
  linearGradientSpan: number;
  sampledStops: AutoConvertGradientStop[];
  pixelCount: number;
  detailScore: number;
};

export type AutoConvertRegionsResult = {
  regions: AutoConvertRegion[];
  analysisWidth: number;
  analysisHeight: number;
};

type AnalysisPixel = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type Cluster = {
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
};

type GridPoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const pointKey = (x: number, y: number): string => `${x}:${y}`;

const signedPolygonArea = (points: GridPoint[]): number => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
};

const distanceToSegmentSquared = (
  point: GridPoint,
  start: GridPoint,
  end: GridPoint,
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
};

const simplifyOpenPolyline = (points: GridPoint[], tolerance: number): GridPoint[] => {
  if (points.length <= 2) {
    return points;
  }
  const threshold = tolerance * tolerance;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegmentSquared(points[index], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (maxDistance <= threshold) {
    return [points[0], points[points.length - 1]];
  }
  const left = simplifyOpenPolyline(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyOpenPolyline(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
};

const simplifyClosedPolygon = (points: GridPoint[], tolerance: number): GridPoint[] => {
  if (points.length <= 4) {
    return points;
  }
  let splitIndex = 1;
  let farthest = -1;
  const anchor = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const distance = (points[index].x - anchor.x) ** 2 + (points[index].y - anchor.y) ** 2;
    if (distance > farthest) {
      farthest = distance;
      splitIndex = index;
    }
  }
  const first = simplifyOpenPolyline(points.slice(0, splitIndex + 1), tolerance);
  const second = simplifyOpenPolyline(
    [...points.slice(splitIndex), points[0]],
    tolerance,
  );
  const combined = [...first.slice(0, -1), ...second.slice(0, -1)];
  return combined.length >= 3 ? combined : points;
};

const buildAnalysisPixels = ({
  pixels,
  width,
  height,
  focus,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  focus: number;
}): { pixels: AnalysisPixel[]; width: number; height: number } => {
  const normalizedFocus = clamp(
    focus,
    AUTO_CONVERT_MIN_FOCUS,
    AUTO_CONVERT_MAX_FOCUS,
  ) / AUTO_CONVERT_MAX_FOCUS;
  const maxAnalysisDimension = Math.round(64 + 448 * normalizedFocus ** 1.5);
  const scale = Math.min(1, maxAnalysisDimension / Math.max(width, height));
  const analysisWidth = Math.max(1, Math.round(width * scale));
  const analysisHeight = Math.max(1, Math.round(height * scale));
  const analysisPixels: AnalysisPixel[] = new Array(analysisWidth * analysisHeight);

  for (let y = 0; y < analysisHeight; y += 1) {
    const sourceStartY = Math.floor((y * height) / analysisHeight);
    const sourceEndY = Math.max(sourceStartY + 1, Math.ceil(((y + 1) * height) / analysisHeight));
    for (let x = 0; x < analysisWidth; x += 1) {
      const sourceStartX = Math.floor((x * width) / analysisWidth);
      const sourceEndX = Math.max(sourceStartX + 1, Math.ceil(((x + 1) * width) / analysisWidth));
      let alphaTotal = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let sourceCount = 0;
      for (let sourceY = sourceStartY; sourceY < Math.min(height, sourceEndY); sourceY += 1) {
        for (let sourceX = sourceStartX; sourceX < Math.min(width, sourceEndX); sourceX += 1) {
          const offset = (sourceY * width + sourceX) * 4;
          const alpha = pixels[offset + 3];
          alphaTotal += alpha;
          redTotal += pixels[offset] * alpha;
          greenTotal += pixels[offset + 1] * alpha;
          blueTotal += pixels[offset + 2] * alpha;
          sourceCount += 1;
        }
      }
      const weightedDivisor = Math.max(1, alphaTotal);
      analysisPixels[y * analysisWidth + x] = {
        r: redTotal / weightedDivisor,
        g: greenTotal / weightedDivisor,
        b: blueTotal / weightedDivisor,
        a: alphaTotal / Math.max(1, sourceCount),
      };
    }
  }
  return { pixels: analysisPixels, width: analysisWidth, height: analysisHeight };
};

const colorDistance = (left: AnalysisPixel, right: AnalysisPixel): number => {
  const red = left.r - right.r;
  const green = left.g - right.g;
  const blue = left.b - right.b;
  return Math.sqrt(red * red * 0.3 + green * green * 0.59 + blue * blue * 0.11) / 255;
};

const buildDetailMap = (
  pixels: AnalysisPixel[],
  width: number,
  height: number,
): Float32Array => {
  const rawDetail = new Float32Array(pixels.length);
  const positiveValues: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixel = pixels[index];
      if (pixel.a <= 8) {
        continue;
      }
      let totalDifference = 0;
      let neighbourCount = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const neighbourX = x + offsetX;
          const neighbourY = y + offsetY;
          if (
            neighbourX < 0
            || neighbourY < 0
            || neighbourX >= width
            || neighbourY >= height
          ) {
            continue;
          }
          const neighbour = pixels[neighbourY * width + neighbourX];
          const alphaDifference = Math.abs(pixel.a - neighbour.a) / 255;
          const visibleWeight = Math.min(pixel.a, neighbour.a) / 255;
          totalDifference += colorDistance(pixel, neighbour) * visibleWeight
            + alphaDifference * 0.35;
          neighbourCount += 1;
        }
      }
      const value = neighbourCount > 0 ? totalDifference / neighbourCount : 0;
      rawDetail[index] = value;
      if (value > 0) {
        positiveValues.push(value);
      }
    }
  }
  if (positiveValues.length === 0) {
    return rawDetail;
  }
  positiveValues.sort((left, right) => left - right);
  const low = positiveValues[Math.floor((positiveValues.length - 1) * 0.1)];
  const high = positiveValues[Math.floor((positiveValues.length - 1) * 0.95)];
  const range = high - low;
  const normalized = new Float32Array(rawDetail.length);
  for (let index = 0; index < rawDetail.length; index += 1) {
    if (range > Number.EPSILON) {
      normalized[index] = clamp((rawDetail[index] - low) / range, 0, 1);
    } else {
      normalized[index] = rawDetail[index] > 0 ? 1 : 0;
    }
  }
  const expanded = new Float32Array(rawDetail.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (pixels[index].a <= 8) {
        continue;
      }
      let total = 0;
      let count = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const neighbourX = x + offsetX;
          const neighbourY = y + offsetY;
          if (
            neighbourX < 0
            || neighbourY < 0
            || neighbourX >= width
            || neighbourY >= height
          ) {
            continue;
          }
          total += normalized[neighbourY * width + neighbourX];
          count += 1;
        }
      }
      expanded[index] = count > 0 ? total / count : normalized[index];
    }
  }
  return expanded;
};

const selectInitialClusters = (
  pixels: AnalysisPixel[],
  width: number,
  height: number,
  requestedCount: number,
  detailMap: Float32Array,
  focus: number,
): Cluster[] => {
  const visibleIndices = pixels
    .map((pixel, index) => (pixel.a > 8 ? index : -1))
    .filter((index) => index >= 0);
  if (visibleIndices.length === 0) {
    return [];
  }
  const count = Math.min(requestedCount, visibleIndices.length);
  const centroid = visibleIndices.reduce(
    (accumulator, index) => ({
      x: accumulator.x + index % width,
      y: accumulator.y + Math.floor(index / width),
    }),
    { x: 0, y: 0 },
  );
  centroid.x /= visibleIndices.length;
  centroid.y /= visibleIndices.length;
  let firstIndex = visibleIndices[0];
  let firstDistance = Infinity;
  for (const index of visibleIndices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const distance = (x - centroid.x) ** 2 + (y - centroid.y) ** 2;
    if (distance < firstDistance) {
      firstDistance = distance;
      firstIndex = index;
    }
  }
  const seedIndices = [firstIndex];
  const minimumDistances = new Float64Array(width * height);
  minimumDistances.fill(Infinity);
  const focusBias = 24 * (
    clamp(focus, AUTO_CONVERT_MIN_FOCUS, AUTO_CONVERT_MAX_FOCUS)
      / AUTO_CONVERT_MAX_FOCUS
  ) ** 1.5;
  while (seedIndices.length < count) {
    const latest = seedIndices[seedIndices.length - 1];
    const latestX = latest % width;
    const latestY = Math.floor(latest / width);
    let nextIndex = visibleIndices[0];
    let nextDistance = -1;
    for (const index of visibleIndices) {
      const x = index % width;
      const y = Math.floor(index / width);
      const distance = (x - latestX) ** 2 + (y - latestY) ** 2;
      minimumDistances[index] = Math.min(minimumDistances[index], distance);
      const weightedDistance = minimumDistances[index]
        * (1 + focusBias * detailMap[index] ** 1.5);
      if (weightedDistance > nextDistance) {
        nextDistance = weightedDistance;
        nextIndex = index;
      }
    }
    seedIndices.push(nextIndex);
  }
  return seedIndices.map((index) => {
    const pixel = pixels[index];
    return {
      r: pixel.r,
      g: pixel.g,
      b: pixel.b,
      x: index % width,
      y: Math.floor(index / width),
    };
  });
};

const assignClusters = (
  pixels: AnalysisPixel[],
  width: number,
  height: number,
  clusters: Cluster[],
): Int16Array => {
  const labels = new Int16Array(width * height);
  labels.fill(-1);
  const spatialScale = 0.85 / Math.max(1, width * width + height * height);
  type Candidate = { index: number; clusterIndex: number; score: number };
  const heap: Candidate[] = [];
  const pushCandidate = (candidate: Candidate): void => {
    heap.push(candidate);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].score <= heap[index].score) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const popCandidate = (): Candidate | undefined => {
    const first = heap[0];
    const last = heap.pop();
    if (!first || !last || heap.length === 0) return first;
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].score < heap[smallest].score) smallest = left;
      if (right < heap.length && heap[right].score < heap[smallest].score) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
    return first;
  };
  const candidateScore = (index: number, clusterIndex: number): number => {
    const pixel = pixels[index];
    const cluster = clusters[clusterIndex];
    const x = index % width;
    const y = Math.floor(index / width);
    const colorDistance = pixel.a > 8
      ? (
          (pixel.r - cluster.r) ** 2 * 0.3
          + (pixel.g - cluster.g) ** 2 * 0.59
          + (pixel.b - cluster.b) ** 2 * 0.11
        ) / 65025
      : 0;
    const spatialDistance = ((x - cluster.x) ** 2 + (y - cluster.y) ** 2) * spatialScale;
    return colorDistance + spatialDistance;
  };
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  clusters.forEach((cluster, clusterIndex) => {
    const seedIndex = Math.round(cluster.y) * width + Math.round(cluster.x);
    pushCandidate({ index: seedIndex, clusterIndex, score: -1 });
  });
  while (heap.length > 0) {
    const candidate = popCandidate();
    if (!candidate || labels[candidate.index] >= 0) continue;
    labels[candidate.index] = candidate.clusterIndex;
    const x = candidate.index % width;
    const y = Math.floor(candidate.index / width);
    for (const [dx, dy] of neighbours) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const nextIndex = nextY * width + nextX;
      if (labels[nextIndex] < 0) {
        pushCandidate({
          index: nextIndex,
          clusterIndex: candidate.clusterIndex,
          score: candidateScore(nextIndex, candidate.clusterIndex),
        });
      }
    }
  }
  return labels;
};

const collectLargestClusterComponent = (
  labels: Int16Array,
  width: number,
  height: number,
  clusterIndex: number,
): number[] => {
  const visited = new Uint8Array(labels.length);
  let largest: number[] = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let start = 0; start < labels.length; start += 1) {
    if (visited[start] || labels[start] !== clusterIndex) {
      continue;
    }
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of neighbours) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }
        const nextIndex = nextY * width + nextX;
        if (!visited[nextIndex] && labels[nextIndex] === clusterIndex) {
          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }
    }
    if (component.length > largest.length) {
      largest = component;
    }
  }
  return largest;
};

const traceComponentBoundary = (
  component: number[],
  width: number,
  height: number,
): GridPoint[] => {
  const cells = new Set(component);
  const edges: Array<{ start: GridPoint; end: GridPoint }> = [];
  const hasCell = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && cells.has(y * width + x);
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!hasCell(x, y - 1)) edges.push({ start: { x, y }, end: { x: x + 1, y } });
    if (!hasCell(x + 1, y)) edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 } });
    if (!hasCell(x, y + 1)) edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 } });
    if (!hasCell(x - 1, y)) edges.push({ start: { x, y: y + 1 }, end: { x, y } });
  }
  const outgoing = new Map<string, Array<{ start: GridPoint; end: GridPoint }>>();
  for (const edge of edges) {
    const key = pointKey(edge.start.x, edge.start.y);
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  }
  const loops: GridPoint[][] = [];
  const used = new Set<string>();
  for (const edge of edges) {
    const edgeKey = `${pointKey(edge.start.x, edge.start.y)}>${pointKey(edge.end.x, edge.end.y)}`;
    if (used.has(edgeKey)) {
      continue;
    }
    const loop: GridPoint[] = [];
    let current = edge;
    const firstKey = pointKey(edge.start.x, edge.start.y);
    for (let guard = 0; guard <= edges.length; guard += 1) {
      const currentKey = `${pointKey(current.start.x, current.start.y)}>${pointKey(current.end.x, current.end.y)}`;
      if (used.has(currentKey)) {
        break;
      }
      used.add(currentKey);
      loop.push(current.start);
      const endKey = pointKey(current.end.x, current.end.y);
      if (endKey === firstKey) {
        break;
      }
      const next = (outgoing.get(endKey) ?? []).find((candidate) => {
        const candidateKey = `${endKey}>${pointKey(candidate.end.x, candidate.end.y)}`;
        return !used.has(candidateKey);
      });
      if (!next) {
        break;
      }
      current = next;
    }
    if (loop.length >= 3) {
      loops.push(loop);
    }
  }
  return loops.sort((a, b) => Math.abs(signedPolygonArea(b)) - Math.abs(signedPolygonArea(a)))[0] ?? [];
};

const toHex = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

const resolveComponentDetailScore = (
  component: number[],
  detailMap: Float32Array,
): number => {
  if (component.length === 0) {
    return 0;
  }
  const values = component
    .map((index) => detailMap[index])
    .sort((left, right) => left - right);
  const highDetailStart = Math.floor(values.length * 0.75);
  let total = 0;
  for (let index = highDetailStart; index < values.length; index += 1) {
    total += values[index];
  }
  return clamp(total / Math.max(1, values.length - highDetailStart), 0, 1);
};

const buildRegion = ({
  component,
  boundary,
  analysisPixels,
  detailMap,
  analysisWidth,
  analysisHeight,
  sourceWidth,
  sourceHeight,
  focus,
  maxColors,
}: {
  component: number[];
  boundary: GridPoint[];
  analysisPixels: AnalysisPixel[];
  detailMap: Float32Array;
  analysisWidth: number;
  analysisHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  focus: number;
  maxColors: number;
}): AutoConvertRegion | null => {
  if (boundary.length < 3 || component.length === 0) {
    return null;
  }
  const simplified = simplifyClosedPolygon(
    boundary,
    2.4 - clamp(focus, AUTO_CONVERT_MIN_FOCUS, AUTO_CONVERT_MAX_FOCUS) * 0.021,
  );
  if (simplified.length < 3) {
    return null;
  }
  const scaleX = sourceWidth / analysisWidth;
  const scaleY = sourceHeight / analysisHeight;
  const points = simplified.map((point) => ({
    x: clamp(point.x * scaleX, 0, sourceWidth),
    y: clamp(point.y * scaleY, 0, sourceHeight),
  }));

  let meanX = 0;
  let meanY = 0;
  for (const index of component) {
    meanX += (index % analysisWidth) + 0.5;
    meanY += Math.floor(index / analysisWidth) + 0.5;
  }
  meanX /= component.length;
  meanY /= component.length;
  let covarianceXX = 0;
  let covarianceXY = 0;
  let covarianceYY = 0;
  for (const index of component) {
    const dx = (index % analysisWidth) + 0.5 - meanX;
    const dy = Math.floor(index / analysisWidth) + 0.5 - meanY;
    covarianceXX += dx * dx;
    covarianceXY += dx * dy;
    covarianceYY += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  let directionX = Math.cos(angle);
  let directionY = Math.sin(angle);
  let projectionMin = Infinity;
  let projectionMax = -Infinity;
  let luminanceProjectionCovariance = 0;
  let meanLuminance = 0;
  for (const index of component) {
    const pixel = analysisPixels[index];
    meanLuminance += pixel.r * 0.299 + pixel.g * 0.587 + pixel.b * 0.114;
  }
  meanLuminance /= component.length;
  for (const index of component) {
    const x = (index % analysisWidth) + 0.5;
    const y = Math.floor(index / analysisWidth) + 0.5;
    const projection = (x - meanX) * directionX + (y - meanY) * directionY;
    projectionMin = Math.min(projectionMin, projection);
    projectionMax = Math.max(projectionMax, projection);
    const pixel = analysisPixels[index];
    const luminance = pixel.r * 0.299 + pixel.g * 0.587 + pixel.b * 0.114;
    luminanceProjectionCovariance += projection * (luminance - meanLuminance);
  }
  const shouldFlipDirection = luminanceProjectionCovariance < 0;
  if (shouldFlipDirection) {
    directionX *= -1;
    directionY *= -1;
  }
  const orientedProjectionMin = shouldFlipDirection ? -projectionMax : projectionMin;
  const orientedProjectionMax = shouldFlipDirection ? -projectionMin : projectionMax;
  const projectionSpan = Math.max(1, orientedProjectionMax - orientedProjectionMin);
  const binCount = clamp(Math.round(maxColors), 2, 16);
  const bins = Array.from({ length: binCount }, () => ({ r: 0, g: 0, b: 0, weight: 0 }));
  for (const index of component) {
    const x = (index % analysisWidth) + 0.5;
    const y = Math.floor(index / analysisWidth) + 0.5;
    const rawProjection = (x - meanX) * directionX + (y - meanY) * directionY;
    const orientedProjection = shouldFlipDirection ? -rawProjection : rawProjection;
    const normalized = clamp(
      (orientedProjection - orientedProjectionMin) / projectionSpan,
      0,
      1,
    );
    const binIndex = Math.min(binCount - 1, Math.floor(normalized * binCount));
    const pixel = analysisPixels[index];
    const weight = pixel.a / 255;
    bins[binIndex].r += pixel.r * weight;
    bins[binIndex].g += pixel.g * weight;
    bins[binIndex].b += pixel.b * weight;
    bins[binIndex].weight += weight;
  }
  const sampledStops = bins
    .map((bin, index) => {
      if (bin.weight <= 0) {
        return null;
      }
      return {
        position: binCount === 1 ? 0 : index / (binCount - 1),
        color: `#${toHex(bin.r / bin.weight)}${toHex(bin.g / bin.weight)}${toHex(bin.b / bin.weight)}`,
      };
    })
    .filter((stop): stop is AutoConvertGradientStop => Boolean(stop));
  if (sampledStops.length === 1) {
    sampledStops.push({ ...sampledStops[0], position: 1 });
    sampledStops[0] = { ...sampledStops[0], position: 0 };
  } else if (sampledStops.length > 1) {
    const firstPosition = sampledStops[0].position;
    const lastPosition = sampledStops[sampledStops.length - 1].position;
    const positionSpan = Math.max(Number.EPSILON, lastPosition - firstPosition);
    sampledStops.forEach((stop) => {
      stop.position = (stop.position - firstPosition) / positionSpan;
    });
  }
  const sourceDirectionLength = Math.max(
    1,
    projectionSpan * Math.hypot(directionX * scaleX, directionY * scaleY) / 2,
  );
  return {
    points,
    direction: {
      x: directionX * sourceDirectionLength,
      y: directionY * sourceDirectionLength,
    },
    linearGradientSpan: sourceDirectionLength * 2,
    sampledStops,
    pixelCount: component.length,
    detailScore: resolveComponentDetailScore(component, detailMap),
  };
};

export const extractAutoConvertRegions = ({
  pixels,
  width,
  height,
  targetShapes,
  focus,
  maxColors = 5,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  targetShapes: number;
  focus: number;
  maxColors?: number;
}): AutoConvertRegionsResult => {
  if (width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    throw new Error('Invalid source image for Color Cycle auto conversion');
  }
  const analysis = buildAnalysisPixels({ pixels, width, height, focus });
  const detailMap = buildDetailMap(analysis.pixels, analysis.width, analysis.height);
  const clusters = selectInitialClusters(
    analysis.pixels,
    analysis.width,
    analysis.height,
    clamp(
      Math.round(targetShapes),
      AUTO_CONVERT_MIN_SHAPES,
      AUTO_CONVERT_MAX_SHAPES,
    ),
    detailMap,
    focus,
  );
  if (clusters.length === 0) {
    return {
      regions: [],
      analysisWidth: analysis.width,
      analysisHeight: analysis.height,
    };
  }
  const labels = assignClusters(analysis.pixels, analysis.width, analysis.height, clusters);
  const regions: AutoConvertRegion[] = [];
  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
    const component = collectLargestClusterComponent(
      labels,
      analysis.width,
      analysis.height,
      clusterIndex,
    );
    const boundary = traceComponentBoundary(component, analysis.width, analysis.height);
    const region = buildRegion({
      component,
      boundary,
      analysisPixels: analysis.pixels,
      detailMap,
      analysisWidth: analysis.width,
      analysisHeight: analysis.height,
      sourceWidth: width,
      sourceHeight: height,
      focus,
      maxColors,
    });
    if (region) {
      regions.push(region);
    }
  }
  regions.sort((a, b) => b.pixelCount - a.pixelCount);
  return {
    regions,
    analysisWidth: analysis.width,
    analysisHeight: analysis.height,
  };
};
