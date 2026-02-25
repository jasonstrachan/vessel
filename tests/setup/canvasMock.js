const DEFAULT_FILL_STYLE = 'rgba(0, 0, 0, 1)';

class MockImageData {
  constructor(dataOrWidth, widthOrHeight, height) {
    if (typeof dataOrWidth === 'number') {
      const width = dataOrWidth;
      const heightValue = widthOrHeight ?? 0;
      this.width = width;
      this.height = heightValue;
      this.data = new Uint8ClampedArray(width * heightValue * 4);
    } else {
      const data = dataOrWidth;
      const width = widthOrHeight ?? 0;
      const heightValue = height ?? 0;
      this.width = width;
      this.height = heightValue;
      if (data instanceof Uint8ClampedArray) {
        this.data = new Uint8ClampedArray(data);
      } else {
        this.data = new Uint8ClampedArray(width * heightValue * 4);
        if (Array.isArray(data)) {
          this.data.set(data);
        }
      }
    }
  }
}

if (typeof global.ImageData === 'undefined') {
  global.ImageData = MockImageData;
}

class MockCanvasGradient {
  constructor() {
    this.stops = [];
  }
  addColorStop(offset, color) {
    this.stops.push({ offset, color });
  }
}

function clampColorComponent(value) {
  return Math.max(0, Math.min(255, value));
}

function parseHexColor(value) {
  let hex = value.replace('#', '').trim();
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map((char) => char + char).join('');
  }
  let alpha = 255;
  if (hex.length === 8) {
    alpha = parseInt(hex.slice(6, 8), 16);
    hex = hex.slice(0, 6);
  }
  const intValue = parseInt(hex, 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return { r, g, b, a: alpha };
}

function parseRgbColor(value) {
  const match = value
    .replace(/\s+/g, '')
    .match(/^rgba?\(([-+]?\d*\.?\d+),([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)(?:,([-+]?\d*\.?\d+))?\)$/i);
  if (!match) {
    return null;
  }
  const r = clampColorComponent(Number(match[1]));
  const g = clampColorComponent(Number(match[2]));
  const b = clampColorComponent(Number(match[3]));
  const alpha = match[4] !== undefined ? Number(match[4]) : 1;
  const a = clampColorComponent(Math.round(alpha * 255));
  return { r, g, b, a };
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function parseHslColor(value) {
  const match = value
    .replace(/\s+/g, '')
    .match(/^hsla?\(([-+]?\d*\.?\d+),([-+]?\d*\.?\d+)%,([-+]?\d*\.?\d+)%(?:,([-+]?\d*\.?\d+))?\)$/i);
  if (!match) {
    return null;
  }
  const h = ((Number(match[1]) % 360) + 360) % 360;
  const s = Number(match[2]);
  const l = Number(match[3]);
  const [r, g, b] = hslToRgb(h, s, l);
  const alpha = match[4] !== undefined ? Number(match[4]) : 1;
  const a = clampColorComponent(Math.round(alpha * 255));
  return { r, g, b, a };
}

function parseColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed);
  }
  if (trimmed.startsWith('rgb')) {
    return parseRgbColor(trimmed);
  }
  if (trimmed.startsWith('hsl')) {
    return parseHslColor(trimmed);
  }
  // Basic named colors fallback
  const namedColors = {
    black: { r: 0, g: 0, b: 0, a: 255 },
    white: { r: 255, g: 255, b: 255, a: 255 },
    red: { r: 255, g: 0, b: 0, a: 255 },
    green: { r: 0, g: 128, b: 0, a: 255 },
    blue: { r: 0, g: 0, b: 255, a: 255 },
    transparent: { r: 0, g: 0, b: 0, a: 0 }
  };
  return namedColors[trimmed] ?? null;
}

