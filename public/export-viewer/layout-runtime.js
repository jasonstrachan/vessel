const MIN_DIMENSION = 1e-3;

const clampDimension = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DIMENSION;
  }
  return value;
};

export const computeLayerTransform = (surface, viewport, alignment = {}) => {
  const safeAlignment = {
    fit: alignment.fit || 'none',
    horizontal: alignment.horizontal || 'left',
    vertical: alignment.vertical || 'top',
    positioning: alignment.positioning || 'anchor',
    offsetPx: alignment.offsetPx,
    offsetPercent: alignment.offsetPercent
  };

  const contentWidth = clampDimension(surface?.width ?? 1);
  const contentHeight = clampDimension(surface?.height ?? 1);
  const viewportWidth = clampDimension(viewport?.width ?? 1);
  const viewportHeight = clampDimension(viewport?.height ?? 1);

  const widthRatio = viewportWidth / contentWidth;
  const heightRatio = viewportHeight / contentHeight;

  let scaleX = 1;
  let scaleY = 1;

  switch (safeAlignment.fit) {
    case 'contain': {
      const scale = Math.min(widthRatio, heightRatio);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'cover': {
      const scale = Math.max(widthRatio, heightRatio);
      scaleX = scale;
      scaleY = scale;
      break;
    }
    case 'fill':
      scaleX = widthRatio;
      scaleY = heightRatio;
      break;
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
    case 'percent':
    case 'none':
    default:
      scaleX = 1;
      scaleY = 1;
      break;
  }

  const scaledWidth = contentWidth * scaleX;
  const scaledHeight = contentHeight * scaleY;
  const extraX = viewportWidth - scaledWidth;
  const extraY = viewportHeight - scaledHeight;

  const usesPercentFit = safeAlignment.fit === 'percent';
  const usesAutoPositioning = safeAlignment.positioning === 'auto';

  let translateX = 0;
  let translateY = 0;

  if (!usesPercentFit && !usesAutoPositioning) {
    switch (safeAlignment.horizontal) {
      case 'center':
        translateX = extraX / 2;
        break;
      case 'right':
        translateX = extraX;
        break;
      case 'left':
      default:
        translateX = 0;
        break;
    }

    switch (safeAlignment.vertical) {
      case 'center':
        translateY = extraY / 2;
        break;
      case 'bottom':
        translateY = extraY;
        break;
      case 'top':
      default:
        translateY = 0;
        break;
    }
  }

  if (usesPercentFit || usesAutoPositioning) {
    const percent = safeAlignment.offsetPercent ?? { x: 0, y: 0 };
    const percentX = Math.max(-100, Math.min(100, Number(percent.x) || 0));
    const percentY = Math.max(-100, Math.min(100, Number(percent.y) || 0));

    if (usesPercentFit) {
      translateX = viewportWidth * (percentX / 100);
      translateY = viewportHeight * (percentY / 100);
    } else {
      translateX += extraX * (percentX / 100);
      translateY += extraY * (percentY / 100);
    }
  }

  const hasOffsetPx = safeAlignment.offsetPx && !usesPercentFit && !usesAutoPositioning;
  if (hasOffsetPx) {
    translateX += Number(safeAlignment.offsetPx.x) || 0;
    translateY += Number(safeAlignment.offsetPx.y) || 0;
  }

  return {
    scaleX,
    scaleY,
    translateX,
    translateY
  };
};

const buildLayoutLines = (items, flow, wrap, gap, availableMain) => {
  const lines = [];
  const safeGap = Math.max(0, gap || 0);
  const limit = wrap && availableMain > 0 ? availableMain : Number.POSITIVE_INFINITY;

  let currentLine = null;

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

    let targetLine = ensureCurrentLine();

    if (wrap && targetLine.items.length > 0) {
      const projectedMain = targetLine.mainSize + main + safeGap;
      if (projectedMain > limit) {
        currentLine = null;
        targetLine = ensureCurrentLine();
      }
    }

    targetLine.items.push({ layer, main, cross });
    targetLine.mainSize += main + (targetLine.items.length > 1 ? safeGap : 0);
    targetLine.crossSize = Math.max(targetLine.crossSize, cross);
  }

  return lines;
};

