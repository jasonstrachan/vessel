import { inflateRaw } from './fflate-inflate.js';

// ------------------------------------------------------------
// Diagnostics
// ------------------------------------------------------------
const resolveDiagnosticsDefault = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.__VESSEL_GOBLET_DEBUG__ === true) {
    return true;
  }
  try {
    if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
      return true;
    }
    if (window.localStorage?.getItem('vesselGobletDebug') === 'true') {
      return true;
    }
  } catch {
    // Swallow storage/query errors (e.g. file://)
  }
  return false;
};

let diagnosticsEnabled = resolveDiagnosticsDefault();

const diagnostics = {
  log: (...args) => {
    if (diagnosticsEnabled) {
      console.log('[Vessel Goblet]', ...args);
    }
  },
  warn: (...args) => {
    if (diagnosticsEnabled) {
      console.warn('[Vessel Goblet]', ...args);
    }
  },
  error: (...args) => {
    if (diagnosticsEnabled) {
      console.error('[Vessel Goblet]', ...args);
    }
  }
};

const setDiagnostics = (value) => {
  diagnosticsEnabled = Boolean(value);
  if (typeof window !== 'undefined') {
    window.__VESSEL_GOBLET_DEBUG__ = diagnosticsEnabled;
    try {
      window.localStorage?.setItem('vesselGobletDebug', diagnosticsEnabled ? 'true' : 'false');
    } catch {
      // Ignore storage issues (e.g. private browsing, file://)
    }
  }
  diagnostics.log('Diagnostics toggled', { enabled: diagnosticsEnabled });
};

if (typeof window !== 'undefined') {
  window.__VESSEL_GOBLET_DEBUG__ = diagnosticsEnabled;
  window.vesselGobletSetDiagnostics = setDiagnostics;
}

export const debugLog = (...args) => diagnostics.log(...args);
export const debugWarn = (...args) => diagnostics.warn(...args);
export const debugError = (...args) => diagnostics.error(...args);
export const isGobletDiagnosticsEnabled = () => diagnosticsEnabled;
export const setGobletDiagnosticsEnabled = (value) => setDiagnostics(value);

// ------------------------------------------------------------
// Generic helpers
// ------------------------------------------------------------
const toFinite = (value, fallback = 0) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const clamp01 = (value) => clamp(value, 0, 1);

const clamp255 = (value) => clamp(Math.round(value), 0, 255);

const wrap01 = (value) => {
  let result = value % 1;
  if (result < 0) {
    result += 1;
  }
  return result;
};

const reflect01 = (value) => {
  const two = 2;
  let result = value % two;
  if (result < 0) {
    result += two;
  }
  return result <= 1 ? result : two - result;
};

const normalizeScaleOption = (option) => {
  if (typeof option === 'number') {
    const value = option > 0 ? option : 1;
    return { x: value, y: value };
  }
  if (option && typeof option === 'object') {
    const rawX = Number(option.x);
    const rawY = Number(option.y);
    const x = Number.isFinite(rawX) && rawX > 0 ? rawX : 1;
    const y = Number.isFinite(rawY) && rawY > 0 ? rawY : 1;
    return { x, y };
  }
  return { x: 1, y: 1 };
};

const rgbaToCss = ({ r, g, b, a }) => `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${clamp(clamp(a, 0, 255) / 255, 0, 1)})`;

const deepClone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const roundPlacementValue = (value) => {
  const numeric = toFinite(value, 0);
  return Math.round(numeric * 1000) / 1000;
};

const MIN_DIMENSION = 1e-3;

const clampDimension = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DIMENSION;
  }
  return value;
};

const createDefaultAlignment = () => ({
  fit: 'none',
  horizontal: 'left',
  vertical: 'top',
  positioning: 'anchor',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 0, y: 0 }
});

const normalizeAlignment = (alignment) => {
  const base = alignment && typeof alignment === 'object' ? alignment : {};
  const defaults = createDefaultAlignment();
  const positioning = typeof base.positioning === 'string' ? base.positioning : defaults.positioning;
  const fit = typeof base.fit === 'string' ? base.fit : defaults.fit;
  const offsetPx = base.offsetPx && typeof base.offsetPx === 'object'
    ? {
        x: toFinite(base.offsetPx.x, 0),
        y: toFinite(base.offsetPx.y, 0)
      }
    : { ...defaults.offsetPx };
  const offsetPercent = base.offsetPercent && typeof base.offsetPercent === 'object'
    ? {
        x: toFinite(base.offsetPercent.x, 0),
        y: toFinite(base.offsetPercent.y, 0)
      }
    : positioning === 'auto' || fit === 'percent'
      ? { ...defaults.offsetPercent }
      : undefined;

  return {
    fit,
    horizontal: typeof base.horizontal === 'string' ? base.horizontal : defaults.horizontal,
    vertical: typeof base.vertical === 'string' ? base.vertical : defaults.vertical,
    positioning,
    offsetPx,
    offsetPercent
  };
};

const createDefaultContainerLayout = () => ({
  flow: 'row',
  justify: 'start',
  align: 'start',
  wrap: false,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'fill'
});

const normalizeContainerLayout = (layout) => {
  const base = layout && typeof layout === 'object' ? layout : {};
  const defaults = createDefaultContainerLayout();
  const padding = base.padding && typeof base.padding === 'object'
    ? {
        top: toFinite(base.padding.top, 0),
        right: toFinite(base.padding.right, 0),
        bottom: toFinite(base.padding.bottom, 0),
        left: toFinite(base.padding.left, 0)
      }
    : { ...defaults.padding };

  const sizeMode = base.sizeMode === 'fixed' || base.sizeMode === 'hug' || base.sizeMode === 'fill'
    ? base.sizeMode
    : defaults.sizeMode;

  return {
    flow: base.flow === 'column' || base.flow === 'column-reverse' || base.flow === 'row-reverse' ? base.flow : defaults.flow,
    justify: base.justify === 'center' || base.justify === 'end' || base.justify === 'space-between' || base.justify === 'space-around'
      ? base.justify
      : defaults.justify,
    align: base.align === 'center' || base.align === 'end' || base.align === 'stretch'
      ? base.align
      : defaults.align,
    wrap: Boolean(base.wrap),
    gap: toFinite(base.gap, defaults.gap),
    padding,
    sizeMode,
    width: sizeMode === 'fixed' && Number.isFinite(base.width) ? Math.max(1, base.width) : undefined,
    height: sizeMode === 'fixed' && Number.isFinite(base.height) ? Math.max(1, base.height) : undefined
  };
};

