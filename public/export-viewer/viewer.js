import { inflateRaw } from './fflate-inflate.js';

// ------------------------------------------------------------
// Diagnostics
// ------------------------------------------------------------
const resolveDiagnosticsDefault = () => {
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
    if (window.localStorage?.getItem('tinybrushViewerDebug') === 'true') {
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
      console.log('[TinyBrush Viewer]', ...args);
    }
  },
  warn: (...args) => {
    if (diagnosticsEnabled) {
      console.warn('[TinyBrush Viewer]', ...args);
    }
  },
  error: (...args) => {
    if (diagnosticsEnabled) {
      console.error('[TinyBrush Viewer]', ...args);
    }
  }
};

const setDiagnostics = (value) => {
  diagnosticsEnabled = Boolean(value);
  if (typeof window !== 'undefined') {
    window.__TINYBRUSH_VIEWER_DEBUG__ = diagnosticsEnabled;
    try {
      window.localStorage?.setItem('tinybrushViewerDebug', diagnosticsEnabled ? 'true' : 'false');
    } catch {
      // Ignore storage issues (e.g. private browsing, file://)
    }
  }
  diagnostics.log('Diagnostics toggled', { enabled: diagnosticsEnabled });
};

if (typeof window !== 'undefined') {
  window.__TINYBRUSH_VIEWER_DEBUG__ = diagnosticsEnabled;
  window.tinybrushViewerSetDiagnostics = setDiagnostics;
}

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

export const expandTinyBrushMetadata = (metadata) => {
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
    console.warn('[TinyBrush Viewer] Failed to expand minified metadata', error);
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
  const gradients = metadata.gradients;
  metadata.layers.forEach((layer) => {
    const ref = layer?.colorCycle?.gradientRef;
    if (typeof ref === 'number' && gradients[ref]) {
      layer.colorCycle.gradient = gradients[ref];
    }
  });
  return metadata;
};

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

const prepareMetadata = (metadata) => {
  const expanded = restoreSharedGradients(expandTinyBrushMetadata(deepClone(metadata)));
  validateMetadata(expanded);
  return expanded;
};

