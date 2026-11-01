import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document';
import { scaleColorCycleDocumentStateNearest } from '@/stores/helpers/colorCycleResize';

const createSnapshot = (): ColorCycleLayerDocumentSnapshot => ({
  layerId: 'layer-cc',
  width: 2,
  height: 2,
  paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
  gradientIdBuffer: Uint8Array.from([11, 12, 13, 14]).buffer,
  gradientDefIdBuffer: Uint16Array.from([101, 102, 103, 104]).buffer,
  speedBuffer: Uint8Array.from([21, 22, 23, 24]).buffer,
  flowBuffer: Uint8Array.from([31, 32, 33, 34]).buffer,
  phaseBuffer: Uint8Array.from([41, 42, 43, 44]).buffer,
  hasContent: true,
  sources: {
    brushStateSnapshot: false,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
});

describe('scaleColorCycleDocumentStateNearest', () => {
  it('scales every canonical per-pixel buffer and preserves metadata', () => {
    const snapshot = createSnapshot();
    const scaled = scaleColorCycleDocumentStateNearest({
      snapshot,
      width: 4,
      height: 4,
    });

    expect(scaled.width).toBe(4);
    expect(scaled.height).toBe(4);
    expect(scaled.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(scaled.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ]);
    expect(Array.from(new Uint8Array(scaled.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      11, 11, 12, 12,
      11, 11, 12, 12,
      13, 13, 14, 14,
      13, 13, 14, 14,
    ]);
    expect(Array.from(new Uint16Array(scaled.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      101, 101, 102, 102,
      101, 101, 102, 102,
      103, 103, 104, 104,
      103, 103, 104, 104,
    ]);
    expect(Array.from(new Uint8Array(scaled.speedBuffer ?? new ArrayBuffer(0)))).toEqual([
      21, 21, 22, 22,
      21, 21, 22, 22,
      23, 23, 24, 24,
      23, 23, 24, 24,
    ]);
    expect(Array.from(new Uint8Array(scaled.flowBuffer ?? new ArrayBuffer(0)))).toEqual([
      31, 31, 32, 32,
      31, 31, 32, 32,
      33, 33, 34, 34,
      33, 33, 34, 34,
    ]);
    expect(Array.from(new Uint8Array(scaled.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([
      41, 41, 42, 42,
      41, 41, 42, 42,
      43, 43, 44, 44,
      43, 43, 44, 44,
    ]);
  });

  it('rejects an incomplete canonical buffer instead of silently dropping it', () => {
    const snapshot = {
      ...createSnapshot(),
      phaseBuffer: Uint8Array.from([1, 2, 3]).buffer,
    };

    expect(() => scaleColorCycleDocumentStateNearest({
      snapshot,
      width: 4,
      height: 4,
    })).toThrow('Cannot resize color-cycle phase buffer');
  });

  it('scales both mask alpha planes without mutating their source or metadata', () => {
    const snapshot = {
      ...createSnapshot(),
      eraseMask: { width: 2, height: 2, alpha: new Uint8ClampedArray([0, 64, 128, 255]), version: 7 },
      softEdgeMask: { width: 2, height: 2, alpha: new Uint8ClampedArray([255, 128, 64, 0]), version: 9, enabled: false },
    };
    const scaled = scaleColorCycleDocumentStateNearest({ snapshot, width: 4, height: 4 });
    expect(scaled.eraseMask).toEqual({
      width: 4, height: 4, version: 7,
      alpha: new Uint8ClampedArray([0, 0, 64, 64, 0, 0, 64, 64, 128, 128, 255, 255, 128, 128, 255, 255]),
    });
    expect(scaled.softEdgeMask).toEqual({
      width: 4, height: 4, version: 9, enabled: false,
      alpha: new Uint8ClampedArray([255, 255, 128, 128, 255, 255, 128, 128, 64, 64, 0, 0, 64, 64, 0, 0]),
    });
    expect(snapshot.eraseMask.alpha).toEqual(new Uint8ClampedArray([0, 64, 128, 255]));
    expect(snapshot.softEdgeMask.alpha).toEqual(new Uint8ClampedArray([255, 128, 64, 0]));
    expect(scaled.eraseMask?.alpha).not.toBe(snapshot.eraseMask.alpha);

    const reduced = scaleColorCycleDocumentStateNearest({ snapshot: scaled, width: 1, height: 2 });
    expect(reduced.eraseMask?.alpha).toEqual(new Uint8ClampedArray([0, 128]));
    expect(reduced.softEdgeMask?.alpha).toEqual(new Uint8ClampedArray([255, 64]));
    expect([reduced.eraseMask?.width, reduced.eraseMask?.height]).toEqual([1, 2]);
  });

  it('keeps absent masks absent', () => {
    const scaled = scaleColorCycleDocumentStateNearest({ snapshot: createSnapshot(), width: 4, height: 4 });
    expect(scaled.eraseMask).toBeUndefined();
    expect(scaled.softEdgeMask).toBeUndefined();
  });
});