const computeLayerTransform = (surface, viewport, alignment) => {
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

  const usesPercentFit = alignment.fit === 'percent';
  const usesAutoPositioning = alignment.positioning === 'auto';

  let translateX = 0;
  let translateY = 0;

  if (!usesPercentFit && !usesAutoPositioning) {
    switch (alignment.horizontal) {
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

    switch (alignment.vertical) {
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

const buildLayoutLines = (items, flow, wrap, gap, availableMain) => {
  const lines = [];
  const safeGap = Math.max(0, gap);
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

const computeLineOffsets = (line, contentMain, gap, justify, reverse) => {
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

const computeLineCrossSizes = (lines, contentCross, gap, align) => {
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

const resolveContainerLayout = (layers, layout, viewport) => {
  const containerWidth = layout.sizeMode === 'fixed' && typeof layout.width === 'number'
    ? layout.width
    : viewport.width;
  const containerHeight = layout.sizeMode === 'fixed' && typeof layout.height === 'number'
    ? layout.height
    : viewport.height;

  const padding = layout.padding;
  const innerWidth = Math.max(0, containerWidth - padding.left - padding.right);
  const innerHeight = Math.max(0, containerHeight - padding.top - padding.bottom);

  const flowAxis = layout.flow === 'row' || layout.flow === 'row-reverse' ? 'row' : 'column';
  const reverse = layout.flow === 'row-reverse' || layout.flow === 'column-reverse';

  const availableMain = flowAxis === 'row' ? innerWidth : innerHeight;

  const lines = buildLayoutLines(layers, flowAxis, layout.wrap, layout.gap, availableMain);

  const contentMain = flowAxis === 'row' ? innerWidth : innerHeight;
  const contentCross = flowAxis === 'row' ? innerHeight : innerWidth;

  const { sizes: lineCrossSizes, offset: crossOffset } = computeLineCrossSizes(
    lines,
    contentCross,
    layout.gap,
    layout.align
  );

  const placements = new Map();

  let crossCursor = crossOffset;
  lines.forEach((line, lineIndex) => {
    const lineCrossSize = lineCrossSizes[lineIndex] ?? 0;
    const { start: lineStart, gap: lineGap } = computeLineOffsets(
      line,
      contentMain,
      layout.gap,
      layout.justify,
      reverse
    );

    const items = reverse ? [...line.items].reverse() : line.items;

    let mainCursor = lineStart;
    items.forEach((item) => {
      const layer = item.layer;
      const mainSize = item.main;
      const crossSize = layout.align === 'stretch' ? lineCrossSize : item.cross;
      const crossAdjust = computeCrossOffsetWithinLine(lineCrossSize, crossSize, layout.align);

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

      const contentSize = layer.content ?? layer.surface;
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

    crossCursor += lineCrossSize + Math.max(0, layout.gap);
  });

  const results = [];
  layers.forEach((layer) => {
    if (layer.hidden) {
      return;
    }
    const placement = placements.get(layer.layerId);
    if (placement) {
      results.push(placement);
    }
  });

  return results;
};

const applyDesignLayout = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers)) {
    return metadata;
  }

  const hasAlignment = metadata.layers.some((layer) => layer && layer.alignment);
  if (!hasAlignment) {
    return metadata;
  }

  const viewport = {
    width: Math.max(1, toFinite(metadata.viewport?.designWidth ?? metadata.project?.width, 1)),
    height: Math.max(1, toFinite(metadata.viewport?.designHeight ?? metadata.project?.height, 1))
  };

  const layout = normalizeContainerLayout(metadata.container);

  const inputs = metadata.layers.map((layer) => {
    if (!layer) {
      return null;
    }
    const surfaceWidth = Math.max(1, toFinite(layer?.source?.width, 1));
    const surfaceHeight = Math.max(1, toFinite(layer?.source?.height, 1));
    const contentWidth = layer.contentBounds
      ? Math.max(1, toFinite(layer.contentBounds.width, surfaceWidth))
      : surfaceWidth;
    const contentHeight = layer.contentBounds
      ? Math.max(1, toFinite(layer.contentBounds.height, surfaceHeight))
      : surfaceHeight;

    return {
      layerId: layer.id,
      surface: { width: surfaceWidth, height: surfaceHeight },
      content: { width: contentWidth, height: contentHeight },
      alignment: normalizeAlignment(layer.alignment),
      hidden: layer.visible === false
    };
  }).filter(Boolean);

  try {
    const placements = resolveContainerLayout(inputs, layout, viewport);
    const placementMap = new Map();
    placements.forEach((placement) => {
      placementMap.set(placement.layerId, placement);
    });

    metadata.layers.forEach((layer) => {
      if (!layer) {
        return;
      }
      const placement = placementMap.get(layer.id);
      if (!placement) {
        if (!layer.bounds) {
          const fallbackWidth = Math.max(1, toFinite(layer?.source?.width, 1));
          const fallbackHeight = Math.max(1, toFinite(layer?.source?.height, 1));
          layer.bounds = {
            x: 0,
            y: 0,
            width: fallbackWidth,
            height: fallbackHeight,
            anchor: 'top-left'
          };
        }
        return;
      }

      const contentWidth = layer.contentBounds
        ? Math.max(1, toFinite(layer.contentBounds.width, placement.frame.width))
        : placement.frame.width;
      const contentHeight = layer.contentBounds
        ? Math.max(1, toFinite(layer.contentBounds.height, placement.frame.height))
        : placement.frame.height;

      const translateX = placement.frame.x + toFinite(placement.transform.translateX, 0);
      const translateY = placement.frame.y + toFinite(placement.transform.translateY, 0);
      const width = Math.max(1, contentWidth * toFinite(placement.transform.scaleX, 1));
      const height = Math.max(1, contentHeight * toFinite(placement.transform.scaleY, 1));

      const alignment = normalizeAlignment(layer.alignment);
      const anchor = alignment.horizontal === 'center' && alignment.vertical === 'center'
        ? 'center'
        : 'top-left';

      layer.bounds = {
        x: roundPlacementValue(translateX),
        y: roundPlacementValue(translateY),
        width: roundPlacementValue(width),
        height: roundPlacementValue(height),
        anchor
      };
    });
  } catch (error) {
    diagnostics.warn('Failed to compute design layout in viewer', error);
  }

  return metadata;
};

const computeViewportMapping = (viewport, canvasWidth, canvasHeight) => {
  const designWidth = Math.max(1, toFinite(viewport?.designWidth, canvasWidth || 1));
  const designHeight = Math.max(1, toFinite(viewport?.designHeight, canvasHeight || 1));
  const mode = viewport?.mode === 'fill' || viewport?.mode === 'fit' ? viewport.mode : 'fixed';

  let scaleX = canvasWidth / designWidth;
  let scaleY = canvasHeight / designHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (!Number.isFinite(scaleX) || scaleX <= 0) {
    scaleX = 1;
  }
  if (!Number.isFinite(scaleY) || scaleY <= 0) {
    scaleY = 1;
  }

  if (mode === 'fit') {
    const uniform = Math.min(scaleX, scaleY);
    const contentWidth = designWidth * uniform;
    const contentHeight = designHeight * uniform;
    offsetX = (canvasWidth - contentWidth) / 2;
    offsetY = (canvasHeight - contentHeight) / 2;
    scaleX = uniform;
    scaleY = uniform;
  }

  return {
    mode,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    designWidth,
    designHeight
  };
};

const computeLayerDestination = (layer, mapping) => {
  const bounds = layer?.bounds ?? layer?.placement ?? {
    x: 0,
    y: 0,
    width: layer?.source?.width ?? 0,
    height: layer?.source?.height ?? 0,
    anchor: 'top-left'
  };
  const fallbackWidth = layer?.source?.width ?? 1;
  const fallbackHeight = layer?.source?.height ?? 1;
  const baseX = toFinite(bounds.x, 0) * mapping.scaleX;
  const baseY = toFinite(bounds.y, 0) * mapping.scaleY;
  const width = Math.max(1, toFinite(bounds.width, fallbackWidth) * mapping.scaleX);
  const height = Math.max(1, toFinite(bounds.height, fallbackHeight) * mapping.scaleY);

  const offsetX = mapping.offsetX;
  const offsetY = mapping.offsetY;

  return {
    x: baseX + offsetX,
    y: baseY + offsetY,
    width,
    height
  };
};

// ------------------------------------------------------------
// Metadata normalisation
// ------------------------------------------------------------
const PROPERTY_UNMINIFY_MAP = {
  f: 'format',
  v: 'version',
  e: 'exportedAt',
  p: 'project',
  vp: 'viewport',
  c: 'container',
  an: 'animation',
  s: 'settings',
  l: 'layers',
  grl: 'gradients',
  fb: 'fallback',
  i: 'id',
  n: 'name',
  t: 'type',
  vi: 'visible',
  o: 'opacity',
  bm: 'blendMode',
  src: 'source',
  plc: 'placement',
  bnd: 'bounds',
  anc: 'anchor',
  al: 'alignment',
  ft: 'fit',
  hz: 'horizontal',
  vt: 'vertical',
  ps: 'positioning',
  opx: 'offsetPx',
  opc: 'offsetPercent',
  cb: 'contentBounds',
  as: 'assets',
  cc: 'colorCycle',
  w: 'width',
  h: 'height',
  x: 'x',
  y: 'y',
  dw: 'designWidth',
  dh: 'designHeight',
  txr: 'texture',
  md: 'mode',
  ia: 'isAnimating',
  bs: 'brushState',
  gs: 'gradientStops',
  ib: 'indexBuffer',
  pl: 'palette',
  ao: 'animationOffset',
  tf: 'targetFPS',
  fd: 'flowDirection',
  rs: 'recolorSettings',
  gr: 'gradient',
  grf: 'gradientRef',
  spd: 'brushSpeed',
  si: 'stackIndex',
  bf: 'bundleFormat',
  ihl: 'includeHiddenLayers',
  ecf: 'embedCanvasFallback',
  mo: 'minifyOutput',
  plp: 'perfectLoop',
  fps: 'fps',
  tfm: 'totalFrames',
  ds: 'durationSeconds',
  pm: 'phaseMap'
};

const expandMinifiedProperties = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => expandMinifiedProperties(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const expanded = {};
  Object.entries(value).forEach(([key, nested]) => {
    const restoredKey = PROPERTY_UNMINIFY_MAP[key] || key;
    if (restoredKey in expanded && restoredKey !== key) {
      return;
    }
    expanded[restoredKey] = expandMinifiedProperties(nested);
  });
  return expanded;
};

export const expandVesselMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return metadata;
  }
  if ('format' in metadata) {
    return metadata;
  }
  if (!('f' in metadata)) {
    return metadata;
  }
  try {
    return expandMinifiedProperties(metadata);
  } catch (error) {
    console.warn('[Vessel Goblet] Failed to expand minified metadata', error);
    return metadata;
  }
};

if (typeof window !== 'undefined') {
  window.expandVesselMetadata = expandVesselMetadata;
}

const restoreSharedGradients = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers) || !Array.isArray(metadata.gradients)) {
    return metadata;
  }
  const gradients = metadata.gradients;
  metadata.layers.forEach((layer) => {
    const ref = layer?.colorCycle?.gradientRef;
    if (typeof ref === 'number' && gradients[ref]) {
      layer.colorCycle.gradient = gradients[ref];
    }
  });
  return metadata;
};

const ensureLayerBoundsCompatibility = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers)) {
    return metadata;
  }
  metadata.layers.forEach((layer) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }
    const bounds = layer.bounds;
    const placement = layer.placement;
    if (!bounds && placement) {
      layer.bounds = deepClone(placement);
    } else if (bounds && !placement) {
      layer.placement = deepClone(bounds);
    }
  });
  return metadata;
};

