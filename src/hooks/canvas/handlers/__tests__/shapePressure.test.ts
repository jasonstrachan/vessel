import { createPressureResolutionState } from '@/utils/pressureResolution';
import { computeShapePixelSize } from '@/hooks/canvas/handlers/shapePressure';

describe('shapePressure', () => {
  it('uses the explicit pressure-linked max pixel size when provided', () => {
    const stateRef = { current: createPressureResolutionState(1) };

    const pixelSize = computeShapePixelSize({
      pressure: 1,
      baseResolution: 3,
      maxResolution: 7,
      pressureLinked: true,
      stateRef,
    });

    expect(pixelSize).toBe(7);
  });
});
