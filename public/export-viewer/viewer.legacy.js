import { inflateRaw } from './fflate-inflate.js';

const createLayoutRuntimeFallback = () => {
  const MIN_DIMENSION = 1e-3;

  const clampDimensionLocal = (value) => {
    if (!Number.isFinite(value) || value <= 0) {
      return MIN_DIMENSION;
    }
    return value;
  };

  const computeLayerTransform = (surface, viewport, alignment = {}) => {
    const safeAlignment = {
      fit: alignment.fit || 'none',
      horizontal: alignment.horizontal || 'left',
      vertical: alignment.vertical || 'top',
      offsetPx: alignment.offsetPx,
      offsetPercent: alignment.offsetPercent
    };

    const contentWidth = clampDimensionLocal(surface?.width ?? 1);
    const contentHeight = clampDimensionLocal(surface?.height ?? 1);
    const viewportWidth = clampDimensionLocal(viewport?.width ?? 1);
    const viewportHeight = clampDimensionLocal(viewport?.height ?? 1);

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

    let translateX = 0;
    let translateY = 0;

    if (safeAlignment.fit !== 'percent') {
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

    if (safeAlignment.fit === 'percent') {
      const percent = safeAlignment.offsetPercent ?? { x: 0, y: 0 };
      const percentX = Math.max(-100, Math.min(100, Number(percent.x) || 0));
      const percentY = Math.max(-100, Math.min(100, Number(percent.y) || 0));
      const availableX = viewportWidth - scaledWidth;
      const availableY = viewportHeight - scaledHeight;
      translateX = availableX * (percentX / 100);
      translateY = availableY * (percentY / 100);
    }

    if (safeAlignment.offsetPx) {
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
      if (!layer || layer.hidden) {
        continue;
      }

      const main = flow === 'row'
        ? clampDimensionLocal(layer.surface?.width)
        : clampDimensionLocal(layer.surface?.height);
      const cross = flow === 'row'
        ? clampDimensionLocal(layer.surface?.height)
        : clampDimensionLocal(layer.surface?.width);

      let activeLine = ensureCurrentLine();
      const prospective = activeLine.mainSize === 0
        ? main
        : activeLine.mainSize + safeGap + main;

      if (wrap && activeLine.items.length > 0 && prospective > limit) {
        currentLine = null;
        activeLine = ensureCurrentLine();
      }

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

    const safeGap = Math.max(0, gap || 0);
    const rawMain = line.items.reduce((acc, item) => acc + item.main, 0);
    const totalBase = rawMain + safeGap * (count - 1);
    const leftover = contentMain - totalBase;
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

    const safeGap = Math.max(0, gap || 0);
    const baseSizes = lines.map((line) => line.crossSize);
    const baseTotal = baseSizes.reduce((acc, size) => acc + size, 0) + safeGap * Math.max(0, lines.length - 1);
    const free = contentCross - baseTotal;

    if (align === 'stretch' && lines.length > 0) {
      const extraPerLine = free > 0 ? free / lines.length : 0;
      const stretched = baseSizes.map((size) => size + extraPerLine);
      return { sizes: stretched, offset: 0 };
    }

    const positiveLeftover = free > 0 ? free : 0;

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
        const layer = item.layer;
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

    const results = [];
    layers.forEach((layer) => {
      if (!layer || layer.hidden) {
        return;
      }
      const placement = placements.get(layer.layerId);
      if (!placement) {
        return;
      }
      results.push(placement);
    });

    return results;
  };

  return {
    computeLayerTransform,
    resolveContainerLayout
  };
};

const layoutRuntimeFallback = createLayoutRuntimeFallback();
let computeLayerTransform = layoutRuntimeFallback.computeLayerTransform;
let resolveContainerLayout = layoutRuntimeFallback.resolveContainerLayout;

const clampFrameToViewport = (frame, viewport) => {
  const width = Math.max(1, Math.round(frame?.width ?? 1));
  const height = Math.max(1, Math.round(frame?.height ?? 1));

  if (viewport?.mode === 'project') {
    return {
      x: Math.round(frame?.x ?? 0),
      y: Math.round(frame?.y ?? 0),
      width,
      height
    };
  }

  const viewportWidth = Math.max(1, Math.round(viewport?.width ?? 1));
  const viewportHeight = Math.max(1, Math.round(viewport?.height ?? 1));
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, viewportHeight - height);
  const clampedX = Math.min(Math.max(Math.round(frame?.x ?? 0), 0), maxX);
  const clampedY = Math.min(Math.max(Math.round(frame?.y ?? 0), 0), maxY);
  return {
    x: clampedX,
    y: clampedY,
    width,
    height
  };
};

const shouldAttemptDynamicLayoutImport = typeof window !== 'undefined'
  && typeof window.location?.protocol === 'string'
  && window.location.protocol !== 'file:';

if (shouldAttemptDynamicLayoutImport) {
  import('./layout-runtime.js').then((runtime) => {
    if (runtime?.computeLayerTransform && runtime?.resolveContainerLayout) {
      computeLayerTransform = runtime.computeLayerTransform;
      resolveContainerLayout = runtime.resolveContainerLayout;
    }
  }).catch((error) => {
    console.warn('[viewer] Failed to load layout-runtime.js, using inline fallback', error);
  });
}

let viewerDiagnosticsEnabled = false;

const computeInitialDiagnostics = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.__TINYBRUSH_VIEWER_DEBUG__ === true) {
    return true;
  }
  try {
    if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
      return true;
    }
    if (window.localStorage && window.localStorage.getItem('tinybrushViewerDebug') === 'true') {
      return true;
    }
  } catch {
    // ignore resolution errors (e.g., file:// without localStorage)
  }
  return false;
};

const applyDiagnosticsFlag = (value) => {
  viewerDiagnosticsEnabled = Boolean(value);
  if (typeof window !== 'undefined') {
    window.__TINYBRUSH_VIEWER_DEBUG__ = viewerDiagnosticsEnabled;
  }
  return viewerDiagnosticsEnabled;
};

applyDiagnosticsFlag(computeInitialDiagnostics());

export const isViewerDiagnosticsEnabled = () => {
  if (typeof window !== 'undefined') {
    return window.__TINYBRUSH_VIEWER_DEBUG__ === true;
  }
  return viewerDiagnosticsEnabled;
};

export const setViewerDiagnosticsEnabled = (value, options = {}) => {
  const { persist = true } = options;
  const next = applyDiagnosticsFlag(value);
  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem('tinybrushViewerDebug', next ? 'true' : 'false');
    } catch {
      // ignore persistence failures (e.g., file:// without localStorage)
    }
  }
  return next;
};

export const debugLog = (...args) => {
  if (isViewerDiagnosticsEnabled()) {
    console.log('[DEBUG]', ...args);
  }
};

export const debugWarn = (...args) => {
  if (isViewerDiagnosticsEnabled()) {
    console.warn('[DEBUG]', ...args);
  }
};

export const debugError = (...args) => {
  if (isViewerDiagnosticsEnabled()) {
    console.error('[DEBUG]', ...args);
  }
};

if (typeof window !== 'undefined') {
  window.tinybrushViewerSetDiagnostics = (value) => setViewerDiagnosticsEnabled(value);
}

const ACTIVE_CANVASES = new Map();
let resizeListenerAttached = false;

const computeResponsiveScale = (metadata) => {
  if (typeof window === 'undefined' || !metadata || !metadata.viewport) {
    return 1;
  }
  const viewport = metadata.viewport ?? {};
  const width = Number(viewport.width) || 0;
  const height = Number(viewport.height) || 0;
  if (!width || !height) {
    return 1;
  }
  if (viewport.mode === 'project') {
    return 1;
  }
  const viewportWidth = window.innerWidth || width;
  const viewportHeight = window.innerHeight || height;
  const widthRatio = viewportWidth / width;
  const heightRatio = viewportHeight / height;
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return 1;
  }
  if (viewport.mode === 'fill') {
    return {
      x: widthRatio,
      y: heightRatio
    };
  }
  const baseScale = Math.min(widthRatio, heightRatio, 1);
  return baseScale > 0 ? baseScale : 1;
};

