import type React from 'react';
import {
  clearColorCycleEraseMaskInRegion,
  commitColorCycleStrokeIfNeeded,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { AppState } from '@/stores/useAppStore';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { BrushSettings, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';

describe('colorCycleStrokeCommit finalize mask clear', () => {
  const getAlpha = (canvas: HTMLCanvasElement, x: number, y: number): number => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Missing canvas context');
    }
    return ctx.getImageData(x, y, 1, 1).data[3];
  };

  it('falls back to clearing the erase mask ROI and bumps version without CC sync', () => {
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

  it('clears only newly painted alpha from the erase mask when an alpha source is provided', () => {
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 10;
    eraseMask.height = 10;
    const eraseMaskCtx = eraseMask.getContext('2d', { willReadFrequently: true });
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);

    const strokeCanvas = document.createElement('canvas');
    strokeCanvas.width = 10;
    strokeCanvas.height = 10;
    const strokeCtx = strokeCanvas.getContext('2d', { willReadFrequently: true });
    if (!strokeCtx) {
      throw new Error('Missing stroke context');
    }
    strokeCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    strokeCtx.fillRect(4, 4, 1, 1);

    const updateLayer = jest.fn();
    const layerId = 'layer-1';
    const state = {
      layers: [
        {
          id: layerId,
          colorCycleData: {
            eraseMask,
            eraseMaskVersion: 4,
          },
        },
      ],
      updateLayer,
    };

    const storeRef = {
      current: state,
    } as unknown as React.MutableRefObject<AppState>;
    clearColorCycleEraseMaskInRegion(
      storeRef,
      layerId,
      { x: 2, y: 2, width: 5, height: 5 },
      { alphaSource: strokeCanvas }
    );

    expect(getAlpha(eraseMask, 4, 4)).toBe(0);
    expect(getAlpha(eraseMask, 2, 2)).toBe(255);
    expect(getAlpha(eraseMask, 6, 6)).toBe(255);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 5 } },
      { skipColorCycleSync: true }
    );
  });

  it('clears only committed paint-mask pixels from the erase mask when a paint mask is provided', () => {
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 10;
    eraseMask.height = 10;
    const eraseMaskCtx = eraseMask.getContext('2d', { willReadFrequently: true });
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);

    const updateLayer = jest.fn();
    const layerId = 'layer-1';
    const state = {
      layers: [
        {
          id: layerId,
          colorCycleData: {
            eraseMask,
            eraseMaskVersion: 4,
          },
        },
      ],
      updateLayer,
    };

    clearColorCycleEraseMaskInRegion(
      { current: state } as unknown as React.MutableRefObject<AppState>,
      layerId,
      { x: 2, y: 2, width: 5, height: 5 },
      {
        paintMask: {
          data: new Uint8Array([
            0, 0, 0, 0, 0,
            0, 0, 255, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
          ]),
          width: 5,
          height: 5,
          bounds: { x: 2, y: 2, width: 5, height: 5 },
        },
      }
    );

    expect(getAlpha(eraseMask, 4, 3)).toBe(0);
    expect(getAlpha(eraseMask, 2, 2)).toBe(255);
    expect(getAlpha(eraseMask, 6, 6)).toBe(255);
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
        eraseMask: document.createElement('canvas'),
        eraseMaskVersion: 1,
        hasContent: true,
        gradient: [],
      },
    };

    const clearEraseMaskInRegion = jest.fn();
    const beforePaint = new Uint8Array(64 * 64);
    const afterPaint = new Uint8Array(64 * 64);
    afterPaint[9 * 64 + 14] = 8;
    const beforeGid = new Uint8Array(64 * 64);
    const afterGid = new Uint8Array(64 * 64);
    afterGid[9 * 64 + 14] = 2;
    const readDocumentSnapshot = jest.fn()
      .mockReturnValueOnce({
        snapshot: {
          paintBuffer: beforePaint.buffer,
          gradientIdBuffer: beforeGid.buffer,
          hasContent: true,
        },
        version: 1,
      })
      .mockReturnValueOnce({
        snapshot: {
          paintBuffer: afterPaint.buffer,
          gradientIdBuffer: afterGid.buffer,
          hasContent: true,
        },
        version: 2,
      });
    const brush: Pick<
      ManagedColorCycleBrush,
      'commitCurrentStroke' | 'updateColorCycleTexture' | 'commitToLayer' | 'getColorCycleLayerDocument'
    > = {
      commitCurrentStroke: jest.fn(),
      updateColorCycleTexture: jest.fn(),
      commitToLayer: jest.fn(),
      getColorCycleLayerDocument: jest.fn(() => ({
        read: readDocumentSnapshot,
      })) as never,
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

    expect(clearEraseMaskInRegion).toHaveBeenCalledWith(
      layer.id,
      { x: 12, y: 8, width: 10, height: 9 },
      {
        paintMask: expect.objectContaining({
          width: 10,
          height: 9,
          bounds: { x: 12, y: 8, width: 10, height: 9 },
        }),
      }
    );
    const paintMask = clearEraseMaskInRegion.mock.calls[0][2].paintMask;
    expect(paintMask.data[(9 - 8) * 10 + (14 - 12)]).toBe(255);
    expect(paintMask.data[0]).toBe(0);
    expect(result.strokeCaptureRoi).toEqual({ x: 12, y: 8, width: 10, height: 9 });
  });

  it('skips erase-mask snapshot and clear work for a fresh blank erase mask', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 64;
    eraseMask.height = 64;
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
        eraseMask,
        eraseMaskVersion: 0,
        hasContent: true,
        gradient: [],
      },
    };

    const clearEraseMaskInRegion = jest.fn();
    const readDocumentSnapshot = jest.fn();
    const brush: Pick<
      ManagedColorCycleBrush,
      'commitCurrentStroke' | 'updateColorCycleTexture' | 'commitToLayer' | 'getColorCycleLayerDocument'
    > = {
      commitCurrentStroke: jest.fn(),
      updateColorCycleTexture: jest.fn(),
      commitToLayer: jest.fn(),
      getColorCycleLayerDocument: jest.fn(() => ({
        read: readDocumentSnapshot,
      })) as never,
    };

    await commitColorCycleStrokeIfNeeded({
      isColorCycleLayer: true,
      isColorCycleBrush: true,
      activeLayer: layer,
      brushSettings: {
        opacity: 1,
        blendMode: 'source-over',
      } as BrushSettings,
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

    expect(readDocumentSnapshot).not.toHaveBeenCalled();
    expect(clearEraseMaskInRegion).not.toHaveBeenCalled();
  });

  it('removes locked-out CC stroke data from every canonical buffer before commit', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const layer: Layer = {
      id: 'layer-locked',
      name: 'CC locked',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: true,
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
    const snapshot = {
      paintBuffer: new Uint8Array([4, 9]).buffer,
      gradientIdBuffer: new Uint8Array([1, 2]).buffer,
      gradientDefIdBuffer: new Uint16Array([11, 12]).buffer,
      speedBuffer: new Uint8Array([21, 22]).buffer,
      flowBuffer: new Uint8Array([31, 32]).buffer,
      phaseBuffer: new Uint8Array([41, 42]).buffer,
      hasContent: true,
      strokeCounter: 3,
      width: 2,
      height: 1,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    };
    const applySnapshot = jest.fn();
    const brush = {
      commitCurrentStroke: jest.fn(),
      updateColorCycleTexture: jest.fn(),
      commitToLayer: jest.fn(),
      getColorCycleLayerDocument: jest.fn(() => ({
        read: () => ({ snapshot, version: 1, pixelVersion: 1 }),
      })),
    };
    registerColorCycleBrushLayerSnapshotRuntime(brush, { apply: applySnapshot });

    await commitColorCycleStrokeIfNeeded({
      isColorCycleLayer: true,
      isColorCycleBrush: true,
      activeLayer: layer,
      brushSettings: {
        opacity: 1,
        blendMode: 'source-over',
      } as BrushSettings,
      project: { width: 2, height: 1 },
      drawingCanvas: canvas,
      strokeBoundingBox: null,
      captureRoi: { x: 0, y: 0, width: 2, height: 1 },
      strokeCapturePadding: 0,
      roiPadding: 0,
      enableCaptureRoi: true,
      transparencyLockPaintMask: new Uint8Array([1, 0]),
    }, {
      getBrushForLayer: () => brush as unknown as ManagedColorCycleBrush,
      bindBrushToCanvas: jest.fn(),
      markLayerHasContent: jest.fn(),
      clearEraseMaskInRegion: jest.fn(),
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      startFinalizeVisibleTimer: jest.fn(),
      endFinalizeVisibleTimer: jest.fn(),
      dispatchFrameUpdate: jest.fn(),
    });

    expect(applySnapshot).toHaveBeenCalledTimes(1);
    const applied = applySnapshot.mock.calls[0][1];
    expect(Array.from(new Uint8Array(applied.paintBuffer))).toEqual([4, 0]);
    expect(Array.from(new Uint8Array(applied.gradientIdBuffer))).toEqual([1, 0]);
    expect(Array.from(new Uint16Array(applied.gradientDefIdBuffer))).toEqual([11, 0]);
    expect(Array.from(new Uint8Array(applied.speedBuffer))).toEqual([21, 0]);
    expect(Array.from(new Uint8Array(applied.flowBuffer))).toEqual([31, 0]);
    expect(Array.from(new Uint8Array(applied.phaseBuffer))).toEqual([41, 0]);
  });
});
