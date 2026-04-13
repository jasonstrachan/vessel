import { clamp, posInt, round3, toNum } from './num.js';
import {
  applyDisplayFilterStack,
  clearDisplayFilterCanvas,
  createDisplayFilterPipelineState,
  ensureDisplayFilterCanvas,
  hasEnabledDisplayFiltersInList,
} from './displayFilterPipeline.js';

const __DEV__ = typeof process !== 'undefined' && process.env && process.env.NODE_ENV
  ? process.env.NODE_ENV !== 'production'
  : true;

let ccDebugOn = () => false;
let ccLog = () => {};
let ccWarn = () => {};
let ccSample = () => null;

if (__DEV__) {
  ccDebugOn = () => {
    if (typeof window === 'undefined') {
      return false;
    }
    if (window.__CC_DEBUG__) {
      return true;
    }
    try {
      return window.localStorage.getItem('ccDebug') === '1';
    } catch {
      return false;
    }
  };

  ccLog = (...args) => {
    if (ccDebugOn()) {
      console.log('[CC]', ...args);
    }
  };

  ccWarn = (...args) => {
    if (ccDebugOn()) {
      console.warn('[CC]', ...args);
    }
  };

  ccSample = (arr, n = 8) => {
    if (!arr) {
      return null;
    }
    try {
      return Array.prototype.slice.call(arr, 0, n);
    } catch {
      return null;
    }
  };

  if (typeof window !== 'undefined') {
    window.ccLog = ccLog;
    window.ccWarn = ccWarn;
  }
  // enable:   localStorage.setItem('ccDebug','1'); window.__CC_DEBUG__ = true;
  // disable:  localStorage.removeItem('ccDebug'); window.__CC_DEBUG__ = false;
}

// ------------------------------------------------------------
// Inline dependencies for file:// compatibility
// ------------------------------------------------------------
const inflateRaw = (() => {
  // Minimal ES module exposing fflate's inflate implementation for raw deflate streams.
  // Derived from https://github.com/101arrowz/fflate (MIT License).

  const u8 = Uint8Array;
  const u16 = Uint16Array;
  const i32 = Int32Array;

  const fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
  const fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
  const clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

  const freb = (eb, start) => {
    const b = new u16(31);
    for (let i = 0; i < 31; ++i) {
      b[i] = start += 1 << eb[i - 1];
    }
    const r = new i32(b[30]);
    for (let i = 1; i < 30; ++i) {
      for (let j = b[i]; j < b[i + 1]; ++j) {
        r[j] = ((j - b[i]) << 5) | i;
      }
    }
    return { b, r };
  };

  const { b: fl } = freb(fleb, 2);
  const { b: fd } = freb(fdeb, 0);

  const rev = new u16(32768);
  for (let i = 0; i < 32768; ++i) {
    let x = ((i & 0xAAAA) >> 1) | ((i & 0x5555) << 1);
    x = ((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2);
    rev[i] = (((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4)) >> 1;
  }

  const hMap = (codeLengths, maxBits, generateMap) => {
    const size = codeLengths.length;
    const lengthCounts = new u16(maxBits);
    for (let i = 0; i < size; ++i) {
      if (codeLengths[i]) {
        lengthCounts[codeLengths[i] - 1] += 1;
      }
    }
    const offsets = new u16(maxBits);
    for (let i = 1; i < maxBits; ++i) {
      offsets[i] = (offsets[i - 1] + lengthCounts[i - 1]) << 1;
    }

    if (generateMap) {
      const map = new u16(1 << maxBits);
      const shift = 15 - maxBits;
      for (let i = 0; i < size; ++i) {
        const len = codeLengths[i];
        if (!len) {
          continue;
        }
        const code = offsets[len - 1]++;
        const value = (i << 4) | len;
        const start = code << (maxBits - len);
        const end = start + (1 << (maxBits - len));
        for (let j = start; j < end; ++j) {
          map[rev[j] >> shift] = value;
        }
      }
      return map;
    }

    const table = new u16(size);
    for (let i = 0; i < size; ++i) {
      const len = codeLengths[i];
      if (len) {
        table[i] = rev[offsets[len - 1]++] >> (15 - len);
      }
    }
    return table;
  };

  const flt = new u8(288);
  for (let i = 0; i < 144; ++i) flt[i] = 8;
  for (let i = 144; i < 256; ++i) flt[i] = 9;
  for (let i = 256; i < 280; ++i) flt[i] = 7;
  for (let i = 280; i < 288; ++i) flt[i] = 8;

  const fdt = new u8(32);
  for (let i = 0; i < 32; ++i) fdt[i] = 5;

  const flrm = hMap(flt, 9, 1);
  const fdrm = hMap(fdt, 5, 1);

  const max = (array) => {
    let result = array[0];
    for (let i = 1; i < array.length; ++i) {
      if (array[i] > result) {
        result = array[i];
      }
    }
    return result;
  };

  const bits = (data, pos, mask) => {
    const offset = (pos / 8) | 0;
    return ((data[offset] | (data[offset + 1] << 8)) >> (pos & 7)) & mask;
  };

  const bits16 = (data, pos) => {
    const offset = (pos / 8) | 0;
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)) >> (pos & 7);
  };

  const shft = (pos) => ((pos + 7) / 8) | 0;

  const slc = (view, start, end) => {
    const s = start == null || start < 0 ? 0 : start;
    const e = end == null || end > view.length ? view.length : end;
    return new u8(view.subarray(s, e));
  };

  const inflateError = (code) => {
    const messages = [
      'unexpected EOF',
      'invalid block type',
      'invalid length/literal',
      'invalid distance'
    ];
    throw new Error(messages[code] || 'DEFLATE error');
  };

  const inflt = (dat, st, buf, dict) => {
    const sl = dat.length;
    const dl = dict ? dict.length : 0;
    if (!sl || (st.f && !st.l)) {
      return buf || new u8(0);
    }

    let out = buf;
    let resize = false;
    if (!out) {
      out = new u8(sl * 3);
      resize = true;
    } else if (st.i !== 2) {
      resize = true;
    }

    const ensureCapacity = (size) => {
      if (size <= out.length) {
        return;
      }
      const next = new u8(Math.max(out.length * 2, size));
      next.set(out);
      out = next;
    };

    let final = st.f || 0;
    let pos = st.p || 0;
    let bt = st.b || 0;
    let lm = st.l;
    let dm = st.d;
    let lbt = st.m;
    let dbt = st.n;
    const totalBits = sl * 8;

    do {
      if (!lm) {
        final = bits(dat, pos, 1);
        const type = bits(dat, pos + 1, 3);
        pos += 3;
        if (!type) {
          const s = shft(pos) + 4;
          const length = dat[s - 4] | (dat[s - 3] << 8);
          const end = s + length;
          if (end > sl) {
            inflateError(0);
          }
          if (resize) {
            ensureCapacity(bt + length);
          }
          out.set(dat.subarray(s, end), bt);
          bt += length;
          st.b = bt;
          st.p = pos = end * 8;
          st.f = final;
          continue;
        } else if (type === 1) {
          lm = flrm;
          dm = fdrm;
          lbt = 9;
          dbt = 5;
        } else if (type === 2) {
          const hLit = bits(dat, pos, 31) + 257;
          const hDist = bits(dat, pos + 5, 31) + 1;
          const hCLen = bits(dat, pos + 10, 15) + 4;
          pos += 14;
          const ldt = new u8(hLit + hDist);
          const clt = new u8(19);
          for (let i = 0; i < hCLen; ++i) {
            clt[clim[i]] = bits(dat, pos + i * 3, 7);
          }
          pos += hCLen * 3;
          const clb = max(clt);
          const clm = hMap(clt, clb || 1, 1);
          const clMask = (1 << (clb || 1)) - 1;
          for (let i = 0; i < ldt.length;) {
            const entry = clm[bits(dat, pos, clMask)];
            pos += entry & 15;
            const symbol = entry >> 4;
            if (symbol < 16) {
              ldt[i++] = symbol;
            } else {
              let repeat = 0;
              let value = 0;
              if (symbol === 16) {
                repeat = 3 + bits(dat, pos, 3);
                pos += 2;
                value = ldt[i - 1];
              } else if (symbol === 17) {
                repeat = 3 + bits(dat, pos, 7);
                pos += 3;
              } else {
                repeat = 11 + bits(dat, pos, 127);
                pos += 7;
              }
              while (repeat--) {
                ldt[i++] = value;
              }
            }
          }
          const lt = ldt.subarray(0, hLit);
          const dt = ldt.subarray(hLit);
          lbt = max(lt) || 1;
          dbt = max(dt) || 1;
          lm = hMap(lt, lbt, 1);
          dm = hMap(dt, dbt, 1);
        } else {
          inflateError(1);
        }
        if (pos > totalBits) {
          inflateError(0);
        }
      }

      if (resize) {
        ensureCapacity(bt + 131072);
      }
      const lmsk = (1 << lbt) - 1;
      const dmsk = (1 << dbt) - 1;
      let lastPos = pos;
      for (;; lastPos = pos) {
        const entry = lm[bits16(dat, pos) & lmsk];
        const symbol = entry >> 4;
        pos += entry & 15;
        if (pos > totalBits) {
          inflateError(0);
        }
        if (!entry) {
          inflateError(2);
        }
        if (symbol < 256) {
          out[bt++] = symbol;
        } else if (symbol === 256) {
          lastPos = pos;
          lm = null;
          break;
        } else {
          let length = symbol - 254;
          if (symbol > 264) {
            const idx = symbol - 257;
            const extra = fleb[idx];
            length = bits(dat, pos, (1 << extra) - 1) + fl[idx];
            pos += extra;
          }
          const distEntry = dm[bits16(dat, pos) & dmsk];
          const distSymbol = distEntry >> 4;
          if (!distEntry) {
            inflateError(3);
          }
          pos += distEntry & 15;
          let dist = fd[distSymbol];
          if (distSymbol > 3) {
            const extra = fdeb[distSymbol];
            dist += bits16(dat, pos) & ((1 << extra) - 1);
            pos += extra;
          }
          if (pos > totalBits) {
            inflateError(0);
          }
          if (resize) {
            ensureCapacity(bt + 131072);
          }
          const end = bt + length;
          if (bt < dist) {
            const shift = dl - dist;
            const limit = Math.min(dist, end);
            if (shift + bt < 0) {
              inflateError(3);
            }
            for (; bt < limit; ++bt) {
              out[bt] = dict[shift + bt];
            }
          }
          for (; bt < end; ++bt) {
            out[bt] = out[bt - dist];
          }
        }
      }
      st.l = lm;
      st.p = lastPos;
      st.b = bt;
      st.f = final;
      if (lm) {
        final = 1;
        st.m = lbt;
        st.d = dm;
        st.n = dbt;
      }
    } while (!final);

    return bt !== out.length && (!buf || buf.length === 0) ? slc(out, 0, bt) : out.subarray(0, bt);
  };

  const inflateRaw = (input) => {
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('inflateRaw expects a Uint8Array');
    }
    return inflt(input, { i: 2 });
  };

  return inflateRaw;
})();

// ------------------------------------------------------------
// Diagnostics
// ------------------------------------------------------------
const resolveDiagnosticsDefault = () => false;

let diagnosticsEnabled = resolveDiagnosticsDefault();

console.log('[goblet1] runtime version', '2026-02-04-legacyfix-01');

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
const snapshotIdentityTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

const snapshotTransform = (ctx) => {
  if (ctx && typeof ctx.getTransform === 'function') {
    const matrix = ctx.getTransform();
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
  }
  return snapshotIdentityTransform();
};

const isIdentityTransform = (matrix) => {
  const epsilon = 1e-6;
  return (
    Math.abs((matrix?.a ?? 1) - 1) < epsilon &&
    Math.abs((matrix?.d ?? 1) - 1) < epsilon &&
    Math.abs(matrix?.b ?? 0) < epsilon &&
    Math.abs(matrix?.c ?? 0) < epsilon &&
    Math.abs(matrix?.e ?? 0) < epsilon &&
    Math.abs(matrix?.f ?? 0) < epsilon
  );
};

const formatMatrix = (matrix) => `${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f}`;

const logViewerState = () => {};
const logLayerDraw = () => {};

// ------------------------------------------------------------
// Alignment helpers
// ------------------------------------------------------------
const fitClamp01 = (value) => (value <= 0 ? 0 : value >= 1 ? 1 : value);
const fitPositive = (value, fallback = 1) => (Number.isFinite(value) && value > 0 ? value : fallback);

const fitPivotFor = (horizontal, vertical) => {
  const px = horizontal === 'center' ? 0.5 : horizontal === 'right' ? 1 : 0;
  const py = vertical === 'center' ? 0.5 : vertical === 'bottom' ? 1 : 0;
  return { px, py };
};

const fitPivotForAnchor = (anchor, horizontal, vertical) => {
  if (anchor) {
    switch (anchor) {
      case 'center': return { px: 0.5, py: 0.5 };
      case 'top-left': return { px: 0, py: 0 };
      case 'top': return { px: 0.5, py: 0 };
      case 'top-right': return { px: 1, py: 0 };
      case 'left': return { px: 0, py: 0.5 };
      case 'right': return { px: 1, py: 0.5 };
      case 'bottom-left': return { px: 0, py: 1 };
      case 'bottom': return { px: 0.5, py: 1 };
      case 'bottom-right': return { px: 1, py: 1 };
      default: break;
    }
  }
  return fitPivotFor(horizontal, vertical);
};

const fitScaleFor = (fit, painted, frame, uniformK = 1, design) => {
  const sw = fitPositive(painted.width);
  const sh = fitPositive(painted.height);
  const fw = fitPositive(frame.width);
  const fh = fitPositive(frame.height);
  const sx = fw / sw;
  const sy = fh / sh;
  const uContain = Math.min(sx, sy);
  const uCover = Math.max(sx, sy);
  let normalizedContain = uContain;
  if (design) {
    const dw = fitPositive(design.width);
    const dh = fitPositive(design.height);
    if (dw > 0 && dh > 0) {
      const baseContain = Math.min(dw / sw, dh / sh) || 1;
      if (baseContain > 0) {
        normalizedContain = uContain / baseContain;
      }
    }
  }

  switch (fit) {
    case 'fill':
      return { sx, sy };
    case 'contain':
      return { sx: normalizedContain, sy: normalizedContain };
    case 'cover':
      return { sx: uCover, sy: uCover };
    case 'uniform':
      return { sx: uContain * uniformK, sy: uContain * uniformK };
    case 'tile':
      return { sx: 1, sy: 1 };
    case 'none':
    default:
      return { sx: 1, sy: 1 };
  }
};

