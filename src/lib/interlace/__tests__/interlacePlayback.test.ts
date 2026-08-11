import {
  resolveInterlaceFrame,
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

  it('is deterministic and changes only when an input changes', () => {
    const options = { width: 12, height: 9, mix: 0.41, seed: 44, phaseX: 2 };
    expect(resolveSierraLiteBinaryField(options)).toEqual(resolveSierraLiteBinaryField(options));
    expect(resolveSierraLiteBinaryField(options)).not.toEqual(
      resolveSierraLiteBinaryField({ ...options, phaseX: 3 }),
    );
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
    expect(atStart).toMatchObject({ currentIndex: 0, nextIndex: 1, motionCells: 0 });
    expect(atStart.mix).toBeCloseTo(0.08);
  });

  it('moves rows horizontally with a wrapped integer-cell roll', () => {
    const row = new Uint8Array([1, 0, 0, 1]);
    expect(Array.from(rollSierraLiteBinaryField(row, 4, 1, 1))).toEqual([1, 1, 0, 0]);
    expect(Array.from(rollSierraLiteBinaryField(row, 4, 1, -1))).toEqual([0, 0, 1, 1]);
    expect(rollSierraLiteBinaryField(row, 4, 1, 4)).toBe(row);
  });
});
