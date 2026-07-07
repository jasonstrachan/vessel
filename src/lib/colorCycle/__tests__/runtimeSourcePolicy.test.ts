import {
  hasColorCycleEditableRuntimeSource,
  hasColorCycleWarmableRuntimeSource,
  resolveColorCycleRuntimeSourcePolicy,
} from '@/lib/colorCycle/runtimeSourcePolicy';
import { ColorCycleLayerDocument } from '@/lib/colorCycle/document';
import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
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

const makeDocumentState = (
  overrides: Partial<ColorCycleLayerDocumentState> = {},
): ColorCycleLayerDocumentState => ({
  layerId: 'layer-cc',
  width: 2,
  height: 2,
  paintBuffer: new Uint8Array(4).buffer,
  gradientIdBuffer: new Uint8Array(4).buffer,
  gradientDefIdBuffer: new Uint16Array(4).buffer,
  speedBuffer: new Uint8Array(4).buffer,
  flowBuffer: new Uint8Array(4).buffer,
  phaseBuffer: new Uint8Array(4).buffer,
  hasContent: true,
  sources: {
    brushStateSnapshot: false,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
  ...overrides,
});

describe('runtimeSourcePolicy', () => {
  it('requires a document instead of inferring source policy from legacy layer fields', () => {
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

    expect(policy).toEqual({
      isColorCycleLayer: true,
      hasEditableSource: false,
      hasRecoverableRuntimeSource: false,
      hasRuntimeRestoreSource: false,
      hasPlaybackWarmupSource: false,
      isPreviewOnly: true,
      diagnostics: [expect.objectContaining({
        source: 'document',
        kind: 'source-rejected',
      })],
    });
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(false);
  });

  it('accepts complete cold archive document refs as editable and warmable', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: true,
      },
    } as Partial<Layer>);
    const document = new ColorCycleLayerDocument(makeDocumentState({
      paintBuffer: undefined,
      gradientIdBuffer: undefined,
      gradientDefIdBuffer: undefined,
      speedBuffer: undefined,
      flowBuffer: undefined,
      phaseBuffer: undefined,
    }), {
      residency: 'cold-archive-ref',
      archiveRefs: {
        paintRef: 'zip:paint.bin',
        gradientIdRef: 'zip:gradient-id.bin',
        gradientDefIdRef: 'zip:gradient-def-id.bin',
        speedRef: 'zip:speed.bin',
        flowRef: 'zip:flow.bin',
        phaseRef: 'zip:phase.bin',
      },
    });

    const policy = resolveColorCycleRuntimeSourcePolicy(layer, { document });

    expect(policy.hasEditableSource).toBe(true);
    expect(policy.hasPlaybackWarmupSource).toBe(true);
    expect(hasColorCycleWarmableRuntimeSource(layer, { document })).toBe(true);
  });

  it('prefers document residency policy over stale layer-field inference', () => {
    const layer = makeLayer({
      colorCycleData: {
        runtimeHydrationState: 'warm',
        deferredRuntimeRestore: false,
        gradientIdBuffer: new Uint8Array(4).buffer,
        gradientDefIdBuffer: new Uint16Array(4).buffer,
      },
    } as Partial<Layer>);
    const document = new ColorCycleLayerDocument(makeDocumentState(), {
      residency: 'static-preview-only',
    });

    const policy = resolveColorCycleRuntimeSourcePolicy(layer, { document });

    expect(policy).toEqual({
      isColorCycleLayer: true,
      hasEditableSource: false,
      hasRecoverableRuntimeSource: false,
      hasRuntimeRestoreSource: false,
      hasPlaybackWarmupSource: false,
      isPreviewOnly: true,
      diagnostics: [expect.objectContaining({
        source: 'document',
        kind: 'source-selected',
      })],
    });
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
    expect(policy.hasRuntimeRestoreSource).toBe(false);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(false);
  });

  it('does not infer warmability from persisted brush paint without a document', () => {
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
    expect(policy.hasRecoverableRuntimeSource).toBe(false);
    expect(policy.hasPlaybackWarmupSource).toBe(false);
    expect(policy.isPreviewOnly).toBe(true);
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
    expect(policy.hasRuntimeRestoreSource).toBe(false);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(false);
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
    expect(policy.hasRuntimeRestoreSource).toBe(false);
    expect(hasColorCycleWarmableRuntimeSource(layer)).toBe(false);
  });
});