const computeLineOffsets = (line, contentMain, gap, justify, reverse) => {
  if (!line || line.items.length === 0) {
    return { start: 0, gap: Math.max(0, gap || 0) };
  }

  const safeGap = Math.max(0, gap || 0);
  const totalItems = line.items.length;
  const totalMain = line.items.reduce((acc, item) => acc + item.main, 0);
  const totalGap = safeGap * Math.max(0, totalItems - 1);
  const used = totalMain + totalGap;
  const leftover = contentMain - used;
  const freeSpace = leftover > 0 ? leftover : 0;

  if (justify === 'space-between' && totalItems > 1) {
    return {
      start: reverse ? freeSpace : 0,
      gap: safeGap + freeSpace / (totalItems - 1)
    };
  }

  if (justify === 'space-around' && totalItems > 0) {
    const extra = freeSpace / totalItems;
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

const computeLineCrossSizes = (lines, contentCross, gap, align) => {
  if (lines.length === 0) {
    return { sizes: [], offset: 0 };
  }

  const safeGap = Math.max(0, gap || 0);
  const baseSizes = lines.map((line) => line.crossSize);
  const baseTotal = baseSizes.reduce((acc, size) => acc + size, 0) + safeGap * Math.max(0, lines.length - 1);
  const free = contentCross - baseTotal;

  if (align === 'stretch' && lines.length > 0) {
    const extraPerLine = free > 0 ? free / lines.length : 0;
    const stretched = baseSizes.map((size) => size + extraPerLine);
    return { sizes: stretched, offset: 0 };
  }

  const leftover = contentCross - baseTotal;
  const positiveLeftover = leftover > 0 ? leftover : 0;

  let offset = 0;
  if (align === 'center') {
    offset = positiveLeftover / 2;
  } else if (align === 'end') {
    offset = positiveLeftover;
  }

  return { sizes: baseSizes, offset };
};

const computeCrossOffsetWithinLine = (lineSize, itemSize, align) => {
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

export const resolveContainerLayout = (layers, layout, viewport) => {
  if (!Array.isArray(layers) || !layout || !viewport) {
    return [];
  }

  const containerWidth = layout.sizeMode === 'fixed' && Number.isFinite(layout.width)
    ? layout.width
    : viewport.width;
  const containerHeight = layout.sizeMode === 'fixed' && Number.isFinite(layout.height)
    ? layout.height
    : viewport.height;

  const padding = layout.padding || { top: 0, right: 0, bottom: 0, left: 0 };
  const innerWidth = Math.max(0, containerWidth - padding.left - padding.right);
  const innerHeight = Math.max(0, containerHeight - padding.top - padding.bottom);

  const flowValue = layout.flow || 'row';
  const flowAxis = flowValue === 'row' || flowValue === 'row-reverse' ? 'row' : 'column';
  const reverse = flowValue === 'row-reverse' || flowValue === 'column-reverse';
  const wrap = Boolean(layout.wrap);
  const gap = typeof layout.gap === 'number' ? layout.gap : 0;
  const align = layout.align || 'start';
  const justify = layout.justify || 'start';

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

  const placements = new Map();

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
      const { layer } = item;
      if (!layer) {
        return;
      }

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

      const contentSize = layer.content ?? layer.surface ?? { width: 1, height: 1 };
      const viewportForLayer = { width: frameWidth, height: frameHeight };
      const alignment = layer.alignment || {
        fit: 'none',
        horizontal: 'left',
        vertical: 'top'
      };
      const transform = computeLayerTransform(contentSize, viewportForLayer, alignment);

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

  const orderedResults = [];
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

export default {
  computeLayerTransform,
  resolveContainerLayout
};