const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err ?? new Error('Failed to load image'));
    img.src = src;
  });
};

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
  fb: 'fallback',
  i: 'id',
  n: 'name',
  t: 'type',
  vi: 'visible',
  o: 'opacity',
  bm: 'blendMode',
  al: 'alignment',
  opx: 'offsetPx',
  opc: 'offsetPercent',
  fr: 'frame',
  tr: 'transform',
  ss: 'sourceSize',
  cb: 'contentBounds',
  as: 'assets',
  cc: 'colorCycle',
  w: 'width',
  h: 'height',
  x: 'x',
  y: 'y',
  tx: 'translateX',
  ty: 'translateY',
  sx: 'scaleX',
  sy: 'scaleY',
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
  grl: 'gradients',
  spd: 'brushSpeed',
  si: 'stackIndex',
  bf: 'bundleFormat',
  ihl: 'includeHiddenLayers',
  ecf: 'embedCanvasFallback',
  mo: 'minifyOutput',
  plp: 'perfectLoop',
  tfm: 'totalFrames',
  ds: 'durationSeconds',
  pm: 'phaseMap'
};

const expandMinifiedProperties = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => expandMinifiedProperties(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const expanded = {};
  for (const [key, nested] of Object.entries(value)) {
    const restoredKey = PROPERTY_UNMINIFY_MAP[key] || key;
    expanded[restoredKey] = expandMinifiedProperties(nested);
  }
  return expanded;
};

const expandTinyBrushMetadata = (metadata) => {
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
    console.warn('[viewer] Failed to expand minified metadata', error);
    return metadata;
  }
};

if (typeof window !== 'undefined') {
  window.expandTinyBrushMetadata = expandTinyBrushMetadata;
}

const restoreSharedGradients = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers) || !Array.isArray(metadata.gradients)) {
    return metadata;
  }

  const shared = metadata.gradients;
  metadata.layers.forEach((layer) => {
    const colorCycle = layer?.colorCycle;
    if (!colorCycle || typeof colorCycle.gradientRef !== 'number') {
      return;
    }
    const gradient = shared[colorCycle.gradientRef];
    if (Array.isArray(gradient)) {
      colorCycle.gradient = gradient;
    }
  });

  return metadata;
};

const toFinite = (value, fallback = 0) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeScaleOption = (scaleOption) => {
  if (typeof scaleOption === 'number') {
    const numeric = scaleOption > 0 ? scaleOption : 1;
    return { x: numeric, y: numeric };
  }
  if (scaleOption && typeof scaleOption === 'object') {
    const rawX = typeof scaleOption.x === 'number' ? scaleOption.x : 1;
    const rawY = typeof scaleOption.y === 'number' ? scaleOption.y : 1;
    const x = rawX > 0 ? rawX : 1;
    const y = rawY > 0 ? rawY : 1;
    return { x, y };
  }
  return { x: 1, y: 1 };
};

const MIN_DIMENSION = 1e-3;

const clampDimension = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DIMENSION;
  }
  return value;
};

const applyLayer = (ctx, img, layer, globalScale) => {
  if (!img) {
    return false;
  }

  const frame = layer?.frame ?? {};
  const transform = layer?.transform ?? {};
  const sourceSize = layer?.sourceSize ?? {};
  const width = Math.max(1, toFinite(sourceSize.width, img.naturalWidth || img.width || 1));
  const height = Math.max(1, toFinite(sourceSize.height, img.naturalHeight || img.height || 1));
  const contentBounds = layer?.contentBounds ?? null;
  const sourceX = Math.max(0, toFinite(contentBounds?.x, 0));
  const sourceY = Math.max(0, toFinite(contentBounds?.y, 0));
  const cropWidth = Math.max(1, Math.min(toFinite(contentBounds?.width, width), width - sourceX));
  const cropHeight = Math.max(1, Math.min(toFinite(contentBounds?.height, height), height - sourceY));

  const frameX = toFinite(frame.x, 0);
  const frameY = toFinite(frame.y, 0);
  const translateX = toFinite(transform.translateX, 0);
  const translateY = toFinite(transform.translateY, 0);
  const layerScaleX = toFinite(transform.scaleX, 1);
  const layerScaleY = toFinite(transform.scaleY, 1);
  const rotation = toFinite(transform.rotation, 0);

  const globalScaleX = toFinite(globalScale?.x ?? globalScale, 1);
  const globalScaleY = toFinite(globalScale?.y ?? globalScale, 1);
  const normalizedScaleX = globalScaleX > 0 ? globalScaleX : 1;
  const normalizedScaleY = globalScaleY > 0 ? globalScaleY : 1;

  // If the layer has alignment settings and has been through layout calculation,
  // its transform already includes the necessary scaling
  const layerAlignment = layer?.alignment;
  const alignmentFit = layerAlignment?.fit || 'none';
  const hasCalculatedTransform = layer?._hasCalculatedTransform === true
    && layer.frame
    && layer.transform;

  const transformInViewportSpace = layer?._transformIsViewportScaled === true;

  // Layers with explicit 'none' fit should remain at project scale even when the
  // viewport scales; only apply global scaling when the transform is not already
  // expressed in viewport space and the alignment requests responsive sizing.
  const wantsGlobalScale = !transformInViewportSpace && alignmentFit !== 'none';

  const effectiveGlobalScaleX = wantsGlobalScale ? normalizedScaleX : 1;
  const effectiveGlobalScaleY = wantsGlobalScale ? normalizedScaleY : 1;

  const canvasWidth = ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.canvas?.height ?? 0;

  let destX;
  let destY;
  let scaledWidth;
  let scaledHeight;

  if (hasCalculatedTransform) {
    const calcFrame = layer.frame || { x: 0, y: 0 };
    const calcTransform = layer.transform || { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };
    const calcTranslateX = toFinite(calcTransform.translateX, 0);
    const calcTranslateY = toFinite(calcTransform.translateY, 0);
    const calcScaleX = toFinite(calcTransform.scaleX, 1);
    const calcScaleY = toFinite(calcTransform.scaleY, 1);

    destX = (calcFrame.x + calcTranslateX) * effectiveGlobalScaleX;
    destY = (calcFrame.y + calcTranslateY) * effectiveGlobalScaleY;
    scaledWidth = cropWidth * calcScaleX * effectiveGlobalScaleX;
    scaledHeight = cropHeight * calcScaleY * effectiveGlobalScaleY;
  } else {
    destX = (frameX + translateX) * effectiveGlobalScaleX;
    destY = (frameY + translateY) * effectiveGlobalScaleY;
    scaledWidth = cropWidth * layerScaleX * effectiveGlobalScaleX;
    scaledHeight = cropHeight * layerScaleY * effectiveGlobalScaleY;
  }

  if (viewerDiagnosticsEnabled && layerAlignment?.fit) {
    console.log('[LAYER DEBUG] Layer with alignment fit:', layerAlignment.fit, {
      layerId: layer?.id,
      fit: layerAlignment?.fit,
      hasCalculatedTransform,
      globalScale: { x: normalizedScaleX, y: normalizedScaleY },
      effectiveScale: { x: effectiveGlobalScaleX, y: effectiveGlobalScaleY },
      frame: hasCalculatedTransform ? layer.frame : { x: frameX, y: frameY },
      transform: hasCalculatedTransform ? layer.transform : { translateX, translateY, scaleX: layerScaleX, scaleY: layerScaleY },
      finalDest: { x: destX, y: destY },
      finalSize: { width: scaledWidth, height: scaledHeight },
      alignment: layerAlignment
    });
  }
  const bounds = {
    x: destX,
    y: destY,
    width: scaledWidth,
    height: scaledHeight
  };
  const offscreen = (
    bounds.x + bounds.width <= 0
    || bounds.y + bounds.height <= 0
    || bounds.x >= canvasWidth
    || bounds.y >= canvasHeight
  );
  debugLog('applyLayer positioning', {
    id: layer?.id,
    frameX,
    frameY,
    translateX,
    translateY,
    layerScaleX,
    layerScaleY,
    rotationDegrees: rotation * (180 / Math.PI),
    canvasWidth,
    canvasHeight,
    bounds,
    offscreen
  });
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, layer?.opacity ?? 1));
  ctx.globalCompositeOperation = layer?.blendMode || 'source-over';

  if (viewerDiagnosticsEnabled && typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
    try {
      const testCtx = img.getContext('2d', { willReadFrequently: true });
      if (testCtx) {
        const sampleWidth = Math.min(img.width || img.naturalWidth || 1, 10);
        const sampleHeight = Math.min(img.height || img.naturalHeight || 1, 10);
        if (sampleWidth > 0 && sampleHeight > 0) {
          const sampleData = testCtx.getImageData(0, 0, sampleWidth, sampleHeight);
          let hasVisiblePixels = false;
          for (let i = 3; i < sampleData.data.length; i += 4) {
            if (sampleData.data[i] > 0) {
              hasVisiblePixels = true;
              break;
            }
          }
          debugLog('Layer image content check', {
            layerId: layer?.id,
            imageSize: { width: img.width, height: img.height },
            sampleSize: { width: sampleWidth, height: sampleHeight },
            hasVisiblePixels,
            firstPixelAlpha: sampleData.data[3]
          });
        }
      }
    } catch (error) {
      debugWarn('Layer image content check failed', {
        layerId: layer?.id,
        error
      });
    }
  }

  if (hasCalculatedTransform) {
    ctx.translate(destX, destY);
    if (rotation !== 0) {
      ctx.rotate(rotation);
    }
    ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, scaledWidth, scaledHeight);
  } else {
    // Only use global scale for layers without alignment settings
    ctx.scale(normalizedScaleX, normalizedScaleY);
    ctx.translate(frameX + translateX, frameY + translateY);
    if (rotation !== 0) {
      ctx.rotate(rotation);
    }
    ctx.scale(layerScaleX, layerScaleY);
    ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  }
  ctx.restore();
  return true;
};

