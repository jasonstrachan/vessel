import {
  buildCompositeSegmentDescriptors,
  compositeSegmentStructureMatches,
  createNextCompositeSegments,
  realizeCompositeSegments,
  type CompositeSegment,
} from '@/stores/layers/layerCompositeRenderer';
import * as txtShapeUtils from '@/utils/txtShape';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

const makeLayer = (overrides: Partial<Layer>): Layer => ({
  id: 'layer',
  name: 'Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: createCanvas(1, 1),
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
});

const makeProject = (layers: Layer[], backgroundColor = 'transparent'): Project => ({
  id: 'project',
  name: 'Project',
  width: 2,
  height: 2,
  layers,
  backgroundColor,
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
  defaultCustomBrushId: null,
});

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

describe('layerCompositeRenderer', () => {
  it('builds static, color-cycle, and sequential descriptors in layer order', () => {
    const layers = [
      makeLayer({ id: 'bottom', order: 0 }),
      makeLayer({ id: 'hidden', order: 1, visible: false }),
      makeLayer({ id: 'cycle', order: 2, layerType: 'color-cycle', opacity: 0.5 }),
      makeLayer({ id: 'top', order: 3 }),
      makeLayer({ id: 'seq', order: 4, layerType: 'sequential', blendMode: 'multiply' }),
    ];

    const descriptors = buildCompositeSegmentDescriptors(layers, makeProject(layers, '#ffffff'));

    expect(descriptors).toEqual([
      {
        kind: 'static',
        layerIds: ['bottom'],
        includeBackground: true,
        orderRange: { start: 0, end: 0 },
      },
      {
        kind: 'color-cycle',
        layerId: 'cycle',
        blendMode: 'source-over',
        opacity: 0.5,
      },
      {
        kind: 'static',
        layerIds: ['top'],
        includeBackground: false,
        orderRange: { start: 3, end: 3 },
      },
      {
        kind: 'sequential',
        layerId: 'seq',
        blendMode: 'multiply',
        opacity: 1,
      },
    ]);
  });

  it('reuses segment structure while refreshing dynamic blend fields', () => {
    const previousSegments: CompositeSegment[] = [
      {
        kind: 'color-cycle',
        id: 'cc-cycle-0',
        layerId: 'cycle',
        blendMode: 'source-over',
        opacity: 1,
      },
    ];
    const descriptors = [
      {
        kind: 'color-cycle' as const,
        layerId: 'cycle',
        blendMode: 'screen' as GlobalCompositeOperation,
        opacity: 0.25,
      },
    ];

    expect(compositeSegmentStructureMatches(previousSegments, descriptors)).toBe(true);

    const next = createNextCompositeSegments({
      descriptors,
      previousSegments,
      structuresMatch: true,
      width: 2,
      height: 2,
      createStaticCanvas: createCanvas,
    });

    expect(next).toEqual([
      {
        kind: 'color-cycle',
        id: 'cc-cycle-0',
        layerId: 'cycle',
        blendMode: 'screen',
        opacity: 0.25,
      },
    ]);
  });

  it('replaces participating layers with one ordered interlace segment', () => {
    const layers = [
      makeLayer({ id: 'bottom', order: 0 }),
      makeLayer({ id: 'pose-a', order: 1, groupId: 'interlace-1' }),
      makeLayer({ id: 'pose-b', order: 2, groupId: 'interlace-1', layerType: 'color-cycle' }),
      makeLayer({ id: 'top', order: 3 }),
    ];
    const project = makeProject(layers, '#ffffff');
    project.layerGroups = [{
      id: 'interlace-1',
      name: 'Interlace 1',
      kind: 'interlace',
      interlace: {
        cellSize: 10,
        dominance: 0.92,
        patternPreset: 'classic',
        motionMode: 'fixed',
        direction: 'right',
        travelCycles: 1,
        loopDurationSeconds: 10,
        seed: 17,
      },
    }];

    expect(buildCompositeSegmentDescriptors(layers, project)).toEqual([
      {
        kind: 'static',
        layerIds: ['bottom'],
        includeBackground: true,
        orderRange: { start: 0, end: 0 },
      },
      {
        kind: 'interlace',
        groupId: 'interlace-1',
        layerIds: ['pose-a', 'pose-b'],
        settings: project.layerGroups[0].interlace,
      },
      {
        kind: 'static',
        layerIds: ['top'],
        includeBackground: false,
        orderRange: { start: 3, end: 3 },
      },
    ]);
  });

  it('publishes updated Interlace settings when the segment structure is unchanged', () => {
    const previousSettings = {
      cellSize: 10,
      dominance: 0.92,
      patternPreset: 'classic' as const,
      motionMode: 'fixed' as const,
      direction: 'right' as const,
      travelCycles: 1,
      loopDurationSeconds: 10,
      seed: 17,
    };
    const layers = [
      makeLayer({ id: 'pose-a', order: 0, groupId: 'interlace-1' }),
      makeLayer({ id: 'pose-b', order: 1, groupId: 'interlace-1' }),
    ];
    const previousSegments: CompositeSegment[] = [{
      kind: 'interlace',
      id: 'interlace-interlace-1-0',
      groupId: 'interlace-1',
      layerIds: ['pose-a', 'pose-b'],
      settings: previousSettings,
    }];
    const project = makeProject(layers);
    project.layerGroups = [{
      id: 'interlace-1',
      name: 'Interlace 1',
      kind: 'interlace',
      interlace: {
        ...previousSettings,
        cellSize: 32,
      },
    }];

    const result = realizeCompositeSegments({
      sortedLayers: layers,
      project,
      previousSegments,
      width: 2,
      height: 2,
      createStaticCanvas: createCanvas,
      createLayerTransferCanvas: createCanvas,
    });

    expect(result.anySegmentUpdated).toBe(true);
    expect(result.fullStaticRedrawNeeded).toBe(false);
    expect(result.segments[0]).toMatchObject({
      kind: 'interlace',
      settings: { cellSize: 32 },
    });
  });

  it('repaints dirty static segments and preserves clean structure versions', () => {
    const framebuffer = createCanvas(2, 2);
    const framebufferCtx = framebuffer.getContext('2d');
    framebufferCtx!.fillStyle = '#ff0000';
    framebufferCtx!.fillRect(0, 0, 2, 2);

    const layers = [
      makeLayer({
        id: 'paint',
        order: 0,
        framebuffer,
      }),
    ];
    const previousSegments: CompositeSegment[] = [
      {
        kind: 'static',
        id: 'static-existing',
        layerIds: ['paint'],
        includeBackground: false,
        orderRange: { start: 0, end: 0 },
        canvas: createCanvas(2, 2),
        bitmap: null,
        dirty: true,
      },
    ];

    const result = realizeCompositeSegments({
      sortedLayers: layers,
      project: makeProject(layers),
      previousSegments,
      width: 2,
      height: 2,
      createStaticCanvas: createCanvas,
      createLayerTransferCanvas: createCanvas,
    });

    expect(result.anySegmentUpdated).toBe(true);
    expect(result.segments[0]).toMatchObject({
      kind: 'static',
      id: 'static-existing',
      layerIds: ['paint'],
      dirty: false,
    });
    expect((result.segments[0] as Extract<CompositeSegment, { kind: 'static' }>).canvas).toBe(
      previousSegments[0].kind === 'static' ? previousSegments[0].canvas : null
    );
  });

  it('forwards normalized dirty rectangles to TXT Shape painting', () => {
    const drawTxtShapesForLayer = jest
      .spyOn(txtShapeUtils, 'drawTxtShapesForLayer')
      .mockImplementation(() => undefined);
    const layers = [makeLayer({ id: 'paint' })];
    const previousSegments: CompositeSegment[] = [{
      kind: 'static',
      id: 'static-existing',
      layerIds: ['paint'],
      includeBackground: false,
      orderRange: { start: 0, end: 0 },
      canvas: createCanvas(2, 2),
      bitmap: null,
      dirty: false,
    }];

    realizeCompositeSegments({
      sortedLayers: layers,
      project: makeProject(layers),
      previousSegments,
      width: 2,
      height: 2,
      createStaticCanvas: createCanvas,
      createLayerTransferCanvas: createCanvas,
      dirtyBatches: [{
        layerId: 'paint',
        version: 1,
        rects: [{ x: -0.25, y: 0.25, width: 1.5, height: 1.5 }],
      }],
    });

    expect(drawTxtShapesForLayer).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'paint',
      [{ x: 0, y: 0, width: 2, height: 2 }],
    );
    drawTxtShapesForLayer.mockRestore();
  });
});
