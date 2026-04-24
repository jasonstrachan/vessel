import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';

describe('floating paste transform state', () => {
  afterEach(() => {
    useAppStore.setState({ floatingPaste: null });
  });

  it('defaults display dimensions to intrinsic image size', () => {
    const imageData = new ImageData(8, 12);
    useAppStore.getState().setFloatingPaste({
      imageData,
      position: { x: 10, y: 15 },
      width: 8,
      height: 12,
    });

    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste).not.toBeNull();
    expect(floatingPaste?.displayWidth).toBe(8);
    expect(floatingPaste?.displayHeight).toBe(12);
    expect(floatingPaste?.rotation).toBe(0);
  });

  it('updateFloatingPasteRect adjusts position and display size together', () => {
    const imageData = new ImageData(4, 6);
    useAppStore.getState().setFloatingPaste({
      imageData,
      position: { x: 0, y: 0 },
      width: 4,
      height: 6,
    });

    useAppStore.getState().updateFloatingPasteRect({ x: 20, y: 30, width: 40, height: 50 });

    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste).not.toBeNull();
    expect(floatingPaste?.position).toEqual({ x: 20, y: 30 });
    expect(floatingPaste?.displayWidth).toBe(40);
    expect(floatingPaste?.displayHeight).toBe(50);
    // Intrinsic bitmap dimensions remain unchanged for scaling calculations
    expect(floatingPaste?.width).toBe(4);
    expect(floatingPaste?.height).toBe(6);
  });

  it('allows positions outside the project bounds', () => {
    const imageData = new ImageData(10, 10);
    useAppStore.getState().setFloatingPaste({
      imageData,
      position: { x: 0, y: 0 },
      width: 10,
      height: 10,
    });

    useAppStore.getState().updateFloatingPasteRect({ x: -50, y: 275, width: 12, height: 12 });

    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste?.position).toEqual({ x: -50, y: 275 });
    expect(floatingPaste?.displayWidth).toBe(12);
    expect(floatingPaste?.displayHeight).toBe(12);
  });

  it('flipFloatingPasteHorizontal mirrors image and full color-cycle payload', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        1, 0, 0, 255,
        2, 0, 0, 255,
        3, 0, 0, 255,
        4, 0, 0, 255,
      ]),
      2,
      2
    );

    useAppStore.getState().setFloatingPaste({
      imageData,
      position: { x: 0, y: 0 },
      width: 2,
      height: 2,
      colorCycleIndices: new Uint8Array([10, 11, 12, 13]),
      colorCycleGradientIds: new Uint8Array([20, 21, 22, 23]),
      colorCycleGradientDefIds: new Uint16Array([30, 31, 32, 33]),
      colorCycleSpeed: new Uint8Array([40, 41, 42, 43]),
      colorCycleFlow: new Uint8Array([50, 51, 52, 53]),
      colorCyclePhase: new Uint8Array([60, 61, 62, 63]),
    });

    useAppStore.getState().flipFloatingPasteHorizontal();
    const floatingPaste = useAppStore.getState().floatingPaste;

    expect(Array.from(floatingPaste?.imageData?.data ?? [])).toEqual([
      2, 0, 0, 255,
      1, 0, 0, 255,
      4, 0, 0, 255,
      3, 0, 0, 255,
    ]);
    expect(Array.from(floatingPaste?.colorCycleIndices ?? [])).toEqual([11, 10, 13, 12]);
    expect(Array.from(floatingPaste?.colorCycleGradientIds ?? [])).toEqual([21, 20, 23, 22]);
    expect(Array.from(floatingPaste?.colorCycleGradientDefIds ?? [])).toEqual([31, 30, 33, 32]);
    expect(Array.from(floatingPaste?.colorCycleSpeed ?? [])).toEqual([41, 40, 43, 42]);
    expect(Array.from(floatingPaste?.colorCycleFlow ?? [])).toEqual([51, 50, 53, 52]);
    expect(Array.from(floatingPaste?.colorCyclePhase ?? [])).toEqual([61, 60, 63, 62]);
  });

  it('flipFloatingPasteVertical mirrors image and full color-cycle payload', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        1, 0, 0, 255,
        2, 0, 0, 255,
        3, 0, 0, 255,
        4, 0, 0, 255,
      ]),
      2,
      2
    );

    useAppStore.getState().setFloatingPaste({
      imageData,
      position: { x: 0, y: 0 },
      width: 2,
      height: 2,
      colorCycleIndices: new Uint8Array([10, 11, 12, 13]),
      colorCycleGradientIds: new Uint8Array([20, 21, 22, 23]),
      colorCycleGradientDefIds: new Uint16Array([30, 31, 32, 33]),
      colorCycleSpeed: new Uint8Array([40, 41, 42, 43]),
      colorCycleFlow: new Uint8Array([50, 51, 52, 53]),
      colorCyclePhase: new Uint8Array([60, 61, 62, 63]),
    });

    useAppStore.getState().flipFloatingPasteVertical();
    const floatingPaste = useAppStore.getState().floatingPaste;

    expect(Array.from(floatingPaste?.imageData?.data ?? [])).toEqual([
      3, 0, 0, 255,
      4, 0, 0, 255,
      1, 0, 0, 255,
      2, 0, 0, 255,
    ]);
    expect(Array.from(floatingPaste?.colorCycleIndices ?? [])).toEqual([12, 13, 10, 11]);
    expect(Array.from(floatingPaste?.colorCycleGradientIds ?? [])).toEqual([22, 23, 20, 21]);
    expect(Array.from(floatingPaste?.colorCycleGradientDefIds ?? [])).toEqual([32, 33, 30, 31]);
    expect(Array.from(floatingPaste?.colorCycleSpeed ?? [])).toEqual([42, 43, 40, 41]);
    expect(Array.from(floatingPaste?.colorCycleFlow ?? [])).toEqual([52, 53, 50, 51]);
    expect(Array.from(floatingPaste?.colorCyclePhase ?? [])).toEqual([62, 63, 60, 61]);
  });
});
