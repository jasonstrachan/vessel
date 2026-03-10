import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/workers/colorCycleFillClient', () => ({
  runConcentricFillJob: jest.fn(async () => ({})),
  runPerceptualDitherJob: jest.fn(async () => ({})),
}));

const createFilledImageData = (width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = x;
      data[index + 1] = y;
      data[index + 2] = 42;
      data[index + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
};

const createLayer = (id: string, imageData: ImageData): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;

  return {
    id,
    name: 'Test Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  };
};

const createProject = (layer: Layer): Project => ({
  id: 'project-1',
  name: 'Clipboard Project',
  width: layer.imageData?.width ?? 1,
  height: layer.imageData?.height ?? 1,
  layers: [layer],
  backgroundColor: '#000000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

const setupSelectionState = () => {
  const imageData = createFilledImageData(4, 4);
  const layer = createLayer('layer-1', imageData);
  const project = createProject(layer);

  useAppStore.setState({
    project,
    layers: [layer],
    activeLayerId: layer.id,
    selectionStart: { x: 0, y: 0 },
    selectionEnd: { x: 2, y: 2 },
    selectionClipboard: null,
    layersNeedRecomposition: false,
    floatingPaste: null,
  });

  return { layer };
};

const resetStore = () => {
  useAppStore.setState({
    project: null,
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    selectionClipboard: null,
    layersNeedRecomposition: false,
    floatingPaste: null,
  });
};

describe('selection clipboard helpers', () => {
  afterEach(() => {
    resetStore();
  });

  it('copies marquee pixels into the internal clipboard without mutating the layer', async () => {
    const { layer } = setupSelectionState();
    const beforeCopy = new Uint8ClampedArray(layer.imageData?.data ?? new Uint8ClampedArray());

    const handled = await useAppStore.getState().copySelectionToClipboard({ mode: 'copy' });

    expect(handled).toBe(true);
    const clipboard = useAppStore.getState().selectionClipboard;
    expect(clipboard).not.toBeNull();
    expect(clipboard?.width).toBe(2);
    expect(clipboard?.height).toBe(2);
    expect(Array.from(clipboard?.imageData.data ?? [])).toEqual([
      0, 0, 42, 255,
      1, 0, 42, 255,
      0, 1, 42, 255,
      1, 1, 42, 255,
    ]);

    expect(Array.from(layer.imageData?.data ?? [])).toEqual(Array.from(beforeCopy));
  });

  it('cuts marquee pixels, clears the source layer, and flags recomposition', async () => {
    setupSelectionState();

    const handled = await useAppStore.getState().copySelectionToClipboard({ mode: 'cut' });

    expect(handled).toBe(true);
    const clipboard = useAppStore.getState().selectionClipboard;
    expect(clipboard).not.toBeNull();
    const updatedLayer = useAppStore.getState().layers[0];
    expect(updatedLayer.imageData).not.toBeNull();

    const clearedRegion: number[] = [];
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const index = (y * (updatedLayer.imageData?.width ?? 0) + x) * 4;
        clearedRegion.push(
          updatedLayer.imageData?.data[index] ?? -1,
          updatedLayer.imageData?.data[index + 1] ?? -1,
          updatedLayer.imageData?.data[index + 2] ?? -1,
          updatedLayer.imageData?.data[index + 3] ?? -1,
        );
      }
    }

    expect(clearedRegion).toEqual(new Array(16).fill(0));
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
  });

  it('copies floating paste contents when no selection bounds exist', async () => {
    const floatingData = createFilledImageData(3, 2);
    const layer = createLayer('layer-floating', floatingData);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionClipboard: null,
      floatingPaste: null,
      layersNeedRecomposition: false,
    });

    useAppStore.getState().setFloatingPaste({
      imageData: floatingData,
      position: { x: 5, y: 6 },
      width: floatingData.width,
      height: floatingData.height,
      displayWidth: floatingData.width,
      displayHeight: floatingData.height,
    });

    const handled = await useAppStore.getState().copySelectionToClipboard({ mode: 'copy' });

    expect(handled).toBe(true);
    const clipboard = useAppStore.getState().selectionClipboard;
    expect(clipboard).not.toBeNull();
    expect(clipboard?.mode).toBe('copy');
    expect(clipboard?.width).toBe(3);
    expect(clipboard?.height).toBe(2);
    expect(clipboard?.position).toEqual({ x: 5, y: 6 });

    const originalFloating = useAppStore.getState().floatingPaste;
    expect(originalFloating).not.toBeNull();
    expect(clipboard?.imageData).not.toBe(originalFloating?.imageData ?? null);
    expect(Array.from(clipboard?.imageData.data ?? [])).toEqual(Array.from(floatingData.data));
  });

  it('cuts floating paste contents and clears the floating state when requested', async () => {
    const floatingData = createFilledImageData(2, 2);
    const layer = createLayer('layer-floating-cut', floatingData);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionClipboard: null,
      floatingPaste: null,
      layersNeedRecomposition: false,
    });

    useAppStore.getState().setFloatingPaste({
      imageData: floatingData,
      position: { x: 3, y: 4 },
      width: floatingData.width,
      height: floatingData.height,
      displayWidth: floatingData.width,
      displayHeight: floatingData.height,
    });

    const handled = await useAppStore.getState().copySelectionToClipboard({ mode: 'cut' });

    expect(handled).toBe(true);
    const clipboard = useAppStore.getState().selectionClipboard;
    expect(clipboard).not.toBeNull();
    expect(clipboard?.mode).toBe('cut');
    expect(clipboard?.position).toEqual({ x: 3, y: 4 });
    expect(Array.from(clipboard?.imageData.data ?? [])).toEqual(Array.from(floatingData.data));
    expect(useAppStore.getState().floatingPaste).toBeNull();
  });

  it('copies full CC payload from floating paste into the internal clipboard', async () => {
    const floatingData = createFilledImageData(2, 2);
    const layer = createLayer('layer-floating-cc', floatingData);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionClipboard: null,
      floatingPaste: null,
      layersNeedRecomposition: false,
    });

    useAppStore.getState().setFloatingPaste({
      imageData: floatingData,
      position: { x: 7, y: 9 },
      width: 2,
      height: 2,
      colorCycleIndices: new Uint8Array([1, 2, 3, 4]),
      colorCycleGradientIds: new Uint8Array([5, 6, 7, 8]),
      colorCycleGradientDefIds: new Uint16Array([9, 10, 11, 12]),
      colorCycleSpeed: new Uint8Array([13, 14, 15, 16]),
      colorCycleFlow: new Uint8Array([17, 18, 19, 20]),
      sourceLayerId: 'layer-cc',
    });

    const handled = await useAppStore.getState().copySelectionToClipboard({ mode: 'copy' });

    expect(handled).toBe(true);
    const clipboard = useAppStore.getState().selectionClipboard;
    expect(Array.from(clipboard?.colorCycleIndices ?? [])).toEqual([1, 2, 3, 4]);
    expect(Array.from(clipboard?.colorCycleGradientIds ?? [])).toEqual([5, 6, 7, 8]);
    expect(Array.from(clipboard?.colorCycleGradientDefIds ?? [])).toEqual([9, 10, 11, 12]);
    expect(Array.from(clipboard?.colorCycleSpeed ?? [])).toEqual([13, 14, 15, 16]);
    expect(Array.from(clipboard?.colorCycleFlow ?? [])).toEqual([17, 18, 19, 20]);
    expect(clipboard?.colorCycleSourceLayerId).toBe('layer-cc');
  });
});