const fitOriginPercent = (frame, offset) => {
  const ox = frame.x + fitClamp01((offset?.x ?? 0) / 100) * frame.width;
  const oy = frame.y + fitClamp01((offset?.y ?? 0) / 100) * frame.height;
  return { ox, oy };
};

const fitOriginAnchor = (frame, destWidth, destHeight, anchor, horizontal, vertical) => {
  const { px, py } = fitPivotForAnchor(anchor, horizontal, vertical);
  const ax = frame.x + px * frame.width;
  const ay = frame.y + py * frame.height;
  return { ox: ax - px * destWidth, oy: ay - py * destHeight };
};

const computePlacement = (basis, uniformK = 1) => {
  const painted = {
    width: fitPositive(basis?.painted?.width),
    height: fitPositive(basis?.painted?.height)
  };
  const frame = {
    x: basis?.frame?.x ?? 0,
    y: basis?.frame?.y ?? 0,
    width: fitPositive(basis?.frame?.width),
    height: fitPositive(basis?.frame?.height)
  };

  if (basis?.align?.fit === 'cover') {
    return {
      dest: {
        x: Math.round(frame.x),
        y: Math.round(frame.y),
        width: Math.max(1, Math.round(frame.width)),
        height: Math.max(1, Math.round(frame.height))
      }
    };
  }

  const sizeBasis = painted; // always size placement from painted bounds
  const { sx, sy } = fitScaleFor(basis?.align?.fit ?? 'none', sizeBasis, frame, uniformK, basis?.design);
  const destWidth = Math.max(1, sizeBasis.width * sx);
  const destHeight = Math.max(1, sizeBasis.height * sy);

  if (basis?.align?.fit === 'tile') {
    return {
      dest: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height
      },
      tile: {
        size: {
          width: painted.width,
          height: painted.height
        },
        phase: {
          x: Math.floor(frame.x),
          y: Math.floor(frame.y)
        }
      }
    };
  }

  let origin;

  if (basis?.align?.fit === 'fill') {
    origin = { ox: frame.x, oy: frame.y };
  } else if (basis?.align?.positioning === 'anchor') {
    origin = fitOriginAnchor(
      frame,
      destWidth,
      destHeight,
      basis.align.anchor,
      basis.align.horizontal,
      basis.align.vertical
    );
  } else if (basis?.align?.fit === 'contain') {
    const px = clamp01((basis.align.offsetPercent?.x ?? 0) / 100);
    const py = clamp01((basis.align.offsetPercent?.y ?? 0) / 100);
    const leftoverX = frame.width - destWidth;
    const leftoverY = frame.height - destHeight;
    origin = {
      ox: frame.x + leftoverX * px,
      oy: frame.y + leftoverY * py
    };
  } else {
    origin = fitOriginPercent(frame, basis?.align?.offsetPercent);
  }

  const dest = {
    x: Math.round(origin.ox),
    y: Math.round(origin.oy),
    width: Math.max(1, Math.round(destWidth)),
    height: Math.max(1, Math.round(destHeight))
  };

  return { dest };
};

const fitToNumber = (value, fallback = 0) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeAlign = (raw, autoOffsetPercent) => {
  const fit = typeof raw?.fit === 'string' ? raw.fit : 'none';
  const fitNormalized = (
    fit === 'contain' ||
    fit === 'cover' ||
    fit === 'uniform' ||
    fit === 'fill' ||
    fit === 'tile' ||
    fit === 'none'
  ) ? fit : 'none';

  const positioningRaw = raw?.positioning;
  const positioning = positioningRaw === 'anchor' || positioningRaw === 'auto' || positioningRaw === 'percent'
    ? positioningRaw
    : 'percent';

  const horizontal = raw?.horizontal === 'center' || raw?.horizontal === 'right'
    ? raw.horizontal
    : 'left';
  const vertical = raw?.vertical === 'center' || raw?.vertical === 'bottom'
    ? raw.vertical
    : 'top';
  const anchor = raw?.anchor;

  const align = {
    fit: fitNormalized,
    positioning,
    horizontal,
    vertical,
    anchor
  };

  if (positioning === 'percent') {
    const offset = raw?.offsetPercent ?? {};
    align.offsetPercent = {
      x: fitToNumber(offset.x, 0),
      y: fitToNumber(offset.y, 0)
    };
  } else if (positioning === 'auto' && autoOffsetPercent) {
    align.offsetPercent = {
      x: fitToNumber(autoOffsetPercent.x, 0),
      y: fitToNumber(autoOffsetPercent.y, 0)
    };
  }

  return align;
};

const fitComputeLayoutTransform = (alignment, viewport, paintedBounds) => {
  const basisWidth = fitPositive(paintedBounds?.width, 1);
  const basisHeight = fitPositive(paintedBounds?.height, 1);
  const viewportWidth = fitPositive(viewport?.width, 1);
  const viewportHeight = fitPositive(viewport?.height, 1);

  let { sx, sy } = fitScaleFor(alignment?.fit ?? 'none', { width: basisWidth, height: basisHeight }, { width: viewportWidth, height: viewportHeight });

  if (alignment?.positioning === 'anchor') {
    sx = 1;
    sy = 1;
  }

  const renderedWidth = basisWidth * sx;
  const renderedHeight = basisHeight * sy;
  const leftoverX = viewportWidth - renderedWidth;
  const leftoverY = viewportHeight - renderedHeight;

  if (alignment?.positioning === 'anchor') {
    const horizontal = alignment.horizontal ?? 'left';
    const vertical = alignment.vertical ?? 'top';
    const fallbackPercentX = horizontal === 'center' ? 50 : horizontal === 'right' ? 100 : 0;
    const fallbackPercentY = vertical === 'center' ? 50 : vertical === 'bottom' ? 100 : 0;
    const offsetPercentX = (alignment.offsetPercent?.x ?? fallbackPercentX) - fallbackPercentX;
    const offsetPercentY = (alignment.offsetPercent?.y ?? fallbackPercentY) - fallbackPercentY;
    const pivotX = horizontal === 'center' ? leftoverX / 2 : horizontal === 'right' ? leftoverX : 0;
    const pivotY = vertical === 'center' ? leftoverY / 2 : vertical === 'bottom' ? leftoverY : 0;
    const translateX = pivotX + (offsetPercentX / 100) * leftoverX;
    const translateY = pivotY + (offsetPercentY / 100) * leftoverY;

    return {
      scaleX: 1,
      scaleY: 1,
      translateX,
      translateY
    };
  }

  const percentX = (alignment?.offsetPercent?.x ?? 0) / 100;
  const percentY = (alignment?.offsetPercent?.y ?? 0) / 100;
  const translateX = leftoverX * percentX;
  const translateY = leftoverY * percentY;

  return {
    scaleX: sx,
    scaleY: sy,
    translateX,
    translateY
  };
};

const clampRectToSource = (rect, sourceWidth, sourceHeight) => {
  const maxWidth = Math.max(1, sourceWidth | 0);
  const maxHeight = Math.max(1, sourceHeight | 0);
  const x = clamp(Math.round(rect.x ?? 0), 0, Math.max(0, maxWidth - 1));
  const y = clamp(Math.round(rect.y ?? 0), 0, Math.max(0, maxHeight - 1));
  const width = Math.max(1, Math.round(rect.width ?? 0));
  const height = Math.max(1, Math.round(rect.height ?? 0));
  const clampedWidth = clamp(width, 1, Math.max(1, maxWidth - x));
  const clampedHeight = clamp(height, 1, Math.max(1, maxHeight - y));
  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight
  };
};

const documentBoundsToSourceRect = (documentBounds, documentSize, sourceSize) => {
  if (!documentBounds || !documentSize || !sourceSize) {
    return null;
  }

  const docWidth = Math.max(1, toNum(documentSize.width, sourceSize.width));
  const docHeight = Math.max(1, toNum(documentSize.height, sourceSize.height));
  const sourceWidth = Math.max(1, sourceSize.width);
  const sourceHeight = Math.max(1, sourceSize.height);

  const docX = clamp(toNum(documentBounds.x, 0), 0, docWidth);
  const docY = clamp(toNum(documentBounds.y, 0), 0, docHeight);
  const maxDocWidth = Math.max(1, docWidth - docX);
  const maxDocHeight = Math.max(1, docHeight - docY);
  const docW = clamp(toNum(documentBounds.width, docWidth), 1, maxDocWidth);
  const docH = clamp(toNum(documentBounds.height, docHeight), 1, maxDocHeight);

  const scaleX = sourceWidth / docWidth;
  const scaleY = sourceHeight / docHeight;

  const rect = {
    x: docX * scaleX,
    y: docY * scaleY,
    width: docW * scaleX,
    height: docH * scaleY
  };

  return clampRectToSource(rect, sourceWidth, sourceHeight);
};

