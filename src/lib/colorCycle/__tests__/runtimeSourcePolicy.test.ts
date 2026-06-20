import {
  hasColorCycleEditableRuntimeSource,
  hasColorCycleWarmableRuntimeSource,
  resolveColorCycleRuntimeSourcePolicy,
} from '@/lib/colorCycle/runtimeSourcePolicy';
import type { Layer } from '@/types';

const makeLayer = (overrides: Partial<Layer>): Layer => ({
  id: 'layer-cc',
  name: 'CC',
  order: 0,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  layerType: 'color-cycle',
  framebuffer: { width: 2, height: 2 } as HTMLCanvasElement,
  ...overrides,
} as Layer);

describe('runtimeSourcePolicy', () => {
  it('accepts complete deferred document refs as editable and warmable', () => {
    const layer = makeLayer({
      state: {
        hasContent: true,
        paintRef: 'zip:paint.bin',
        gradientIdRef: 'zip:gradient-id.bin',
        gradientDefIdRef: 'zip:gradient-def-id.bin',
        speedRef: 'zip:speed.bin',
        flowRef: 'zip:flow.bin',
        phaseRef: 'zip:phase.bin',
      },
      colorCycleData: {
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: true,
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(policy.hasEditableSource).toBe(true);
    expect(policy.hasPlaybackWarmupSource).toBe(true);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(true);
  });

  it('does not treat gradient-only refs as an editable source', () => {
    const layer = makeLayer({
      state: {
        hasContent: true,
        gradientIdRef: 'zip:gradient-id.bin',
        gradientDefIdRef: 'zip:gradient-def-id.bin',
      },
      colorCycleData: {
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: false,
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(hasColorCycleEditableRuntimeSource(layer)).toBe(false);
    expect(policy.hasRuntimeRestoreSource).toBe(true);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(true);
  });

  it('accepts canonical persisted brush paint as warmable even without complete edit buffers', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: false,
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-cc',
            canonicalPaint: true,
            schemaVersion: 1,
            strokeData: {
              hasContent: true,
              paintBuffer: Uint8Array.from([1, 0, 0, 0]).buffer,
            },
          }],
        },
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(policy.hasEditableSource).toBe(false);
    expect(policy.hasRecoverableRuntimeSource).toBe(true);
    expect(policy.hasPlaybackWarmupSource).toBe(true);
    expect(policy.isPreviewOnly).toBe(false);
  });

  it('marks empty preview-only color-cycle layers as preview-only', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: false,
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(policy.hasEditableSource).toBe(false);
    expect(policy.hasRecoverableRuntimeSource).toBe(false);
    expect(policy.hasRuntimeRestoreSource).toBe(false);
    expect(policy.hasPlaybackWarmupSource).toBe(false);
    expect(policy.isPreviewOnly).toBe(true);
  });

  it('treats top-level gradient buffers as runtime restore candidates, not editable payloads', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'warm',
        deferredRuntimeRestore: false,
        gradientIdBuffer: new Uint8Array(4).buffer,
        gradientDefIdBuffer: new Uint16Array(4).buffer,
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(policy.hasEditableSource).toBe(false);
    expect(policy.hasRuntimeRestoreSource).toBe(true);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(true);
  });

  it('treats brushState gradient buffers as runtime restore candidates, not editable payloads', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'warm',
        deferredRuntimeRestore: false,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-cc',
            canonicalPaint: true,
            schemaVersion: 1,
            strokeData: {
              gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]).buffer,
              gradientDefIdBuffer: new Uint16Array([0, 1, 1, 0]).buffer,
            },
          }],
        },
      },
    } as Partial<Layer>);

    const policy = resolveColorCycleRuntimeSourcePolicy(layer);

    expect(policy.hasEditableSource).toBe(false);
    expect(policy.hasRecoverableRuntimeSource).toBe(false);
    expect(policy.hasRuntimeRestoreSource).toBe(true);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(true);
  });
});