const validateMetadata = (metadata) => {
  if (!metadata || metadata.format !== 'vessel-goblet') {
    throw new Error('Unsupported bundle format');
  }
  if (!metadata.viewport) {
    throw new Error('Missing viewport definition');
  }
  const viewport = metadata.viewport;
  const designWidth = toFinite(viewport.designWidth ?? viewport.width ?? metadata.project?.width, 0);
  const designHeight = toFinite(viewport.designHeight ?? viewport.height ?? metadata.project?.height, 0);
  if (designWidth <= 0 || designHeight <= 0) {
    throw new Error('Missing viewport dimensions');
  }
  viewport.designWidth = designWidth;
  viewport.designHeight = designHeight;
  viewport.mode = viewport.mode === 'fill' || viewport.mode === 'fit' ? viewport.mode : 'fixed';
  if (!Array.isArray(metadata.layers)) {
    throw new Error('Layers array missing or invalid');
  }
};

const prepareMetadata = (metadata) => {
  const expanded = ensureLayerBoundsCompatibility(
    restoreSharedGradients(expandVesselMetadata(deepClone(metadata)))
  );
  diagnostics.log('[goblet] Expanded metadata check:', {
    layerCount: expanded.layers?.length,
    layersWithTextures: expanded.layers?.map((layer) => ({
      id: layer.id,
      hasTexture: Boolean(layer.assets?.texture),
      textureLength: layer.assets?.texture?.length
    }))
  });
  validateMetadata(expanded);
  return applyDesignLayout(expanded);
};

// ------------------------------------------------------------
// Layout engine (mirrors exporter logic)
// ------------------------------------------------------------
// ------------------------------------------------------------
// Asset loading
// ------------------------------------------------------------
const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (error) => reject(error ?? new Error('Failed to load image'));
    img.src = src;
  });
};

// ------------------------------------------------------------
// Numeric payload helpers (matching exporter contract)
// ------------------------------------------------------------
const B64Z_PREFIX = 'b64z:';

const decodeBase64ToUint8 = (base64) => {
  const normalized = base64.trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const decompressWithStream = async (compressed) => {
  const StreamCtor = typeof DecompressionStream === 'function' ? DecompressionStream : null;
  if (!StreamCtor) {
    return null;
  }
  try {
    const stream = new Response(compressed).body;
    if (!stream) {
      return null;
    }
    const reader = stream.pipeThrough(new StreamCtor('deflate-raw'));
    const buffer = await new Response(reader).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    diagnostics.warn('DecompressionStream failed', error);
    return null;
  }
};

const inflateRawFallback = (compressed) => {
  try {
    const result = inflateRaw(compressed);
    return result && result.length ? result : null;
  } catch (error) {
    diagnostics.warn('inflateRaw fallback failed', error);
    return null;
  }
};

const decompressB64ZPayload = async (payload) => {
  if (typeof payload !== 'string' || !payload.startsWith(B64Z_PREFIX)) {
    return null;
  }
  const compressed = decodeBase64ToUint8(payload.slice(B64Z_PREFIX.length));
  const streamResult = await decompressWithStream(compressed);
  if (streamResult && streamResult.length) {
    return streamResult;
  }
  const fallbackResult = inflateRawFallback(compressed);
  if (fallbackResult && fallbackResult.length) {
    return fallbackResult;
  }
  throw new Error('Failed to decompress b64z payload');
};

const resolveNumericBuffer = async (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    if (value.startsWith(B64Z_PREFIX)) {
      return await decompressB64ZPayload(value);
    }
    return null;
  }
  if (value instanceof Uint8Array) {
    return value.length ? value.slice() : new Uint8Array(0);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (Array.isArray(value)) {
    const buffer = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const entry = value[i];
      buffer[i] = Number.isFinite(entry) && entry >= 0 ? entry & 0xff : 0;
    }
    return buffer;
  }
  return null;
};

