import { buildSampledPathStroke, sampleFixedPathBands } from '../sampledPathStroke';
import { decodeSampledPathColors, renderSampledPathPalette } from '@/lib/colorCycle/sampledPathPalette';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

const sourceAt = (x: number) => `rgb(${Math.floor(x) % 251},${Math.floor(x / 3) % 241},${Math.floor(x / 7) % 239})`;
const build = (length: number, spacing: number) => {
  const stops = sampleFixedPathBands([{ x: 0, y: 0 }, { x: length - 1, y: 0 }], spacing, sourceAt);
  const result = buildSampledPathStroke({
    snapshot: { paintBuffer: new Uint8Array(length).fill(1).buffer,
      gradientIdBuffer: new Uint8Array(length).fill(254).buffer },
    ownership: { epoch: 1, tags: Uint32Array.from({ length }, (_, i) => 65537 + i),
      primary: new Uint8Array(length).fill(1), distances: [0, ...Array.from({ length }, (_, i) => i)] },
    bandPx: spacing, primary: stops, definitions: [], speedByte: 17,
  });
  return { ...result, stops };
};
const render = (result: ReturnType<typeof build>, phase: number) => {
  const palettes = new Map(result.definitions.map(def => {
    const rgba = new Uint8ClampedArray(1024);
    renderSampledPathPalette(decodeSampledPathColors(def.sampledPath!.rgba), def.sampledPath!.offset, phase, rgba);
    return [def.id, rgba];
  }));
  const defs = new Uint16Array(result.snapshot.gradientDefIdBuffer!);
  return Array.from(new Uint8Array(result.snapshot.paintBuffer), (index, i) =>
    index ? [...palettes.get(defs[i])!.slice((index - 1) * 4, index * 4)] : [0, 0, 0, 0]);
};

it.each([1, 4, 20])('matches the reference at Resolve with %s px bands beyond 255 source positions', spacing => {
  const long = build(6000, spacing);
  const pixels = render(long, 0);
  for (let x = 0; x < pixels.length; x++) {
    const centre = Math.min(5999, (Math.floor(x / spacing) + 0.5) * spacing);
    expect(pixels[x]).toEqual(parseCssColorToRgba(sourceAt(centre)));
  }
});

it.each([1, 4, 20])('extending a stroke preserves both its resolved source and %s px band boundaries', spacing => {
  const short = build(1024, spacing), long = build(2048, spacing);
  const a = render(short, 0), b = render(long, 0);
  // Exclude the last partially covered band, whose centre is clamped at the endpoint.
  const completeLength = Math.floor(1023 / spacing) * spacing;
  expect(b.slice(0, completeLength)).toEqual(a.slice(0, completeLength));
  for (let x = 1; x < b.length; x++) {
    if (x % spacing !== 0) expect(b[x]).toEqual(b[x - 1]);
  }
});

it('moves the full ordered sequence across palette sections and returns exactly to Resolve', () => {
  const stroke = build(1024, 1);
  const resolved = render(stroke, 0);
  // A quarter turn shifts by 256 source bands, crossing a 255-band section.
  const moved = render(stroke, 0.25);
  expect(moved).toEqual(resolved.map((_, i) => resolved[(i - 256 + 1024) % 1024]));
  expect(render(stroke, 1)).toEqual(resolved);
});

it('preserves unrelated and transparent pixels while binding both inks to the same source band', () => {
  const result = buildSampledPathStroke({
    snapshot: { paintBuffer: new Uint8Array([20, 84, 0, 9]).buffer,
      gradientIdBuffer: new Uint8Array([254, 254, 254, 3]).buffer,
      phaseBuffer: new Uint8Array([0, 0, 77, 99]).buffer },
    ownership: { epoch: 1, tags: new Uint32Array([65537, 65537, 65537, 131073]),
      primary: new Uint8Array([20, 20, 20, 20]), distances: [0, 0] },
    bandPx: 1, primary: [{ position: 0, color: '#202020' }],
    secondary: [{ position: 0, color: '#a0a0a0' }], definitions: [], speedByte: 17,
  });
  expect([...new Uint8Array(result.snapshot.paintBuffer)]).toEqual([1, 1, 0, 9]);
  expect([...new Uint16Array(result.snapshot.gradientDefIdBuffer!)]).toEqual([1, 2, 0, 0]);
  expect([...new Uint8Array(result.snapshot.phaseBuffer!)]).toEqual([0, 0, 77, 99]);
});