// ------------------------------------------------------------
// Layout engine (mirrors exporter logic)
// ------------------------------------------------------------
const LayoutEngine = (() => {
  const MIN_DIMENSION = 1e-3;

  const clampDimension = (value) => (Number.isFinite(value) && value > 0 ? value : MIN_DIMENSION);

  const defaultAlignment = () => ({
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
    offsetPx: { x: 0, y: 0 },
    offsetPercent: { x: 0, y: 0 }
  });

  const computeLayerTransform = (surface, viewport, rawAlignment = {}) => {
    const alignment = {
      ...defaultAlignment(),
      ...rawAlignment,
      offsetPx: {
        x: toFinite(rawAlignment?.offsetPx?.x, 0),
        y: toFinite(rawAlignment?.offsetPx?.y, 0)
      },
      offsetPercent: rawAlignment?.offsetPercent
        ? {
            x: toFinite(rawAlignment.offsetPercent.x, 0),
            y: toFinite(rawAlignment.offsetPercent.y, 0)
          }
        : { x: 0, y: 0 }
    };

    const contentWidth = clampDimension(surface?.width ?? 1);
    const contentHeight = clampDimension(surface?.height ?? 1);
    const viewportWidth = clampDimension(viewport?.width ?? 1);
    const viewportHeight = clampDimension(viewport?.height ?? 1);

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
      case 'fill': {
        scaleX = widthRatio;
        scaleY = heightRatio;
        break;
      }
      case 'fit-width': {
        scaleX = widthRatio;
        scaleY = widthRatio;
        break;
      }
      case 'fit-height': {
        scaleX = heightRatio;
        scaleY = heightRatio;
        break;
      }
      case 'scale-down': {
        const contain = Math.min(widthRatio, heightRatio);
        const scale = contain < 1 ? contain : 1;
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
        default:
          break;
      }

      switch (alignment.vertical) {
        case 'center':
          translateY = extraY / 2;
          break;
        case 'bottom':
          translateY = extraY;
          break;
        default:
          break;
      }
    }

    if (usesPercentFit || usesAutoPositioning) {
      const percent = alignment.offsetPercent || { x: 0, y: 0 };
      const percentX = clamp(percent.x / 100, -1, 1);
      const percentY = clamp(percent.y / 100, -1, 1);

      if (usesPercentFit) {
        translateX = viewportWidth * percentX;
        translateY = viewportHeight * percentY;
      } else {
        translateX += extraX * percentX;
        translateY += extraY * percentY;
      }
    }

    if (!usesPercentFit && !usesAutoPositioning) {
      translateX += alignment.offsetPx.x;
      translateY += alignment.offsetPx.y;
    }

    return {
      scaleX,
      scaleY,
      translateX,
      translateY,
      rotation: toFinite(rawAlignment?.rotation, 0)
    };
  };

  const clampFrameToViewport = (frame, viewport, alignmentFit) => {
    if (alignmentFit === 'percent') {
      return {
        x: Math.round(frame?.x ?? 0),
        y: Math.round(frame?.y ?? 0),
        width: Math.max(1, Math.round(frame?.width ?? 1)),
        height: Math.max(1, Math.round(frame?.height ?? 1))
      };
    }

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

    return {
      x: clamp(Math.round(frame?.x ?? 0), 0, maxX),
      y: clamp(Math.round(frame?.y ?? 0), 0, maxY),
      width,
      height
    };
  };

  return {
    computeLayerTransform,
    clampFrameToViewport
  };
})();

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

    const width = Math.max(1, Math.round(layer.sourceSize?.width ?? textureImage?.naturalWidth ?? textureImage?.width ?? 1));
    const height = Math.max(1, Math.round(layer.sourceSize?.height ?? textureImage?.naturalHeight ?? textureImage?.height ?? 1));

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
const applyLayerToContext = (ctx, source, layer, globalScale) => {
  if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
    return false;
  }

  diagnostics.log('[RENDER] Applying layer:', {
    layerId: layer.id,
    alignment: layer.alignment,
    frame: layer.frame,
    transform: layer.transform,
    globalScale,
    sourceSize: { width: source.width, height: source.height },
    sourceNaturalSize: source.naturalWidth
      ? { width: source.naturalWidth, height: source.naturalHeight }
      : null
  });

  const frame = layer.frame ?? { x: 0, y: 0, width: source.width, height: source.height };
  const transform = layer.transform ?? { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const bounds = layer.contentBounds ?? { x: 0, y: 0, width: layer.sourceSize?.width ?? source.width, height: layer.sourceSize?.height ?? source.height };

  const sourceX = clamp(bounds.x, 0, Number.MAX_SAFE_INTEGER);
  const sourceY = clamp(bounds.y, 0, Number.MAX_SAFE_INTEGER);
  const cropWidth = Math.max(1, toFinite(bounds.width, source.width));
  const cropHeight = Math.max(1, toFinite(bounds.height, source.height));

  const layoutMode = layer.layoutMode ?? layer.alignment?.fit;
  const isPercentAligned = layoutMode === 'percent';
  const isScaleObject = typeof globalScale === 'object' && globalScale !== null;
  const resolvedScaleX = toFinite(isScaleObject ? globalScale?.x : globalScale, 1);
  const resolvedScaleY = toFinite(
    isScaleObject ? (globalScale?.y ?? globalScale?.x) : globalScale,
    resolvedScaleX
  );
  let scaleX = resolvedScaleX;
  let scaleY = resolvedScaleY;
  if (isPercentAligned) {
    const uniformScale = Math.min(scaleX, scaleY);
    scaleX = uniformScale;
    scaleY = uniformScale;
  }

  const destX = toFinite(transform.translateX, toFinite(frame.x, 0)) * scaleX;
  const destY = toFinite(transform.translateY, toFinite(frame.y, 0)) * scaleY;
  const destWidth = cropWidth * toFinite(transform.scaleX, 1) * scaleX;
  const destHeight = cropHeight * toFinite(transform.scaleY, 1) * scaleY;
  const rotation = toFinite(transform.rotation, 0);

  ctx.save();
  ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
  ctx.globalAlpha = Number.isFinite(layer.opacity) ? clamp(layer.opacity, 0, 1) : 1;

  if (rotation !== 0) {
    ctx.translate(destX, destY);
    ctx.rotate(rotation);
    ctx.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, 0, 0, destWidth, destHeight);
  } else {
    ctx.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, destX, destY, destWidth, destHeight);
  }

  ctx.restore();
  return true;
};

// ------------------------------------------------------------
// TinyBrush viewer core
// ------------------------------------------------------------
const RENDERER_KEY = Symbol('TinyBrushRenderer');
const ACTIVE_CANVASES = new Map();
let resizeListenerAttached = false;
const POINTER_GUARD_EVENTS = ['mouseenter', 'mousemove', 'pointerdown', 'pointerup', 'focus'];

