import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

import { captureColorCyclePersistenceSnapshot } from '../captureColorCyclePersistenceSnapshot';
import type { PersistedColorCycleBrushState } from '../colorCyclePersistenceTypes';

const buffer = (length: number, value = 1): ArrayBuffer => new Uint8Array(length).fill(value).buffer;

const makeLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: { width: 2, height: 2 } as OffscreenCanvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'brush',
    canvasWidth: 2,
    canvasHeight: 2,
  },
  ...overrides,
});

const canonicalBrushState = (overrides: Partial<PersistedColorCycleBrushState> = {}): PersistedColorCycleBrushState => ({
  canonicalPaint: true,
  schemaVersion: 1,
  layers: [{
    layerId: 'layer-1',
    canonicalPaint: true,
    schemaVersion: 1,
    dimensions: { width: 2, height: 2 },
    strokeData: {
      paintBuffer: buffer(4),
      gradientIdBuffer: buffer(4, 2),
      gradientDefIdBuffer: buffer(8, 3),
      speedBuffer: buffer(4, 4),
      flowBuffer: buffer(4, 5),
      phaseBuffer: buffer(4, 6),
      hasContent: true,
      strokeCounter: 7,
    },
  }],
  ...overrides,
});

describe('captureColorCyclePersistenceSnapshot', () => {
  it('uses live runtime with canonical paint first', () => {
    const brushState = canonicalBrushState({ canonicalPaint: false });
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      runtimeBrush: {
        getFullState: () => brushState,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('live-runtime');
      expect(result.documentState.paintBuffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  it('falls back to deferred archive when runtime capture fails', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      runtimeBrush: {
        getFullState: () => {
          throw new Error('runtime unavailable');
        },
      },
      deferredRuntime: {
        paintRef: 'zip:buffers/color-cycle/layer-1/paint.bin',
        speedRef: 'zip:buffers/color-cycle/layer-1/speed.bin',
        flowRef: 'zip:buffers/color-cycle/layer-1/flow.bin',
        phaseRef: 'zip:buffers/color-cycle/layer-1/phase.bin',
        gradientIdRef: 'zip:buffers/color-cycle/layer-1/gradient-id.bin',
        gradientDefIdRef: 'zip:buffers/color-cycle/layer-1/gradient-def-id.bin',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('deferred-archive');
      expect(result.documentState.paintBuffer).toBe('zip:buffers/color-cycle/layer-1/paint.bin');
    }
  });

  it('rejects metadata-only brush state', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: {
          layers: [{
            layerId: 'layer-1',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
            },
          }],
        },
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'metadata-only-state',
      damageKind: 'metadata-only',
    });
  });

  it('rejects paint-looking brush state without canonical markers', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: {
          layers: [{
            layerId: 'layer-1',
            strokeData: {
              paintBuffer: buffer(4),
              speedBuffer: buffer(4),
              flowBuffer: buffer(4),
              phaseBuffer: buffer(4),
              hasContent: true,
            },
          }],
        },
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'metadata-only-state',
    });
  });

  it('accepts deferred archive refs without warming runtime', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      deferredRuntime: {
        paintRef: 'zip:paint',
        speedRef: 'zip:speed',
        flowRef: 'zip:flow',
        phaseRef: 'zip:phase',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('deferred-archive');
    }
  });

  it('rejects deferred archive refs missing from the manifest', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      archiveManifest: new Map([
        ['speed', { byteLength: 4 }],
        ['flow', { byteLength: 4 }],
        ['phase', { byteLength: 4 }],
      ]),
      deferredRuntime: {
        paintRef: 'zip:paint',
        speedRef: 'zip:speed',
        flowRef: 'zip:flow',
        phaseRef: 'zip:phase',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-archive-ref',
      damageKind: 'missing-archive-ref',
    });
  });

  it('fails dimension mismatches', () => {
    const state = canonicalBrushState();
    state.layers![0]!.strokeData!.paintBuffer = buffer(3);
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: state,
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'dimension-mismatch',
    });
  });

  it('fails missing motion buffers', () => {
    const state = canonicalBrushState();
    delete state.layers![0]!.strokeData!.flowBuffer;
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: state,
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-motion-buffers',
    });
  });

  it('prefers live runtime over stale marked brush state', () => {
    const persisted = canonicalBrushState();
    persisted.layers![0]!.strokeData!.strokeCounter = 1;
    const runtime = canonicalBrushState();
    runtime.layers![0]!.strokeData!.strokeCounter = 2;

    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: persisted,
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      runtimeBrush: {
        serialize: () => runtime,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('live-runtime');
      expect(result.brushState.layers?.[0]?.strokeData?.strokeCounter).toBe(2);
    }
  });
});
