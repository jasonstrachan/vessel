import { fillConcentricToBuffer } from '@/utils/colorCycle/concentricFillCore';

type Point = { x: number; y: number };

const pointInPolygon = (point: Point, vertices: Point[]) => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersect = yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const sampleFill = async (vertices: Point[]) => {
  const bbox = { minX: 0, minY: 0, width: 96, height: 96 };
  const buffer = await fillConcentricToBuffer({
    vertices,
    bbox,
    bands: 12,
    baseOffset: 0,
    maxDist: Math.hypot(bbox.width, bbox.height),
    ditherEnabled: false,
    ditherStrength: 0,
    ditherPixelSize: 1,
    noiseSeed: 0,
  });
  return { bbox, buffer };
};

describe('fillConcentricToBuffer', () => {
  it('produces higher indices near the center of a square polygon', async () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const bbox = { minX: 0, minY: 0, width: 5, height: 5 };
    const buffer = await fillConcentricToBuffer({
      vertices,
      bbox,
      bands: 4,
      baseOffset: 0,
      maxDist: 10,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 0.5,
    });

    expect(buffer).toHaveLength(bbox.width * bbox.height);
    const centerIndex = buffer[2 * bbox.width + 2];
    const uniqueValues = new Set(buffer);
    expect(centerIndex).toBeGreaterThan(0);
    expect(uniqueValues.size).toBeGreaterThan(1);
  });

  it('matches even-odd fill for a concave polygon', async () => {
    const concave: Point[] = [
      { x: 16, y: 16 },
      { x: 80, y: 20 },
      { x: 68, y: 44 },
      { x: 90, y: 80 },
      { x: 48, y: 70 },
      { x: 24, y: 88 },
      { x: 32, y: 52 },
    ];
    const { bbox, buffer } = await sampleFill(concave);
    let mismatches = 0;
    for (let y = 0; y < bbox.height; y++) {
      for (let x = 0; x < bbox.width; x++) {
        const idx = y * bbox.width + x;
        const inside = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, concave);
        const actual = buffer[idx] > 0;
        if (actual !== inside) mismatches++;
      }
    }
    const tolerance = bbox.width * bbox.height * 0.03;
    expect(mismatches).toBeLessThanOrEqual(tolerance);
  });

  it('matches even-odd fill for a self-touching star polygon', async () => {
    const center = 48;
    const outer = 40;
    const inner = 14;
    const vertices: Point[] = [];
    for (let i = 0; i < 10; i++) {
      const theta = (i / 10) * Math.PI * 2;
      const radius = i % 2 === 0 ? outer : inner;
      vertices.push({
        x: center + Math.cos(theta) * radius,
        y: center + Math.sin(theta) * radius,
      });
    }
    const { bbox, buffer } = await sampleFill(vertices);
    let mismatches = 0;
    for (let y = 0; y < bbox.height; y++) {
      for (let x = 0; x < bbox.width; x++) {
        const idx = y * bbox.width + x;
        const inside = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, vertices);
        const actual = buffer[idx] > 0;
        if (actual !== inside) mismatches++;
      }
    }
    const tolerance = bbox.width * bbox.height * 0.04;
    expect(mismatches).toBeLessThanOrEqual(tolerance);
  });
});