const hasNumericPayload = (value) => {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return value.startsWith(B64Z_PREFIX);
  }
  if (Array.isArray(value) || value instanceof Uint8Array) {
    return value.length > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.length > 0;
  }
  return false;
};

// ------------------------------------------------------------
// Gradient + color-cycle helpers
// ------------------------------------------------------------
const parseColor = (input) => {
  if (typeof input !== 'string') {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  const value = input.trim();
  if (!value) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  if (value.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      return { r, g, b, a };
    }
  }
  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const r = clamp255(parseFloat(parts[0]));
      const g = clamp255(parseFloat(parts[1]));
      const b = clamp255(parseFloat(parts[2]));
      let a = 255;
      if (parts.length >= 4) {
        const raw = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        if (Number.isFinite(raw)) {
          a = raw <= 1 ? clamp255(raw * 255) : clamp255(raw);
        }
      }
      return { r, g, b, a };
    }
  }
  return { r: 255, g: 255, b: 255, a: 255 };
};

const DEFAULT_GRADIENT = [
  { position: 0, rgba: parseColor('#000000') },
  { position: 1, rgba: parseColor('#ffffff') }
];

const normalizeGradientStops = (stops) => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return DEFAULT_GRADIENT.map((entry) => ({ position: entry.position, rgba: { ...entry.rgba } }));
  }
  const normalized = stops
    .map((stop) => ({
      position: clamp01(typeof stop?.position === 'number' ? stop.position : parseFloat(stop?.position ?? 0)),
      rgba: parseColor(stop?.color ?? '#ffffff')
    }))
    .sort((a, b) => a.position - b.position);
  if (normalized.length === 0) {
    return DEFAULT_GRADIENT.map((entry) => ({ position: entry.position, rgba: { ...entry.rgba } }));
  }
  if (normalized[0].position > 0) {
    normalized.unshift({ position: 0, rgba: normalized[0].rgba });
  }
  const last = normalized[normalized.length - 1];
  if (last.position < 1) {
    normalized.push({ position: 1, rgba: last.rgba });
  }
  if (normalized.length === 1) {
    normalized.push({ position: 1, rgba: normalized[0].rgba });
  }
  return normalized;
};

const sampleGradient = (gradient, position) => {
  if (!Array.isArray(gradient) || gradient.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  if (gradient.length === 1) {
    return { ...gradient[0].rgba };
  }
  const pos = clamp01(position);
  for (let i = 0; i < gradient.length - 1; i += 1) {
    const left = gradient[i];
    const right = gradient[i + 1];
    if (pos >= left.position && pos <= right.position) {
      const span = right.position - left.position;
      const t = span > 0 ? (pos - left.position) / span : 0;
      return {
        r: clamp255(left.rgba.r + (right.rgba.r - left.rgba.r) * t),
        g: clamp255(left.rgba.g + (right.rgba.g - left.rgba.g) * t),
        b: clamp255(left.rgba.b + (right.rgba.b - left.rgba.b) * t),
        a: clamp255(left.rgba.a + (right.rgba.a - left.rgba.a) * t)
      };
    }
  }
  return { ...gradient[gradient.length - 1].rgba };
};

const normalizeFlowDirection = (direction, fallback = 'forward') => {
  if (typeof direction !== 'string') {
    return fallback;
  }
  const value = direction.trim().toLowerCase();
  if (['forward', 'reverse', 'backward', 'pingpong', 'bounce'].includes(value)) {
    if (value === 'backward') {
      return 'reverse';
    }
    return value;
  }
  return fallback;
};

const buildGradientLUT = ({ gradient, cycleColors, tick, mappingMode, flowDirection, indexPhaseMap }) => {
  const lut = new Uint32Array(256);
  const bands = Math.max(1, Math.floor(Number.isFinite(cycleColors) ? cycleColors : 16));
  const mode = mappingMode === 'continuous' ? 'continuous' : 'banded';
  const direction = normalizeFlowDirection(flowDirection);
  const directionSign = direction === 'reverse' ? -1 : 1;
  const pingpong = direction === 'pingpong' || direction === 'bounce';
  const normalizedShift = directionSign * (Number.isFinite(tick) ? tick : 0) / bands;

  for (let i = 0; i < 256; i += 1) {
    let phaseBase;
    if (mode === 'continuous') {
      phaseBase = indexPhaseMap ? indexPhaseMap[i] / 255 : i / 255;
    } else if (indexPhaseMap) {
      const bandIndex = clamp(Math.floor((indexPhaseMap[i] / 255) * bands), 0, bands - 1);
      phaseBase = bandIndex / bands;
    } else {
      phaseBase = (i % bands) / bands;
    }

    let positionValue;
    if (pingpong) {
      positionValue = reflect01(phaseBase + normalizedShift);
    } else {
      positionValue = wrap01(phaseBase + (normalizedShift % 1));
    }

    if (positionValue >= 1) {
      positionValue = 0.999999;
    }
    if (positionValue < 0) {
      positionValue = 0;
    }

    const color = sampleGradient(gradient, positionValue);
    lut[i] = (color.a << 24) | (color.b << 16) | (color.g << 8) | color.r;
  }

  return lut;
};

const fillPixelsFromIndices = (indices, lut, outPixels32, alpha, options = {}) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;

  if (!lut || lut.length === 0) {
    outPixels32.fill(0, 0, length);
    return;
  }

  if (useAlpha) {
    for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
      const rawIndex = indices[i] ?? 0;
      if (transparentZero && rawIndex === 0) {
        outPixels32[i] = 0;
        continue;
      }
      const effective = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
      const capped = effective >= 0 && effective < lut.length ? effective : ((effective % lut.length) + lut.length) % lut.length;
      const rgb = lut[capped] & 0x00ffffff;
      const a = alpha[aIdx];
      outPixels32[i] = (a << 24) | rgb;
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      const rawIndex = indices[i] ?? 0;
      if (transparentZero && rawIndex === 0) {
        outPixels32[i] = 0;
        continue;
      }
      const effective = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
      const capped = effective >= 0 && effective < lut.length ? effective : ((effective % lut.length) + lut.length) % lut.length;
      outPixels32[i] = lut[capped];
    }
  }
};

const fillPixelsFromPhaseMap = (phaseMap, lut, outPixels32, alpha) => {
  const length = Math.min(phaseMap.length, outPixels32.length);
  if (alpha && alpha.length >= length * 4) {
    for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
      const rgb = lut[phaseMap[i]] & 0x00ffffff;
      const a = alpha[aIdx];
      outPixels32[i] = (a << 24) | rgb;
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      outPixels32[i] = lut[phaseMap[i]];
    }
  }
};

const buildDirectionalPhaseMap = (width, height, angleDeg, wavelengthPx) => {
  const map = new Uint8Array(width * height);
  const theta = (angleDeg % 360) * (Math.PI / 180);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const invWave = 1 / Math.max(1e-6, wavelengthPx);
  let idx = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, idx += 1) {
      const projection = x * cos + y * sin;
      const phase = projection * invWave;
      map[idx] = clamp255((phase - Math.floor(phase)) * 255);
    }
  }
  return map;
};

const buildLuminancePhaseMap = (imageData) => {
  const { width, height, data } = imageData;
  const map = new Uint8Array(width * height);
  let idx = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    map[idx] = clamp255(luminance);
    idx += 1;
  }
  return map;
};