const computeResponsiveScale = (metadata) => {
  if (typeof window === 'undefined' || !metadata?.viewport) {
    return { x: 1, y: 1 };
  }
  const viewport = metadata.viewport;
  const width = Number(viewport.width) || 0;
  const height = Number(viewport.height) || 0;
  if (!width || !height) {
    return { x: 1, y: 1 };
  }
  if (viewport.mode === 'project') {
    return { x: 1, y: 1 };
  }

  const viewportWidth = window.innerWidth || width;
  const viewportHeight = window.innerHeight || height;
  if (!viewportWidth || !viewportHeight) {
    return { x: 1, y: 1 };
  }

  if (viewport.mode === 'fill') {
    const windowAspect = viewportWidth / viewportHeight;
    const contentAspect = width / height;
    const coverScale = windowAspect > contentAspect
      ? viewportWidth / width
      : viewportHeight / height;
    const safeCover = Number.isFinite(coverScale) && coverScale > 0 ? coverScale : 1;
    return { x: safeCover, y: safeCover };
  }

  const containScale = Math.min(viewportWidth / width, viewportHeight / height);
  const safeContain = Number.isFinite(containScale) && containScale > 0 ? containScale : 1;
  return { x: safeContain, y: safeContain };
};

class TinyBrushViewer {
  constructor(metadata, canvas, options, sourceMetadata) {
    this.metadata = metadata;
    this.sourceMetadata = sourceMetadata ?? metadata;
    this.canvas = canvas;
    this.options = options ?? {};
    const { x, y } = normalizeScaleOption(this.options.scale ?? { x: 1, y: 1 });
    this.scale = { x, y };

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

    this.originalLayers = new Map();
    metadata.layers.forEach((layer) => {
      this.originalLayers.set(layer.id, {
        alignment: layer.alignment ? deepClone(layer.alignment) : null,
        frame: layer.frame ? deepClone(layer.frame) : null,
        transform: layer.transform ? deepClone(layer.transform) : null,
        sourceSize: layer.sourceSize ? deepClone(layer.sourceSize) : null,
        contentBounds: layer.contentBounds ? deepClone(layer.contentBounds) : null,
        layoutMode: layer.layoutMode ?? null
      });
    });

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

    this.updateScale(this.scale);
    await this.loadLayers();
    this.applyResolvedLayout();
    this.renderOnce();
  }