const normalizeBlend = (mode) => (mode === 'normal' || !mode ? 'source-over' : mode);

const validateMetadata = (metadata) => {
  if (!metadata || metadata.format !== 'tinybrush-webgl') {
    throw new Error('Unsupported bundle format');
  }
  if (!metadata.viewport || !metadata.viewport.width || !metadata.viewport.height) {
    throw new Error('Missing viewport dimensions');
  }
  if (!Array.isArray(metadata.layers)) {
    throw new Error('Layers array missing or invalid');
  }
};

const B64Z_PREFIX = 'b64z:';

const decodeBase64ToUint8 = (base64) => {
  if (typeof base64 !== 'string') {
    throw new Error('Expected base64 string');
  }
  const normalized = base64.trim();
  const binary = atob(normalized);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const decompressWithStream = async (compressed) => {
  const DecompressionStreamCtor = typeof DecompressionStream === 'function' ? DecompressionStream : null;
  if (!DecompressionStreamCtor) {
    return null;
  }
  try {
    const sourceStream = typeof Blob !== 'undefined' && typeof Blob.prototype?.stream === 'function'
      ? new Blob([compressed]).stream()
      : new Response(compressed).body;
    if (!sourceStream) {
      return null;
    }
    const stream = sourceStream.pipeThrough(new DecompressionStreamCtor('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.warn('[viewer] DecompressionStream fallback failed', error);
    return null;
  }
};

const inflateRawFallback = (compressed) => {
  try {
    const result = inflateRaw(compressed);
    return result && result.length ? result : null;
  } catch (error) {
    console.warn('[viewer] inflateRaw fallback failed', error);
    return null;
  }
};

const decompressB64ZPayload = async (payload) => {
  if (typeof payload !== 'string' || !payload.startsWith(B64Z_PREFIX)) {
    return null;
  }

  const base64Part = payload.slice(B64Z_PREFIX.length);
  const compressed = decodeBase64ToUint8(base64Part);

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

const hasNumericPayload = (value) => {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return value.startsWith(B64Z_PREFIX);
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Uint8Array) {
    return value.length > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.length > 0;
  }
  return false;
};

const DEFAULT_ANIMATION_SPEED = 0.1;

const resolveAnimationSpeed = (rawExportedSpeed, rawFallbackSpeed, shouldAnimate) => {
  const exportedSpeed = Number.isFinite(rawExportedSpeed) ? Number(rawExportedSpeed) : null;
  const fallbackSpeed = Number.isFinite(rawFallbackSpeed) ? Number(rawFallbackSpeed) : null;
  if (exportedSpeed !== null && exportedSpeed > 0) {
    return exportedSpeed;
  }
  if (shouldAnimate) {
    if (fallbackSpeed !== null && fallbackSpeed > 0) {
      return fallbackSpeed;
    }
    return DEFAULT_ANIMATION_SPEED;
  }
  if (exportedSpeed !== null) {
    return Math.max(0, exportedSpeed);
  }
  if (fallbackSpeed !== null) {
    return Math.max(0, fallbackSpeed);
  }
  return 0;
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


const RENDERER_KEY = Symbol('TinyBrushRenderer');

const clamp01 = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const clamp255 = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
};

const wrap01 = (value) => {
  let result = value % 1;
  if (result < 0) result += 1;
  return result;
};

const reflect01 = (value) => {
  const two = 2;
  let t = value % two;
  if (t < 0) t += two;
  return t <= 1 ? t : (two - t);
};

const normalizeFlowDirection = (direction, fallback = 'forward') => {
  if (typeof direction !== 'string') {
    return fallback;
  }

  const value = direction.trim().toLowerCase();
  if (value === 'forward') {
    return 'forward';
  }
  if (value === 'reverse' || value === 'backward') {
    return 'reverse';
  }
  if (value === 'pingpong' || value === 'bounce') {
    return value;
  }

  return fallback;
};

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

  const hexMatch = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
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
        const rawAlpha = parts[3].endsWith('%') ? (parseFloat(parts[3]) / 100) : parseFloat(parts[3]);
        if (Number.isFinite(rawAlpha)) {
          a = rawAlpha <= 1 ? clamp255(rawAlpha * 255) : clamp255(rawAlpha);
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
    .map((stop) => {
      const position = clamp01(typeof stop?.position === 'number' ? stop.position : parseFloat(stop?.position ?? 0));
      return {
        position,
        rgba: parseColor(stop?.color ?? '#ffffff')
      };
    })
    .sort((a, b) => a.position - b.position);

  if (normalized.length === 0) {
    return DEFAULT_GRADIENT.map((entry) => ({ position: entry.position, rgba: { ...entry.rgba } }));
  }

  const result = normalized.map((entry) => ({ position: entry.position, rgba: entry.rgba }));
  if (result[0].position > 0) {
    result.unshift({ position: 0, rgba: result[0].rgba });
  }
  const last = result[result.length - 1];
  if (last.position < 1) {
    result.push({ position: 1, rgba: last.rgba });
  }
  if (result.length === 1) {
    result.push({ position: 1, rgba: result[0].rgba });
  }
  return result;
};

const rgbaToCss = ({ r, g, b, a }) => {
  const alpha = Math.max(0, Math.min(1, a / 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const sampleGradient = (gradient, position) => {
  if (!Array.isArray(gradient) || gradient.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  if (gradient.length === 1) {
    return { ...gradient[0].rgba };
  }

  const pos = clamp01(position);
  for (let i = 0; i < gradient.length - 1; i++) {
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

  const fallback = gradient[gradient.length - 1];
  return { ...fallback.rgba };
};

const buildGradientLUT = ({
  gradient,
  cycleColors,
  tick,
  mappingMode,
  flowDirection,
  indexPhaseMap
}) => {
  const lut = new Uint32Array(256);
  const bands = Math.max(1, Math.floor(Number.isFinite(cycleColors) ? cycleColors : 16));
  const mode = mappingMode === 'continuous' ? 'continuous' : 'banded';
  const normalizedDirection = normalizeFlowDirection(flowDirection);
  const directionSign = normalizedDirection === 'reverse' ? -1 : 1;
  const pingpong = normalizedDirection === 'pingpong' || normalizedDirection === 'bounce';
  const normalizedShift = directionSign * (Number.isFinite(tick) ? tick : 0) / bands;

  for (let i = 0; i < 256; i++) {
    let phaseBase;
    if (mode === 'continuous') {
      phaseBase = indexPhaseMap ? indexPhaseMap[i] / 255 : i / 255;
    } else {
      if (indexPhaseMap) {
        const bandIndex = Math.max(0, Math.min(bands - 1, Math.floor((indexPhaseMap[i] / 255) * bands)));
        phaseBase = bandIndex / bands;
      } else {
        phaseBase = (i % bands) / bands;
      }
    }

    let positionValue;
    if (pingpong) {
      positionValue = reflect01(phaseBase + normalizedShift);
    } else {
      positionValue = wrap01(phaseBase + (normalizedShift % 1));
    }

    if (positionValue >= 1) positionValue = 0.999999;
    if (positionValue < 0) positionValue = 0;

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
    for (let i = 0; i < length; i++) {
      outPixels32[i] = 0;
    }
    return;
  }

  if (useAlpha) {
    for (let i = 0, aIdx = 3; i < length; i++, aIdx += 4) {
      const rawIndex = indices[i] ?? 0;
      if (transparentZero && rawIndex === 0) {
        outPixels32[i] = 0;
        continue;
      }
      const effectiveIndex = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
      const cappedIndex = effectiveIndex >= 0 && effectiveIndex < lut.length ? effectiveIndex : ((effectiveIndex % lut.length) + lut.length) % lut.length;
      const rgb = lut[cappedIndex] & 0x00ffffff;
      const a = alpha[aIdx];
      outPixels32[i] = (a << 24) | rgb;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const rawIndex = indices[i] ?? 0;
      if (transparentZero && rawIndex === 0) {
        outPixels32[i] = 0;
        continue;
      }
      const effectiveIndex = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
      const cappedIndex = effectiveIndex >= 0 && effectiveIndex < lut.length ? effectiveIndex : ((effectiveIndex % lut.length) + lut.length) % lut.length;
      outPixels32[i] = lut[cappedIndex];
    }
  }
};

const fillPixelsFromPhaseMap = (phaseMap, lut, outPixels32, alpha) => {
  const length = Math.min(phaseMap.length, outPixels32.length);
  if (alpha && alpha.length >= length * 4) {
    for (let i = 0, aIdx = 3; i < length; i++, aIdx += 4) {
      const rgb = lut[phaseMap[i]] & 0x00ffffff;
      const a = alpha[aIdx];
      outPixels32[i] = (a << 24) | rgb;
    }
  } else {
    for (let i = 0; i < length; i++) {
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, idx++) {
      const projection = x * cos + y * sin;
      let phase = projection * invWave;
      phase = phase - Math.floor(phase);
      map[idx] = clamp255(phase * 255);
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
    map[idx++] = clamp255(luminance);
  }
  return map;
};

class ColorCycleLayerPlayer {
  constructor(layer, textureImage) {
    this.layer = layer;
    this.image = textureImage;
    const width = Math.max(1, Math.round(layer.sourceSize?.width ?? textureImage?.naturalWidth ?? 1));
    const height = Math.max(1, Math.round(layer.sourceSize?.height ?? textureImage?.naturalHeight ?? 1));
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
    this.speed = 0.1;
    this.currentTick = 0;
    this.isAnimating = true;
    this.mode = layer.colorCycle?.mode ?? 'brush';
    this.zeroTransparent = false;
    this.subtractIndexOffset = false;
  }

  createSurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) {
      throw new Error('Failed to create 2D context for color cycle layer');
    }
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
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

    if (hasRecolor && (!colorCycle.mode || colorCycle.mode === 'recolor')) {
      this.mode = 'recolor';
      const settings = recolorSettings;
      if (!settings) {
        throw new Error('Color cycle settings missing');
      }

      const indexBuffer = await resolveNumericBuffer(settings.indexBuffer);
      if (!indexBuffer || indexBuffer.length === 0) {
        throw new Error('Color cycle settings missing index buffer');
      }

      this.zeroTransparent = false;
      this.subtractIndexOffset = false;
      this.indexBuffer = indexBuffer;
      const indexPhaseMap = await resolveNumericBuffer(settings.indexPhaseMap);
      this.indexPhaseMap = indexPhaseMap && indexPhaseMap.length ? indexPhaseMap : null;
      const phaseMap = await resolveNumericBuffer(settings.phaseMap);
      this.phaseMap = phaseMap && phaseMap.length ? phaseMap : null;
      this.gradient = normalizeGradientStops(settings.gradient);
      this.cycleColors = Math.max(1, Math.floor(Number.isFinite(settings.cycleColors) ? settings.cycleColors : 16));
      this.mappingMode = settings.mappingMode === 'continuous' ? 'continuous' : 'banded';
      this.flowMapping = ['palette', 'directional', 'luminance'].includes(settings.flowMapping) ? settings.flowMapping : 'palette';

      const animation = settings.animation || {};
      const exportedSpeed = Number.isFinite(animation.speed) ? animation.speed : null;
      const fallbackSpeed = Number.isFinite(colorCycle?.brushSpeed) ? colorCycle.brushSpeed : null;
      const shouldAnimate = (animation.isPlaying ?? colorCycle?.isAnimating) !== false;
      this.speed = resolveAnimationSpeed(exportedSpeed, fallbackSpeed, shouldAnimate);
      this.currentTick = Number.isFinite(animation.currentTick) ? animation.currentTick : 0;
      this.flowDirection = normalizeFlowDirection(animation.flowDirection, 'forward');
      this.isAnimating = shouldAnimate;
    } else if (hasBrush) {
      this.mode = 'brush';
      const state = brushState;
      const stateWidth = Number.isFinite(state?.width) ? Number(state.width) : this.width;
      const stateHeight = Number.isFinite(state?.height) ? Number(state.height) : this.height;
      if (stateWidth > 0 && stateHeight > 0 && (stateWidth !== this.width || stateHeight !== this.height)) {
        this.createSurface(stateWidth, stateHeight);
      }

      const indexBuffer = await resolveNumericBuffer(state.indexBuffer);
      if (!indexBuffer || indexBuffer.length === 0) {
        throw new Error('Brush state missing index buffer');
      }
      this.indexBuffer = indexBuffer;
      this.indexPhaseMap = null;
      this.phaseMap = null;

      const gradientStops = state.gradientStops && state.gradientStops.length > 0
        ? state.gradientStops
        : (colorCycle.gradient ?? []);
      this.gradient = normalizeGradientStops(gradientStops);
      const paletteLength = Array.isArray(state.palette) && state.palette.length > 0
        ? state.palette.length
        : 256;
      this.cycleColors = Math.max(1, Math.floor(paletteLength));
      this.mappingMode = 'continuous';
      this.flowMapping = 'palette';
      this.zeroTransparent = true;
      this.subtractIndexOffset = true;

      const exportedSpeed = Number.isFinite(state?.animationSpeed) ? state.animationSpeed : null;
      const fallbackSpeed = Number.isFinite(colorCycle.brushSpeed) ? colorCycle.brushSpeed : null;
      const shouldAnimate = colorCycle.isAnimating !== false;
      this.speed = resolveAnimationSpeed(exportedSpeed, fallbackSpeed, shouldAnimate);
      const offset = Number.isFinite(state.animationOffset) ? Number(state.animationOffset) : 0;
      const normalizedOffset = ((offset % 1) + 1) % 1;
      this.currentTick = normalizedOffset * this.cycleColors;
      this.flowDirection = normalizeFlowDirection(state.flowDirection, 'reverse');
      this.isAnimating = shouldAnimate;

      const expectedLength = this.width * this.height;
      if (this.indexBuffer.length !== expectedLength) {
        const resized = new Uint8Array(expectedLength);
        const copyLength = Math.min(expectedLength, this.indexBuffer.length);
        resized.set(this.indexBuffer.subarray(0, copyLength));
        this.indexBuffer = resized;
      }
    } else if (hasRecolor) {
      this.mode = 'recolor';
      const settings = recolorSettings;
      const indexBuffer = await resolveNumericBuffer(settings.indexBuffer);
      if (!indexBuffer || indexBuffer.length === 0) {
        throw new Error('Color cycle settings missing index buffer');
      }
      this.zeroTransparent = false;
      this.subtractIndexOffset = false;
      this.indexBuffer = indexBuffer;
      const indexPhaseMap = await resolveNumericBuffer(settings.indexPhaseMap);
      this.indexPhaseMap = indexPhaseMap && indexPhaseMap.length ? indexPhaseMap : null;
      const phaseMap = await resolveNumericBuffer(settings.phaseMap);
      this.phaseMap = phaseMap && phaseMap.length ? phaseMap : null;
      this.gradient = normalizeGradientStops(settings.gradient);
      this.cycleColors = Math.max(1, Math.floor(Number.isFinite(settings.cycleColors) ? settings.cycleColors : 16));
      this.mappingMode = settings.mappingMode === 'continuous' ? 'continuous' : 'banded';
      this.flowMapping = ['palette', 'directional', 'luminance'].includes(settings.flowMapping) ? settings.flowMapping : 'palette';

      const animation = settings.animation || {};
      const exportedSpeed = Number.isFinite(animation.speed) ? animation.speed : null;
      const fallbackSpeed = Number.isFinite(colorCycle?.brushSpeed) ? colorCycle.brushSpeed : null;
      const shouldAnimate = (animation.isPlaying ?? colorCycle?.isAnimating) !== false;
      this.speed = resolveAnimationSpeed(exportedSpeed, fallbackSpeed, shouldAnimate);
      this.currentTick = Number.isFinite(animation.currentTick) ? animation.currentTick : 0;
      this.flowDirection = normalizeFlowDirection(animation.flowDirection, 'forward');
      this.isAnimating = shouldAnimate;
    } else {
      throw new Error('Color cycle settings missing index buffer');
    }

    if (this.indexBuffer instanceof Uint8Array && this.indexBuffer.length === 0) {
      throw new Error('Color cycle index buffer is empty');
    }

    if (this.image) {
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

    if (this.mode === 'recolor') {
      const settings = recolorSettings;
      if (!this.phaseMap && this.flowMapping === 'directional') {
        const angle = Number.isFinite(settings?.directionAngle) ? settings.directionAngle : 0;
        const wavelength = Number.isFinite(settings?.bandWidthPx) && settings.bandWidthPx > 0 ? settings.bandWidthPx : 64;
        this.phaseMap = buildDirectionalPhaseMap(this.width, this.height, angle ?? 0, wavelength ?? 64);
      }

      if (!this.phaseMap && this.flowMapping === 'luminance' && this.baseImageData) {
        this.phaseMap = buildLuminancePhaseMap(this.baseImageData);
      }
    }

    debugLog('ColorCycleLayerPlayer init summary', {
      mode: this.mode,
      speed: this.speed,
      isAnimating: this.isAnimating,
      cycleColors: this.cycleColors,
      hasAnimation: this.hasAnimation(),
      width: this.width,
      height: this.height
    });

    this.renderFrame();

    const canvas = this.getCanvas();
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (viewerDiagnosticsEnabled) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let nonTransparentPixels = 0;
        for (let i = 3; i < imageData.data.length; i += 4) {
          if (imageData.data[i] > 0) {
            nonTransparentPixels += 1;
          }
        }
        const totalPixels = canvas.width * canvas.height || 1;
        const percentFilled = (nonTransparentPixels / totalPixels) * 100;
        debugLog('Player canvas check', {
          width: canvas.width,
          height: canvas.height,
          nonTransparentPixels,
          percentFilled: `${percentFilled.toFixed(2)}%`
        });
      }
    } else {
      debugWarn('Player canvas check skipped: 2D context unavailable');
      console.warn('TinyBrush Viewer: 2D context unavailable during player canvas check');
    }
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
      debugLog('renderFrame: No indexBuffer');
      return;
    }
    debugLog('renderFrame invoked', {
      indexBufferLength: this.indexBuffer.length,
      width: this.width,
      height: this.height,
      mode: this.mode,
      flowMapping: this.flowMapping
    });
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
    if (viewerDiagnosticsEnabled) {
      const testPixel = this.ctx.getImageData(0, 0, 1, 1).data;
      debugLog('First pixel after render', Array.from(testPixel));
    }
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

class TinyBrushBundleRenderer {
  constructor(metadata, canvas, options, sourceMetadata) {
    this.metadata = metadata;
    if (!this.metadata.exportLayout) {
      this.metadata.exportLayout = {
        sizeMode: 'viewport',
        padding: { top: 0, right: 0, bottom: 0, left: 0 }
      };
    }
    this.canvas = canvas;
    this.options = options || {};
    const { x, y } = normalizeScaleOption(this.options.scale);
    this.scaleX = x;
    this.scaleY = y;
    this.ctx = null;
    this.layers = [];
    this.dynamicPlayers = [];
    this.rafId = null;
    this.lastTimestamp = 0;
    this.isDestroyed = false;
    this.sourceMetadata = sourceMetadata ?? metadata;
    this.summary = {
      viewport: metadata.viewport,
      animation: metadata.animation,
      layers: metadata.layers.length,
      scale: { x: this.scaleX, y: this.scaleY }
    };
    this.handleAnimationFrame = this.handleAnimationFrame.bind(this);

    // Store original layer data RIGHT AWAY, before any modifications
    this.originalLayerData = new Map();
    this.originalLayerAlignments = new Map(); // Keep for backward compatibility
    if (metadata && metadata.layers) {
      metadata.layers.forEach(layer => {
        this.originalLayerData.set(layer.id, {
          alignment: layer.alignment ? { ...layer.alignment } : null,
          frame: layer.frame ? { ...layer.frame } : null,
          transform: layer.transform ? { ...layer.transform } : null,
          sourceSize: layer.sourceSize ? { ...layer.sourceSize } : null
        });

        // Also store in the old format for backward compatibility
        if (layer.alignment) {
          this.originalLayerAlignments.set(layer.id, { ...layer.alignment });
        }
      });
    }

    // Flag to prevent recalculation during initialization
    this.isInitialized = false;
  }

  setSourceMetadata(metadata) {
    this.sourceMetadata = metadata;
  }

  getSourceMetadata() {
    return this.sourceMetadata;
  }

  applyOriginalTransformsFallback() {
    if (!Array.isArray(this.layers)) {
      return;
    }

    const scaledViewport = {
      width: Math.max(1, Math.round(toFinite(this.canvas?.width, toFinite(this.metadata?.viewport?.width, 1)))),
      height: Math.max(1, Math.round(toFinite(this.canvas?.height, toFinite(this.metadata?.viewport?.height, 1))))
    };

    const originalViewport = {
      width: Math.max(1, Math.round(toFinite(this.metadata?.viewport?.width, scaledViewport.width))),
      height: Math.max(1, Math.round(toFinite(this.metadata?.viewport?.height, scaledViewport.height)))
    };

    this.layers.forEach((entry) => {
      const layer = entry?.layer;
      if (!layer) {
        return;
      }

      const original = this.originalLayerData?.get(layer.id);

      let frameCandidate;
      if (original?.frame) {
        frameCandidate = {
          x: toFinite(original.frame.x, 0),
          y: toFinite(original.frame.y, 0),
          width: Math.max(1, toFinite(original.frame.width, 1)),
          height: Math.max(1, toFinite(original.frame.height, 1))
        };
      } else if (layer.frame) {
        frameCandidate = {
          x: toFinite(layer.frame.x, 0),
          y: toFinite(layer.frame.y, 0),
          width: Math.max(1, toFinite(layer.frame.width, 1)),
          height: Math.max(1, toFinite(layer.frame.height, 1))
        };
      } else {
        const sourceSize = layer?.sourceSize || original?.sourceSize || {};
        frameCandidate = {
          x: 0,
          y: 0,
          width: Math.max(1, toFinite(sourceSize?.width, 1)),
          height: Math.max(1, toFinite(sourceSize?.height, 1))
        };
      }
      const alignmentSettings = layer?.alignment
        || original?.alignment
        || {
          fit: 'none',
          horizontal: 'left',
          vertical: 'top'
        };
      const alignmentFit = alignmentSettings?.fit || 'none';

      let resolvedFrame;
      if (alignmentFit === 'percent') {
        const sourceSize = layer?.sourceSize || original?.sourceSize || {};
        resolvedFrame = {
          x: Math.round(toFinite(frameCandidate.x, 0)),
          y: Math.round(toFinite(frameCandidate.y, 0)),
          width: Math.max(1, Math.round(toFinite(sourceSize?.width, frameCandidate.width))),
          height: Math.max(1, Math.round(toFinite(sourceSize?.height, frameCandidate.height)))
        };
      } else {
        resolvedFrame = clampFrameToViewport(frameCandidate, scaledViewport);
      }

      layer.frame = resolvedFrame;

      if (original?.transform) {
        layer.transform = {
          scaleX: toFinite(original.transform.scaleX, 1),
          scaleY: toFinite(original.transform.scaleY, 1),
          translateX: toFinite(original.transform.translateX, 0),
          translateY: toFinite(original.transform.translateY, 0),
          rotation: toFinite(original.transform.rotation, 0)
        };
        layer._transformIsViewportScaled = true;
      } else if (!layer.transform) {
        layer.transform = {
          scaleX: 1,
          scaleY: 1,
          translateX: 0,
          translateY: 0,
          rotation: 0
        };
        layer._transformIsViewportScaled = false;
      }

      const hasOriginalTransform = Boolean(original?.transform);

      if (alignmentFit !== 'none' && !hasOriginalTransform) {
        const contentBounds = layer?.contentBounds || null;
        const sourceSize = layer?.sourceSize || original?.sourceSize || {};
        const surfaceWidth = Math.max(1, toFinite(sourceSize?.width, 1));
        const surfaceHeight = Math.max(1, toFinite(sourceSize?.height, 1));
        const contentWidth = Math.max(1, toFinite(contentBounds?.width, surfaceWidth));
        const contentHeight = Math.max(1, toFinite(contentBounds?.height, surfaceHeight));
        const frameData = layer?.frame || {
          x: 0,
          y: 0,
          width: contentWidth,
          height: contentHeight
        };
        const viewportForTransform = alignmentFit === 'percent'
          ? {
              width: Math.max(1, toFinite(originalViewport.width, contentWidth)),
              height: Math.max(1, toFinite(originalViewport.height, contentHeight))
            }
          : {
              width: Math.max(1, toFinite(frameData.width, contentWidth)),
              height: Math.max(1, toFinite(frameData.height, contentHeight))
            };

        try {
          const computed = computeLayerTransform(
            { width: contentWidth, height: contentHeight },
            viewportForTransform,
            alignmentSettings
          );

          const rotation = Number.isFinite(layer.transform?.rotation)
            ? layer.transform.rotation
            : 0;

          layer.transform = {
            scaleX: toFinite(computed.scaleX, 1),
            scaleY: toFinite(computed.scaleY, 1),
            translateX: toFinite(computed.translateX, 0),
            translateY: toFinite(computed.translateY, 0),
            rotation
          };
          layer._hasCalculatedTransform = true;
          layer._transformIsViewportScaled = true;
        } catch (error) {
          console.warn('[viewer] Failed to recompute alignment transform', {
            layerId: layer.id,
            alignment: alignmentSettings,
            contentBounds,
            frame: frameData,
            error
          });
          layer._hasCalculatedTransform = false;
        }
      } else {
        const hasTransform = layer.transform
          && Number.isFinite(layer.transform.scaleX)
          && Number.isFinite(layer.transform.scaleY);
        layer._hasCalculatedTransform = alignmentFit !== 'none' && hasOriginalTransform;
        layer._transformIsViewportScaled = hasOriginalTransform;
        if (!hasTransform) {
          layer.transform = {
            scaleX: 1,
            scaleY: 1,
            translateX: 0,
            translateY: 0,
            rotation: Number.isFinite(layer.transform?.rotation)
              ? layer.transform.rotation
              : 0
          };
        }
      }
    });

    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] Falling back to original layer transforms', {
        layerCount: this.layers.length,
        originalLayerDataSize: this.originalLayerData?.size ?? 0
      });
    }
  }

  updateScale(scaleOption) {
    const { x, y } = normalizeScaleOption(scaleOption);
    const hasChanged = Math.abs(x - this.scaleX) > 1e-6 || Math.abs(y - this.scaleY) > 1e-6;
    this.scaleX = x;
    this.scaleY = y;
    this.options.scale = scaleOption;
    this.summary.scale = { x: this.scaleX, y: this.scaleY };

    const width = Math.max(1, Math.round(this.metadata.viewport.width * this.scaleX));
    const height = Math.max(1, Math.round(this.metadata.viewport.height * this.scaleY));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
      }
    }

    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] updateScale applied', {
        scaleX: this.scaleX,
        scaleY: this.scaleY,
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height,
        widthTarget: width,
        heightTarget: height
      });
    }

    // Only recalculate if we're actually initialized AND there's a real change
    if (hasChanged && this.isInitialized) {
      if (this.metadata?.exportLayout) {
        this.recalculateLayerTransforms(width, height);
      } else {
        this.applyOriginalTransformsFallback();
      }
      if (this.ctx) {
        this.renderOnce();
      }
    }
  }

  recalculateLayerTransforms(canvasWidth, canvasHeight) {
    console.log('[RESIZE DEBUG] recalculateLayerTransforms CALLED!', {
      canvasSize: { width: canvasWidth, height: canvasHeight },
      hasMetadata: !!this.metadata,
      hasExportLayout: !!this.metadata?.exportLayout,
      hasLayers: !!this.layers,
      layerCount: this.layers?.length || 0
    });

    if (!this.metadata || !this.layers) {
      console.log('[RESIZE DEBUG] recalculateLayerTransforms ABORTED - missing basic data');
      return;
    }

    const layout = this.metadata.exportLayout;
    if (!layout) {
      console.warn('[RESIZE DEBUG] Missing exportLayout - falling back to original transforms');
      this.applyOriginalTransformsFallback();
      return;
    }
    const resolvedWidth = Number.isFinite(canvasWidth) && canvasWidth > 0
      ? canvasWidth
      : (this.canvas?.width ?? this.metadata.viewport?.width ?? 1);
    const resolvedHeight = Number.isFinite(canvasHeight) && canvasHeight > 0
      ? canvasHeight
      : (this.canvas?.height ?? this.metadata.viewport?.height ?? 1);

    const viewportMode = this.metadata.viewport?.mode || this.metadata.viewportMode;
    const viewport = {
      width: Math.max(1, Math.round(resolvedWidth)),
      height: Math.max(1, Math.round(resolvedHeight)),
      mode: viewportMode
    };

    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] Recalculating with viewport', {
        viewportMode: this.metadata.viewportMode,
        originalViewport: this.metadata.viewport,
        currentViewport: viewport,
        windowSize: typeof window !== 'undefined'
          ? { width: window.innerWidth, height: window.innerHeight }
          : null,
        storedAlignments: Array.from(this.originalLayerAlignments.entries())
      });
    }

    // Recreate layout inputs for each layer using ORIGINAL alignment settings
    const inputs = this.layers.map(entry => {
      const layer = entry.layer;
      if (!layer || !layer.id) {
        console.warn('[DEBUG] Invalid layer in entry:', { entry, hasLayer: !!layer, layerId: layer?.id });
        return null;
      }

      const originalData = this.originalLayerData.get(layer.id);
      const originalAlignment = originalData?.alignment || this.originalLayerAlignments.get(layer.id);
      const alignment = layer.alignment || originalAlignment || {
        fit: 'none',
        horizontal: 'left',
        vertical: 'top'
      };

      const originalSourceSize = originalData?.sourceSize || layer.sourceSize;

      if (viewerDiagnosticsEnabled) {
        debugLog('[DEBUG] Layer alignment data', {
          layerId: layer.id,
          alignment,
          sourceSize: originalSourceSize,
          contentBounds: layer.contentBounds
        });
      }

      return {
        layerId: layer.id,
        surface: {
          width: originalSourceSize?.width || 1,
          height: originalSourceSize?.height || 1
        },
        content: layer.contentBounds ? {
          width: layer.contentBounds.width,
          height: layer.contentBounds.height
        } : undefined,
        alignment,
        hidden: false
      };
    });

    // Filter out invalid entries and recalculate layout using the same logic as the exporter
    const validInputs = inputs.filter(input => input !== null);
    const resolved = resolveContainerLayout(validInputs, layout, viewport);

    // Reset calculated flags before applying new transforms
    this.layers.forEach((entry) => {
      if (entry?.layer) {
        entry.layer._hasCalculatedTransform = false;
        entry.layer._transformIsViewportScaled = false;
      }
    });

    // Update layer metadata with new transforms
    resolved.forEach(resolvedLayer => {
      const entry = this.layers.find(e => e.layer && e.layer.id === resolvedLayer.layerId);
      if (entry && entry.layer) {
        const originalData = this.originalLayerData.get(entry.layer.id);
        const alignmentFit = (entry.layer.alignment?.fit
          || originalData?.alignment?.fit
          || this.originalLayerAlignments.get(entry.layer.id)?.fit
          || 'none');

        if (alignmentFit === 'none') {
          if (viewerDiagnosticsEnabled) {
            debugLog('[DEBUG] Preserving original transform for fixed-fit layer', {
              layerId: entry.layer.id,
              originalFrame: originalData?.frame,
              originalTransform: originalData?.transform
            });
          }

          const originalFrame = originalData?.frame || entry.layer.frame || {
            x: 0,
            y: 0,
            width: resolvedLayer.frame.width,
            height: resolvedLayer.frame.height
          };
          const clampedFrame = clampFrameToViewport({
            x: resolvedLayer.frame.x,
            y: resolvedLayer.frame.y,
            width: originalFrame.width,
            height: originalFrame.height
          }, viewport);

          const rotation = Number.isFinite(originalData?.transform?.rotation)
            ? originalData.transform.rotation
            : Number.isFinite(entry.layer.transform?.rotation)
              ? entry.layer.transform.rotation
              : 0;

          entry.layer.frame = clampedFrame;
          entry.layer.transform = {
            scaleX: 1,
            scaleY: 1,
            translateX: resolvedLayer.transform.translateX,
            translateY: resolvedLayer.transform.translateY,
            rotation
          };

          entry.layer._hasCalculatedTransform = true;
          entry.layer._transformIsViewportScaled = true;
          return;
        }

        const newFrame = {
          x: resolvedLayer.frame.x,
          y: resolvedLayer.frame.y,
          width: resolvedLayer.frame.width,
          height: resolvedLayer.frame.height
        };
        const clampedFrame = clampFrameToViewport(newFrame, viewport);
        const newTransform = {
          scaleX: resolvedLayer.transform.scaleX,
          scaleY: resolvedLayer.transform.scaleY,
          translateX: resolvedLayer.transform.translateX,
          translateY: resolvedLayer.transform.translateY
        };

        if (viewerDiagnosticsEnabled) {
          debugLog('[DEBUG] Updating layer transforms on resize', {
            layerId: entry.layer.id,
            originalAlignment: entry.layer.alignment,
            originalTransform: entry.layer.transform,
            newFrame,
            clampedFrame,
            newTransform
          });
        }
        entry.layer.frame = clampedFrame;
        entry.layer.transform = newTransform;

        entry.layer._hasCalculatedTransform = true;
        entry.layer._transformIsViewportScaled = true;
      } else {
        console.warn('[DEBUG] Could not find entry or entry.layer for layerId:', resolvedLayer.layerId, {
          entryFound: !!entry,
          layersStructure: this.layers.map(e => ({
            hasLayer: !!e.layer,
            layerId: e.layer?.id,
            keys: Object.keys(e)
          }))
        });
      }
    });

    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] recalculateLayerTransforms completed', {
        canvasWidth,
        canvasHeight,
        layerCount: resolved.length,
        resolved: resolved.map(r => ({
          id: r.layerId,
          frame: r.frame,
          transform: r.transform
        }))
      });
    }
  }

  async initialize() {
    const width = Math.max(1, Math.round(this.metadata.viewport.width * this.scaleX));
    const height = Math.max(1, Math.round(this.metadata.viewport.height * this.scaleY));

    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    this.ctx = ctx;

    await this.loadLayers();
    if (this.metadata?.exportLayout) {
      this.recalculateLayerTransforms(width, height);
    } else {
      this.applyOriginalTransformsFallback();
    }
    this.isInitialized = true;  // Set this AFTER loadLayers and initial transform pass
    this.renderOnce();
  }

  async loadLayers() {
    const entries = await Promise.all(this.metadata.layers.map(async (layer) => {
      let image = null;
      if (layer.assets?.texture) {
        try {
          image = await loadImage(layer.assets.texture);
        } catch (error) {
          console.warn(`[viewer] Failed to load texture for layer ${layer.id}`, error);
        }
      }

      let player = null;
      const hasRecolorBuffers = hasNumericPayload(layer.colorCycle?.recolorSettings?.indexBuffer);
      const hasBrushBuffers = hasNumericPayload(layer.colorCycle?.brushState?.indexBuffer);
      debugLog(`Layer ${layer.id} diagnostics`, {
        hasColorCycle: Boolean(layer.colorCycle),
        hasRecolorBuffers,
        hasBrushBuffers,
        mode: layer.colorCycle?.mode,
        willCreatePlayer: hasRecolorBuffers || hasBrushBuffers
      });
      if (hasRecolorBuffers || hasBrushBuffers) {
        try {
          player = new ColorCycleLayerPlayer(layer, image);
          debugLog('Player created, initializing…');
          await player.initialize();
          debugLog('Player initialized successfully');
        } catch (error) {
          debugError('Player init failed', error);
          console.warn(`[viewer] Failed to initialize color cycle animation for layer ${layer.id}`, error);
          player = null;
        }
      } else if (layer.colorCycle?.isAnimating) {
        console.warn(`[viewer] Color cycle mode "${layer.colorCycle.mode}" not yet supported for animation playback (layer ${layer.id}).`);
      }

      return { layer, image, player };
    }));

    entries.forEach((entry) => {
      entry.layer.blendMode = normalizeBlend(entry.layer.blendMode);
      entry.layer._hasCalculatedTransform = false;
      entry.layer._transformIsViewportScaled = false;
    });

    this.layers = entries;

    // Original layer data is already stored in constructor before any modifications

    this.dynamicPlayers = entries
      .map((entry) => entry.player)
      .filter((player) => player && player.hasAnimation());

    const texturelessLayers = entries
      .filter((entry) => entry.layer.visible !== false)
      .filter((entry) => !entry.layer.assets?.texture && !entry.layer.colorCycle);
    if (texturelessLayers.length > 0) {
      console.warn('[viewer] Some layers are missing textures:', texturelessLayers.map((entry) => entry.layer.id));
    }
  }

  renderOnce() {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (this.metadata?.project?.backgroundColor) {
      const parsedBackground = parseColor(this.metadata.project.backgroundColor);
      ctx.fillStyle = rgbaToCss(parsedBackground);
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const paintOrder = [...this.layers];
    const hasStackIndex = paintOrder.some((entry) => typeof entry?.layer?.stackIndex === 'number');
    if (hasStackIndex) {
      paintOrder.sort((a, b) => {
        const aIndex = typeof a?.layer?.stackIndex === 'number' ? a.layer.stackIndex : Number.MAX_SAFE_INTEGER;
        const bIndex = typeof b?.layer?.stackIndex === 'number' ? b.layer.stackIndex : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        return 0;
      });
    } else {
      paintOrder.reverse();
    }

    let paintedLayers = 0;
    for (let index = 0; index < paintOrder.length; index += 1) {
      const entry = paintOrder[index];
      const { layer } = entry;

      if (layer.visible === false) {
        continue;
      }
      const source = entry.player ? entry.player.getCanvas() : entry.image;
      if (!source) {
        if (entry.player) {
          debugLog('Skipping color cycle layer with no canvas source', layer.id);
          console.warn(`[viewer] Failed to paint color cycle layer ${layer.id}`);
        }
        continue;
      }
      const painted = applyLayer(ctx, source, layer, { x: this.scaleX, y: this.scaleY });
      if (painted) {
        paintedLayers++;
        if (entry.player) {
          debugLog('Painted color cycle layer', {
            id: layer.id,
            blendMode: layer.blendMode,
            opacity: layer.opacity,
            width: source.width,
            height: source.height
          });
        }
      } else if (entry.player) {
        debugWarn('Failed to paint color cycle layer', layer.id);
        console.warn(`[viewer] Failed to paint color cycle layer ${layer.id}`);
      }
    }

    if (paintedLayers === 0 && paintOrder.length > 0) {
      console.warn('[viewer] Render completed but no layers produced pixels.');
    }

    if (viewerDiagnosticsEnabled) {
      const composedPixel = ctx.getImageData(0, 0, 1, 1).data;
      debugLog('Composite canvas first pixel', Array.from(composedPixel));
    }

    ctx.restore();
  }

  start() {
    if (this.isDestroyed || this.dynamicPlayers.length === 0) {
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
    this.isDestroyed = true;
    this.stop();
    this.dynamicPlayers.forEach((player) => player && player.destroy());
    this.layers = [];
    this.dynamicPlayers = [];
  }

  ensureRunning() {
    if (this.isDestroyed) {
      return;
    }
    if (this.rafId === null) {
      this.lastTimestamp = performance.now();
      this.rafId = requestAnimationFrame(this.handleAnimationFrame);
    }
  }

  getSummary() {
    return { ...this.summary };
  }

  handleAnimationFrame(timestamp) {
    if (this.isDestroyed) {
      return;
    }
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    let needsRender = false;
    let advancedPlayers = 0;
    for (const player of this.dynamicPlayers) {
      if (player && player.advance(deltaSeconds)) {
        needsRender = true;
        advancedPlayers++;
      }
    }

    if (needsRender) {
      this.renderOnce();
    }

    this.rafId = requestAnimationFrame(this.handleAnimationFrame);
  }
}

export const renderTinyBrushWebGL = async (metadata, canvas, options = {}) => {
  const normalizedMetadata = restoreSharedGradients(expandTinyBrushMetadata(metadata));
  validateMetadata(normalizedMetadata);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A target canvas element is required');
  }

  const previous = canvas[RENDERER_KEY];
  if (viewerDiagnosticsEnabled && previous && typeof previous.getSourceMetadata === 'function') {
    const cachedSource = previous.getSourceMetadata();
    debugLog('[DEBUG] renderTinyBrushWebGL reuse check', {
      hasRenderer: true,
      sameMetadataReference: cachedSource === metadata
    });
  }
  if (previous
    && typeof previous.updateScale === 'function'
    && typeof previous.getSourceMetadata === 'function'
    && previous.getSourceMetadata() === metadata) {
    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] renderTinyBrushWebGL reusing renderer', {
        scaleOption: options.scale
      });
    }
    canvas.__tinybrushSourceMetadata = metadata;
    ACTIVE_CANVASES.set(canvas, metadata);
    ensureResizeListener();
    previous.updateScale(options.scale);
    previous.ensureRunning?.();
    return previous.getSummary();
  }
  if (previous && typeof previous.destroy === 'function') {
    previous.destroy();
  }

  const renderer = new TinyBrushBundleRenderer(normalizedMetadata, canvas, options, metadata);
  if (typeof renderer.setSourceMetadata === 'function') {
    renderer.setSourceMetadata(metadata);
  }
  await renderer.initialize();
  renderer.start();
  canvas[RENDERER_KEY] = renderer;
  canvas.__tinybrushSourceMetadata = metadata;
  ACTIVE_CANVASES.set(canvas, metadata);
  ensureResizeListener();

  const POINTER_GUARD_KEY = Symbol.for('TinyBrushPointerGuard');
  if (!canvas[POINTER_GUARD_KEY]) {
    const ensureRunning = () => {
      const active = canvas[RENDERER_KEY];
      if (active && typeof active.ensureRunning === 'function') {
        active.ensureRunning();
      }
    };
    const resumeEvents = ['mouseenter', 'mousemove', 'pointerdown', 'pointerup', 'focus'];
    resumeEvents.forEach((eventName) => {
      canvas.addEventListener(eventName, ensureRunning, { passive: true });
    });
    canvas[POINTER_GUARD_KEY] = {
      handler: ensureRunning,
      events: resumeEvents
    };
  }

  return renderer.getSummary();
};