const drawLayerWithPlacement = (ctx, source, placement, { isFixed, dpr, paintedRect, fit }) => {
  const toPos = (value) => (isFixed ? Math.round(value * dpr) : Math.round(value));
  const toSize = (value) => Math.max(1, isFixed ? Math.round(value * dpr) : Math.round(value));
  const fullSample = paintedRect ?? {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height
  };

  const destCss = placement.dest;
  let sampleRect = fullSample;

  const destBacking = {
    x: toPos(destCss.x),
    y: toPos(destCss.y),
    width: toSize(destCss.width),
    height: toSize(destCss.height)
  };

  ctx.imageSmoothingEnabled = false;

  if (placement.tile) {
    const scaleFactor = isFixed ? dpr : 1;
    const tileWidth = Math.max(1, Math.round(fullSample.width * scaleFactor));
    const tileHeight = Math.max(1, Math.round(fullSample.height * scaleFactor));

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileWidth;
    tileCanvas.height = tileHeight;
    const tileCtx = tileCanvas.getContext('2d', { alpha: true });
    if (!tileCtx) {
      return { ok: false, destBacking };
    }

    tileCtx.imageSmoothingEnabled = false;
    tileCtx.drawImage(
      source,
      fullSample.x,
      fullSample.y,
      fullSample.width,
      fullSample.height,
      0,
      0,
      tileWidth,
      tileHeight
    );

    const pattern = ctx.createPattern(tileCanvas, 'repeat');
    if (!pattern) {
      return { ok: false, destBacking };
    }

    const phaseX = isFixed ? Math.round(placement.tile.phase.x * dpr) : Math.round(placement.tile.phase.x);
    const phaseY = isFixed ? Math.round(placement.tile.phase.y * dpr) : Math.round(placement.tile.phase.y);

    ctx.save();
    ctx.translate(-phaseX, -phaseY);
    ctx.fillStyle = pattern;
    ctx.fillRect(destBacking.x + phaseX, destBacking.y + phaseY, destBacking.width, destBacking.height);
    ctx.restore();

    return { ok: true, destBacking, tileCanvas };
  }

  if (fit === 'cover') {
    const fxCSS = Math.round(destCss.x);
    const fyCSS = Math.round(destCss.y);
    const fwCSS = Math.max(1, Math.round(destCss.width));
    const fhCSS = Math.max(1, Math.round(destCss.height));

    const scaleU = isFixed ? dpr : 1;
    const fx = Math.round(fxCSS * scaleU);
    const fy = Math.round(fyCSS * scaleU);
    const fw = Math.max(1, Math.round(fwCSS * scaleU));
    const fh = Math.max(1, Math.round(fhCSS * scaleU));

    const s = paintedRect ?? { x: 0, y: 0, width: source.width, height: source.height };

    const k = Math.max(fw / s.width, fh / s.height);

    const dw = Math.max(1, Math.round(s.width * k));
    const dh = Math.max(1, Math.round(s.height * k));
    const dx = Math.round(fx + (fw - dw) / 2);
    const dy = Math.round(fy + (fh - dh) / 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(fx, fy, fw, fh);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    // log removed

    ctx.drawImage(
      source,
      s.x,
      s.y,
      s.width,
      s.height,
      dx,
      dy,
      dw,
      dh
    );

    ctx.restore();

    return { ok: true, destBacking: { x: dx, y: dy, width: dw, height: dh } };
  }

  ctx.drawImage(
    source,
    sampleRect.x,
    sampleRect.y,
    sampleRect.width,
    sampleRect.height,
    destBacking.x,
    destBacking.y,
    destBacking.width,
    destBacking.height
  );

  return { ok: true, destBacking };
};

const logSummary = () => {};
const logResize = () => {};

const transformWarningCache = new Set();
const warnNonIdentityTransform = (layerId, matrix) => {
  const key = `${layerId ?? 'unknown'}::${formatMatrix(matrix)}`;
  if (transformWarningCache.has(key)) {
    return;
  }
  transformWarningCache.add(key);
  console.warn('[WARN] Non-identity transform at draw time', 'layer=', layerId ?? '-', 'matrix=', formatMatrix(matrix));
};

const POINTER_GUARD_KEY = Symbol.for('VesselPointerGuard');

function clamp01(value) {
  return clamp(value, 0, 1);
}

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

const MIN_DIMENSION = 1e-3;

const clampDimension = (value) => Math.max(MIN_DIMENSION, toNum(value, MIN_DIMENSION));

const createDefaultContainerLayout = () => ({
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  sizeMode: 'fill'
});

const normalizeContainerLayout = (layout) => {
  const base = layout && typeof layout === 'object' ? layout : {};
  const defaults = createDefaultContainerLayout();
  const padding = base.padding && typeof base.padding === 'object'
    ? {
        top: toNum(base.padding.top, 0),
        right: toNum(base.padding.right, 0),
        bottom: toNum(base.padding.bottom, 0),
        left: toNum(base.padding.left, 0)
      }
    : { ...defaults.padding };

  const sizeMode = base.sizeMode === 'fixed' || base.sizeMode === 'hug' || base.sizeMode === 'fill'
    ? base.sizeMode
    : defaults.sizeMode;

  return {
    padding,
    sizeMode,
    width: sizeMode === 'fixed' && Number.isFinite(base.width) ? Math.max(1, base.width) : undefined,
    height: sizeMode === 'fixed' && Number.isFinite(base.height) ? Math.max(1, base.height) : undefined
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
  const placements = [];

  layers.forEach((entry) => {
    if (entry.hidden) {
      return;
    }

    const viewportForLayer = {
      width: innerWidth,
      height: innerHeight
    };

    const surface = {
      width: Math.max(1, entry.surface.width),
      height: Math.max(1, entry.surface.height)
    };

    const isTile = entry.alignment?.fit === 'tile';
    const anchorContent = entry.alignment?.positioning === 'anchor';
    const basisSize = entry.content && (isTile || anchorContent)
      ? {
          width: Math.max(1, (entry.content?.width ?? surface.width)),
          height: Math.max(1, (entry.content?.height ?? surface.height))
        }
      : {
          width: surface.width,
          height: surface.height
        };

    const paintedBounds = {
      x: 0,
      y: 0,
      width: basisSize.width,
      height: basisSize.height
    };

    const transform = fitComputeLayoutTransform(entry.alignment, viewportForLayer, paintedBounds);

    placements.push({
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

  return placements;
};

const applyDesignLayout = (metadata) => normalizeLayerSpatialMetadata(metadata);

const computeViewportMapping = (viewport, canvasWidth, canvasHeight) => {
  const designWidth = Math.max(1, toNum(viewport?.designWidth, canvasWidth || 1));
  const designHeight = Math.max(1, toNum(viewport?.designHeight, canvasHeight || 1));
  const mode = viewport?.mode === 'fill' || viewport?.mode === 'fit' || viewport?.mode === 'cover' ? viewport.mode : 'fixed';

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
  } else if (mode === 'cover') {
    const uniform = Math.max(scaleX, scaleY);
    const contentWidth = designWidth * uniform;
    const contentHeight = designHeight * uniform;
    offsetX = (canvasWidth - contentWidth) / 2;
    offsetY = (canvasHeight - contentHeight) / 2;
    scaleX = uniform;
    scaleY = uniform;
  }

  const resolvedCanvasWidth = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : designWidth * scaleX;
  const resolvedCanvasHeight = Number.isFinite(canvasHeight) ? Math.max(0, canvasHeight) : designHeight * scaleY;

  return {
    mode,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    designWidth,
    designHeight,
    canvasWidth: resolvedCanvasWidth,
    canvasHeight: resolvedCanvasHeight
  };
};

const computeDocumentViewportMapping = (metadata, canvasWidth, canvasHeight) => {
  const viewport = metadata?.viewport ?? {};
  const projectWidth = Math.max(1, toNum(metadata?.project?.width, viewport?.designWidth ?? canvasWidth));
  const projectHeight = Math.max(1, toNum(metadata?.project?.height, viewport?.designHeight ?? canvasHeight));
  return computeViewportMapping({
    ...viewport,
    designWidth: projectWidth,
    designHeight: projectHeight,
  }, canvasWidth, canvasHeight);
};

const resolveAnchorPivot = (anchorValue) => {
  if (!anchorValue) {
    return { px: 0, py: 0 };
  }

  const normalized = String(anchorValue)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'center':
    case 'middle':
      return { px: 0.5, py: 0.5 };
    case 'top':
    case 'top-center':
    case 'center-top':
    case 'top-middle':
      return { px: 0.5, py: 0 };
    case 'bottom':
    case 'bottom-center':
    case 'center-bottom':
    case 'bottom-middle':
      return { px: 0.5, py: 1 };
    case 'left':
    case 'center-left':
    case 'left-center':
    case 'middle-left':
      return { px: 0, py: 0.5 };
    case 'right':
    case 'center-right':
    case 'right-center':
    case 'middle-right':
      return { px: 1, py: 0.5 };
    case 'top-left':
    case 'left-top':
      return { px: 0, py: 0 };
    case 'top-right':
    case 'right-top':
      return { px: 1, py: 0 };
    case 'bottom-left':
    case 'left-bottom':
      return { px: 0, py: 1 };
    case 'bottom-right':
    case 'right-bottom':
      return { px: 1, py: 1 };
    case 'stretch':
      return { px: 0, py: 0 };
    default: {
      const tokens = normalized.split(/[^a-z]+/).filter(Boolean);
      if (tokens.length === 0) {
        return { px: 0, py: 0 };
      }

      let px;
      let py;
      let sawCenter = false;

      for (const token of tokens) {
        if (token === 'left') {
          px = 0;
        } else if (token === 'right') {
          px = 1;
        } else if (token === 'top') {
          py = 0;
        } else if (token === 'bottom') {
          py = 1;
        } else if (token === 'center' || token === 'middle') {
          sawCenter = true;
        }
      }

      if (px === undefined) {
        px = sawCenter ? 0.5 : 0;
      }

      if (py === undefined) {
        py = sawCenter ? 0.5 : 0;
      }

      return { px, py };
    }
  }
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
  pbpx: 'pixelBoundsPx',
  pbpr: 'pixelBoundsPercent',
  dbpx: 'documentBoundsPx',
  dbpr: 'documentBoundsPercent',
  lp: 'layoutPlacement',
  fr: 'frame',
  tr: 'transform',
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
  txf: 'textureFrames',
  txfm: 'textureFrameMap',
  md: 'mode',
  ia: 'isAnimating',
  bs: 'brushState',
  amk: 'alphaMask',
  gs: 'gradientStops',
  gib: 'gradientIdBuffer',
  ib: 'indexBuffer',
  sp: 'slotPalettes',
  pl: 'palette',
  ao: 'animationOffset',
  tf: 'targetFPS',
  fd: 'flowDirection',
  am: 'alphaMode',
  rs: 'recolorSettings',
  gr: 'gradient',
  grf: 'gradientRef',
  spd: 'brushSpeed',
  smd: 'speedMode',
  ss: 'slotSpeeds',
  smin: 'speedMin',
  smax: 'speedMax',
  si: 'stackIndex',
  bf: 'bundleFormat',
  vpp: 'viewportPreset',
  ihl: 'includeHiddenLayers',
  ecf: 'embedCanvasFallback',
  mo: 'minifyOutput',
  plp: 'perfectLoop',
  fps: 'fps',
  tfm: 'totalFrames',
  ds: 'durationSeconds',
  pm: 'phaseMap',
  sq: 'sequential'
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

const normalizeLayerSpatialMetadata = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers)) {
    return metadata;
  }

  const projectWidth = Math.max(1, toNum(metadata.project?.width, 1));
  const projectHeight = Math.max(1, toNum(metadata.project?.height, 1));
  const documentSize = {
    width: projectWidth,
    height: projectHeight
  };

  const normalizeRect = (rect, fallback) => {
    if (!rect || typeof rect !== 'object') {
      return null;
    }
    const width = clampDimension(toNum(rect.width, fallback.width));
    const height = clampDimension(toNum(rect.height, fallback.height));
    return {
      x: round3(toNum(rect.x, 0)),
      y: round3(toNum(rect.y, 0)),
      width: round3(width),
      height: round3(height)
    };
  };

  const normalizePercentRect = (rect) => {
    if (!rect || typeof rect !== 'object') {
      return null;
    }
    return {
      x: round3(toNum(rect.x, 0)),
      y: round3(toNum(rect.y, 0)),
      width: round3(toNum(rect.width, 0)),
      height: round3(toNum(rect.height, 0))
    };
  };

  const derivePercentFromRect = (rect, document) => {
    if (!rect) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const safeWidth = Math.max(MIN_DIMENSION, document.width);
    const safeHeight = Math.max(MIN_DIMENSION, document.height);
    return {
      x: round3((rect.x / safeWidth) * 100),
      y: round3((rect.y / safeHeight) * 100),
      width: round3((rect.width / safeWidth) * 100),
      height: round3((rect.height / safeHeight) * 100)
    };
  };

  let needsLayoutPlacement = false;

  metadata.layers.forEach((layer) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }

    const sourceWidth = Math.max(1, toNum(layer?.source?.width, documentSize.width));
    const sourceHeight = Math.max(1, toNum(layer?.source?.height, documentSize.height));
    const fallbackRect = {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight
    };

    const rectCandidates = [
      layer.documentBoundsPx,
      layer.pixelBoundsPx,
      layer.bounds,
      layer.placement
    ];

    let resolvedRect = null;
    for (const candidate of rectCandidates) {
      const normalized = normalizeRect(candidate, fallbackRect);
      if (normalized) {
        resolvedRect = normalized;
        break;
      }
    }

    if (!resolvedRect) {
      resolvedRect = { ...fallbackRect };
    }

    layer.documentBoundsPx = resolvedRect;

    const hasPaintedSize = layer.paintedSize && typeof layer.paintedSize === 'object';
    const paintedFromPixel = layer.pixelBoundsPx && typeof layer.pixelBoundsPx === 'object';

    if (hasPaintedSize) {
      const width = Math.max(1, round3(toNum(layer.paintedSize.width, resolvedRect.width)));
      const height = Math.max(1, round3(toNum(layer.paintedSize.height, resolvedRect.height)));
      layer.paintedSize = { width, height };
    } else {
      layer.paintedSize = paintedFromPixel
        ? { width: resolvedRect.width, height: resolvedRect.height }
        : {
            width: Math.max(1, layer.documentBoundsPx.width),
            height: Math.max(1, layer.documentBoundsPx.height)
          };
    }

    const normalizedPercent = layer.documentBoundsPercent && typeof layer.documentBoundsPercent === 'object'
      ? normalizePercentRect(layer.documentBoundsPercent)
      : layer.pixelBoundsPercent && typeof layer.pixelBoundsPercent === 'object'
        ? normalizePercentRect(layer.pixelBoundsPercent)
        : null;

    if (normalizedPercent) {
      layer.documentBoundsPercent = normalizedPercent;
    } else {
      layer.documentBoundsPercent = derivePercentFromRect(resolvedRect, documentSize);
    }

    if (!layer.layoutPlacement || typeof layer.layoutPlacement !== 'object') {
      needsLayoutPlacement = true;
    }
  });

  if (needsLayoutPlacement) {
    // Viewer rendering must rely solely on computePlacement → drawLayerWithPlacement.
    // Skip exporter layout transforms (fitComputeLayoutTransform) here to avoid
    // injecting alternative scaling/translation paths into the viewer loop.
  }

  metadata.layers.forEach((layer) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }
    delete layer.bounds;
    delete layer.pixelBoundsPercent;
    delete layer.placement;
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
  const designWidth = toNum(viewport.designWidth ?? viewport.width ?? metadata.project?.width, 0);
  const designHeight = toNum(viewport.designHeight ?? viewport.height ?? metadata.project?.height, 0);
  if (designWidth <= 0 || designHeight <= 0) {
    throw new Error('Missing viewport dimensions');
  }
  viewport.designWidth = designWidth;
  viewport.designHeight = designHeight;
  viewport.mode = viewport.mode === 'fill' || viewport.mode === 'fit' || viewport.mode === 'cover' ? viewport.mode : 'fixed';
  if (!Array.isArray(metadata.layers)) {
    throw new Error('Layers array missing or invalid');
  }
};

const prepareMetadata = (metadata) => {
  const expanded = normalizeLayerSpatialMetadata(
    restoreSharedGradients(expandVesselMetadata(deepClone(metadata)))
  );

  if (ccDebugOn()) {
    expanded.layers?.forEach((ly) => {
      const bs = ly?.colorCycle?.brushState;
      const buffer = bs?.indexBuffer;
      const enc = Array.isArray(buffer) ? 'array' : (typeof buffer === 'string' ? 'b64z' : 'none');
      const len = Array.isArray(buffer) ? buffer.length : (typeof buffer === 'string' ? buffer.length : 0);
      ccLog('VIEWER metadata CC', {
        id: ly?.id,
        enc,
        len,
        wh: bs ? { w: bs.width, h: bs.height } : null,
        sample: Array.isArray(buffer) ? ccSample(buffer, 12) : undefined
      });
    });
  }

  diagnostics.log('[goblet] Expanded metadata check:', {
    layerCount: expanded.layers?.length,
    layersWithTextures: expanded.layers?.map((layer) => ({
      id: layer.id,
      hasTexture: Boolean(layer.assets?.texture),
      textureLength: layer.assets?.texture?.length
    }))
  });
  validateMetadata(expanded);
  // Bounds from the exporter are the source of truth. Do not re-layout here.
  return expanded;
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

class SequentialLayerPlayer {
  constructor(layer, frames, defaultFps) {
    this.layer = layer;
    this.frames = Array.isArray(frames) ? frames.filter(Boolean) : [];
    this.frameMap = Array.isArray(layer?.assets?.textureFrameMap) ? layer.assets.textureFrameMap.slice() : null;
    const sequential = layer?.sequential;
    const fallbackFps = Number.isFinite(defaultFps) && defaultFps > 0 ? defaultFps : 12;
    const mappedFrameCount = this.frameMap?.length ?? 0;
    const metadataFrameCount = Math.max(1, posInt(sequential?.totalFrames, 1));
    this.frameCount = Math.max(1, Math.max(metadataFrameCount, mappedFrameCount));
    this.fps = Math.max(1, toNum(sequential?.fps, fallbackFps));
    this.currentFrame = 0;
    this.frameAccumulatorSeconds = 0;
    this.frameDurationSeconds = 1 / this.fps;

    if (this.frameMap && this.frameMap.length > 0) {
      const safeMap = new Array(this.frameCount).fill(-1);
      const sourceMap = this.frameMap;
      for (let i = 0; i < this.frameCount; i += 1) {
        safeMap[i] = sourceMap[i] ?? -1;
      }
      const normalizedMap = safeMap.map((entry) => {
        if (!Number.isFinite(entry) || entry < 0) {
          return -1;
        }
        return Math.max(0, Math.min(this.frames.length - 1, Math.round(entry)));
      });
      let firstValid = -1;
      for (let i = 0; i < normalizedMap.length; i += 1) {
        if (normalizedMap[i] >= 0) {
          firstValid = normalizedMap[i];
          break;
        }
      }
      if (firstValid >= 0) {
        let carry = firstValid;
        for (let i = 0; i < normalizedMap.length; i += 1) {
          if (normalizedMap[i] >= 0) {
            carry = normalizedMap[i];
          } else {
            normalizedMap[i] = carry;
          }
        }
        this.frameMap = normalizedMap;
      } else {
        this.frameMap = null;
      }
    }
  }

  hasAnimation() {
    return this.frames.length > 1 && this.fps > 0;
  }

  advance(deltaSeconds) {
    if (!this.hasAnimation()) {
      return false;
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return false;
    }
    this.frameAccumulatorSeconds += deltaSeconds;
    if (this.frameAccumulatorSeconds < this.frameDurationSeconds) {
      return false;
    }
    const steps = Math.floor(this.frameAccumulatorSeconds / this.frameDurationSeconds);
    if (steps <= 0) {
      return false;
    }
    this.frameAccumulatorSeconds -= steps * this.frameDurationSeconds;
    this.currentFrame = (this.currentFrame + steps) % this.frameCount;
    return true;
  }

  getSource() {
    if (this.frames.length === 0) {
      return null;
    }
    if (this.frameMap && this.frameMap.length > 0) {
      const logicalIndex = Math.max(0, Math.min(this.frameCount - 1, this.currentFrame));
      const mapped = this.frameMap[logicalIndex];
      if (Number.isFinite(mapped) && mapped >= 0) {
        const mappedIndex = Math.max(0, Math.min(this.frames.length - 1, Math.round(mapped)));
        return this.frames[mappedIndex] ?? null;
      }
    }
    const frameSpan = Math.max(1, Math.min(this.frameCount, this.frames.length));
    const index = Math.max(0, Math.min(frameSpan - 1, this.currentFrame % frameSpan));
    return this.frames[index] ?? this.frames[0] ?? null;
  }

  destroy() {
    this.frames = [];
  }
}

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

const resizeAlphaMaskBuffer = (source, srcWidth, srcHeight, destWidth, destHeight) => {
  if (!source || !source.length) {
    return null;
  }
  const targetWidth = Math.max(1, Math.round(destWidth));
  const targetHeight = Math.max(1, Math.round(destHeight));
  const width = Math.max(1, Math.round(srcWidth));
  const height = Math.max(1, Math.round(srcHeight));
  if (width === targetWidth && height === targetHeight) {
    if (source.length === width * height) {
      return source;
    }
    const normalized = new Uint8Array(width * height);
    normalized.set(source.subarray(0, Math.min(source.length, normalized.length)));
    return normalized;
  }
  const output = new Uint8Array(targetWidth * targetHeight);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.max(0, Math.floor(y * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.max(0, Math.floor(x * scaleX)));
      const srcIdx = srcY * width + srcX;
      const dstIdx = y * targetWidth + x;
      output[dstIdx] = source[srcIdx] ?? 0;
    }
  }
  return output;
};

