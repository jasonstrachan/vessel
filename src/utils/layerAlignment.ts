import type { ExportContainerLayout, LayerAlignmentSettings } from '@/types';

interface Size2D {
  width: number;
  height: number;
}

export interface LayerTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotation?: number;
}

export interface LayoutLayerInput {
  layerId: string;
  surface: Size2D;
  content?: Size2D;
  alignment: LayerAlignmentSettings;
  hidden?: boolean;
}

export interface ResolvedLayerLayout {
  layerId: string;
  frame: { x: number; y: number; width: number; height: number };
  transform: LayerTransform;
}

const MIN_DIMENSION = 1e-3;

const clampDimension = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DIMENSION;
  }
  return value;
};

export const computeLayerTransform = (
  surface: Size2D,
  viewport: Size2D,
  alignment: LayerAlignmentSettings
): LayerTransform => {
  const contentWidth = clampDimension(surface.width);
  const contentHeight = clampDimension(surface.height);
  const viewportWidth = clampDimension(viewport.width);
  const viewportHeight = clampDimension(viewport.height);

  const widthRatio = viewportWidth / contentWidth;
  const heightRatio = viewportHeight / contentHeight;

  let scaleX = 1;
  let scaleY = 1;

  switch (alignment.fit) {
    case 'contain': {
      const scale = Math.min(widthRatio, heightRatio);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'uniform': {
      // Uniform fit preserves the original surface scale and only adjusts translation.
      scaleX = 1;
      scaleY = 1;
      break;
    }
    case 'cover': {
      const scale = Math.max(widthRatio, heightRatio);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'fill': {
      // Stretch independently on each axis so the content exactly matches the viewport.
      scaleX = widthRatio;
      scaleY = heightRatio;
      break;
    }
    case 'fit-width': {
      const scale = widthRatio;
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'fit-height': {
      const scale = heightRatio;
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'scale-down': {
      const containScale = Math.min(widthRatio, heightRatio);
      const scale = containScale < 1 ? containScale : 1;
      scaleX = scale;
      scaleY = scale;
      break;
    }
    // 'none' and 'percent' intentionally leave scale at 1 so only position changes.
    case 'percent':
    case 'none':
    default:
      break;
  }

  const scaledWidth = contentWidth * scaleX;
  const scaledHeight = contentHeight * scaleY;
  const extraX = viewportWidth - scaledWidth;
  const extraY = viewportHeight - scaledHeight;

  const usesPercentFit = alignment.fit === 'percent';
  const usesUniformFit = alignment.fit === 'uniform';
  const usesAutoPositioning = alignment.positioning === 'auto';

  let translateX = 0;
  let translateY = 0;

  if (!usesPercentFit && !usesAutoPositioning) {
    switch (alignment.horizontal) {
      case 'center': {
        translateX = extraX / 2;
        break;
      }
      case 'right': {
        translateX = extraX;
        break;
      }
      case 'left':
      default:
        translateX = 0;
        break;
    }

    switch (alignment.vertical) {
      case 'center': {
        translateY = extraY / 2;
        break;
      }
      case 'bottom': {
        translateY = extraY;
        break;
      }
      case 'top':
      default:
        translateY = 0;
        break;
    }
  }

  if (usesPercentFit || usesAutoPositioning) {
    const percent = alignment.offsetPercent ?? { x: 0, y: 0 };
    const percentX = Math.max(-100, Math.min(100, percent.x));
    const percentY = Math.max(-100, Math.min(100, percent.y));

    if (usesPercentFit) {
      translateX = viewportWidth * (percentX / 100);
      translateY = viewportHeight * (percentY / 100);
    } else {
      const availableX = viewportWidth - scaledWidth;
      const availableY = viewportHeight - scaledHeight;
      translateX += availableX * (percentX / 100);
      translateY += availableY * (percentY / 100);

      if (usesUniformFit && alignment.offsetPx) {
        const epsilon = 1e-3;
        if (Math.abs(availableX) <= epsilon && Number.isFinite(alignment.offsetPx.x)) {
          translateX += alignment.offsetPx.x;
        }
        if (Math.abs(availableY) <= epsilon && Number.isFinite(alignment.offsetPx.y)) {
          translateY += alignment.offsetPx.y;
        }
      }
    }
  }

  const shouldApplyOffsetPx = Boolean(alignment.offsetPx) && !usesPercentFit && !usesAutoPositioning;
  if (shouldApplyOffsetPx && alignment.offsetPx) {
    translateX += alignment.offsetPx.x;
    translateY += alignment.offsetPx.y;
  }

  return {
    scaleX,
    scaleY,
    translateX,
    translateY
  };
};

interface InternalLayoutItem {
  layer: LayoutLayerInput;
  main: number;
  cross: number;
}

interface LayoutLine {
  items: InternalLayoutItem[];
  mainSize: number;
  crossSize: number;
}

const buildLayoutLines = (
  items: LayoutLayerInput[],
  flow: 'row' | 'column',
  wrap: boolean,
  gap: number,
  availableMain: number
): LayoutLine[] => {
  const lines: LayoutLine[] = [];
  const safeGap = Math.max(0, gap);
  const limit = wrap && availableMain > 0 ? availableMain : Number.POSITIVE_INFINITY;

  let currentLine: LayoutLine | null = null;

  const ensureCurrentLine = () => {
    if (!currentLine) {
      currentLine = { items: [], mainSize: 0, crossSize: 0 };
      lines.push(currentLine);
    }
    return currentLine;
  };

  for (const layer of items) {
    if (layer.hidden) {
      continue;
    }

    const main = flow === 'row'
      ? clampDimension(layer.surface.width)
      : clampDimension(layer.surface.height);
    const cross = flow === 'row'
      ? clampDimension(layer.surface.height)
      : clampDimension(layer.surface.width);

    const targetLine = ensureCurrentLine();
    const prospective = targetLine.mainSize === 0
      ? main
      : targetLine.mainSize + safeGap + main;

    if (wrap && targetLine.items.length > 0 && prospective > limit) {
      currentLine = { items: [], mainSize: 0, crossSize: 0 };
      lines.push(currentLine);
    }

    const activeLine = ensureCurrentLine();
    activeLine.items.push({ layer, main, cross });
    activeLine.crossSize = Math.max(activeLine.crossSize, cross);
    activeLine.mainSize = activeLine.mainSize === 0
      ? main
      : activeLine.mainSize + safeGap + main;
  }

  return lines;
};

const computeLineOffsets = (
  line: LayoutLine,
  contentMain: number,
  gap: number,
  justify: ExportContainerLayout['justify'],
  reverse: boolean
): { start: number; gap: number } => {
  const count = line.items.length;
  if (count === 0) {
    return { start: 0, gap };
  }

  const safeGap = Math.max(0, gap);
  const rawMain = line.items.reduce((acc, item) => acc + item.main, 0);
  const totalBase = rawMain + safeGap * (count - 1);
  const available = contentMain;
  const leftover = available - totalBase;
  const freeSpace = leftover > 0 ? leftover : 0;

  if (justify === 'space-between' && count > 1) {
    return {
      start: reverse ? freeSpace : 0,
      gap: safeGap + freeSpace / (count - 1)
    };
  }

  if (justify === 'space-around' && count > 0) {
    const extra = freeSpace / count;
    return {
      start: extra / 2,
      gap: safeGap + extra
    };
  }

  let offset = 0;
  if (justify === 'center') {
    offset = freeSpace / 2;
  } else if (justify === 'end') {
    offset = freeSpace;
  }

  return {
    start: offset,
    gap: safeGap
  };
};

const computeLineCrossSizes = (
  lines: LayoutLine[],
  contentCross: number,
  gap: number,
  align: ExportContainerLayout['align']
): { sizes: number[]; offset: number } => {
  if (lines.length === 0) {
    return { sizes: [], offset: 0 };
  }

  const safeGap = Math.max(0, gap);
  const baseSizes = lines.map((line) => line.crossSize);
  const baseTotal = baseSizes.reduce((acc, size) => acc + size, 0) + safeGap * (lines.length - 1);
  const free = contentCross - baseTotal;

  if (align === 'stretch' && lines.length > 0) {
    const extraPerLine = free > 0 ? free / lines.length : 0;
    const stretched = baseSizes.map((size) => size + extraPerLine);
    return { sizes: stretched, offset: 0 };
  }

  const total = baseTotal;
  const leftover = contentCross - total;
  const positiveLeftover = leftover > 0 ? leftover : 0;

  let offset = 0;
  if (align === 'center') {
    offset = positiveLeftover / 2;
  } else if (align === 'end') {
    offset = positiveLeftover;
  }

  return { sizes: baseSizes, offset };
};

const computeCrossOffsetWithinLine = (
  lineSize: number,
  itemSize: number,
  align: ExportContainerLayout['align']
): number => {
  if (align === 'stretch') {
    return 0;
  }

  if (align === 'center') {
    return (lineSize - itemSize) / 2;
  }

  if (align === 'end') {
    return lineSize - itemSize;
  }

  return 0;
};

export const resolveContainerLayout = (
  layers: LayoutLayerInput[],
  layout: ExportContainerLayout,
  viewport: Size2D
): ResolvedLayerLayout[] => {
  const flow = layout.flow ?? 'stack';
  const wrap = layout.wrap ?? false;
  const gap = Number.isFinite(layout.gap) ? Math.max(0, layout.gap) : 0;
  const align = layout.align ?? 'start';
  const justify = layout.justify ?? 'start';
  const containerWidth = layout.sizeMode === 'fixed' && typeof layout.width === 'number'
    ? layout.width
    : viewport.width;
  const containerHeight = layout.sizeMode === 'fixed' && typeof layout.height === 'number'
    ? layout.height
    : viewport.height;

  const padding = layout.padding;
  const innerWidth = Math.max(0, containerWidth - padding.left - padding.right);
  const innerHeight = Math.max(0, containerHeight - padding.top - padding.bottom);

  if (flow === 'stack') {
    const placements = new Map<string, ResolvedLayerLayout>();

    layers.forEach((entry) => {
      if (entry.hidden) {
        return;
      }

      const viewportForLayer = {
        width: innerWidth,
        height: innerHeight
      };

      const contentSize = entry.alignment.fit === 'uniform'
        ? entry.surface
        : entry.content ?? entry.surface;
      const transform = computeLayerTransform(contentSize, viewportForLayer, entry.alignment);

      placements.set(entry.layerId, {
        layerId: entry.layerId,
        frame: {
          x: padding.left,
          y: padding.top,
          width: innerWidth,
          height: innerHeight
        },
        transform
      });
    });

    const orderedResults: ResolvedLayerLayout[] = [];
    layers.forEach((entry) => {
      if (entry.hidden) {
        return;
      }
      const placement = placements.get(entry.layerId);
      if (placement) {
        orderedResults.push(placement);
      }
    });

    return orderedResults;
  }

  const flowAxis = flow === 'row' || flow === 'row-reverse' ? 'row' : 'column';
  const reverse = flow === 'row-reverse' || flow === 'column-reverse';

  const availableMain = flowAxis === 'row' ? innerWidth : innerHeight;

  const lines = buildLayoutLines(layers, flowAxis, wrap, gap, availableMain);

  const contentMain = flowAxis === 'row' ? innerWidth : innerHeight;
  const contentCross = flowAxis === 'row' ? innerHeight : innerWidth;

  const { sizes: lineCrossSizes, offset: crossOffset } = computeLineCrossSizes(
    lines,
    contentCross,
    gap,
    align
  );

  const placements = new Map<string, ResolvedLayerLayout>();

  let crossCursor = crossOffset;
  lines.forEach((line, lineIndex) => {
    const lineCrossSize = lineCrossSizes[lineIndex] ?? 0;
    const { start: lineStart, gap: lineGap } = computeLineOffsets(
      line,
      contentMain,
      gap,
      justify,
      reverse
    );

    const items = reverse ? [...line.items].reverse() : line.items;

    let mainCursor = lineStart;
    items.forEach((item) => {
      const layer = item.layer;
      const mainSize = item.main;
      const crossSize = align === 'stretch' ? lineCrossSize : item.cross;
      const crossAdjust = computeCrossOffsetWithinLine(lineCrossSize, crossSize, align);

      const frameWidth = flowAxis === 'row' ? mainSize : crossSize;
      const frameHeight = flowAxis === 'row' ? crossSize : mainSize;

      let frameX = flowAxis === 'row' ? mainCursor : crossCursor + crossAdjust;
      let frameY = flowAxis === 'row' ? crossCursor + crossAdjust : mainCursor;

      if (reverse) {
        if (flowAxis === 'row') {
          frameX = contentMain - mainCursor - mainSize;
        } else {
          frameY = contentMain - mainCursor - mainSize;
        }
      }

      frameX += padding.left;
      frameY += padding.top;

      const viewportForLayer = {
        width: frameWidth,
        height: frameHeight
      };

      const contentSize = layer.alignment.fit === 'uniform'
        ? layer.surface
        : layer.content ?? layer.surface;
      const transform = computeLayerTransform(contentSize, viewportForLayer, layer.alignment);

      placements.set(layer.layerId, {
        layerId: layer.layerId,
        frame: {
          x: frameX,
          y: frameY,
          width: frameWidth,
          height: frameHeight
        },
        transform
      });

      mainCursor += mainSize + lineGap;
    });

    crossCursor += lineCrossSize + Math.max(0, gap);
  });

  const orderedResults: ResolvedLayerLayout[] = [];
  layers.forEach((layer) => {
    if (layer.hidden) {
      return;
    }
    const placement = placements.get(layer.layerId);
    if (placement) {
      orderedResults.push(placement);
    }
  });

  return orderedResults;
};
