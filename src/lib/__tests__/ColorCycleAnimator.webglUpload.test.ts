import { ColorCycleAnimator } from '../ColorCycleAnimator';

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
});
