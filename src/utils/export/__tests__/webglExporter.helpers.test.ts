/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../webglExporter';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

const {
  resolveDimensionFromCandidates,
  resolveRecolorSurfaceSize,
  clampBoundsToSurface,
  clampExportLayerSpeedScale,
  applyExportPlaybackScale,
  scaleEncodedSpeedBuffer,
  buildSequentialExportPlayback,
  extractBrushStateFromSavedSnapshot,
  resolveDefBoundSlotPalettes,
  normalizeCanvasSurfaceForExport,
} = __TESTING__;

const encodeBytes = (values: number[]): string => Buffer.from(Uint8Array.from(values)).toString('base64');

describe('webglExporter helpers', () => {
  it('resolves first positive numeric candidate and clamps to >=1', () => {
    expect(resolveDimensionFromCandidates([null, '5', 0], 10)).toBe(5);
    expect(resolveDimensionFromCandidates([undefined, -2], 0)).toBe(1);
  });

  it('derives recolor surface size from layer fallbacks and project', () => {
    const project = { width: 200, height: 150 } as any;
    const layer = { colorCycleData: { recolorSettings: { originalImageData: { width: 50, height: 60 } } } } as any;
    expect(resolveRecolorSurfaceSize(layer, project)).toEqual({ width: 50, height: 60 });

    const layerNoImage = { colorCycleData: {}, imageData: { width: 80, height: 90 } } as any;
    expect(resolveRecolorSurfaceSize(layerNoImage, project)).toEqual({ width: 80, height: 90 });
  });

  it('clamps bounds to surface dimensions', () => {
    const bounds = { x: -5, y: -5, width: 20, height: 20 } as any;
    const surface = { width: 10, height: 12 };
    const clamped = clampBoundsToSurface(bounds, surface);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    expect(clamped.width).toBeLessThanOrEqual(surface.width);
    expect(clamped.height).toBeLessThanOrEqual(surface.height);
  });

  it('clamps export layer speed scale and applies scaled playback speeds', () => {
    expect(clampExportLayerSpeedScale(undefined)).toBe(1);
    expect(clampExportLayerSpeedScale(0)).toBe(0.01);
    expect(clampExportLayerSpeedScale(10)).toBe(3);

    expect(applyExportPlaybackScale(0.8, 0.5)).toBeCloseTo(0.4, 5);
    expect(applyExportPlaybackScale(null, 0.5)).toBeNull();
  });

  it('scales encoded speed buffers for goblet speed parity', () => {
    const buffer = [encodeColorCycleSpeedByte(1.2), encodeColorCycleSpeedByte(0.4), 0];
    const scaledHalf = scaleEncodedSpeedBuffer(buffer, 0.5);
    expect(decodeColorCycleSpeedByte(scaledHalf[0])).toBeCloseTo(0.6, 1);
    expect(decodeColorCycleSpeedByte(scaledHalf[1])).toBeCloseTo(0.2, 1);
    expect(scaledHalf[2]).toBe(0);
  });

  it('keeps sequential export playback timing at the authored fps and duration', () => {
    expect(
      buildSequentialExportPlayback({
        fps: 12,
        frameCount: 24,
        durationMs: 2000,
      })
    ).toEqual({
      fps: 12,
      totalFrames: 24,
      durationSeconds: 2,
      perfectLoop: true,
    });

    expect(
      buildSequentialExportPlayback({
        fps: 18,
        frameCount: 9,
        durationMs: null,
      })
    ).toEqual({
      fps: 18,
      totalFrames: 9,
      durationSeconds: 0.5,
      perfectLoop: true,
    });
  });

  it('extracts brush state from persisted color-cycle snapshots when no live brush exists', () => {
    const brushState = extractBrushStateFromSavedSnapshot({
      id: 'layer-cc',
      layerType: 'color-cycle',
      imageData: { width: 2, height: 2 },
      colorCycleData: {
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        brushState: {
          cycleSpeed: 0.2,
          fps: 18,
          layers: [{
            layerId: 'layer-cc',
            strokeData: {
              paintBuffer: encodeBytes([1, 2, 3, 4]),
              gradientIdBuffer: encodeBytes([9, 9, 10, 10]),
              speedBuffer: encodeBytes([
                encodeColorCycleSpeedByte(0.2),
                encodeColorCycleSpeedByte(0.2),
                encodeColorCycleSpeedByte(0.2),
                encodeColorCycleSpeedByte(0.2),
              ]),
            },
          }],
        },
      },
    } as any);

    expect(brushState).toBeDefined();
    expect(brushState?.width).toBe(2);
    expect(brushState?.height).toBe(2);
    expect(brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.gradientIdBuffer).toEqual([9, 9, 10, 10]);
    expect(brushState?.speedBuffer).toHaveLength(4);
    expect(brushState?.targetFPS).toBe(18);
    expect(brushState?.animationSpeed).toBe(0.2);
  });

  it('rebuilds missing slot palettes from gradient def bindings during export', () => {
    const slotPalettes = resolveDefBoundSlotPalettes({
      data: {
        gradientDefIdBuffer: new Uint16Array([0, 5, 5, 0]).buffer,
        gradientDefStore: [{
          id: 5,
          kind: 'linear',
          stops: [
            { position: 0, color: '#112233' },
            { position: 1, color: '#445566' },
          ],
          hash: 'def-5',
          source: 'manual',
          seamProfile: 'soft',
          createdAtMs: 0,
          slot: 6,
        }],
      } as any,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 1, 1, 1],
        gradientIdBuffer: [6, 24, 24, 6],
        gradientDefIdBuffer: [0, 5, 5, 0],
        gradientStops: [],
        animationOffset: 0,
      },
      slotPalettes: [{
        slot: 6,
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      }],
    });

    expect(slotPalettes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slot: 24,
        seamProfile: 'soft',
        stops: [
          { position: 0, color: '#112233' },
          { position: 1, color: '#445566' },
        ],
      }),
    ]));
  });

  it('normalizes canvas-like surfaces for export encoding', () => {
    const sourceImage = new ImageData(
      new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
        70, 80, 90, 255,
        100, 110, 120, 255,
      ]),
      2,
      2
    );
    const sourceCtx = {
      getImageData: jest.fn(() => sourceImage),
    };
    const wrapper = {
      width: 2,
      height: 2,
      getContext: jest.fn(() => sourceCtx),
    };

    const normalized = normalizeCanvasSurfaceForExport(wrapper as any);
    expect(normalized).toBeTruthy();
    const normalizedCtx = normalized?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    const pixel = normalizedCtx?.getImageData(1, 1, 1, 1).data;
    expect(Array.from(pixel ?? [])).toEqual([100, 110, 120, 255]);
  });
});
