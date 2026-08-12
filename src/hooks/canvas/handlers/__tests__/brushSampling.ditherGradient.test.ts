import type React from 'react';

import {
  updateAutoSampledGradient,
  updateDitherGradSamples,
} from '@/hooks/canvas/handlers/brushSampling';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { setSharedColorCycleGradient } from '@/utils/colorCycleGradients';

jest.mock('@/utils/colorCycleGradients', () => ({
  setLayerColorCycleGradient: jest.fn(),
  setSharedColorCycleGradient: jest.fn(),
}));

const mockSetSharedColorCycleGradient =
  setSharedColorCycleGradient as jest.MockedFunction<typeof setSharedColorCycleGradient>;

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

describe('updateAutoSampledGradient', () => {
  beforeEach(() => {
    mockSetSharedColorCycleGradient.mockClear();
  });

  it('keeps a one-shot sample armed while updating its live gradient', () => {
    const store = {
      activeLayerId: 'layer-1',
      layers: [],
      tools: {
        brushSettings: {
          autoSampleGradient: true,
          autoSampleGradientRealtime: false,
          colorCycleGradient: [],
          gradientBands: 2,
        },
      },
      setBrushSettings: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as AppState;

    updateAutoSampledGradient({
      sourcePts: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
      now: 1000,
      autoSampleLastUpdateRef: { current: 0 },
      autoSampleForkRef: { current: true },
      autoSampleLastAppliedHashRef: { current: '' },
      deps: {
        storeRef: { current: store } as React.MutableRefObject<AppState>,
        drawingCanvasRef: { current: null },
        drawingCtxRef: { current: null },
        drawingCanvasHasContent: { current: false },
        sampleColorAt: (x) => (x < 40 ? '#ff0000' : '#0000ff'),
      },
    });

    expect(mockSetSharedColorCycleGradient).toHaveBeenCalledWith(
      expect.any(Array),
      {
        fork: true,
        preserveAutoSampleState: true,
      }
    );
  });
});
