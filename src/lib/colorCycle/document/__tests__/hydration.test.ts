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
      toRepairStatusReasonForPrimaryPayloadFailure: () => 'missing-paint-buffer',
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

  it('keeps failed materialization cold and retries from the same resident document', async () => {
    const manager = createColorCycleBrushManager();
    const layer = createColorCycleLayer();
    const fallbackPixel = new ImageData(2, 2);
    fallbackPixel.data.set([40, 80, 120, 255], 0);
    layer.colorCycleData!.canvas!.getContext('2d')?.putImageData(fallbackPixel, 0, 0);
    const document = manager.ensureDocument(layer.id, 2, 2, {
      residency: 'cold-archive-ref',
      archiveRefs: { paintRef: 'paint.bin' },
    });
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
        ? { brush: null, materialized: false, reason: 'materialization-failed' }
        : { brush, materialized: true, documentVersion: 0 };
    });
    const dependencies = {
      shouldDeferColorCycleRuntimeRestore: () => false,
      getLazyColorCycleArchiveRuntime: () => undefined,
      hydrateLazyColorCycleArchiveRuntime: jest.fn().mockResolvedValue(undefined),
      getSavedColorCycleBrushState: (candidate: Layer) => (
        candidate.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined
      ),
      serializeRuntimeBrushState: () => undefined,
      restoreLayerRuntimeForMaterialization,
      describeBufferForDebug: () => null,
      isPrimaryColorCyclePayloadFailure: () => false,
      toRepairStatusReasonForPrimaryPayloadFailure: () => 'missing-paint-buffer' as const,
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
    expect(layer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(layer.colorCycleData?.repairStatus).toBeUndefined();
    expect(manager.hasBrush(layer.id)).toBe(false);
    expect(manager.getDocument(layer.id)).toBe(document);
    expect(manager.getDocument(layer.id)?.residency).toBe('resident');
    expect(Array.from(new Uint8Array(failedRead?.snapshot.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    expect(layer.colorCycleData?.canvas?.getContext('2d')?.getImageData(0, 0, 1, 1).data)
      .toEqual(new Uint8ClampedArray([40, 80, 120, 255]));

    layer.colorCycleData!.deferredRuntimeRestore = false;
    await restoreColorCycleBrushesWithDocumentHydration(
      [layer],
      { activeLayerId: layer.id, colorCycleBrushManager: manager },
      dependencies,
    );

    expect(layer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(manager.hasBrush(layer.id)).toBe(true);
    expect(manager.getDocument(layer.id)).toBe(document);
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
        getSavedColorCycleBrushState: () => undefined,
        serializeRuntimeBrushState: () => undefined,
        restoreLayerRuntimeForMaterialization: jest.fn().mockResolvedValue({
          brush: null,
          materialized: false,
          reason: 'missing-paint-buffer',
        }),
        describeBufferForDebug: () => null,
        isPrimaryColorCyclePayloadFailure: () => false,
        toRepairStatusReasonForPrimaryPayloadFailure: () => 'missing-paint-buffer',
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
