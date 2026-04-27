import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

import { repairLegacyColorCycleLayer } from '../legacyRepair';

const makeImageData = (
  width = 2,
  height = 2,
  pixels?: number[],
): ImageData => {
  const imageData = new ImageData(width, height);
  if (pixels) {
    imageData.data.set(pixels);
  }
  return imageData;
};

const makeCanvas = (width = 2, height = 2): HTMLCanvasElement => ({
  width,
  height,
  getContext: jest.fn(() => null),
} as unknown as HTMLCanvasElement);

const makeBuffer = (values: number[]): ArrayBuffer => Uint8Array.from(values).buffer;

const makeDefIdBuffer = (values: number[]): ArrayBuffer => Uint16Array.from(values).buffer;

const makeColorCycleLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: makeImageData(),
  framebuffer: makeCanvas(),
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'brush',
    canvasWidth: 2,
    canvasHeight: 2,
    paintSlot: 1,
    fgActiveSlot: 1,
    gradientIdBuffer: makeBuffer([1, 0, 1, 0]),
    gradientDefIdBuffer: makeDefIdBuffer([11, 0, 11, 0]),
    gradientDefs: [{ id: 'def-a', currentSlot: 1 }],
    slotPalettes: [{
      slot: 1,
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    }],
    gradientDefStore: [{
      id: 11,
      kind: 'linear',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      hash: 'hash-a',
      source: 'manual',
      createdAtMs: 1,
      slot: 1,
    }],
  },
  ...overrides,
});

describe('repairLegacyColorCycleLayer', () => {
  it('passes canonical paint through unchanged', () => {
    const paintBuffer = makeBuffer([4, 3, 2, 1]);
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        brushState: {
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              hasContent: true,
              paintBuffer,
              gradientIdBuffer: makeBuffer([7, 7, 0, 0]),
            },
          }],
        },
      },
    });

    const result = repairLegacyColorCycleLayer(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.repaired).toBe(false);
    expect(Array.from(new Uint8Array(result.state.paintBuffer))).toEqual([4, 3, 2, 1]);
    expect(result.state.paintBuffer).not.toBe(paintBuffer);
    expect(result.repairNotes).toEqual([]);
  });

  it('recovers missing paint from a black/white compatibility snapshot', () => {
    const gradientIdBuffer = makeBuffer([1, 0, 1, 0]);
    const gradientDefIdBuffer = makeDefIdBuffer([11, 0, 11, 0]);
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        gradientIdBuffer,
        gradientDefIdBuffer,
        canvasImageData: makeImageData(2, 2, [
          0, 0, 0, 255,
          0, 0, 0, 0,
          255, 255, 255, 255,
          0, 0, 0, 0,
        ]),
      },
    });

    const result = repairLegacyColorCycleLayer(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.repaired).toBe(true);
    expect(Array.from(new Uint8Array(result.state.paintBuffer))).toEqual([1, 0, 255, 0]);
    expect(Array.from(new Uint8Array(result.state.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 1, 0]);
    expect(Array.from(new Uint16Array(result.state.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([11, 0, 11, 0]);
    expect(result.repairNotes).toEqual(['recovered-paint-buffer-from-compatibility-snapshot']);
  });

  it('returns empty-compatibility-snapshot for transparent snapshots', () => {
    const result = repairLegacyColorCycleLayer(makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        canvasImageData: makeImageData(),
      },
    }));

    expect(result).toMatchObject({
      ok: false,
      reason: 'empty-compatibility-snapshot',
    });
  });

  it('returns missing-gradient-bindings instead of fabricating bindings from RGBA', () => {
    const result = repairLegacyColorCycleLayer(makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        gradientIdBuffer: undefined,
        gradientDefIdBuffer: undefined,
        canvasImageData: makeImageData(2, 2, [
          0, 0, 0, 255,
          0, 0, 0, 0,
          255, 255, 255, 255,
          0, 0, 0, 0,
        ]),
      },
    }));

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-gradient-bindings',
    });
  });

  it('returns dimension-mismatch when the compatibility snapshot size does not match canonical dimensions', () => {
    const result = repairLegacyColorCycleLayer(makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        canvasImageData: makeImageData(1, 1, [0, 0, 0, 255]),
      },
    }));

    expect(result).toMatchObject({
      ok: false,
      reason: 'dimension-mismatch',
    });
  });
});