const applyMaskToAlphaChannel = (alphaBuffer, maskBuffer) => {
  if (!alphaBuffer || !maskBuffer) {
    return;
  }
  const pixelCount = Math.min(maskBuffer.length, Math.floor(alphaBuffer.length / 4));
  for (let i = 0, alphaIndex = 3; i < pixelCount; i += 1, alphaIndex += 4) {
    const erase = maskBuffer[i];
    if (!erase) {
      continue;
    }
    const current = alphaBuffer[alphaIndex] || 0;
    const next = Math.max(0, Math.round((current * (255 - erase)) / 255));
    alphaBuffer[alphaIndex] = next;
  }
};

const hasVisibleAlpha = (alphaBuffer) => {
  if (!alphaBuffer || alphaBuffer.length < 4) {
    return false;
  }
  for (let i = 3; i < alphaBuffer.length; i += 4) {
    if (alphaBuffer[i]) {
      return true;
    }
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

const normalizeSlotPalettes = (slotPalettes, fallbackGradient) => {
  if (!Array.isArray(slotPalettes) || slotPalettes.length === 0) {
    return null;
  }
  const map = new Map();
  slotPalettes.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const slot = Number(entry.slot);
    if (!Number.isFinite(slot)) {
      return;
    }
    const stops = Array.isArray(entry.stops) ? entry.stops : [];
    const normalizedStops = normalizeGradientStops(stops);
    map.set(Math.max(0, Math.min(255, Math.round(slot))), normalizedStops);
  });
  if (map.size === 0) {
    return null;
  }
  if (!map.has(0) && Array.isArray(fallbackGradient) && fallbackGradient.length > 0) {
    map.set(0, normalizeGradientStops(fallbackGradient));
  }
  return map;
};

const normalizeSlotSpeeds = (slotSpeeds) => {
  if (!Array.isArray(slotSpeeds) || slotSpeeds.length === 0) {
    return null;
  }
  const map = new Map();
  if (typeof slotSpeeds[0] === 'number') {
    slotSpeeds.forEach((speed, slot) => {
      if (!Number.isFinite(speed)) {
        return;
      }
      map.set(Math.max(0, Math.min(255, Math.round(slot))), speed);
    });
    return map.size > 0 ? map : null;
  }
  slotSpeeds.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const slot = Number(entry.slot);
    const speed = Number(entry.speed);
    if (!Number.isFinite(slot) || !Number.isFinite(speed)) {
      return;
    }
    map.set(Math.max(0, Math.min(255, Math.round(slot))), speed);
  });
  return map.size > 0 ? map : null;
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
      const a = alpha[aIdx] || (effective !== 0 ? 255 : 0);
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

const fillPixelsFromIndicesWithGradientIds = (indices, gradientIds, lutsBySlot, fallbackLut, outPixels32, alpha, options = {}) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;

  if (!fallbackLut || fallbackLut.length === 0) {
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
      const slot = gradientIds ? (gradientIds[i] ?? 0) : 0;
      const lut = lutsBySlot?.get(slot) ?? fallbackLut;
      const capped = effective >= 0 && effective < lut.length ? effective : ((effective % lut.length) + lut.length) % lut.length;
      const rgb = lut[capped] & 0x00ffffff;
      const a = alpha[aIdx] || (effective !== 0 ? 255 : 0);
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
      const slot = gradientIds ? (gradientIds[i] ?? 0) : 0;
      const lut = lutsBySlot?.get(slot) ?? fallbackLut;
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
      const a = alpha[aIdx] || 255;
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
const SPEED_BYTE_RANGE = 254;
const DEFAULT_SPEED_MIN = 0.01;
const DEFAULT_SPEED_MAX = 0.33;
const FLOW_SLOT_BITS = 6;
const FLOW_SLOT_MASK = (1 << FLOW_SLOT_BITS) - 1;
const FLOW_MODE_FORWARD = 1;
const FLOW_MODE_REVERSE = 2;
const FLOW_MODE_PINGPONG = 3;
const MODE_COUNT = 3;
const SB_COUNT = 256;
const SLOT_COUNT = FLOW_SLOT_MASK + 1;
const MODE_TO_IDX = new Int8Array(256);
MODE_TO_IDX[FLOW_MODE_FORWARD] = 0;
MODE_TO_IDX[FLOW_MODE_REVERSE] = 1;
MODE_TO_IDX[FLOW_MODE_PINGPONG] = 2;

const packABGR32 = (c) => (c.a << 24) | (c.b << 16) | (c.g << 8) | c.r;

const buildDiscretePalette32FromGradient = (gradientStops, cycleColors) => {
  const n = Math.max(1, cycleColors | 0);
  const pal = new Uint32Array(n);
  if (!Array.isArray(gradientStops) || gradientStops.length === 0) {
    pal.fill(0xffffffff);
    return pal;
  }
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : (i / (n - 1));
    const c = sampleGradient(gradientStops, t);
    pal[i] = packABGR32(c);
  }
  return pal;
};

const buildPaletteShiftLUT256 = ({ basePalette32, cycleColors, offset01 }) => {
  const lut = new Uint32Array(256);
  const n = Math.max(1, cycleColors | 0);
  let off = offset01 % 1;
  if (off < 0) off += 1;
  const shift = (off * n) | 0;
  for (let i = 0; i < 256; i += 1) {
    let p = i - 1;
    if (p < 0) p = 0;
    else if (p >= n) p = n - 1;
    let src = p - shift;
    src %= n;
    if (src < 0) src += n;
    lut[i] = basePalette32[src];
  }
  return lut;
};

const toFiniteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const resolveAnimationSpeed = (rawExportedSpeed, rawFallbackSpeed, shouldAnimate) => {
  const exported = toFiniteNumberOrNull(rawExportedSpeed);
  const fallbackSpeed = toFiniteNumberOrNull(rawFallbackSpeed);
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

const decodeColorCycleSpeedByte = (byte, minSpeed, maxSpeed) => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const minV = Number.isFinite(minSpeed) ? Number(minSpeed) : DEFAULT_SPEED_MIN;
  const maxV = Number.isFinite(maxSpeed) ? Number(maxSpeed) : DEFAULT_SPEED_MAX;
  const normalized = Math.max(0, Math.min(SPEED_BYTE_RANGE, Math.round(byte) - 1));
  const t = normalized / SPEED_BYTE_RANGE;
  return minV + t * (maxV - minV);
};

const collectDistinctSpeedBytes = (speedBuffer) => {
  const set = new Set();
  set.add(0);
  if (!speedBuffer) {
    return set;
  }
  for (let i = 0; i < speedBuffer.length; i += 1) {
    const value = speedBuffer[i] | 0;
    if (value !== 0) {
      set.add(value);
    }
    if (set.size > 64) {
      break;
    }
  }
  return set;
};

const collectDistinctSlots = (gradientIdBuffer) => {
  const set = new Set();
  set.add(0);
  if (!gradientIdBuffer) {
    return set;
  }
  for (let i = 0; i < gradientIdBuffer.length; i += 1) {
    const slot = gradientIdBuffer[i] & FLOW_SLOT_MASK;
    if (slot !== 0) {
      set.add(slot);
    }
    if (set.size > 64) {
      break;
    }
  }
  return set;
};

const analyzeSpeedBuffer = (speedBuffer) => {
  if (!speedBuffer || !speedBuffer.length) {
    return { distinctNonZero: 0, lone: 0 };
  }
  let seenNonZero = -1;
  for (let i = 0; i < speedBuffer.length; i += 1) {
    const sb = speedBuffer[i];
    if (sb === 0) continue;
    if (seenNonZero === -1) {
      seenNonZero = sb;
    } else if (sb !== seenNonZero) {
      return { distinctNonZero: 2, lone: seenNonZero };
    }
  }
  return { distinctNonZero: seenNonZero === -1 ? 0 : 1, lone: seenNonZero === -1 ? 0 : seenNonZero };
};

const downsampleBuffer = (source, srcW, srcH, dstW, dstH) => {
  if (!source) {
    return source;
  }
  const out = new Uint8Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const srcY = Math.min(srcH - 1, Math.floor(y * scaleY));
    const srcRow = srcY * srcW;
    const outRow = y * dstW;
    for (let x = 0; x < dstW; x += 1) {
      const srcX = Math.min(srcW - 1, Math.floor(x * scaleX));
      out[outRow + x] = source[srcRow + srcX] ?? 0;
    }
  }
  return out;
};

const resolveFlowMode = (flowBits) => {
  if (flowBits === FLOW_MODE_REVERSE) return FLOW_MODE_REVERSE;
  if (flowBits === FLOW_MODE_PINGPONG) return FLOW_MODE_PINGPONG;
  return FLOW_MODE_FORWARD;
};

const markTouchedSpeed = (player, sb) => {
  if (player._touchedSpeedBytes[sb] === 0) {
    player._touchedSpeedBytes[sb] = 1;
    player._touchedSpeedList[player._touchedSpeedListLen++] = sb;
  }
};

const clearTouchedTables = (player) => {
  const slotLuts = player._slotLuts;
  const fallback = player._fallbackLuts;
  const touched = player._touchedSpeedList;
  const n = player._touchedSpeedListLen;
  for (let k = 0; k < n; k += 1) {
    const sb = touched[k];
    fallback[sb][0] = null;
    fallback[sb][1] = null;
    fallback[sb][2] = null;
    const sbSlot = slotLuts[sb];
    for (let m = 0; m < 3; m += 1) {
      const arr = sbSlot[m];
      for (let s = 0; s < SLOT_COUNT; s += 1) {
        arr[s] = null;
      }
    }
    player._touchedSpeedBytes[sb] = 0;
  }
  player._touchedSpeedListLen = 0;
};

const modeIdxFromFlowModeConst = (modeConst) => (
  modeConst === FLOW_MODE_REVERSE ? 1 : (modeConst === FLOW_MODE_PINGPONG ? 2 : 0)
);

const populateTablesFromMaps = (player, lutsBySpeedModeSlot, fallbackLutsBySpeedMode) => {
  const slotLuts = player._slotLuts;
  const fallback = player._fallbackLuts;

  for (const [sb, modeMap] of fallbackLutsBySpeedMode.entries()) {
    markTouchedSpeed(player, sb);
    for (const [modeConst, lut] of modeMap.entries()) {
      const mi = modeIdxFromFlowModeConst(modeConst);
      fallback[sb][mi] = lut;
    }
  }

  for (const [sb, modeMap] of lutsBySpeedModeSlot.entries()) {
    markTouchedSpeed(player, sb);
    for (const [modeConst, slotMap] of modeMap.entries()) {
      const mi = modeIdxFromFlowModeConst(modeConst);
      const arr = slotLuts[sb][mi];
      for (const [slot, lut] of slotMap.entries()) {
        arr[slot & FLOW_SLOT_MASK] = lut;
      }
    }
  }
};

const fillPixelsFromIndicesWithSpeedAndFlow = (
  indices,
  gradientIds,
  speedBytes,
  lutsBySpeedAndMode,
  outPixels32,
  alpha,
  options = {}
) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;

  for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
    const rawIndex = indices[i] ?? 0;
    if (transparentZero && rawIndex === 0) {
      outPixels32[i] = 0;
      continue;
    }
    const effective = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
    const speedByte = speedBytes ? (speedBytes[i] ?? 0) : 0;
    const gid = gradientIds ? (gradientIds[i] ?? 0) : 0;
    const flowBits = gradientIds ? (gid >> FLOW_SLOT_BITS) : FLOW_MODE_FORWARD;
    const mode = resolveFlowMode(flowBits);
    const modeMap = lutsBySpeedAndMode.get(speedByte) ?? lutsBySpeedAndMode.get(0);
    const lut = modeMap?.get(mode) ?? modeMap?.get(FLOW_MODE_FORWARD);
    if (!lut) {
      outPixels32[i] = 0;
      continue;
    }
    const capped = effective >= 0 && effective < lut.length ? effective : ((effective % lut.length) + lut.length) % lut.length;
    if (useAlpha) {
      const rgb = lut[capped] & 0x00ffffff;
      const a = alpha[aIdx] || (effective !== 0 ? 255 : 0);
      outPixels32[i] = (a << 24) | rgb;
    } else {
      outPixels32[i] = lut[capped];
    }
  }
};

