import { createLayerCompositeDrawing } from '../layerCompositeDrawing';
import type { Layer, Project } from '@/types';

jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: jest.fn(() => null),
}));
jest.mock('@/stores/layers/layerColorCycleMaskState', () => ({
  prepareColorCycleCompositeSource: jest.fn((_layer, canvas) => canvas),
}));

const makeCanvas = () => ({
  width: 32,
  height: 32,
  getContext: jest.fn(),
}) as unknown as HTMLCanvasElement;

const makeLayer = (id: string, order: number, framebuffer: HTMLCanvasElement): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order,
  imageData: null,
  framebuffer,
  alignment: {
    fit: 'contain',
    positioning: 'auto',
    horizontal: 'center',
    vertical: 'center',
    offsetPx: { x: 0, y: 0 },
  },
  layerType: 'normal',
});

describe('layerCompositeDrawing multiplayer overlay', () => {
  const project = {
    id: 'project-1',
    name: 'Pixel Together',
    width: 32,
    height: 32,
    backgroundColor: 'transparent',
    layers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    customBrushes: [],
  } as Project;

  const createSubject = () => createLayerCompositeDrawing({
    createLayerTransferCanvas: jest.fn(() => null),
    hasValidFramebuffer: (framebuffer): framebuffer is HTMLCanvasElement | OffscreenCanvas => (
      Boolean(framebuffer)
    ),
  });

  it('composites a live brush surface at its owning layer z-order', () => {
    const lower = makeCanvas();
    const active = makeCanvas();
    const upper = makeCanvas();
    const live = makeCanvas();
    const context = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    createSubject().drawAllLayersInOrder(
      context,
      [
        makeLayer('lower', 0, lower),
        makeLayer('active', 1, active),
        makeLayer('upper', 2, upper),
      ],
      project,
      null,
      0,
      { layerId: 'active', canvas: live, mode: 'over' },
    );

    expect((context.drawImage as jest.Mock).mock.calls.map(([source]) => source))
      .toEqual([lower, active, live, upper]);
  });

  it('uses the live eraser surface as the complete active-layer replacement', () => {
    const lower = makeCanvas();
    const active = makeCanvas();
    const upper = makeCanvas();
    const live = makeCanvas();
    const context = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    createSubject().drawAllLayersInOrder(
      context,
      [
        makeLayer('lower', 0, lower),
        makeLayer('active', 1, active),
        makeLayer('upper', 2, upper),
      ],
      project,
      null,
      0,
      { layerId: 'active', canvas: live, mode: 'replace' },
    );

    expect((context.drawImage as jest.Mock).mock.calls.map(([source]) => source))
      .toEqual([lower, live, upper]);
  });
});
