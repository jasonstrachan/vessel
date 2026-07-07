import { ColorCycleShapeFillJobState } from '../colorCycleShapeFillJobState';

describe('ColorCycleShapeFillJobState', () => {
  it('marks only the latest concentric worker job as current', () => {
    const state = new ColorCycleShapeFillJobState();

    const first = state.beginConcentricWorkerJob();
    expect(state.isCurrentConcentricWorkerJob(first)).toBe(true);

    const second = state.beginConcentricWorkerJob();
    expect(second).toBe(first + 1);
    expect(state.isCurrentConcentricWorkerJob(first)).toBe(false);
    expect(state.isCurrentConcentricWorkerJob(second)).toBe(true);
  });
});
