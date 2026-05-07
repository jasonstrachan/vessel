import { resolveColorCycleShapeFillSourceOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFillOptions';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

const makeSession = (overrides: Partial<MarkGradientSession>): MarkGradientSession => ({
  markId: 'mark-1',
  layerId: 'layer-1',
  markKind: 'shape',
  gradientKind: 'linear',
  source: 'manual',
  frozenStopsStored: [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ],
  frozenHash: 'hash',
  binding: { kind: 'def', defId: 11, slot: 7 },
  ...overrides,
});

describe('resolveColorCycleShapeFillSourceOptions', () => {
  it('forwards manual bindings without sampled-only options', () => {
    const renderSession = makeSession({
      source: 'manual',
      binding: { kind: 'def', defId: 31, slot: 12 },
    });

    expect(resolveColorCycleShapeFillSourceOptions({
      session: renderSession,
      renderSession,
    })).toEqual({
      ditherSampledStops: undefined,
      ditherBaseOffsetOverride: undefined,
      paintSlotOverride: 12,
      paintDefIdOverride: 31,
      shapePhaseSeedMarkId: 'mark-1',
    });
  });

  it('isolates sampled stops and base offset to sampled render sessions', () => {
    const renderSession = makeSession({
      source: 'sampled',
      frozenStopsStored: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
      binding: { kind: 'def', defId: 41, slot: 15 },
    });

    const options = resolveColorCycleShapeFillSourceOptions({
      session: renderSession,
      renderSession,
    });

    expect(options).toEqual({
      ditherSampledStops: [
        { position: 0, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
      ditherBaseOffsetOverride: 0,
      paintSlotOverride: 15,
      paintDefIdOverride: 41,
      shapePhaseSeedMarkId: 'mark-1',
    });
    expect(options.ditherSampledStops).not.toBe(renderSession.frozenStopsStored);
  });

  it('uses sampled source stops when a sampled render session has a reduced render palette', () => {
    const sourceStops = [
      { position: 0, color: '#112233' },
      { position: 0.33, color: '#445566' },
      { position: 0.66, color: '#778899' },
      { position: 1, color: '#ddeeff' },
    ];
    const renderSession = makeSession({
      source: 'sampled',
      frozenStopsStored: [
        { position: 0, color: '#112233' },
        { position: 0.5, color: '#112233' },
        { position: 1, color: '#ddeeff' },
      ],
      binding: { kind: 'def', defId: 41, slot: 15 },
    }) as ReturnType<typeof makeSession> & { sourceStopsStored: typeof sourceStops };
    renderSession.sourceStopsStored = sourceStops;

    const options = resolveColorCycleShapeFillSourceOptions({
      session: renderSession,
      renderSession,
    });

    expect(options.ditherSampledStops).toEqual(sourceStops);
    expect(options.ditherSampledStops).not.toBe(sourceStops);
    expect(options.ditherSampledStops).not.toBe(renderSession.frozenStopsStored);
  });

  it('handles fallback or missing render sessions without inventing source data', () => {
    expect(resolveColorCycleShapeFillSourceOptions({
      session: null,
      renderSession: null,
    })).toEqual({
      ditherSampledStops: undefined,
      ditherBaseOffsetOverride: undefined,
      paintSlotOverride: undefined,
      paintDefIdOverride: undefined,
      shapePhaseSeedMarkId: null,
    });
  });
});
