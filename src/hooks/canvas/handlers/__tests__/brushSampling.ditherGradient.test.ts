import type React from 'react';

import { updateDitherGradSamples } from '@/hooks/canvas/handlers/brushSampling';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

describe('updateDitherGradSamples', () => {
  it('preserves a valid transparent count for sampled palettes above two colors', () => {
    const setBrushSettings = jest.fn();
    const store = {
      tools: {
        brushSettings: {
          brushShape: BrushShape.DITHER_GRADIENT,
          ditherGradSampleEnabled: true,
          ditherGradStops: ['#111111', '#222222', '#333333', '#444444'],
          trans: 3,
        },
      },
      setBrushSettings,
    } as unknown as AppState;

    updateDitherGradSamples({
      sourcePts: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
      now: 1000,
      ditherGradSampleLastUpdateRef: { current: 0 },
      deps: {
        storeRef: { current: store } as React.MutableRefObject<AppState>,
        drawingCanvasRef: { current: null },
        drawingCtxRef: { current: null },
        drawingCanvasHasContent: { current: false },
        sampleColorAt: (x) => `#${Math.round(x).toString(16).padStart(6, '0')}`,
      },
    });

    expect(setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: expect.any(Array),
    });
    expect(setBrushSettings.mock.calls[0]?.[0]).not.toHaveProperty('trans');
  });
});
