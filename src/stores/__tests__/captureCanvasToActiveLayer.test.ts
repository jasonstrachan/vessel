import { useAppStore } from '@/stores/useAppStore';
import type { Layer, LayerAlignmentSettings } from '@/types';

const DEFAULT_ALIGNMENT: LayerAlignmentSettings = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
};

const createLayer = (id: string, imageData: ImageData): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;
  const ctx = framebuffer.getContext('2d');
  ctx?.putImageData(imageData, 0, 0);

  return {
    id,
    name: 'Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: DEFAULT_ALIGNMENT,
    colorCycleData: undefined,
  };
};

const installProjectWithLayer = (layer: Layer) => {
  useAppStore.setState((state) => ({
    layers: [layer],
    activeLayerId: layer.id,
    project: state.project
      ? {
          ...state.project,
          width: layer.imageData?.width ?? state.project.width,
          height: layer.imageData?.height ?? state.project.height,
          layers: [layer],
        }
      : {
          id: 'test-project',
          name: 'Test Project',
          width: layer.imageData?.width ?? 2,
          height: layer.imageData?.height ?? 2,
          layers: [layer],
          backgroundColor: '#000000',
          createdAt: new Date(),
          updatedAt: new Date(),
          palette: useAppStore.getState().palette,
          metadata: {},
          autosaveEnabled: false,
          customBrushes: [],
        },
  }));
};

const resetStore = () => {
  const state = useAppStore.getState();
  state.setCurrentTool('brush');
  useAppStore.setState({
    layers: [],
    activeLayerId: null,
    history: { ...state.history, undoStack: [], redoStack: [] },
  });
};

const getPixel = (image: ImageData | null | undefined, x: number, y: number): [number, number, number, number] => {
  if (!image) return [0, 0, 0, 0];
  const idx = (y * image.width + x) * 4;
  return [
    image.data[idx] ?? 0,
    image.data[idx + 1] ?? 0,
    image.data[idx + 2] ?? 0,
    image.data[idx + 3] ?? 0,
  ];
};

describe('captureCanvasToActiveLayer with replace mode', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('overwrites alpha so erased pixels stay transparent', async () => {
    // Base layer fully opaque white
    const base = new ImageData(new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), 2, 2);
    const layer = createLayer('layer-erase', base);
    installProjectWithLayer(layer);

    // Overlay canvas mirrors project size with one transparent pixel at (0,0)
    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const ctx = overlay.getContext('2d');
    const overlayData = new ImageData(new Uint8ClampedArray([
      0, 0, 0, 0,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]), 2, 2);
    ctx?.putImageData(overlayData, 0, 0);

    await useAppStore.getState().captureCanvasToActiveLayer(
      overlay,
      { x: 0, y: 0, width: 2, height: 2 },
      { mode: 'replace' }
    );

    const updated = useAppStore.getState().layers[0]?.imageData;
    // Pixel (0,0) should be fully cleared
    expect(getPixel(updated, 0, 0)).toEqual([0, 0, 0, 0]);
    // Neighboring pixels should reflect overlay color replacement
    expect(getPixel(updated, 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('prefers framebuffer pixels over stale imageData when compositing ROI', async () => {
    const staleImageData = new ImageData(new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), 2, 2);
    const layer = createLayer('layer-fb-priority', staleImageData);

    const fbCtx = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | null;
    const framebufferImage = new ImageData(new Uint8ClampedArray([
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]), 2, 2);
    fbCtx?.putImageData(framebufferImage, 0, 0);

    installProjectWithLayer(layer);

    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const overlayCtx = overlay.getContext('2d');
    const overlayData = new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]), 2, 2);
    overlayCtx?.putImageData(overlayData, 0, 0);

    await useAppStore.getState().captureCanvasToActiveLayer(
      overlay,
      { x: 0, y: 0, width: 1, height: 1 }
    );

    const updated = useAppStore.getState().layers[0]?.imageData;
    expect(getPixel(updated, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(updated, 1, 1)).toEqual([0, 0, 255, 255]);
  });
});