const DEFAULT_ANIMATION_SPEED = 0.1;

const resolveAnimationSpeed = (rawExportedSpeed, rawFallbackSpeed, shouldAnimate) => {
  const exported = Number.isFinite(rawExportedSpeed) ? Number(rawExportedSpeed) : null;
  const fallbackSpeed = Number.isFinite(rawFallbackSpeed) ? Number(rawFallbackSpeed) : null;
  if (exported !== null && exported > 0) {
    return exported;
  }
  if (shouldAnimate) {
    if (fallbackSpeed !== null && fallbackSpeed > 0) {
      return fallbackSpeed;
    }
    return DEFAULT_ANIMATION_SPEED;
  }
  if (exported !== null) {
    return Math.max(0, exported);
  }
  if (fallbackSpeed !== null) {
    return Math.max(0, fallbackSpeed);
  }
  return 0;
};

class ColorCycleLayerPlayer {
  constructor(layer, textureImage) {
    this.layer = layer;
    this.image = textureImage;

    const width = Math.max(1, Math.round(layer.source?.width ?? textureImage?.naturalWidth ?? textureImage?.width ?? 1));
    const height = Math.max(1, Math.round(layer.source?.height ?? textureImage?.naturalHeight ?? textureImage?.height ?? 1));

    this.canvas = document.createElement('canvas');
    this.createSurface(width, height);

    this.alpha = null;
    this.baseImageData = null;
    this.indexBuffer = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.gradient = DEFAULT_GRADIENT;
    this.cycleColors = 16;
    this.mappingMode = 'banded';
    this.flowMapping = 'palette';
    this.flowDirection = 'forward';
    this.speed = 0;
    this.currentTick = 0;
    this.isAnimating = false;
    this.mode = layer.colorCycle?.mode ?? 'brush';
    this.zeroTransparent = false;
    this.subtractIndexOffset = false;
  }

  createSurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) {
      throw new Error('Unable to create 2D context for color cycle layer');
    }
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.width = w;
    this.height = h;
    this.imageData = ctx.createImageData(w, h);
    this.pixels32 = new Uint32Array(this.imageData.data.buffer);
  }

  async initialize() {
    const colorCycle = this.layer.colorCycle;
    if (!colorCycle) {
      throw new Error('Layer missing color cycle metadata');
    }

    const recolorSettings = colorCycle.recolorSettings;
    const brushState = colorCycle.brushState;

    const hasRecolor = Boolean(recolorSettings && hasNumericPayload(recolorSettings.indexBuffer));
    const hasBrush = Boolean(brushState && hasNumericPayload(brushState.indexBuffer));

    if (hasBrush) {
      await this.initializeBrushMode(colorCycle, brushState);
    } else if (hasRecolor) {
      await this.initializeRecolorMode(colorCycle, recolorSettings);
    } else {
      throw new Error('Color cycle configuration missing index buffer');
    }

    if (!this.indexBuffer || this.indexBuffer.length === 0) {
      throw new Error('Color cycle index buffer is empty');
    }

    if (!this.alpha && this.image) {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = this.width;
      sampleCanvas.height = this.height;
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
      if (sampleCtx) {
        sampleCtx.drawImage(this.image, 0, 0, this.width, this.height);
        this.baseImageData = sampleCtx.getImageData(0, 0, this.width, this.height);
        this.alpha = this.baseImageData.data;
      }
    }

    if (!this.alpha) {
      this.alpha = new Uint8ClampedArray(this.width * this.height * 4);
      for (let i = 3; i < this.alpha.length; i += 4) {
        this.alpha[i] = 255;
      }
    }

    if (this.mode === 'recolor' && this.flowMapping === 'luminance' && !this.phaseMap && this.baseImageData) {
      this.phaseMap = buildLuminancePhaseMap(this.baseImageData);
    }

    this.renderFrame();
  }

  async initializeBrushMode(colorCycle, brushState) {
    this.mode = 'brush';
    const width = Math.max(1, Math.round(Number.isFinite(brushState.width) ? brushState.width : this.width));
    const height = Math.max(1, Math.round(Number.isFinite(brushState.height) ? brushState.height : this.height));
    if (width !== this.width || height !== this.height) {
      this.createSurface(width, height);
    }

    const indexBuffer = await resolveNumericBuffer(brushState.indexBuffer);
    if (!indexBuffer || indexBuffer.length === 0) {
      throw new Error('Brush state missing index buffer');
    }

    this.indexBuffer = indexBuffer;
    this.phaseMap = null;
    this.indexPhaseMap = null;
    this.gradient = normalizeGradientStops(brushState.gradientStops?.length ? brushState.gradientStops : colorCycle.gradient);
    this.cycleColors = Math.max(1, Math.floor(Array.isArray(brushState.palette) && brushState.palette.length > 0 ? brushState.palette.length : 256));
    this.mappingMode = 'continuous';
    this.flowMapping = 'palette';
    this.zeroTransparent = true;
    this.subtractIndexOffset = true;

    const exportedSpeed = Number.isFinite(brushState.animationSpeed) ? brushState.animationSpeed : null;
    const fallbackSpeed = Number.isFinite(colorCycle.brushSpeed) ? colorCycle.brushSpeed : null;
    const shouldAnimate = colorCycle.isAnimating !== false;
    this.speed = resolveAnimationSpeed(exportedSpeed, fallbackSpeed, shouldAnimate);
    const offset = Number.isFinite(brushState.animationOffset) ? brushState.animationOffset : 0;
    this.currentTick = wrap01(offset) * this.cycleColors;
    this.flowDirection = normalizeFlowDirection(brushState.flowDirection, 'reverse');
    this.isAnimating = shouldAnimate;

    const expectedLength = this.width * this.height;
    if (this.indexBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.indexBuffer.subarray(0, Math.min(expectedLength, this.indexBuffer.length)));
      this.indexBuffer = resized;
    }
  }

  async initializeRecolorMode(colorCycle, recolorSettings) {
    this.mode = colorCycle.mode ?? 'recolor';
    const indexBuffer = await resolveNumericBuffer(recolorSettings.indexBuffer);
    if (!indexBuffer || indexBuffer.length === 0) {
      throw new Error('Color cycle recolor settings missing index buffer');
    }

    this.indexBuffer = indexBuffer;
    this.zeroTransparent = false;
    this.subtractIndexOffset = false;

    const indexPhaseMap = await resolveNumericBuffer(recolorSettings.indexPhaseMap);
    this.indexPhaseMap = indexPhaseMap && indexPhaseMap.length ? indexPhaseMap : null;

    const phaseMap = await resolveNumericBuffer(recolorSettings.phaseMap);
    this.phaseMap = phaseMap && phaseMap.length ? phaseMap : null;

    this.gradient = normalizeGradientStops(recolorSettings.gradient);
    this.cycleColors = Math.max(1, Math.floor(Number.isFinite(recolorSettings.cycleColors) ? recolorSettings.cycleColors : 16));
    this.mappingMode = recolorSettings.mappingMode === 'continuous' ? 'continuous' : 'banded';
    this.flowMapping = ['palette', 'directional', 'luminance'].includes(recolorSettings.flowMapping)
      ? recolorSettings.flowMapping
      : 'palette';

    if (this.flowMapping === 'directional' && !this.phaseMap) {
      const angle = Number.isFinite(recolorSettings.directionAngle) ? recolorSettings.directionAngle : 0;
      const wavelength = Number.isFinite(recolorSettings.bandWidthPx) ? recolorSettings.bandWidthPx : 64;
      this.phaseMap = buildDirectionalPhaseMap(this.width, this.height, angle, wavelength);
    }

    if (!this.phaseMap && this.image) {
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = this.width;
      tmpCanvas.height = this.height;
      const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
      if (tmpCtx) {
        tmpCtx.drawImage(this.image, 0, 0, this.width, this.height);
        this.baseImageData = tmpCtx.getImageData(0, 0, this.width, this.height);
        if (this.flowMapping === 'luminance') {
          this.phaseMap = buildLuminancePhaseMap(this.baseImageData);
        }
      }
    }

    const animation = recolorSettings.animation || {};
    const exportedSpeed = Number.isFinite(animation.speed) ? animation.speed : null;
    const fallbackSpeed = Number.isFinite(colorCycle.brushSpeed) ? colorCycle.brushSpeed : null;
    const shouldAnimate = (animation.isPlaying ?? colorCycle.isAnimating) !== false;
    this.speed = resolveAnimationSpeed(exportedSpeed, fallbackSpeed, shouldAnimate);
    this.currentTick = Number.isFinite(animation.currentTick) ? animation.currentTick : 0;
    this.flowDirection = normalizeFlowDirection(animation.flowDirection, 'forward');
    this.isAnimating = shouldAnimate;
  }

  hasAnimation() {
    return this.isAnimating && this.speed > 0 && this.cycleColors > 0;
  }

  advance(deltaSeconds) {
    if (!this.hasAnimation()) {
      return false;
    }
    const ticksPerSecond = this.speed * this.cycleColors;
    if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) {
      return false;
    }
    const deltaTicks = ticksPerSecond * deltaSeconds;
    if (!Number.isFinite(deltaTicks) || Math.abs(deltaTicks) < 1e-4) {
      return false;
    }
    this.currentTick += deltaTicks;
    this.renderFrame();
    return true;
  }

  renderFrame() {
    if (!this.indexBuffer) {
      return;
    }
    const lut = buildGradientLUT({
      gradient: this.gradient,
      cycleColors: this.cycleColors,
      tick: this.currentTick,
      mappingMode: this.mappingMode,
      flowDirection: this.flowDirection,
      indexPhaseMap: this.indexPhaseMap
    });
    if (this.flowMapping === 'palette' || !this.phaseMap) {
      fillPixelsFromIndices(this.indexBuffer, lut, this.pixels32, this.alpha, {
        transparentZero: this.zeroTransparent,
        subtractOne: this.subtractIndexOffset
      });
    } else {
      fillPixelsFromPhaseMap(this.phaseMap, lut, this.pixels32, this.alpha);
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  getCanvas() {
    return this.canvas;
  }

  destroy() {
    this.isAnimating = false;
    this.indexBuffer = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.alpha = null;
    this.baseImageData = null;
  }
}

// ------------------------------------------------------------
// Canvas rendering helpers
// ------------------------------------------------------------
const applyLayerToContext = (ctx, source, layer, mapping, destinationOverride) => {
  if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
    return false;
  }

  const boundsRaw = layer.contentBounds ?? null;
  const sourceWidth = source instanceof HTMLImageElement
    ? source.naturalWidth || source.width
    : source.width;
  const sourceHeight = source instanceof HTMLImageElement
    ? source.naturalHeight || source.height
    : source.height;

  const bounds = boundsRaw
    ? {
        x: clamp(boundsRaw.x, 0, Number.MAX_SAFE_INTEGER),
        y: clamp(boundsRaw.y, 0, Number.MAX_SAFE_INTEGER),
        width: Math.max(1, toFinite(boundsRaw.width, sourceWidth)),
        height: Math.max(1, toFinite(boundsRaw.height, sourceHeight))
      }
    : {
        x: 0,
        y: 0,
        width: Math.max(1, sourceWidth),
        height: Math.max(1, sourceHeight)
      };

  const destination = destinationOverride ?? computeLayerDestination(layer, mapping);
  if (!destination) {
    return false;
  }

  ctx.save();
  const blendMode = layer.blendMode ?? 'source-over';
  const opacity = Number.isFinite(layer.opacity) ? clamp(layer.opacity, 0, 1) : 1;

  ctx.globalCompositeOperation = blendMode;
  ctx.globalAlpha = opacity;

  diagnostics.log('Drawing layer attempt', {
    layerId: layer.id,
    sourceActualSize: {
      width: source.width || source.naturalWidth,
      height: source.height || source.naturalHeight
    },
    drawingFrom: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    },
    drawingTo: {
      x: destination.x,
      y: destination.y,
      width: destination.width,
      height: destination.height
    },
    opacity,
    blendMode
  });

  ctx.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    destination.x,
    destination.y,
    destination.width,
    destination.height
  );

  diagnostics.log('Drew layer successfully', {
    layerId: layer.id,
    destination
  });

  ctx.restore();
  return true;
};

