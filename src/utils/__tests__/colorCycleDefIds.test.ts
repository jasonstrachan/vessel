import {
  allocateNextColorCycleDefId,
  EXHAUSTED_COLOR_CYCLE_DEF_ID,
  MAX_COLOR_CYCLE_DEF_ID,
  normalizeNextColorCycleDefId,
} from '@/utils/colorCycleDefIds';

describe('colorCycleDefIds', () => {
  it('reuses the first available hole when nextGradientDefId is past the Uint16 limit', () => {
    const allocation = allocateNextColorCycleDefId({
      ids: [1, 3, MAX_COLOR_CYCLE_DEF_ID],
      nextId: MAX_COLOR_CYCLE_DEF_ID + 1,
    });

    expect(allocation.id).toBe(2);
    expect(allocation.nextGradientDefId).toBe(4);
  });

  it('falls back to the first free hole when a preferred legacy def id is already occupied past the Uint16 limit', () => {
    const allocation = allocateNextColorCycleDefId({
      ids: [1, 3, 7, MAX_COLOR_CYCLE_DEF_ID],
      nextId: MAX_COLOR_CYCLE_DEF_ID + 1,
      preferredId: 7,
    });

    expect(allocation.id).toBe(2);
    expect(allocation.nextGradientDefId).toBe(4);
  });

  it('reports exhaustion when all Uint16 def ids are occupied', () => {
    const ids = Array.from({ length: MAX_COLOR_CYCLE_DEF_ID }, (_, index) => index + 1);

    expect(normalizeNextColorCycleDefId(ids, MAX_COLOR_CYCLE_DEF_ID + 1)).toBe(EXHAUSTED_COLOR_CYCLE_DEF_ID);
    expect(
      allocateNextColorCycleDefId({
        ids,
        nextId: MAX_COLOR_CYCLE_DEF_ID + 1,
      })
    ).toEqual({
      id: null,
      nextGradientDefId: EXHAUSTED_COLOR_CYCLE_DEF_ID,
    });
  });

  it('reports exhaustion when a preferred legacy def id collides and no Uint16 def ids remain', () => {
    const ids = Array.from({ length: MAX_COLOR_CYCLE_DEF_ID }, (_, index) => index + 1);

    expect(
      allocateNextColorCycleDefId({
        ids,
        nextId: MAX_COLOR_CYCLE_DEF_ID + 1,
        preferredId: MAX_COLOR_CYCLE_DEF_ID,
      })
    ).toEqual({
      id: null,
      nextGradientDefId: EXHAUSTED_COLOR_CYCLE_DEF_ID,
    });
  });
});