const fillPixelsFromIndicesWithGradientIdsAndSpeedAndFlow = (
  indices,
  gradientIds,
  speedBytes,
  lutsBySpeedModeSlot,
  fallbackLutsBySpeedMode,
  outPixels32,
  alpha,
  options = {}
) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;

  const hasSpeed = Boolean(speedBytes);
  const hasGid = Boolean(gradientIds);
  const slotMask = FLOW_SLOT_MASK;
  const slotBits = FLOW_SLOT_BITS;
  const miForward = 0;

  const slotLuts = lutsBySpeedModeSlot;
  const fallbackLuts = fallbackLutsBySpeedMode;

  for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
    const rawIndex = indices[i];
    if (transparentZero && rawIndex === 0) {
      outPixels32[i] = 0;
      continue;
    }
    const effective = subtractOne && rawIndex > 0 ? rawIndex - 1 : rawIndex;
    const lutIndex = effective & 255;
    const sb = hasSpeed ? speedBytes[i] : 0;
    const gid = hasGid ? gradientIds[i] : 0;
    const slot = gid & slotMask;
    const flowBits = hasGid ? (gid >> slotBits) : FLOW_MODE_FORWARD;
    const mi = flowBits === FLOW_MODE_REVERSE ? 1 : (flowBits === FLOW_MODE_PINGPONG ? 2 : 0);

    let lut =
      (slotLuts[sb] && slotLuts[sb][mi] && slotLuts[sb][mi][slot]) ||
      (slotLuts[sb] && slotLuts[sb][miForward] && slotLuts[sb][miForward][slot]) ||
      (slotLuts[0] && slotLuts[0][mi] && slotLuts[0][mi][slot]) ||
      (slotLuts[0] && slotLuts[0][miForward] && slotLuts[0][miForward][slot]) ||
      (fallbackLuts[sb] && (fallbackLuts[sb][mi] || fallbackLuts[sb][miForward])) ||
      (fallbackLuts[0] && (fallbackLuts[0][mi] || fallbackLuts[0][miForward])) ||
      null;

    if (!lut) {
      outPixels32[i] = 0;
      continue;
    }

    if (useAlpha) {
      const rgb = lut[lutIndex] & 0x00ffffff;
      const a = alpha[aIdx] || (effective !== 0 ? 255 : 0);
      outPixels32[i] = (a << 24) | rgb;
    } else {
      outPixels32[i] = lut[lutIndex];
    }
  }
};

class ColorCycleLayerPlayer {
  constructor(layer, textureImage) {
    this.layer = layer;
    this.image = textureImage;
    const halfResPref = typeof window !== 'undefined'
      && window.localStorage
      && window.localStorage.getItem('vesselGobletHalfRes');
    this.renderScale = halfResPref === 'true' ? 0.5 : 1;
    this._adaptiveScaleEnabled = halfResPref !== 'true';

    const width = Math.max(1, Math.round(layer.source?.width ?? textureImage?.naturalWidth ?? textureImage?.width ?? 1));
    const height = Math.max(1, Math.round(layer.source?.height ?? textureImage?.naturalHeight ?? textureImage?.height ?? 1));

    this.canvas = document.createElement('canvas');
    this.createSurface(width, height);

    this.alpha = null;
    this.baseImageData = null;
    this.indexBuffer = null;
    this.gradientIdBuffer = null;
    this.speedBuffer = null;
    this.speedMode = null;
    this.slotSpeeds = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.gradient = DEFAULT_GRADIENT;
    this.slotGradients = null;
    this.cycleColors = 16;
    this.mappingMode = 'banded';
    this.flowMapping = 'palette';
    this.flowDirection = 'forward';
    this.speed = 0;
    this.baseTimeSeconds = 0;
    this.startTimeMs = 0;
    this.baseOffset = 0;
    this.targetFPS = null;
    this.frameAccumulator = 0;
    this.speedMin = null;
    this.speedMax = null;
    this._distinctSpeedBytes = null;
    this._usedSlots = null;
    this._lutCacheBase = new Map();
    this._lutCacheSlots = new Map();
    this._lutCacheBands = null;
    this._slotLuts = Array.from({ length: SB_COUNT }, () =>
      Array.from({ length: MODE_COUNT }, () => new Array(SLOT_COUNT).fill(null))
    );
    this._fallbackLuts = Array.from({ length: SB_COUNT }, () => new Array(MODE_COUNT).fill(null));
    this._touchedSpeedBytes = new Uint8Array(SB_COUNT);
    this._touchedSpeedList = new Uint8Array(SB_COUNT);
    this._touchedSpeedListLen = 0;
    this._basePalette32BySlot = new Map();
    this._basePaletteSize = 0;
    this.usePerPixelSpeed = false;
    this.hasNonZeroSpeedBuffer = false;
    this.currentTick = 0;
    this.isAnimating = false;
    this.mode = layer.colorCycle?.mode ?? 'brush';
    this.zeroTransparent = false;
    this.subtractIndexOffset = false;
    this._fillMsAccum = 0;
    this._fillWindowStartMs = 0;
    this._lastScaleCheckMs = 0;
    this._lastFps = null;
    this._isReinitializing = false;
    this._hasVisibleAlpha = true;
    this._lastShiftKeyBySpeedByte = new Int32Array(SB_COUNT).fill(-1);
    this._lastSlotShiftKeyBySlot = null;
    this._lastSlotShiftBase = -1;
    this._lastShiftKeyBase = -1;
    this._lastShiftKeyKeyed = null;
    this._lastShiftKeyMode = null;
  }

  createSurface(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const renderW = Math.max(1, Math.round(w * this.renderScale));
    const renderH = Math.max(1, Math.round(h * this.renderScale));
    this.canvas.width = w;
    this.canvas.height = h;
    const outputCtx = this.canvas.getContext('2d', { alpha: true });
    if (!outputCtx) {
      throw new Error('Unable to create 2D context for color cycle layer');
    }
    outputCtx.imageSmoothingEnabled = false;
    this.outputCtx = outputCtx;
    this.width = renderW;
    this.height = renderH;
    this.renderCanvas = this.renderScale === 1 ? this.canvas : document.createElement('canvas');
    this.renderCanvas.width = renderW;
    this.renderCanvas.height = renderH;
    const ctx = this.renderCanvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Unable to create 2D context for color cycle layer');
    }
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.imageData = ctx.createImageData(renderW, renderH);
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

