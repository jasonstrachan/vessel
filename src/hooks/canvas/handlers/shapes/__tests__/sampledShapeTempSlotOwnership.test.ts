import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';
import { discardAbandonedSampledShapeTempPixels } from '@/hooks/canvas/handlers/shapes/sampledShapeTempSlotOwnership';

describe('sampled shape temp-slot ownership', () => {
  it('discards stale stroke-shaped temp pixels without touching committed pixels', () => {
    const apply = jest.fn();
    const brush = {
      getColorCycleLayerDocument: () => ({
        read: () => ({
          version: 1,
          pixelVersion: 1,
          snapshot: {
            layerId: 'layer-1',
            width: 4,
            height: 1,
            paintBuffer: new Uint8Array([255, 200, 150, 0]).buffer,
            gradientIdBuffer: new Uint8Array([TEMP_SAMPLE_SLOT, 7, TEMP_SAMPLE_SLOT, TEMP_SAMPLE_SLOT]).buffer,
            gradientDefIdBuffer: new Uint16Array([21, 22, 23, 24]).buffer,
            speedBuffer: new Uint8Array([31, 32, 33, 34]).buffer,
            flowBuffer: new Uint8Array([41, 42, 43, 44]).buffer,
            phaseBuffer: new Uint8Array([51, 52, 53, 54]).buffer,
            hasContent: true,
            sources: {
              brushStateSnapshot: true,
              topLevelBuffers: false,
              legacyStateRefs: false,
            },
          },
        }),
      }),
    };
    registerColorCycleBrushLayerSnapshotRuntime(brush, { apply });

    const cleared = discardAbandonedSampledShapeTempPixels({
      brush,
      layerId: 'layer-1',
    });

    expect(cleared).toBe(2);
    expect(apply).toHaveBeenCalledTimes(1);
    const applied = apply.mock.calls[0]?.[1];
    expect(Array.from(new Uint8Array(applied.paintBuffer))).toEqual([0, 200, 0, 0]);
    expect(Array.from(new Uint8Array(applied.gradientIdBuffer))).toEqual([0, 7, 0, 0]);
    expect(Array.from(new Uint16Array(applied.gradientDefIdBuffer))).toEqual([0, 22, 0, 0]);
    expect(Array.from(new Uint8Array(applied.speedBuffer))).toEqual([0, 32, 0, 0]);
    expect(Array.from(new Uint8Array(applied.flowBuffer))).toEqual([0, 42, 0, 0]);
    expect(Array.from(new Uint8Array(applied.phaseBuffer))).toEqual([0, 52, 0, 0]);
    expect(applied.hasContent).toBe(true);
    expect(apply).toHaveBeenCalledWith(
      'layer-1',
      expect.any(Object),
      undefined,
      'discard-abandoned-sampled-shape-temp-slot',
      { suppressClearAudit: true },
    );
  });
});
