import { computeBestLoopSuggestion } from '@/components/modals/export/exportModalModel';
import type { Layer } from '@/types';

const createSequentialLayer = (fps: number, frameCount: number): Layer => ({
  id: `sequence-${fps}-${frameCount}`,
  layerType: 'sequential',
  sequentialData: {
    fps,
    frameCount,
    durationMs: Math.round((frameCount * 1000) / fps),
    events: [],
  },
} as unknown as Layer);

describe('computeBestLoopSuggestion sequential clips', () => {
  it('returns one exact sequence period for a sequence-only export', () => {
    expect(computeBestLoopSuggestion({
      fps: 12,
      durationSeconds: 3,
      layers: [createSequentialLayer(12, 24)],
      brushCycleSpeed: 0.1,
    })).toEqual({
      frames: 24,
      success: true,
      duration: 2,
    });
  });

  it('finds a shared exact period for sequence clips with different lengths', () => {
    const suggestion = computeBestLoopSuggestion({
      fps: 24,
      durationSeconds: 1,
      layers: [
        createSequentialLayer(12, 12),
        createSequentialLayer(12, 18),
      ],
      brushCycleSpeed: 0.1,
    });

    expect(suggestion).toEqual({
      frames: 72,
      success: true,
      duration: 3,
    });
  });
});
