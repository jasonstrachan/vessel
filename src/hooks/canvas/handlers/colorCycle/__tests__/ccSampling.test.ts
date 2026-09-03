import {
  CC_SAMPLED_MAX_STOPS,
  remapSampledStrokePaintPhase,
  resolveSampledStopsWithFallback,
  updateCcSampledSession,
} from '../ccSampling';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
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
    expect(session.previewStopsStored).toEqual(result?.stops);
    expect(new Set(result?.stops.map((stop) => stop.color)).size).toBe(2);
    expect(result?.stops[0]?.color).not.toBe('#112233');
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
    expect(session.sampledStrokePoints).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it('maps one sampled gradient continuously across a stroke longer than 255 stamps', () => {
    const width = 300;
    const paint = new Uint8Array(width);
    const gradientIds = new Uint8Array(width).fill(TEMP_SAMPLE_SLOT);
    for (let x = 0; x < width; x += 1) {
      paint[x] = 1 + (x % 255);
    }
    gradientIds[150] = 7;
    const speedBuffer = new Uint8Array(width).fill(27).buffer;
    const flowBuffer = new Uint8Array(width).fill(1).buffer;
    const phaseBuffer = new Uint8Array(width).buffer;

    const remapped = remapSampledStrokePaintPhase({
      snapshot: {
        paintBuffer: paint.buffer,
        gradientIdBuffer: gradientIds.buffer,
        speedBuffer,
        flowBuffer,
        phaseBuffer,
      },
      width,
      height: 1,
      points: [
        { x: 0.5, y: 0.5 },
        { x: 299.5, y: 0.5 },
      ],
      targetSlot: TEMP_SAMPLE_SLOT,
      region: { x: 0, y: 0, width, height: 1 },
      pathPadding: 1,
    });

    const nextPaint = new Uint8Array(remapped?.paintBuffer ?? new ArrayBuffer(0));
    expect(nextPaint[0]).toBe(1);
    expect(nextPaint[254]).toBe(217);
    expect(nextPaint[255]).toBe(218);
    expect(nextPaint[299]).toBe(255);
    expect(nextPaint[150]).toBe(paint[150]);
    expect(remapped?.speedBuffer).toBe(speedBuffer);
    expect(remapped?.flowBuffer).toBe(flowBuffer);
    expect(remapped?.phaseBuffer).toBe(phaseBuffer);
  });

  it('preserves the stamp dither pattern while remapping sampled stroke phase', () => {
    const width = 4;
    const primary = new Uint8Array([10, 10, 20, 20]);
    const paint = new Uint8Array([10, 74, 20, 84]);
    const gradientIds = new Uint8Array(width).fill(TEMP_SAMPLE_SLOT);

    const remapped = remapSampledStrokePaintPhase({
      snapshot: {
        paintBuffer: paint.buffer,
        gradientIdBuffer: gradientIds.buffer,
      },
      width,
      height: 1,
      points: [
        { x: 0.5, y: 0.5 },
        { x: 3.5, y: 0.5 },
      ],
      targetSlot: TEMP_SAMPLE_SLOT,
      region: { x: 0, y: 0, width, height: 1 },
      pathPadding: 1,
      ditherPrimaryBuffer: primary,
    });

    expect(Array.from(new Uint8Array(remapped?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1,
      150,
      170,
      64,
    ]);
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

  it('uses dense sampled-gradient stops instead of the generic six-stop auto-sample cap', () => {
    const session = makeSession();
    const lastUpdateRef = { current: 0 };

    const result = updateCcSampledSession({
      session,
      sourcePts: [
        { x: 0, y: 0 },
        { x: 640, y: 0 },
      ],
      now: 200,
      lastUpdateRef,
      sampleColor: (x) => {
        const value = Math.max(0, Math.min(255, Math.round(x / 640 * 255)));
        return `rgb(${value}, ${value}, ${value})`;
      },
      allowTiny: true,
    });

    expect(result?.sampleCount).toBe(CC_SAMPLED_MAX_STOPS);
    expect(result?.stops).toHaveLength(CC_SAMPLED_MAX_STOPS);
    expect(session.samples).toHaveLength(CC_SAMPLED_MAX_STOPS);
  });

  it.each(['hard', 'soft'] as const)(
    'retains the %s seam profile while sampled stops update',
    (seamProfile) => {
      const session = makeSession();
      session.seamProfile = seamProfile;

      updateCcSampledSession({
        session,
        sourcePts: [
          { x: 0, y: 0 },
          { x: 64, y: 0 },
        ],
        now: 200,
        lastUpdateRef: { current: 0 },
        sampleColor: (x) => (x < 32 ? '#112233' : '#ddeeff'),
        allowTiny: true,
      });

      expect(session.seamProfile).toBe(seamProfile);
    },
  );

  it('preserves fallback stops when sampled stops collapse to one color', () => {
    const fallbackStops = [
      { position: 0, color: '#000000' },
      { position: 0.5, color: '#888888' },
      { position: 1, color: '#ffffff' },
    ];

    const result = resolveSampledStopsWithFallback({
      sampledStops: [
        { position: 0, color: '#000000' },
        { position: 0.5, color: '#000000' },
        { position: 1, color: '#000000' },
      ],
      sampleCount: 3,
      fallbackStops,
    });

    expect(result.stops).toBe(fallbackStops);
    expect(result.usedFallbackStops).toBe(true);
    expect(result.sampledUniqueColors).toBe(1);
    expect(result.fallbackUniqueColors).toBe(3);
  });

  it('keeps varied sampled stops instead of fallback stops', () => {
    const sampledStops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#445566' },
    ];

    const result = resolveSampledStopsWithFallback({
      sampledStops,
      sampleCount: 2,
      fallbackStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });

    expect(result.stops).toBe(sampledStops);
    expect(result.usedFallbackStops).toBe(false);
  });
});
