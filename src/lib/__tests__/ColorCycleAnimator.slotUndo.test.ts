import { ColorCycleAnimator } from '../ColorCycleAnimator';

const makeSolidStops = (color: string) => [
  { position: 0, color },
  { position: 1, color },
];

const readPixel = (data: Uint8ClampedArray, x: number, y: number, width: number) => {
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
};

describe('ColorCycleAnimator multi-slot + undo flow', () => {
  it('renders two palettes, restores buffers on undo, and draws after undo', () => {
    const animator = new ColorCycleAnimator({
      width: 4,
      height: 2,
      gradientStops: makeSolidStops('#ff0000'),
      forceCanvas2D: true,
    });

    animator.setGradientSlot(0, makeSolidStops('#ff0000'));
    animator.setGradientSlot(1, makeSolidStops('#00ff00'));

    animator.setActiveGradientSlot(0);
    animator.setIndex(0, 0, 1);
    animator.setIndex(1, 0, 1);

    const indexBefore = new Uint8Array((animator as any).indexBuffer.getIndexData());
    const gidBefore = new Uint8Array((animator as any).indexBuffer.getGradientIdData());

    animator.setActiveGradientSlot(1);
    animator.setIndex(0, 0, 1); // overlap stroke A
    animator.setIndex(2, 0, 1);

    animator.forceRender();
    const imageAfter = animator.getImageData().data;
    expect(readPixel(imageAfter, 0, 0, 4)).toEqual([0, 255, 0, 255]);
    expect(readPixel(imageAfter, 1, 0, 4)).toEqual([255, 0, 0, 255]);
    expect(readPixel(imageAfter, 2, 0, 4)).toEqual([0, 255, 0, 255]);

    // Undo: restore pre-stroke buffers
    animator.setIndexBufferFromArray(indexBefore, gidBefore);
    animator.forceRender();

    const imageUndo = animator.getImageData().data;
    expect(readPixel(imageUndo, 0, 0, 4)).toEqual([255, 0, 0, 255]);
    expect(readPixel(imageUndo, 2, 0, 4)).toEqual([0, 0, 0, 0]);

    // After undo, drawing continues and uses current palettes
    animator.setActiveGradientSlot(1);
    animator.setIndex(3, 0, 1);
    animator.forceRender();
    const imageAfterUndoStroke = animator.getImageData().data;
    expect(readPixel(imageAfterUndoStroke, 3, 0, 4)).toEqual([0, 255, 0, 255]);
  });
});
