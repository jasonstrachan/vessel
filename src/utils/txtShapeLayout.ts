import {
  layoutNextLineRange,
  materializeLineRange,
  measureNaturalWidth,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';

export interface TxtShapeLayoutSpan {
  left: number;
  right: number;
}

export interface TxtShapeLayoutLine {
  lineIndex: number;
  sourceStart: number;
  sourceEnd: number;
  span: TxtShapeLayoutSpan;
  text: string;
  width: number;
}

interface TxtShapeLayoutOptions {
  content: string;
  font: string;
  lineCount: number;
  getSpan: (lineIndex: number) => TxtShapeLayoutSpan | null;
}

interface PreparedEntry {
  prepared: PreparedTextWithSegments;
  segmentOffsets: number[];
}

const MAX_PREPARED_TEXTS = 64;
const preparedCache = new Map<string, PreparedEntry>();
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const getPreparedEntry = (content: string, font: string): PreparedEntry => {
  const key = `${font}\u0000${content}`;
  const cached = preparedCache.get(key);
  if (cached) return cached;

  const prepared = prepareWithSegments(content, font, {
    whiteSpace: 'pre-wrap',
    wordBreak: 'normal',
  });
  const segmentOffsets = [0];
  prepared.segments.forEach((segment) => {
    segmentOffsets.push(segmentOffsets.at(-1)! + segment.length);
  });
  const entry = { prepared, segmentOffsets };
  preparedCache.set(key, entry);
  if (preparedCache.size > MAX_PREPARED_TEXTS) {
    preparedCache.delete(preparedCache.keys().next().value as string);
  }
  return entry;
};

const getSourceOffset = (
  entry: PreparedEntry,
  cursor: LayoutCursor,
): number => {
  const segmentIndex = Math.max(0, Math.min(cursor.segmentIndex, entry.prepared.segments.length));
  const segment = entry.prepared.segments[segmentIndex] ?? '';
  let graphemeEnd = 0;
  let graphemeIndex = 0;
  for (const grapheme of graphemeSegmenter.segment(segment)) {
    if (graphemeIndex >= cursor.graphemeIndex) break;
    graphemeEnd = grapheme.index + grapheme.segment.length;
    graphemeIndex += 1;
  }
  return entry.segmentOffsets[segmentIndex]! + graphemeEnd;
};

const isSameCursor = (left: LayoutCursor, right: LayoutCursor): boolean => (
  left.segmentIndex === right.segmentIndex
  && left.graphemeIndex === right.graphemeIndex
);

export const layoutTxtShapeText = ({
  content,
  font,
  lineCount,
  getSpan,
}: TxtShapeLayoutOptions): TxtShapeLayoutLine[] => {
  if (!content || lineCount <= 0) return [];

  const entry = getPreparedEntry(content, font);
  const lines: TxtShapeLayoutLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const span = getSpan(lineIndex);
    const availableWidth = span ? span.right - span.left : 0;
    if (!span || availableWidth <= 0.01) continue;

    const measuredRange = layoutNextLineRange(entry.prepared, cursor, availableWidth);
    if (!measuredRange) break;
    const removedPartialWord = measuredRange.end.graphemeIndex > 0;
    const range = removedPartialWord
      ? {
          ...measuredRange,
          end: { segmentIndex: measuredRange.end.segmentIndex, graphemeIndex: 0 },
        }
      : measuredRange;
    if (isSameCursor(range.start, range.end)) {
      continue;
    }
    const materialized = materializeLineRange(entry.prepared, range);
    const width = removedPartialWord
      ? measureNaturalWidth(prepareWithSegments(materialized.text, font, {
          whiteSpace: 'pre-wrap',
          wordBreak: 'normal',
        }))
      : materialized.width;
    lines.push({
      lineIndex,
      sourceStart: getSourceOffset(entry, range.start),
      sourceEnd: getSourceOffset(entry, range.end),
      span,
      text: materialized.text,
      width,
    });
    cursor = range.end;
  }

  return lines;
};
