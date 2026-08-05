import { restoreColorCycleBrushesWithDocumentHydration } from '@/lib/colorCycle/document/hydration';
import type { PersistedColorCycleBrushState } from '@/lib/colorCycle/persistence';
import {
  createColorCycleBrushManager,
  disposeColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const createTestCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const createColorCycleLayer = (): Layer => {
  const paintBuffer = new Uint8Array([1, 0, 0, 0]).buffer;
  const gradientIdBuffer = new Uint8Array([1, 1, 1, 1]).buffer;
  const gradientDefIdBuffer = new Uint16Array([1, 1, 1, 1]).buffer;
  const speedBuffer = new Uint8Array([2, 2, 2, 2]).buffer;
  const flowBuffer = new Uint8Array([3, 3, 3, 3]).buffer;
  const phaseBuffer = new Uint8Array([4, 4, 4, 4]).buffer;

  return {
    id: 'cc-layer',
    name: 'CC Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: createTestCanvas(2, 2),
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    version: 1,
    colorCycleData: {
      documentId: 'cc-layer',
      canvas: createTestCanvas(2, 2),
      canvasWidth: 2,
      canvasHeight: 2,
      hasContent: true,
      brushState: {
        layers: [{
          layerId: 'cc-layer',
          strokeData: {
            paintBuffer,
            gradientIdBuffer,
            gradientDefIdBuffer,
            speedBuffer,
            flowBuffer,
            phaseBuffer,
            hasContent: true,
          },
        }],
      },
    },
  };
};

describe('restoreColorCycleBrushesWithDocumentHydration', () => {
  afterEach(() => {
    disposeColorCycleBrushManager();
  });

  it('logs document versions for hydration diagnostics and runtime restore completion', async () => {
    const debug = {
      log: jest.fn(),
      warn: jest.fn(),
    };
    const layer = createColorCycleLayer();

    await restoreColorCycleBrushesWithDocumentHydration([layer], { activeLayerId: layer.id }, {
      shouldDeferColorCycleRuntimeRestore: () => false,
      getLazyColorCycleArchiveRuntime: () => undefined,
      hydrateLazyColorCycleArchiveRuntime: jest.fn().mockResolvedValue(undefined),
      commitLazyColorCycleArchiveRuntimeHydration: jest.fn(),
      getSavedColorCycleBrushState: (candidate) => (
        candidate.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined
      ),
      serializeRuntimeBrushState: () => undefined,
      restoreLayerRuntimeForMaterialization: jest.fn().mockResolvedValue({
        brush: {},
        materialized: true,
        documentVersion: 7,
      }),
      describeBufferForDebug: (buffer) => (
        buffer instanceof ArrayBuffer
          ? { bytes: buffer.byteLength, nonZeroSample: new Uint8Array(buffer).some((value) => value !== 0) ? 1 : 0 }
          : null
      ),
      isPrimaryColorCyclePayloadFailure: () => false,
      withColorCycleDiagnosticNotes: (notes, extra = []) => [...notes, ...extra],
      debug,
    });

    expect(debug.log).toHaveBeenCalledWith(
      'canonical-payload-diagnostic',
      expect.objectContaining({
        layerId: 'cc-layer',
        documentVersion: 0,
      }),
    );
    expect(debug.log).toHaveBeenCalledWith(
      'runtime-restore-complete',
      expect.objectContaining({
        layerId: 'cc-layer',
        documentVersion: 7,
      }),
    );
  });

  it('does not let an empty resident registry document override persisted canonical buffers', async () => {
    const manager = createColorCycleBrushManager();
    const layer = createColorCycleLayer();
    const strokeData = (layer.colorCycleData?.brushState as PersistedColorCycleBrushState)
      .layers?.[0]?.strokeData;
    const encode = (buffer: ArrayBuffer): string => (
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
    );
    if (strokeData) {
      strokeData.paintBuffer = encode(strokeData.paintBuffer as ArrayBuffer);
      strokeData.gradientIdBuffer = encode(strokeData.gradientIdBuffer as ArrayBuffer);
      strokeData.gradientDefIdBuffer = encode(strokeData.gradientDefIdBuffer as ArrayBuffer);
      strokeData.speedBuffer = encode(strokeData.speedBuffer as ArrayBuffer);
      strokeData.flowBuffer = encode(strokeData.flowBuffer as ArrayBuffer);
      strokeData.phaseBuffer = encode(strokeData.phaseBuffer as ArrayBuffer);
    }
    manager.ensureDocument(layer.id, 2, 2, { residency: 'resident' });
    const restoreLayerRuntimeForMaterialization = jest.fn().mockResolvedValue({
      brush: {},
      materialized: true,
      documentVersion: 0,
    });

    await restoreColorCycleBrushesWithDocumentHydration(
      [layer],
      { activeLayerId: layer.id, colorCycleBrushManager: manager },
      {
        shouldDeferColorCycleRuntimeRestore: () => false,
        getLazyColorCycleArchiveRuntime: () => undefined,
        hydrateLazyColorCycleArchiveRuntime: jest.fn().mockResolvedValue(undefined),
        commitLazyColorCycleArchiveRuntimeHydration: jest.fn(),
        getSavedColorCycleBrushState: (candidate) => (
          candidate.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined
        ),
        serializeRuntimeBrushState: () => undefined,
        restoreLayerRuntimeForMaterialization,
        describeBufferForDebug: () => null,
        isPrimaryColorCyclePayloadFailure: () => false,
        withColorCycleDiagnosticNotes: (notes, extra = []) => [...notes, ...extra],
        debug: { log: jest.fn(), warn: jest.fn() },
      },
    );

    expect(restoreLayerRuntimeForMaterialization).toHaveBeenCalledWith(
      layer,
      expect.any(Function),
      expect.any(Function),
      undefined,
      { kind: 'populated' },
    );
    expect(manager.getDocument(layer.id)?.read().snapshot.paintBuffer).toEqual(
      new Uint8Array([1, 0, 0, 0]).buffer,
    );
    expect(layer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(layer.colorCycleData?.deferredRuntimeRestore).toBe(false);
  });

  it('keeps a lazy archive retryable when runtime restore transiently reports missing paint', async () => {
    const manager = createColorCycleBrushManager();
    const layer = createColorCycleLayer();
    const fallbackPixel = new ImageData(2, 2);
    fallbackPixel.data.set([40, 80, 120, 255], 0);
    layer.colorCycleData!.canvas!.getContext('2d')?.putImageData(fallbackPixel, 0, 0);
    const document = manager.ensureDocument(layer.id, 2, 2, {
      residency: 'cold-archive-ref',
      archiveRefs: { paintRef: 'paint.bin' },
    });
    const lazyRuntime = { paintRef: 'paint.bin' };
    let hasLazyRuntime = true;
    const commitLazyColorCycleArchiveRuntimeHydration = jest.fn(() => {
      hasLazyRuntime = false;
    });
    const originalBrushState = layer.colorCycleData?.brushState as PersistedColorCycleBrushState;
    const originalStrokeData = originalBrushState.layers?.[0]?.strokeData;
    const originalPayloads = {
      paint: Array.from(new Uint8Array(originalStrokeData?.paintBuffer as ArrayBuffer)),
      gradientId: Array.from(new Uint8Array(originalStrokeData?.gradientIdBuffer as ArrayBuffer)),
      gradientDefId: Array.from(new Uint8Array(originalStrokeData?.gradientDefIdBuffer as ArrayBuffer)),
      speed: Array.from(new Uint8Array(originalStrokeData?.speedBuffer as ArrayBuffer)),
      flow: Array.from(new Uint8Array(originalStrokeData?.flowBuffer as ArrayBuffer)),
      phase: Array.from(new Uint8Array(originalStrokeData?.phaseBuffer as ArrayBuffer)),
    };
    let attempt = 0;
    const restoreLayerRuntimeForMaterialization = jest.fn(async (
      candidate: Layer,
      createBrush: Parameters<Parameters<
        typeof restoreColorCycleBrushesWithDocumentHydration
      >[2]['restoreLayerRuntimeForMaterialization']>[1],
      _canSeed: unknown,
      _rebase: unknown,
      expectedContent: unknown,
    ) => {
      attempt += 1;
      const brush = createBrush(candidate, candidate.colorCycleData!.canvas!);
      expect(expectedContent).toEqual({ kind: 'populated' });
      return attempt === 1
        ? { brush: null, materialized: false, reason: 'missing-paint-buffer' }
        : { brush, materialized: true, documentVersion: 0 };
    });
    const dependencies = {
      shouldDeferColorCycleRuntimeRestore: () => false,
      getLazyColorCycleArchiveRuntime: () => hasLazyRuntime ? lazyRuntime : undefined,
      hydrateLazyColorCycleArchiveRuntime: jest.fn().mockResolvedValue(undefined),
      commitLazyColorCycleArchiveRuntimeHydration,
      getSavedColorCycleBrushState: (candidate: Layer) => (
        candidate.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined
      ),
      serializeRuntimeBrushState: () => undefined,
      restoreLayerRuntimeForMaterialization,
      describeBufferForDebug: () => null,
      isPrimaryColorCyclePayloadFailure: () => false,
      withColorCycleDiagnosticNotes: (notes: string[], extra: string[] = []) => [...notes, ...extra],
      debug: { log: jest.fn(), warn: jest.fn() },
    };

    await restoreColorCycleBrushesWithDocumentHydration(
      [layer],
      { activeLayerId: layer.id, colorCycleBrushManager: manager },
      dependencies,
    );

    const failedRead = manager.getDocument(layer.id)?.read();
    expect(layer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(layer.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(layer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(layer.colorCycleData?.repairStatus).toBeUndefined();
    expect(commitLazyColorCycleArchiveRuntimeHydration).not.toHaveBeenCalled();
    expect(hasLazyRuntime).toBe(true);
    expect(manager.hasBrush(layer.id)).toBe(false);
    expect(manager.getDocument(layer.id)).toBe(document);
    expect(manager.getDocument(layer.id)?.residency).toBe('cold-archive-ref');
    expect(Array.from(new Uint8Array(failedRead?.snapshot.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    const failedBrushState = layer.colorCycleData?.brushState as PersistedColorCycleBrushState;
    const failedStrokeData = failedBrushState.layers?.[0]?.strokeData;
    expect(Array.from(new Uint8Array(failedStrokeData?.paintBuffer as ArrayBuffer))).toEqual(originalPayloads.paint);
    expect(Array.from(new Uint8Array(failedStrokeData?.gradientIdBuffer as ArrayBuffer))).toEqual(originalPayloads.gradientId);
    expect(Array.from(new Uint8Array(failedStrokeData?.gradientDefIdBuffer as ArrayBuffer))).toEqual(originalPayloads.gradientDefId);
    expect(Array.from(new Uint8Array(failedStrokeData?.speedBuffer as ArrayBuffer))).toEqual(originalPayloads.speed);
    expect(Array.from(new Uint8Array(failedStrokeData?.flowBuffer as ArrayBuffer))).toEqual(originalPayloads.flow);
    expect(Array.from(new Uint8Array(failedStrokeData?.phaseBuffer as ArrayBuffer))).toEqual(originalPayloads.phase);
    expect(layer.colorCycleData?.canvas?.getContext('2d')?.getImageData(0, 0, 1, 1).data)
      .toEqual(new Uint8ClampedArray([40, 80, 120, 255]));

    await restoreColorCycleBrushesWithDocumentHydration(
      [layer],
      { activeLayerId: layer.id, colorCycleBrushManager: manager },
      dependencies,
    );

    expect(layer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(layer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(manager.hasBrush(layer.id)).toBe(true);
    expect(manager.getDocument(layer.id)).toBe(document);
    expect(commitLazyColorCycleArchiveRuntimeHydration).toHaveBeenCalledTimes(1);
    expect(hasLazyRuntime).toBe(false);
    expect(restoreLayerRuntimeForMaterialization).toHaveBeenCalledTimes(2);
  });

  it('keeps irrecoverable missing paint distinct and preview-only', async () => {
    const manager = createColorCycleBrushManager();
    const layer = createColorCycleLayer();
    const brushState = layer.colorCycleData?.brushState as
      | PersistedColorCycleBrushState
      | undefined;
    const strokeData = brushState?.layers?.[0]?.strokeData;
    if (strokeData) {
      delete strokeData.paintBuffer;
    }

    await restoreColorCycleBrushesWithDocumentHydration(
      [layer],
      { colorCycleBrushManager: manager },
      {
        shouldDeferColorCycleRuntimeRestore: () => false,
        getLazyColorCycleArchiveRuntime: () => undefined,
        hydrateLazyColorCycleArchiveRuntime: jest.fn().mockResolvedValue(undefined),
        commitLazyColorCycleArchiveRuntimeHydration: jest.fn(),
        getSavedColorCycleBrushState: () => undefined,
        serializeRuntimeBrushState: () => undefined,
        restoreLayerRuntimeForMaterialization: jest.fn().mockResolvedValue({
          brush: null,
          materialized: false,
          reason: 'missing-paint-buffer',
        }),
        describeBufferForDebug: () => null,
        isPrimaryColorCyclePayloadFailure: () => false,
        withColorCycleDiagnosticNotes: (notes, extra = []) => [...notes, ...extra],
        debug: { log: jest.fn(), warn: jest.fn() },
      },
    );

    expect(layer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(layer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    expect(manager.getDocument(layer.id)?.residency).toBe('static-preview-only');
  });
});
