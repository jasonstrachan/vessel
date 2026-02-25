import { PaletteController } from '@/lib/colorCycle/PaletteController';

const makeStops = (color: string) => [
  { position: 0, color },
  { position: 1, color },
];

describe('PaletteController', () => {
  it('tracks active slot selection', () => {
    const controller = new PaletteController({ gradientStops: makeStops('#ff0000') });

    expect(controller.getActiveSlot()).toBe(0);
    expect(controller.setActiveSlot(2)).toBe(true);
    expect(controller.getActiveSlot()).toBe(2);
    expect(controller.setActiveSlot(2)).toBe(false);
  });

  it('stores per-slot palettes and signatures', () => {
    const controller = new PaletteController({ gradientStops: makeStops('#ff0000') });
    const baseSignature = controller.getSignatureForSlot(0);

    controller.setGradientSlot(1, makeStops('#00ff00'));

    expect(controller.getSignatureForSlot(1)).not.toBeNull();
    expect(controller.getSignatureForSlot(1)).not.toBe(baseSignature);
    expect(controller.getPaletteRGBAForSlot(1)).toBeTruthy();
  });

  it('produces stable signatures for identical stops', () => {
    const stops = makeStops('#123456');

    const first = PaletteController.computeSignature(stops);
    const second = PaletteController.computeSignature([...stops]);

    expect(first).toBe(second);
  });
});
