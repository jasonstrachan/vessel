require('@testing-library/jest-dom');
require('./tests/setup/canvasMock');
require('./tests/setup/webgpuMock');
require('./tests/setup/workerMock');

jest.mock('delaunator', () => {
  class MockDelaunator {
    constructor(points) {
      const coords = Array.from(points ?? []);
      this.coords = coords;
      const vertexCount = Math.floor(coords.length / 2);
      const triangles = [];
      if (vertexCount >= 3) {
        for (let index = 1; index < vertexCount - 1; index += 1) {
          triangles.push(0, index, index + 1);
        }
      }
      this.triangles = triangles;
      this.halfedges = new Array(triangles.length).fill(-1);
      this.hull = Array.from({ length: Math.min(vertexCount, 3) }, (_, i) => i);
    }

    static from(points) {
      return new MockDelaunator(points);
    }
  }

  return { __esModule: true, default: MockDelaunator };
});
