import {
  auditColorCycleLayerTransition,
  getPersistedCCMutationLog,
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';

jest.mock('@/utils/debug', () => ({
  __DEV__: true,
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  logError: jest.fn(),
  recordBreadcrumb: jest.fn(),
}));

describe('ccMutationAudit', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    delete (window as Window & { __VESSEL_CC_MUTATION_LOG__?: unknown }).__VESSEL_CC_MUTATION_LOG__;
    delete (window as Window & { __VESSEL_GET_CC_MUTATION_LOG__?: unknown }).__VESSEL_GET_CC_MUTATION_LOG__;
  });

  it('logs destructive CC layer transitions', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const before = summarizeColorCycleLayer({
      id: 'layer-1',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: document.createElement('canvas'),
      alignment: { mode: 'free', offsetPx: { x: 0, y: 0 } },
      layerType: 'color-cycle',
      colorCycleData: {
        hasContent: true,
        canvas: document.createElement('canvas'),
        gradientDefIdBuffer: new Uint16Array([1, 1]).buffer,
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: [{ position: 0, color: '#000000' }],
            hash: 'h1',
            createdAtMs: 1,
            source: 'manual',
          },
        ],
        slotPalettes: [{ slot: 1, stops: [{ position: 0, color: '#000000' }] }],
      },
    } as never);
    const after = summarizeColorCycleLayer({
      id: 'layer-1',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: document.createElement('canvas'),
      alignment: { mode: 'free', offsetPx: { x: 0, y: 0 } },
      layerType: 'color-cycle',
      colorCycleData: {
        hasContent: false,
      },
    } as never);

    auditColorCycleLayerTransition({
      event: 'layer-update-destructive',
      layerId: 'layer-1',
      reason: 'test',
      before,
      after,
    });

    const entries = (window as Window & {
      __VESSEL_CC_MUTATION_LOG__?: Array<{ event: string; reason?: string; layerId: string }>;
    }).__VESSEL_CC_MUTATION_LOG__;

    expect(warnSpy).not.toHaveBeenCalled();
    expect(entries?.[0]).toEqual(
      expect.objectContaining({
        event: 'layer-update-destructive',
        layerId: 'layer-1',
        reason: 'test',
      })
    );
    expect(getPersistedCCMutationLog()[0]).toEqual(
      expect.objectContaining({
        event: 'layer-update-destructive',
        layerId: 'layer-1',
        reason: 'test',
        stack: expect.stringContaining('layer-update-destructive'),
      })
    );
  });

  it('does not log benign transitions', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const before = summarizeColorCycleLayer({
      id: 'layer-1',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: document.createElement('canvas'),
      alignment: { mode: 'free', offsetPx: { x: 0, y: 0 } },
      layerType: 'color-cycle',
      colorCycleData: {
        hasContent: true,
        canvas: document.createElement('canvas'),
      },
    } as never);

    auditColorCycleLayerTransition({
      event: 'layer-update-destructive',
      layerId: 'layer-1',
      before,
      after: before,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stores audit entries on window for later inspection', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    logCCMutation({
      event: 'shape-commit-linear',
      layerId: 'layer-1',
      severity: 'info',
      details: { source: 'sampled' },
    });

    const entries = (window as Window & { __VESSEL_CC_MUTATION_LOG__?: Array<{ event: string }> })
      .__VESSEL_CC_MUTATION_LOG__;

    expect(infoSpy).not.toHaveBeenCalled();
    expect(entries?.[0]?.event).toBe('shape-commit-linear');
  });

  it('exposes persisted audit entries for review after reload-style memory loss', () => {
    logCCMutation({
      event: 'layer-remove',
      layerId: 'layer-1',
      reason: 'removeLayer',
      severity: 'warn',
    });

    delete (window as Window & { __VESSEL_CC_MUTATION_LOG__?: unknown }).__VESSEL_CC_MUTATION_LOG__;

    expect(getPersistedCCMutationLog()).toEqual([
      expect.objectContaining({
        event: 'layer-remove',
        layerId: 'layer-1',
        reason: 'removeLayer',
      }),
    ]);
    expect(typeof (window as Window & { __VESSEL_GET_CC_MUTATION_LOG__?: unknown })
      .__VESSEL_GET_CC_MUTATION_LOG__).toBe('function');
  });

  it('does not persist non-destructive production audit entries', () => {
    jest.resetModules();
    jest.doMock('@/utils/debug', () => ({
      __DEV__: false,
      debugLog: jest.fn(),
      debugWarn: jest.fn(),
      logError: jest.fn(),
      recordBreadcrumb: jest.fn(),
    }));
    const {
      getPersistedCCMutationLog: getProductionPersistedCCMutationLog,
      logCCMutation: logProductionCCMutation,
    } = jest.requireActual<typeof import('@/utils/colorCycle/ccMutationAudit')>(
      '@/utils/colorCycle/ccMutationAudit'
    );

    window.localStorage.clear();
    delete (window as Window & { __VESSEL_CC_MUTATION_LOG__?: unknown }).__VESSEL_CC_MUTATION_LOG__;
    delete (window as Window & { __VESSEL_GET_CC_MUTATION_LOG__?: unknown }).__VESSEL_GET_CC_MUTATION_LOG__;

    logProductionCCMutation({
      event: 'stroke-commit',
      layerId: 'layer-1',
      severity: 'info',
    });

    expect((window as Window & { __VESSEL_CC_MUTATION_LOG__?: unknown }).__VESSEL_CC_MUTATION_LOG__)
      .toBeUndefined();
    expect(window.localStorage.getItem('VESSEL_CC_MUTATION_LOG')).toBeNull();
    expect(getProductionPersistedCCMutationLog()).toEqual([]);
  });
});
