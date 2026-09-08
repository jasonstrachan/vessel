import { buildCcPickupShapeStops, buildCcPickupStrokeStops, usesCcSampledGradient, type CcColourPickup } from '../ccColourPickup';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

const makePickup = (paint: (x: number, y: number) => boolean): CcColourPickup => {
  const image = { width: 320, height: 80, data: new Uint8ClampedArray(320 * 80 * 4) } as ImageData;
  for (let y = 0; y < 80; y += 1) for (let x = 0; x < 320; x += 1) {
    if (paint(x, y)) image.data.set([255, 0, 0, 255], (y * 320 + x) * 4);
  }
  return { image, brushSize: 20, baseStops: [{ position: 0, color: '#0000ff' }, { position: 1, color: '#0000ff' }] };
};
const red = (stops: ReturnType<typeof buildCcPickupStrokeStops>, t: number): number =>
  parseCssColorToRgba(stops[Math.round(t * (stops.length - 1))].color)[0];
const polygon = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 80 }, { x: 0, y: 80 }];

describe('CC visible colour pickup', () => {
  it('mixes pickup at retained palette indices, including dither companions, without moving the palette start', () => {
    const pickup = makePickup(() => true);
    pickup.strokePaletteIndicesAt = () => [128, 192];
    const stops = buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    expect(stops).toHaveLength(255);
    expect(stops[0]).toMatchObject({ position: 0, color: 'rgb(0, 0, 255)' });
    expect(parseCssColorToRgba(stops[127].color)[0]).toBeGreaterThan(100);
    expect(parseCssColorToRgba(stops[191].color)[0]).toBeGreaterThan(100);
    expect(stops[254]).toMatchObject({ position: 1, color: 'rgb(0, 0, 255)' });
  });

  it('keeps the base palette unchanged when retained-phase pickup crosses only transparency', () => {
    const pickup = makePickup(() => false);
    pickup.strokePaletteIndicesAt = () => [128];
    expect(buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 100, y: 40 }])).toEqual(pickup.baseStops);
  });

  it('handles a retained stroke crossing the palette wrap without mixing untouched indices', () => {
    const pickup = makePickup(() => true);
    pickup.strokePaletteIndicesAt = (x) => x < 50 ? [255] : [1];
    const stops = buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    expect(parseCssColorToRgba(stops[254].color)[0]).toBeGreaterThan(100);
    expect(parseCssColorToRgba(stops[0].color)[0]).toBeGreaterThan(100);
    expect(stops[127].color).toBe('rgb(0, 0, 255)');
  });

  it('leaves the original palette intact over transparency and outside the canvas', () => {
    const pickup = makePickup(() => false);
    expect(buildCcPickupStrokeStops(pickup, [{ x: -100, y: 40 }, { x: 300, y: 40 }])).toEqual(pickup.baseStops);
    expect(buildCcPickupShapeStops(pickup, polygon, { x: 1, y: 0 }, 'linear')).toEqual(pickup.baseStops);
  });
  it('picks up crossed colour and carries it into empty space while gradually returning to its load', () => {
    const pickup = makePickup((x) => x >= 50 && x < 90);
    const stops = buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 300, y: 40 }]);
    expect(red(stops, 0.1)).toBe(0);
    expect(red(stops, 0.27)).toBeGreaterThan(100);
    expect(red(stops, 0.4)).toBeGreaterThan(30);
    expect(red(stops, 0.9)).toBeLessThan(red(stops, 0.4));
    expect(pickup.baseStops[0].color).toBe('#0000ff');
  });
  it('is independent of input event subdivision', () => {
    const pickup = makePickup((x) => x >= 50 && x < 90);
    const sparse = [{ x: 0, y: 40 }, { x: 300, y: 40 }];
    const dense = Array.from({ length: 301 }, (_, x) => ({ x, y: 40 }));
    expect(buildCcPickupStrokeStops(pickup, dense)).toEqual(buildCcPickupStrokeStops(pickup, sparse));
  });
  it('samples paint contacted by the side of a wide stroke', () => {
    const pickup = makePickup((x, y) => x >= 50 && x < 90 && y < 36);
    expect(red(buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 300, y: 40 }]), 0.27)).toBeGreaterThan(0);
  });
  it('carries shape pickup in the chosen direction and excludes paint outside its boundary', () => {
    const pickup = makePickup((x) => x >= 50 && x < 90);
    const forward = buildCcPickupShapeStops(pickup, polygon, { x: 1, y: 0 }, 'linear');
    const reverse = buildCcPickupShapeStops(pickup, polygon, { x: -1, y: 0 }, 'linear');
    expect(red(forward, 0.4)).toBeGreaterThan(20);
    expect(red(reverse, 0.4)).toBe(0);
    const rightHalf = polygon.map((p) => ({ ...p, x: Math.max(160, p.x) }));
    expect(buildCcPickupShapeStops(pickup, rightHalf, { x: 1, y: 0 }, 'linear')).toEqual(pickup.baseStops);
  });
  it('carries concentric pickup inward from the outer painted rim', () => {
    const pickup = makePickup((x, y) => x < 8 || x > 292 || y < 8 || y > 72);
    const stops = buildCcPickupShapeStops(pickup, polygon, null, 'concentric');
    expect(red(stops, 0.18)).toBeGreaterThan(0);
    expect(red(stops, 0.9)).toBeGreaterThan(0);
    expect(red(stops, 0.9)).toBeLessThan(red(stops, 0.18));
  });
  it('preserves per-stop opacity while mixing RGB', () => {
    const pickup = makePickup(() => true);
    pickup.baseStops = pickup.baseStops.map((s) => ({ ...s, opacity: 0.25 }));
    expect(buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 100, y: 40 }]).every((s) => s.opacity === 0.25)).toBe(true);
  });
  it('combines embedded colour alpha with stop opacity when paint is picked up', () => {
    const pickup = makePickup(() => true);
    pickup.baseStops = [0, 1].map((position) => ({ position, color: 'rgba(0, 0, 255, 0.5)', opacity: 0.4 }));
    const stops = buildCcPickupStrokeStops(pickup, [{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    expect(stops[0].opacity).toBeCloseTo(0.2, 2);
  });
  it.each(['linear', 'concentric'] as const)('does not invent transparent slices in a small solid-painted %s shape', (mode) => {
    const pickup = makePickup(() => true);
    const small = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }];
    const stops = buildCcPickupShapeStops(pickup, small, { x: 1, y: 0 }, mode);
    const reds = stops.map((stop) => parseCssColorToRgba(stop.color)[0]);
    expect(reds.every((value, i) => i === 0 || value >= reds[i - 1])).toBe(true);
  });
  it('keeps manual and FG source selection separate from the pickup toggle', () => {
    expect(usesCcSampledGradient({ ccGradientSource: 'manual' })).toBe(false);
    expect(usesCcSampledGradient({ ccGradientSource: 'fg', colorCyclePickupEnabled: true })).toBe(true);
    expect(usesCcSampledGradient({ ccGradientSource: 'sampled', colorCyclePickupEnabled: false })).toBe(true);
  });
});
