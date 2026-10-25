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

describe('explicit Recolor lookup and alpha transport', () => {
  const createRenderer = () => {
    const gl = createWebGL2Stub();
    (gl.getUniformLocation as jest.Mock).mockImplementation((_program, name: string) => ({ name }));
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', { configurable: true, value: jest.fn(() => gl) });
    return { gl, renderer: new WebGLColorCycleRenderer({ width: 3, height: 1, canvas }) };
  };

  it('uses the existing gid channel for exact source alpha and restores ordinary brush mode on upload', () => {
    const { gl, renderer } = createRenderer();
    try {
      const indices = new Uint8Array([0, 12, 255]), alpha = new Uint8Array([0, 128, 255]);
      renderer.setRecolorData(indices, alpha);
      renderer.render(0, 0, 'forward');
      expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_recolorMode' }), 1);
      expect((gl.texSubImage2D as jest.Mock).mock.calls.some(call => call.at(-1) === alpha)).toBe(true);
      const sources = (gl.shaderSource as jest.Mock).mock.calls.map(call => String(call[1]));
      const fragment = sources.find(source => source.includes('u_recolorMode'))!;
      expect((fragment.match(/uniform sampler2D /g) ?? [])).toHaveLength(8);
      expect(fragment.indexOf('if (u_recolorMode > 0.5)')).toBeLessThan(fragment.indexOf('// Index 0 = transparent'));
      expect(fragment).toContain('(fIdx + 0.5) / u_paletteSize');
      expect(fragment).toContain('recolor.a *= gidN');
      // The brush contract, including zero speed being static, is still present and mode-gated.
      expect(fragment).toContain('if (fSpd < 0.5)');
      renderer.setIndexData(indices);
      renderer.render(1, 1, 'forward');
      const modes = (gl.uniform1f as jest.Mock).mock.calls.filter(call => call[0]?.name === 'u_recolorMode').map(call => call[1]);
      expect(modes).toEqual([1, 0]);
    } finally { renderer.dispose(); }
  });

  it('validates exact dimensions, retains palette alpha when source alpha is absent and resets on resize', () => {
    const { gl, renderer } = createRenderer();
    try {
      expect(() => renderer.setRecolorData(new Uint8Array(2))).toThrow('dimensions');
      expect(() => renderer.setRecolorData(new Uint8Array(3), new Uint8Array(2))).toThrow('dimensions');
      renderer.setRecolorData(new Uint8Array([0, 1, 2]));
      renderer.render(0, 0, 'forward');
      expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_recolorMode' }), 2);
      renderer.resize(2, 2);
      expect(() => renderer.setRecolorData(new Uint8Array(3))).toThrow('dimensions');
      renderer.setIndexData(new Uint8Array(4));
      renderer.render(0, 0, 'forward');
      const modes = (gl.uniform1f as jest.Mock).mock.calls.filter(call => call[0]?.name === 'u_recolorMode').map(call => call[1]);
      expect(modes).toEqual([2, 0]);
    } finally { renderer.dispose(); }
  });
});
