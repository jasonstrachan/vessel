import { presentVesselMultiplayerFrame } from '../vesselMultiplayerPresentation';
import type { CompositeSegment } from '@/stores/layers/layersSliceTypes';
import type { Layer } from '@/types';

describe('vesselMultiplayerPresentation', () => {
  it('refreshes renderer-owned segment and layer refs before drawing the acknowledged frame', async () => {
    const segment = { kind: 'static', id: 'fresh-segment' } as CompositeSegment;
    const layer = { id: 'ai-layer' } as Layer;
    const compositeSegmentsRef = { current: [] as CompositeSegment[] };
    const layerMapRef = { current: new Map<string, Layer>() };
    const context = {} as CanvasRenderingContext2D;
    const draw = jest.fn(() => {
      expect(compositeSegmentsRef.current).toEqual([segment]);
      expect(layerMapRef.current.get('ai-layer')).toBe(layer);
    });
    let acknowledge: FrameRequestCallback = () => undefined;

    const pending = presentVesselMultiplayerFrame({
      canvas: { getContext: jest.fn(() => context) } as unknown as HTMLCanvasElement,
      compositeSegmentsRef,
      draw,
      layerMapRef,
      state: {
        layers: [layer],
        getCompositeSegmentsSnapshot: () => [segment],
      },
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      scheduleFrame: (callback) => {
        acknowledge = callback;
        return 1;
      },
    });

    expect(draw).toHaveBeenCalledWith(context, { scale: 1, offsetX: 0, offsetY: 0 });
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    acknowledge(0);
    await pending;
    expect(resolved).toBe(true);
  });
});
