import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Rectangle } from '@/types';

const DEFAULT_ALIGNMENT = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
} as const;

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
          createdAt: new Date(),
          updatedAt: new Date(),
          palette: useAppStore.getState().palette,
          metadata: {},
          autosaveEnabled: false,
        },
  }));
};

const resetStore = () => {
  useAppStore.setState((state) => ({
    ...state,
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    colorAdjust: {
      active: false,
      params: {
        hue: 0,
        saturation: 0,
        lightness: 0,
        contrast: 0,
        red: 0,
        green: 0,
        blue: 0,
      },
      originalImageData: null,
      selectionBounds: null,
      targetLayerId: null,
    },
  }));
};

const pixelAt = (image: ImageData, x: number, y: number): [number, number, number, number] => {
  const idx = (y * image.width + x) * 4;
  return [
    image.data[idx] ?? 0,
    image.data[idx + 1] ?? 0,
    image.data[idx + 2] ?? 0,
    image.data[idx + 3] ?? 0,
  ];
};

describe('colorAdjustSlice preview performance path', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('limits adjustments to the selection ROI and leaves outside pixels untouched', () => {
    // 4x4 green image
    const base = new ImageData(4, 4);
    base.data.fill(0);
    for (let i = 0; i < base.data.length; i += 4) {
      base.data[i + 1] = 255; // green channel
      base.data[i + 3] = 255; // alpha
    }
    const layer = createLayer('roi-layer', base);
    installProjectWithLayer(layer);

    // Selection from (1,1) to (3,3) => width/height 2
    const selection: Rectangle = { x: 1, y: 1, width: 2, height: 2 };
    useAppStore.setState({
      selectionStart: { x: selection.x, y: selection.y },
      selectionEnd: { x: selection.x + selection.width, y: selection.y + selection.height },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updated = useAppStore.getState().layers[0]?.imageData as ImageData;

    // Inside ROI: red increased (100% => +255)
    expect(pixelAt(updated, 1, 1)[0]).toBe(255);
    expect(pixelAt(updated, 2, 2)[0]).toBe(255);
    // Outside ROI: unchanged (still 0 red)
    expect(pixelAt(updated, 0, 0)[0]).toBe(0);
    expect(pixelAt(updated, 3, 3)[0]).toBe(0);
  });

  it('reuses the working buffer across previews (no churn)', () => {
    const base = new ImageData(2, 2);
    base.data.set([
      0, 255, 0, 255, 0, 255, 0, 255,
      0, 255, 0, 255, 0, 255, 0, 255,
    ]);
    const layer = createLayer('reuse-layer', base);
    installProjectWithLayer(layer);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 50 });
    store.previewColorAdjust();

    const firstRef = useAppStore.getState().layers[0]?.imageData as ImageData;
    // 50% => +127/128 (rounding)
    expect(pixelAt(firstRef, 0, 0)[0]).toBe(127);

    // Second preview with different adjustment should keep same ImageData object
    store.updateColorAdjustParams({ red: 20 });
    store.previewColorAdjust();
    const secondRef = useAppStore.getState().layers[0]?.imageData as ImageData;

    expect(firstRef).toBe(secondRef);
    expect(pixelAt(secondRef, 0, 0)[0]).toBe(51);
  });
});
