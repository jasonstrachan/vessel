import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';

jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleStoreState: () => null,
  getColorCycleBrushManager: jest.fn(),
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

describe('captureColorCycleBrushState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('reuses cached erase mask snapshots when version is unchanged', () => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 4;
    maskCanvas.height = 4;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    expect(maskCtx).toBeTruthy();
    if (!maskCtx) {
      return;
    }
    maskCtx.fillStyle = 'rgba(0,0,0,1)';
    maskCtx.fillRect(0, 0, 4, 4);
    const getImageDataSpy = jest.spyOn(maskCtx, 'getImageData');

    let maskVersion = 1;
    (useAppStore.getState as jest.Mock).mockImplementation(() => ({
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-1',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
            eraseMask: maskCanvas,
            eraseMaskVersion: maskVersion,
          },
        },
      ],
    }));

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getHistoryBrush: () => ({
        getColorCycleLayerDocument: () => ({
          read: () => ({
            version: 1,
            snapshot: {
              layerId: 'layer-1',
              width: 4,
              height: 4,
              paintBuffer: new Uint8Array(16).fill(1).buffer,
              gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
              gradientDefIdBuffer: new Uint16Array(16).fill(1).buffer,
              speedBuffer: new Uint8Array(16).fill(1).buffer,
              flowBuffer: new Uint8Array(16).buffer,
              phaseBuffer: new Uint8Array(16).buffer,
              hasContent: true,
              sources: {
                brushStateSnapshot: false,
                topLevelBuffers: false,
                legacyStateRefs: false,
              },
            },
          }),
        }),
        serialize: () => ({
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-1',
            canonicalPaint: true,
            schemaVersion: 1,
            dimensions: { width: 4, height: 4 },
            strokeData: {
              paintBuffer: new Uint8Array(16).fill(1).buffer,
              gradientIdBuffer: new Uint8Array(16).fill(1).buffer,
              gradientDefIdBuffer: new Uint16Array(16).fill(1).buffer,
              speedBuffer: new Uint8Array(16).fill(1).buffer,
              flowBuffer: new Uint8Array(16).buffer,
              phaseBuffer: new Uint8Array(16).buffer,
              hasContent: true,
            },
          }],
        }),
      }),
    });

    captureColorCycleBrushState('layer-1');
    captureColorCycleBrushState('layer-1');
    expect(getImageDataSpy).toHaveBeenCalledTimes(1);

    maskVersion = 2;
    captureColorCycleBrushState('layer-1');
    expect(getImageDataSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves empty pre-stroke color-cycle history snapshots', () => {
    (useAppStore.getState as jest.Mock).mockReturnValue({
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-empty',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
          },
        },
      ],
    });

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getHistoryBrush: () => ({
        serialize: () => ({
          layers: [{
            layerId: 'layer-empty',
            strokeData: {
              hasContent: false,
            },
          }],
        }),
      }),
    });

    expect(captureColorCycleBrushState('layer-empty')).toEqual({
      layers: [{
        layerId: 'layer-empty',
        strokeData: {
          hasContent: false,
          paintBuffer: undefined,
          gradientIdBuffer: undefined,
          gradientDefIdBuffer: undefined,
          speedBuffer: undefined,
          flowBuffer: undefined,
          phaseBuffer: undefined,
        },
        eraseMaskSnapshot: undefined,
      }],
    });
  });

  it('records the document version on captured color-cycle history snapshots', () => {
    (useAppStore.getState as jest.Mock).mockReturnValue({
      project: { width: 2, height: 2 },
      layers: [
        {
          id: 'layer-versioned',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 2,
            canvasHeight: 2,
          },
        },
      ],
    });

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getHistoryBrush: () => ({
        getColorCycleLayerDocument: () => ({
          read: () => ({
            version: 9,
            snapshot: {
              layerId: 'layer-versioned',
              width: 2,
              height: 2,
              paintBuffer: new Uint8Array(4).fill(1).buffer,
              gradientIdBuffer: new Uint8Array(4).fill(2).buffer,
              gradientDefIdBuffer: new Uint16Array(4).fill(3).buffer,
              speedBuffer: new Uint8Array(4).fill(4).buffer,
              flowBuffer: new Uint8Array(4).fill(5).buffer,
              phaseBuffer: new Uint8Array(4).fill(6).buffer,
              hasContent: true,
              sources: {
                brushStateSnapshot: false,
                topLevelBuffers: false,
                legacyStateRefs: false,
              },
            },
          }),
        }),
        serialize: () => ({
          layers: [{
            layerId: 'layer-versioned',
            strokeData: {
              hasContent: true,
              paintBuffer: new Uint8Array(4).fill(8).buffer,
            },
          }],
        }),
      }),
    });

    const captured = captureColorCycleBrushState('layer-versioned');

    expect(captured?.documentVersion).toBe(9);
    expect(Array.from(new Uint8Array(
      captured?.layers[0]?.strokeData?.paintBuffer ?? new ArrayBuffer(0),
    ))).toEqual([1, 1, 1, 1]);
  });

  it('rejects metadata-only painted color-cycle history snapshots', () => {
    (useAppStore.getState as jest.Mock).mockReturnValue({
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-painted-metadata',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
          },
        },
      ],
    });

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getHistoryBrush: () => ({
        serialize: () => ({
          layers: [{
            layerId: 'layer-painted-metadata',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
            },
          }],
        }),
      }),
    });

    expect(captureColorCycleBrushState('layer-painted-metadata')).toBeNull();
    expect(getPersistedCCMutationLog()).toContainEqual(
      expect.objectContaining({
        event: 'history-cc-before-state-capture-failed',
        layerId: 'layer-painted-metadata',
        reason: 'missing-document-source',
        severity: 'warn',
        details: expect.objectContaining({
          source: 'captureColorCycleBrushState',
          expectedDestructive: false,
          project: expect.objectContaining({
            width: 4,
            height: 4,
            layerCount: 1,
          }),
          colorCycleData: expect.objectContaining({
            canvasWidth: 4,
            canvasHeight: 4,
          }),
          runtimeBrush: expect.objectContaining({
            present: true,
            canReadSerializedState: true,
          }),
          damageKind: null,
          rawSnapshot: expect.objectContaining({
            hasSnapshot: true,
            strokeHasContent: true,
            paintBytes: 0,
            buffers: expect.objectContaining({
              paint: expect.objectContaining({
                present: false,
                byteLength: 0,
                summary: null,
              }),
            }),
          }),
        }),
      })
    );
  });
});
