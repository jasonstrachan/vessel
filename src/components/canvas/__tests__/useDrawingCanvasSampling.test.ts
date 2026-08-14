import { act, renderHook } from '@testing-library/react';
import type React from 'react';

import { useDrawingCanvasSampling } from '@/components/canvas/useDrawingCanvasSampling';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const fillCanvas = (canvas: HTMLCanvasElement, color: string): void => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Expected Canvas2D context');
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
};

const createCanvas = (color: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  fillCanvas(canvas, color);
  return canvas;
};

const createCcLayer = ({
  runtimeCanvas,
  framebuffer,
  imageData,
  visible = true,
}: {
  runtimeCanvas: HTMLCanvasElement;
  framebuffer: HTMLCanvasElement;
  imageData: ImageData;
  visible?: boolean;
}): Layer => ({
  id: 'cc-reference',
  name: 'CC Reference',
  visible,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData,
  framebuffer,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    canvas: runtimeCanvas,
    runtimeHydrationState: 'warm',
  },
});

const createLastSampleRef = (): React.MutableRefObject<{
  x: number;
  y: number;
  color: string;
  layerId: string | null;
  preferReference: boolean;
}> => ({
  current: {
    x: -1,
    y: -1,
    color: '#000000',
    layerId: null,
    preferReference: true,
  },
});

describe('useDrawingCanvasSampling', () => {
  it('samples the live CC presentation instead of stale layer raster data', () => {
    const runtimeCanvas = createCanvas('#123456');
    const framebuffer = createCanvas('#ff0000');
    const imageData = framebuffer.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer = createCcLayer({ runtimeCanvas, framebuffer, imageData, visible: false });
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(0, 0)).toBe('#123456');
  });

  it('does not reuse a stale same-coordinate sample from an animated CC reference', () => {
    const runtimeCanvas = createCanvas('#112233');
    const framebuffer = createCanvas('#ff0000');
    const imageData = framebuffer.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer = createCcLayer({ runtimeCanvas, framebuffer, imageData });
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#112233');
    act(() => fillCanvas(runtimeCanvas, '#44aa66'));
    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#44aa66');
  });

  it('does not reuse a stale same-coordinate sample from a hidden regular reference', () => {
    const referenceRaster = createCanvas('#112233');
    const imageData = referenceRaster.getContext('2d')!.getImageData(0, 0, 2, 2);
    const layer: Layer = {
      id: 'regular-reference',
      name: 'Regular Reference',
      visible: false,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: undefined as unknown as HTMLCanvasElement,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };
    const compositeCanvasRef = { current: createCanvas('#ffffff') };
    const lastSampleRef = createLastSampleRef();

    const { result } = renderHook(() => useDrawingCanvasSampling({
      compositeCanvasRef,
      lastSampleRef,
      layers: [layer],
      referenceLayerId: layer.id,
      preferReferenceSampling: true,
    }));

    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#112233');
    imageData.data.set([68, 170, 102, 255], (1 * imageData.width + 1) * 4);
    expect(result.current.sampleColorAtPosition(1, 1)).toBe('#44aa66');
  });
});
