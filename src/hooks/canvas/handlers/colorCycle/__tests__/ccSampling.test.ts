import { updateCcSampledSession } from '../ccSampling';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

const makeSession = (): MarkGradientSession => ({
  markId: 'm1',
  layerId: 'layer-1',
  markKind: 'stroke',
  gradientKind: 'linear',
  source: 'sampled',
  frozenStopsStored: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  frozenHash: '',
  binding: null,
  previewStopsStored: null,
  previewHash: '',
  fallbackStopsStored: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  samples: [],
});

describe('ccSampling', () => {
  it('builds a 2-stop gradient from a single sample', () => {
    const session = makeSession();
    const lastUpdateRef = { current: 0 };

    const result = updateCcSampledSession({
      session,
      sourcePts: [{ x: 4, y: 4 }],
      now: 200,
      lastUpdateRef,
      sampleColor: () => '#112233',
      allowTiny: true,
    });

    expect(result?.stops.length).toBe(2);
    expect(result?.sampleCount).toBe(1);
    expect(session.previewStopsStored?.[0].color).toBe('#112233');
  });

  it('throttles sampling updates', () => {
    const session = makeSession();
    const lastUpdateRef = { current: 180 };

    const result = updateCcSampledSession({
      session,
      sourcePts: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      now: 200,
      lastUpdateRef,
      sampleColor: () => '#000000',
      allowTiny: true,
    });

    expect(result).toBeNull();
  });

  it('blocks sampled preview downgrades when fallback stops are richer', () => {
    const session = makeSession();
    session.fallbackStopsStored = [
      { position: 0, color: '#000000' },
      { position: 0.33, color: '#333333' },
      { position: 0.66, color: '#666666' },
      { position: 1, color: '#ffffff' },
    ];
    const lastUpdateRef = { current: 0 };

    const result = updateCcSampledSession({
      session,
      sourcePts: [{ x: 4, y: 4 }],
      now: 200,
      lastUpdateRef,
      sampleColor: () => '#112233',
      allowTiny: true,
    });

    expect(result?.updated).toBe(false);
    expect(result?.stops).toEqual(session.fallbackStopsStored);
    expect(session.previewStopsStored).toBeNull();
  });

  it('accepts multi-sample previews even when fallback has more stops', () => {
    const session = makeSession();
    session.fallbackStopsStored = [
      { position: 0, color: '#000000' },
      { position: 0.2, color: '#222222' },
      { position: 0.4, color: '#444444' },
      { position: 0.6, color: '#666666' },
      { position: 0.8, color: '#888888' },
      { position: 1, color: '#ffffff' },
    ];
    const lastUpdateRef = { current: 0 };

    const result = updateCcSampledSession({
      session,
      sourcePts: [
        { x: 0, y: 0 },
        { x: 96, y: 0 },
      ],
      now: 200,
      lastUpdateRef,
      sampleColor: (x) => (x < 48 ? '#112233' : '#445566'),
      allowTiny: true,
    });

    expect(result?.updated).toBe(true);
    expect(result?.sampleCount).toBeGreaterThan(1);
    expect(result?.stops).not.toEqual(session.fallbackStopsStored);
    expect(session.previewStopsStored).toEqual(result?.stops);
  });
});