function rgbaToString({ r, g, b, a }) {
  const alpha = (a / 255).toFixed(3).replace(/\.0+$/, '').replace(/0+$/, '');
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha)})`;
}

class MockCanvasRenderingContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._fillStyle = DEFAULT_FILL_STYLE;
    this._strokeStyle = DEFAULT_FILL_STYLE;
    this._fillRgba = { r: 0, g: 0, b: 0, a: 255 };
    this._strokeRgba = { r: 0, g: 0, b: 0, a: 255 };
    this._lineWidth = 1;
    this._font = "10px 'IBM Plex Mono'";
    this._globalAlpha = 1;
    this._setBuffer();
  }

  _setBuffer() {
    const width = this.canvas.width || 0;
    const height = this.canvas.height || 0;
    const size = Math.max(width * height * 4, 0);
    if (!this._buffer || this._buffer.length !== size) {
      this._buffer = new Uint8ClampedArray(size);
    }
  }

  _getIndex(x, y) {
    const width = this.canvas.width || 0;
    return (y * width + x) * 4;
  }

  _ensurePoint(x, y) {
    const width = this.canvas.width || 0;
    const height = this.canvas.height || 0;
    return x >= 0 && x < width && y >= 0 && y < height;
  }

  _writePixel(x, y, rgba) {
    if (!this._ensurePoint(x, y)) return;
    const index = this._getIndex(x, y);
    this._buffer[index] = rgba.r;
    this._buffer[index + 1] = rgba.g;
    this._buffer[index + 2] = rgba.b;
    this._buffer[index + 3] = rgba.a;
  }

  get fillStyle() {
    return this._fillStyle;
  }

  set fillStyle(value) {
    const color = parseColor(value);
    if (color) {
      this._fillRgba = color;
      this._fillStyle = rgbaToString(color);
    } else {
      this._fillRgba = { r: 0, g: 0, b: 0, a: 255 };
      this._fillStyle = DEFAULT_FILL_STYLE;
    }
  }

  get strokeStyle() {
    return this._strokeStyle;
  }

  set strokeStyle(value) {
    const color = parseColor(value);
    if (color) {
      this._strokeRgba = color;
      this._strokeStyle = rgbaToString(color);
    } else {
      this._strokeRgba = { r: 0, g: 0, b: 0, a: 255 };
      this._strokeStyle = DEFAULT_FILL_STYLE;
    }
  }

  get globalAlpha() {
    return this._globalAlpha;
  }

  set globalAlpha(value) {
    this._globalAlpha = Number.isFinite(value) ? value : 1;
  }

  get font() {
    return this._font;
  }

  set font(value) {
    this._font = String(value);
  }

  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  stroke() {}
  fill() {}
  clip() {}
  translate() {}
  rotate() {}
  scale() {}
  transform() {}
  setTransform() {}
  resetTransform() {}

  measureText(text) {
    const sizeMatch = /([0-9]+)px/.exec(this._font);
    const size = sizeMatch ? Number(sizeMatch[1]) : 10;
    return { width: text.length * (size * 0.6) };
  }

  createLinearGradient() {
    return new MockCanvasGradient();
  }

  createRadialGradient() {
    return new MockCanvasGradient();
  }

  createPattern() {
    return null;
  }

  fillRect(x, y, width, height) {
    this._setBuffer();
    const rgba = this._fillRgba;
    const alphaFactor = this._globalAlpha;
    const adjusted = {
      r: rgba.r,
      g: rgba.g,
      b: rgba.b,
      a: clampColorComponent(Math.round(rgba.a * alphaFactor))
    };
    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        this._writePixel(Math.floor(x + ix), Math.floor(y + iy), adjusted);
      }
    }
  }

  clearRect(x, y, width, height) {
    this._setBuffer();
    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        if (!this._ensurePoint(Math.floor(x + ix), Math.floor(y + iy))) continue;
        const index = this._getIndex(Math.floor(x + ix), Math.floor(y + iy));
        this._buffer[index] = 0;
        this._buffer[index + 1] = 0;
        this._buffer[index + 2] = 0;
        this._buffer[index + 3] = 0;
      }
    }
  }

  getImageData(x, y, width, height) {
    this._setBuffer();
    const imageData = new ImageData(width, height);
    for (let iy = 0; iy < height; iy++) {
      for (let ix = 0; ix < width; ix++) {
        const destIndex = (iy * width + ix) * 4;
        if (!this._ensurePoint(x + ix, y + iy)) {
          continue;
        }
        const srcIndex = this._getIndex(x + ix, y + iy);
        imageData.data[destIndex] = this._buffer[srcIndex];
        imageData.data[destIndex + 1] = this._buffer[srcIndex + 1];
        imageData.data[destIndex + 2] = this._buffer[srcIndex + 2];
        imageData.data[destIndex + 3] = this._buffer[srcIndex + 3];
      }
    }
    return imageData;
  }

  createImageData(width, height) {
    return new ImageData(width, height);
  }

  putImageData(imageData, dx, dy) {
    this._setBuffer();
    for (let iy = 0; iy < imageData.height; iy++) {
      for (let ix = 0; ix < imageData.width; ix++) {
        const index = (iy * imageData.width + ix) * 4;
        const pixel = {
          r: imageData.data[index],
          g: imageData.data[index + 1],
          b: imageData.data[index + 2],
          a: imageData.data[index + 3]
        };
        this._writePixel(dx + ix, dy + iy, pixel);
      }
    }
  }

  drawImage() {}
  getLineDash() { return []; }
  setLineDash() {}
  getTransform() { return { a: 1, d: 1, e: 0, f: 0 }; }
  setLineWidth(width) { this._lineWidth = width; }
}

const WEBGL_CONTEXT_TYPES = new Set(['webgl', 'experimental-webgl', 'webgl2']);

function ensureCanvasPrototype() {
  const proto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
  if (!proto || proto.__vesselMockApplied) {
    return;
  }

  const originalGetContext = proto.getContext;

  proto.getContext = function getContext(type, ...args) {
    if (type === '2d' || !type) {
      if (!this.__mockContext) {
        this.__mockContext = new MockCanvasRenderingContext2D(this);
      }
      this.__mockContext._setBuffer();
      return this.__mockContext;
    }
    if (WEBGL_CONTEXT_TYPES.has(type)) {
      return null;
    }
    return originalGetContext ? originalGetContext.call(this, type, ...args) : null;
  };

  proto.toDataURL = function toDataURL() {
    return 'data:image/png;base64,';
  };

  Object.defineProperty(proto, '__vesselMockApplied', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

ensureCanvasPrototype();

global.CanvasRenderingContext2D = MockCanvasRenderingContext2D;
global.CanvasGradient = MockCanvasGradient;

if (typeof global.Path2D === 'undefined') {
  global.Path2D = class Path2D {
    constructor() {}
  };
}

if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  };
}
