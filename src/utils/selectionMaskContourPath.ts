type Segment = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const defaultSelectionMaskContourPathCache = new WeakMap<ImageData, Path2D>();

const alphaAt = (mask: ImageData, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return 0;
  }
  return mask.data[(y * mask.width + x) * 4 + 3];
};

const buildMaskBoundarySegments = (mask: ImageData): Segment[] => {
  const segments: Segment[] = [];
  const { width, height } = mask;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(mask, x, y) === 0) {
        continue;
      }

      if (alphaAt(mask, x - 1, y) === 0) {
        segments.push({ startX: x, startY: y + 1, endX: x, endY: y });
      }
      if (alphaAt(mask, x + 1, y) === 0) {
        segments.push({ startX: x + 1, startY: y, endX: x + 1, endY: y + 1 });
      }
      if (alphaAt(mask, x, y - 1) === 0) {
        segments.push({ startX: x, startY: y, endX: x + 1, endY: y });
      }
      if (alphaAt(mask, x, y + 1) === 0) {
        segments.push({ startX: x + 1, startY: y + 1, endX: x, endY: y + 1 });
      }
    }
  }

  return segments;
};

const buildContourPathFromSegments = (segments: Segment[]): Path2D => {
  const path = new Path2D();
  const segmentsByStart = new Map<string, number[]>();

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const key = `${segment.startX},${segment.startY}`;
    const bucket = segmentsByStart.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      segmentsByStart.set(key, [i]);
    }
  }

  const visited = new Uint8Array(segments.length);
  for (let i = 0; i < segments.length; i += 1) {
    if (visited[i]) {
      continue;
    }

    let currentIndex = i;
    const first = segments[currentIndex];
    const loopStartX = first.startX;
    const loopStartY = first.startY;
    path.moveTo(loopStartX, loopStartY);

    let guard = 0;
    while (guard < segments.length + 1) {
      guard += 1;
      if (visited[currentIndex]) {
        break;
      }

      visited[currentIndex] = 1;
      const current = segments[currentIndex];
      path.lineTo(current.endX, current.endY);

      if (current.endX === loopStartX && current.endY === loopStartY) {
        break;
      }

      const nextKey = `${current.endX},${current.endY}`;
      const nextCandidates = segmentsByStart.get(nextKey);
      if (!nextCandidates || nextCandidates.length === 0) {
        break;
      }

      const nextIndex = nextCandidates.find((candidate) => !visited[candidate]);
      if (nextIndex == null) {
        break;
      }

      currentIndex = nextIndex;
    }
  }

  return path;
};

export const createSelectionMaskContourPath = (mask: ImageData): Path2D => {
  const segments = buildMaskBoundarySegments(mask);
  return buildContourPathFromSegments(segments);
};

export const getSelectionMaskContourPath = (
  mask: ImageData,
  cache: WeakMap<ImageData, Path2D> = defaultSelectionMaskContourPathCache,
): Path2D => {
  const cached = cache.get(mask);
  if (cached) {
    return cached;
  }

  const path = createSelectionMaskContourPath(mask);
  cache.set(mask, path);
  return path;
};

