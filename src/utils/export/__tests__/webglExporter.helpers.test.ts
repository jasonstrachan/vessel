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
  minifyProperties,
  extractBrushStateFromSavedSnapshot,
  serializeBrushState,
  serializeColorCycleData,
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

  it('extracts brush state from live brush strokeData when animator payload is intentionally stripped', () => {
    const layer = {
      id: 'layer-cc',
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: { width: 128, height: 128 },
      colorCycleData: {
        canvasWidth: 8,
        canvasHeight: 8,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc',
              data: {
                indexBuffer: {
                  width: 8,
                  height: 8,
                  data: new Uint8Array(0),
                  gradientId: new Uint8Array(0),
                },
                gradient: {
                  gradientStops: [
                    { position: 0, color: '#000000' },
                    { position: 1, color: '#ffffff' },
                  ],
                },
                animation: {
                  offset: 3,
                  stats: {
                    targetFPS: 24,
                  },
                },
              },
              strokeData: {
                paintBuffer: encodeBytes([1, 2, 3, 4]),
                gradientIdBuffer: encodeBytes([9, 9, 10, 10]),
                speedBuffer: encodeBytes([
                  encodeColorCycleSpeedByte(0.5),
                  encodeColorCycleSpeedByte(0.5),
                  encodeColorCycleSpeedByte(0.5),
                  encodeColorCycleSpeedByte(0.5),
                ]),
              },
            }],
          }),
        },
      },
    } as any;

    const brushState = serializeBrushState(layer);

    expect(brushState).toBeDefined();
    expect(brushState?.width).toBe(8);
    expect(brushState?.height).toBe(8);
    expect(brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.gradientIdBuffer).toEqual([9, 9, 10, 10]);
    expect(brushState?.speedBuffer).toHaveLength(4);
    expect(brushState?.animationOffset).toBe(3);
    expect(brushState?.targetFPS).toBe(24);
    expect(brushState?.alphaMode).toBe('opaque-indices');
  });

  it('serializes brush state from canonical document buffers when no live brush exists', () => {
    const defIds = new Uint16Array([0, 5, 5, 0]);
    const brushState = serializeBrushState({
      id: 'layer-cc-doc',
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientIdBuffer: Uint8Array.from([6, 24, 24, 6]).buffer,
        gradientDefIdBuffer: defIds.buffer,
        brushState: {
          layers: [{
            layerId: 'layer-cc-doc',
            strokeData: {
              hasContent: true,
              paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
              speedBuffer: Uint8Array.from([
                encodeColorCycleSpeedByte(0.5),
                encodeColorCycleSpeedByte(0.5),
                encodeColorCycleSpeedByte(0.5),
                encodeColorCycleSpeedByte(0.5),
              ]).buffer,
              flowBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
              phaseBuffer: Uint8Array.from([4, 3, 2, 1]).buffer,
            },
          }],
        },
      },
    } as any);

    expect(brushState).toBeDefined();
    expect(brushState?.width).toBe(2);
    expect(brushState?.height).toBe(2);
    expect(brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.gradientIdBuffer).toEqual([6, 24, 24, 6]);
    expect(brushState?.gradientDefIdBuffer).toEqual([0, 5, 5, 0]);
    expect(brushState?.speedBuffer).toHaveLength(4);
    expect(brushState?.flowBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.phaseBuffer).toEqual([4, 3, 2, 1]);
    expect(brushState?.alphaMode).toBe('opaque-indices');
  });

  it('prefers canonical document buffers over loose brush property fallbacks', () => {
    const defIds = new Uint16Array([0, 7, 7, 0]);
    const brushState = serializeBrushState({
      id: 'layer-cc-doc-priority',
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientIdBuffer: Uint8Array.from([4, 5, 5, 4]).buffer,
        gradientDefIdBuffer: defIds.buffer,
        colorCycleBrush: {
          indexBuffer: Uint8Array.from([9, 9, 9, 9]),
          gradientIdBuffer: Uint8Array.from([8, 8, 8, 8]),
          width: 2,
          height: 2,
        },
        brushState: {
          layers: [{
            layerId: 'layer-cc-doc-priority',
            strokeData: {
              hasContent: true,
              paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
              speedBuffer: Uint8Array.from([10, 20, 30, 40]).buffer,
              flowBuffer: Uint8Array.from([1, 1, 2, 2]).buffer,
              phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
            },
          }],
        },
      },
    } as any);

    expect(brushState).toBeDefined();
    expect(brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.gradientIdBuffer).toEqual([4, 5, 5, 4]);
    expect(brushState?.gradientDefIdBuffer).toEqual([0, 7, 7, 0]);
    expect(brushState?.speedBuffer).toEqual([10, 20, 30, 40]);
    expect(brushState?.flowBuffer).toEqual([1, 1, 2, 2]);
    expect(brushState?.phaseBuffer).toEqual([0, 64, 128, 192]);
  });

  it('preserves flow and phase buffers from live brush serialize payloads', () => {
    const brushState = serializeBrushState({
      id: 'layer-cc-live',
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-live',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([1, 2, 3, 4]),
                  gradientId: Uint8Array.from([0, 1, 1, 0]),
                  speedData: Uint8Array.from([10, 20, 30, 40]),
                  flowData: Uint8Array.from([1, 2, 3, 1]),
                  phaseData: Uint8Array.from([0, 64, 128, 192]),
                },
                gradient: {
                  gradientStops: [
                    { position: 0, color: '#000000' },
                    { position: 1, color: '#ffffff' },
                  ],
                },
                animation: {
                  offset: 0,
                  stats: { targetFPS: 24 },
                },
              },
            }],
          }),
        },
      },
    } as any);

    expect(brushState).toBeDefined();
    expect(brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(brushState?.gradientIdBuffer).toEqual([0, 1, 1, 0]);
    expect(brushState?.speedBuffer).toEqual([10, 20, 30, 40]);
    expect(brushState?.flowBuffer).toEqual([1, 2, 3, 1]);
    expect(brushState?.phaseBuffer).toEqual([0, 64, 128, 192]);
  });

  it('preserves gradient def ids from live brush stroke data during export', () => {
    const gradientDefIds = new Uint16Array([0, 8, 8, 0]);
    const brushState = serializeBrushState({
      id: 'layer-cc-live-defs',
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-live-defs',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([1, 2, 3, 4]),
                  gradientId: Uint8Array.from([0, 1, 1, 0]),
                },
                gradient: {
                  gradientStops: [
                    { position: 0, color: '#000000' },
                    { position: 1, color: '#ffffff' },
                  ],
                },
              },
              strokeData: {
                gradientDefIdBuffer: gradientDefIds.buffer,
              },
            }],
          }),
        },
      },
    } as any);

    expect(brushState).toBeDefined();
    expect(brushState?.gradientDefIdBuffer).toEqual([0, 8, 8, 0]);
  });

  it('does not commit live color-cycle strokes while serializing for Goblet export', async () => {
    const commitCurrentStroke = jest.fn();
    await serializeColorCycleData({
      id: 'layer-cc-readonly-export',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          commitCurrentStroke,
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-readonly-export',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([1, 2, 3, 4]),
                  gradientId: Uint8Array.from([0, 1, 1, 0]),
                },
                gradient: {
                  gradientStops: [
                    { position: 0, color: '#000000' },
                    { position: 1, color: '#ffffff' },
                  ],
                },
              },
            }],
          }),
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(commitCurrentStroke).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'default layer id',
      runtimeLayers: [{
        layerId: 'default',
        data: {
          indexBuffer: {
            width: 2,
            height: 2,
            data: Uint8Array.from([1, 2, 3, 4]),
            gradientId: Uint8Array.from([0, 1, 1, 0]),
          },
        },
      }],
      expected: [1, 2, 3, 4],
    },
    {
      name: 'single non-matching layer id',
      runtimeLayers: [{
        layerId: 'runtime-layer-id',
        data: {
          indexBuffer: {
            width: 2,
            height: 2,
            data: Uint8Array.from([5, 6, 7, 8]),
            gradientId: Uint8Array.from([1, 1, 0, 0]),
          },
        },
      }],
      expected: [5, 6, 7, 8],
    },
    {
      name: 'dimension-matched layer',
      runtimeLayers: [
        {
          layerId: 'wrong-size',
          data: {
            indexBuffer: {
              width: 5,
              height: 5,
              data: Uint8Array.from(Array.from({ length: 25 }, () => 9)),
              gradientId: Uint8Array.from(Array.from({ length: 25 }, () => 1)),
            },
          },
        },
        {
          layerId: 'dimension-match',
          data: {
            indexBuffer: {
              width: 2,
              height: 2,
              data: Uint8Array.from([9, 8, 7, 6]),
              gradientId: Uint8Array.from([0, 1, 0, 1]),
            },
          },
        },
      ],
      expected: [9, 8, 7, 6],
    },
  ])('exports Goblet brush data from runtime fallback payloads: $name', async ({ runtimeLayers, expected }) => {
    const result = await serializeColorCycleData({
      id: 'layer-cc-fallback-export',
      name: 'Fallback Export',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          commitCurrentStroke: jest.fn(),
          serialize: () => ({
            layers: runtimeLayers,
            cycleSpeed: 0.5,
            fps: 24,
          }),
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.brushState?.indexBuffer).toEqual(expected);
  });

  it('preserves live brush animation and gradient metadata during canonical Goblet export', async () => {
    const runtimeStops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#445566' },
    ];
    const result = await serializeColorCycleData({
      id: 'layer-cc-live-metadata',
      name: 'Live Metadata',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        brushSpeed: 0.15,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          commitCurrentStroke: jest.fn(),
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-live-metadata',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([1, 2, 3, 4]),
                  gradientId: Uint8Array.from([0, 1, 1, 0]),
                  palette: ['#112233', '#445566'],
                },
                gradient: {
                  gradientStops: runtimeStops,
                },
                animation: {
                  offset: 13,
                  stats: {
                    targetFPS: 17,
                  },
                },
              },
            }],
            cycleSpeed: 0.75,
            fps: 23,
          }),
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.gradient).toEqual(runtimeStops);
    expect(result?.colorCycle?.brushState?.gradientStops).toEqual(runtimeStops);
    expect(result?.colorCycle?.brushState?.animationSpeed).toBe(0.75);
    expect(result?.colorCycle?.brushState?.animationOffset).toBe(13);
    expect(result?.colorCycle?.brushState?.targetFPS).toBe(17);
    expect(result?.colorCycle?.brushState?.palette).toEqual(['#112233', '#445566']);
  });

  it('falls back to saved canonical brush state when live Goblet runtime has no usable buffers', async () => {
    const savedStops = [
      { position: 0, color: '#aa0000' },
      { position: 1, color: '#00aa00' },
    ];
    const result = await serializeColorCycleData({
      id: 'layer-cc-saved-fallback',
      name: 'Saved Fallback',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-saved-fallback',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: new Uint8Array(0),
                  gradientId: new Uint8Array(0),
                },
              },
            }],
          }),
        },
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          cycleSpeed: 0.33,
          fps: 19,
          layers: [{
            layerId: 'layer-cc-saved-fallback',
            canonicalPaint: true,
            schemaVersion: 1,
            dimensions: { width: 2, height: 2 },
            animator: {
              indexBuffer: {
                palette: ['#aa0000', '#00aa00'],
              },
              gradient: {
                gradientStops: savedStops,
              },
              animation: {
                offset: 4,
                stats: {
                  targetFPS: 11,
                },
              },
            },
            strokeData: {
              hasContent: true,
              paintBuffer: Uint8Array.from([7, 8, 9, 10]).buffer,
              gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]).buffer,
              gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
              speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
              flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
              phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
            },
          }],
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.brushState?.indexBuffer).toEqual([7, 8, 9, 10]);
    expect(result?.colorCycle?.gradient).toEqual(savedStops);
    expect(result?.colorCycle?.brushState?.gradientStops).toEqual(savedStops);
    expect(result?.colorCycle?.brushState?.animationSpeed).toBe(0.33);
    expect(result?.colorCycle?.brushState?.animationOffset).toBe(4);
    expect(result?.colorCycle?.brushState?.targetFPS).toBe(11);
    expect(result?.colorCycle?.brushState?.palette).toEqual(['#aa0000', '#00aa00']);
  });

  it('exports Goblet brush data from direct runtime brush properties when canonical runtime capture has no buffers', async () => {
    const result = await serializeColorCycleData({
      id: 'layer-cc-runtime-direct',
      name: 'Runtime Direct',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-runtime-direct',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: new Uint8Array(0),
                },
              },
            }],
          }),
          indexBuffer: Uint8Array.from([3, 4, 5, 6]),
          gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]),
          speedBuffer: Uint8Array.from([7, 8, 9, 10]),
          width: 2,
          height: 2,
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.brushState?.indexBuffer).toEqual([3, 4, 5, 6]);
    expect(result?.colorCycle?.brushState?.gradientIdBuffer).toEqual([0, 1, 1, 0]);
    expect(result?.colorCycle?.brushState?.speedBuffer).toEqual([7, 8, 9, 10]);
  });

  it('exports Goblet brush data from runtime animator maps when canonical runtime capture has no buffers', async () => {
    const result = await serializeColorCycleData({
      id: 'layer-cc-runtime-animator',
      name: 'Runtime Animator',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-runtime-animator',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: new Uint8Array(0),
                },
              },
            }],
          }),
          animators: new Map([[
            'layer-cc-runtime-animator',
            {
              serialize: () => ({
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([8, 7, 6, 5]),
                  gradientId: Uint8Array.from([1, 1, 0, 0]),
                  speedData: Uint8Array.from([11, 12, 13, 14]),
                },
                animation: {
                  offset: 9,
                  stats: {
                    targetFPS: 15,
                  },
                },
              }),
            },
          ]]),
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.brushState?.indexBuffer).toEqual([8, 7, 6, 5]);
    expect(result?.colorCycle?.brushState?.gradientIdBuffer).toEqual([1, 1, 0, 0]);
    expect(result?.colorCycle?.brushState?.speedBuffer).toEqual([11, 12, 13, 14]);
    expect(result?.colorCycle?.brushState?.animationOffset).toBe(9);
    expect(result?.colorCycle?.brushState?.targetFPS).toBe(15);
  });

  it.each([
    {
      name: 'missing canonical markers',
      brushState: {
        schemaVersion: 1,
        layers: [{
          layerId: 'layer-cc-unsafe-saved',
          dimensions: { width: 2, height: 2 },
          strokeData: {
            hasContent: true,
            paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
            speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
            flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
            phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
          },
        }],
      },
      reason: 'metadata-only-state',
    },
    {
      name: 'unsupported top-level schema',
      brushState: {
        canonicalPaint: true,
        schemaVersion: 999,
        layers: [{
          layerId: 'layer-cc-unsafe-saved',
          canonicalPaint: true,
          dimensions: { width: 2, height: 2 },
          strokeData: {
            hasContent: true,
            paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
            speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
            flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
            phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
          },
        }],
      },
      reason: 'invalid-schema-version',
    },
    {
      name: 'unsupported per-layer schema',
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'layer-cc-unsafe-saved',
          canonicalPaint: true,
          schemaVersion: 999,
          dimensions: { width: 2, height: 2 },
          strokeData: {
            hasContent: true,
            paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            gradientIdBuffer: Uint8Array.from([0, 1, 1, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
            speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
            flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
            phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
          },
        }],
      },
      reason: 'invalid-schema-version',
    },
  ])('does not export unsafe saved canonical fallback when persisted brushState has $name', async ({ brushState, reason }) => {
    await expect(serializeColorCycleData({
      id: 'layer-cc-unsafe-saved',
      name: 'Unsafe Saved',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        brushState,
      },
    } as any, {
      width: 2,
      height: 2,
    } as any)).rejects.toThrow(
      `Goblet export blocked: color-cycle layer "Unsafe Saved" is missing animated brush data (${reason}).`
    );
  });

  it('exports persisted snapshot palettes instead of stale layer gradients', async () => {
    const snapshotStops = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ];
    const result = await serializeColorCycleData({
      id: 'layer-cc-snapshot-palette',
      name: 'Snapshot Palette',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-cc-snapshot-palette',
            canonicalPaint: true,
            schemaVersion: 1,
            dimensions: { width: 2, height: 2 },
            slotPalettes: [{
              slot: 0,
              stops: snapshotStops,
            }],
            strokeData: {
              hasContent: true,
              paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
              gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
              gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
              speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
              flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
              phaseBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
            },
          }],
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.gradient).toEqual(snapshotStops);
    expect(result?.colorCycle?.slotPalettes).toEqual([{
      slot: 0,
      stops: snapshotStops,
    }]);
  });

  it('does not repair missing-paint color-cycle state from compatibility snapshot colors during export', () => {
    const brushState = serializeBrushState({
      id: 'layer-cc-legacy-alpha',
      layerType: 'color-cycle',
      imageData: null,
      colorCycleData: {
        canvasWidth: 2,
        canvasHeight: 2,
        canvasImageData: {
          width: 2,
          height: 2,
          data: Uint8ClampedArray.from([
            0, 0, 0, 255,
            0, 0, 0, 0,
            255, 255, 255, 255,
            0, 0, 0, 0,
          ]),
        },
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        brushState: {
          layers: [{
            layerId: 'layer-cc-legacy-alpha',
            strokeData: {
              hasContent: true,
              gradientIdBuffer: encodeBytes([3, 4, 5, 6]),
            },
          }],
        },
      },
    } as any);

    expect(brushState).toBeUndefined();
  });

  it('blocks repair-failed color-cycle layers without animated brush data', async () => {
    await expect(serializeColorCycleData({
      id: 'layer-cc-static-preview-only',
      name: 'Static Preview Only',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      colorCycleData: {
        mode: 'brush',
        repairStatus: {
          ok: false,
          reason: 'missing-paint-buffer',
        },
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: false,
        canvasWidth: 2,
        canvasHeight: 2,
        canvasImageData: {
          width: 2,
          height: 2,
          data: Uint8ClampedArray.from([
            0, 0, 0, 255,
            0, 0, 0, 0,
            255, 255, 255, 255,
            0, 0, 0, 0,
          ]),
        },
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        brushState: {
          layers: [{
            layerId: 'layer-cc-static-preview-only',
            strokeData: {
              hasContent: true,
              gradientIdBuffer: encodeBytes([3, 4, 5, 6]),
            },
          }],
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any)).rejects.toThrow(
      'Goblet export blocked: color-cycle layer "Static Preview Only" is missing animated brush data (missing-paint-buffer).'
    );
  });

  it('does not mark empty brush-mode color-cycle layers as animated', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const gradientStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const result = await serializeColorCycleData({
      id: 'layer-cc-empty-brush',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: canvas,
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        brushSpeed: 0.5,
        gradient: gradientStops,
        canvas,
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-empty-brush',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: new Uint8Array([0, 0, 0, 0]),
                  palette: ['#000000', '#ffffff'],
                  gradientId: new Uint8Array([0, 0, 0, 0]),
                },
                gradient: { gradientStops },
              },
            }],
            cycleSpeed: 0.5,
            fps: 24,
            brushSize: 2,
          }),
          commitCurrentStroke: jest.fn(),
          getCanvas: () => canvas,
          isPlaying: () => true,
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.isAnimating).toBe(false);
    expect(result?.colorCycle?.coverageBoundsPx).toBeUndefined();
    expect(result?.colorCycle?.brushState).toBeDefined();
  });

  it('does not mark fully erased brush-mode color-cycle layers as animated', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const gradientStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const result = await serializeColorCycleData({
      id: 'layer-cc-erased-brush',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: canvas,
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        brushSpeed: 0.5,
        gradient: gradientStops,
        canvas,
        eraseMaskImageData: {
          width: 2,
          height: 2,
          data: Uint8ClampedArray.from([
            0, 0, 0, 255,
            0, 0, 0, 255,
            0, 0, 0, 255,
            0, 0, 0, 255,
          ]),
        },
        colorCycleBrush: {
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-erased-brush',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: new Uint8Array([1, 2, 3, 4]),
                  palette: ['#000000', '#ffffff'],
                  gradientId: new Uint8Array([0, 0, 0, 0]),
                },
                gradient: { gradientStops },
              },
            }],
            cycleSpeed: 0.5,
            fps: 24,
            brushSize: 2,
          }),
          commitCurrentStroke: jest.fn(),
          getCanvas: () => canvas,
          isPlaying: () => true,
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.isAnimating).toBe(false);
    expect(result?.colorCycle?.coverageBoundsPx).toBeUndefined();
    expect(result?.colorCycle?.brushState).toBeDefined();
  });

  it('does not minify color-cycle buffer keys unsupported by the bundled Goblet runtime', () => {
    const minified = minifyProperties({
      layers: [{
        colorCycle: {
          brushState: {
            indexBuffer: [1, 2, 3, 4],
            gradientIdBuffer: [5, 6, 7, 8],
            gradientDefIdBuffer: [0, 1, 1, 0],
            speedBuffer: [9, 9, 9, 9],
            flowBuffer: [1, 0, 1, 0],
            phaseBuffer: [0, 64, 128, 192],
          },
        },
      }],
    }) as any;

    const brushState = minified.l[0].cc.bs;
    expect(brushState.ib).toEqual([1, 2, 3, 4]);
    expect(brushState.gib).toEqual([5, 6, 7, 8]);
    expect(brushState.gradientDefIdBuffer).toEqual([0, 1, 1, 0]);
    expect(brushState.speedBuffer).toEqual([9, 9, 9, 9]);
    expect(brushState.flowBuffer).toEqual([1, 0, 1, 0]);
    expect(brushState.phaseBuffer).toEqual([0, 64, 128, 192]);
    expect(brushState.gdib).toBeUndefined();
    expect(brushState.sb).toBeUndefined();
    expect(brushState.fbf).toBeUndefined();
    expect(brushState.phb).toBeUndefined();
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

  it.each([
    {
      source: 'manual',
      stops: [{ position: 0, color: '#112233' }],
    },
    {
      source: 'manual',
      stops: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#445566' },
      ],
    },
    {
      source: 'sampled',
      stops: [{ position: 0, color: '#223344' }],
    },
    {
      source: 'sampled',
      stops: [
        { position: 0, color: '#223344' },
        { position: 0.5, color: '#556677' },
        { position: 1, color: '#8899aa' },
      ],
    },
    {
      source: 'fg',
      stops: [{ position: 0, color: '#334455' }],
    },
    {
      source: 'fg',
      stops: [
        { position: 0, color: '#334455' },
        { position: 1, color: '#99aabb' },
      ],
    },
  ])('rebuilds $source Goblet slot palettes for 1-color and multi-color defs', ({ source, stops }) => {
    const slotPalettes = resolveDefBoundSlotPalettes({
      data: {
        gradientDefIdBuffer: new Uint16Array([0, 9, 9, 0]).buffer,
        gradientDefStore: [{
          id: 9,
          kind: 'linear',
          stops,
          hash: `def-${source}-${stops.length}`,
          source,
          createdAtMs: 0,
          slot: 3,
        }],
      } as any,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 1, 1, 1],
        gradientIdBuffer: [3, 12, 12, 3],
        gradientDefIdBuffer: [0, 9, 9, 0],
        gradientStops: [],
        animationOffset: 0,
      },
      slotPalettes: [],
    });

    expect(slotPalettes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slot: 12,
        stops,
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
