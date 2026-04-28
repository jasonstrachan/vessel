import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

import {
  hasCanonicalColorCyclePaint,
  hasGradientBindingBuffers,
  normalizeColorCycleLayerDocumentState,
  validateColorCycleDocumentStateDimensions,
} from '../documentState';

const makeImageData = (width = 2, height = 2): ImageData => new ImageData(width, height);

const makeCanvas = (width = 2, height = 2): HTMLCanvasElement => ({
  width,
  height,
  getContext: jest.fn(() => null),
} as unknown as HTMLCanvasElement);

const makeBuffer = (length: number, fill = 0): ArrayBuffer => {
  const bytes = new Uint8Array(length);
  bytes.fill(fill);
  return bytes.buffer;
};

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
    gradientDefs: [{ id: 'def-a', currentSlot: 1 }],
    slotPalettes: [{
      slot: 1,
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    }],
    gradientDefStore: [{
      id: 1,
      kind: 'linear',
      stops: [{ position: 0, color: '#000000' }],
      hash: 'hash-a',
      source: 'manual',
      createdAtMs: 1,
      slot: 1,
    }],
  },
  ...overrides,
});

describe('normalizeColorCycleLayerDocumentState', () => {
  it('normalizes the current brushState snapshot', () => {
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        brushState: {
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              hasContent: true,
              paintBuffer: makeBuffer(4, 1),
              gradientIdBuffer: makeBuffer(4, 2),
              gradientDefIdBuffer: makeBuffer(8, 3),
              speedBuffer: makeBuffer(4, 4),
              flowBuffer: makeBuffer(4, 5),
              phaseBuffer: makeBuffer(4, 6),
            },
          }],
        },
      },
    });

    const result = normalizeColorCycleLayerDocumentState(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.width).toBe(2);
    expect(result.state.height).toBe(2);
    expect(result.state.paintBuffer?.byteLength).toBe(4);
    expect(result.state.gradientIdBuffer?.byteLength).toBe(4);
    expect(result.state.gradientDefIdBuffer?.byteLength).toBe(8);
    expect(result.state.speedBuffer?.byteLength).toBe(4);
    expect(result.state.flowBuffer?.byteLength).toBe(4);
    expect(result.state.phaseBuffer?.byteLength).toBe(4);
    expect(result.state.hasContent).toBe(true);
    expect(result.state.sources.brushStateSnapshot).toBe(true);
    expect(hasCanonicalColorCyclePaint(result.state)).toBe(true);
    expect(hasGradientBindingBuffers(result.state)).toBe(true);
  });

  it('normalizes legacy top-level buffers without fabricating optional buffers', () => {
    const gradientIdBuffer = makeBuffer(4, 7);
    const gradientDefIdBuffer = makeBuffer(8, 8);
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        hasContent: true,
        gradientIdBuffer,
        gradientDefIdBuffer,
      },
    });

    const result = normalizeColorCycleLayerDocumentState(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.gradientIdBuffer).not.toBe(gradientIdBuffer);
    expect(result.state.gradientIdBuffer?.byteLength).toBe(4);
    expect(result.state.gradientDefIdBuffer).not.toBe(gradientDefIdBuffer);
    expect(result.state.gradientDefIdBuffer?.byteLength).toBe(8);
    expect(result.state.paintBuffer).toBeUndefined();
    expect(result.state.speedBuffer).toBeUndefined();
    expect(result.state.flowBuffer).toBeUndefined();
    expect(result.state.phaseBuffer).toBeUndefined();
    expect(result.state.sources.topLevelBuffers).toBe(true);
  });

  it('prefers current layer binding buffers without overriding fresher stroke phase', () => {
    const currentGradientIds = makeBuffer(4, 4);
    const currentGradientDefIds = makeBuffer(8, 5);
    const currentPhase = makeBuffer(4, 6);
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        gradientIdBuffer: currentGradientIds,
        gradientDefIdBuffer: currentGradientDefIds,
        phaseBuffer: currentPhase,
        brushState: {
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              hasContent: true,
              paintBuffer: makeBuffer(4, 1),
              gradientIdBuffer: makeBuffer(4, 2),
              gradientDefIdBuffer: makeBuffer(8, 3),
              phaseBuffer: makeBuffer(4, 9),
            },
          }],
        },
      },
    });

    const result = normalizeColorCycleLayerDocumentState(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(Array.from(new Uint8Array(result.state.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([4, 4, 4, 4]);
    expect(Array.from(new Uint8Array(result.state.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(Array.from(new Uint8Array(result.state.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([9, 9, 9, 9]);
    expect(Array.from(new Uint8Array(result.state.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 1, 1, 1]);
  });

  it('rejects dimension mismatches with a clear reason', () => {
    const result = normalizeColorCycleLayerDocumentState(makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        brushState: {
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              paintBuffer: makeBuffer(3, 1),
            },
          }],
        },
      },
    }));

    expect(result).toEqual({
      ok: false,
      reason: 'paintBuffer byteLength 3 does not match 4 for 2x2',
    });
  });

  it('does not treat runtime canvas or compatibility pixels as canonical state', () => {
    const layer = makeColorCycleLayer({
      colorCycleData: {
        ...makeColorCycleLayer().colorCycleData,
        canvas: makeCanvas(),
        canvasImageData: makeImageData(),
      },
    });

    const result = normalizeColorCycleLayerDocumentState(layer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.paintBuffer).toBeUndefined();
    expect(result.state.hasContent).toBe(false);
    expect(hasCanonicalColorCyclePaint(result.state)).toBe(false);
  });
});

describe('validateColorCycleDocumentStateDimensions', () => {
  it('validates matching optional document buffers', () => {
    expect(validateColorCycleDocumentStateDimensions({
      width: 2,
      height: 2,
      paintBuffer: makeBuffer(4),
      gradientIdBuffer: makeBuffer(4),
      gradientDefIdBuffer: makeBuffer(8),
    })).toEqual({ ok: true });
  });
});
