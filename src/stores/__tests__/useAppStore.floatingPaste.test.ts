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
});