  async loadLayers() {
    const entries = await Promise.all(this.metadata.layers.map(async (layer) => {
      const layerClone = deepClone(layer);
      let source = null;
      let player = null;

      if (layerClone.assets?.texture) {
        try {
          source = await loadImage(layerClone.assets.texture);
        } catch (error) {
          diagnostics.warn(`Failed to load texture for layer ${layerClone.id}`, error);
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

  applyResolvedLayout() {
    const viewport = {
      width: Math.max(1, Math.round(this.canvas.width / this.scale.x)),
      height: Math.max(1, Math.round(this.canvas.height / this.scale.y)),
      mode: this.metadata.viewport.mode
    };

    const declaredStrategy = this.metadata.transformStrategy;
    const transformStrategy = declaredStrategy ?? 'legacy';

    diagnostics.log('[VIEWER] applyResolvedLayout called:', {
      canvasSize: { width: this.canvas.width, height: this.canvas.height },
      scale: this.scale,
      computedViewport: viewport,
      metadataViewport: this.metadata.viewport
    });

    this.layerEntries.forEach((entry) => {
      const layer = entry.layer;
      const original = this.originalLayers.get(layer.id);
      const rawAlignment = layer.alignment || original?.alignment;
      const hasRawAlignment = Boolean(rawAlignment);
      const usesDynamicLayout = transformStrategy === 'dynamic' || hasRawAlignment;
      const alignment = rawAlignment
        ? {
            ...rawAlignment,
            fit: rawAlignment.fit ?? 'none',
            horizontal: rawAlignment.horizontal ?? 'left',
            vertical: rawAlignment.vertical ?? 'top',
            positioning: rawAlignment.positioning ?? 'auto',
            offsetPx: {
              x: toFinite(rawAlignment.offsetPx?.x, 0),
              y: toFinite(rawAlignment.offsetPx?.y, 0)
            },
            offsetPercent: rawAlignment.offsetPercent
              ? {
                  x: toFinite(rawAlignment.offsetPercent.x, 0),
                  y: toFinite(rawAlignment.offsetPercent.y, 0)
                }
              : { x: 0, y: 0 }
          }
        : {
            fit: 'none',
            horizontal: 'left',
            vertical: 'top',
            positioning: 'auto',
            offsetPx: { x: 0, y: 0 },
            offsetPercent: { x: 0, y: 0 }
          };

      diagnostics.log('[VIEWER] Processing layer:', {
        layerId: layer.id,
        alignment,
        originalFrame: original?.frame,
        currentFrame: layer.frame,
        sourceSize: layer.sourceSize,
        originalSourceSize: original?.sourceSize,
        contentBounds: layer.contentBounds,
        originalContentBounds: original?.contentBounds
      });

      const alignmentFit = alignment.fit ?? 'none';
      if (!layer.layoutMode) {
        layer.layoutMode = alignmentFit;
      }

      const offsetPx = alignment.offsetPx ?? { x: 0, y: 0 };

      const fallbackFrame = {
        x: 0,
        y: 0,
        width: layer.sourceSize?.width ?? original?.sourceSize?.width ?? viewport.width,
        height: layer.sourceSize?.height ?? original?.sourceSize?.height ?? viewport.height
      };

      const frameSource = layer.frame || original?.frame || fallbackFrame;
      const sanitizedFrame = {
        x: Math.round(toFinite(frameSource.x, 0)),
        y: Math.round(toFinite(frameSource.y, 0)),
        width: Math.max(1, Math.round(toFinite(frameSource.width, fallbackFrame.width))),
        height: Math.max(1, Math.round(toFinite(frameSource.height, fallbackFrame.height)))
      };

      const zeroedFrame = {
        x: 0,
        y: 0,
        width: sanitizedFrame.width,
        height: sanitizedFrame.height
      };

      const frameOffset = {
        x: sanitizedFrame.x,
        y: sanitizedFrame.y
      };

      const source = entry.player ? entry.player.getCanvas() : entry.source;
      const fallbackWidth = layer.sourceSize?.width
        ?? original?.sourceSize?.width
        ?? source?.width
        ?? viewport.width;
      const fallbackHeight = layer.sourceSize?.height
        ?? original?.sourceSize?.height
        ?? source?.height
        ?? viewport.height;

      const contentSize = layer.contentBounds
        || original?.contentBounds
        || {
          x: 0,
          y: 0,
          width: Math.max(1, fallbackWidth),
          height: Math.max(1, fallbackHeight)
        };

      const computeTransformFromAlignment = () => {
        const viewportForTransform = alignmentFit === 'percent'
          ? { width: viewport.width, height: viewport.height }
          : { width: sanitizedFrame.width, height: sanitizedFrame.height };

        const computedTransform = LayoutEngine.computeLayerTransform(
          {
            width: Math.max(1, contentSize.width),
            height: Math.max(1, contentSize.height)
          },
          viewportForTransform,
          alignment
        );

        const rotation = Number.isFinite(original?.transform?.rotation)
          ? original.transform.rotation
          : Number.isFinite(layer.transform?.rotation)
            ? layer.transform.rotation
            : 0;

        const translateX = toFinite(computedTransform.translateX, 0)
          + (alignmentFit === 'percent' ? 0 : frameOffset.x);
        const translateY = toFinite(computedTransform.translateY, 0)
          + (alignmentFit === 'percent' ? 0 : frameOffset.y);

        layer.transform = {
          scaleX: toFinite(computedTransform.scaleX, 1) || 1,
          scaleY: toFinite(computedTransform.scaleY, 1) || 1,
          translateX,
          translateY,
          rotation
        };

        layer.frame = zeroedFrame;

        diagnostics.log('[VIEWER] Computed transform (dynamic):', {
          layerId: layer.id,
          alignmentFit,
          contentSize,
          viewportForTransform,
          frameOffset,
          resultTransform: layer.transform
        });

        layer._hasCalculatedTransform = true;
        layer._transformIsViewportScaled = false;
      };

      if (usesDynamicLayout) {
        computeTransformFromAlignment();
        return;
      }

      if (layer.transform) {
        const legacyTransform = layer.transform;
        layer.frame = sanitizedFrame;
        layer.transform = {
          scaleX: toFinite(legacyTransform.scaleX, 1) || 1,
          scaleY: toFinite(legacyTransform.scaleY, 1) || 1,
          translateX: toFinite(legacyTransform.translateX, 0),
          translateY: toFinite(legacyTransform.translateY, 0),
          rotation: toFinite(legacyTransform.rotation, 0)
        };
        layer._hasCalculatedTransform = true;
        layer._transformIsViewportScaled = true;
        console.warn('[VIEWER] Using legacy pre-computed transform for', layer.id);
        return;
      }

      computeTransformFromAlignment();
    });
  }

  restoreOriginalTransforms() {
    this.layerEntries.forEach((entry) => {
      const original = this.originalLayers.get(entry.layer.id);
      if (!original) {
        return;
      }
      if (original.frame) {
        entry.layer.frame = deepClone(original.frame);
      }
      if (original.transform) {
        entry.layer.transform = deepClone(original.transform);
      }
      if (original.layoutMode) {
        entry.layer.layoutMode = original.layoutMode;
      }
    });
  }

  renderOnce() {
    if (!this.ctx) {
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
    const hasStackIndex = sorted.some((entry) => typeof entry.layer.stackIndex === 'number');
    if (hasStackIndex) {
      sorted.sort((a, b) => {
        const ai = typeof a.layer.stackIndex === 'number' ? a.layer.stackIndex : Number.MAX_SAFE_INTEGER;
        const bi = typeof b.layer.stackIndex === 'number' ? b.layer.stackIndex : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    } else {
      sorted.reverse();
    }

    diagnostics.log('Layer render order:', sorted.map((entry) => ({
      id: entry.layer.id,
      visible: entry.layer.visible,
      hasSource: Boolean(entry.source || entry.player),
      stackIndex: entry.layer.stackIndex,
      frame: entry.layer.frame
    })));

    let painted = 0;
    sorted.forEach((entry) => {
      if (entry.layer.visible === false) {
        return;
      }
      const source = entry.player ? entry.player.getCanvas() : entry.source;
      if (!source) {
        return;
      }
      if (applyLayerToContext(ctx, source, entry.layer, this.scale)) {
        painted += 1;
        diagnostics.log(`Rendered layer ${entry.layer.id} at`, entry.layer.frame);
      }
    });

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
    const { x, y } = normalizeScaleOption(scaleOption ?? this.scale);
    const oldScale = { ...this.scale };
    this.scale = { x, y };
    const width = Math.max(1, Math.round(this.metadata.viewport.width * x));
    const height = Math.max(1, Math.round(this.metadata.viewport.height * y));

    diagnostics.log('[VIEWER] updateScale called:', {
      oldScale,
      newScale: this.scale,
      oldCanvasSize: { width: this.canvas.width, height: this.canvas.height },
      newCanvasSize: { width, height },
      viewportMode: this.metadata.viewport.mode
    });

    this.summary.scale = { ...this.scale };
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
      }
      diagnostics.log('[VIEWER] Canvas resized, calling applyResolvedLayout');
      this.applyResolvedLayout();
      this.renderOnce();
    }
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

    ACTIVE_CANVASES.forEach((metadata, canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) {
        ACTIVE_CANVASES.delete(canvas);
        return;
      }
      const scale = computeResponsiveScale(metadata);
      diagnostics.log('[RESIZE] Computed scale for canvas:', {
        viewport: metadata.viewport,
        computedScale: scale,
        canvasId: canvas.id
      });
      resizeTinyBrushWebGL(canvas, scale);
    });
  });
  resizeListenerAttached = true;
};

export const renderTinyBrushWebGL = async (metadata, canvas, options = {}) => {
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A target canvas element is required');
  }
  const prepared = prepareMetadata(metadata);

  const previous = canvas[RENDERER_KEY];
  if (previous && typeof previous.updateScale === 'function' && typeof previous.getSourceMetadata === 'function' && previous.getSourceMetadata() === metadata) {
    previous.updateScale(options.scale ?? previous.scale);
    previous.ensureRunning();
    ACTIVE_CANVASES.set(canvas, prepared);
    ensureResizeListener();
    return previous.summary;
  }

  if (previous && typeof previous.destroy === 'function') {
    previous.destroy();
  }

  const viewer = new TinyBrushViewer(prepared, canvas, options, metadata);
  viewer.setSourceMetadata(metadata);
  await viewer.initialize();
  viewer.start();

  canvas[RENDERER_KEY] = viewer;
  canvas.__tinybrushSourceMetadata = metadata;
  ACTIVE_CANVASES.set(canvas, prepared);
  ensureResizeListener();

  const POINTER_GUARD_KEY = Symbol.for('TinyBrushPointerGuard');
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

export const resizeTinyBrushWebGL = (canvas, scaleOption) => {
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
