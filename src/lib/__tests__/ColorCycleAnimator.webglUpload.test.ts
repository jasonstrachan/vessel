import { ColorCycleAnimator } from '../ColorCycleAnimator';
import {
  ColorCycleLayerDocument,
  isDerivedSurfaceStale,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

const TEST_GRADIENT = [
  { position: 0, color: '#000000' },
  { position: 1, color: '#ffffff' },
];

jest.mock('@/lib/colorCycle/rendering/RendererWebGL', () => {
  const uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }> = [];
  const state = {
    constructorCalls: 0,
    disposeCalls: 0,
    failWithBudget: false,
    fillMaxVerts: 8,
    defRowCalls: 0,
    defLutCalls: 0,
    defFailure: null as 'row' | 'lut' | null,
  };

  class MockRendererWebGL {
    width: number;
    height: number;
    constructor(opts: { width: number; height: number }) {
      state.constructorCalls += 1;
      if (state.failWithBudget) {
        throw new Error('WEBGL_CONTEXT_BUDGET_EXCEEDED');
      }
      this.width = opts.width;
      this.height = opts.height;
    }
    static isSupported() {
      return true;
    }
    static getContextBudget() {
      return { active: 1, max: 16 };
    }
    setPaletteColors() {}
    setPaletteRow() {}
    setIndexData(
      _data: Uint8Array,
      _gradientId?: Uint8Array,
      _speedData?: Uint8Array,
      _flowData?: Uint8Array,
      _phaseData?: Uint8Array,
      _defIdData?: Uint16Array,
      rect?: { x: number; y: number; width: number; height: number },
      _defIdDirty: boolean = true
    ) {
      void _defIdDirty;
      uploads.push({ rect });
    }
    render() {}
    getCanvas() {
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      return canvas;
    }
    isPaletteReady() {
      return true;
    }
    ensureBasePalette() {}
    syncPaletteAtlas() {}
    getMaxTextureSize() {
      return 4096;
    }
    getFillMaxVerts() {
      return state.fillMaxVerts;
    }
    setDefPaletteRows() {}
    setDefPaletteRow() {
      state.defRowCalls += 1;
      if (state.defFailure === 'row') {
        throw new Error('def row upload failed');
      }
    }
    setDefPaletteLut() {
      state.defLutCalls += 1;
      if (state.defFailure === 'lut') {
        throw new Error('def LUT upload failed');
      }
    }
    resetDefPaletteState() {}
    resize(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    dispose() {
      state.disposeCalls += 1;
    }
  }

  return {
    RendererWebGL: MockRendererWebGL,
    __uploads: uploads,
    __state: state,
  };
});

describe('ColorCycleAnimator WebGL uploads', () => {
  beforeEach(() => {
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }>;
      __state: {
        constructorCalls: number;
        disposeCalls: number;
        failWithBudget: boolean;
        fillMaxVerts: number;
        defRowCalls: number;
        defLutCalls: number;
        defFailure: 'row' | 'lut' | null;
      };
    };
    mock.__uploads.length = 0;
    mock.__state.constructorCalls = 0;
    mock.__state.disposeCalls = 0;
    mock.__state.failWithBudget = false;
    mock.__state.fillMaxVerts = 8;
    mock.__state.defRowCalls = 0;
    mock.__state.defLutCalls = 0;
    mock.__state.defFailure = null;
  });

  it('does not reserve WebGL for an empty lazy animator', () => {
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.forceRender();

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { constructorCalls: number };
    };
    expect(mock.__state.constructorCalls).toBe(0);
    expect(animator.getRenderDiagnostics().renderPath).toBe('cpu');
  });

  it('initializes lazy WebGL before reporting the fill vertex limit', () => {
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { constructorCalls: number; fillMaxVerts: number };
    };
    mock.__state.fillMaxVerts = 7;

    expect(animator.getGLFillMaxVerts()).toBe(7);
    expect(mock.__state.constructorCalls).toBe(1);
  });

  it('never retries WebGL when Canvas2D is explicitly forced', () => {
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      lazyInit: true,
      forceCanvas2D: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setIndex(2, 3, 1);
    animator.forceRender();
    animator.forceRender();

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { constructorCalls: number };
    };
    expect(mock.__state.constructorCalls).toBe(0);
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'cpu',
      fallbackReason: 'explicit-force',
    });
  });

  it('creates one renderer on first content and releases it once during cleanup', () => {
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setIndex(2, 3, 1);
    animator.forceRender();
    animator.forceRender();

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { constructorCalls: number; disposeCalls: number };
    };
    expect(mock.__state.constructorCalls).toBe(1);
    expect(animator.getRenderDiagnostics().renderPath).toBe('gpu');

    animator.cleanup();
    expect(mock.__state.disposeCalls).toBe(1);
  });

  it('bounds budget retries and reacquires WebGL after the retry window', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { constructorCalls: number; failWithBudget: boolean };
    };
    mock.__state.failWithBudget = true;
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setIndex(1, 1, 1);
    animator.forceRender();
    animator.forceRender();

    expect(mock.__state.constructorCalls).toBe(1);
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'cpu',
      fallbackReason: 'context-budget-unavailable',
    });

    mock.__state.failWithBudget = false;
    now.mockReturnValue(2001);
    animator.forceRender();
    expect(mock.__state.constructorCalls).toBe(2);
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'gpu',
      fallbackReason: null,
    });
    now.mockRestore();
  });

  it('keeps failed def rows non-resident and does not retry every frame', () => {
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: {
        defRowCalls: number;
        defFailure: 'row' | 'lut' | null;
      };
    };
    mock.__state.defFailure = 'row';
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setDefPaletteCache({
      palettesById: new Map([[7, new Uint32Array(256)]]),
      rgbaById: new Map([[7, new Uint8Array(256 * 4)]]),
      signaturesById: new Map([[7, 'def-7']]),
    });
    animator.setDefIdData(new Uint16Array([7, 0, 0, 0]));
    animator.setIndex(0, 0, 1);
    animator.forceRender();
    animator.forceRender();

    expect(mock.__state.defRowCalls).toBe(1);
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'cpu',
      fallbackReason: 'def-upload-failed',
    });
  });

  it('keeps successful def rows resident across frames', () => {
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: { defRowCalls: number; defLutCalls: number };
    };
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setDefPaletteCache({
      palettesById: new Map([[7, new Uint32Array(256)]]),
      rgbaById: new Map([[7, new Uint8Array(256 * 4)]]),
      signaturesById: new Map([[7, 'def-7']]),
    });
    animator.setDefIdData(new Uint16Array([7, 0, 0, 0]));
    animator.setIndex(0, 0, 1);
    animator.forceRender();
    animator.forceRender();

    expect(mock.__state.defRowCalls).toBe(1);
    expect(mock.__state.defLutCalls).toBe(1);
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'gpu',
      fallbackReason: null,
    });
  });

  it('reuploads definition-atlas residency after recreating WebGL', () => {
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __state: {
        constructorCalls: number;
        disposeCalls: number;
        defRowCalls: number;
        defLutCalls: number;
      };
    };
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      lazyInit: true,
      gradientStops: TEST_GRADIENT,
    });
    animator.setGradient(TEST_GRADIENT);
    animator.setDefPaletteCache({
      palettesById: new Map([[7, new Uint32Array(256)]]),
      rgbaById: new Map([[7, new Uint8Array(256 * 4)]]),
      signaturesById: new Map([[7, 'def-7']]),
    });
    animator.setDefIdData(new Uint16Array([7, 0, 0, 0]));
    animator.setIndex(0, 0, 1);
    animator.forceRender();

    expect(mock.__state).toMatchObject({
      constructorCalls: 1,
      defRowCalls: 1,
      defLutCalls: 1,
    });

    animator.setForceCanvas2D(true);
    animator.setForceCanvas2D(false);

    expect(mock.__state).toMatchObject({
      constructorCalls: 2,
      disposeCalls: 1,
      defRowCalls: 2,
      defLutCalls: 2,
    });
    expect(animator.getRenderDiagnostics()).toMatchObject({
      renderPath: 'gpu',
      fallbackReason: null,
    });
  });

  it('uses dirty-rect uploads for single-pixel edits', () => {
    const animator = new ColorCycleAnimator({
      width: 8,
      height: 8,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });

    animator.setActiveGradientSlot(0);
    animator.setIndex(2, 3, 1);
    animator.forceRender();

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }>;
    };
    const last = mock.__uploads[mock.__uploads.length - 1];
    expect(last?.rect).toEqual({ x: 2, y: 3, width: 1, height: 1 });
  });

  it('records the document version that rebuilt the GPU index surface', () => {
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });
    const makeState = (paint: number): ColorCycleLayerDocumentState => ({
      layerId: 'layer-cc',
      width: 2,
      height: 2,
      paintBuffer: Uint8Array.from([paint, 0, 0, 0]).buffer,
      gradientIdBuffer: Uint8Array.from([1, 0, 0, 0]).buffer,
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      speedBuffer: Uint8Array.from([1, 0, 0, 0]).buffer,
      flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
      phaseBuffer: Uint8Array.from([2, 0, 0, 0]).buffer,
      hasContent: true,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    });
    const document = new ColorCycleLayerDocument(makeState(3));

    expect(isDerivedSurfaceStale(document, animator)).toBe(true);

    let read = document.read();
    animator.rebuild(read.snapshot, read.version);

    expect(animator.builtFromVersion).toBe(0);
    expect(isDerivedSurfaceStale(document, animator)).toBe(false);

    const transaction = document.beginTransaction('brush-stroke-write');
    transaction.mutate((draft) => {
      draft.paintBuffer = Uint8Array.from([4, 0, 0, 0]).buffer;
    });
    transaction.commit();

    expect(isDerivedSurfaceStale(document, animator)).toBe(true);

    read = document.read();
    animator.rebuild(read.snapshot, read.version);

    expect(animator.builtFromVersion).toBe(1);
    expect(isDerivedSurfaceStale(document, animator)).toBe(false);

    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }>;
    };
    expect(mock.__uploads.length).toBeGreaterThan(0);
  });
});
