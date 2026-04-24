import {
  DEFAULT_CC_GRADIENT,
  cloneColorCycleData,
  collectUsedSlots,
  ensureColorCycleGradients,
  ensureGradientDefIdBuffer,
  ensureGradientIdBuffer,
  gradientStopsToUint8Array,
  migrateGradientIdBuffer,
  resolveActiveGradientStops,
} from '@/stores/layers/layerColorCycleState';
import type { Layer } from '@/types';

const colorCycleData = (
  data: Partial<NonNullable<Layer['colorCycleData']>>
): Layer['colorCycleData'] => data as Layer['colorCycleData'];

describe('layerColorCycleState', () => {
  it('builds default gradient defs and palettes from legacy gradient stops', () => {
    const legacyGradient = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];

    const result = ensureColorCycleGradients(
      colorCycleData({ gradient: legacyGradient }),
      DEFAULT_CC_GRADIENT
    );

    expect(result.activeGradientId).toBe('g0');
    expect(result.paintSlot).toBe(0);
    expect(result.gradientDefs).toEqual([{ id: 'g0', currentSlot: 0 }]);
    expect(result.slotPalettes).toEqual([{ slot: 0, stops: legacyGradient }]);
  });

  it('remaps legacy editor slot 255 to an available runtime slot', () => {
    const result = ensureColorCycleGradients(
      colorCycleData({
        gradientDefs: [{ id: 'legacy', currentSlot: 255 }],
        slotPalettes: [{ slot: 255, stops: [{ position: 0, color: '#123456' }] }],
        activeGradientId: 'legacy',
        paintSlot: 255,
      }),
      DEFAULT_CC_GRADIENT
    );

    expect(result.activeGradientId).toBe('legacy');
    expect(result.paintSlot).not.toBe(255);
    expect(result.legacyRemap).toEqual({ from: 255, to: result.paintSlot });
    expect(result.gradientDefs[0].currentSlot).toBe(result.paintSlot);
    expect(result.slotPalettes.some((entry) => entry.slot === 255)).toBe(false);
  });

  it('copies existing gradient id buffer data when dimensions change', () => {
    const existing = new Uint8Array([1, 2, 3, 4]).buffer;

    const next = ensureGradientIdBuffer({
      existingBuffer: existing,
      width: 3,
      height: 2,
      previousWidth: 2,
      previousHeight: 2,
      fillSlot: 9,
    });

    expect(Array.from(new Uint8Array(next))).toEqual([1, 2, 9, 3, 4, 9]);
  });

  it('creates gradient def id buffers with two bytes per pixel', () => {
    const buffer = ensureGradientDefIdBuffer({ width: 3, height: 2 });

    expect(buffer.byteLength).toBe(12);
    expect(Array.from(new Uint16Array(buffer))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('migrates legacy editor-slot pixels in gradient id buffers', () => {
    const buffer = new Uint8Array([1, 255, 2]).buffer;
    const usedSlots = collectUsedSlots(
      [{ id: 'g0', currentSlot: 1 }],
      [{ slot: 1, stops: DEFAULT_CC_GRADIENT }]
    );

    const result = migrateGradientIdBuffer({ buffer, usedSlots });

    expect(result.legacyRemap?.from).toBe(255);
    expect(result.legacyRemap?.to).not.toBe(255);
    expect(Array.from(new Uint8Array(result.buffer))).toEqual([1, result.legacyRemap?.to, 2]);
  });

  it('resolves active gradient stops from active def slot palette', () => {
    const activeStops = [{ position: 0, color: '#abcdef' }];

    expect(
      resolveActiveGradientStops(
        colorCycleData({
          gradientDefs: [
            { id: 'background', currentSlot: 1 },
            { id: 'active', currentSlot: 7 },
          ],
          slotPalettes: [
            { slot: 1, stops: DEFAULT_CC_GRADIENT },
            { slot: 7, stops: activeStops },
          ],
          activeGradientId: 'active',
        })
      )
    ).toEqual(activeStops);
  });

  it('encodes gradient stops into RGB palette bytes', () => {
    const encoded = gradientStopsToUint8Array([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ]);

    expect(Array.from(encoded.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(encoded.slice(-3))).toEqual([255, 255, 255]);
  });

  it('clones color-cycle data and strips runtime surfaces when requested', () => {
    const canvas = document.createElement('canvas');
    const imageData = new ImageData(new Uint8ClampedArray([1, 2, 3, 4]), 1, 1);

    const cloned = cloneColorCycleData(
      colorCycleData({
        canvas,
        canvasImageData: imageData,
        eraseMask: canvas,
        eraseMaskImageData: imageData,
        hasContent: true,
        gradient: [{ position: 0, color: '#000000' }],
      }),
      { stripSurfaces: true }
    );

    expect(cloned?.canvas).toBeUndefined();
    expect(cloned?.canvasImageData).toBeUndefined();
    expect(cloned?.eraseMask).toBeUndefined();
    expect(cloned?.eraseMaskImageData).toBeUndefined();
    expect(cloned?.hasContent).toBe(false);
    expect(cloned?.gradientDefs).toEqual([{ id: 'g0', currentSlot: 0 }]);
  });
});
