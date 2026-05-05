import type { Layer } from '@/types';
import {
  brushStateHasColorCyclePaintPayload,
  ccPayloadHasNonZeroByte,
  extractCanonicalBrushStateLayerSnapshot,
  hasRecoverableColorCycleRuntimeSource,
  resolveColorCycleRuntimeRestore,
} from '@/utils/colorCycle/resolveColorCycleRuntimeRestore';

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const makeLayer = (colorCycleData: NonNullable<Layer['colorCycleData']>): Layer => ({
  id: 'layer-cc',
  name: 'CC',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: {
    fit: 'contain',
    horizontal: 'center',
    vertical: 'center',
    positioning: 'auto',
  },
  layerType: 'color-cycle',
  colorCycleData,
});

describe('resolveColorCycleRuntimeRestore', () => {
  it('classifies decoded base64 paint by nonzero bytes, not string length', () => {
    expect(ccPayloadHasNonZeroByte(bytesToBase64(new Uint8Array([0, 0, 0])))).toBe(false);
    expect(ccPayloadHasNonZeroByte(bytesToBase64(new Uint8Array([0, 7, 0])))).toBe(true);
    expect(brushStateHasColorCyclePaintPayload({
      layers: [{
        layerId: 'layer-cc',
        strokeData: {
          hasContent: false,
          paintBuffer: bytesToBase64(new Uint8Array([0, 0, 0])),
        },
      }],
    })).toBe(false);
  });

  it('extracts canonical brush-state paint from persisted base64 snapshots', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: true,
      brushState: {
        layers: [{
          layerId: 'layer-cc',
          strokeData: {
            hasContent: true,
            paintBuffer: bytesToBase64(new Uint8Array([0, 5, 0, 0])),
            gradientIdBuffer: bytesToBase64(new Uint8Array([1, 1, 1, 1])),
            gradientDefIdBuffer: bytesToBase64(new Uint8Array(new Uint16Array([2, 2, 2, 2]).buffer)),
            speedBuffer: bytesToBase64(new Uint8Array([3, 3, 3, 3])),
          },
        }],
      },
    });

    const canonical = extractCanonicalBrushStateLayerSnapshot(layer);

    expect(canonical?.snapshot.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(canonical?.snapshot.paintBuffer ?? new ArrayBuffer(0)))).toEqual([0, 5, 0, 0]);
    expect(Array.from(new Uint8Array(canonical?.snapshot.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 1, 1, 1]);
    expect(Array.from(new Uint8Array(canonical?.snapshot.speedBuffer ?? new ArrayBuffer(0)))).toEqual([3, 3, 3, 3]);
  });

  it('recovers from canonical brushState when project-load incoming snapshot is empty', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: true,
      brushState: {
        layers: [{
          layerId: 'layer-cc',
          strokeData: {
            hasContent: true,
            paintBuffer: bytesToBase64(new Uint8Array([9, 0, 0, 0])),
          },
        }],
      },
    });

    const action = resolveColorCycleRuntimeRestore({
      layer,
      incomingSnapshot: { paintBuffer: new ArrayBuffer(0), hasContent: false },
      projectLoadRestore: true,
    });

    expect(action.kind).toBe('recover-from-canonical');
    expect(action.kind === 'recover-from-canonical'
      ? Array.from(new Uint8Array(action.snapshot.paintBuffer))
      : []
    ).toEqual([9, 0, 0, 0]);
  });

  it('recovers all-slot-zero canonical paint when hasContent is true', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: true,
      brushState: {
        layers: [{
          layerId: 'layer-cc',
          strokeData: {
            hasContent: true,
            paintBuffer: bytesToBase64(new Uint8Array([0, 0, 0, 0])),
            gradientIdBuffer: bytesToBase64(new Uint8Array([0, 0, 0, 0])),
          },
        }],
      },
    });

    const action = resolveColorCycleRuntimeRestore({
      layer,
      incomingSnapshot: { paintBuffer: new ArrayBuffer(0), hasContent: false },
      projectLoadRestore: true,
    });

    expect(action.kind).toBe('recover-from-canonical');
    expect(action.kind === 'recover-from-canonical'
      ? Array.from(new Uint8Array(action.snapshot.paintBuffer))
      : []
    ).toEqual([0, 0, 0, 0]);
  });

  it('does not treat another layer brushState snapshot as canonical payload for this layer', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: false,
      brushState: {
        layers: [{
          layerId: 'other-layer',
          strokeData: {
            hasContent: true,
            paintBuffer: bytesToBase64(new Uint8Array([8, 8, 8, 8])),
          },
        }],
      },
    });

    expect(resolveColorCycleRuntimeRestore({
      layer,
      incomingSnapshot: { paintBuffer: new ArrayBuffer(0), hasContent: false },
      projectLoadRestore: true,
    })).toEqual({ kind: 'allow-empty' });
  });

  it('does not treat repair-failed metadata as a recoverable runtime source', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: true,
      repairStatus: {
        ok: false,
        reason: 'missing-gradient-bindings',
      },
    });

    expect(hasRecoverableColorCycleRuntimeSource(layer)).toBe(false);
  });

  it('treats target-layer brushState paint as a recoverable runtime source', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: false,
      brushState: {
        layers: [{
          layerId: 'layer-cc',
          strokeData: {
            hasContent: true,
            paintBuffer: bytesToBase64(new Uint8Array([0, 0, 0, 0])),
          },
        }],
      },
    });

    expect(hasRecoverableColorCycleRuntimeSource(layer)).toBe(true);
  });

  it('allows empty project-load snapshots when canonical brushState is all-zero cleared paint', () => {
    const layer = makeLayer({
      mode: 'brush',
      hasContent: false,
      brushState: {
        layers: [{
          layerId: 'layer-cc',
          strokeData: {
            hasContent: false,
            paintBuffer: bytesToBase64(new Uint8Array([0, 0, 0, 0])),
          },
        }],
      },
    });

    expect(resolveColorCycleRuntimeRestore({
      layer,
      incomingSnapshot: { paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer, hasContent: false },
      projectLoadRestore: true,
    })).toEqual({ kind: 'allow-empty' });
  });
});
