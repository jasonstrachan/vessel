/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorCycleLayerDocument } from '@/lib/colorCycle/document';
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
  serializeColorCycleData,
  resolveDefBoundSlotPalettes,
  normalizeCanvasSurfaceForExport,
} = __TESTING__;

const encodeBytes = (values: number[]): string => Buffer.from(Uint8Array.from(values)).toString('base64');

const createExportDocument = (layerId: string, paint = [1, 2, 3, 4], hasContent = paint.some(Boolean)) => new ColorCycleLayerDocument({
  layerId,
  width: 2,
  height: 2,
  paintBuffer: Uint8Array.from(paint).buffer,
  gradientIdBuffer: new Uint8Array(4).buffer,
  gradientDefIdBuffer: new Uint16Array(4).buffer,
  speedBuffer: new Uint8Array(4).fill(128).buffer,
  flowBuffer: new Uint8Array(4).fill(1).buffer,
  phaseBuffer: new Uint8Array(4).buffer,
  hasContent,
  sources: { brushStateSnapshot: false, topLevelBuffers: false, legacyStateRefs: false },
});

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
          getColorCycleLayerDocument: () => createExportDocument('layer-cc-readonly-export'),
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
  ])('rejects Goblet export from runtime fallback payloads: $name', async ({ runtimeLayers }) => {
    await expect(serializeColorCycleData({
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
    } as any)).rejects.toThrow('missing-color-cycle-document');

  });

  it('ignores stale all-erasing CC alpha masks during Goblet brush export', async () => {
    const fullEraseMask = new ImageData(new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]), 2, 2);

    const result = await serializeColorCycleData({
      id: 'layer-cc-stale-mask-export',
      name: 'Stale Mask Export',
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
        eraseMaskImageData: fullEraseMask,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          getColorCycleLayerDocument: () => createExportDocument('layer-cc-stale-mask-export'),
          commitCurrentStroke: jest.fn(),
          serialize: () => ({
            layers: [{
              layerId: 'layer-cc-stale-mask-export',
              data: {
                indexBuffer: {
                  width: 2,
                  height: 2,
                  data: Uint8Array.from([1, 2, 3, 4]),
                  gradientId: Uint8Array.from([0, 1, 1, 0]),
                  speedData: Uint8Array.from([128, 128, 128, 128]),
                  flowData: Uint8Array.from([1, 1, 1, 1]),
                  phaseData: Uint8Array.from([0, 64, 128, 192]),
                },
              },
            }],
            cycleSpeed: 0.5,
            fps: 24,
          }),
        },
      },
    } as any, {
      width: 2,
      height: 2,
    } as any);

    expect(result?.colorCycle?.brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    expect(result?.colorCycle?.alphaMask).toBeUndefined();
  });

  it('uses document gradient and motion data instead of stale animator metadata', async () => {
    const stops = [{ position: 0, color: '#112233' }, { position: 1, color: '#445566' }];
    const document = createExportDocument('metadata');
    document.replaceBaseline({
      ...document.read().snapshot,
      slotPalettes: [{ slot: 0, stops }],
      flowMode: 'reverse',
      flowBuffer: new Uint8Array(4).fill(2).buffer,
    });
    const serialize = jest.fn(() => { throw new Error('Runtime paint must not be read'); });
    const result = await serializeColorCycleData({
      id: 'metadata', layerType: 'color-cycle', framebuffer: { width: 2, height: 2 },
      colorCycleData: {
        mode: 'brush', hasContent: true, gradient: stops,
        colorCycleBrush: { getColorCycleLayerDocument: () => document, serialize },
      },
    } as any, { width: 2, height: 2 } as any);
    expect(result?.colorCycle?.brushState?.gradientStops).toEqual(stops);
    expect(result?.colorCycle?.brushState?.flowBuffer).toEqual([2, 2, 2, 2]);
    expect(serialize).not.toHaveBeenCalled();
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

  it('rejects Goblet export from direct runtime brush properties when canonical runtime capture has no buffers', async () => {
    await expect(serializeColorCycleData({
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
    } as any)).rejects.toThrow('missing-color-cycle-document');

  });

  it('rejects Goblet export from runtime animator maps when canonical runtime capture has no buffers', async () => {
    await expect(serializeColorCycleData({
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
    } as any)).rejects.toThrow('missing-color-cycle-document');

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
      reason: 'missing-color-cycle-document',
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
      reason: 'missing-color-cycle-document',
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
      reason: 'missing-color-cycle-document',
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
      'Goblet export blocked: color-cycle layer "Static Preview Only" is missing animated brush data (missing-color-cycle-document).'
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
          getColorCycleLayerDocument: () => createExportDocument('layer-cc-empty-brush', [0, 0, 0, 0]),
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
          getColorCycleLayerDocument: () => createExportDocument('layer-cc-erased-brush', [1, 2, 3, 4], false),
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

  it('minifies color-cycle buffer keys covered by the bundled Goblet runtime schema', () => {
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
    expect(brushState.gdib).toEqual([0, 1, 1, 0]);
    expect(brushState.sbf).toEqual([9, 9, 9, 9]);
    expect(brushState.flb).toEqual([1, 0, 1, 0]);
    expect(brushState.phb).toEqual([0, 64, 128, 192]);
    expect(brushState.gradientDefIdBuffer).toBeUndefined();
    expect(brushState.speedBuffer).toBeUndefined();
    expect(brushState.flowBuffer).toBeUndefined();
    expect(brushState.phaseBuffer).toBeUndefined();
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

  it('replaces stale existing slot palettes with dominant gradient def bindings during export', () => {
    const slotPalettes = resolveDefBoundSlotPalettes({
      data: {
        gradientDefIdBuffer: new Uint16Array([42, 42, 0, 0]).buffer,
        gradientDefStore: [{
          id: 42,
          kind: 'linear',
          stops: [
            { position: 0, color: '#223344' },
            { position: 1, color: '#556677' },
          ],
          hash: 'def-42',
          source: 'sampled',
          seamProfile: 'hard',
          createdAtMs: 0,
          slot: 9,
        }],
      } as any,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 1, 0, 0],
        gradientIdBuffer: [9, 9, 0, 0],
        gradientDefIdBuffer: [42, 42, 0, 0],
        gradientStops: [],
        animationOffset: 0,
      },
      slotPalettes: [{
        slot: 9,
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      }],
    });

    expect(slotPalettes?.find((entry) => entry.slot === 9)).toEqual(expect.objectContaining({
      slot: 9,
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#223344' },
        { position: 1, color: '#556677' },
      ],
    }));
  });

  it('defaults legacy definition-bound pixels to a hard seam instead of inheriting the current slot seam', () => {
    const slotPalettes = resolveDefBoundSlotPalettes({
      data: {
        gradientDefStore: [{
          id: 42,
          kind: 'linear',
          stops: [
            { position: 0, color: '#223344' },
            { position: 1, color: '#556677' },
          ],
          hash: 'legacy-def-42',
          source: 'sampled',
          createdAtMs: 0,
          slot: 9,
        }],
      } as any,
      brushState: {
        width: 2,
        height: 1,
        indexBuffer: [1, 1],
        gradientIdBuffer: [9, 9],
        gradientDefIdBuffer: [42, 42],
        gradientStops: [],
        animationOffset: 0,
      },
      slotPalettes: [{
        slot: 9,
        seamProfile: 'soft',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      }],
    });

    expect(slotPalettes?.find((entry) => entry.slot === 9)).toEqual(expect.objectContaining({
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#223344' },
        { position: 1, color: '#556677' },
      ],
    }));
  });

  it('preserves existing slot palettes when gradient def coverage is partial', () => {
    const slotPalettes = resolveDefBoundSlotPalettes({
      data: {
        gradientDefIdBuffer: new Uint16Array([0, 0, 42, 42]).buffer,
        gradientDefStore: [{
          id: 42,
          kind: 'linear',
          stops: [
            { position: 0, color: '#223344' },
            { position: 1, color: '#556677' },
          ],
          hash: 'def-42',
          source: 'sampled',
          seamProfile: 'hard',
          createdAtMs: 0,
          slot: 9,
        }],
      } as any,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 1, 1, 1],
        gradientIdBuffer: [9, 9, 9, 9],
        gradientDefIdBuffer: [0, 0, 42, 42],
        gradientStops: [],
        animationOffset: 0,
      },
      slotPalettes: [{
        slot: 9,
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      }],
    });

    expect(slotPalettes?.find((entry) => entry.slot === 9)).toEqual(expect.objectContaining({
      slot: 9,
      seamProfile: 'hard',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    }));
  });

  it('exports every active definition when a layer exceeds the 8-bit slot range', async () => {
    const definitionCount = 300;
    const gradientDefIds = Uint16Array.from(
      { length: definitionCount },
      (_value, index) => index + 1,
    );
    const gradientDefStore = Array.from({ length: definitionCount + 1 }, (_value, index) => {
      const id = index + 1;
      const channel = id % 256;
      const color = `rgb(${channel}, ${(channel * 3) % 256}, ${(channel * 7) % 256})`;
      return {
        id,
        kind: 'linear',
        stops: [
          { position: 0, color },
          { position: 1, color },
        ],
        hash: `def-${id}`,
        source: 'sampled',
        seamProfile: 'hard',
        createdAtMs: id,
        slot: id & 0xff,
      };
    });
    const result = await serializeColorCycleData({
      id: 'layer-cc-many-definitions',
      name: 'Many Definitions',
      layerType: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: null,
      framebuffer: { width: definitionCount, height: 1 },
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: definitionCount,
        canvasHeight: 1,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientDefStore,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-cc-many-definitions',
            canonicalPaint: true,
            schemaVersion: 1,
            dimensions: { width: definitionCount, height: 1 },
            gradientDefStore,
            strokeData: {
              hasContent: true,
              paintBuffer: new Uint8Array(definitionCount).fill(1).buffer,
              gradientIdBuffer: Uint8Array.from(
                { length: definitionCount },
                (_value, index) => (index + 1) & 0xff,
              ).buffer,
              gradientDefIdBuffer: gradientDefIds.buffer,
              speedBuffer: new Uint8Array(definitionCount).fill(1).buffer,
              flowBuffer: new Uint8Array(definitionCount).fill(1).buffer,
              phaseBuffer: new Uint8Array(definitionCount).buffer,
            },
          }],
        },
      },
    } as any, {
      width: definitionCount,
      height: 1,
    } as any);

    expect(result?.colorCycle?.gradientDefStore).toHaveLength(definitionCount);
    expect(result?.colorCycle?.gradientDefStore?.[0]).toMatchObject({ id: 1 });
    expect(result?.colorCycle?.gradientDefStore?.at(-1)).toMatchObject({
      id: definitionCount,
      stops: gradientDefStore[definitionCount - 1].stops,
      seamProfile: 'hard',
    });
    expect(result?.colorCycle?.gradientDefStore?.some((entry) => entry.id === definitionCount + 1)).toBe(false);
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