    const probeAlphaMask = () => {
      if (!__DEV__ || !ccDebugOn()) {
        return;
      }
      if (!this.alpha) {
        return;
      }
      let nonZeroA = 0;
      for (let i = 3; i < this.alpha.length; i += 4) {
        if (this.alpha[i]) {
          nonZeroA += 1;
          if (nonZeroA > 64) {
            break;
          }
        }
      }
      ccLog('sampled alpha nonZero=', nonZeroA);
      if (nonZeroA === 0) {
        ccWarn('base texture alpha is empty; disabling alpha mask for brush mode');
        this.alpha = null;
      }
    };

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
        probeAlphaMask();
      }
    }

    if (!this.alpha) {
      this.alpha = new Uint8ClampedArray(this.width * this.height * 4);
      for (let i = 3; i < this.alpha.length; i += 4) {
        this.alpha[i] = 255;
      }
      probeAlphaMask();
    }

    if (this.mode === 'recolor' && this.flowMapping === 'luminance' && !this.phaseMap && this.baseImageData) {
      this.phaseMap = buildLuminancePhaseMap(this.baseImageData);
    }

    if (colorCycle.alphaMask) {
      await this.applyAlphaMask(colorCycle.alphaMask);
      probeAlphaMask();
    }

    this._hasVisibleAlpha = hasVisibleAlpha(this.alpha);
    this.resetShiftKeyTracking();

    this.startTimeMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    this.renderFrame();
  }

  async applyAlphaMask(maskConfig) {
    if (!maskConfig || !maskConfig.data) {
      return;
    }
    const width = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : this.width;
    const height = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : this.height;
    const payload = await resolveNumericBuffer(maskConfig.data);
    if (!payload || !payload.length) {
      return;
    }

    const expected = width * height;
    let working = payload;
    if (working.length !== expected) {
      diagnostics.warn('[goblet] Alpha mask payload length mismatch', {
        layerId: this.layer?.id ?? null,
        expected,
        actual: working.length
      });
      const normalized = new Uint8Array(expected);
      normalized.set(working.subarray(0, Math.min(working.length, normalized.length)));
      working = normalized;
    }

    const resized = resizeAlphaMaskBuffer(working, width, height, this.width, this.height);
    if (!resized || !resized.length) {
      return;
    }

    const alphaSize = this.width * this.height * 4;
    if (!this.alpha || this.alpha.length < alphaSize) {
      const buffer = new Uint8ClampedArray(alphaSize);
      for (let i = 3; i < buffer.length; i += 4) {
        buffer[i] = 255;
      }
      this.alpha = buffer;
    }

    applyMaskToAlphaChannel(this.alpha, resized);
  }

  async initializeBrushMode(colorCycle, brushState) {
    this.mode = 'brush';
    const sourceWidth = Math.max(1, Math.round(Number.isFinite(brushState.width) ? brushState.width : this.width));
    const sourceHeight = Math.max(1, Math.round(Number.isFinite(brushState.height) ? brushState.height : this.height));
    const width = Math.max(1, Math.round(sourceWidth * this.renderScale));
    const height = Math.max(1, Math.round(sourceHeight * this.renderScale));
    if (width !== this.width || height !== this.height || this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
      this.createSurface(sourceWidth, sourceHeight);
    }

    const rawIndexBuffer = await resolveNumericBuffer(brushState.indexBuffer);
    const indexBuffer = this.renderScale === 1
      ? rawIndexBuffer
      : downsampleBuffer(rawIndexBuffer, sourceWidth, sourceHeight, width, height);
    if (!indexBuffer || indexBuffer.length === 0) {
      throw new Error('Brush state missing index buffer');
    }

    this.indexBuffer = indexBuffer;
    const gradientIdBuffer = brushState.gradientIdBuffer
      ? await resolveNumericBuffer(brushState.gradientIdBuffer)
      : null;
    const resizedGradientIds = gradientIdBuffer && this.renderScale !== 1
      ? downsampleBuffer(gradientIdBuffer, sourceWidth, sourceHeight, width, height)
      : gradientIdBuffer;
    this.gradientIdBuffer = resizedGradientIds && resizedGradientIds.length ? resizedGradientIds : null;
    const speedBuffer = brushState.speedBuffer
      ? await resolveNumericBuffer(brushState.speedBuffer)
      : null;
    const resizedSpeedBuffer = speedBuffer && this.renderScale !== 1
      ? downsampleBuffer(speedBuffer, sourceWidth, sourceHeight, width, height)
      : speedBuffer;
    this.speedBuffer = resizedSpeedBuffer && resizedSpeedBuffer.length ? resizedSpeedBuffer : null;
    if (this.gradientIdBuffer) {
      for (let i = 0; i < this.gradientIdBuffer.length; i += 1) {
        this.gradientIdBuffer[i] = this.gradientIdBuffer[i] & FLOW_SLOT_MASK;
      }
    }
    const alphaMode = typeof brushState.alphaMode === 'string' ? brushState.alphaMode : 'source';
    if (alphaMode === 'opaque-indices') {
      const size = this.width * this.height * 4;
      this.alpha = new Uint8ClampedArray(size);
      for (let i = 0, alphaIndex = 3; i < this.indexBuffer.length && alphaIndex < size; i += 1, alphaIndex += 4) {
        this.alpha[alphaIndex] = this.indexBuffer[i] > 0 ? 255 : 0;
      }
    }
    this.phaseMap = null;
    this.indexPhaseMap = null;
    const baseGradient = brushState.gradientStops?.length ? brushState.gradientStops : colorCycle.gradient;
    this.gradient = normalizeGradientStops(baseGradient);
    this.slotGradients = normalizeSlotPalettes(colorCycle.slotPalettes, this.gradient);
    const explicitBufferMode = colorCycle?.speedMode === 'buffer';
    this.speedMode = explicitBufferMode ? 'buffer' : 'slot';
    this.slotSpeeds = !explicitBufferMode ? normalizeSlotSpeeds(colorCycle?.slotSpeeds) : null;
    if (!explicitBufferMode && this.slotSpeeds) {
      this.speedBuffer = null;
    } else if (!this.slotSpeeds && this.speedBuffer && this.speedMode === 'slot') {
      this.speedMode = 'buffer';
    }
    this.cycleColors = Math.max(1, Math.floor(Array.isArray(brushState.palette) && brushState.palette.length > 0 ? brushState.palette.length : 256));
    this.mappingMode = 'continuous';
    this.flowMapping = 'palette';
    this.zeroTransparent = true;
    this.subtractIndexOffset = true;

    const shouldAnimate = colorCycle.isAnimating !== false;
    this.speed = resolveAnimationSpeed(
      brushState?.animationSpeed,
      colorCycle?.brushSpeed,
      shouldAnimate
    );
    console.log(
      '[goblet][speed src]',
      'brushState.animationSpeed=',
      brushState?.animationSpeed,
      'colorCycle.brushSpeed=',
      colorCycle?.brushSpeed,
      'resolved=',
      this.speed
    );
    const offset = Number.isFinite(brushState.animationOffset) ? brushState.animationOffset : 0;
    this.baseOffset = wrap01(offset);
    this.baseTimeSeconds = 0;
    this.currentTick = wrap01(offset) * this.cycleColors;
    this.flowDirection = normalizeFlowDirection(brushState.flowDirection, 'forward');
    this.isAnimating = shouldAnimate;
    this.speedMin = toFiniteNumberOrNull(colorCycle.speedMin);
    this.speedMax = toFiniteNumberOrNull(colorCycle.speedMax);
    this.targetFPS = toFiniteNumberOrNull(brushState.targetFPS);

    const expectedLength = this.width * this.height;
    if (this.indexBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.indexBuffer.subarray(0, Math.min(expectedLength, this.indexBuffer.length)));
      this.indexBuffer = resized;
    }
    if (this.gradientIdBuffer && this.gradientIdBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.gradientIdBuffer.subarray(0, Math.min(expectedLength, this.gradientIdBuffer.length)));
      this.gradientIdBuffer = resized;
    }
    if (this.speedBuffer && this.speedBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.speedBuffer.subarray(0, Math.min(expectedLength, this.speedBuffer.length)));
      this.speedBuffer = resized;
    }
    const speedInfo = analyzeSpeedBuffer(this.speedBuffer);
    this.usePerPixelSpeed = this.speedMode === 'buffer' && Boolean(this.speedBuffer && this.speedBuffer.length === expectedLength);
    this.hasNonZeroSpeedBuffer = this.speedMode === 'buffer' && speedInfo.distinctNonZero > 0;
    this._distinctSpeedBytes = this.speedMode === 'buffer' ? collectDistinctSpeedBytes(this.speedBuffer) : null;
    this._usedSlots = collectDistinctSlots(this.gradientIdBuffer);
    this._lutCacheBase.clear();
    this._lutCacheSlots.clear();
    this._lutCacheBands = null;
    this._basePalette32BySlot.clear();
    this._basePaletteSize = this.cycleColors | 0;
    this._basePalette32BySlot.set(
      0,
      buildDiscretePalette32FromGradient(this.gradient, this._basePaletteSize)
    );
    if (this.slotGradients && this.slotGradients.size > 0) {
      this.slotGradients.forEach((stops, slot) => {
        this._basePalette32BySlot.set(
          slot & FLOW_SLOT_MASK,
          buildDiscretePalette32FromGradient(stops, this._basePaletteSize)
        );
      });
    }
  }

  async initializeRecolorMode(colorCycle, recolorSettings) {
    this.mode = colorCycle.mode ?? 'recolor';
    const sourceWidth = this.canvas.width;
    const sourceHeight = this.canvas.height;
    const width = Math.max(1, Math.round(sourceWidth * this.renderScale));
    const height = Math.max(1, Math.round(sourceHeight * this.renderScale));
    if (width !== this.width || height !== this.height) {
      this.createSurface(sourceWidth, sourceHeight);
    }
    const rawIndexBuffer = await resolveNumericBuffer(recolorSettings.indexBuffer);
    const indexBuffer = this.renderScale === 1
      ? rawIndexBuffer
      : downsampleBuffer(rawIndexBuffer, sourceWidth, sourceHeight, width, height);
    if (!indexBuffer || indexBuffer.length === 0) {
      throw new Error('Color cycle recolor settings missing index buffer');
    }

    this.indexBuffer = indexBuffer;
    this.zeroTransparent = false;
    this.subtractIndexOffset = false;

    const rawIndexPhaseMap = await resolveNumericBuffer(recolorSettings.indexPhaseMap);
    const indexPhaseMap = rawIndexPhaseMap && this.renderScale !== 1
      ? downsampleBuffer(rawIndexPhaseMap, sourceWidth, sourceHeight, width, height)
      : rawIndexPhaseMap;
    this.indexPhaseMap = indexPhaseMap && indexPhaseMap.length ? indexPhaseMap : null;

    const rawPhaseMap = await resolveNumericBuffer(recolorSettings.phaseMap);
    const phaseMap = rawPhaseMap && this.renderScale !== 1
      ? downsampleBuffer(rawPhaseMap, sourceWidth, sourceHeight, width, height)
      : rawPhaseMap;
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
    const shouldAnimate = (animation.isPlaying ?? colorCycle.isAnimating) !== false;
    this.speed = resolveAnimationSpeed(
      animation?.speed,
      colorCycle?.brushSpeed,
      shouldAnimate
    );
    this.currentTick = Number.isFinite(animation.currentTick) ? animation.currentTick : 0;
    this.flowDirection = normalizeFlowDirection(animation.flowDirection, 'forward');
    this.isAnimating = shouldAnimate;
    this._basePalette32BySlot.clear();
    this._basePaletteSize = this.cycleColors | 0;
    this._basePalette32BySlot.set(
      0,
      buildDiscretePalette32FromGradient(this.gradient, this._basePaletteSize)
    );
  }

  resetShiftKeyTracking() {
    if (this._lastShiftKeyBySpeedByte) {
      this._lastShiftKeyBySpeedByte.fill(-1);
    } else {
      this._lastShiftKeyBySpeedByte = new Int32Array(SB_COUNT).fill(-1);
    }
    this._lastSlotShiftKeyBySlot = null;
    this._lastSlotShiftBase = -1;
    this._lastShiftKeyBase = -1;
    this._lastShiftKeyKeyed = null;
    this._lastShiftKeyMode = null;
  }

  hasAnimation() {
    if (!this.isAnimating || this.cycleColors <= 0) {
      return false;
    }
    if (!this._hasVisibleAlpha) {
      return false;
    }
    if (this.usePerPixelSpeed) {
      return this.hasNonZeroSpeedBuffer;
    }
    return this.speed > 0;
  }

  advance(deltaSeconds) {
    if (!this.hasAnimation()) {
      return false;
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this._lastFps = 1 / deltaSeconds;
    }
    this._lastDeltaSeconds = deltaSeconds;
    this.baseTimeSeconds += deltaSeconds;
    this.renderFrame();
    return true;
  }

  renderFrame() {
    if (!this.indexBuffer) {
      return;
    }
    const profileEnabled = typeof window !== 'undefined'
      && window.localStorage
      && window.localStorage.getItem('vesselGobletProfile') === 'true';
    const profileNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now());
    const nowMs = profileNow();
    let fillMs = 0;
    const getBaseLut = (speedByte, shiftKey, modeKey, buildFn) => {
      let bySpeed = this._lutCacheBase.get(speedByte);
      if (!bySpeed) {
        bySpeed = new Map();
        this._lutCacheBase.set(speedByte, bySpeed);
      }
      let byShift = bySpeed.get(shiftKey);
      if (!byShift) {
        byShift = new Map();
        bySpeed.set(shiftKey, byShift);
      }
      let cached = byShift.get(modeKey);
      if (!cached) {
        cached = buildFn();
        byShift.set(modeKey, cached);
      }
      return cached;
    };
    const getSlotLut = (speedByte, shiftKey, modeKey, slot, buildFn) => {
      let bySpeed = this._lutCacheSlots.get(speedByte);
      if (!bySpeed) {
        bySpeed = new Map();
        this._lutCacheSlots.set(speedByte, bySpeed);
      }
      let byShift = bySpeed.get(shiftKey);
      if (!byShift) {
        byShift = new Map();
        bySpeed.set(shiftKey, byShift);
      }
      let byMode = byShift.get(modeKey);
      if (!byMode) {
        byMode = new Map();
        byShift.set(modeKey, byMode);
      }
      let cached = byMode.get(slot);
      if (!cached) {
        cached = buildFn();
        byMode.set(slot, cached);
      }
      return cached;
    };
    let usePerPixelPath = this.usePerPixelSpeed && this.speedBuffer && (this.flowMapping === 'palette' || !this.phaseMap);
    if (usePerPixelPath) {
      const n = this._basePaletteSize || (this.cycleColors | 0) || 1;
      const distinct = this._distinctSpeedBytes ?? collectDistinctSpeedBytes(this.speedBuffer);
      if (!this.maybeAdvanceShiftKeysPerPixel(distinct, n)) {
        this.maybeAdjustRenderScale(nowMs, 0);
        return;
      }
      const lutStart = profileEnabled ? profileNow() : 0;
      if (this._lutCacheBands !== n) {
        this._lutCacheBase.clear();
        this._lutCacheSlots.clear();
        this._lutCacheBands = n;
      }
      const lutsBySpeedAndMode = new Map();
      const forward = FLOW_MODE_FORWARD;
      const reverse = FLOW_MODE_REVERSE;
      const pingpong = FLOW_MODE_PINGPONG;

      for (const sb of distinct) {
        const defaultSpeed = Number.isFinite(this.speed) ? this.speed : 0;
        const speed = sb > 0
          ? decodeColorCycleSpeedByte(sb, this.speedMin, this.speedMax)
          : defaultSpeed;
        const offsetBase = (((this.baseTimeSeconds * speed) % 1) + 1) % 1;
        const shiftKey = (offsetBase * n) | 0;
        const modeMap = new Map();
        modeMap.set(forward, getBaseLut(sb, shiftKey, forward, () => {
          const basePal = this._basePalette32BySlot.get(0);
          return buildPaletteShiftLUT256({
            basePalette32: basePal,
            cycleColors: this.cycleColors,
            offset01: offsetBase
          });
        }));
        modeMap.set(reverse, getBaseLut(sb, shiftKey, reverse, () => {
          const basePal = this._basePalette32BySlot.get(0);
          return buildPaletteShiftLUT256({
            basePalette32: basePal,
            cycleColors: this.cycleColors,
            offset01: offsetBase
          });
        }));
        modeMap.set(pingpong, getBaseLut(sb, shiftKey, pingpong, () => {
          const basePal = this._basePalette32BySlot.get(0);
          return buildPaletteShiftLUT256({
            basePalette32: basePal,
            cycleColors: this.cycleColors,
            offset01: offsetBase
          });
        }));
        lutsBySpeedAndMode.set(sb, modeMap);
      }

      const canUseSlots = this.gradientIdBuffer && this.slotGradients && this.slotGradients.size > 0;
      if (canUseSlots) {
        const lutsBySpeedModeSlot = new Map();
        const fallbackLutsBySpeedMode = new Map();
        const usedSlots = this._usedSlots ?? collectDistinctSlots(this.gradientIdBuffer);

        for (const sb of distinct) {
          const defaultSpeed = Number.isFinite(this.speed) ? this.speed : 0;
          const speed = sb > 0
            ? decodeColorCycleSpeedByte(sb, this.speedMin, this.speedMax)
            : defaultSpeed;
          const offsetBase = (((this.baseTimeSeconds * speed) % 1) + 1) % 1;
          const shiftKey = (offsetBase * n) | 0;
          const modeMap = new Map();
          const forwardMap = new Map();
          const reverseMap = new Map();
          const pingpongMap = new Map();

          for (const slot of usedSlots) {
            const basePal = this._basePalette32BySlot.get(slot) ?? this._basePalette32BySlot.get(0);
            forwardMap.set(slot, getSlotLut(sb, shiftKey, forward, slot, () => buildPaletteShiftLUT256({
              basePalette32: basePal,
              cycleColors: this.cycleColors,
              offset01: offsetBase
            })));
            reverseMap.set(slot, getSlotLut(sb, shiftKey, reverse, slot, () => buildPaletteShiftLUT256({
              basePalette32: basePal,
              cycleColors: this.cycleColors,
              offset01: offsetBase
            })));
            pingpongMap.set(slot, getSlotLut(sb, shiftKey, pingpong, slot, () => buildPaletteShiftLUT256({
              basePalette32: basePal,
              cycleColors: this.cycleColors,
              offset01: offsetBase
            })));
          }

          modeMap.set(forward, forwardMap);
          modeMap.set(reverse, reverseMap);
          modeMap.set(pingpong, pingpongMap);
          lutsBySpeedModeSlot.set(sb, modeMap);
          const baseModeMap = lutsBySpeedAndMode.get(sb) ?? lutsBySpeedAndMode.get(0);
          fallbackLutsBySpeedMode.set(sb, baseModeMap);
        }

        const lutEnd = profileEnabled ? profileNow() : 0;
        clearTouchedTables(this);
        populateTablesFromMaps(this, lutsBySpeedModeSlot, fallbackLutsBySpeedMode);
        const fillStart = profileEnabled ? profileNow() : 0;
        fillPixelsFromIndicesWithGradientIdsAndSpeedAndFlow(
          this.indexBuffer,
          this.gradientIdBuffer,
          this.speedBuffer,
          this._slotLuts,
          this._fallbackLuts,
          this.pixels32,
          this.alpha,
          {
            transparentZero: this.zeroTransparent,
            subtractOne: this.subtractIndexOffset
          }
        );
        const fillEnd = profileEnabled ? profileNow() : 0;
        fillMs = fillEnd - fillStart;
        if (profileEnabled) {
          console.log(
            '[goblet][profile] renderFrame(per-pixel/slots)',
            this.layer?.id ?? null,
            `layerSpeed=${Number.isFinite(this.speed) ? this.speed.toFixed(4) : 'n/a'}`,
            `lut=${(lutEnd - lutStart).toFixed(2)}ms`,
            `fill=${(fillEnd - fillStart).toFixed(2)}ms`
          );
        }
      } else {
        const lutEnd = profileEnabled ? profileNow() : 0;
        const fillStart = profileEnabled ? profileNow() : 0;
        fillPixelsFromIndicesWithSpeedAndFlow(
          this.indexBuffer,
          this.gradientIdBuffer,
          this.speedBuffer,
          lutsBySpeedAndMode,
          this.pixels32,
          this.alpha,
          {
            transparentZero: this.zeroTransparent,
            subtractOne: this.subtractIndexOffset
          }
        );
        const fillEnd = profileEnabled ? profileNow() : 0;
        fillMs = fillEnd - fillStart;
        if (profileEnabled) {
          console.log(
            '[goblet][profile] renderFrame(per-pixel)',
            this.layer?.id ?? null,
            `speed=${Number.isFinite(this.speed) ? this.speed.toFixed(4) : 'n/a'}`,
            `lut=${(lutEnd - lutStart).toFixed(2)}ms`,
            `fill=${(fillEnd - fillStart).toFixed(2)}ms`
          );
        }
      }
    const putStart = profileEnabled ? profileNow() : 0;
    this.ctx.putImageData(this.imageData, 0, 0);
    const putEnd = profileEnabled ? profileNow() : 0;
    if (profileEnabled) {
      console.log('[goblet][profile] blit', `put=${(putEnd - putStart).toFixed(2)}ms`);
    }
    if (this.renderScale !== 1 && this.outputCtx && this.renderCanvas) {
      this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.outputCtx.drawImage(this.renderCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.maybeAdjustRenderScale(nowMs, fillMs);
    return;
  }
    const lutStart = profileEnabled ? profileNow() : 0;
    const speed = Number.isFinite(this.speed) ? this.speed : 0;
    const slotSpeedMap = this.slotSpeeds;
    const baseSpeed = Number.isFinite(slotSpeedMap?.get(0)) ? slotSpeedMap.get(0) : speed;
    const offset01 = (((this.baseTimeSeconds * baseSpeed) % 1) + 1) % 1;
    const n = this._basePaletteSize || (this.cycleColors | 0) || 1;
    const shiftKey = (offset01 * n) | 0;
    const canUseSlots = this.gradientIdBuffer && this.slotGradients && this.slotGradients.size > 0;
    if (!this.maybeAdvanceShiftKeysSlotMode(shiftKey, slotSpeedMap, n, canUseSlots)) {
      this.maybeAdjustRenderScale(nowMs, 0);
      return;
    }
    const basePal = this._basePalette32BySlot.get(0);
    const baseLut = buildPaletteShiftLUT256({
      basePalette32: basePal,
      cycleColors: this.cycleColors,
      offset01
    });
    if (this.flowMapping === 'palette' || !this.phaseMap) {
      if (canUseSlots) {
        const lutsBySlot = new Map();
        this._basePalette32BySlot.forEach((pal, slot) => {
          const slotSpeed = Number.isFinite(slotSpeedMap?.get(slot)) ? slotSpeedMap.get(slot) : baseSpeed;
          const slotOffset = (((this.baseTimeSeconds * (slotSpeed ?? 0)) % 1) + 1) % 1;
          lutsBySlot.set(
            slot,
            buildPaletteShiftLUT256({
              basePalette32: pal,
              cycleColors: this.cycleColors,
              offset01: slotOffset
            })
          );
        });
        const fallbackLut = lutsBySlot.get(0) ?? baseLut;
        const lutEnd = profileEnabled ? profileNow() : 0;
        const fillStart = profileEnabled ? profileNow() : 0;
        fillPixelsFromIndicesWithGradientIds(
          this.indexBuffer,
          this.gradientIdBuffer,
          lutsBySlot,
          fallbackLut,
          this.pixels32,
          this.alpha,
          {
            transparentZero: this.zeroTransparent,
            subtractOne: this.subtractIndexOffset
          }
        );
        const fillEnd = profileEnabled ? profileNow() : 0;
        fillMs = fillEnd - fillStart;
        if (profileEnabled) {
          console.log(
            '[goblet][profile] renderFrame(slots)',
            this.layer?.id ?? null,
            `speed=${Number.isFinite(this.speed) ? this.speed.toFixed(4) : 'n/a'}`,
            `lut=${(lutEnd - lutStart).toFixed(2)}ms`,
            `fill=${(fillEnd - fillStart).toFixed(2)}ms`
          );
        }
      } else {
        const lutEnd = profileEnabled ? profileNow() : 0;
        const fillStart = profileEnabled ? profileNow() : 0;
        fillPixelsFromIndices(this.indexBuffer, baseLut, this.pixels32, this.alpha, {
          transparentZero: this.zeroTransparent,
          subtractOne: this.subtractIndexOffset
        });
        const fillEnd = profileEnabled ? profileNow() : 0;
        fillMs = fillEnd - fillStart;
        if (profileEnabled) {
          console.log(
            '[goblet][profile] renderFrame',
            this.layer?.id ?? null,
            `speed=${Number.isFinite(this.speed) ? this.speed.toFixed(4) : 'n/a'}`,
            `lut=${(lutEnd - lutStart).toFixed(2)}ms`,
            `fill=${(fillEnd - fillStart).toFixed(2)}ms`
          );
        }
      }
    } else {
      const lutEnd = profileEnabled ? profileNow() : 0;
      const fillStart = profileEnabled ? profileNow() : 0;
      fillPixelsFromPhaseMap(this.phaseMap, baseLut, this.pixels32, this.alpha);
      const fillEnd = profileEnabled ? profileNow() : 0;
      fillMs = fillEnd - fillStart;
      if (profileEnabled) {
        console.log(
          '[goblet][profile] renderFrame(phaseMap)',
          this.layer?.id ?? null,
          `speed=${Number.isFinite(this.speed) ? this.speed.toFixed(4) : 'n/a'}`,
          `lut=${(lutEnd - lutStart).toFixed(2)}ms`,
          `fill=${(fillEnd - fillStart).toFixed(2)}ms`
        );
      }
    }
    const putStart = profileEnabled ? profileNow() : 0;
    this.ctx.putImageData(this.imageData, 0, 0);
    const putEnd = profileEnabled ? profileNow() : 0;
    if (profileEnabled) {
      console.log('[goblet][profile] blit', `put=${(putEnd - putStart).toFixed(2)}ms`);
    }
    if (this.renderScale !== 1 && this.outputCtx && this.renderCanvas) {
      this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.outputCtx.drawImage(this.renderCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.maybeAdjustRenderScale(nowMs, fillMs);
  }

  maybeAdvanceShiftKeysPerPixel(distinct, cycleColors) {
    let changed = false;
    const speedDefault = Number.isFinite(this.speed) ? this.speed : 0;
    for (const sb of distinct) {
      const speed = sb > 0
        ? decodeColorCycleSpeedByte(sb, this.speedMin, this.speedMax)
        : speedDefault;
      const offsetBase = (((this.baseTimeSeconds * speed) % 1) + 1) % 1;
      const shiftKey = (offsetBase * cycleColors) | 0;
      if (this._lastShiftKeyBySpeedByte[sb] !== shiftKey) {
        this._lastShiftKeyBySpeedByte[sb] = shiftKey;
        changed = true;
      }
    }
    return changed;
  }

  maybeAdvanceShiftKeysSlotMode(baseShiftKey, slotSpeedMap, cycleColors, canUseSlots) {
    if (!canUseSlots) {
      if (this._lastShiftKeyBase === baseShiftKey && this._lastShiftKeyMode === this.flowMapping) {
        return false;
      }
      this._lastShiftKeyBase = baseShiftKey;
      this._lastShiftKeyMode = this.flowMapping;
      return true;
    }
    const slotEntries = this._basePalette32BySlot;
    if (!this._lastSlotShiftKeyBySlot || this._lastSlotShiftKeyBySlot.size !== slotEntries.size) {
      this._lastSlotShiftKeyBySlot = new Map();
    }
    let changed = false;
    const baseSpeed = Number.isFinite(slotSpeedMap?.get(0)) ? slotSpeedMap.get(0) : this.speed;
    slotEntries.forEach((_, slot) => {
      const slotSpeed = Number.isFinite(slotSpeedMap?.get(slot)) ? slotSpeedMap.get(slot) : baseSpeed;
      const slotOffset = (((this.baseTimeSeconds * (slotSpeed ?? 0)) % 1) + 1) % 1;
      const shiftKey = (slotOffset * cycleColors) | 0;
      if (this._lastSlotShiftKeyBySlot.get(slot) !== shiftKey) {
        this._lastSlotShiftKeyBySlot.set(slot, shiftKey);
        changed = true;
      }
    });
    if (this._lastSlotShiftBase !== baseShiftKey || this._lastShiftKeyMode !== this.flowMapping) {
      this._lastSlotShiftBase = baseShiftKey;
      this._lastShiftKeyMode = this.flowMapping;
      changed = true;
    }
    return changed;
  }

  maybeAdjustRenderScale(nowMs, fillMs) {
    if (!this._adaptiveScaleEnabled || this._isReinitializing) {
      return;
    }
    if (!Number.isFinite(nowMs)) {
      return;
    }
    if (!this._fillWindowStartMs) {
      this._fillWindowStartMs = nowMs;
      this._lastScaleCheckMs = nowMs;
    }
    if (Number.isFinite(fillMs) && fillMs > 0) {
      this._fillMsAccum += fillMs;
    }
    if (nowMs - this._lastScaleCheckMs < 1000) {
      return;
    }
    const slowFill = this._fillMsAccum > 20;
    const fastFill = this._fillMsAccum < 12;
    const fps = Number.isFinite(this._lastFps) ? this._lastFps : null;
    const slowFps = fps !== null && fps < 50;
    const fastFps = fps !== null && fps > 55;
    let nextScale = this.renderScale;
    if (this.renderScale === 1 && (slowFill || slowFps)) {
      nextScale = 0.5;
    } else if (this.renderScale !== 1 && fastFill && fastFps) {
      nextScale = 1;
    }
    this._lastScaleCheckMs = nowMs;
    this._fillMsAccum = 0;
    if (nextScale !== this.renderScale) {
      void this.applyRenderScale(nextScale);
    }
  }

  async applyRenderScale(nextScale) {
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return;
    }
    if (this.renderScale === nextScale || this._isReinitializing) {
      return;
    }
    const clamped = nextScale >= 1 ? 1 : 0.5;
    const prevBaseTime = this.baseTimeSeconds;
    const prevTick = this.currentTick;
    const prevAnimating = this.isAnimating;
    this.renderScale = clamped;
    this._isReinitializing = true;
    try {
      await this.initialize();
      this.baseTimeSeconds = prevBaseTime;
      this.currentTick = prevTick;
      this.isAnimating = prevAnimating;
      this.renderFrame();
    } finally {
      this._isReinitializing = false;
    }
  }

  getCanvas() {
    return this.canvas;
  }

  destroy() {
    this.isAnimating = false;
    this.indexBuffer = null;
    this.gradientIdBuffer = null;
    this.speedBuffer = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.alpha = null;
    this.baseImageData = null;
    this.slotGradients = null;
  }
}

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

const hasInlineConstraint = (element, axis) => {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }
  if (axis === 'width') {
    return Boolean(element.style.width || element.style.minWidth || element.style.maxWidth);
  }
  return Boolean(element.style.height || element.style.minHeight || element.style.maxHeight);
};

