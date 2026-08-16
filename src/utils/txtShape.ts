import type {
  TxtShape,
  TxtShapeColorSource,
  TxtShapeSelectionRange,
  TxtShapeTextAlign,
} from '@/types';

export const TXT_SHAPE_MIN_SIZE = 16;
export const TXT_SHAPE_DEFAULT_CONTENT = 'SELECTED TEXT';

const FONT_STACKS: Record<TxtShape['fontFamily'], string> = {
  monospace: "'IBM Plex Mono', 'Courier New', monospace",
  'sans-serif': 'Arial, Helvetica, sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const isCssColor = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128;

export const normalizeTxtShapeSelections = (
  ranges: unknown,
  contentLength: number,
): TxtShapeSelectionRange[] => {
  if (!Array.isArray(ranges) || contentLength <= 0) {
    return [];
  }

  const normalized = ranges
    .map((range) => {
      const candidate = range as Partial<TxtShapeSelectionRange> | null;
      const start = clamp(Math.round(finite(candidate?.start, 0)), 0, contentLength);
      const end = clamp(Math.round(finite(candidate?.end, 0)), 0, contentLength);
      return start < end ? { start, end } : null;
    })
    .filter((range): range is TxtShapeSelectionRange => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return normalized.reduce<TxtShapeSelectionRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []);
};

export const normalizeTxtShape = (
  value: unknown,
  projectWidth: number,
  projectHeight: number,
  index = 0,
): TxtShape | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<TxtShape>;
  const content = typeof candidate.content === 'string'
    ? candidate.content.slice(0, 20_000)
    : TXT_SHAPE_DEFAULT_CONTENT;
  const width = clamp(
    finite(candidate.width, Math.min(320, projectWidth)),
    TXT_SHAPE_MIN_SIZE,
    Math.max(TXT_SHAPE_MIN_SIZE, projectWidth),
  );
  const height = clamp(
    finite(candidate.height, Math.min(160, projectHeight)),
    TXT_SHAPE_MIN_SIZE,
    Math.max(TXT_SHAPE_MIN_SIZE, projectHeight),
  );
  const now = Date.now();
  const fontFamily = candidate.fontFamily === 'sans-serif' || candidate.fontFamily === 'serif'
    ? candidate.fontFamily
    : 'monospace';
  const textAlign: TxtShapeTextAlign = candidate.textAlign === 'center' || candidate.textAlign === 'right'
    ? candidate.textAlign
    : 'left';
  const colorSource: TxtShapeColorSource = candidate.colorSource === 'palette'
    || candidate.colorSource === 'sample'
    || candidate.colorSource === 'manual'
    ? candidate.colorSource
    : 'foreground';

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : `txt-shape-${now}-${index}`,
    x: clamp(finite(candidate.x, 0), 0, Math.max(0, projectWidth - width)),
    y: clamp(finite(candidate.y, 0), 0, Math.max(0, projectHeight - height)),
    width,
    height,
    content,
    fontFamily,
    fontSize: clamp(finite(candidate.fontSize, 24), 6, 512),
    lineHeight: clamp(finite(candidate.lineHeight, 1.2), 0.75, 4),
    textAlign,
    colorSource,
    color: isCssColor(candidate.color) ? candidate.color : '#000000',
    selectionColor: isCssColor(candidate.selectionColor) ? candidate.selectionColor : '#ffffff',
    selectionBackgroundColor: isCssColor(candidate.selectionBackgroundColor)
      ? candidate.selectionBackgroundColor
      : '#000000',
    selections: normalizeTxtShapeSelections(candidate.selections, content.length),
    createdAt: finite(candidate.createdAt, now),
    updatedAt: finite(candidate.updatedAt, now),
  };
};

export const normalizeTxtShapes = (
  values: unknown,
  projectWidth: number,
  projectHeight: number,
): TxtShape[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const ids = new Set<string>();
  return values.slice(0, 1_000).reduce<TxtShape[]>((shapes, value, index) => {
    const shape = normalizeTxtShape(value, projectWidth, projectHeight, index);
    if (!shape || ids.has(shape.id)) {
      return shapes;
    }
    ids.add(shape.id);
    shapes.push(shape);
    return shapes;
  }, []);
};

export const getContrastingTxtColor = (color: string): '#000000' | '#ffffff' => {
  const match = color.trim().match(/^#([\da-f]{6})$/i);
  if (!match) {
    return '#ffffff';
  }
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.52 ? '#000000' : '#ffffff';
};

export const isTxtShapeIndexSelected = (
  selections: readonly TxtShapeSelectionRange[],
  index: number,
): boolean => selections.some((range) => index >= range.start && index < range.end);

export interface TxtShapeSegment {
  text: string;
  selected: boolean;
}

export const splitTxtShapeSegments = (shape: Pick<TxtShape, 'content' | 'selections'>): TxtShapeSegment[] => {
  if (!shape.content) {
    return [];
  }
  const boundaries = new Set<number>([0, shape.content.length]);
  normalizeTxtShapeSelections(shape.selections, shape.content.length).forEach(({ start, end }) => {
    boundaries.add(start);
    boundaries.add(end);
  });
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: TxtShapeSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    const text = shape.content.slice(start, end);
    if (!text) continue;
    segments.push({
      text,
      selected: isTxtShapeIndexSelected(shape.selections, start),
    });
  }
  return segments;
};

type Glyph = { text: string; sourceIndex: number; width: number };

export const drawTxtShapesToCanvas = (
  ctx: CanvasRenderingContext2D,
  shapes: readonly TxtShape[] | undefined,
): void => {
  if (!shapes?.length) {
    return;
  }

  shapes.forEach((shape) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(shape.x, shape.y, shape.width, shape.height);
    ctx.clip();
    ctx.font = `${shape.fontSize}px ${FONT_STACKS[shape.fontFamily]}`;
    ctx.textBaseline = 'top';
    const lineHeightPx = shape.fontSize * shape.lineHeight;
    const lines: Glyph[][] = [[]];
    let lineWidth = 0;
    let sourceIndex = 0;
    for (const character of shape.content) {
      if (character === '\n') {
        lines.push([]);
        lineWidth = 0;
        sourceIndex += character.length;
        continue;
      }
      const width = Math.max(0.01, ctx.measureText(character).width);
      if (lineWidth + width > shape.width && lines.at(-1)?.length) {
        lines.push([]);
        lineWidth = 0;
      }
      lines.at(-1)?.push({ text: character, sourceIndex, width });
      lineWidth += width;
      sourceIndex += character.length;
    }

    lines.forEach((line, lineIndex) => {
      const y = shape.y + lineIndex * lineHeightPx;
      if (y + lineHeightPx > shape.y + shape.height + 0.001) return;
      const width = line.reduce((total, glyph) => total + glyph.width, 0);
      let x = shape.x;
      if (shape.textAlign === 'center') x += (shape.width - width) / 2;
      if (shape.textAlign === 'right') x += shape.width - width;
      line.forEach((glyph) => {
        const selected = isTxtShapeIndexSelected(shape.selections, glyph.sourceIndex);
        if (selected) {
          ctx.fillStyle = shape.selectionBackgroundColor;
          ctx.fillRect(x, y, glyph.width, lineHeightPx);
        }
        ctx.fillStyle = selected ? shape.selectionColor : shape.color;
        ctx.fillText(glyph.text, x, y);
        x += glyph.width;
      });
    });
    ctx.restore();
  });
};

export const getTxtShapeFontStack = (fontFamily: TxtShape['fontFamily']): string =>
  FONT_STACKS[fontFamily];
