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

  it('exposes the current definition IDs to runtime buffer bindings', () => {
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      forceCanvas2D: true,
    });
    const defIdData = new Uint16Array([4, 5, 0, 0]);
    animator.setDefIdData(defIdData);

    const handle = animator.beginDirectFill();

    expect(handle.defIdData).toBe(defIdData);
    animator.endDirectFill({ markDirty: false });
  });

  it('detaches definition IDs when rebuilding from an immutable document generation', () => {
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 2,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      forceCanvas2D: true,
    });
    const documentPaint = new Uint8Array([1, 2, 0, 0]);
    const documentGradientIds = new Uint8Array([1, 1, 0, 0]);
    const documentDefinitionIds = new Uint16Array([4, 5, 0, 0]);
    const documentSpeeds = new Uint8Array([10, 10, 0, 0]);
    const documentFlow = new Uint8Array([1, 1, 0, 0]);
    const documentPhase = new Uint8Array([0, 1, 0, 0]);
    const snapshot = {
      layerId: 'cc-layer',
      width: 2,
      height: 2,
      paintBuffer: documentPaint.buffer,
      gradientIdBuffer: documentGradientIds.buffer,
      gradientDefIdBuffer: documentDefinitionIds.buffer,
      speedBuffer: documentSpeeds.buffer,
      flowBuffer: documentFlow.buffer,
      phaseBuffer: documentPhase.buffer,
      hasContent: true,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    };

    animator.rebuild(snapshot, 3);
    const handle = animator.beginDirectFill();

    expect(handle.defIdData).not.toBeNull();
    expect(handle.data.buffer).not.toBe(documentPaint.buffer);
    expect(handle.gradientId.buffer).not.toBe(documentGradientIds.buffer);
    expect(handle.defIdData?.buffer).not.toBe(documentDefinitionIds.buffer);
    expect(handle.speedData.buffer).not.toBe(documentSpeeds.buffer);
    expect(handle.flowData.buffer).not.toBe(documentFlow.buffer);
    expect(handle.phaseData.buffer).not.toBe(documentPhase.buffer);
    handle.data[0] = 99;
    handle.gradientId[0] = 99;
    handle.defIdData![0] = 99;
    handle.speedData[0] = 99;
    handle.flowData[0] = 99;
    handle.phaseData[0] = 99;
    expect(Array.from(documentPaint)).toEqual([1, 2, 0, 0]);
    expect(Array.from(documentGradientIds)).toEqual([1, 1, 0, 0]);
    expect(Array.from(documentDefinitionIds)).toEqual([4, 5, 0, 0]);
    expect(Array.from(documentSpeeds)).toEqual([10, 10, 0, 0]);
    expect(Array.from(documentFlow)).toEqual([1, 1, 0, 0]);
    expect(Array.from(documentPhase)).toEqual([0, 1, 0, 0]);
    animator.endDirectFill({ markDirty: false });
  });
});
