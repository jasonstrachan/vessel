import { createPressureResolutionState } from '@/utils/pressureResolution';
import { computeShapePixelSize } from '@/hooks/canvas/handlers/shapePressure';

describe('shapePressure', () => {
  it('uses the configured fillResolution as the pressure-linked max pixel size', () => {
    const stateRef = { current: createPressureResolutionState(1) };

    const pixelSize = computeShapePixelSize({
      pressure: 1,
      baseResolution: 7,
      pressureLinked: true,
      stateRef,
    });

    expect(pixelSize).toBe(7);
  });
});
