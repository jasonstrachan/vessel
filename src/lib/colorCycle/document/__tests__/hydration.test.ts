import { restoreColorCycleBrushesWithDocumentHydration } from '@/lib/colorCycle/document/hydration';
import type { PersistedColorCycleBrushState } from '@/lib/colorCycle/persistence';
import { disposeColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
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
});
