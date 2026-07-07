import { ColorCycleAnimator } from '../ColorCycleAnimator';
import {
  ColorCycleLayerDocument,
  isDerivedSurfaceStale,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

jest.mock('@/lib/colorCycle/rendering/RendererWebGL', () => {
  const uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }> = [];

  class MockRendererWebGL {
    width: number;
    height: number;
    constructor(opts: { width: number; height: number }) {
      this.width = opts.width;
      this.height = opts.height;
    }
    static isSupported() {
      return true;
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
    resize(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    dispose() {}
  }

  return {
    RendererWebGL: MockRendererWebGL,
    __uploads: uploads,
  };
});

describe('ColorCycleAnimator WebGL uploads', () => {
  beforeEach(() => {
    const mock = jest.requireMock('@/lib/colorCycle/rendering/RendererWebGL') as {
      __uploads: Array<{ rect?: { x: number; y: number; width: number; height: number } }>;
    };
    mock.__uploads.length = 0;
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
