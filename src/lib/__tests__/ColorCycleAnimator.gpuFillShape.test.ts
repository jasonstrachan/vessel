import { ColorCycleAnimator } from '../ColorCycleAnimator';

const makeSolidStops = (color: string) => [
  { position: 0, color },
  { position: 1, color },
];

describe('ColorCycleAnimator gpuFillShape', () => {
  it('stamps speed and flow bytes for GPU-filled pixels', () => {
    const animator = new ColorCycleAnimator({
      width: 4,
      height: 4,
      gradientStops: makeSolidStops('#ff0000'),
      forceCanvas2D: true,
    });

    const internals = animator as unknown as {
      forceCanvas2D: boolean;
      glRenderer: { fillPolygonConcentric: jest.Mock };
      glCanvas: HTMLCanvasElement | null;
      forceRender: jest.Mock;
    };

    internals.forceCanvas2D = false;
    internals.glRenderer = {
      fillPolygonConcentric: jest.fn(() => new Uint8Array([
        1, 2,
        0, 3,
      ])),
    };
    internals.glCanvas = document.createElement('canvas');
    internals.forceRender = jest.fn();

    const ok = animator.gpuFillShape(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
      {
        mode: 'linear',
        bands: 3,
        baseOffset: 0,
        colorStep: 127,
        bbox: { minX: 1, minY: 1, width: 2, height: 2 },
      },
      7,
      91,
      3,
    );

    expect(ok).toBe(true);

    const { data, gid, spd, flow } = animator.getIndexBuffers();
    expect(data[9]).toBe(1);
    expect(gid?.[9]).toBe(7);
    expect(spd?.[9]).toBe(91);
    expect(flow?.[9]).toBe(3);

    expect(data[5]).toBe(0);
    expect(gid?.[5]).toBe(0);
    expect(spd?.[5]).toBe(0);
    expect(flow?.[5]).toBe(0);

    expect(data[6]).toBe(3);
    expect(gid?.[6]).toBe(7);
    expect(spd?.[6]).toBe(91);
    expect(flow?.[6]).toBe(3);

    expect(data[10]).toBe(2);
    expect(gid?.[10]).toBe(7);
    expect(spd?.[10]).toBe(91);
    expect(flow?.[10]).toBe(3);
  });
});