export function resizeTinyBrushWebGL(canvas, scaleOption) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A target canvas element is required');
  }
  const renderer = canvas[RENDERER_KEY];
  if (!renderer || typeof renderer.updateScale !== 'function') {
    return null;
  }
  renderer.updateScale(scaleOption);
  renderer.ensureRunning?.();
  return renderer.getSummary?.() ?? null;
}

function handleWindowResize() {
  console.log('[RESIZE DEBUG] Window resize triggered!', {
    windowSize: { width: window.innerWidth, height: window.innerHeight },
    canvasCount: ACTIVE_CANVASES.size,
    diagnosticsEnabled: viewerDiagnosticsEnabled
  });

  ACTIVE_CANVASES.forEach((metadata, canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      ACTIVE_CANVASES.delete(canvas);
      return;
    }
    const scaleOption = computeResponsiveScale(metadata);
    if (viewerDiagnosticsEnabled) {
      debugLog('[DEBUG] handleWindowResize processing canvas', {
        canvasId: canvas.id,
        scaleOption,
        metadata: { viewport: metadata?.viewport, viewportMode: metadata?.viewportMode }
      });
    }
    resizeTinyBrushWebGL(canvas, scaleOption);
  });
}

function ensureResizeListener() {
  if (resizeListenerAttached || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('resize', handleWindowResize);
  resizeListenerAttached = true;
}
