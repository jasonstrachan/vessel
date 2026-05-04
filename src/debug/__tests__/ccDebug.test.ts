describe('ccDebug overlay bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.__DEV_DEBUG_OVERLAY__ = false;
  });

  it('does not change the dev debug overlay preference when CC debug is turned on', async () => {
    await import('@/debug/ccDebug');

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);

    window.__CC_DEBUG__ = true;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);
    expect(window.localStorage.getItem('devDebugOverlay')).toBeNull();
    expect(window.localStorage.getItem('ccDebug')).toBe('1');
  });

  it('does not change the dev debug overlay preference when CC debug is turned off', async () => {
    await import('@/debug/ccDebug');

    window.__DEV_DEBUG_OVERLAY__ = true;
    window.localStorage.setItem('devDebugOverlay', '1');
    window.__CC_DEBUG__ = true;
    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');

    window.__CC_DEBUG__ = false;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');
    expect(window.localStorage.getItem('ccDebug')).toBeNull();
  });

  it('does not write console or overlay logs when the dev overlay is off', async () => {
    const { ccLog } = await import('@/debug/ccDebug');
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    window.__CC_DEBUG__ = true;
    window.__DEV_DEBUG_OVERLAY__ = false;
    window.localStorage.removeItem('devDebugOverlay');

    ccLog('hidden overlay log');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(window.__DEV_DEBUG_OVERLAY_ENTRIES__ ?? []).toEqual([]);

    consoleLogSpy.mockRestore();
  });

  it('exposes a read-only active CC layer diagnostic helper', async () => {
    await import('@/debug/ccDebug');
    const { useAppStore } = await import('@/stores/useAppStore');
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;

    useAppStore.setState({
      activeLayerId: 'layer-cc-debug',
      layers: [{
        id: 'layer-cc-debug',
        name: 'CC',
        visible: true,
        opacity: 0.75,
        blendMode: 'source-over',
        locked: false,
        order: 0,
        imageData: null,
        framebuffer: null,
        layerType: 'color-cycle',
        colorCycleData: {
          hasContent: true,
          canvas,
          paintRef: 'zip:paint.bin',
        },
      } as never],
    });

    expect(window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.()).toEqual(
      expect.objectContaining({
        activeLayerId: 'layer-cc-debug',
        layerId: 'layer-cc-debug',
        layerName: 'CC',
        layerOrder: 0,
        layerType: 'color-cycle',
        visible: true,
        opacity: 0.75,
        hasColorCycleData: true,
        hasContent: true,
        isAnimating: null,
        runtimeHydrationState: null,
        hasRuntimeBrush: false,
        hasCanvas: true,
        canvasSize: '12x8',
        paintRef: 'zip:paint.bin',
      })
    );
    expect(window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.()).toEqual(
      expect.objectContaining({
        activeLayer: expect.objectContaining({
          activeLayerId: 'layer-cc-debug',
          hasContent: true,
        }),
        colorCycleLayers: [
          expect.objectContaining({
            activeLayerId: 'layer-cc-debug',
            layerId: 'layer-cc-debug',
            hasContent: true,
          }),
        ],
        mutationLog: expect.any(Array),
        storageKeys: expect.any(Array),
      })
    );
  });
});
