import type { PatternStyle } from '@/utils/ditherAlgorithms';

const mod = (value: number, modulo: number): number => ((value % modulo) + modulo) % modulo;
const hashPatternCell = (x: number, y: number): number => ((x * 73856093) ^ (y * 19349663)) >>> 0;

type CcImageTileThresholdResolver = (x: number, y: number) => number | null;

let ccImageTileThresholdResolver: CcImageTileThresholdResolver | null = null;
const scopedCcImageTileThresholdResolvers: CcImageTileThresholdResolver[] = [];

export const setCcImageTileThresholdResolver = (
  resolver: CcImageTileThresholdResolver | null
): void => {
  ccImageTileThresholdResolver = resolver;
};

export const withCcImageTileThresholdResolver = <T>(
  resolver: CcImageTileThresholdResolver | null | undefined,
  callback: () => T
): T => {
  if (!resolver) {
    return callback();
  }
  scopedCcImageTileThresholdResolvers.push(resolver);
  const popResolver = () => {
    scopedCcImageTileThresholdResolvers.pop();
  };
  try {
    const result = callback();
    const maybePromise = result as unknown as Promise<unknown>;
    if (result && typeof maybePromise.then === 'function') {
      return maybePromise.finally(popResolver) as T;
    }
    popResolver();
    return result;
  } catch (error) {
    popResolver();
    throw error;
  }
};

const ASCII_PATTERN_CELL_WIDTH = 5;
const ASCII_PATTERN_CELL_HEIGHT = 7;
const ASCII_PATTERN_GLYPHS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    '00000',
    '00000',
    '01110',
    '00000',
    '00000',
    '00000',
    '00000',
  ],
  [
    '10001',
    '10001',
    '01010',
    '00100',
    '01010',
    '10001',
    '10001',
  ],
  [
    '11111',
    '10000',
    '11110',
    '00001',
    '00001',
    '10001',
    '01110',
  ],
  [
    '00100',
    '01100',
    '10100',
    '11111',
    '00100',
    '00100',
    '00100',
  ],
];

export const resolveCcPatternThreshold = (
  patternStyle: PatternStyle | undefined,
  x: number,
  y: number,
  tone?: number
): number => {
  const style = patternStyle ?? 'dots';
  switch (style) {
    case 'dots': {
      const dotSize = 4;
      const localX = mod(x, dotSize);
      const localY = mod(y, dotSize);
      const dx = Math.min(localX, dotSize - localX);
      const dy = Math.min(localY, dotSize - localY);
      const distance = Math.sqrt(dx * dx + dy * dy) / (dotSize / 2);
      return Math.min(1, distance);
    }
    case 'lines': {
      const spacing = 4;
      return mod(x + y, spacing) / spacing;
    }
    case 'vertical-lines': {
      const spacing = 4;
      return mod(x, spacing) / spacing;
    }
    case 'horizontal-lines': {
      const spacing = 4;
      return mod(y, spacing) / spacing;
    }
    case 'crosshatch': {
      const spacing = 4;
      const vertical = mod(x, spacing) / spacing;
      const horizontal = mod(y, spacing) / spacing;
      return Math.min(vertical, horizontal);
    }
    case 'diagonal': {
      const spacing = 8;
      const dx = Math.abs(mod(x, spacing) - spacing / 2);
      const dy = Math.abs(mod(y, spacing) - spacing / 2);
      return (dx + dy) / spacing;
    }
    case 'ascii': {
      const cellX = Math.floor(x / ASCII_PATTERN_CELL_WIDTH);
      const cellY = Math.floor(y / ASCII_PATTERN_CELL_HEIGHT);
      const glyph = ASCII_PATTERN_GLYPHS[
        hashPatternCell(cellX, cellY) % ASCII_PATTERN_GLYPHS.length
      ];
      const glyphX = mod(x, ASCII_PATTERN_CELL_WIDTH);
      const glyphY = mod(y, ASCII_PATTERN_CELL_HEIGHT);
      return glyph[glyphY][glyphX] === '1' ? 0.12 : 0.88;
    }
    case 'image-tile': {
      const scopedResolver =
        scopedCcImageTileThresholdResolvers[scopedCcImageTileThresholdResolvers.length - 1];
      return scopedResolver?.(x, y) ?? ccImageTileThresholdResolver?.(x, y) ?? 0.5;
    }
    case 'tone-adaptive': {
      if (!Number.isFinite(tone)) {
        const selector = hashPatternCell(Math.floor(x / 4), Math.floor(y / 4)) % 3;
        if (selector === 0) {
          const spacing = 3;
          return mod(x, spacing) / spacing;
        }
        if (selector === 1) {
          const spacing = 4;
          return mod(x + y, spacing) / spacing;
        }
        const spacing = 5;
        return mod(y, spacing) / spacing;
      }
      const resolvedTone = Math.max(0, Math.min(1, tone as number));
      if (resolvedTone < 0.33) {
        const spacing = 3;
        return mod(x, spacing) / spacing;
      }
      if (resolvedTone < 0.66) {
        const spacing = 4;
        return mod(x + y, spacing) / spacing;
      }
      const spacing = 5;
      return mod(y, spacing) / spacing;
    }
    default:
      return 0.5;
  }
};
