import { inflateRaw } from './fflate-inflate.js';

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

const applyLayer = (ctx, img, layer, scale) => {
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
  const scaleX = toFinite(transform.scaleX, 1);
  const scaleY = toFinite(transform.scaleY, 1);
  const rotation = toFinite(transform.rotation, 0);

  const canvasWidth = ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.canvas?.height ?? 0;
  const destX = (frameX + translateX) * scale;
  const destY = (frameY + translateY) * scale;
  const scaledWidth = cropWidth * scaleX * scale;
  const scaledHeight = cropHeight * scaleY * scale;
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
    scaleX,
    scaleY,
    rotationDegrees: rotation * (180 / Math.PI),
    canvasWidth,
    canvasHeight,
    bounds,
    offscreen
  });
  ctx.save();
  ctx.scale(scale, scale);
  ctx.globalAlpha = Math.max(0, Math.min(1, layer?.opacity ?? 1));
  ctx.globalCompositeOperation = layer?.blendMode || 'source-over';
  ctx.translate(frameX + translateX, frameY + translateY);
  if (rotation !== 0) {
    ctx.rotate(rotation);
  }
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
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
  constructor(metadata, canvas, options) {
    this.metadata = metadata;
    this.canvas = canvas;
    this.options = options || {};
    this.scale = this.options.scale && this.options.scale > 0 ? this.options.scale : 1;
    this.ctx = null;
    this.layers = [];
    this.dynamicPlayers = [];
    this.rafId = null;
    this.lastTimestamp = 0;
    this.isDestroyed = false;
    this.summary = {
      viewport: metadata.viewport,
      animation: metadata.animation,
      layers: metadata.layers.length
    };
    this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
  }

  async initialize() {
    const width = Math.max(1, Math.round(this.metadata.viewport.width * this.scale));
    const height = Math.max(1, Math.round(this.metadata.viewport.height * this.scale));

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
    });

    this.layers = entries;
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
      const painted = applyLayer(ctx, source, layer, this.scale);
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

  debugLog('renderTinyBrushWebGL invoked', {
    viewport: normalizedMetadata.viewport,
    layerCount: normalizedMetadata.layers.length,
    options
  });

  const previous = canvas[RENDERER_KEY];
  if (previous && typeof previous.destroy === 'function') {
    previous.destroy();
  }

  const renderer = new TinyBrushBundleRenderer(normalizedMetadata, canvas, options);
  await renderer.initialize();
  renderer.start();
  canvas[RENDERER_KEY] = renderer;

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