// ------------------------------------------------------------
// Vessel viewer core
// ------------------------------------------------------------
const RENDERER_KEY = Symbol('VesselRenderer');
const ACTIVE_CANVASES = new Map();
let resizeListenerAttached = false;
const POINTER_GUARD_EVENTS = ['mouseenter', 'mousemove', 'pointerdown', 'pointerup', 'focus'];

const clampScaleValue = (value, fallback = 1) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const sanitizeCanvasDimension = (value, fallback = 1) => {
  const numericRaw = typeof value === 'number' ? value : Number(value);
  const rounded = Math.round(numericRaw);

  if (!Number.isFinite(rounded) || rounded <= 0) {
    const fallbackRounded = Math.max(1, Math.round(fallback));
    diagnostics.warn('sanitizeCanvasDimension fallback applied', {
      provided: value,
      fallback: fallbackRounded
    });
    return fallbackRounded;
  }

  const sanitized = Math.max(1, rounded);
  if (sanitized !== rounded) {
    diagnostics.warn('sanitizeCanvasDimension clamped dimension', {
      provided: value,
      result: sanitized
    });
  }
  return sanitized;
};

const computeWindowSize = (fallbackWidth, fallbackHeight) => {
  if (typeof window === 'undefined') {
    return {
      width: sanitizeCanvasDimension(fallbackWidth, 1),
      height: sanitizeCanvasDimension(fallbackHeight, 1)
    };
  }
  const width = window.innerWidth || fallbackWidth;
  const height = window.innerHeight || fallbackHeight;
  return {
    width: sanitizeCanvasDimension(width, fallbackWidth),
    height: sanitizeCanvasDimension(height, fallbackHeight)
  };
};

