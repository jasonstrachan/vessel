import { createSignedDistanceField, generateContourLoops } from '../contourGeometry';
import { buildContourMesh } from '../contourMesh';

describe('Contour geometry CPU helpers', () => {
  const squareVertices = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('generates contour loops for a simple square', () => {
    const field = createSignedDistanceField(squareVertices, {
      canvasWidth: 20,
      canvasHeight: 20,
      resolution: 1,
      extension: 0,
      seed: 1,
    });

    const loops = generateContourLoops(field, {
      spacing: 2,
      variance: 0,
      smoothness: 0,
      maxLevels: 3,
      maxDistance: 6,
      seed: 1,
    });

    expect(loops.length).toBeGreaterThan(0);
    loops.forEach(loop => {
      expect(loop.loop.length).toBeGreaterThan(2);
    });
  });

  it('builds quad mesh data from contour loops', () => {
    const field = createSignedDistanceField(squareVertices, {
      canvasWidth: 20,
      canvasHeight: 20,
      resolution: 1,
      extension: 0,
      seed: 2,
    });

    const loops = generateContourLoops(field, {
      spacing: 2,
      variance: 0,
      smoothness: 0,
      maxLevels: 1,
      maxDistance: 4,
      seed: 2,
    });

    const mesh = buildContourMesh(loops, {
      bounds: {
        minX: -2,
        minY: -2,
        maxX: 12,
        maxY: 12,
      },
      pixelMode: true,
      baseLineWidth: 2,
      alternateLineWidth: 2,
      alternateStride: 0,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      return;
    }

    expect(mesh.layout).toBe('pos2uv2');
    expect(mesh.vertexCount).toBeGreaterThan(0);
    expect(mesh.vertexData.length).toBe(mesh.vertexCount * 4);
    expect(mesh.coordinateSpace).toBe('canvas');
  });
});
