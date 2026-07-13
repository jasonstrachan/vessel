import { getPersistedRuntimeIncidents } from '@/utils/runtimeIncidentJournal';

import {
  packDefMetaDataForUpload,
  WebGLColorCycleRenderer,
} from '../WebGLColorCycleRenderer';

const createWebGL2Stub = (): WebGL2RenderingContext => {
  const noop = jest.fn();
  const createResource = jest.fn(() => ({}));
  const target = {
    FRAMEBUFFER_COMPLETE: 1,
    checkFramebufferStatus: jest.fn(() => 1),
    createBuffer: createResource,
    createProgram: createResource,
    createShader: createResource,
    createTexture: createResource,
    createVertexArray: createResource,
    drawArrays: jest.fn(),
    getExtension: jest.fn(() => null),
    getParameter: jest.fn(() => 64),
    getProgramParameter: jest.fn(() => true),
    getShaderParameter: jest.fn(() => true),
    getUniformLocation: createResource,
    isContextLost: jest.fn(() => false),
  };

  return new Proxy(target, {
    get(object, property) {
      if (property in object) {
        return object[property as keyof typeof object];
      }
      if (typeof property === 'string' && property === property.toUpperCase()) {
        return 1;
      }
      return noop;
    },
  }) as unknown as WebGL2RenderingContext;
};

describe('packDefMetaDataForUpload', () => {
  it('packs only the dirty rect for partial uploads', () => {
    const width = 4;
    const height = 3;
    const defIds = new Uint16Array(width * height);
    const phases = new Uint8Array(width * height);

    for (let i = 0; i < defIds.length; i += 1) {
      defIds[i] = 0x100 + i;
      phases[i] = i + 1;
    }

    const upload = packDefMetaDataForUpload(width, height, defIds, phases, {
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });

    expect(upload.isFullCanvasLayout).toBe(false);
    expect(upload.data).toHaveLength(2 * 2 * 4);
    expect([...upload.data]).toEqual([
      0x05, 0x01, 6, 255,
      0x06, 0x01, 7, 255,
      0x09, 0x01, 10, 255,
      0x0a, 0x01, 11, 255,
    ]);
  });

  it('keeps full-canvas layout for full uploads', () => {
    const width = 2;
    const height = 1;
    const upload = packDefMetaDataForUpload(
      width,
      height,
      new Uint16Array([0x1234, 0]),
      new Uint8Array([9, 10]),
      { x: 0, y: 0, width, height }
    );

    expect(upload.isFullCanvasLayout).toBe(true);
    expect([...upload.data]).toEqual([
      0x34, 0x12, 9, 255,
      0, 0, 10, 255,
    ]);
  });
});

describe('WebGLColorCycleRenderer context reservations', () => {
  const rendererStatics = WebGLColorCycleRenderer as unknown as {
    activeContexts: number;
  };

  beforeEach(() => {
    rendererStatics.activeContexts = 0;
    window.localStorage.clear();
    delete window.__VESSEL_RUNTIME_INCIDENTS__;
  });

  afterEach(() => {
    rendererStatics.activeContexts = 0;
    jest.restoreAllMocks();
  });

  it('releases its reserved slot once when the context is lost', () => {
    const canvas = document.createElement('canvas');
    const gl = createWebGL2Stub();
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: jest.fn(() => gl),
    });
    const renderer = new WebGLColorCycleRenderer({
      width: 8,
      height: 8,
      canvas,
      layerId: 'cc-layer',
    });

    expect(rendererStatics.activeContexts).toBe(1);

    canvas.dispatchEvent(new Event('webglcontextlost'));

    expect(rendererStatics.activeContexts).toBe(0);
    expect(getPersistedRuntimeIncidents()).toEqual([
      expect.objectContaining({
        scope: 'cc-render',
        event: 'webgl-context-lost',
        data: expect.objectContaining({ layerId: 'cc-layer' }),
      }),
    ]);

    renderer.dispose();
    expect(rendererStatics.activeContexts).toBe(0);
  });

  it('rejects polygons above the runtime fill vertex limit', () => {
    const canvas = document.createElement('canvas');
    const gl = createWebGL2Stub();
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: jest.fn(() => gl),
    });
    const renderer = new WebGLColorCycleRenderer({
      width: 8,
      height: 8,
      canvas,
    });
    const drawArrays = gl.drawArrays as jest.Mock;
    drawArrays.mockClear();

    expect(renderer.getFillMaxVerts()).toBe(8);
    expect(renderer.fillPolygonConcentric({
      vertices: new Float32Array(9 * 2),
      bands: 2,
      baseOffset: 0,
      colorStep: 1,
      maxDist: 1,
      bbox: { minX: 0, minY: 0, width: 2, height: 2 },
      canvasHeight: 8,
    })).toBeNull();
    expect(drawArrays).not.toHaveBeenCalled();

    renderer.dispose();
  });
});