const axisUsesClipping = (computedStyle, axis) => {
  const overflowValue = axis === 'width' ? computedStyle.overflowX : computedStyle.overflowY;
  return overflowValue === 'hidden' || overflowValue === 'clip' || overflowValue === 'scroll' || overflowValue === 'auto';
};

const resolveConstrainedAxisSize = (canvas, axis, fallbackSize) => {
  if (!(canvas instanceof HTMLElement)) {
    return sanitizeCanvasDimension(fallbackSize, 1);
  }

  const canvasRect = canvas.getBoundingClientRect?.();
  const canvasSize = axis === 'width'
    ? sanitizeCanvasDimension(canvasRect?.width || fallbackSize, fallbackSize)
    : sanitizeCanvasDimension(canvasRect?.height || fallbackSize, fallbackSize);

  let current = canvas.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const rect = current.getBoundingClientRect?.();
    const rawSize = axis === 'width' ? rect?.width : rect?.height;
    if (rawSize && rawSize > 0) {
      const size = sanitizeCanvasDimension(rawSize, fallbackSize);
      const computedStyle = window.getComputedStyle(current);
      const differsFromCanvas = Math.abs(size - canvasSize) > 1;
      const hasConstraint = hasInlineConstraint(current, axis) || axisUsesClipping(computedStyle, axis);
      if (differsFromCanvas || hasConstraint) {
        return size;
      }
    }
    current = current.parentElement;
  }

  return sanitizeCanvasDimension(axis === 'width' ? (window.innerWidth || fallbackSize) : (window.innerHeight || fallbackSize), fallbackSize);
};

const computeViewportSize = (canvas, fallbackWidth, fallbackHeight) => {
  if (typeof window === 'undefined') {
    return {
      width: sanitizeCanvasDimension(fallbackWidth, 1),
      height: sanitizeCanvasDimension(fallbackHeight, 1)
    };
  }
  return {
    width: resolveConstrainedAxisSize(canvas, 'width', fallbackWidth),
    height: resolveConstrainedAxisSize(canvas, 'height', fallbackHeight)
  };
};

const createCanvasStrategy = (metadata, canvas, initialOverride) => {
  const viewport = metadata?.viewport ?? {};
  const viewportMode = viewport.mode === 'fill' || viewport.mode === 'fit' || viewport.mode === 'cover' ? viewport.mode : 'fixed';
  const viewportPreset = metadata?.settings?.viewportPreset;
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
    const windowSize = computeViewportSize(canvas, baseWidth, baseHeight);
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
    const windowSize = computeViewportSize(canvas, baseWidth, baseHeight);
    const uniform = clampScaleValue(Math.min(windowSize.width / baseWidth, windowSize.height / baseHeight));
    const baseScale = { x: uniform, y: uniform };
    const scale = applyOverride(baseScale, override);
    return {
      scale,
      canvasSize: computeCanvasSizeForScale(scale)
    };
  };

  const resolveCoverState = (nextOverride) => {
    if (nextOverride) {
      scaleOverride = normalizeScaleOption(nextOverride);
    }
    const override = getOverride();
    const windowSize = computeViewportSize(canvas, baseWidth, baseHeight);
    const uniform = clampScaleValue(Math.max(windowSize.width / baseWidth, windowSize.height / baseHeight));
    const baseScale = { x: uniform, y: uniform };
    const scale = applyOverride(baseScale, override);
    return {
      scale,
      canvasSize: windowSize
    };
  };

  const resolveFixedState = (nextOverride) => {
    if (nextOverride) {
      scaleOverride = normalizeScaleOption(nextOverride);
    }
    const override = getOverride();
    if (viewportPreset === 'embed-fill' || viewportPreset === 'embed-fit') {
      const windowSize = computeViewportSize(canvas, baseWidth, baseHeight);
      const uniform = viewportPreset === 'embed-fill'
        ? clampScaleValue(Math.max(windowSize.width / baseWidth, windowSize.height / baseHeight))
        : clampScaleValue(Math.min(windowSize.width / baseWidth, windowSize.height / baseHeight));
      const baseScale = { x: uniform, y: uniform };
      const scale = applyOverride(baseScale, override);
      return {
        scale,
        canvasSize: windowSize
      };
    }
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
      case 'cover':
        return resolveCoverState(scaleOption ?? null);
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
      if (viewportMode === 'fill' || viewportMode === 'cover') {
        return computeViewportSize(canvas, baseWidth, baseHeight);
      }
      const effectiveScale = scale ? normalizeScaleOption(scale) : getOverride();
      return computeCanvasSizeForScale(effectiveScale);
    }
  };
};

const getGobletDisplayFilters = (metadata) => (
  Array.isArray(metadata?.settings?.displayFilters) ? metadata.settings.displayFilters : []
);

