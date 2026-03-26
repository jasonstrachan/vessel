import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import {
  createCcGradientSampleSession,
  isTempSampleSlotAvailable,
  updateCcGradientSampleSession,
} from '../ccGradientSampling';

describe('ccGradientSampling', () => {
  it('updateCcGradientSampleSession stores sampled stops and hash', () => {
    const session = createCcGradientSampleSession();
    const lastUpdateRef = { current: 0 };
    const stops = updateCcGradientSampleSession({
      session,
      sourcePts: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      now: 200,
      lastUpdateRef,
      sampleColor: (x) => (x < 10 ? '#000000' : '#ffffff'),
      allowTiny: true,
      strokeId: 'stroke-1',
    });

    expect(stops?.length).toBeGreaterThanOrEqual(2);
    expect(session.active).toBe(true);
    expect(session.hash.length).toBeGreaterThan(0);
  });

  it('isTempSampleSlotAvailable avoids collisions', () => {
    const layer = {
      colorCycleData: {
        slotPalettes: [{ slot: TEMP_SAMPLE_SLOT }],
        gradientDefs: [{ id: 'g0', currentSlot: 5 }],
      },
    };
    expect(isTempSampleSlotAvailable(layer)).toBe(false);
    expect(isTempSampleSlotAvailable({ colorCycleData: { slotPalettes: [{ slot: 1 }], gradientDefs: [] } })).toBe(true);
  });
});