const createCanvasStrategy = (metadata, initialOverride) => {
  const viewport = metadata?.viewport ?? {};
  const viewportMode = viewport.mode === 'fill' || viewport.mode === 'fit' ? viewport.mode : 'fixed';
  const baseWidth = sanitizeCanvasDimension(viewport.designWidth || viewport.width || 1, 1);
  const baseHeight = sanitizeCanvasDimension(viewport.designHeight || viewport.height || 1, 1);

  let scaleOverride = initialOverride ? normalizeScaleOption(initialOverride) : null;

  const getOverride = () => scaleOverride ?? { x: 1, y: 1 };

  const applyOverride = (baseScale, override) => ({
    x: clampScaleValue(baseScale.x * override.x),
    y: clampScaleValue(baseScale.y * override.y)
  });

  const computeCanvasSizeForScale = (scale) => ({
    width: sanitizeCanvasDimension(baseWidth * scale.x, baseWidth),
    height: sanitizeCanvasDimension(baseHeight * scale.y, baseHeight)
  });

  const resolveFillState = (nextOverride) => {
    if (nextOverride) {
      scaleOverride = normalizeScaleOption(nextOverride);
    }
    const override = getOverride();
    const windowSize = computeWindowSize(baseWidth, baseHeight);
    const baseScale = {
      x: clampScaleValue(windowSize.width / baseWidth),
      y: clampScaleValue(windowSize.height / baseHeight)
    };
    const scale = applyOverride(baseScale, override);
    return {
      scale,
      canvasSize: windowSize
    };
  };

  const resolveFitState = (nextOverride) => {
    if (nextOverride) {
      scaleOverride = normalizeScaleOption(nextOverride);
    }
    const override = getOverride();
    const windowSize = computeWindowSize(baseWidth, baseHeight);
    const uniform = clampScaleValue(Math.min(windowSize.width / baseWidth, windowSize.height / baseHeight));
    const baseScale = { x: uniform, y: uniform };
    const scale = applyOverride(baseScale, override);
    return {
      scale,
      canvasSize: computeCanvasSizeForScale(scale)
    };
  };

  const resolveFixedState = (nextOverride) => {
    if (nextOverride) {
      scaleOverride = normalizeScaleOption(nextOverride);
    }
    const override = getOverride();
    return {
      scale: override,
      canvasSize: computeCanvasSizeForScale(override)
    };
  };

  const resolveByMode = (scaleOption) => {
    switch (viewportMode) {
      case 'fill':
        return resolveFillState(scaleOption ?? null);
      case 'fit':
        return resolveFitState(scaleOption ?? null);
      default:
        return resolveFixedState(scaleOption ?? null);
    }
  };

  return {
    mode: viewportMode,
    getInitialState() {
      return resolveByMode(null);
    },
    resolve(scaleOption) {
      return resolveByMode(scaleOption ?? null);
    },
    getCanvasSize(scale) {
      if (viewportMode === 'fill') {
        return computeWindowSize(baseWidth, baseHeight);
      }
      const effectiveScale = scale ? normalizeScaleOption(scale) : getOverride();
      return computeCanvasSizeForScale(effectiveScale);
    }
  };
};

class VesselGoblet {
  constructor(metadata, canvas, options, sourceMetadata) {
    this.metadata = metadata;
    this.sourceMetadata = sourceMetadata ?? metadata;
    this.canvas = canvas;
    this.options = options ?? {};
    this.canvasStrategy = createCanvasStrategy(metadata, this.options.scale ?? null);
    const initialState = this.canvasStrategy.getInitialState();
    this.scale = { ...initialState.scale };

    this.ctx = null;
    this.layerEntries = [];
    this.dynamicPlayers = [];
    this.rafId = null;
    this.lastTimestamp = 0;
    this.destroyed = false;

    this.summary = {
      viewport: metadata.viewport,
      animation: metadata.animation,
      layers: metadata.layers.length,
      scale: { ...this.scale }
    };

    this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
  }

  setSourceMetadata(metadata) {
    this.sourceMetadata = metadata;
  }

  getSourceMetadata() {
    return this.sourceMetadata;
  }

