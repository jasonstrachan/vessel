import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const imageData = new ImageData(width, height);

  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    layerType: 'normal',
    framebuffer: canvas,
    imageData,
    alignment: createDefaultLayerAlignment(),
  };
};

const createProject = (layer: Layer, width = 4, height = 4): Project => ({
  id: 'proj',
  name: 'proj',
  width,
  height,
  layers: [layer],
  backgroundColor: '#000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

const getPixel = (img: ImageData | null | undefined, x: number, y: number): [number, number, number, number] => {
  if (!img) return [0, 0, 0, 0];
  const idx = (y * img.width + x) * 4;
  const d = img.data;
  return [d[idx], d[idx + 1], d[idx + 2], d[idx + 3]];
};

describe('selection-based clipping', () => {
  afterEach(() => {
    useAppStore.setState({
      project: null,
      layers: [],
      activeLayerId: null,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('captureCanvasToActiveLayer zeroes pixels outside the selection mask', async () => {
    const layer = createLayer('l1', 4, 4);
    const project = createProject(layer, 4, 4);
    const source = document.createElement('canvas');
    source.width = 4;
    source.height = 4;
    const ctx = source.getContext('2d');
    ctx!.fillStyle = 'rgba(255,0,0,255)';
    ctx!.fillRect(0, 0, 4, 4);

    // Mask only keeps a plus shape at (1,1), (2,1), (1,2)
    const mask = new ImageData(3, 3);
    const setAlpha = (x: number, y: number) => {
      const idx = (y * 3 + x) * 4 + 3;
      mask.data[idx] = 255;
    };
    setAlpha(1, 1);
    setAlpha(2, 1);
    setAlpha(1, 2);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionMask: mask,
      selectionMaskBounds: { x: 0, y: 0, width: 3, height: 3 },
      selectionMaskLayerId: 'other-layer', // should be ignored now
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 3, y: 3 },
    });

    await useAppStore.getState().captureCanvasToActiveLayer(source);

    const updated = useAppStore.getState().layers[0]?.imageData;

    expect(getPixel(updated, 1, 1)[3]).toBeGreaterThan(0);
    expect(getPixel(updated, 2, 1)[3]).toBeGreaterThan(0);
    expect(getPixel(updated, 1, 2)[3]).toBeGreaterThan(0);
    // Outside mask should be cleared
    expect(getPixel(updated, 0, 0)[3]).toBe(0);
    expect(getPixel(updated, 3, 3)[3]).toBe(0);
    expect(getPixel(updated, 0, 2)[3]).toBe(0);
  });

  it('captureCanvasToActiveLayer clips to rectangular selection when no mask', async () => {
    const layer = createLayer('l1', 4, 4);
    const project = createProject(layer, 4, 4);
    const source = document.createElement('canvas');
    source.width = 4;
    source.height = 4;
    const ctx = source.getContext('2d');
    ctx!.fillStyle = 'rgba(0,255,0,255)';
    ctx!.fillRect(0, 0, 4, 4);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
    });

    await useAppStore.getState().captureCanvasToActiveLayer(source);
    const updated = useAppStore.getState().layers[0]?.imageData;

    // Inside rect should remain
    expect(getPixel(updated, 1, 1)[3]).toBeGreaterThan(0);
    expect(getPixel(updated, 2, 2)[3]).toBeGreaterThan(0);
    // Outside should be cleared
    expect(getPixel(updated, 0, 0)[3]).toBe(0);
    expect(getPixel(updated, 3, 3)[3]).toBe(0);
  });

  it('deleteSelectedPixels clears only masked pixels even on another layer', () => {
    const layer = createLayer('l1', 3, 3);
    const project = createProject(layer, 3, 3);

    // Seed layer with opaque pixels everywhere
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        const idx = (y * 3 + x) * 4 + 3;
        layer.imageData.data[idx] = 255;
      }
    }
    // Keep framebuffer in sync so deleteSelectedPixels reads the opaque data.
    const fbCtx = layer.framebuffer?.getContext('2d');
    fbCtx?.putImageData(layer.imageData, 0, 0);

    const mask = new ImageData(3, 3);
    const idx = (1 * 3 + 1) * 4 + 3;
    mask.data[idx] = 255; // only center is selected

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 3, y: 3 },
      selectionMask: mask,
      selectionMaskBounds: { x: 0, y: 0, width: 3, height: 3 },
      selectionMaskLayerId: 'different',
    });

    useAppStore.getState().deleteSelectedPixels();

    const updated = useAppStore.getState().layers[0]?.imageData;
    // Center cleared
    expect(getPixel(updated, 1, 1)[3]).toBe(0);
    // Corners untouched
    expect(getPixel(updated, 0, 0)[3]).toBe(255);
    expect(getPixel(updated, 2, 2)[3]).toBe(255);
  });
});
