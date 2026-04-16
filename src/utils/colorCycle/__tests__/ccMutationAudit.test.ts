import {
  auditColorCycleLayerTransition,
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';

jest.mock('@/utils/debug', () => ({
  __DEV__: true,
  logError: jest.fn(),
  recordBreadcrumb: jest.fn(),
}));

describe('ccMutationAudit', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    delete (window as Window & { __VESSEL_CC_MUTATION_LOG__?: unknown }).__VESSEL_CC_MUTATION_LOG__;
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
});
