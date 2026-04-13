import { ColorCycleAnimator } from '../ColorCycleAnimator';

describe('ColorCycleAnimator beginDirectFill', () => {
  it('uses index buffer dimensions instead of renderer canvas dimensions', () => {
    const animator = new ColorCycleAnimator({
      width: 4,
      height: 3,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      forceCanvas2D: true,
    });

    const rendererCanvas = (animator as unknown as {
      renderer2D: { getCanvas: () => HTMLCanvasElement };
    }).renderer2D.getCanvas();
    rendererCanvas.width = 40;
    rendererCanvas.height = 30;

    const handle = animator.beginDirectFill();

    expect(handle.width).toBe(4);
    expect(handle.height).toBe(3);
    expect(handle.phaseData.length).toBe(12);

    animator.endDirectFill();
  });
});
