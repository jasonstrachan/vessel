// Mock the heavy brush implementation so we can exercise the parity harness
// without relying on WebGL or Canvas2D internals.
class FakeBrush {
  private playing = false;
  paint = jest.fn();
  startStroke = jest.fn();
  endStroke = jest.fn();
  setGradient = jest.fn();
  setMultipleGradients = jest.fn();
  startAnimation = jest.fn(() => {
    this.playing = true;
  });
  stopAnimation = jest.fn(() => {
    this.playing = false;
  });
  isPlaying = jest.fn(() => this.playing);
  setSpeed = jest.fn();
  setActiveLayer = jest.fn();
  render = jest.fn();
  getFullState = jest.fn(() => ({ payload: 'state' }));
  restoreFullState = jest.fn();
  fillShape = jest.fn();
  destroy = jest.fn();
}

jest.mock('../../hooks/brushEngine/ColorCycleBrushCanvas2D', () => ({
  ColorCycleBrushCanvas2D: FakeBrush,
}));

import { ColorCycleFeatureParityTest } from '../ColorCycleFeatureParityTest';

describe('ColorCycleFeatureParityTest (mocked)', () => {
  it('runs the full suite and reports parity', async () => {
    const canvasA = document.createElement('canvas');
    const canvasB = document.createElement('canvas');

    const harness = new ColorCycleFeatureParityTest(canvasA, canvasB);
    const { results, summary, performance } = await harness.runAllTests();

    // All mocked brushes behave the same, so parity should hold.
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(summary.totalTests);

    // A few representative feature checks
    expect(results.find((r) => r.feature === 'Basic Paint Operation')?.parity).toBe(true);
    expect(results.find((r) => r.feature === 'Animation Stop')?.parity).toBe(true);

    // Performance entries are recorded when both brushes reported timings.
    expect(performance.length).toBeGreaterThan(0);
  });
});