it('renders section indices through the native CPU renderer without cycling each section again', async () => {
  const { Renderer2D } = await import('@/lib/colorCycle/Renderer2D');
  const stroke = build(1024, 1);
  const palettes = new Map(stroke.definitions.map(def => {
    const rgba = new Uint8ClampedArray(1024);
    renderSampledPathPalette(decodeSampledPathColors(def.sampledPath!.rgba), def.sampledPath!.offset, 0.25, rgba);
    return [def.id, new Uint32Array(rgba.buffer)];
  }));
  const renderer = new Renderer2D({ width: 1024, height: 1 });
  try {
    renderer.render({ indexData: new Uint8Array(stroke.snapshot.paintBuffer),
      gradientIdData: new Uint8Array(stroke.snapshot.gradientIdBuffer!),
      defIdData: new Uint16Array(stroke.snapshot.gradientDefIdBuffer!),
      speedData: new Uint8Array(stroke.snapshot.speedBuffer!), flowData: new Uint8Array(stroke.snapshot.flowBuffer!),
      phaseData: new Uint8Array(stroke.snapshot.phaseBuffer!), defPalettesById: palettes,
      paletteSlots: [], basePalette: new Uint32Array(256), phase: 0.25,
      baseOffset: 0, baseTime: 4, flowMode: 'forward' });
    const expected = render(stroke, 0.25).flat();
    expect([...renderer.getImageData().data]).toEqual(expected);
  } finally { renderer.cleanup(); }
});

it('animates the stored source through the native palette cache and returns to the resolved reference', async () => {
  const { ColorCycleAnimator } = await import('@/lib/ColorCycleAnimator');
  const { createDefPaletteCache } = await import('@/hooks/brushEngine/colorCycleDefPaletteCache');
  const { decodeColorCycleSpeedByte } = await import('@/utils/colorCycleSpeed');
  const stroke = build(1024, 1);
  const animator = new ColorCycleAnimator({ width: 1024, height: 1, forceCanvas2D: true });
  try {
    const snapshot = stroke.snapshot;
    animator.setIndexBufferFromArray(new Uint8Array(snapshot.paintBuffer),
      new Uint8Array(snapshot.gradientIdBuffer!), new Uint8Array(snapshot.speedBuffer!),
      new Uint8Array(snapshot.flowBuffer!), new Uint8Array(snapshot.phaseBuffer!));
    animator.setDefIdData(new Uint16Array(snapshot.gradientDefIdBuffer!));
    animator.setDefPaletteCache(createDefPaletteCache(stroke.definitions, 1));
    const runtime = animator as unknown as { renderFrame(offset: number, seconds: number): void };
    for (const phase of [0, 0.25, 0.73, 1, 0]) {
      runtime.renderFrame(0, phase / decodeColorCycleSpeedByte(17));
      expect([...animator.getImageData().data]).toEqual(render(stroke, phase).flat());
    }
  } finally { animator.cleanup(); }
});

it.each([1, 4, 20])('samples the actual pixel-snapped turning path at %s px without accumulating reference drift', async spacing => {
  const { applyStampDitherStamp, createStampDitherRuntime } = await import('@/hooks/brushEngine/strokeStampDither');
  const width = 256, height = 256;
  const paint = new Uint8Array(width * height);
  const gid = new Uint8Array(paint.length);
  const speed = new Uint8Array(paint.length);
  const state: import('@/hooks/brushEngine/strokeStampDither/state').StampDitherStrokeData = {
    paint, gradientIdBuffer: gid, stampDitherStrokeEpoch: 1,
  };
  const animator = {
    beginDirectFill: () => ({ data: paint, gradientId: gid, speedData: speed, width, height }),
    endDirectFill: jest.fn(), markDirtyBounds: jest.fn(), hasWebGL: () => false,
  } as unknown as Parameters<typeof applyStampDitherStamp>[0]['animator'];
  const runtime = createStampDitherRuntime();
  for (let turn = 0; turn < 12; turn++) {
    for (let step = 0; step < 180; step++) {
      // The real draw controller snaps resampled pointer positions to pixels.
      const x = Math.round(8 + turn * 19 + step * 0.04);
      const y = Math.round(turn % 2 ? 200 - step : 20 + step);
      applyStampDitherStamp({ animator, state, runtime,
        config: { algorithm: 'sierra-lite', pixelSize: 1, bgFill: true, pressureLinked: false, diversity: 0, seed: 0 },
        stampShape: 'diamond', x, y, pressure: 1, pressureSize: 3,
        primaryIndex: 1, flowSlot: 254, cycleSpeed: 0.1, width, height, isAnimating: false });
    }
  }
  const referenceAt = (_x: number, y: number) => Math.floor(y / 80) % 2 ? '#cccccc' : '#222222';
  const stops = sampleFixedPathBands(state.stampSourcePoints!, spacing, referenceAt);
  const stroke = buildSampledPathStroke({ snapshot: { paintBuffer: paint.buffer, gradientIdBuffer: gid.buffer },
    ownership: { tags: state.stampDitherTag!, epoch: 1, primary: state.stampDitherPrimaryBuffer!,
      distances: state.stampSourceDistances }, bandPx: spacing, primary: stops, definitions: [], speedByte: 17 });
  const pixels = render({ ...stroke, stops }, 0);
  let checked = 0;
  for (let i = 0; i < paint.length; i++) {
    const y = Math.floor(i / width);
    if (!paint[i] || y % 80 < 24 || y % 80 > 56) continue;
    expect(pixels[i][0]).toBe(Math.floor(y / 80) % 2 ? 204 : 34);
    checked++;
  }
  expect(checked).toBeGreaterThan(500);
});
