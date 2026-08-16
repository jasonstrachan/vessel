import {
  resolveInterlaceFrame,
  resolveInterlaceMaskRectangles,
  resolveInterlaceTileMetrics,
  resolveSierraTravelFrame,
  rollSierraLiteBinaryField,
  resolveSierraLiteBinaryField,
} from '@/lib/colorCycle/gobletPlaybackMath';
import { fillFlatPatternMode } from '@/utils/colorCycle/ccFlatModePatterns';

describe('Interlace Sierra Lite playback', () => {
  it('uses the exact Color Cycle flat-fill Sierra Lite field', () => {
    const written = new Uint8Array(8 * 6);
    fillFlatPatternMode({
      algorithm: 'sierra-lite',
      tone: 0.5,
      flatLowIndex: 20,
      flatHighIndex: 200,
      flatMix: 0.37,
      flatSeed: 8128,
      ditherPatternDiversity: 100,
      gridW: 8,
      gridH: 6,
      fillBackground: true,
      baseOffset: 0,
      phaseX: 3,
      phaseY: -2,
      writeCellIndex: (index, value) => { written[index] = value; },
    });
    const field = resolveSierraLiteBinaryField({
      width: 8,
      height: 6,
      mix: 0.37,
      seed: 8128,
      phaseX: 3,
      phaseY: -2,
      identityKey: 0,
      lowKey: 20,
      highKey: 200,
      diversity: 1,
    });

    expect(Array.from(written, (value) => value === 200 ? 1 : 0)).toEqual(Array.from(field));
  });

  it('uses per-cell mix values without moving the Sierra Lite lattice', () => {
    const mixField = new Float32Array([
      0, 1, 0, 1,
      1, 0, 1, 0,
    ]);
    const field = resolveSierraLiteBinaryField({
      width: 4,
      height: 2,
      mix: 0.5,
      seed: 8128,
      diversity: 1,
      mixField,
    });

    expect(field).toEqual(new Uint8Array(mixField));
  });

  it('keeps exact low and high endpoints solid at full Variety', () => {
    const low = resolveSierraLiteBinaryField({
      width: 64,
      height: 64,
      mix: 0,
      seed: 8128,
      diversity: 1,
    });
    const high = resolveSierraLiteBinaryField({
      width: 64,
      height: 64,
      mix: 1,
      seed: 8128,
      diversity: 1,
    });

    expect(low.every((value) => value === 0)).toBe(true);
    expect(high.every((value) => value === 1)).toBe(true);
  });

  it('produces the exact seed-free registered interruption at zero Variety', () => {
    const width = 64;
    const height = 64;
    const field = resolveSierraLiteBinaryField({
      width,
      height,
      mix: 0.5,
      seed: 8128,
      diversity: 0,
    });

    const rowPhases = [
      1, 1, 0, 1,
      0, 1, 1, 0,
      1, 1, 0, 1,
      1, 0, 1, 0,
    ];
    const expected = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        expected[y * width + x] = (x + rowPhases[y % rowPhases.length]) & 1;
      }
    }

    expect(field).toEqual(expected);
    expect(field).toEqual(resolveSierraLiteBinaryField({
      width,
      height,
      mix: 0.5,
      seed: 101,
      diversity: 0,
    }));
  });

  it('preserves the requested tone at every positive Variety', () => {
    const width = 128;
    const height = 128;
    const render = (mix: number, diversity: number) => resolveSierraLiteBinaryField({
      width,
      height,
      mix,
      seed: 8128,
      diversity,
    });
    const occupancy = (field: Uint8Array) =>
      field.reduce((sum, bit) => sum + bit, 0) / field.length;

    const lowNearZero = render(0.25, 0.01);
    const lowFull = render(0.25, 1);
    const highNearZero = render(0.75, 0.01);
    const highFull = render(0.75, 1);

    expect(lowNearZero).toEqual(lowFull);
    expect(highNearZero).toEqual(highFull);
    expect(occupancy(lowFull)).toBeCloseTo(0.25, 2);
    expect(occupancy(highFull)).toBeCloseTo(0.75, 2);
  });

  it('uses the canonical Sierra Lite raster kernel above zero Variety', () => {
    const field = resolveSierraLiteBinaryField({
      width: 8,
      height: 8,
      mix: 0.37,
      diversity: 1,
    });

    expect(field).toEqual(new Uint8Array([
      0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 1, 0, 1,
      0, 1, 0, 1, 0, 0, 1, 0,
      0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 0, 1, 0,
      0, 1, 0, 1, 0, 1, 0, 1,
    ]));
  });

  it('turns dominance into pulse width while keeping the lattice anchored', () => {
    const neighbourSlits = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.14,
    });
    const dominantPose = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.86,
    });

    expect(neighbourSlits[0]).toMatchObject({ x: 0, y: 0, width: 4.48, height: 16 });
    expect(dominantPose[0]).toMatchObject({ x: 0, y: 0, width: 27.52, height: 16 });
    expect(neighbourSlits[1].x).toBe(32);
    expect(dominantPose[1].x).toBe(32);
  });

  it('forms square checker cells with alternate rows offset by one cell at the midpoint', () => {
    const rectangles = resolveInterlaceMaskRectangles({
      width: 64,
      height: 32,
      cellSize: 16,
      mix: 0.5,
    });

    expect(rectangles).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 32, y: 0, width: 16, height: 16 },
      { x: 16, y: 16, width: 16, height: 16 },
      { x: 48, y: 16, width: 16, height: 16 },
    ]);
  });

  it('repeats five square rows followed by one four-times-taller row', () => {
    const rectangles = resolveInterlaceMaskRectangles({
      width: 256,
      height: 144,
      cellSize: 16,
      mix: 0.5,
    });
    const firstByY = new Map<number, (typeof rectangles)[number]>();
    for (const rectangle of rectangles) {
      if (!firstByY.has(rectangle.y)) firstByY.set(rectangle.y, rectangle);
    }

    expect(Array.from(firstByY.values())).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 16, y: 16, width: 16, height: 16 },
      { x: 0, y: 32, width: 16, height: 16 },
      { x: 16, y: 48, width: 16, height: 16 },
      { x: 0, y: 64, width: 16, height: 16 },
      { x: 16, y: 80, width: 16, height: 64 },
    ]);
  });

  it('reverses the horizontal phase without moving the cell lattice vertically', () => {
    const right = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.5,
      motionPixels: 8,
    });
    const left = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.5,
      motionPixels: -8,
    });

    expect(right[0]).toEqual({ x: 8, y: 0, width: 16, height: 16 });
    expect(left[0]).toEqual({ x: 0, y: 0, width: 8, height: 16 });
    expect(left[1]).toEqual({ x: 24, y: 0, width: 16, height: 16 });
  });

  it('mirrors fixed-mask direction without translating the registered pattern', () => {
    const right = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.25,
    });
    const left = resolveInterlaceMaskRectangles({
      width: 64,
      height: 16,
      cellSize: 16,
      mix: 0.25,
      mirrorX: true,
    });

    expect(right).toEqual([
      { x: 0, y: 0, width: 8, height: 16 },
      { x: 32, y: 0, width: 8, height: 16 },
    ]);
    expect(left).toEqual([
      { x: 56, y: 0, width: 8, height: 16 },
      { x: 24, y: 0, width: 8, height: 16 },
    ]);
  });

  it('hands the dominant pose to the next pair without a spatial jump', () => {
    const outgoingHighPose = resolveInterlaceMaskRectangles({
      width: 32,
      height: 16,
      cellSize: 16,
      mix: 0.86,
      phaseCycles: 0.14,
    });
    const incomingHighMask = resolveInterlaceMaskRectangles({
      width: 32,
      height: 16,
      cellSize: 16,
      mix: 0.14,
      phaseCycles: 0,
    });

    expect(outgoingHighPose).toHaveLength(1);
    expect(outgoingHighPose[0].x).toBeCloseTo(4.48);
    expect(outgoingHighPose[0].width).toBeCloseTo(27.52);
    expect(incomingHighMask).toEqual([{ x: 0, y: 0, width: 4.48, height: 16 }]);
  });

  it('ripples pose coverage through successive rows during a transition', () => {
    const rectangles = resolveInterlaceMaskRectangles({
      width: 64,
      height: 144,
      cellSize: 16,
      mix: 0.5,
      patternPreset: 'ripple',
      transitionProgress: 0.5,
    });
    const firstByY = new Map<number, (typeof rectangles)[number]>();
    rectangles.forEach((rectangle) => {
      if (!firstByY.has(rectangle.y)) firstByY.set(rectangle.y, rectangle);
    });
    const bands = Array.from(firstByY.values());

    expect(bands[0].width).toBeCloseTo(16);
    expect(bands[1].width).toBeLessThan(bands[0].width);
    expect(bands[4].width).toBeGreaterThan(bands[0].width);
  });

  it('moves alternating rows in opposite directions for Counterflow', () => {
    const rectangles = resolveInterlaceMaskRectangles({
      width: 64,
      height: 32,
      cellSize: 16,
      mix: 0.5,
      patternPreset: 'counterflow',
      transitionProgress: 0.5,
    });
    const firstByY = new Map<number, (typeof rectangles)[number]>();
    rectangles.forEach((rectangle) => {
      if (!firstByY.has(rectangle.y)) firstByY.set(rectangle.y, rectangle);
    });
    const bands = Array.from(firstByY.values());

    expect(bands[0].x).not.toBe(bands[1].x);
    expect(bands[0].x).toBeGreaterThan(0);
    expect(bands[1].x).toBeGreaterThan(0);
  });

  it('combines coverage breathing and row motion in Hypnotic', () => {
    const hypnotic = resolveInterlaceMaskRectangles({
      width: 64,
      height: 32,
      cellSize: 16,
      mix: 0.5,
      patternPreset: 'hypnotic',
      transitionProgress: 0.5,
    });
    const classic = resolveInterlaceMaskRectangles({
      width: 64,
      height: 32,
      cellSize: 16,
      mix: 0.5,
      transitionProgress: 0.5,
    });

    expect(hypnotic).not.toEqual(classic);
    expect(hypnotic.some((rectangle) => Math.abs(rectangle.width - 16) > 0.1)).toBe(true);
    expect(hypnotic.some((rectangle) => Math.abs(rectangle.x % 16) > 0.1)).toBe(true);
  });

  it('sizes one Sierra plate to the artwork plus a full period of side overscan', () => {
    const metrics = resolveInterlaceTileMetrics({
      documentWidth: 384,
      documentHeight: 432,
      cellSize: 16,
      patternPreset: 'sierra-travel',
    });
    expect(metrics).toMatchObject({
      tileWidth: 768,
      tileHeight: 432,
      cellWidth: 16,
      cellHeight: 16,
      columnCount: 48,
      rowCount: 20,
      travelPeriodPixels: 192,
      overscanPixels: 192,
    });
  });

  it('applies export scaling once when sizing the full Sierra plate', () => {
    const metrics = resolveInterlaceTileMetrics({
      documentWidth: 160,
      documentHeight: 96,
      cellSize: 16,
      scaleX: 2,
      scaleY: 0.5,
      patternPreset: 'sierra-travel',
    });

    expect(metrics).toMatchObject({
      tileWidth: 1088,
      tileHeight: 48,
      cellWidth: 32,
      cellHeight: 8,
      travelPeriodPixels: 384,
      overscanPixels: 384,
    });
  });

  it('returns one complete immutable Sierra plate independent of animation state', () => {
    const options = {
      width: 128,
      height: 48,
      cellSize: 16,
      cellHeight: 16,
      mix: 0.5,
      patternPreset: 'sierra-travel' as const,
      seed: 0,
    };

    const registered = resolveInterlaceMaskRectangles(options);
    const duringTravel = resolveInterlaceMaskRectangles({
      ...options,
      motionPixels: 71.25,
      mirrorX: true,
      transitionProgress: 0.63,
    });

    expect(registered).toEqual([
      { x: 32, y: 0, width: 32, height: 32 },
      { x: 96, y: 0, width: 32, height: 32 },
      { x: 0, y: 32, width: 16, height: 16 },
      { x: 32, y: 32, width: 16, height: 16 },
      { x: 64, y: 32, width: 16, height: 16 },
      { x: 96, y: 32, width: 16, height: 16 },
    ]);
    expect(duringTravel).toEqual(registered);
  });

  it('moves the whole Sierra sheet fractionally in the selected horizontal direction', () => {
    const right = resolveSierraTravelFrame({
      elapsedSeconds: 2.5,
      traversalDurationSeconds: 10,
      travelPeriodPixels: 192,
      direction: 'right',
    });
    const left = resolveSierraTravelFrame({
      elapsedSeconds: 2.5,
      traversalDurationSeconds: 10,
      travelPeriodPixels: 192,
      direction: 'left',
    });
    const nextPixelFraction = resolveSierraTravelFrame({
      elapsedSeconds: 2.501,
      traversalDurationSeconds: 10,
      travelPeriodPixels: 192,
      direction: 'right',
    });

    expect(right).toMatchObject({ baseIndex: 0, revealIndex: 1, sheetOffsetPixels: 48 });
    expect(left.sheetOffsetPixels).toBe(-48);
    expect(nextPixelFraction.sheetOffsetPixels - right.sheetOffsetPixels).toBeCloseTo(0.0192);
  });

  it('returns to the identical registered sheet and source pair at the loop boundary', () => {
    const options = {
      traversalDurationSeconds: 10,
      travelPeriodPixels: 192,
      travelCycles: 1,
      direction: 'right' as const,
    };
    const start = resolveSierraTravelFrame({ ...options, elapsedSeconds: 0 });
    const wrapped = resolveSierraTravelFrame({ ...options, elapsedSeconds: 10 });

    expect(wrapped).toEqual({
      ...start,
      traversalIndex: 1,
    });
    expect(start.sheetOffsetPixels).toBe(0);
  });

  it.each(['ripple', 'counterflow', 'hypnotic'] as const)('%s returns to Classic geometry at pose handoffs', (patternPreset) => {
    const classic = resolveInterlaceMaskRectangles({
      width: 64,
      height: 144,
      cellSize: 16,
      mix: 0.14,
    });
    const atHandoff = resolveInterlaceMaskRectangles({
      width: 64,
      height: 144,
      cellSize: 16,
      mix: 0.14,
      patternPreset,
      transitionProgress: 0,
    });

    expect(atHandoff).toEqual(classic);
  });

  it('returns to the identical source pair, mix, and pattern phase at the loop boundary', () => {
    const atStart = resolveInterlaceFrame({
      elapsedSeconds: 0,
      sourceCount: 3,
      loopDurationSeconds: 10,
      dominance: 0.92,
      direction: 'right',
      travelCycles: 1,
      gridWidth: 60,
    });
    const atBoundary = resolveInterlaceFrame({
      elapsedSeconds: 10,
      sourceCount: 3,
      loopDurationSeconds: 10,
      dominance: 0.92,
      direction: 'right',
      travelCycles: 1,
      gridWidth: 60,
    });

    expect(atBoundary).toEqual(atStart);
    expect(atStart).toMatchObject({
      currentIndex: 0,
      nextIndex: 1,
      motionCells: 0,
      pairProgress: 0,
    });
    expect(atStart.mix).toBeCloseTo(0.08);
  });

  it('moves rows horizontally with a wrapped integer-cell roll', () => {
    const row = new Uint8Array([1, 0, 0, 1]);
    expect(Array.from(rollSierraLiteBinaryField(row, 4, 1, 1))).toEqual([1, 1, 0, 0]);
    expect(Array.from(rollSierraLiteBinaryField(row, 4, 1, -1))).toEqual([0, 0, 1, 1]);
    expect(rollSierraLiteBinaryField(row, 4, 1, 4)).toBe(row);
  });

  it('reports fractional cell travel so the renderer can move without block jumps', () => {
    const frame = resolveInterlaceFrame({
      elapsedSeconds: 0.25,
      sourceCount: 3,
      loopDurationSeconds: 10,
      dominance: 0.92,
      direction: 'right',
      travelCycles: 1,
      gridWidth: 64,
    });

    expect(frame.motionCells).toBeCloseTo(1.6);
  });
});
