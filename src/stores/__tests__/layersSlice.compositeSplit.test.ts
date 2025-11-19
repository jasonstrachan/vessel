import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { useAppStore } from '@/stores/useAppStore';
import type { CompositeSegment } from '@/stores/slices/layersSlice';

type StaticSegment = Extract<CompositeSegment, { kind: 'static' }>;
type ColorCycleSegment = Extract<CompositeSegment, { kind: 'color-cycle' }>;

const expectStaticSegment = (segment: CompositeSegment | undefined): StaticSegment => {
  if (!segment || segment.kind !== 'static') {
    throw new Error('Expected static composite segment');
  }
  return segment;
};

const expectColorCycleSegment = (segment: CompositeSegment | undefined): ColorCycleSegment => {
  if (!segment || segment.kind !== 'color-cycle') {
    throw new Error('Expected color-cycle composite segment');
  }
  return segment;
};

const isDirtyStaticSegment = (segment: CompositeSegment): segment is StaticSegment => {
  return segment.kind === 'static' && Boolean(segment.dirty);
};

describe('static vs animated compositor', () => {
  let previousProject = useAppStore.getState().project;
  let previousLayers = useAppStore.getState().layers;
  let previousBitmap = useAppStore.getState().currentCompositeBitmap;
  let previousVersion = useAppStore.getState().staticCompositeVersion;
  let previousSegments = useAppStore.getState().compositeSegments;
  let previousSegmentsVersion = useAppStore.getState().compositeSegmentsVersion;

  afterEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      project: previousProject,
      layers: previousLayers,
      currentCompositeBitmap: previousBitmap,
      staticCompositeVersion: previousVersion,
      compositeSegments: previousSegments,
      compositeSegmentsVersion: previousSegmentsVersion
    }));
  });

  it('builds composite segments that respect layer ordering', () => {
    const makeFilledCanvas = (color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 2, 2);
      }
      return canvas;
    };

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 2;
    colorCycleCanvas.height = 2;
    colorCycleCanvas.getContext('2d')?.fillRect(0, 0, 2, 2);

    const bottomFramebuffer = makeFilledCanvas('#0000ff');
    const topFramebuffer = makeFilledCanvas('#00ff00');

    const staticBottom = {
      id: 'static-bottom',
      name: 'Bottom',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: bottomFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' as const
    };

    const colorCycleLayer = {
      id: 'cc-layer',
      name: 'Cycle',
      visible: true,
      opacity: 0.8,
      blendMode: 'screen' as const,
      locked: false,
      order: 1,
      imageData: null,
      framebuffer: colorCycleCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle' as const,
      colorCycleData: {
        mode: 'recolor' as const,
        canvas: colorCycleCanvas,
        gradient: [],
        isAnimating: true
      }
    };

    const staticTop = {
      id: 'static-top',
      name: 'Top',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      locked: false,
      order: 2,
      imageData: null,
      framebuffer: topFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' as const
    };

    const stateBefore = useAppStore.getState();
    previousProject = stateBefore.project;
    previousLayers = stateBefore.layers;
    previousBitmap = stateBefore.currentCompositeBitmap;
    previousVersion = stateBefore.staticCompositeVersion;
    previousSegments = stateBefore.compositeSegments;
    previousSegmentsVersion = stateBefore.compositeSegmentsVersion;

    const project = {
      id: 'proj',
      name: 'Demo',
      width: 2,
      height: 2,
      layers: [staticBottom, colorCycleLayer, staticTop],
      backgroundColor: '#00000000',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: [],
      defaultCustomBrushId: null
    };

    useAppStore.setState((state) => ({
      ...state,
      project,
      layers: [staticBottom, colorCycleLayer, staticTop],
      activeLayerId: staticBottom.id,
      layersNeedRecomposition: true
    }));

    const staticCanvas = document.createElement('canvas');
    staticCanvas.width = 2;
    staticCanvas.height = 2;
    expect(useAppStore.getState().renderStaticComposite(staticCanvas)).toBe(true);

    const segments = (useAppStore.getState().compositeSegments ?? []) as CompositeSegment[];
    expect(segments).toHaveLength(3);

    const bottomSegment = expectStaticSegment(segments[0]);
    const ccSegment = expectColorCycleSegment(segments[1]);
    const topSegment = expectStaticSegment(segments[2]);

    expect(bottomSegment.layerIds).toContain('static-bottom');
    expect(topSegment.layerIds).toContain('static-top');
    expect(ccSegment.layerId).toBe('cc-layer');
    expect(ccSegment.blendMode).toBe('screen');

  });

  it('only repaints dirty static segments when layer data changes', () => {
    const makeCanvas = (fill: [number, number, number]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = `rgb(${fill[0]}, ${fill[1]}, ${fill[2]})`;
        ctx.fillRect(0, 0, 2, 2);
      }
      return canvas;
    };

    const baseFramebuffer = makeCanvas([255, 0, 0]);
    const topFramebuffer = makeCanvas([0, 0, 255]);

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 2;
    colorCycleCanvas.height = 2;

    const layers = [
      {
        id: 'base',
        name: 'Base',
        visible: true,
        opacity: 1,
        blendMode: 'source-over' as const,
        locked: false,
        order: 0,
        imageData: null,
        framebuffer: baseFramebuffer,
        alignment: createDefaultLayerAlignment(),
        layerType: 'normal' as const
      },
      {
        id: 'cc',
        name: 'Cycle',
        visible: true,
        opacity: 1,
        blendMode: 'source-over' as const,
        locked: false,
        order: 1,
        imageData: null,
        framebuffer: colorCycleCanvas,
        alignment: createDefaultLayerAlignment(),
        layerType: 'color-cycle' as const,
        colorCycleData: {
          mode: 'recolor' as const,
          canvas: colorCycleCanvas,
          gradient: [],
          isAnimating: false
        }
      },
      {
        id: 'top',
        name: 'Top',
        visible: true,
        opacity: 1,
        blendMode: 'source-over' as const,
        locked: false,
        order: 2,
        imageData: null,
        framebuffer: topFramebuffer,
        alignment: createDefaultLayerAlignment(),
        layerType: 'normal' as const
      }
    ];

    const project = {
      id: 'proj2',
      name: 'Demo2',
      width: 2,
      height: 2,
      layers,
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: [],
      defaultCustomBrushId: null
    };

    const snapshot = useAppStore.getState();
    previousProject = snapshot.project;
    previousLayers = snapshot.layers;
    previousBitmap = snapshot.currentCompositeBitmap;
    previousVersion = snapshot.staticCompositeVersion;
    previousSegments = snapshot.compositeSegments;
    previousSegmentsVersion = snapshot.compositeSegmentsVersion;

    useAppStore.setState((state) => ({
      ...state,
      project,
      layers,
      activeLayerId: 'top',
      layersNeedRecomposition: true
    }));

    const staticCanvas = document.createElement('canvas');
    staticCanvas.width = 2;
    staticCanvas.height = 2;
    expect(useAppStore.getState().renderStaticComposite(staticCanvas)).toBe(true);

    const versionBefore = useAppStore.getState().compositeSegmentsVersion;

    const updatedFramebuffer = makeCanvas([0, 255, 0]);
    useAppStore.getState().updateLayer('top', { framebuffer: updatedFramebuffer });

    const dirtySegments = (useAppStore.getState().compositeSegments ?? []).filter(isDirtyStaticSegment);
    expect(dirtySegments).toHaveLength(1);
    expect(dirtySegments[0].layerIds).toContain('top');

    expect(useAppStore.getState().renderStaticComposite(staticCanvas)).toBe(true);
    expect(useAppStore.getState().compositeSegmentsVersion).toBeGreaterThan(versionBefore);
  });
});