class VesselGoblet {
  constructor(metadata, canvas, options, sourceMetadata) {
    this.metadata = metadata;
    this.sourceMetadata = sourceMetadata ?? metadata;
    this.canvas = canvas;
    this.options = options ?? {};
    this.canvasStrategy = createCanvasStrategy(metadata, canvas, this.options.scale ?? null);
    const initialState = this.canvasStrategy.getInitialState();
    this.scale = { ...initialState.scale };

    this.ctx = null;
    this.layerEntries = [];
    this.dynamicPlayers = [];
    this.displayFilterState = createDisplayFilterPipelineState();
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
      let sequentialPlayer = null;

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

      if (Array.isArray(layerClone.assets?.textureFrames) && layerClone.assets.textureFrames.length > 0) {
        try {
          const frameSources = await Promise.all(
            layerClone.assets.textureFrames.map((textureSrc) => loadImage(textureSrc))
          );
          sequentialPlayer = new SequentialLayerPlayer(
            layerClone,
            frameSources,
            Math.max(1, toNum(this.metadata?.animation?.fps, 12))
          );
          source = sequentialPlayer.getSource() || source;
        } catch (error) {
          diagnostics.warn(`[goblet] Failed to load sequential frame textures for layer ${layerClone.id}`, error);
          sequentialPlayer = null;
        }
      }

      if (!source && !player && !sequentialPlayer) {
        diagnostics.warn('[goblet] Layer has no drawable source', {
          id: layerClone.id,
          hasTextureProp: Boolean(layerClone.assets?.texture),
          hasSequentialFrames: Array.isArray(layerClone.assets?.textureFrames) && layerClone.assets.textureFrames.length > 0,
          hasColorCycle: Boolean(layerClone.colorCycle),
          contentBounds: layerClone.contentBounds,
          documentBoundsPx: layerClone.documentBoundsPx
        });
      }

      return { layer: layerClone, source, player, sequentialPlayer };
    }));

    entries.forEach((entry) => {
      entry.layer.blendMode = entry.layer.blendMode && entry.layer.blendMode !== 'normal'
        ? entry.layer.blendMode
        : 'source-over';
    });

    this.layerEntries = entries;
    this.dynamicPlayers = entries
      .flatMap((entry) => [entry.player, entry.sequentialPlayer])
      .filter((entryPlayer) => entryPlayer && typeof entryPlayer.hasAnimation === 'function' && entryPlayer.hasAnimation());

    const textureless = entries
      .filter((entry) => entry.layer.visible !== false)
      .filter((entry) => !entry.source && !entry.player && !entry.sequentialPlayer);
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
    const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const isFixed = this.metadata?.viewport?.mode === 'fixed';
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const fallbackCssWidth = Math.max(1, Math.round(width / Math.max(dpr, 1)));
    const fallbackCssHeight = Math.max(1, Math.round(height / Math.max(dpr, 1)));
    const cssW = isFixed
      ? fallbackCssWidth
      : width;
    const cssH = isFixed
      ? fallbackCssHeight
      : height;

    ctx.save();
    logViewerState(ctx, this.canvas, this.metadata, cssW, cssH);
    const clearWidth = isFixed ? Math.max(1, Math.round(cssW * dpr)) : width;
    const clearHeight = isFixed ? Math.max(1, Math.round(cssH * dpr)) : height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, clearWidth, clearHeight);

    if (this.metadata.project?.backgroundColor) {
      ctx.fillStyle = rgbaToCss(parseColor(this.metadata.project.backgroundColor));
      ctx.fillRect(0, 0, clearWidth, clearHeight);
    }

    const documentSize = {
      width: Math.max(1, toNum(this.metadata.project?.width, cssW)),
      height: Math.max(1, toNum(this.metadata.project?.height, cssH))
    };
    const displayFilters = getGobletDisplayFilters(this.metadata);
    const shouldFilterArtwork = hasEnabledDisplayFiltersInList(displayFilters);
    const filterSurfaceCanvas = shouldFilterArtwork
      ? ensureDisplayFilterCanvas(
          this.displayFilterState.filterSurfaceCanvas,
          documentSize.width,
          documentSize.height,
        )
      : null;
    const filterCtx = shouldFilterArtwork ? clearDisplayFilterCanvas(filterSurfaceCanvas) : null;
    this.displayFilterState.filterSurfaceCanvas = filterSurfaceCanvas;
    const renderCtx = filterCtx ?? ctx;

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
      hasSource: Boolean(entry.source || entry.player || entry.sequentialPlayer),
      visible: entry.layer.visible
    })));

    const viewportSize = shouldFilterArtwork
      ? { width: documentSize.width, height: documentSize.height }
      : { width: cssW, height: cssH };
    const designSize = {
      width: shouldFilterArtwork
        ? documentSize.width
        : Math.max(1, toNum(this.metadata.viewport?.designWidth, cssW)),
      height: shouldFilterArtwork
        ? documentSize.height
        : Math.max(1, toNum(this.metadata.viewport?.designHeight, cssH))
    };
    let painted = 0;
    sorted.forEach((entry, index) => {
      diagnostics.log(`[goblet] Processing layer ${index}:`, entry.layer.id);
      if (entry.layer.visible === false) {
        diagnostics.log(`[goblet] Skipping invisible layer ${entry.layer.id}`);
        return;
      }
      const source = entry.player
        ? entry.player.getCanvas()
        : (entry.sequentialPlayer ? entry.sequentialPlayer.getSource() : entry.source);
      if (!source) {
        diagnostics.log(`[goblet] No source for layer ${entry.layer.id}`);
        return;
      }
      diagnostics.log(`[goblet] Have source for ${entry.layer.id}, computing placement`);
      const pixelBounds = entry.layer.pixelBoundsPx ?? null;
      const contentBounds = entry.layer.contentBounds ?? null;

      const sourceWidth = source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : source.width;
      const sourceHeight = source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : source.height;

      const normalizedContentBounds = contentBounds
        ? clampRectToSource(contentBounds, sourceWidth, sourceHeight)
        : null;

      const normalizedPixelBounds = pixelBounds
        ? clampRectToSource(pixelBounds, sourceWidth, sourceHeight)
        : null;

      const isColorCycleLayer = Boolean(entry.layer.colorCycle)
        || entry.layer.type === 'color-cycle'
        || entry.layer.layerType === 'color-cycle';

      const paintedRectFromDocument = documentBoundsToSourceRect(
        entry.layer.documentBoundsPx,
        documentSize,
        { width: sourceWidth, height: sourceHeight }
      );

      const isFullSurfaceRect = (rect) => {
        if (!rect) {
          return false;
        }
        const tolerance = 0.5;
        return rect.x <= tolerance
          && rect.y <= tolerance
          && rect.width >= sourceWidth - tolerance
          && rect.height >= sourceHeight - tolerance;
      };

      const tinyContentBounds = Boolean(
        normalizedContentBounds
        && normalizedContentBounds.width <= 1.5
        && normalizedContentBounds.height <= 1.5
        && (sourceWidth > 2 || sourceHeight > 2)
      );
      const shouldPreferDocumentRect = Boolean(
        paintedRectFromDocument
        && (
          isFixed
          || (isColorCycleLayer && (!normalizedContentBounds || isFullSurfaceRect(normalizedContentBounds)))
          || (entry.layer.type === 'sequential' && tinyContentBounds)
        )
      );

      const paintedRect = shouldPreferDocumentRect
        ? paintedRectFromDocument
        : normalizedContentBounds
          ?? normalizedPixelBounds
          ?? {
            x: 0,
            y: 0,
            width: sourceWidth,
            height: sourceHeight
          };

      if (paintedRect.x >= sourceWidth) {
        paintedRect.x = Math.max(0, sourceWidth - 1);
      }
      if (paintedRect.y >= sourceHeight) {
        paintedRect.y = Math.max(0, sourceHeight - 1);
      }
      if (paintedRect.x + paintedRect.width > sourceWidth) {
        paintedRect.width = Math.max(1, sourceWidth - paintedRect.x);
      }
      if (paintedRect.y + paintedRect.height > sourceHeight) {
        paintedRect.height = Math.max(1, sourceHeight - paintedRect.y);
      }

      // log removed

      const viewportFrame = {
        x: 0,
        y: 0,
        width: viewportSize.width,
        height: viewportSize.height
      };

      const autoOffsetPercent = entry.layer.alignment?.positioning === 'auto'
        ? entry.layer.alignment?.offsetPercent
        : undefined;

      const align = normalizeAlign(entry.layer.alignment, autoOffsetPercent);

      const basis = {
        surface: { width: sourceWidth, height: sourceHeight },
        painted: {
          width: paintedRect.width,
          height: paintedRect.height
        },
        frame: viewportFrame,
        design: isFixed ? undefined : designSize,
        doc: documentSize,
        align
      };

      // log removed

      const directFixedPlacement = isFixed && !shouldFilterArtwork && entry.layer.documentBoundsPx
        ? (() => {
            const docRect = entry.layer.documentBoundsPx;
            const scaleX = viewportSize.width / Math.max(1, documentSize.width);
            const scaleY = viewportSize.height / Math.max(1, documentSize.height);
            return {
              dest: {
                x: Math.round(toNum(docRect.x, 0) * scaleX),
                y: Math.round(toNum(docRect.y, 0) * scaleY),
                width: Math.max(1, Math.round(fitPositive(docRect.width, 1) * scaleX)),
                height: Math.max(1, Math.round(fitPositive(docRect.height, 1) * scaleY))
              }
            };
          })()
        : null;

      const placement = directFixedPlacement ?? computePlacement(basis);

      const units = isFixed ? 'backing' : 'css';
      const destForLog = (() => {
        const cssRect = placement.dest;
        if (units === 'css') {
          return cssRect;
        }
        return {
          x: Math.round(cssRect.x * dpr),
          y: Math.round(cssRect.y * dpr),
          width: Math.max(1, Math.round(cssRect.width * dpr)),
          height: Math.max(1, Math.round(cssRect.height * dpr))
        };
      })();

      diagnostics.log(`[goblet] Placement resolved for ${entry.layer.id}`, {
        placement,
        units,
        destForLog
      });

      const blendMode = entry.layer.blendMode ?? 'source-over';
      const opacity = Number.isFinite(entry.layer.opacity) ? clamp(entry.layer.opacity, 0, 1) : 1;

      renderCtx.save();
      renderCtx.globalCompositeOperation = blendMode;
      renderCtx.globalAlpha = opacity;

      if (__DEV__) {
        if (!(placement.dest.width > 0 && placement.dest.height > 0)) {
          console.warn('[align] non-positive dest size', { placement, layer: entry.layer.id });
        }
      }

      const drawResult = drawLayerWithPlacement(
        renderCtx,
        source,
        placement,
        {
          isFixed: isFixed && !shouldFilterArtwork,
          dpr,
          paintedRect,
          fit: directFixedPlacement ? 'none' : align.fit
        }
      );

      if (!drawResult.ok) {
        renderCtx.restore();
        diagnostics.log(`[goblet] Failed to paint layer ${entry.layer.id}`);
        return;
      }

      const transformBeforeDraw = snapshotTransform(renderCtx);
      if (!isIdentityTransform(transformBeforeDraw)) {
        warnNonIdentityTransform(entry.layer?.id, transformBeforeDraw);
      }

      const sampleForLog = drawResult.tileCanvas
        ? { x: 0, y: 0, width: drawResult.tileCanvas.width, height: drawResult.tileCanvas.height }
        : null;
      const sourceForLog = drawResult.tileCanvas ?? source;

      logLayerDraw(entry.layer, sourceForLog, sampleForLog, destForLog, units);

      diagnostics.log('Drew layer successfully', {
        layerId: entry.layer.id,
        mode: placement.tile ? 'tile' : 'draw-image',
        destination: destForLog
      });

      renderCtx.restore();
      painted += 1;
    });

    diagnostics.log(`[goblet] Painted ${painted} of ${sorted.length} layers`);

    if (painted === 0 && sorted.length > 0) {
      diagnostics.warn('Render completed but no layers produced pixels');
    }

    if (filterCtx && filterSurfaceCanvas) {
      const documentViewportMapping = computeDocumentViewportMapping(
        this.metadata,
        clearWidth,
        clearHeight,
      );
      const finalFilteredCanvas = applyDisplayFilterStack({
        sourceCanvas: filterSurfaceCanvas,
        displayFilters,
        filterState: this.displayFilterState,
      });
      ctx.drawImage(
        finalFilteredCanvas,
        0,
        0,
        documentSize.width,
        documentSize.height,
        documentViewportMapping.offsetX,
        documentViewportMapping.offsetY,
        documentSize.width * documentViewportMapping.scaleX,
        documentSize.height * documentViewportMapping.scaleY,
      );
    }

    logSummary(painted, sorted.length, startTime);

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
    const isFixed = this.metadata?.viewport?.mode === 'fixed';
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const fallbackCssWidth = Math.max(1, Math.round(width / Math.max(dpr, 1)));
    const fallbackCssHeight = Math.max(1, Math.round(height / Math.max(dpr, 1)));
    diagnostics.log('[VIEWER] updateScale called:', {
      oldScale,
      newScale,
      oldCanvasSize: { width: this.canvas.width, height: this.canvas.height },
      newCanvasSize: { width, height },
      viewportMode: this.metadata.viewport.mode
    });

    this.scale = newScale;
    this.summary.scale = { ...this.scale };

    const cssWidth = width;
    const cssHeight = height;

    let canvasSizeChanged = false;
    const scaleChanged = oldScale.x !== newScale.x || oldScale.y !== newScale.y;

    if (isFixed) {
      const backWidth = Math.max(1, Math.round(cssWidth * dpr));
      const backHeight = Math.max(1, Math.round(cssHeight * dpr));
      canvasSizeChanged = this.canvas.width !== backWidth || this.canvas.height !== backHeight;
      if (this.canvas.style.width !== `${cssWidth}px`) {
        this.canvas.style.width = `${cssWidth}px`;
      }
      if (this.canvas.style.height !== `${cssHeight}px`) {
        this.canvas.style.height = `${cssHeight}px`;
      }
      if (canvasSizeChanged) {
        this.canvas.width = backWidth;
        this.canvas.height = backHeight;
      }
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      canvasSizeChanged = this.canvas.width !== width || this.canvas.height !== height;
      if (canvasSizeChanged) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.canvas.style.width = '';
      this.canvas.style.height = '';
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    if (this.canvas && this.canvas.style) {
      this.canvas.style.imageRendering = 'pixelated';
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
    if (typeof window !== 'undefined' && this.canvas) {
      logResize(this.canvas, this.metadata?.viewport?.mode);
    }
    this.updateScale();
  }

  handleAnimationFrame(timestamp) {
    if (this.destroyed) {
      return;
    }
    const profileEnabled = typeof window !== 'undefined'
      && window.localStorage
      && window.localStorage.getItem('vesselGobletProfile') === 'true';
    const profileNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now());
    const advanceStart = profileEnabled ? profileNow() : 0;
    const delta = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    let needsRender = false;
    for (const player of this.dynamicPlayers) {
      if (player && player.advance(delta)) {
        needsRender = true;
      }
    }
    const advanceEnd = profileEnabled ? profileNow() : 0;
    let renderEnd = 0;
    let renderStart = 0;
    if (needsRender) {
      renderStart = profileEnabled ? profileNow() : 0;
      this.renderOnce();
      renderEnd = profileEnabled ? profileNow() : 0;
    }
    if (profileEnabled) {
      const fps = delta > 0 ? (1 / delta) : 0;
      console.log(
        '[goblet][profile] frame',
        `advance=${(advanceEnd - advanceStart).toFixed(2)}ms`,
        `render=${renderStart ? (renderEnd - renderStart).toFixed(2) : '0.00'}ms`,
        `layers=${this.dynamicPlayers.length}`,
        `fps=${fps.toFixed(1)}`
      );
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
