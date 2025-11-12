import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { useAppStore } from '@/stores/useAppStore';

describe('static vs animated compositor', () => {
  let previousProject = useAppStore.getState().project;
  let previousLayers = useAppStore.getState().layers;
  let previousBitmap = useAppStore.getState().currentCompositeBitmap;
  let previousVersion = useAppStore.getState().staticCompositeVersion;

  afterEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      project: previousProject,
      layers: previousLayers,
      currentCompositeBitmap: previousBitmap,
      staticCompositeVersion: previousVersion
    }));
  });

  it('renders raster content only in the static stack and CC content in the overlay', () => {
    const rasterImage = new ImageData(2, 2);
    for (let i = 0; i < rasterImage.data.length; i += 4) {
      rasterImage.data[i] = 0;
      rasterImage.data[i + 1] = 0;
      rasterImage.data[i + 2] = 255;
      rasterImage.data[i + 3] = 255;
    }

    const rasterFramebuffer = document.createElement('canvas');
    rasterFramebuffer.width = 2;
    rasterFramebuffer.height = 2;

    const rasterLayer = {
      id: 'static-1',
      name: 'Static',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      locked: false,
      order: 0,
      imageData: rasterImage,
      framebuffer: rasterFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal' as const
    };

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 2;
    colorCycleCanvas.height = 2;
    const ccCtx = colorCycleCanvas.getContext('2d');
    if (ccCtx) {
      ccCtx.fillStyle = '#ff0000';
      ccCtx.fillRect(0, 0, 2, 2);
    }

    const colorCycleLayer = {
      id: 'cc-1',
      name: 'Cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      locked: false,
      order: 1,
      imageData: null,
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle' as const,
      colorCycleData: {
        mode: 'recolor' as const,
        canvas: colorCycleCanvas,
        gradient: [],
        isAnimating: true
      }
    };

    const stateBefore = useAppStore.getState();
    previousProject = stateBefore.project;
    previousLayers = stateBefore.layers;
    previousBitmap = stateBefore.currentCompositeBitmap;
    previousVersion = stateBefore.staticCompositeVersion;

    const project = {
      id: 'proj',
      name: 'Demo',
      width: 2,
      height: 2,
      layers: [rasterLayer, colorCycleLayer],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: [],
      defaultCustomBrushId: null
    };

    useAppStore.setState((state) => ({
      ...state,
      project,
      layers: [rasterLayer, colorCycleLayer],
      activeLayerId: rasterLayer.id,
      layersNeedRecomposition: true
    }));

    const { renderStaticComposite, renderColorCycleOverlay } = useAppStore.getState();

    const staticCanvas = document.createElement('canvas');
    staticCanvas.width = 2;
    staticCanvas.height = 2;
    const initialVersion = useAppStore.getState().staticCompositeVersion;
    expect(renderStaticComposite(staticCanvas)).toBe(true);
    expect(useAppStore.getState().staticCompositeVersion).toBe(initialVersion + 1);

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 2;
    overlayCanvas.height = 2;
    expect(renderColorCycleOverlay(overlayCanvas)).toBe(true);

    // Remove color-cycle content and ensure the overlay becomes a no-op
    useAppStore.setState((state) => ({
      ...state,
      layers: [rasterLayer],
      project: state.project ? { ...state.project, layers: [rasterLayer] } : state.project
    }));
    expect(renderColorCycleOverlay(overlayCanvas)).toBe(false);
  });
});