  async initialize() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to obtain 2D rendering context');
    }
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    this.updateScale();
    await this.loadLayers();
    this.renderOnce();
  }

  async loadLayers() {
    diagnostics.log('[goblet] Starting layer load');
    const entries = await Promise.all(this.metadata.layers.map(async (layer) => {
      diagnostics.log('[goblet] Loading layer:', layer.id);
      const layerClone = deepClone(layer);
      let source = null;
      let player = null;

      if (layerClone.assets?.texture) {
        diagnostics.log('[goblet] Layer has texture, length:', layerClone.assets.texture.length);
        try {
          source = await loadImage(layerClone.assets.texture);
          diagnostics.log('[goblet] Texture loaded successfully for', layerClone.id);
        } catch (error) {
          console.error('[goblet] Texture load failed for', layerClone.id, error);
        }
      }

      if (layerClone.colorCycle && (hasNumericPayload(layerClone.colorCycle.recolorSettings?.indexBuffer) || hasNumericPayload(layerClone.colorCycle.brushState?.indexBuffer))) {
        try {
          player = new ColorCycleLayerPlayer(layerClone, source);
          await player.initialize();
          source = player.getCanvas();
        } catch (error) {
          diagnostics.warn(`Failed to initialize color cycle for layer ${layerClone.id}`, error);
          player?.destroy();
          player = null;
        }
      }

      if (!source && player) {
        source = player.getCanvas();
      }

      if (!layerClone.assets?.texture) {
        diagnostics.log('[goblet] No texture for layer', layerClone.id);
      }

      if (!source && !player) {
        diagnostics.warn('[goblet] Layer has no drawable source', {
          id: layerClone.id,
          hasTextureProp: Boolean(layerClone.assets?.texture),
          hasColorCycle: Boolean(layerClone.colorCycle),
          contentBounds: layerClone.contentBounds,
          bounds: layerClone.bounds
        });
      }

      return { layer: layerClone, source, player };
    }));

    entries.forEach((entry) => {
      entry.layer.blendMode = entry.layer.blendMode && entry.layer.blendMode !== 'normal'
        ? entry.layer.blendMode
        : 'source-over';
    });

    this.layerEntries = entries;
    this.dynamicPlayers = entries
      .map((entry) => entry.player)
      .filter((player) => player && player.hasAnimation());

    const textureless = entries
      .filter((entry) => entry.layer.visible !== false)
      .filter((entry) => !entry.source && !entry.player);
    if (textureless.length > 0) {
      diagnostics.warn('Some layers are missing textures', textureless.map((entry) => entry.layer.id));
    }
  }

  renderOnce() {
    diagnostics.log('[goblet] renderOnce called');
    if (!this.ctx) {
      console.error('[goblet] No rendering context!');
      return;
    }
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);

    if (this.metadata.project?.backgroundColor) {
      ctx.fillStyle = rgbaToCss(parseColor(this.metadata.project.backgroundColor));
      ctx.fillRect(0, 0, width, height);
    }

    const sorted = [...this.layerEntries];
    sorted.sort((a, b) => {
      const originalA = this.layerEntries.indexOf(a);
      const originalB = this.layerEntries.indexOf(b);
      const ai = typeof a.layer.stackIndex === 'number' ? a.layer.stackIndex : originalA;
      const bi = typeof b.layer.stackIndex === 'number' ? b.layer.stackIndex : originalB;
      if (ai !== bi) {
        return ai - bi;
      }
      return originalA - originalB;
    });

    diagnostics.log('[goblet] Layers to render:', sorted.map((entry) => ({
      id: entry.layer.id,
      hasSource: Boolean(entry.source || entry.player),
      visible: entry.layer.visible
    })));

    const mapping = computeViewportMapping(this.metadata.viewport, width, height);
    let painted = 0;
    sorted.forEach((entry, index) => {
      diagnostics.log(`[goblet] Processing layer ${index}:`, entry.layer.id);
      if (entry.layer.visible === false) {
        diagnostics.log(`[goblet] Skipping invisible layer ${entry.layer.id}`);
        return;
      }
      const source = entry.player ? entry.player.getCanvas() : entry.source;
      if (!source) {
        diagnostics.log(`[goblet] No source for layer ${entry.layer.id}`);
        return;
      }
      diagnostics.log(`[goblet] Have source for ${entry.layer.id}, computing destination`);
      const destination = computeLayerDestination(entry.layer, mapping);
      diagnostics.log(`[goblet] About to draw ${entry.layer.id} at:`, destination);
      if (!destination) {
        diagnostics.log(`[goblet] No destination for layer ${entry.layer.id}`);
        return;
      }

      if (applyLayerToContext(ctx, source, entry.layer, mapping, destination)) {
        painted += 1;
        diagnostics.log(`[goblet] Successfully painted layer ${entry.layer.id}`);
      } else {
        diagnostics.log(`[goblet] Failed to paint layer ${entry.layer.id}`);
      }
    });

    diagnostics.log(`[goblet] Painted ${painted} of ${sorted.length} layers`);

    if (painted === 0 && sorted.length > 0) {
      diagnostics.warn('Render completed but no layers produced pixels');
    }

    ctx.restore();
  }

  start() {
    if (this.destroyed || this.dynamicPlayers.length === 0) {
      return;
    }
    this.stop();
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.handleAnimationFrame);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.dynamicPlayers.forEach((player) => player?.destroy());
    this.layerEntries = [];
    this.dynamicPlayers = [];

    if (this.canvas) {
      const guard = this.canvas[POINTER_GUARD_KEY];
      if (guard && Array.isArray(guard.events) && typeof guard.handler === 'function') {
        guard.events.forEach((eventName) => {
          this.canvas.removeEventListener(eventName, guard.handler);
        });
      }
      delete this.canvas[POINTER_GUARD_KEY];

      if (this.canvas[RENDERER_KEY] === this) {
        delete this.canvas[RENDERER_KEY];
      }
      ACTIVE_CANVASES.delete(this.canvas);
    }
  }

  ensureRunning() {
    if (this.destroyed) {
      return;
    }
    if (this.rafId === null && this.dynamicPlayers.length > 0) {
      this.lastTimestamp = performance.now();
      this.rafId = requestAnimationFrame(this.handleAnimationFrame);
    }
  }

  updateScale(scaleOption) {
    if (this.destroyed) {
      return;
    }

    const defaultState = {
      scale: normalizeScaleOption(scaleOption ?? this.scale),
      canvasSize: { width: this.canvas.width, height: this.canvas.height }
    };
    const state = this.canvasStrategy?.resolve(scaleOption) ?? defaultState;

    const newScale = {
      x: clampScaleValue(state.scale?.x ?? this.scale?.x ?? 1),
      y: clampScaleValue(state.scale?.y ?? this.scale?.y ?? 1)
    };
    const oldScale = { ...this.scale };
    const targetCanvasSize = state.canvasSize ?? defaultState.canvasSize;
    const width = sanitizeCanvasDimension(targetCanvasSize.width ?? this.canvas.width, this.canvas.width);
    const height = sanitizeCanvasDimension(targetCanvasSize.height ?? this.canvas.height, this.canvas.height);

    diagnostics.log('[VIEWER] updateScale called:', {
      oldScale,
      newScale,
      oldCanvasSize: { width: this.canvas.width, height: this.canvas.height },
      newCanvasSize: { width, height },
      viewportMode: this.metadata.viewport.mode
    });

    this.scale = newScale;
    this.summary.scale = { ...this.scale };

    const canvasSizeChanged = this.canvas.width !== width || this.canvas.height !== height;
    const scaleChanged = oldScale.x !== newScale.x || oldScale.y !== newScale.y;

    if (canvasSizeChanged) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
      }
    }

    if (canvasSizeChanged || scaleChanged) {
      diagnostics.log('[VIEWER] Redrawing after scale change', { canvasSizeChanged, scaleChanged });
      this.renderOnce();
    }
  }

  handleViewportResize() {
    if (this.destroyed) {
      return;
    }
    this.updateScale();
  }

  handleAnimationFrame(timestamp) {
    if (this.destroyed) {
      return;
    }
    const delta = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    let needsRender = false;
    for (const player of this.dynamicPlayers) {
      if (player && player.advance(delta)) {
        needsRender = true;
      }
    }
    if (needsRender) {
      this.renderOnce();
    }
    this.rafId = requestAnimationFrame(this.handleAnimationFrame);
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
const ensureResizeListener = () => {
  if (resizeListenerAttached || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('resize', () => {
    diagnostics.log('[RESIZE] Window resized:', {
      windowSize: { width: window.innerWidth, height: window.innerHeight },
      activeCanvases: ACTIVE_CANVASES.size
    });

    ACTIVE_CANVASES.forEach((viewer, canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        ACTIVE_CANVASES.delete(canvas);
        return;
      }
      if (!viewer || typeof viewer.handleViewportResize !== 'function') {
        ACTIVE_CANVASES.delete(canvas);
        return;
      }
      diagnostics.log('[RESIZE] Updating viewer after window resize', {
        canvasId: canvas.id,
        viewportMode: viewer?.metadata?.viewport?.mode
      });
      viewer.handleViewportResize();
      viewer.ensureRunning();
    });
  });
  resizeListenerAttached = true;
};

export const renderVesselWebGL = async (metadata, canvas, options = {}) => {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A target canvas element is required');
  }
  const prepared = prepareMetadata(metadata);

  const previous = canvas[RENDERER_KEY];
  if (previous && typeof previous.updateScale === 'function' && typeof previous.getSourceMetadata === 'function' && previous.getSourceMetadata() === metadata) {
    const scaleOverride = Object.prototype.hasOwnProperty.call(options, 'scale')
      ? options.scale
      : undefined;
    previous.updateScale(scaleOverride);
    previous.ensureRunning();
    ACTIVE_CANVASES.set(canvas, previous);
    ensureResizeListener();
    return previous.summary;
  }

  if (previous && typeof previous.destroy === 'function') {
    previous.destroy();
  }

  const viewer = new VesselGoblet(prepared, canvas, options, metadata);
  viewer.setSourceMetadata(metadata);
  await viewer.initialize();
  viewer.start();

  canvas[RENDERER_KEY] = viewer;
  canvas.__vesselSourceMetadata = metadata;
  ACTIVE_CANVASES.set(canvas, viewer);
  ensureResizeListener();

  const POINTER_GUARD_KEY = Symbol.for('VesselPointerGuard');
  if (!canvas[POINTER_GUARD_KEY]) {
    const ensureRunning = () => {
      const active = canvas[RENDERER_KEY];
      active?.ensureRunning();
    };
    POINTER_GUARD_EVENTS.forEach((eventName) => {
      canvas.addEventListener(eventName, ensureRunning, { passive: true });
    });
    canvas[POINTER_GUARD_KEY] = {
      handler: ensureRunning,
      events: [...POINTER_GUARD_EVENTS]
    };
  }

  return viewer.summary;
};

export const resizeVesselWebGL = (canvas, scaleOption) => {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A target canvas element is required');
  }
  const viewer = canvas[RENDERER_KEY];
  if (!viewer || typeof viewer.updateScale !== 'function') {
    return null;
  }
  viewer.updateScale(scaleOption);
  viewer.ensureRunning();
  return viewer.summary;
};
