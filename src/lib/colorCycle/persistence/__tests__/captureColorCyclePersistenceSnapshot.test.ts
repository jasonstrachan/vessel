import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { DEFAULT_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { attachLegacyColorCycleTopLevelBuffers } from '@/lib/colorCycle/document';

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
  it('references the immutable document generation for history without cloning canonical buffers', () => {
    const documentState = {
      layerId: 'layer-1',
      width: 2,
      height: 2,
      paintBuffer: buffer(4, 8),
      gradientIdBuffer: buffer(4, 9),
      gradientDefIdBuffer: buffer(8, 10),
      speedBuffer: buffer(4, 11),
      flowBuffer: buffer(4, 12),
      phaseBuffer: buffer(4, 13),
      hasContent: true,
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    };

    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'history',
      document: {
        read: () => ({
          snapshot: documentState,
          version: 4,
          pixelVersion: 3,
        }),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const historyLayer = result.brushState.layers?.[0];
      expect(result.documentState.paintBuffer).toBe(documentState.paintBuffer);
      expect(historyLayer?.strokeData?.paintBuffer).toBe(documentState.paintBuffer);
      expect(historyLayer?.strokeData?.gradientIdBuffer).toBe(documentState.gradientIdBuffer);
      expect(historyLayer?.strokeData?.gradientDefIdBuffer).toBe(documentState.gradientDefIdBuffer);
      expect(historyLayer?.strokeData?.speedBuffer).toBe(documentState.speedBuffer);
      expect(historyLayer?.strokeData?.speedSourceVersion).toBe(2);
      expect(historyLayer?.strokeData?.flowBuffer).toBe(documentState.flowBuffer);
      expect(historyLayer?.strokeData?.phaseBuffer).toBe(documentState.phaseBuffer);
    }
  });

  it('preserves a retained legacy speed marker when capturing a resident document', () => {
    const persisted = canonicalBrushState();
    persisted.layers![0]!.strokeData!.speedSourceVersion = 1;
    const documentSpeed = buffer(4, 17);
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
      document: {
        residency: 'resident',
        read: () => ({
          snapshot: {
            layerId: 'layer-1',
            width: 2,
            height: 2,
            paintBuffer: buffer(4, 8),
            gradientIdBuffer: buffer(4, 9),
            gradientDefIdBuffer: buffer(8, 10),
            speedBuffer: documentSpeed,
            flowBuffer: buffer(4, 12),
            phaseBuffer: buffer(4, 13),
            hasContent: true,
            sources: {
              brushStateSnapshot: true,
              topLevelBuffers: false,
              legacyStateRefs: false,
            },
          },
          version: 4,
          pixelVersion: 3,
        }),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const strokeData = result.brushState.layers?.[0]?.strokeData;
      expect(strokeData?.speedSourceVersion).toBe(1);
      expect(Array.from(new Uint8Array(strokeData?.speedBuffer as ArrayBuffer)))
        .toEqual(Array.from(new Uint8Array(documentSpeed)));
    }
  });

  it('uses the document read before live runtime or persisted brush state and reports the version', () => {
    const persisted = canonicalBrushState();
    const runtime = canonicalBrushState({
      ditherEnabled: true,
      stampDitherEnabled: true,
    });
    runtime.layers![0]!.strokeData!.paintBuffer = buffer(4, 3);
    const documentState = {
      layerId: 'layer-1',
      width: 2,
      height: 2,
      paintBuffer: buffer(4, 8),
      gradientIdBuffer: buffer(4, 9),
      gradientDefIdBuffer: buffer(8, 10),
      speedBuffer: buffer(4, 11),
      flowBuffer: buffer(4, 12),
      phaseBuffer: buffer(4, 13),
      hasContent: true,
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    };
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
	      document: {
	        read: () => ({
	          snapshot: documentState,
	          version: 12,
	          pixelVersion: 12,
	        }),
	      },
      runtimeBrush: {
        serialize: () => runtime,
      },
      serializeRuntimeBrushState: (state) => state as PersistedColorCycleBrushState,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('document');
      expect(result.documentVersion).toBe(12);
      expect(result.documentState.paintBuffer).not.toBe(documentState.paintBuffer);
      expect(result.brushState.layers?.[0]?.strokeData?.paintBuffer).not.toBe(result.documentState.paintBuffer);
      expect(new Uint8Array(result.documentState.paintBuffer as ArrayBuffer)).toEqual(new Uint8Array([8, 8, 8, 8]));
      expect(new Uint8Array(result.brushState.layers?.[0]?.strokeData?.paintBuffer as ArrayBuffer)).toEqual(new Uint8Array([8, 8, 8, 8]));
      expect(result.brushState.ditherEnabled).toBe(true);
      expect(result.brushState.stampDitherEnabled).toBe(true);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          source: 'document',
          kind: 'source-selected',
          documentVersion: 12,
        }),
      ]);
    }
  });

  it('rejects an invalid document source instead of falling back to runtime state', () => {
    const runtime = canonicalBrushState();
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      document: {
        read: () => ({
          snapshot: {
            layerId: 'layer-1',
            width: 2,
            height: 2,
            hasContent: true,
            sources: {
              brushStateSnapshot: false,
              topLevelBuffers: false,
              legacyStateRefs: false,
            },
	          },
	          version: 3,
	          pixelVersion: 3,
	        }),
	      },
      runtimeBrush: {
        serialize: () => runtime,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics: [
        expect.objectContaining({
          source: 'document',
          documentVersion: 3,
        }),
        expect.objectContaining({
          source: 'document',
          kind: 'missing-paint-buffer',
        }),
      ],
    });
  });

  it('rejects canonical save without a document instead of consulting loose runtime state', () => {
    const runtimeSerialize = jest.fn(() => canonicalBrushState());
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: canonicalBrushState(),
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      runtimeBrush: {
        serialize: runtimeSerialize,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-document-source',
      diagnostics: [
        expect.objectContaining({
          source: 'document',
          kind: 'source-rejected',
        }),
      ],
    });
    expect(runtimeSerialize).not.toHaveBeenCalled();
  });

  it('uses cold document archive refs instead of placeholder buffers for canonical save', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: {
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        hasContent: true,
      },
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'canonical-save',
      document: {
        residency: 'cold-archive-ref',
        archiveRefs: {
          paintRef: 'zip:buffers/color-cycle/layer-1/paint.bin',
          gradientIdRef: 'zip:buffers/color-cycle/layer-1/gradient-id.bin',
          gradientDefIdRef: 'zip:buffers/color-cycle/layer-1/gradient-def-id.bin',
          speedRef: 'zip:buffers/color-cycle/layer-1/speed.bin',
          flowRef: 'zip:buffers/color-cycle/layer-1/flow.bin',
          phaseRef: 'zip:buffers/color-cycle/layer-1/phase.bin',
        },
        read: () => ({
          snapshot: {
            layerId: 'layer-1',
            width: 2,
            height: 2,
            paintBuffer: buffer(4, 0),
            gradientIdBuffer: buffer(4, 0),
            gradientDefIdBuffer: buffer(8, 0),
            speedBuffer: buffer(4, 0),
            flowBuffer: buffer(4, 0),
            phaseBuffer: buffer(4, 0),
            hasContent: true,
            sources: {
              brushStateSnapshot: false,
              topLevelBuffers: false,
              legacyStateRefs: false,
            },
	          },
	          version: 19,
	          pixelVersion: 19,
	        }),
	      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('document');
      expect(result.documentVersion).toBe(19);
      expect(result.documentState.paintBuffer).toBe('zip:buffers/color-cycle/layer-1/paint.bin');
      expect(result.documentState.gradientIdBuffer).toBe('zip:buffers/color-cycle/layer-1/gradient-id.bin');
      expect(result.documentState.gradientDefIdBuffer).toBe('zip:buffers/color-cycle/layer-1/gradient-def-id.bin');
      expect(result.documentState.speedBuffer).toBe('zip:buffers/color-cycle/layer-1/speed.bin');
      expect(result.documentState.flowBuffer).toBe('zip:buffers/color-cycle/layer-1/flow.bin');
      expect(result.documentState.phaseBuffer).toBe('zip:buffers/color-cycle/layer-1/phase.bin');
      expect(result.brushState.layers?.[0]?.strokeData?.paintBuffer).toBe('zip:buffers/color-cycle/layer-1/paint.bin');
      expect(result.brushState.layers?.[0]?.strokeData?.speedSourceVersion).toBe(1);
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: 'document',
          kind: 'source-selected',
          documentVersion: 19,
        }),
      ]));
    }
  });

  it('uses live runtime with canonical paint first', () => {
    const brushState = canonicalBrushState({ canonicalPaint: false });
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'diagnostic',
      runtimeBrush: {
        serialize: () => brushState,
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
      mode: 'diagnostic',
      runtimeBrush: {
        serialize: () => {
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
      mode: 'diagnostic',
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
      mode: 'diagnostic',
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
      mode: 'diagnostic',
      deferredRuntime: {
        paintRef: 'zip:paint',
        gradientIdRef: 'zip:gradient-id',
        gradientDefIdRef: 'zip:gradient-def-id',
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

  it('backfills missing brushState channels from deferred archive refs', () => {
    const brushState = canonicalBrushState();
    brushState.layers![0]!.strokeData = {
      hasContent: true,
      strokeCounter: 8,
    };
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'diagnostic',
      deferredRuntime: {
        brushState,
        paintRef: 'zip:paint',
        gradientIdRef: 'zip:gradient-id',
        gradientDefIdRef: 'zip:gradient-def-id',
        speedRef: 'zip:speed',
        flowRef: 'zip:flow',
        phaseRef: 'zip:phase',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('deferred-archive');
      expect(result.documentState.paintBuffer).toBe('zip:paint');
      expect(result.documentState.gradientIdBuffer).toBe('zip:gradient-id');
      expect(result.documentState.gradientDefIdBuffer).toBe('zip:gradient-def-id');
      expect(result.documentState.speedBuffer).toBe('zip:speed');
      expect(result.documentState.flowBuffer).toBe('zip:flow');
      expect(result.documentState.phaseBuffer).toBe('zip:phase');
    }
  });

  it('rejects deferred archive refs missing from the manifest', () => {
    const result = captureColorCyclePersistenceSnapshot(makeLayer(), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'diagnostic',
      archiveManifest: new Map([
        ['speed', { byteLength: 4 }],
        ['flow', { byteLength: 4 }],
        ['phase', { byteLength: 4 }],
        ['gradient-id', { byteLength: 4 }],
        ['gradient-def-id', { byteLength: 8 }],
      ]),
      deferredRuntime: {
        paintRef: 'zip:paint',
        gradientIdRef: 'zip:gradient-id',
        gradientDefIdRef: 'zip:gradient-def-id',
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
      mode: 'diagnostic',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'dimension-mismatch',
    });
  });

  it('rejects unsupported per-layer schema versions', () => {
    const state = canonicalBrushState({
      schemaVersion: 1,
      layers: [{
        ...canonicalBrushState().layers![0]!,
        schemaVersion: 999,
      }],
    });
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
      mode: 'diagnostic',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid-schema-version',
      damageKind: 'invalid-schema-version',
    });
  });

  it('backfills missing motion buffers for visible canonical paint', () => {
    const state = canonicalBrushState();
    delete state.layers![0]!.strokeData!.speedBuffer;
    delete state.layers![0]!.strokeData!.flowBuffer;
    delete state.layers![0]!.strokeData!.phaseBuffer;
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
      mode: 'diagnostic',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const expectedSpeedByte = encodeColorCycleSpeedByte(DEFAULT_BRUSH_COLOR_CYCLE_SPEED);
      expect(result.documentState.paintBuffer).toBeInstanceOf(ArrayBuffer);
      expect(result.documentState.speedBuffer).toBeInstanceOf(ArrayBuffer);
      expect(result.documentState.flowBuffer).toBeInstanceOf(ArrayBuffer);
      expect(result.documentState.phaseBuffer).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result.documentState.speedBuffer as ArrayBuffer)).toEqual(new Uint8Array([
        expectedSpeedByte,
        expectedSpeedByte,
        expectedSpeedByte,
        expectedSpeedByte,
      ]));
      expect(new Uint8Array(result.documentState.flowBuffer as ArrayBuffer)).toEqual(new Uint8Array([1, 1, 1, 1]));
    }
  });

  it('fails missing motion buffers when canonical paint has no visible pixels', () => {
    const state = canonicalBrushState();
    state.layers![0]!.strokeData!.paintBuffer = buffer(4, 0);
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
      mode: 'diagnostic',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-motion-buffers',
    });
  });

  it('fails missing gradient binding buffers', () => {
    const state = canonicalBrushState();
    delete state.layers![0]!.strokeData!.gradientDefIdBuffer;
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
      mode: 'diagnostic',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-gradient-bindings',
      damageKind: 'missing-gradient-bindings',
    });
  });

  it('does not count empty string refs as canonical payload presence', () => {
    const state = canonicalBrushState();
    (state.layers![0]!.strokeData as Record<string, unknown>).gradientDefIdBuffer = '';
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
      mode: 'diagnostic',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing-gradient-bindings',
      damageKind: 'missing-gradient-bindings',
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
      mode: 'diagnostic',
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

  it('uses persisted brush state in diagnostic mode when live runtime is preview-only', () => {
    const persisted = canonicalBrushState();
    persisted.layers![0]!.strokeData!.strokeCounter = 42;
    const runtime = canonicalBrushState();
    delete runtime.layers![0]!.strokeData!.paintBuffer;
    delete runtime.layers![0]!.strokeData!.speedBuffer;
    delete runtime.layers![0]!.strokeData!.flowBuffer;
    delete runtime.layers![0]!.strokeData!.phaseBuffer;

    const result = captureColorCyclePersistenceSnapshot(makeLayer({
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        mode: 'brush',
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: persisted,
      }, {
        gradientIdBuffer: buffer(4, 9),
        gradientDefIdBuffer: buffer(8, 10),
      }),
    }), {
      projectWidth: 2,
      projectHeight: 2,
      requirePaint: true,
      mode: 'diagnostic',
      runtimeBrush: {
        serialize: () => runtime,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('persisted-brush-state');
      expect(result.brushState.layers?.[0]?.strokeData?.strokeCounter).toBe(42);
      expect(result.documentState.paintBuffer).toBeInstanceOf(ArrayBuffer);
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: 'live-runtime',
          kind: 'source-rejected',
        }),
      ]));
    }
  });
});
