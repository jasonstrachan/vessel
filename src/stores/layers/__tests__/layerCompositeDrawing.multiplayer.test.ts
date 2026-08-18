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

  it('composites semantic text inside its owner layer stack position', () => {
    const lower = makeCanvas();
    const upper = makeCanvas();
    const events: string[] = [];
    const context = {
      clearRect: jest.fn(),
      drawImage: jest.fn((source) => events.push(
        source === lower ? 'lower' : source === upper ? 'upper' : 'text:TXT',
      )),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      measureText: jest.fn((text: string) => ({ width: text.length * 6 })),
      fillRect: jest.fn(),
      fillText: jest.fn((text: string) => events.push(`text:${text}`)),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const lowerLayer = { ...makeLayer('lower', 0, lower), opacity: 0.5 };
    const textProject = {
      ...project,
      txtShapes: [{
        id: 'txt-owned',
        layerId: 'lower',
        x: 1,
        y: 1,
        width: 30,
        height: 20,
        content: 'TXT',
        fontFamily: 'mek-mono' as const,
        fontSize: 12,
        lineHeight: 1,
        textAlign: 'left' as const,
        colorSource: 'palette' as const,
        color: '#000000',
        selectionColor: '#ffffff',
        selectionBackgroundColor: '#000000',
        selections: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    };

    createSubject().drawAllLayersInOrder(
      context,
      [lowerLayer, makeLayer('upper', 1, upper)],
      textProject,
      null,
      0,
    );

    expect(events).toEqual(['lower', 'text:TXT', 'upper']);
    expect(context.drawImage).toHaveBeenCalledTimes(3);
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
