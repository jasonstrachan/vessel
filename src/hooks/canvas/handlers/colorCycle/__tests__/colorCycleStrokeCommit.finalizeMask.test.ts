import type React from 'react';
import {
  clearColorCycleEraseMaskInRegion,
  commitColorCycleStrokeIfNeeded,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { AppState } from '@/stores/useAppStore';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { BrushSettings, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

describe('colorCycleStrokeCommit finalize mask clear', () => {
  it('clears erase mask in ROI and bumps version without CC sync', () => {
    const clearRect = jest.fn();
    const getContext = jest.fn(() => ({ clearRect }));
    const updateLayer = jest.fn();
    const layerId = 'layer-1';
    const state = {
      layers: [
        {
          id: layerId,
          colorCycleData: {
            eraseMask: {
              width: 100,
              height: 80,
              getContext,
            } as unknown as HTMLCanvasElement,
            eraseMaskVersion: 4,
          },
        },
      ],
      updateLayer,
    };

    const storeRef = {
      current: state,
    } as unknown as React.MutableRefObject<AppState>;
    clearColorCycleEraseMaskInRegion(storeRef, layerId, {
      x: -10,
      y: 5,
      width: 120,
      height: 100,
    });

    expect(clearRect).toHaveBeenCalledWith(0, 5, 100, 75);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 5 } },
      { skipColorCycleSync: true }
    );
  });

  it('uses finalize capture ROI fallback when stroke bbox ROI is unavailable', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        hasContent: true,
        gradient: [],
      },
    };

    const clearEraseMaskInRegion = jest.fn();
    const brush: Pick<ManagedColorCycleBrush, 'commitCurrentStroke' | 'updateColorCycleTexture' | 'commitToLayer'> = {
      commitCurrentStroke: jest.fn(),
      updateColorCycleTexture: jest.fn(),
      commitToLayer: jest.fn(),
    };
    const brushSettings: Partial<BrushSettings> = {
      opacity: 1,
      blendMode: 'source-over',
    };

    const result = await commitColorCycleStrokeIfNeeded({
      isColorCycleLayer: true,
      isColorCycleBrush: true,
      activeLayer: layer,
      brushSettings: brushSettings as BrushSettings,
      project: { width: 64, height: 64 },
      drawingCanvas: canvas,
      strokeBoundingBox: null,
      captureRoi: { x: 12, y: 8, width: 10, height: 9 },
      strokeCapturePadding: 0,
      roiPadding: 0,
      enableCaptureRoi: true,
    }, {
      getBrushForLayer: () => brush as ManagedColorCycleBrush,
      bindBrushToCanvas: jest.fn(),
      markLayerHasContent: jest.fn(),
      clearEraseMaskInRegion,
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      startFinalizeVisibleTimer: jest.fn(),
      endFinalizeVisibleTimer: jest.fn(),
      dispatchFrameUpdate: jest.fn(),
    });

    expect(clearEraseMaskInRegion).toHaveBeenCalledWith(layer.id, { x: 12, y: 8, width: 10, height: 9 });
    expect(result.strokeCaptureRoi).toEqual({ x: 12, y: 8, width: 10, height: 9 });
  });
});
