import { clamp, posInt, round3, toNum } from './num.js';
import {
  applyDisplayFilterStack,
  clearDisplayFilterCanvas,
  createDisplayFilterPipelineState,
  ensureDisplayFilterCanvas,
  hasEnabledDisplayFiltersInList,
} from './displayFilterPipeline.js';
import {
  decodeColorCycleSpeedByte,
  getGobletFlowModeIndex,
  GOBLET_FLOW_MODE_FORWARD,
  GOBLET_FLOW_MODE_PINGPONG,
  GOBLET_FLOW_MODE_REVERSE,
  hasGobletNonForwardFlow,
  normalizeGobletFlowBuffer,
  normalizeGobletGradientStops,
  normalizeGobletSlotPalettes,
  parseGobletColor,
  GOBLET_MAX_SLOT_ID,
  clampGobletSlotId,
  resizeGobletAlphaMaskBuffer,
  applyGobletEraseMaskToAlphaChannel,
  applyGobletSoftEdgeMaskToAlphaChannel,
  hasAnyGobletMaskValue,
  resolveGobletGradientSlot,
  resolveGobletFlowMode,
  resolveGobletPaletteIndex,
  resolveGobletPalettePosition,
  resolveGobletPhase01,
  resolveGobletAlphaByte,
  resolveGobletIndexedAlphaByte,
  sampleGobletGradient,
  hasVisibleGobletAlpha,
  resolveInterlaceFrame,
  rollSierraLiteBinaryField,
  resolveSierraLiteBinaryField,
  wrapGobletPhase01,
} from './gobletPlaybackMath.js';
import {
  GOBLET_BRUSH_MASK_FIELDS,
  GOBLET_BRUSH_REQUIRED_BUFFERS,
  GOBLET_BRUSH_REQUIRED_SCALARS,
  GOBLET_COLOR_CYCLE_BRUSH_MODE,
  GOBLET2_FORMAT,
  GOBLET2_LEGACY_SCHEMA_VERSION,
  GOBLET2_SCHEMA_VERSION,
} from './gobletPayloadContract.js';

const resizeAlphaMaskBuffer = resizeGobletAlphaMaskBuffer;
const applyMaskToAlphaChannel = applyGobletEraseMaskToAlphaChannel;
const applySoftEdgeMaskToAlphaChannel = applyGobletSoftEdgeMaskToAlphaChannel;
const hasAnyMaskValue = hasAnyGobletMaskValue;
const hasVisibleAlpha = hasVisibleGobletAlpha;

const __DEV__ = typeof process !== 'undefined' && process.env && process.env.NODE_ENV
  ? process.env.NODE_ENV !== 'production'
  : true;

let ccDebugOn = () => false;
let ccLayerDebugOn = () => false;
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

  ccLayerDebugOn = () => {
    if (!ccDebugOn()) {
      return false;
    }
    if (typeof window === 'undefined') {
      return false;
    }
    if (window.__CC_LAYER_DEBUG__ === true) {
      return true;
    }
    try {
      return window.localStorage.getItem('ccLayerDebug') === '1';
    } catch {
      return false;
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
  // layers:   localStorage.setItem('ccLayerDebug','1'); window.__CC_LAYER_DEBUG__ = true;
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

const resolveProfileDefault = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const queryEnabled = typeof window.location?.search === 'string'
      && new URLSearchParams(window.location.search).get('gobletProfile') === '1';
    const storageEnabled = window.localStorage?.getItem('vesselGobletProfile') === 'true';
    return queryEnabled || storageEnabled;
  } catch {
    return false;
  }
};

const profileExplicitlyEnabled = resolveProfileDefault();
const isGobletProfileEnabled = () => diagnosticsEnabled || profileExplicitlyEnabled;
const profileNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const matchesCoarsePointer = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};

const resolveHalfResPreference = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const value = window.localStorage?.getItem('vesselGobletHalfRes');
    return value === 'true' || value === 'false' ? value : null;
  } catch {
    return null;
  }
};


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
  csv: 'schemaVersion',
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
  sem: 'softEdgeMask',
  gs: 'gradientStops',
  gib: 'gradientIdBuffer',
  gdib: 'gradientDefIdBuffer',
  ib: 'indexBuffer',
  sbf: 'speedBuffer',
  flb: 'flowBuffer',
  phb: 'phaseBuffer',
  sp: 'slotPalettes',
  gds: 'gradientDefStore',
  pl: 'palette',
  ao: 'animationOffset',
  tf: 'targetFPS',
  fd: 'flowDirection',
  am: 'alphaMode',
  rs: 'recolorSettings',
  gr: 'gradient',
  grf: 'gradientRef',
  spd: 'brushSpeed',
  lbsc: 'layerBaseSpeedCps',
  csc: 'controllerSpeedCps',
  lsc: 'legacySpeedCps',
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
  tbm: 'transparencyBackgroundMode',
  plp: 'perfectLoop',
  fps: 'fps',
  tfm: 'totalFrames',
  ds: 'durationSeconds',
  cbp: 'coverageBoundsPx',
  cbsp: 'coverageBoundsSourcePx',
  pm: 'phaseMap',
  sq: 'sequential'
};

const GOBLET_TRANSPARENCY_GRAY = '#5a5a5f';
const GOBLET_CHECKER_LIGHT = '#2a2a2e';
const GOBLET_CHECKER_DARK = '#1c1c1f';

const hasRenderableBackgroundColor = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'transparent' && normalized !== '#00000000';
};

const paintGobletBackground = (ctx, width, height, metadata) => {
  if (!ctx || width <= 0 || height <= 0) {
    return;
  }

  const backgroundColor = metadata?.project?.backgroundColor;
  if (hasRenderableBackgroundColor(backgroundColor)) {
    ctx.fillStyle = rgbaToCss(parseColor(backgroundColor));
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const transparencyMode = metadata?.settings?.transparencyBackgroundMode === 'gray' ? 'gray' : 'checker';
  if (transparencyMode === 'gray') {
    ctx.fillStyle = GOBLET_TRANSPARENCY_GRAY;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const checkerSize = 10;
  ctx.fillStyle = GOBLET_CHECKER_LIGHT;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = GOBLET_CHECKER_DARK;
  for (let x = 0; x < width; x += checkerSize * 2) {
    for (let y = 0; y < height; y += checkerSize * 2) {
      ctx.fillRect(x, y, Math.min(checkerSize, width - x), Math.min(checkerSize, height - y));
      const shiftedX = x + checkerSize;
      const shiftedY = y + checkerSize;
      if (shiftedX < width && shiftedY < height) {
        ctx.fillRect(
          shiftedX,
          shiftedY,
          Math.min(checkerSize, width - shiftedX),
          Math.min(checkerSize, height - shiftedY),
        );
      }
    }
  }
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
  if (!metadata || (metadata.format !== 'vessel-goblet' && metadata.format !== 'vessel-goblet2')) {
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
  assertGobletMetadataContract(expanded);
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

const hasVisibleImageAlpha = (image, width, height) => {
  if (!image || typeof document === 'undefined') {
    return false;
  }
  try {
    const w = Math.max(1, Math.round(width || image.naturalWidth || image.width || 1));
    const h = Math.max(1, Math.round(height || image.naturalHeight || image.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) {
      return false;
    }
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
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

const toUint16Buffer = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof Uint16Array) {
    return value.slice();
  }
  if (Array.isArray(value)) {
    return Uint16Array.from(value, (entry) => (
      Number.isFinite(entry) && entry >= 0 ? Math.min(0xffff, Math.round(entry)) : 0
    ));
  }
  const bytes = value instanceof Uint8Array
    ? value
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes) {
    return null;
  }
  if (bytes.byteLength % 2 !== 0) {
    throw new Error('Goblet Uint16 payload has an odd byte length');
  }
  const copy = bytes.slice();
  return new Uint16Array(copy.buffer);
};

const resolveNumericBuffer = async (value, bytesPerElement = 1) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'object' && typeof value.ref === 'string') {
    const response = await fetch(value.ref, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load Goblet binary payload ${value.ref}: HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const expectedLength = Number(value.byteLength);
    if (Number.isFinite(expectedLength) && expectedLength >= 0 && bytes.byteLength !== expectedLength) {
      throw new Error(`Goblet binary payload length mismatch for ${value.ref}`);
    }
    return bytes;
  }
  if (typeof value === 'string') {
    if (value.startsWith(B64Z_PREFIX)) {
      const bytes = await decompressB64ZPayload(value);
      return bytes;
    }
    return null;
  }
  if (bytesPerElement === 2 && (Array.isArray(value) || value instanceof Uint16Array)) {
    return toUint16Buffer(value);
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
  if (typeof value === 'object' && typeof value.ref === 'string') {
    return true;
  }
  if (Array.isArray(value) || value instanceof Uint8Array) {
    return value.length > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.length > 0;
  }
  return false;
};

const getGobletBrushBufferPayload = (brushState, name) => {
  switch (name) {
    case 'indexBuffer':
      return brushState?.indexBuffer;
    case 'gradientIdBuffer':
      return brushState?.gradientIdBuffer;
    case 'gradientDefIdBuffer':
      return brushState?.gradientDefIdBuffer;
    case 'speedBuffer':
      return brushState?.speedBuffer;
    case 'flowBuffer':
      return brushState?.flowBuffer;
    case 'phaseBuffer':
      return brushState?.phaseBuffer;
    default:
      return undefined;
  }
};

const getGobletBrushMaskPayload = (colorCycle, name) => {
  switch (name) {
    case 'alphaMask':
      return colorCycle?.alphaMask;
    case 'softEdgeMask':
      return colorCycle?.softEdgeMask;
    default:
      return undefined;
  }
};

const hasGobletSlotSpeedPayload = (colorCycle) => (
  colorCycle?.speedMode === 'slot'
  && Array.isArray(colorCycle?.slotSpeeds)
  && colorCycle.slotSpeeds.some((entry) => {
    if (typeof entry === 'number') {
      return Number.isFinite(entry);
    }
    return Number.isFinite(entry?.slot) && Number.isFinite(entry?.speed);
  })
);

const gobletPayloadLengthMatches = (payload, expectedElements, bytesPerElement) => (
  payload.length === expectedElements
  || (bytesPerElement > 1 && payload.byteLength === expectedElements * bytesPerElement)
);

const normalizeGobletBrushBufferPayload = (
  payload,
  expectedElements,
  bytesPerElement,
) => {
  if (bytesPerElement !== 2 || !payload || payload instanceof Uint16Array) {
    return payload;
  }
  if (!(payload instanceof Uint8Array)) {
    return payload;
  }
  if (payload.length === expectedElements) {
    return Uint16Array.from(payload);
  }
  if (payload.byteLength === expectedElements * bytesPerElement) {
    return toUint16Buffer(payload);
  }
  return payload;
};

const createGobletResolvedPayloadCache = () => ({
  buffers: new Map(),
  masks: new Map(),
});

const getGobletBrushBufferBytesPerElement = (name) => (
  GOBLET_BRUSH_REQUIRED_BUFFERS.find((entry) => entry.name === name)?.bytesPerElement ?? 1
);

const resolveGobletPayloadWithCache = async (cache, group, name, payload) => {
  const cacheGroup = cache?.[group];
  if (!cacheGroup) {
    return await resolveNumericBuffer(payload, group === 'buffers' ? getGobletBrushBufferBytesPerElement(name) : 1);
  }
  if (cacheGroup.has(name)) {
    return cacheGroup.get(name);
  }
  const resolved = await resolveNumericBuffer(
    payload,
    group === 'buffers' ? getGobletBrushBufferBytesPerElement(name) : 1,
  );
  cacheGroup.set(name, resolved);
  return resolved;
};

const getGobletCachedPayload = (cache, group, name) => {
  const cacheGroup = cache?.[group];
  if (!cacheGroup || !cacheGroup.has(name)) {
    return undefined;
  }
  return cacheGroup.get(name);
};

const resolveGobletBrushBufferPayload = async (cache, name, payload) => (
  await resolveGobletPayloadWithCache(cache, 'buffers', name, payload)
);

const resolveGobletBrushMaskPayload = async (cache, name, payload) => (
  await resolveGobletPayloadWithCache(cache, 'masks', name, payload)
);

const collectGobletBrushPayloadContractErrors = async (colorCycle, brushState, resolvedPayloads = null) => {
  if (!brushState) {
    return ['missing-brush-state'];
  }

  const errors = [];
  if (colorCycle?.mode !== GOBLET_COLOR_CYCLE_BRUSH_MODE) {
    errors.push(`mode-${colorCycle?.mode ?? 'missing'}-expected-${GOBLET_COLOR_CYCLE_BRUSH_MODE}`);
  }

  const width = Math.max(1, Math.round(Number.isFinite(brushState.width) ? brushState.width : 1));
  const height = Math.max(1, Math.round(Number.isFinite(brushState.height) ? brushState.height : 1));
  const expectedElements = width * height;
  const canOmitSpeedBuffer = hasGobletSlotSpeedPayload(colorCycle);
  for (const bufferContract of GOBLET_BRUSH_REQUIRED_BUFFERS) {
    const { name, bytesPerElement, optionalWhen } = bufferContract;
    if (optionalWhen === 'slot-speed' && canOmitSpeedBuffer) {
      continue;
    }
    const payload = getGobletBrushBufferPayload(brushState, name);
    if (!hasNumericPayload(payload)) {
      errors.push(`missing-${name}`);
      continue;
    }
    const rawResolved = await resolveGobletBrushBufferPayload(resolvedPayloads, name, payload);
    const resolved = normalizeGobletBrushBufferPayload(
      rawResolved,
      expectedElements,
      bytesPerElement,
    );
    resolvedPayloads?.buffers?.set(name, resolved);
    if (!resolved || !resolved.length) {
      errors.push(`missing-${name}`);
    } else if (!gobletPayloadLengthMatches(resolved, expectedElements, bytesPerElement)) {
      errors.push(`length-${name}-${resolved.length}-expected-${expectedElements}`);
    }
  }
  for (const scalarContract of GOBLET_BRUSH_REQUIRED_SCALARS) {
    const { name, optionalWhen } = scalarContract;
    if (optionalWhen === 'slot-speed' && canOmitSpeedBuffer) {
      continue;
    }
    if (!Number.isFinite(Number(colorCycle?.[name]))) {
      errors.push(`missing-${name}`);
    }
  }
  for (const maskField of GOBLET_BRUSH_MASK_FIELDS) {
    const maskConfig = getGobletBrushMaskPayload(colorCycle, maskField);
    if (!maskConfig) {
      continue;
    }
    const maskWidth = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : 0;
    const maskHeight = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : 0;
    if (maskWidth !== width || maskHeight !== height) {
      errors.push(`size-${maskField}-${maskWidth}x${maskHeight}-expected-${width}x${height}`);
      continue;
    }
    if (!hasNumericPayload(maskConfig.data)) {
      errors.push(`missing-${maskField}`);
      continue;
    }
    const resolved = await resolveGobletBrushMaskPayload(resolvedPayloads, maskField, maskConfig.data);
    if (!resolved || !resolved.length) {
      errors.push(`missing-${maskField}`);
    } else if (resolved.length !== expectedElements) {
      errors.push(`length-${maskField}-${resolved.length}-expected-${expectedElements}`);
    }
  }
  return errors;
};

const assertGobletBrushPayloadContract = async (colorCycle, brushState) => {
  const resolvedPayloads = createGobletResolvedPayloadCache();
  const errors = await collectGobletBrushPayloadContractErrors(colorCycle, brushState, resolvedPayloads);
  if (errors.length > 0) {
    throw new Error(`Goblet2 brush payload failed contract validation: ${errors.join(', ')}`);
  }
  return resolvedPayloads;
};

const collectGobletMetadataContractErrors = (metadata) => {
  const format = metadata?.format;
  const schemaVersion = Number(metadata?.colorCycle?.schemaVersion);
  const hasSchema = Number.isFinite(schemaVersion);
  const isGoblet2Format = format === GOBLET2_FORMAT;
  const errors = [];

  if (hasSchema && schemaVersion > GOBLET2_SCHEMA_VERSION) {
    errors.push(`unsupported-colorCycle-schemaVersion-${schemaVersion}-expected-${GOBLET2_SCHEMA_VERSION}`);
  }

  if (hasSchema && schemaVersion >= GOBLET2_SCHEMA_VERSION && !isGoblet2Format) {
    errors.push(`format-${format ?? 'missing'}-expected-${GOBLET2_FORMAT}`);
  }

  if (isGoblet2Format) {
    if (!hasSchema) {
      errors.push('missing-colorCycle-schemaVersion');
    } else if (schemaVersion < GOBLET2_LEGACY_SCHEMA_VERSION) {
      errors.push(`unsupported-colorCycle-schemaVersion-${schemaVersion}-expected-${GOBLET2_LEGACY_SCHEMA_VERSION}-or-${GOBLET2_SCHEMA_VERSION}`);
    }
  }

  return errors;
};

const assertGobletMetadataContract = (metadata) => {
  const errors = collectGobletMetadataContractErrors(metadata);
  if (errors.length > 0) {
    throw new Error(`Goblet2 metadata failed contract validation: ${errors.join(', ')}`);
  }
};

const isGobletPayloadContractError = (error) => (
  error instanceof Error
  && (
    error.message.includes('Goblet2 brush payload failed contract validation')
    || error.message.includes('Goblet2 metadata failed contract validation')
  )
);

// ------------------------------------------------------------
// Gradient + color-cycle helpers
// ------------------------------------------------------------
const parseColor = parseGobletColor;
const normalizeGradientStops = normalizeGobletGradientStops;
const normalizeSlotPalettes = normalizeGobletSlotPalettes;
const SOFT_SEAM_BLEND_RATIO = 1 / 8;

const normalizeSlotSeamProfiles = (slotPalettes) => {
  if (!Array.isArray(slotPalettes) || slotPalettes.length === 0) {
    return null;
  }
  const profiles = new Map();
  slotPalettes.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || !Number.isFinite(Number(entry.slot))) {
      return;
    }
    profiles.set(
      clampGobletSlotId(Number(entry.slot)),
      entry.seamProfile === 'soft' ? 'soft' : 'hard',
    );
  });
  return profiles.size > 0 ? profiles : null;
};

const normalizeGradientDefPalettes = (gradientDefStore) => {
  const gradients = new Map();
  const seamProfiles = new Map();
  if (!Array.isArray(gradientDefStore)) {
    return { gradients, seamProfiles };
  }
  gradientDefStore.forEach((entry) => {
    const id = Math.round(Number(entry?.id));
    if (!Number.isFinite(id) || id <= 0 || id > 0xffff || !Array.isArray(entry?.stops) || entry.stops.length === 0) {
      return;
    }
    gradients.set(id, normalizeGradientStops(entry.stops));
    seamProfiles.set(id, entry.seamProfile === 'soft' ? 'soft' : 'hard');
  });
  return { gradients, seamProfiles };
};

const applyGradientSeamProfileToRgba = (palette, {
  paletteSize,
  seamProfile,
  offset = 0,
}) => {
  const size = Math.max(1, Math.floor(paletteSize));
  if (seamProfile !== 'soft' || size < 2) {
    return;
  }
  const start = Math.max(0, Math.floor(offset));
  const end = start + size * 4;
  if (end > palette.length) {
    return;
  }
  const source = palette.slice(start, end);
  const blendLength = Math.max(2, Math.round(size * SOFT_SEAM_BLEND_RATIO));
  const blendStart = Math.max(1, size - blendLength);
  const blendSpan = size - blendStart;
  for (let index = blendStart; index < size; index += 1) {
    const blend = (index - blendStart + 1) / blendSpan;
    const sourceIndex = index * 4;
    const targetIndex = start + sourceIndex;
    for (let channel = 0; channel < 4; channel += 1) {
      palette[targetIndex + channel] = Math.round(
        (source[sourceIndex + channel] ?? (channel === 3 ? 255 : 0)) * (1 - blend)
        + (source[channel] ?? (channel === 3 ? 255 : 0)) * blend,
      );
    }
  }
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
      map.set(clampGobletSlotId(slot), speed);
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
    map.set(clampGobletSlotId(slot), speed);
  });
  return map.size > 0 ? map : null;
};

const createSlotSpeedUniformData = (slotSpeeds, defaultSpeed) => {
  const out = new Float32Array(SLOT_COUNT);
  const fallbackSpeed = Number.isFinite(slotSpeeds?.get(0))
    ? slotSpeeds.get(0)
    : defaultSpeed;
  const resolvedFallback = Number.isFinite(fallbackSpeed) ? fallbackSpeed : 0;
  out.fill(resolvedFallback);
  if (!slotSpeeds) {
    return out;
  }
  slotSpeeds.forEach((speed, slot) => {
    const normalizedSlot = clampGobletSlotId(slot, FLOW_SLOT_MASK);
    if (Number.isFinite(speed)) {
      out[normalizedSlot] = speed;
    }
  });
  return out;
};

const hasNonZeroSlotSpeed = (slotSpeedData) => {
  if (!slotSpeedData) {
    return false;
  }
  for (let i = 0; i < slotSpeedData.length; i += 1) {
    if (slotSpeedData[i] > 0) {
      return true;
    }
  }
  return false;
};

const sampleGradient = sampleGobletGradient;

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
      const color = lut[capped] >>> 0;
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
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
      const color = lut[capped] >>> 0;
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
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
      const a = resolveGobletAlphaByte(alpha, aIdx, 255);
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
const DEFAULT_SPEED_MIN = 0.01;
const DEFAULT_SPEED_MAX = 2.64;
const FLOW_SLOT_BITS = 8;
const FLOW_SLOT_MASK = (1 << FLOW_SLOT_BITS) - 1;
const FLOW_MODE_FORWARD = GOBLET_FLOW_MODE_FORWARD;
const FLOW_MODE_REVERSE = GOBLET_FLOW_MODE_REVERSE;
const FLOW_MODE_PINGPONG = GOBLET_FLOW_MODE_PINGPONG;
const MODE_COUNT = 3;
const SB_COUNT = 256;
const SLOT_COUNT = FLOW_SLOT_MASK + 1;

const packABGR32 = (c) => (c.a << 24) | (c.b << 16) | (c.g << 8) | c.r;

const buildDiscretePalette32FromGradient = (gradientStops, cycleColors, seamProfile) => {
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
  applyGradientSeamProfileToRgba(
    new Uint8Array(pal.buffer, pal.byteOffset, pal.byteLength),
    { paletteSize: n, seamProfile },
  );
  return pal;
};

const buildDiscretePalette32FromExplicitPalette = (palette, cycleColors) => {
  if (!Array.isArray(palette) || palette.length === 0) {
    return null;
  }
  const targetSize = Math.max(1, cycleColors | 0);
  const parsed = palette.map((entry) => packABGR32(parseColor(entry)));
  if (parsed.length === 0) {
    return null;
  }
  const out = new Uint32Array(targetSize);
  if (parsed.length >= targetSize) {
    for (let i = 0; i < targetSize; i += 1) {
      out[i] = parsed[i];
    }
    return out;
  }
  for (let i = 0; i < targetSize; i += 1) {
    out[i] = parsed[i % parsed.length];
  }
  return out;
};

const buildPaletteShiftLUT256 = ({ basePalette32, cycleColors, offset01 }) => {
  const lut = new Uint32Array(256);
  const n = Math.max(1, cycleColors | 0);
  const off = wrapGobletPhase01(offset01);
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

const lerpByte = (a, b, t) => clamp255(a + (b - a) * t);

const samplePalette32Fractional = (basePalette32, baseIndex, phase, flowMode, paletteSize) => {
  const n = Math.max(1, paletteSize | 0);
  if (!basePalette32 || basePalette32.length === 0) {
    return 0;
  }
  const position = resolveGobletPalettePosition(baseIndex, phase, flowMode, n);
  const lower = Math.floor(position);
  const upper = (lower + 1) % n;
  const t = position - lower;
  const c0 = basePalette32[lower] >>> 0;
  const c1 = basePalette32[upper] >>> 0;
  const r = lerpByte(c0 & 0xff, c1 & 0xff, t);
  const g = lerpByte((c0 >>> 8) & 0xff, (c1 >>> 8) & 0xff, t);
  const b = lerpByte((c0 >>> 16) & 0xff, (c1 >>> 16) & 0xff, t);
  const a = lerpByte((c0 >>> 24) & 0xff, (c1 >>> 24) & 0xff, t);
  return (a << 24) | (b << 16) | (g << 8) | r;
};

const buildPaletteFractionalShiftLUT256 = (
  { basePalette32, cycleColors, offset01, flowMode = FLOW_MODE_FORWARD },
  target = new Uint32Array(256),
) => {
  const lut = target instanceof Uint32Array && target.length >= 256
    ? target
    : new Uint32Array(256);
  const n = Math.max(1, cycleColors | 0);
  for (let i = 0; i < 256; i += 1) {
    let p = i - 1;
    if (p < 0) p = 0;
    else if (p >= n) p = n - 1;
    lut[i] = samplePalette32Fractional(basePalette32, p, offset01, flowMode, n);
  }
  return lut;
};

const DEFAULT_PALETTE_SIZE = 256;
const MAX_EXPORTED_SLOT_ID = GOBLET_MAX_SLOT_ID;

const getHighestPaletteSlot = (slotGradients) => {
  let highest = FLOW_SLOT_MASK;
  if (!slotGradients || typeof slotGradients.forEach !== 'function') {
    return highest;
  }
  slotGradients.forEach((_stops, slot) => {
    const numeric = Number(slot);
    if (Number.isFinite(numeric)) {
      highest = Math.max(highest, clampGobletSlotId(numeric, MAX_EXPORTED_SLOT_ID));
    }
  });
  return highest;
};

const buildPaletteTableRGBA = (
  slotGradients,
  slotSeamProfiles,
  fallbackGradient,
  paletteSize = DEFAULT_PALETTE_SIZE,
  defGradients = null,
  defSeamProfiles = null,
) => {
  const size = Math.max(1, Math.round(paletteSize));
  const slotCount = Math.max(1, getHighestPaletteSlot(slotGradients) + 1);
  const defIds = defGradients instanceof Map
    ? [...defGradients.keys()].filter((id) => Number.isFinite(id) && id > 0).sort((a, b) => a - b)
    : [];
  const rowCount = slotCount + defIds.length;
  if (rowCount > 0x10000) {
    throw new Error(`Goblet definition palette exceeds 16-bit row capacity (${rowCount} rows)`);
  }
  const data = new Uint8Array(size * rowCount * 4);
  const fallbackStops = normalizeGradientStops(fallbackGradient);
  const writePaletteRow = (row, stops, seamProfile) => {
    for (let i = 0; i < size; i += 1) {
      const t = size === 1 ? 0 : i / (size - 1);
      const c = sampleGradient(stops, t);
      const idx = (row * size + i) * 4;
      data[idx] = clamp255(c.r);
      data[idx + 1] = clamp255(c.g);
      data[idx + 2] = clamp255(c.b);
      data[idx + 3] = clamp255(c.a);
    }
    applyGradientSeamProfileToRgba(data, {
      paletteSize: size,
      seamProfile,
      offset: row * size * 4,
    });
  };
  for (let slot = 0; slot < slotCount; slot += 1) {
    writePaletteRow(
      slot,
      slotGradients?.get(slot) ?? fallbackStops,
      slotSeamProfiles?.get(slot),
    );
  }
  const defRowById = new Map();
  defIds.forEach((defId, index) => {
    const row = slotCount + index;
    defRowById.set(defId, row);
    writePaletteRow(row, defGradients.get(defId), defSeamProfiles?.get(defId));
  });
  return { data, width: size, height: rowCount, defRowById };
};

const buildPaletteRowBuffer = (gradientIds, gradientDefIds, defRowById, length) => {
  const rows = new Uint16Array(length);
  for (let index = 0; index < length; index += 1) {
    const defId = gradientDefIds ? (gradientDefIds[index] ?? 0) : 0;
    const defRow = defId > 0 ? defRowById?.get(defId) : undefined;
    rows[index] = defRow ?? resolveGobletGradientSlot(gradientIds?.[index] ?? 0, FLOW_SLOT_MASK);
  }
  return rows;
};

const createShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to allocate shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
};

const createProgram = (gl, vertexSource, fragmentSource) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to allocate WebGL program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
};

const configureTexture = (gl, texture, unit, target = gl.TEXTURE_2D) => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, texture);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

const uploadR8Texture = (gl, texture, width, height, data, integer = false) => {
  configureTexture(gl, texture, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (integer) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }
};

class BrushWebGLRenderer {
  constructor(options) {
    const {
      width,
      height,
      paletteSize,
      speedMin,
      speedMax,
      startOffset01,
      alphaMode
    } = options;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.paletteSize = Math.max(1, Math.round(paletteSize));
    this.slotCount = 1;
    this.speedMin = speedMin;
    this.speedMax = speedMax;
    this.startOffset01 = startOffset01;
    this.alphaMode = alphaMode;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      depth: false,
      stencil: false
    });
    if (!gl) {
      throw new Error('WebGL2 unavailable');
    }
    this.gl = gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const vertexSource = `#version 300 es
      in vec2 a_pos;
      in vec2 a_uv;
      out vec2 v_uv;
      void main() {
        v_uv = a_uv;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }`;

    const fragmentSource = `#version 300 es
      precision highp float;
      precision highp int;
      precision highp usampler2D;

      in vec2 v_uv;
      out vec4 outColor;

      uniform usampler2D u_index;
      uniform usampler2D u_slot;
      uniform usampler2D u_paletteRow;
      uniform usampler2D u_speed;
      uniform usampler2D u_flow;
      uniform usampler2D u_phase;
      uniform sampler2D u_palette;
      uniform sampler2D u_alpha;
      uniform sampler2D u_mask;
      uniform sampler2D u_softMask;

      uniform float u_time;
      uniform float u_speedMin;
      uniform float u_speedMax;
      uniform float u_startOffset;
      uniform float u_legacyOffset01;
      uniform float u_slotSpeeds[256];
      uniform int u_paletteSize;
      uniform int u_slotCount;
      uniform bool u_useSlotSpeeds;
      uniform bool u_hasAlpha;
      uniform bool u_hasMask;
      uniform bool u_hasSoftMask;
      uniform bool u_opaqueIndices;

      void main() {
        ivec2 size = textureSize(u_index, 0);
        int x = int(gl_FragCoord.x);
        int y = size.y - 1 - int(gl_FragCoord.y);
        ivec2 coord = ivec2(x, y);
        uint idx = texelFetch(u_index, coord, 0).r;
        if (idx == uint(0)) {
          outColor = vec4(0.0);
          return;
        }
        uint slot = texelFetch(u_slot, coord, 0).r;
        uint paletteRow = texelFetch(u_paletteRow, coord, 0).r;
        uint speedByte = texelFetch(u_speed, coord, 0).r;
        uint flowByte = texelFetch(u_flow, coord, 0).r;
        uint phaseByte = texelFetch(u_phase, coord, 0).r;
        float phase = 0.0;
        if (u_useSlotSpeeds) {
          phase = u_time * u_slotSpeeds[int(min(slot, uint(255)))];
        } else if (speedByte == uint(0)) {
          phase = u_legacyOffset01;
        } else {
          float normalized = max(0.0, min(254.0, float(speedByte) - 1.0)) / 254.0;
          float speed = u_speedMin + normalized * (u_speedMax - u_speedMin);
          phase = u_time * speed;
        }
        phase = fract(phase + float(phaseByte) / 256.0);
        float base = float(int(idx) - 1);
        base = clamp(base, 0.0, float(u_paletteSize - 1));
        float adjustedPhase = phase;
        if (flowByte == uint(3)) {
          adjustedPhase = phase < 0.5 ? phase * 2.0 : (1.0 - phase) * 2.0;
        }
        float direction = flowByte == uint(2) ? 1.0 : -1.0;
        float modded = mod(base + direction * adjustedPhase * float(u_paletteSize) + float(u_paletteSize) * 4.0, float(u_paletteSize));
        float lower = floor(modded);
        float upper = mod(lower + 1.0, float(u_paletteSize));
        float mixT = fract(modded);
        int row = int(min(paletteRow, uint(u_slotCount - 1)));
        vec2 paletteSize = vec2(float(u_paletteSize), float(u_slotCount));
        vec2 lowerUV = (vec2(lower + 0.5, float(row) + 0.5) / paletteSize);
        vec2 upperUV = (vec2(upper + 0.5, float(row) + 0.5) / paletteSize);
        vec4 paletteColor = mix(texture(u_palette, lowerUV), texture(u_palette, upperUV), mixT);
        vec3 color = paletteColor.rgb;
        float alpha = 1.0;
        vec2 sampleUV = vec2(v_uv.x, 1.0 - v_uv.y);
        if (u_opaqueIndices) {
          alpha = idx == uint(0) ? 0.0 : 1.0;
        } else if (u_hasAlpha) {
          alpha = texture(u_alpha, sampleUV).a;
        }
        alpha *= paletteColor.a;
        if (u_hasMask) {
          alpha *= 1.0 - texture(u_mask, sampleUV).r;
        }
        if (u_hasSoftMask) {
          alpha *= texture(u_softMask, sampleUV).r;
        }
        outColor = vec4(color, alpha);
      }`;

    const program = createProgram(gl, vertexSource, fragmentSource);
    this.program = program;
    gl.useProgram(program);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.vao = vao;

    const quad = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1
    ]);
    const buffer = gl.createBuffer();
    this.vertexBuffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'a_pos');
    const aUv = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    this.uniforms = {
      u_index: gl.getUniformLocation(program, 'u_index'),
      u_slot: gl.getUniformLocation(program, 'u_slot'),
      u_paletteRow: gl.getUniformLocation(program, 'u_paletteRow'),
      u_speed: gl.getUniformLocation(program, 'u_speed'),
      u_flow: gl.getUniformLocation(program, 'u_flow'),
      u_phase: gl.getUniformLocation(program, 'u_phase'),
      u_palette: gl.getUniformLocation(program, 'u_palette'),
      u_alpha: gl.getUniformLocation(program, 'u_alpha'),
      u_mask: gl.getUniformLocation(program, 'u_mask'),
      u_softMask: gl.getUniformLocation(program, 'u_softMask'),
      u_time: gl.getUniformLocation(program, 'u_time'),
      u_speedMin: gl.getUniformLocation(program, 'u_speedMin'),
      u_speedMax: gl.getUniformLocation(program, 'u_speedMax'),
      u_startOffset: gl.getUniformLocation(program, 'u_startOffset'),
      u_slotSpeeds: gl.getUniformLocation(program, 'u_slotSpeeds[0]'),
      u_paletteSize: gl.getUniformLocation(program, 'u_paletteSize'),
      u_slotCount: gl.getUniformLocation(program, 'u_slotCount'),
      u_useSlotSpeeds: gl.getUniformLocation(program, 'u_useSlotSpeeds'),
      u_hasAlpha: gl.getUniformLocation(program, 'u_hasAlpha'),
      u_hasMask: gl.getUniformLocation(program, 'u_hasMask'),
      u_hasSoftMask: gl.getUniformLocation(program, 'u_hasSoftMask'),
      u_opaqueIndices: gl.getUniformLocation(program, 'u_opaqueIndices'),
      u_legacyOffset01: gl.getUniformLocation(program, 'u_legacyOffset01')
    };

    this.textures = {
      index: gl.createTexture(),
      slot: gl.createTexture(),
      paletteRow: gl.createTexture(),
      speed: gl.createTexture(),
      flow: gl.createTexture(),
      phase: gl.createTexture(),
      palette: gl.createTexture(),
      alpha: gl.createTexture(),
      mask: gl.createTexture(),
      softMask: gl.createTexture()
    };

    gl.uniform1i(this.uniforms.u_index, 0);
    gl.uniform1i(this.uniforms.u_slot, 1);
    gl.uniform1i(this.uniforms.u_paletteRow, 9);
    gl.uniform1i(this.uniforms.u_speed, 2);
    gl.uniform1i(this.uniforms.u_flow, 3);
    gl.uniform1i(this.uniforms.u_phase, 4);
    gl.uniform1i(this.uniforms.u_palette, 5);
    gl.uniform1i(this.uniforms.u_alpha, 6);
    gl.uniform1i(this.uniforms.u_mask, 7);
    gl.uniform1i(this.uniforms.u_softMask, 8);
    gl.uniform1f(this.uniforms.u_speedMin, this.speedMin);
    gl.uniform1f(this.uniforms.u_speedMax, this.speedMax);
    gl.uniform1f(this.uniforms.u_startOffset, this.startOffset01);
    gl.uniform1i(this.uniforms.u_paletteSize, this.paletteSize);
    gl.uniform1i(this.uniforms.u_slotCount, this.slotCount);
    gl.uniform1i(this.uniforms.u_useSlotSpeeds, 0);
    gl.uniform1i(this.uniforms.u_opaqueIndices, this.alphaMode === 'opaque-indices');
  }

  setSlotSpeeds(slotSpeedData) {
    const gl = this.gl;
    if (!slotSpeedData) {
      gl.uniform1i(this.uniforms.u_useSlotSpeeds, 0);
      return;
    }
    gl.useProgram(this.program);
    gl.uniform1fv(this.uniforms.u_slotSpeeds, slotSpeedData);
    gl.uniform1i(this.uniforms.u_useSlotSpeeds, 1);
  }

  setBuffers(indexBuffer, slotBuffer, paletteRowBuffer, speedBuffer, flowBuffer, phaseBuffer) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.index);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, indexBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.paletteRow);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, paletteRowBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.slot);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, slotBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.speed);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, speedBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.flow);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, flowBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.phase);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, this.width, this.height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, phaseBuffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`Goblet WebGL2 buffer upload failed with error ${error}`);
    }
  }

  setPalette(paletteData, width, height) {
    const gl = this.gl;
    this.slotCount = Math.max(1, Math.round(height));
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (width > maxTextureSize || this.slotCount > maxTextureSize) {
      throw new Error(`Goblet palette table exceeds WebGL2 texture limits (${width}x${this.slotCount}, max ${maxTextureSize})`);
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.palette);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms.u_slotCount, this.slotCount);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`Goblet WebGL2 palette upload failed with error ${error}`);
    }
  }

  setAlphaTexture(image) {
    const gl = this.gl;
    if (!image) {
      gl.uniform1i(this.uniforms.u_hasAlpha, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.alpha);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms.u_hasAlpha, 1);
  }

  setMaskTexture(maskData, width, height) {
    const gl = this.gl;
    if (!maskData) {
      gl.uniform1i(this.uniforms.u_hasMask, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, maskData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms.u_hasMask, 1);
  }

  setSoftMaskTexture(maskData, width, height) {
    const gl = this.gl;
    if (!maskData) {
      gl.uniform1i(this.uniforms.u_hasSoftMask, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.softMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, maskData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uniforms.u_hasSoftMask, 1);
  }

  render(timeSeconds, legacyOffset01) {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.u_time, timeSeconds);
    gl.uniform1f(this.uniforms.u_legacyOffset01, legacyOffset01);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    Object.values(this.textures || {}).forEach((texture) => {
      if (texture) {
        gl.deleteTexture(texture);
      }
    });
  }
}

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

const normalizeSlotId = (value) => clampGobletSlotId(value, MAX_EXPORTED_SLOT_ID);

const collectPaletteSlots = (slotPalettes) => {
  if (!Array.isArray(slotPalettes) || slotPalettes.length === 0) {
    return null;
  }
  const set = new Set();
  for (let i = 0; i < slotPalettes.length; i += 1) {
    const entry = slotPalettes[i];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const slot = Number(entry.slot);
    if (Number.isFinite(slot)) {
      set.add(normalizeSlotId(Math.round(slot)));
    }
  }
  return set.size > 0 ? set : null;
};

const reconcileGradientIdSlotIndexing = (indexBuffer, gradientIdBuffer, slotPalettes) => {
  if (!indexBuffer || !gradientIdBuffer || gradientIdBuffer.length === 0) {
    return gradientIdBuffer;
  }
  const paletteSlots = collectPaletteSlots(slotPalettes);
  if (!paletteSlots || paletteSlots.size === 0) {
    return gradientIdBuffer;
  }

  const usedSlots = new Set();
  const length = Math.min(indexBuffer.length, gradientIdBuffer.length);
  for (let i = 0; i < length; i += 1) {
    if ((indexBuffer[i] | 0) === 0) {
      continue;
    }
    const gid = gradientIdBuffer[i] | 0;
    if (gid > 0) {
      usedSlots.add(gid);
    }
  }
  if (usedSlots.size === 0) {
    return gradientIdBuffer;
  }

  let directMatches = 0;
  let shiftedMatches = 0;
  usedSlots.forEach((slot) => {
    if (paletteSlots.has(slot)) {
      directMatches += 1;
    }
    if (slot > 0 && paletteSlots.has(slot - 1)) {
      shiftedMatches += 1;
    }
  });

  if (shiftedMatches > directMatches && shiftedMatches > 0) {
    for (let i = 0; i < length; i += 1) {
      if ((indexBuffer[i] | 0) === 0) {
        continue;
      }
      const gid = gradientIdBuffer[i] | 0;
      if (gid > 0) {
        gradientIdBuffer[i] = normalizeSlotId(gid - 1);
      }
    }
    diagnostics.log('[goblet2] Applied +1 gradient-slot compatibility remap', {
      directMatches,
      shiftedMatches
    });
  }

  return gradientIdBuffer;
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

const hasAnyNonZeroSpeedByte = (speedBuffer) => {
  if (!speedBuffer || !speedBuffer.length) {
    return false;
  }
  for (let i = 0; i < speedBuffer.length; i += 1) {
    if ((speedBuffer[i] | 0) !== 0) {
      return true;
    }
  }
  return false;
};

const hasAnyNonZeroByte = (buffer) => {
  if (!buffer || !buffer.length) {
    return false;
  }
  for (let i = 0; i < buffer.length; i += 1) {
    if ((buffer[i] | 0) !== 0) {
      return true;
    }
  }
  return false;
};

const downsampleBuffer = (source, srcW, srcH, dstW, dstH) => {
  if (!source) {
    return source;
  }
  const out = source instanceof Uint16Array
    ? new Uint16Array(dstW * dstH)
    : new Uint8Array(dstW * dstH);
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

const populateTablesFromMaps = (player, lutsBySpeedModeSlot, fallbackLutsBySpeedMode) => {
  const slotLuts = player._slotLuts;
  const fallback = player._fallbackLuts;

  for (const [sb, modeMap] of fallbackLutsBySpeedMode.entries()) {
    markTouchedSpeed(player, sb);
    for (const [modeConst, lut] of modeMap.entries()) {
      const mi = getGobletFlowModeIndex(modeConst);
      fallback[sb][mi] = lut;
    }
  }

  for (const [sb, modeMap] of lutsBySpeedModeSlot.entries()) {
    markTouchedSpeed(player, sb);
    for (const [modeConst, slotMap] of modeMap.entries()) {
      const mi = getGobletFlowModeIndex(modeConst);
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
    const mode = resolveGobletFlowMode(flowBits);
    const modeMap = lutsBySpeedAndMode.get(speedByte) ?? lutsBySpeedAndMode.get(0);
    const lut = modeMap?.get(mode) ?? modeMap?.get(FLOW_MODE_FORWARD);
    if (!lut) {
      outPixels32[i] = 0;
      continue;
    }
    const capped = effective >= 0 && effective < lut.length ? effective : ((effective % lut.length) + lut.length) % lut.length;
    if (useAlpha) {
      const color = lut[capped] >>> 0;
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
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
    const mi = getGobletFlowModeIndex(flowBits);

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
      const color = lut[lutIndex] >>> 0;
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
      outPixels32[i] = (a << 24) | rgb;
    } else {
      outPixels32[i] = lut[lutIndex];
    }
  }
};

const fillPixelsFromIndicesWithFractionalSpeedFlowPhase = (
  indices,
  gradientIds,
  gradientDefIds,
  speedBytes,
  flowBytes,
  phaseBytes,
  basePalette32BySlot,
  basePalette32ByDefId,
  fallbackPalette32,
  outPixels32,
  alpha,
  params,
  options = {}
) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;
  const paletteSize = Math.max(1, (params?.paletteSize | 0) || 1);
  const speedMin = params?.speedMin;
  const speedMax = params?.speedMax;
  const timeSeconds = Number.isFinite(params?.timeSeconds) ? params.timeSeconds : 0;
  const defaultSpeed = Number.isFinite(params?.defaultSpeed) ? params.defaultSpeed : 0;
  const legacyOffset01 = Number.isFinite(params?.legacyOffset01) ? params.legacyOffset01 : 0;

  for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
    const rawIndex = indices[i] ?? 0;
    if (transparentZero && rawIndex === 0) {
      outPixels32[i] = 0;
      continue;
    }
    const effective = resolveGobletPaletteIndex(rawIndex, paletteSize, subtractOne);

    const gid = gradientIds ? (gradientIds[i] ?? 0) : 0;
    const slot = resolveGobletGradientSlot(gid, FLOW_SLOT_MASK);
    const encodedFlow = flowBytes ? (flowBytes[i] ?? FLOW_MODE_FORWARD) : (gid >> FLOW_SLOT_BITS);
    const flowMode = resolveGobletFlowMode(encodedFlow);
    const speedByte = speedBytes ? (speedBytes[i] ?? 0) : 0;
    const speed = speedByte > 0
      ? decodeColorCycleSpeedByte(speedByte, speedMin, speedMax, DEFAULT_SPEED_MIN, DEFAULT_SPEED_MAX)
      : defaultSpeed;
    const basePhase = speedByte > 0
      ? timeSeconds * speed
      : legacyOffset01;
    const phaseByte = phaseBytes ? (phaseBytes[i] ?? 0) : 0;
    const phase = resolveGobletPhase01(basePhase, phaseByte);

    const defId = gradientDefIds ? (gradientDefIds[i] ?? 0) : 0;
    const palette = (defId > 0 ? basePalette32ByDefId?.get(defId) : null)
      ?? basePalette32BySlot.get(slot)
      ?? fallbackPalette32;
    if (!palette) {
      outPixels32[i] = 0;
      continue;
    }
    const color = samplePalette32Fractional(palette, effective, phase, flowMode, paletteSize) >>> 0;
    if (useAlpha) {
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
      outPixels32[i] = (a << 24) | rgb;
    } else {
      outPixels32[i] = color;
    }
  }
};

const fillPixelsFromIndicesWithFractionalSlotSpeeds = (
  indices,
  gradientIds,
  gradientDefIds,
  slotSpeedMap,
  flowBytes,
  phaseBytes,
  basePalette32BySlot,
  basePalette32ByDefId,
  fallbackPalette32,
  outPixels32,
  alpha,
  params,
  options = {}
) => {
  const transparentZero = options.transparentZero === true;
  const subtractOne = options.subtractOne === true;
  const length = Math.min(indices.length, outPixels32.length);
  const useAlpha = alpha && alpha.length >= length * 4;
  const paletteSize = Math.max(1, (params?.paletteSize | 0) || 1);
  const timeSeconds = Number.isFinite(params?.timeSeconds) ? params.timeSeconds : 0;
  const defaultSpeed = Number.isFinite(params?.defaultSpeed) ? params.defaultSpeed : 0;
  const legacyOffset01 = Number.isFinite(params?.legacyOffset01) ? params.legacyOffset01 : 0;

  for (let i = 0, aIdx = 3; i < length; i += 1, aIdx += 4) {
    const rawIndex = indices[i] ?? 0;
    if (transparentZero && rawIndex === 0) {
      outPixels32[i] = 0;
      continue;
    }
    const effective = resolveGobletPaletteIndex(rawIndex, paletteSize, subtractOne);

    const gid = gradientIds ? (gradientIds[i] ?? 0) : 0;
    const slot = resolveGobletGradientSlot(gid, FLOW_SLOT_MASK);
    const encodedFlow = flowBytes ? (flowBytes[i] ?? FLOW_MODE_FORWARD) : (gid >> FLOW_SLOT_BITS);
    const flowMode = resolveGobletFlowMode(encodedFlow);
    const slotSpeed = Number.isFinite(slotSpeedMap?.get(slot))
      ? slotSpeedMap.get(slot)
      : (Number.isFinite(slotSpeedMap?.get(0)) ? slotSpeedMap.get(0) : defaultSpeed);
    const basePhase = Number.isFinite(slotSpeed)
      ? timeSeconds * slotSpeed
      : legacyOffset01;
    const phaseByte = phaseBytes ? (phaseBytes[i] ?? 0) : 0;
    const phase = resolveGobletPhase01(basePhase, phaseByte);

    const defId = gradientDefIds ? (gradientDefIds[i] ?? 0) : 0;
    const palette = (defId > 0 ? basePalette32ByDefId?.get(defId) : null)
      ?? basePalette32BySlot.get(slot)
      ?? fallbackPalette32;
    if (!palette) {
      outPixels32[i] = 0;
      continue;
    }
    const color = samplePalette32Fractional(palette, effective, phase, flowMode, paletteSize) >>> 0;
    if (useAlpha) {
      const rgb = color & 0x00ffffff;
      const lutA = (color >>> 24) & 0xff;
      const srcA = resolveGobletIndexedAlphaByte(alpha, aIdx, effective);
      const a = (srcA * lutA + 127) / 255 | 0;
      outPixels32[i] = (a << 24) | rgb;
    } else {
      outPixels32[i] = color;
    }
  }
};

class ColorCycleLayerPlayer {
  constructor(layer, textureImage, options = {}) {
    this.layer = layer;
    this.image = textureImage;
    this.options = options;
    this.isGoblet2 = options?.schemaVersion >= GOBLET2_SCHEMA_VERSION;
    this._halfResPreference = resolveHalfResPreference();
    this.renderScale = this._halfResPreference === 'true' ? 0.5 : 1;
    this._adaptiveScaleEnabled = false;

    const width = Math.max(1, Math.round(layer.source?.width ?? textureImage?.naturalWidth ?? textureImage?.width ?? 1));
    const height = Math.max(1, Math.round(layer.source?.height ?? textureImage?.naturalHeight ?? textureImage?.height ?? 1));

    this.canvas = document.createElement('canvas');
    this.createSurface(width, height);

    this.alpha = null;
    this.baseImageData = null;
    this.indexBuffer = null;
    this.gradientIdBuffer = null;
    this.gradientDefIdBuffer = null;
    this.speedBuffer = null;
    this.flowBuffer = null;
    this.phaseBuffer = null;
    this.speedMode = null;
    this.slotSpeeds = null;
    this.slotSpeedData = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.gradient = normalizeGradientStops(null);
    this.slotGradients = null;
    this.slotSeamProfiles = null;
    this.defGradients = null;
    this.defSeamProfiles = null;
    this.cycleColors = 16;
    this.mappingMode = 'banded';
    this.flowMapping = 'palette';
    this.flowDirection = 'forward';
    this.speed = 0;
    this.baseTimeSeconds = 0;
    this.startTimeMs = 0;
    this.baseOffset = 0;
    this.legacyOffset01 = 0;
    this.legacySpeedCps = 0;
    this.targetFPS = null;
    this.frameAccumulator = 0;
    this.speedMin = null;
    this.speedMax = null;
    this._distinctSpeedBytes = null;
    this._usedSlots = null;
    this._lutCacheBase = new Map();
    this._lutCacheSlots = new Map();
    this._lutCacheBands = null;
    this._fractionalBaseLut = new Uint32Array(256);
    this._fractionalLutsBySlot = new Map();
    this._slotLuts = Array.from({ length: SB_COUNT }, () =>
      Array.from({ length: MODE_COUNT }, () => new Array(SLOT_COUNT).fill(null))
    );
    this._fallbackLuts = Array.from({ length: SB_COUNT }, () => new Array(MODE_COUNT).fill(null));
    this._touchedSpeedBytes = new Uint8Array(SB_COUNT);
    this._touchedSpeedList = new Uint8Array(SB_COUNT);
    this._touchedSpeedListLen = 0;
    this._basePalette32BySlot = new Map();
    this._basePalette32ByDefId = new Map();
    this._fallbackPalette32 = null;
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
    this._fillWindowFrames = 0;
    this._slowWindowCount = 0;
    this._fastWindowCount = 0;
    this._lastScaleTransitionMs = Number.NEGATIVE_INFINITY;
    this._lastScaleTransitionReason = null;
    this._lastFps = null;
    this._isReinitializing = false;
    this._scaleTransitionPromise = null;
    this._destroyed = false;
    this._lifecycleVersion = 0;
    this._webglInitAttempted = false;
    this._webglInitFailed = false;
    this._webglFallbackReason = null;
    this._lastCpuFillMs = 0;
    this._lastCpuBlitMs = 0;
    this._lastRenderPath = 'uninitialized';
    this._hasVisibleAlpha = true;
    this.webglRenderer = null;
    this.webglCanvas = null;
    this.useWebGL = false;
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

  async initialize({ allowWebGL = true } = {}) {
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

    let resolvedPayloads = null;
    if (hasBrush) {
      resolvedPayloads = await this.initializeBrushMode(colorCycle, brushState, { allowWebGL });
    } else if (hasRecolor) {
      await this.initializeRecolorMode(colorCycle, recolorSettings);
    } else {
      throw new Error('Color cycle configuration missing index buffer');
    }

    if (!this.indexBuffer || this.indexBuffer.length === 0) {
      throw new Error('Color cycle index buffer is empty');
    }

    if (!this.useWebGL) {
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
    }

    if (this.mode === 'recolor' && this.flowMapping === 'luminance' && !this.phaseMap && this.baseImageData) {
      this.phaseMap = buildLuminancePhaseMap(this.baseImageData);
    }

    if (colorCycle.alphaMask) {
      const resolvedAlphaMask = getGobletCachedPayload(resolvedPayloads, 'masks', 'alphaMask');
      if (this.useWebGL && this.webglRenderer) {
        await this.applyWebGLAlphaMask(colorCycle.alphaMask, resolvedAlphaMask);
      } else {
        await this.applyAlphaMask(colorCycle.alphaMask, resolvedAlphaMask);
        probeAlphaMask();
      }
    }

    if (colorCycle.softEdgeMask) {
      const resolvedSoftEdgeMask = getGobletCachedPayload(resolvedPayloads, 'masks', 'softEdgeMask');
      if (this.useWebGL && this.webglRenderer) {
        await this.applyWebGLSoftEdgeMask(colorCycle.softEdgeMask, resolvedSoftEdgeMask);
      } else {
        await this.applySoftEdgeMask(colorCycle.softEdgeMask, resolvedSoftEdgeMask);
        probeAlphaMask();
      }
    }

    this._hasVisibleAlpha = this.useWebGL ? true : hasVisibleAlpha(this.alpha);

    this.startTimeMs = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    this.renderFrame();
  }

  async applyAlphaMask(maskConfig, resolvedPayload = undefined) {
    if (!maskConfig || !maskConfig.data) {
      return;
    }
    const width = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : this.width;
    const height = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : this.height;
    const payload = resolvedPayload !== undefined
      ? resolvedPayload
      : await resolveNumericBuffer(maskConfig.data);
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

  async applySoftEdgeMask(maskConfig, resolvedPayload = undefined) {
    if (!maskConfig || !maskConfig.data) {
      return;
    }
    const width = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : this.width;
    const height = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : this.height;
    const payload = resolvedPayload !== undefined
      ? resolvedPayload
      : await resolveNumericBuffer(maskConfig.data);
    if (!payload || !payload.length) {
      return;
    }

    const expected = width * height;
    let working = payload;
    if (working.length !== expected) {
      diagnostics.warn('[goblet] Soft-edge mask payload length mismatch', {
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
    if (!hasAnyMaskValue(resized)) {
      diagnostics.warn('[goblet] Ignoring empty soft-edge mask', {
        layerId: this.layer?.id ?? null,
      });
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

    applySoftEdgeMaskToAlphaChannel(this.alpha, resized);
  }

  async applyWebGLAlphaMask(maskConfig, resolvedPayload = undefined) {
    if (!maskConfig || !maskConfig.data || !this.webglRenderer) {
      return;
    }
    const width = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : this.width;
    const height = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : this.height;
    const payload = resolvedPayload !== undefined
      ? resolvedPayload
      : await resolveNumericBuffer(maskConfig.data);
    if (!payload || !payload.length) {
      return;
    }
    const expected = width * height;
    let working = payload;
    if (working.length !== expected) {
      const normalized = new Uint8Array(expected);
      normalized.set(working.subarray(0, Math.min(working.length, normalized.length)));
      working = normalized;
    }
    const resized = resizeAlphaMaskBuffer(working, width, height, this.width, this.height);
    if (!resized || !resized.length) {
      return;
    }
    this.webglRenderer.setMaskTexture(resized, this.width, this.height);
  }

  async applyWebGLSoftEdgeMask(maskConfig, resolvedPayload = undefined) {
    if (!maskConfig || !maskConfig.data || !this.webglRenderer) {
      return;
    }
    const width = Number.isFinite(maskConfig.width) ? Math.max(1, Math.round(maskConfig.width)) : this.width;
    const height = Number.isFinite(maskConfig.height) ? Math.max(1, Math.round(maskConfig.height)) : this.height;
    const payload = resolvedPayload !== undefined
      ? resolvedPayload
      : await resolveNumericBuffer(maskConfig.data);
    if (!payload || !payload.length) {
      return;
    }
    const expected = width * height;
    let working = payload;
    if (working.length !== expected) {
      const normalized = new Uint8Array(expected);
      normalized.set(working.subarray(0, Math.min(working.length, normalized.length)));
      working = normalized;
    }
    const resized = resizeAlphaMaskBuffer(working, width, height, this.width, this.height);
    if (!resized || !resized.length) {
      return;
    }
    if (!hasAnyMaskValue(resized)) {
      diagnostics.warn('[goblet] Ignoring empty WebGL soft-edge mask', {
        layerId: this.layer?.id ?? null,
      });
      return;
    }
    this.webglRenderer.setSoftMaskTexture(resized, this.width, this.height);
  }

  async initializeBrushModeWebGL(colorCycle, brushState, resolvedPayloads = null) {
    if (!this.isGoblet2) {
      return false;
    }
    if (!brushState || !hasNumericPayload(brushState.indexBuffer)) {
      return false;
    }
    const speedMode = colorCycle?.speedMode === 'slot' ? 'slot' : colorCycle?.speedMode === 'buffer' ? 'buffer' : null;
    const slotSpeedMap = speedMode === 'slot' ? normalizeSlotSpeeds(colorCycle?.slotSpeeds) : null;
    if (speedMode !== 'buffer' && !slotSpeedMap) {
      return false;
    }
    if (speedMode === 'buffer' && !hasNumericPayload(brushState.speedBuffer)) {
      return false;
    }

    const sourceWidth = Math.max(1, Math.round(Number.isFinite(brushState.width) ? brushState.width : this.width));
    const sourceHeight = Math.max(1, Math.round(Number.isFinite(brushState.height) ? brushState.height : this.height));

    const rawIndexBuffer = await resolveGobletBrushBufferPayload(
      resolvedPayloads,
      'indexBuffer',
      brushState.indexBuffer
    );
    if (!rawIndexBuffer || rawIndexBuffer.length === 0) {
      return false;
    }

    const rawGradientIds = brushState.gradientIdBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'gradientIdBuffer', brushState.gradientIdBuffer)
      : null;
    const rawGradientDefIds = brushState.gradientDefIdBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'gradientDefIdBuffer', brushState.gradientDefIdBuffer)
      : null;
    const rawSpeedBuffer = brushState.speedBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'speedBuffer', brushState.speedBuffer)
      : null;
    const rawFlowBuffer = brushState.flowBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'flowBuffer', brushState.flowBuffer)
      : null;
    const rawPhaseBuffer = brushState.phaseBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'phaseBuffer', brushState.phaseBuffer)
      : null;

    const expectedLength = sourceWidth * sourceHeight;
    const clampBuffer = (buffer, fallbackValue = 0) => {
      const out = new Uint8Array(expectedLength);
      if (buffer && buffer.length > 0) {
        out.set(buffer.subarray(0, Math.min(buffer.length, out.length)));
      } else if (fallbackValue !== 0) {
        out.fill(fallbackValue);
      }
      return out;
    };

    const indexBuffer = clampBuffer(rawIndexBuffer);
    const gradientIdBuffer = clampBuffer(rawGradientIds);
    const gradientDefIdBuffer = new Uint16Array(expectedLength);
    if (rawGradientDefIds?.length) {
      gradientDefIdBuffer.set(rawGradientDefIds.subarray(0, Math.min(rawGradientDefIds.length, expectedLength)));
    }
    const flowBuffer = normalizeGobletFlowBuffer(rawFlowBuffer, rawGradientIds, expectedLength, FLOW_SLOT_BITS);
    const phaseBuffer = clampBuffer(rawPhaseBuffer);
    if (gradientIdBuffer) {
      if (!this.isGoblet2) {
        reconcileGradientIdSlotIndexing(indexBuffer, gradientIdBuffer, colorCycle?.slotPalettes);
      }
      for (let i = 0; i < gradientIdBuffer.length; i += 1) {
        gradientIdBuffer[i] = normalizeSlotId(gradientIdBuffer[i]);
      }
    }
    const shouldAnimate = colorCycle.isAnimating !== false;
    const resolvedBaseSpeed = resolveAnimationSpeed(
      brushState?.animationSpeed,
      colorCycle?.brushSpeed,
      shouldAnimate
    );
    const speedMin = toFiniteNumberOrNull(colorCycle.speedMin) ?? DEFAULT_SPEED_MIN;
    const speedMax = toFiniteNumberOrNull(colorCycle.speedMax) ?? DEFAULT_SPEED_MAX;
    const slotSpeedData = speedMode === 'slot'
      ? createSlotSpeedUniformData(slotSpeedMap, resolvedBaseSpeed)
      : null;
    const speedBuffer = speedMode === 'slot'
      ? new Uint8Array(expectedLength)
      : clampBuffer(rawSpeedBuffer);

    this.indexBuffer = indexBuffer;
    this.gradientIdBuffer = gradientIdBuffer;
    this.gradientDefIdBuffer = gradientDefIdBuffer;
    this.speedBuffer = speedBuffer;
    this.flowBuffer = flowBuffer;
    this.phaseBuffer = phaseBuffer;
    this.width = sourceWidth;
    this.height = sourceHeight;
    this.speedMode = speedMode;
    this.slotSpeeds = slotSpeedMap;
    this.slotSpeedData = slotSpeedData;

    const baseGradient = brushState.gradientStops?.length ? brushState.gradientStops : colorCycle.gradient;
    this.gradient = normalizeGradientStops(baseGradient);
    this.slotGradients = normalizeSlotPalettes(colorCycle.slotPalettes, this.gradient);
    this.slotSeamProfiles = normalizeSlotSeamProfiles(colorCycle.slotPalettes);
    const defPalettes = normalizeGradientDefPalettes(colorCycle.gradientDefStore);
    this.defGradients = defPalettes.gradients;
    this.defSeamProfiles = defPalettes.seamProfiles;
    this.cycleColors = DEFAULT_PALETTE_SIZE;
    this.mappingMode = 'continuous';
    this.flowMapping = 'palette';
    this.zeroTransparent = true;
    this.subtractIndexOffset = true;
    this.speedMin = speedMin;
    this.speedMax = speedMax;
    this.isAnimating = shouldAnimate;
    this.usePerPixelSpeed = true;
    this.hasNonZeroSpeedBuffer = speedMode === 'slot'
      ? hasNonZeroSlotSpeed(slotSpeedData)
      : hasAnyNonZeroSpeedByte(this.speedBuffer);

    const offset = Number.isFinite(brushState.animationOffset) ? brushState.animationOffset : 0;
    const exportedControllerSpeed = toFiniteNumberOrNull(brushState?.legacySpeedCps)
      ?? toFiniteNumberOrNull(colorCycle?.controllerSpeedCps);
    this.legacySpeedCps = Number.isFinite(exportedControllerSpeed)
      ? exportedControllerSpeed
      : resolveAnimationSpeed(
        brushState?.animationSpeed,
        colorCycle?.brushSpeed,
        shouldAnimate
      );
    if (!Number.isFinite(this.legacySpeedCps) || this.legacySpeedCps <= 0) {
      this.legacySpeedCps = shouldAnimate
        ? (this.layer?.colorCycle?.brushState?.animationSpeed ?? this.layer?.colorCycle?.brushSpeed ?? 0.1)
        : 0;
    }
    const alphaMode = typeof brushState.alphaMode === 'string' ? brushState.alphaMode : 'source';
    let effectiveAlphaMode = alphaMode;
    let alphaTexture = this.image ?? null;
    if (alphaMode !== 'opaque-indices') {
      const hasSourceAlpha = hasVisibleImageAlpha(alphaTexture, sourceWidth, sourceHeight);
      if (!hasSourceAlpha) {
        effectiveAlphaMode = 'opaque-indices';
        alphaTexture = null;
      }
    } else {
      alphaTexture = null;
    }

    this._webglInitAttempted = true;
    this._webglInitFailed = false;
    this._webglFallbackReason = null;
    let renderer = null;
    try {
      renderer = new BrushWebGLRenderer({
        width: sourceWidth,
        height: sourceHeight,
        paletteSize: DEFAULT_PALETTE_SIZE,
        speedMin: this.speedMin,
        speedMax: this.speedMax,
        startOffset01: wrap01(offset),
        alphaMode: effectiveAlphaMode
      });
      const paletteTable = buildPaletteTableRGBA(
        this.slotGradients,
        this.slotSeamProfiles,
        this.gradient,
        DEFAULT_PALETTE_SIZE,
        this.defGradients,
        this.defSeamProfiles,
      );
      const paletteRowBuffer = buildPaletteRowBuffer(
        gradientIdBuffer,
        gradientDefIdBuffer,
        paletteTable.defRowById,
        expectedLength,
      );
      renderer.setPalette(paletteTable.data, paletteTable.width, paletteTable.height);
      renderer.setSlotSpeeds(slotSpeedData);
      renderer.setBuffers(
        indexBuffer,
        gradientIdBuffer ?? new Uint8Array(expectedLength),
        paletteRowBuffer,
        speedBuffer ?? new Uint8Array(expectedLength),
        flowBuffer ?? new Uint8Array(expectedLength).fill(FLOW_MODE_FORWARD),
        phaseBuffer ?? new Uint8Array(expectedLength)
      );
      if (effectiveAlphaMode === 'opaque-indices') {
        renderer.setAlphaTexture(null);
      } else {
        renderer.setAlphaTexture(alphaTexture);
      }
      renderer.setMaskTexture(null);
      renderer.setSoftMaskTexture(null);
      this.webglRenderer = renderer;
      this.webglCanvas = renderer.canvas;
      this.canvas = renderer.canvas;
      this.useWebGL = true;
      this.renderScale = 1;
      this._adaptiveScaleEnabled = false;
      this.baseOffset = wrap01(offset);
      this.legacyOffset01 = this.baseOffset;
      this.baseTimeSeconds = 0;
      this.currentTick = this.baseOffset * this.cycleColors;
      return true;
    } catch (error) {
      diagnostics.warn('[goblet2] WebGL2 brush init failed, falling back to CPU', error);
      if (renderer) {
        try {
          renderer.destroy();
        } catch {
          // Preserve the original initialization failure while releasing what we can.
        }
      }
      this.webglRenderer = null;
      this.webglCanvas = null;
      this.useWebGL = false;
      this._webglInitFailed = true;
      this._webglFallbackReason = error instanceof Error ? error.message : String(error);
      this._adaptiveScaleEnabled = this._halfResPreference === null && matchesCoarsePointer();
      return false;
    }
  }

  async initializeBrushMode(colorCycle, brushState, { allowWebGL = true } = {}) {
    this.mode = 'brush';
    let resolvedPayloads = null;
    if (this.isGoblet2) {
      resolvedPayloads = await assertGobletBrushPayloadContract(colorCycle, brushState);
    }
    if (allowWebGL && await this.initializeBrushModeWebGL(colorCycle, brushState, resolvedPayloads)) {
      return resolvedPayloads;
    }
    const sourceWidth = Math.max(1, Math.round(Number.isFinite(brushState.width) ? brushState.width : this.width));
    const sourceHeight = Math.max(1, Math.round(Number.isFinite(brushState.height) ? brushState.height : this.height));
    const width = Math.max(1, Math.round(sourceWidth * this.renderScale));
    const height = Math.max(1, Math.round(sourceHeight * this.renderScale));
    if (width !== this.width || height !== this.height || this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
      this.createSurface(sourceWidth, sourceHeight);
    }

    const rawIndexBuffer = await resolveGobletBrushBufferPayload(
      resolvedPayloads,
      'indexBuffer',
      brushState.indexBuffer
    );
    const indexBuffer = this.renderScale === 1
      ? rawIndexBuffer
      : downsampleBuffer(rawIndexBuffer, sourceWidth, sourceHeight, width, height);
    if (!indexBuffer || indexBuffer.length === 0) {
      throw new Error('Brush state missing index buffer');
    }

    this.indexBuffer = indexBuffer;
    const gradientIdBuffer = brushState.gradientIdBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'gradientIdBuffer', brushState.gradientIdBuffer)
      : null;
    const resizedGradientIds = gradientIdBuffer && this.renderScale !== 1
      ? downsampleBuffer(gradientIdBuffer, sourceWidth, sourceHeight, width, height)
      : gradientIdBuffer;
    this.gradientIdBuffer = resizedGradientIds && resizedGradientIds.length ? resizedGradientIds : null;
    const gradientDefIdBuffer = brushState.gradientDefIdBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'gradientDefIdBuffer', brushState.gradientDefIdBuffer)
      : null;
    const resizedGradientDefIds = gradientDefIdBuffer && this.renderScale !== 1
      ? downsampleBuffer(gradientDefIdBuffer, sourceWidth, sourceHeight, width, height)
      : gradientDefIdBuffer;
    this.gradientDefIdBuffer = resizedGradientDefIds && resizedGradientDefIds.length
      ? resizedGradientDefIds
      : null;
    const speedBuffer = brushState.speedBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'speedBuffer', brushState.speedBuffer)
      : null;
    const resizedSpeedBuffer = speedBuffer && this.renderScale !== 1
      ? downsampleBuffer(speedBuffer, sourceWidth, sourceHeight, width, height)
      : speedBuffer;
    this.speedBuffer = resizedSpeedBuffer && resizedSpeedBuffer.length ? resizedSpeedBuffer : null;
    const flowBuffer = brushState.flowBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'flowBuffer', brushState.flowBuffer)
      : null;
    const resizedFlowBuffer = flowBuffer && this.renderScale !== 1
      ? downsampleBuffer(flowBuffer, sourceWidth, sourceHeight, width, height)
      : flowBuffer;
    this.flowBuffer = normalizeGobletFlowBuffer(resizedFlowBuffer, resizedGradientIds, width * height, FLOW_SLOT_BITS);
    const phaseBuffer = brushState.phaseBuffer
      ? await resolveGobletBrushBufferPayload(resolvedPayloads, 'phaseBuffer', brushState.phaseBuffer)
      : null;
    const resizedPhaseBuffer = phaseBuffer && this.renderScale !== 1
      ? downsampleBuffer(phaseBuffer, sourceWidth, sourceHeight, width, height)
      : phaseBuffer;
    this.phaseBuffer = resizedPhaseBuffer && resizedPhaseBuffer.length ? resizedPhaseBuffer : null;
    if (this.gradientIdBuffer) {
      if (!this.isGoblet2) {
        reconcileGradientIdSlotIndexing(this.indexBuffer, this.gradientIdBuffer, colorCycle?.slotPalettes);
      }
      for (let i = 0; i < this.gradientIdBuffer.length; i += 1) {
        this.gradientIdBuffer[i] = normalizeSlotId(this.gradientIdBuffer[i]);
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
    this.slotSeamProfiles = normalizeSlotSeamProfiles(colorCycle.slotPalettes);
    const defPalettes = normalizeGradientDefPalettes(colorCycle.gradientDefStore);
    this.defGradients = defPalettes.gradients;
    this.defSeamProfiles = defPalettes.seamProfiles;
    const explicitBufferMode = colorCycle?.speedMode === 'buffer';
    this.speedMode = explicitBufferMode ? 'buffer' : 'slot';
    this.slotSpeeds = !explicitBufferMode ? normalizeSlotSpeeds(colorCycle?.slotSpeeds) : null;
    if (!explicitBufferMode && this.slotSpeeds) {
      this.speedBuffer = null;
    } else if (!this.slotSpeeds && this.speedBuffer && this.speedMode === 'slot') {
      this.speedMode = 'buffer';
    }
    this.cycleColors = this.isGoblet2
      ? DEFAULT_PALETTE_SIZE
      : Math.max(1, Math.floor(Array.isArray(brushState.palette) && brushState.palette.length > 0 ? brushState.palette.length : 256));
    this.mappingMode = 'continuous';
    this.flowMapping = 'palette';
    this.zeroTransparent = true;
    this.subtractIndexOffset = true;

    const shouldAnimate = colorCycle.isAnimating !== false;
    const exportedControllerSpeed = toFiniteNumberOrNull(brushState?.legacySpeedCps)
      ?? toFiniteNumberOrNull(colorCycle?.controllerSpeedCps);
    const resolvedSpeed = resolveAnimationSpeed(
      brushState?.animationSpeed,
      colorCycle?.brushSpeed,
      shouldAnimate
    );
    this.speed = resolvedSpeed;
    this.legacySpeedCps = Number.isFinite(exportedControllerSpeed)
      ? exportedControllerSpeed
      : resolvedSpeed;
    if (!Number.isFinite(this.legacySpeedCps) || this.legacySpeedCps <= 0) {
      const fallback = resolveAnimationSpeed(
        brushState?.animationSpeed,
        colorCycle?.brushSpeed,
        shouldAnimate
      );
      this.legacySpeedCps = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_ANIMATION_SPEED;
    }
    if (this.isGoblet2 && this.speedMode === 'buffer') {
      this.speed = 0;
    }
    const offset = Number.isFinite(brushState.animationOffset) ? brushState.animationOffset : 0;
    this.baseOffset = wrap01(offset);
    this.legacyOffset01 = this.baseOffset;
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
    if (this.gradientDefIdBuffer && this.gradientDefIdBuffer.length !== expectedLength) {
      const resized = new Uint16Array(expectedLength);
      resized.set(this.gradientDefIdBuffer.subarray(0, Math.min(expectedLength, this.gradientDefIdBuffer.length)));
      this.gradientDefIdBuffer = resized;
    }
    if (this.speedBuffer && this.speedBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.speedBuffer.subarray(0, Math.min(expectedLength, this.speedBuffer.length)));
      this.speedBuffer = resized;
    }
    if (this.flowBuffer && this.flowBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.fill(FLOW_MODE_FORWARD);
      resized.set(this.flowBuffer.subarray(0, Math.min(expectedLength, this.flowBuffer.length)));
      this.flowBuffer = resized;
    }
    if (this.phaseBuffer && this.phaseBuffer.length !== expectedLength) {
      const resized = new Uint8Array(expectedLength);
      resized.set(this.phaseBuffer.subarray(0, Math.min(expectedLength, this.phaseBuffer.length)));
      this.phaseBuffer = resized;
    }
    this.slotSpeedData = this.speedMode === 'slot'
      ? createSlotSpeedUniformData(this.slotSpeeds, this.legacySpeedCps)
      : null;
    this.usePerPixelSpeed = this.speedMode === 'buffer' && Boolean(this.speedBuffer && this.speedBuffer.length === expectedLength);
    this.hasNonZeroSpeedBuffer = this.speedMode === 'slot'
      ? hasNonZeroSlotSpeed(this.slotSpeedData)
      : this.speedMode === 'buffer' && hasAnyNonZeroSpeedByte(this.speedBuffer);
    this._distinctSpeedBytes = this.speedMode === 'buffer' ? collectDistinctSpeedBytes(this.speedBuffer) : null;
    this._usedSlots = collectDistinctSlots(this.gradientIdBuffer);
    this._lutCacheBase.clear();
    this._lutCacheSlots.clear();
    this._lutCacheBands = null;
    this._basePalette32BySlot.clear();
    this._basePalette32ByDefId.clear();
    this._basePaletteSize = this.cycleColors | 0;
    const explicitPalette32 = buildDiscretePalette32FromExplicitPalette(
      brushState.palette,
      this._basePaletteSize
    );
    this._fallbackPalette32 = explicitPalette32 ?? buildDiscretePalette32FromGradient(this.gradient, this._basePaletteSize);
    this._basePalette32BySlot.set(0, this._fallbackPalette32);
    if (this.slotGradients && this.slotGradients.size > 0) {
      this.slotGradients.forEach((stops, slot) => {
        const seamProfile = this.slotSeamProfiles?.get(slot);
        this._basePalette32BySlot.set(
          slot & FLOW_SLOT_MASK,
          buildDiscretePalette32FromGradient(stops, this._basePaletteSize, seamProfile)
        );
      });
    }
    if (this.defGradients && this.defGradients.size > 0) {
      this.defGradients.forEach((stops, defId) => {
        const seamProfile = this.defSeamProfiles?.get(defId);
        this._basePalette32ByDefId.set(
          defId,
          buildDiscretePalette32FromGradient(stops, this._basePaletteSize, seamProfile)
        );
      });
    }
    this._fractionalLutsBySlot.clear();
    this._basePalette32BySlot.forEach((_palette, slot) => {
      this._fractionalLutsBySlot.set(slot, new Uint32Array(256));
    });
    return resolvedPayloads;
  }

  async initializeRecolorMode(colorCycle, recolorSettings) {
    this.mode = colorCycle.mode ?? 'recolor';
    this.gradientDefIdBuffer = null;
    this.defGradients = null;
    this.defSeamProfiles = null;
    this._basePalette32ByDefId.clear();
    const sourceWidth = Math.max(
      1,
      Math.round(Number.isFinite(recolorSettings?.width) ? recolorSettings.width : this.canvas.width)
    );
    const sourceHeight = Math.max(
      1,
      Math.round(Number.isFinite(recolorSettings?.height) ? recolorSettings.height : this.canvas.height)
    );
    const width = Math.max(1, Math.round(sourceWidth * this.renderScale));
    const height = Math.max(1, Math.round(sourceHeight * this.renderScale));
    if (width !== this.width || height !== this.height || this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
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
    this.legacySpeedCps = 0;
    this.legacyOffset01 = 0;
    this.currentTick = Number.isFinite(animation.currentTick) ? animation.currentTick : 0;
    this.flowDirection = normalizeFlowDirection(animation.flowDirection, 'forward');
    this.isAnimating = shouldAnimate;
    this._basePalette32BySlot.clear();
    this._basePaletteSize = this.cycleColors | 0;
    this._fallbackPalette32 = buildDiscretePalette32FromGradient(this.gradient, this._basePaletteSize);
    this._basePalette32BySlot.set(0, this._fallbackPalette32);
  }

  hasAnimation() {
    if (!this.isAnimating || this.cycleColors <= 0) {
      return false;
    }
    if (!this._hasVisibleAlpha) {
      return false;
    }
    if (this.speedMode === 'slot') {
      return this.hasNonZeroSpeedBuffer;
    }
    if (this.usePerPixelSpeed) {
      return (this.legacySpeedCps ?? 0) > 0 || this.hasNonZeroSpeedBuffer;
    }
    return (this.legacySpeedCps ?? 0) > 0 || this.speed > 0;
  }

  advance(deltaSeconds) {
    if (this._destroyed || this._isReinitializing || !this.hasAnimation()) {
      return false;
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this._lastFps = 1 / deltaSeconds;
    }
    this._lastDeltaSeconds = deltaSeconds;
    this.baseTimeSeconds += deltaSeconds;
    this.legacyOffset01 = wrap01(this.legacyOffset01 + deltaSeconds * (this.legacySpeedCps || 0));
    this.renderFrame();
    return true;
  }

  renderFrame() {
    if (!this.indexBuffer) {
      return;
    }
    this._lastCpuFillMs = 0;
    this._lastCpuBlitMs = 0;
    if (this.useWebGL && this.webglRenderer) {
      this._lastRenderPath = 'webgl';
      this.webglRenderer.render(this.baseTimeSeconds, this.legacyOffset01);
      return;
    }
    this._lastRenderPath = 'cpu';
    const nowMs = profileNow();
    let fillMs = 0;
    let usePerPixelPath = this.usePerPixelSpeed && this.speedBuffer && (this.flowMapping === 'palette' || !this.phaseMap);
    if (usePerPixelPath) {
      const n = this._basePaletteSize || (this.cycleColors | 0) || 1;
      const fillStart = profileNow();
      fillPixelsFromIndicesWithFractionalSpeedFlowPhase(
        this.indexBuffer,
        this.gradientIdBuffer,
        this.gradientDefIdBuffer,
        this.speedBuffer,
        this.flowBuffer,
        this.phaseBuffer,
        this._basePalette32BySlot,
        this._basePalette32ByDefId,
        this._fallbackPalette32 ?? this._basePalette32BySlot.get(0),
        this.pixels32,
        this.alpha,
        {
          paletteSize: n,
          speedMin: this.speedMin,
          speedMax: this.speedMax,
          timeSeconds: this.baseTimeSeconds,
          defaultSpeed: Number.isFinite(this.speed) ? this.speed : 0,
          legacyOffset01: this.legacyOffset01
        },
        {
          transparentZero: this.zeroTransparent,
          subtractOne: this.subtractIndexOffset
        }
      );
      const fillEnd = profileNow();
      fillMs = fillEnd - fillStart;
      const blitStart = fillEnd;
      this.ctx.putImageData(this.imageData, 0, 0);
      if (this.renderScale !== 1 && this.outputCtx && this.renderCanvas) {
        this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.outputCtx.drawImage(this.renderCanvas, 0, 0, this.canvas.width, this.canvas.height);
      }
      this._lastCpuFillMs = fillMs;
      this._lastCpuBlitMs = profileNow() - blitStart;
      this.maybeAdjustRenderScale(nowMs, fillMs);
      return;
    }

    const speed = Number.isFinite(this.speed) ? this.speed : 0;
    const slotSpeedMap = this.slotSpeeds;
    const baseSpeed = Number.isFinite(slotSpeedMap?.get(0)) ? slotSpeedMap.get(0) : speed;
    const n = this._basePaletteSize || (this.cycleColors | 0) || 1;
    const canUseSlots = this.gradientIdBuffer && this.slotGradients && this.slotGradients.size > 0;
    if (this.flowMapping === 'palette' || !this.phaseMap) {
      const needsPerPixelFractional = this._basePalette32ByDefId.size > 0
        || hasAnyNonZeroByte(this.phaseBuffer)
        || hasGobletNonForwardFlow(this.flowBuffer);
      if (needsPerPixelFractional) {
        const fillStart = profileNow();
        fillPixelsFromIndicesWithFractionalSlotSpeeds(
          this.indexBuffer,
          this.gradientIdBuffer,
          this.gradientDefIdBuffer,
          slotSpeedMap,
          this.flowBuffer,
          this.phaseBuffer,
          this._basePalette32BySlot,
          this._basePalette32ByDefId,
          this._fallbackPalette32 ?? this._basePalette32BySlot.get(0),
          this.pixels32,
          this.alpha,
          {
            paletteSize: n,
            timeSeconds: this.baseTimeSeconds,
            defaultSpeed: baseSpeed,
            legacyOffset01: this.legacyOffset01
          },
          {
            transparentZero: this.zeroTransparent,
            subtractOne: this.subtractIndexOffset
          }
        );
        const fillEnd = profileNow();
        fillMs = fillEnd - fillStart;
      } else {
        const fillStart = profileNow();
        const baseOffset01 = (((this.baseTimeSeconds * baseSpeed) % 1) + 1) % 1;
        const basePal = this._fallbackPalette32 ?? this._basePalette32BySlot.get(0);
        const baseLut = buildPaletteFractionalShiftLUT256({
          basePalette32: basePal,
          cycleColors: this.cycleColors,
          offset01: baseOffset01
        }, this._fractionalBaseLut);
        if (canUseSlots) {
          const lutsBySlot = this._fractionalLutsBySlot;
          this._basePalette32BySlot.forEach((pal, slot) => {
            const slotSpeed = Number.isFinite(slotSpeedMap?.get(slot)) ? slotSpeedMap.get(slot) : baseSpeed;
            const slotOffset = (((this.baseTimeSeconds * (slotSpeed ?? 0)) % 1) + 1) % 1;
            let slotLut = lutsBySlot.get(slot);
            if (!slotLut) {
              slotLut = new Uint32Array(256);
              lutsBySlot.set(slot, slotLut);
            }
            buildPaletteFractionalShiftLUT256({
              basePalette32: pal,
              cycleColors: this.cycleColors,
              offset01: slotOffset
            }, slotLut);
          });
          fillPixelsFromIndicesWithGradientIds(
            this.indexBuffer,
            this.gradientIdBuffer,
            lutsBySlot,
            baseLut,
            this.pixels32,
            this.alpha,
            {
              transparentZero: this.zeroTransparent,
              subtractOne: this.subtractIndexOffset
            }
          );
        } else {
          fillPixelsFromIndices(this.indexBuffer, baseLut, this.pixels32, this.alpha, {
            transparentZero: this.zeroTransparent,
            subtractOne: this.subtractIndexOffset
          });
        }
        const fillEnd = profileNow();
        fillMs = fillEnd - fillStart;
      }
    } else {
      const offset01 = (((this.baseTimeSeconds * baseSpeed) % 1) + 1) % 1;
      const basePal = this._fallbackPalette32 ?? this._basePalette32BySlot.get(0);
      const baseLut = buildPaletteShiftLUT256({
        basePalette32: basePal,
        cycleColors: this.cycleColors,
        offset01
      });
      const fillStart = profileNow();
      fillPixelsFromPhaseMap(this.phaseMap, baseLut, this.pixels32, this.alpha);
      const fillEnd = profileNow();
      fillMs = fillEnd - fillStart;
    }
    const blitStart = profileNow();
    this.ctx.putImageData(this.imageData, 0, 0);
    if (this.renderScale !== 1 && this.outputCtx && this.renderCanvas) {
      this.outputCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.outputCtx.drawImage(this.renderCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
    this._lastCpuFillMs = fillMs;
    this._lastCpuBlitMs = profileNow() - blitStart;
    this.maybeAdjustRenderScale(nowMs, fillMs);
  }

  maybeAdjustRenderScale(nowMs, fillMs) {
    if (!this._adaptiveScaleEnabled || this._destroyed || this._isReinitializing) {
      return;
    }
    if (!Number.isFinite(nowMs)) {
      return;
    }
    if (!this._fillWindowStartMs) {
      this._fillWindowStartMs = nowMs;
      this._fillMsAccum = 0;
      this._fillWindowFrames = 0;
    }
    if (Number.isFinite(fillMs) && fillMs > 0) {
      this._fillMsAccum += fillMs;
    }
    this._fillWindowFrames += 1;
    const elapsedWindowMs = nowMs - this._fillWindowStartMs;
    if (elapsedWindowMs < 1000) {
      return;
    }
    const averageFillMs = this._fillWindowFrames > 0
      ? this._fillMsAccum / this._fillWindowFrames
      : 0;
    const observedFps = elapsedWindowMs > 0
      ? this._fillWindowFrames * 1000 / elapsedWindowMs
      : 0;
    const slowWindow = averageFillMs > 20 || observedFps < 45;
    const fastWindow = averageFillMs < 12 && observedFps > 55;
    let nextScale = this.renderScale;
    let transitionReason = null;
    if (this.renderScale === 1) {
      this._slowWindowCount = slowWindow ? this._slowWindowCount + 1 : 0;
      this._fastWindowCount = 0;
      if (this._slowWindowCount >= 3) {
        nextScale = 0.5;
        transitionReason = 'three-slow-windows';
      }
    } else {
      this._fastWindowCount = fastWindow ? this._fastWindowCount + 1 : 0;
      this._slowWindowCount = 0;
      if (this._fastWindowCount >= 5) {
        nextScale = 1;
        transitionReason = 'five-fast-windows';
      }
    }
    this.resetAdaptiveWindow(nowMs);
    const cooldownElapsed = nowMs - this._lastScaleTransitionMs >= 30_000;
    if (nextScale !== this.renderScale && cooldownElapsed && !this._scaleTransitionPromise) {
      this._scaleTransitionPromise = this.applyRenderScale(nextScale, transitionReason)
        .finally(() => {
          this._scaleTransitionPromise = null;
        });
    }
  }

  resetAdaptiveWindow(nowMs = 0) {
    this._fillWindowStartMs = Number.isFinite(nowMs) ? nowMs : 0;
    this._fillMsAccum = 0;
    this._fillWindowFrames = 0;
  }

  resetAdaptiveMeasurement(nowMs = 0) {
    this.resetAdaptiveWindow(nowMs);
    this._slowWindowCount = 0;
    this._fastWindowCount = 0;
  }

  async applyRenderScale(nextScale, reason = 'adaptive') {
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return false;
    }
    if (this._destroyed || this.renderScale === nextScale || this._isReinitializing) {
      return false;
    }
    const clamped = nextScale >= 1 ? 1 : 0.5;
    const previousScale = this.renderScale;
    const prevBaseTime = this.baseTimeSeconds;
    const prevTick = this.currentTick;
    const prevAnimating = this.isAnimating;
    const prevLegacyOffset01 = this.legacyOffset01;
    const prevLegacySpeedCps = this.legacySpeedCps;
    const lifecycleVersion = ++this._lifecycleVersion;
    this.renderScale = clamped;
    this._isReinitializing = true;
    this.options?.onAnimationEligibilityChange?.();
    try {
      await this.initialize({ allowWebGL: false });
      if (this._destroyed || lifecycleVersion !== this._lifecycleVersion) {
        return false;
      }
      this.baseTimeSeconds = prevBaseTime;
      this.currentTick = prevTick;
      this.isAnimating = prevAnimating;
      this.legacyOffset01 = prevLegacyOffset01;
      this.legacySpeedCps = prevLegacySpeedCps;
      this.renderFrame();
      this._lastScaleTransitionMs = profileNow();
      this._lastScaleTransitionReason = reason;
      return true;
    } catch (error) {
      this._adaptiveScaleEnabled = false;
      this.renderScale = previousScale;
      diagnostics.warn('[goblet2] Adaptive CPU scale transition failed; disabling adaptation', {
        layerId: this.layer?.id ?? null,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!this._destroyed && lifecycleVersion === this._lifecycleVersion) {
        try {
          await this.initialize({ allowWebGL: false });
          this.baseTimeSeconds = prevBaseTime;
          this.currentTick = prevTick;
          this.isAnimating = prevAnimating;
          this.legacyOffset01 = prevLegacyOffset01;
          this.legacySpeedCps = prevLegacySpeedCps;
          this.renderFrame();
        } catch (recoveryError) {
          this.isAnimating = false;
          diagnostics.warn('[goblet2] Failed to restore CPU player after adaptive scale failure', {
            layerId: this.layer?.id ?? null,
            error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          });
        }
      }
      return false;
    } finally {
      this._isReinitializing = false;
      this.resetAdaptiveMeasurement();
      this.options?.onAnimationEligibilityChange?.();
    }
  }

  getCanvas() {
    return this.canvas;
  }

  destroy() {
    this._destroyed = true;
    this._lifecycleVersion += 1;
    this.isAnimating = false;
    this.indexBuffer = null;
    this.gradientIdBuffer = null;
    this.gradientDefIdBuffer = null;
    this.speedBuffer = null;
    this.flowBuffer = null;
    this.phaseBuffer = null;
    this.indexPhaseMap = null;
    this.phaseMap = null;
    this.alpha = null;
    this.baseImageData = null;
    this.slotGradients = null;
    this.slotSeamProfiles = null;
    this.defGradients = null;
    this.defSeamProfiles = null;
    this._fallbackPalette32 = null;
    this._basePalette32ByDefId.clear();
    this._fractionalLutsBySlot.clear();
    if (this.webglRenderer) {
      this.webglRenderer.destroy();
      this.webglRenderer = null;
    }
    this.webglCanvas = null;
  }
}

// ------------------------------------------------------------
// Vessel viewer core
// ------------------------------------------------------------
const RENDERER_KEY = Symbol('VesselRenderer');
const ACTIVE_CANVASES = new Map();
let resizeListenerAttached = false;
let resizeTrailingTimer = null;
const POINTER_GUARD_EVENTS = ['mouseenter', 'mousemove', 'pointerdown', 'pointerup', 'focus'];
const MAX_MOBILE_FIXED_DPR = 2;
const MAX_MOBILE_FIXED_BACKING_PIXELS = 4_194_304;
const RESIZE_TRAILING_MS = 150;
const PROFILE_SAMPLE_CAPACITY = 120;

const getRawDevicePixelRatio = () => {
  const raw = typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

const resolveFixedDpr = (cssWidth, cssHeight) => {
  const rawDpr = getRawDevicePixelRatio();
  if (!matchesCoarsePointer()) {
    return { rawDpr, effectiveDpr: rawDpr, isMobileCapped: false };
  }
  const safeWidth = Math.max(1, Number(cssWidth) || 1);
  const safeHeight = Math.max(1, Number(cssHeight) || 1);
  const pixelBudgetDpr = Math.sqrt(MAX_MOBILE_FIXED_BACKING_PIXELS / (safeWidth * safeHeight));
  const effectiveDpr = Math.max(
    Number.EPSILON,
    Math.min(rawDpr, MAX_MOBILE_FIXED_DPR, pixelBudgetDpr),
  );
  return {
    rawDpr,
    effectiveDpr,
    isMobileCapped: effectiveDpr < rawDpr,
  };
};

const createFrameProfileState = () => ({
  cursor: 0,
  count: 0,
  totalFrames: 0,
  totalMs: new Float32Array(PROFILE_SAMPLE_CAPACITY),
  cpuFillMs: new Float32Array(PROFILE_SAMPLE_CAPACITY),
  cpuBlitMs: new Float32Array(PROFILE_SAMPLE_CAPACITY),
  compositeMs: new Float32Array(PROFILE_SAMPLE_CAPACITY),
  filterMs: new Float32Array(PROFILE_SAMPLE_CAPACITY),
  fps: new Float32Array(PROFILE_SAMPLE_CAPACITY),
});

const recordFrameProfile = (
  state,
  totalMs,
  cpuFillMs,
  cpuBlitMs,
  compositeMs,
  filterMs,
  fps,
) => {
  const index = state.cursor;
  state.totalMs[index] = totalMs;
  state.cpuFillMs[index] = cpuFillMs;
  state.cpuBlitMs[index] = cpuBlitMs;
  state.compositeMs[index] = compositeMs;
  state.filterMs[index] = filterMs;
  state.fps[index] = fps;
  state.cursor = (index + 1) % PROFILE_SAMPLE_CAPACITY;
  state.count = Math.min(PROFILE_SAMPLE_CAPACITY, state.count + 1);
  state.totalFrames += 1;
};

const summarizeProfileValues = (values, count) => {
  if (!count) {
    return { samples: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = Array.from(values.subarray(0, count)).sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  return {
    samples: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
  };
};

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
    this.sortedLayerEntries = [];
    this.staticLayerEntries = [];
    this.dynamicLayerEntries = [];
    this.dynamicPlayers = [];
    this.dynamicPlayerSet = new Set();
    this.interlaceGroups = [];
    this.interlaceLayerIdSet = new Set();
    this.interlaceElapsedSeconds = 0;
    this.interlaceScratch = new Map();
    this.canUseStaticComposite = false;
    this.staticCompositeLayerKey = '';
    this.staticCompositeCanvas = null;
    this.staticCompositeCtx = null;
    this.staticCompositeKey = '';
    this.displayFilterState = createDisplayFilterPipelineState();
    this.rafId = null;
    this.isAnimationLoopActive = false;
    this.lastTimestamp = 0;
    this.lastCcReasonLogAt = 0;
    this.rawDpr = getRawDevicePixelRatio();
    this.effectiveDpr = this.rawDpr;
    this.isMobileDprCapped = false;
    this.isDocumentVisible = typeof document === 'undefined' || !document.hidden;
    this.isCanvasIntersecting = true;
    this.intersectionObserver = null;
    this.resizeFlushCount = 0;
    this.renderProfile = {
      enabled: false,
      now: profileNow,
      staticMs: 0,
      dynamicMs: 0,
      filterMs: 0,
      blitMs: 0,
    };
    this.lastRenderProfile = {
      staticMs: 0,
      dynamicMs: 0,
      filterMs: 0,
      blitMs: 0,
    };
    this.hasLastRenderProfile = false;
    this.frameProfile = null;
    this.destroyed = false;

    this.summary = {
      viewport: metadata.viewport,
      animation: metadata.animation,
      layers: metadata.layers.length,
      scale: { ...this.scale }
    };

    this.handleAnimationFrame = this.handleAnimationFrame.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleIntersectionChange = this.handleIntersectionChange.bind(this);
  }

  getLayerAnimationReasonRow(entry) {
    const layer = entry.layer;
    const isColorCycleLayer = Boolean(layer?.colorCycle)
      || layer?.type === 'color-cycle'
      || layer?.layerType === 'color-cycle';

    if (!isColorCycleLayer) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode: null,
        visible: layer?.visible !== false,
        status: 'static',
        reason: 'not-color-cycle'
      };
    }

    const player = entry.player;
    const mode = player?.mode ?? layer?.colorCycle?.mode ?? 'brush';

    if (layer?.visible === false) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: false,
        status: 'static',
        reason: 'layer-hidden'
      };
    }

    if (!player) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: true,
        status: 'static',
        reason: 'missing-cc-player'
      };
    }

    if (player.isAnimating === false) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: true,
        status: 'static',
        reason: 'layer-isAnimating-false'
      };
    }

    if (mode === 'brush' && player.speedMode === 'buffer' && player.hasNonZeroSpeedBuffer === false) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: true,
        status: 'static',
        reason: 'speedBuffer-all-zero'
      };
    }

    if (mode === 'recolor' && !(player.cycleColors > 0)) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: true,
        status: 'static',
        reason: 'recolor-cycle-colors-empty'
      };
    }

    if (typeof player.hasAnimation === 'function' && !player.hasAnimation()) {
      return {
        id: layer?.id ?? null,
        name: layer?.name ?? null,
        mode,
        visible: true,
        status: 'static',
        reason: 'hasAnimation=false'
      };
    }

    return {
      id: layer?.id ?? null,
      name: layer?.name ?? null,
      mode,
      visible: true,
      status: 'animating',
      reason: mode === 'recolor' ? 'recolor-playing' : 'brush-playing'
    };
  }

  logLayerAnimationReasons(entries) {
    if (!__DEV__ || !ccLayerDebugOn()) {
      return;
    }
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (now - this.lastCcReasonLogAt < 400) {
      return;
    }
    this.lastCcReasonLogAt = now;
    const rows = entries.map((entry) => this.getLayerAnimationReasonRow(entry));
    if (rows.length === 0) {
      return;
    }
    try {
      console.groupCollapsed('[CC] Goblet layer animation reasons');
      console.table(rows);
      console.groupEnd();
    } catch {
      console.log('[CC] Goblet layer animation reasons', rows);
    }
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
          player = new ColorCycleLayerPlayer(layerClone, source, {
            format: this.metadata?.format,
            schemaVersion: this.metadata?.colorCycle?.schemaVersion,
            onAnimationEligibilityChange: () => this.reconcileAnimationLoop(),
          });
          await player.initialize();
          source = player.getCanvas();
        } catch (error) {
          if (isGobletPayloadContractError(error)) {
            throw error;
          }
          console.error('[goblet2] CC init failed', layerClone.id, error);
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
    this.sortedLayerEntries = [...entries];
    this.sortedLayerEntries.sort((a, b) => {
      const originalA = entries.indexOf(a);
      const originalB = entries.indexOf(b);
      const ai = typeof a.layer.stackIndex === 'number' ? a.layer.stackIndex : originalA;
      const bi = typeof b.layer.stackIndex === 'number' ? b.layer.stackIndex : originalB;
      if (ai !== bi) {
        return ai - bi;
      }
      return originalA - originalB;
    });
    this.dynamicPlayers = entries
      .filter((entry) => entry.layer.visible !== false)
      .flatMap((entry) => [entry.player, entry.sequentialPlayer])
      .filter((entryPlayer) => entryPlayer && typeof entryPlayer.hasAnimation === 'function' && entryPlayer.hasAnimation());
    const entryById = new Map(entries.map((entry) => [entry.layer.id, entry]));
    this.interlaceGroups = (Array.isArray(this.metadata?.interlaceGroups) ? this.metadata.interlaceGroups : [])
      .map((group) => ({
        ...group,
        entries: (Array.isArray(group?.layerIds) ? group.layerIds : [])
          .map((id) => entryById.get(id))
          .filter((entry) => entry?.layer?.visible !== false),
      }))
      .filter((group) => group.entries.length >= 2);
    this.interlaceLayerIdSet = new Set(
      this.interlaceGroups.flatMap((group) => group.entries.map((entry) => entry.layer.id)),
    );
    if (this.interlaceGroups.length > 0) {
      this.dynamicPlayers.push({
        hasAnimation: () => true,
        advance: (delta) => {
          if (Number.isFinite(delta) && delta > 0 && delta < 1) this.interlaceElapsedSeconds += delta;
          return true;
        },
        destroy: () => {},
      });
    }
    this.dynamicPlayerSet = new Set(this.dynamicPlayers);
    this.dynamicLayerEntries = this.sortedLayerEntries.filter((entry) => (
      entry.layer.visible !== false && this.isDynamicEntry(entry)
    ));
    this.staticLayerEntries = this.sortedLayerEntries.filter((entry) => (
      entry.layer.visible !== false && !this.isDynamicEntry(entry)
    ));
    const staticLayersRequireBackdrop = this.staticLayerEntries.some((entry) => (
      (entry.layer.blendMode ?? 'source-over') !== 'source-over'
    ));
    let seenDynamicLayer = false;
    this.canUseStaticComposite = !staticLayersRequireBackdrop;
    for (const entry of this.sortedLayerEntries) {
      if (entry.layer.visible === false) {
        continue;
      }
      if (this.isDynamicEntry(entry)) {
        seenDynamicLayer = true;
        continue;
      }
      if (seenDynamicLayer) {
        this.canUseStaticComposite = false;
        break;
      }
    }
    if (this.interlaceGroups.length > 0) this.canUseStaticComposite = false;
    this.staticCompositeLayerKey = JSON.stringify(this.staticLayerEntries.map((entry) => [
      entry.layer.id,
      entry.layer.stackIndex,
      entry.layer.visible,
      entry.layer.opacity,
      entry.layer.blendMode,
      entry.layer.alignment,
      entry.layer.documentBoundsPx,
      entry.layer.contentBounds,
      entry.layer.pixelBoundsPx,
    ]));
    this.staticCompositeCanvas = null;
    this.staticCompositeCtx = null;
    this.staticCompositeKey = '';

    if (diagnosticsEnabled) {
      for (const entry of entries) {
        if (!entry.layer?.colorCycle) {
          continue;
        }
        const player = entry.player;
        diagnostics.log(
          '[goblet2][cc]',
          JSON.stringify({
            layerId: entry.layer?.id ?? null,
            playerCreated: !!player,
            initOk: !!player && !!player.indexBuffer,
            hasAnimation: (typeof player?.hasAnimation === 'function') ? player.hasAnimation() : null,
            mode: player?.mode ?? null,
            isAnimating: player?.isAnimating ?? null,
            usePerPixelSpeed: player?.usePerPixelSpeed ?? null,
            hasSpeedBuffer: !!player?.speedBuffer,
            hasFlowBuffer: !!player?.flowBuffer,
            hasPhaseBuffer: !!player?.phaseBuffer,
            hasNonZeroSpeedBuffer: player?.hasNonZeroSpeedBuffer ?? null,
            speed: Number.isFinite(player?.speed) ? player.speed : null,
            legacySpeedCps: Number.isFinite(player?.legacySpeedCps) ? player.legacySpeedCps : null,
            cycleColors: Number.isFinite(player?.cycleColors) ? player.cycleColors : null,
            indexLen: player?.indexBuffer?.length ?? null,
            gidLen: player?.gradientIdBuffer?.length ?? null,
            speedLen: player?.speedBuffer?.length ?? null,
            flowLen: player?.flowBuffer?.length ?? null,
            phaseLen: player?.phaseBuffer?.length ?? null
          })
        );
      }
    }

    const textureless = entries
      .filter((entry) => entry.layer.visible !== false)
      .filter((entry) => !entry.source && !entry.player && !entry.sequentialPlayer);
    if (textureless.length > 0) {
      diagnostics.warn('Some layers are missing textures', textureless.map((entry) => entry.layer.id));
    }
  }

  isDynamicEntry(entry) {
    return this.dynamicPlayerSet.has(entry?.player) || this.dynamicPlayerSet.has(entry?.sequentialPlayer);
  }

  paintLayerEntry(entry, index, renderCtx, renderOptions) {
    const {
      documentSize,
      viewportSize,
      designSize,
      isFixed,
      shouldFilterArtwork,
      dpr,
    } = renderOptions;
    if (diagnosticsEnabled) {
      diagnostics.log(`[goblet] Processing layer ${index}:`, entry.layer.id);
    }
    if (entry.layer.visible === false) {
      if (diagnosticsEnabled) {
        diagnostics.log(`[goblet] Skipping invisible layer ${entry.layer.id}`);
      }
      return false;
    }
    const source = entry.player
      ? entry.player.getCanvas()
      : (entry.sequentialPlayer ? entry.sequentialPlayer.getSource() : entry.source);
    if (!source) {
      if (diagnosticsEnabled) {
        diagnostics.log(`[goblet] No source for layer ${entry.layer.id}`);
      }
      return false;
    }
    if (diagnosticsEnabled) {
      diagnostics.log(`[goblet] Have source for ${entry.layer.id}, computing placement`);
    }
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
    const sourceMatchesDocument = Math.abs(sourceWidth - documentSize.width) <= 0.5
      && Math.abs(sourceHeight - documentSize.height) <= 0.5;

    const tinyContentBounds = Boolean(
      normalizedContentBounds
      && normalizedContentBounds.width <= 1.5
      && normalizedContentBounds.height <= 1.5
      && (sourceWidth > 2 || sourceHeight > 2)
    );
    const shouldPreferDocumentRect = Boolean(
      paintedRectFromDocument
      && (
        (isFixed && sourceMatchesDocument)
        || (isColorCycleLayer && sourceMatchesDocument && (!normalizedContentBounds || isFullSurfaceRect(normalizedContentBounds)))
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

    const directFixedPlacement = isFixed && entry.layer.documentBoundsPx
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

    let units = null;
    let destForLog = null;
    if (diagnosticsEnabled) {
      units = isFixed ? 'backing' : 'css';
      destForLog = (() => {
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
    }

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
        isFixed,
        dpr,
        paintedRect,
        fit: directFixedPlacement ? 'none' : align.fit
      }
    );

    if (!drawResult.ok) {
      renderCtx.restore();
      if (diagnosticsEnabled) {
        diagnostics.log(`[goblet] Failed to paint layer ${entry.layer.id}`);
      }
      return false;
    }

    if (diagnosticsEnabled) {
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
    }

    renderCtx.restore();
    return true;
  }

  paintInterlaceGroup(group, renderCtx, renderOptions) {
    const settings = group?.settings ?? {};
    const documentWidth = Math.max(1, Math.round(renderOptions.documentSize.width));
    const documentHeight = Math.max(1, Math.round(renderOptions.documentSize.height));
    const cellSize = Math.max(2, Math.min(128, Math.round(Number(settings.cellSize) || 10)));
    const gridWidth = Math.ceil(documentWidth / cellSize);
    const gridHeight = Math.ceil(documentHeight / cellSize);
    const frame = resolveInterlaceFrame({
      elapsedSeconds: this.interlaceElapsedSeconds,
      sourceCount: group.entries.length,
      loopDurationSeconds: Number(settings.loopDurationSeconds) || 10,
      dominance: Number(settings.dominance) || 0.92,
      direction: settings.direction === 'left' ? 'left' : 'right',
      travelCycles: Number(settings.travelCycles) || 1,
      gridWidth,
    });
    const baseBits = resolveSierraLiteBinaryField({
      width: gridWidth,
      height: gridHeight,
      mix: frame.mix,
      seed: Number(settings.seed) || 0,
      phaseX: 0,
      phaseY: 0,
      identityKey: frame.currentIndex,
      lowKey: frame.currentIndex,
      highKey: frame.nextIndex,
      diversity: 1,
    });
    const bits = rollSierraLiteBinaryField(
      baseBits,
      gridWidth,
      gridHeight,
      frame.motionCells,
    );
    const renderWidth = Math.max(1, Math.round(renderOptions.renderWidth));
    const renderHeight = Math.max(1, Math.round(renderOptions.renderHeight));
    const scratchKey = `${group.id}:${renderWidth}x${renderHeight}:${gridWidth}x${gridHeight}`;
    let scratch = this.interlaceScratch.get(scratchKey);
    if (!scratch) {
      const mask = document.createElement('canvas');
      mask.width = gridWidth;
      mask.height = gridHeight;
      const layer = document.createElement('canvas');
      layer.width = renderWidth;
      layer.height = renderHeight;
      scratch = {
        mask,
        maskCtx: mask.getContext('2d'),
        layer,
        layerCtx: layer.getContext('2d'),
        imageData: null,
      };
      if (!scratch.maskCtx || !scratch.layerCtx) return false;
      this.interlaceScratch.clear();
      this.interlaceScratch.set(scratchKey, scratch);
    }
    const imageData = scratch.imageData
      ?? scratch.maskCtx.createImageData(gridWidth, gridHeight);
    for (let index = 0, offset = 0; index < bits.length; index += 1, offset += 4) {
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = bits[index] ? 255 : 0;
    }
    scratch.imageData = imageData;
    scratch.maskCtx.putImageData(imageData, 0, 0);

    const drawEntry = (entry, keepHighBits) => {
      const originalBlendMode = entry.layer.blendMode;
      const originalOpacity = entry.layer.opacity;
      scratch.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      scratch.layerCtx.globalAlpha = 1;
      scratch.layerCtx.globalCompositeOperation = 'source-over';
      scratch.layerCtx.clearRect(0, 0, renderWidth, renderHeight);
      entry.layer.blendMode = 'source-over';
      entry.layer.opacity = 1;
      let painted = false;
      try {
        painted = this.paintLayerEntry(entry, 0, scratch.layerCtx, renderOptions);
      } finally {
        entry.layer.blendMode = originalBlendMode;
        entry.layer.opacity = originalOpacity;
      }
      if (!painted) return false;
      scratch.layerCtx.imageSmoothingEnabled = false;
      scratch.layerCtx.globalCompositeOperation = keepHighBits ? 'destination-in' : 'destination-out';
      scratch.layerCtx.drawImage(scratch.mask, 0, 0, renderWidth, renderHeight);
      scratch.layerCtx.globalCompositeOperation = 'source-over';
      renderCtx.save();
      renderCtx.globalAlpha = Number.isFinite(originalOpacity) ? clamp(originalOpacity, 0, 1) : 1;
      renderCtx.globalCompositeOperation = originalBlendMode ?? 'source-over';
      renderCtx.drawImage(scratch.layer, 0, 0);
      renderCtx.restore();
      return true;
    };

    const currentPainted = drawEntry(group.entries[frame.currentIndex], false);
    const nextPainted = drawEntry(group.entries[frame.nextIndex], true);
    return currentPainted || nextPainted;
  }


  getStaticComposite(renderOptions, profile) {
    if (!this.canUseStaticComposite) {
      return null;
    }
    const staticEntries = this.staticLayerEntries;
    if (staticEntries.length === 0) {
      return null;
    }
    const targetWidth = Math.max(1, Math.round(renderOptions.renderWidth));
    const targetHeight = Math.max(1, Math.round(renderOptions.renderHeight));
    const key = [
      targetWidth,
      targetHeight,
      renderOptions.documentSize.width,
      renderOptions.documentSize.height,
      renderOptions.isFixed ? 1 : 0,
      renderOptions.shouldFilterArtwork ? 1 : 0,
      renderOptions.dpr,
      this.staticCompositeLayerKey,
    ].join('|');
    if (this.staticCompositeCanvas && this.staticCompositeKey === key) {
      return this.staticCompositeCanvas;
    }
    const canvas = this.staticCompositeCanvas ?? document.createElement('canvas');
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
      this.staticCompositeCtx = null;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
      this.staticCompositeCtx = null;
    }
    const cacheCtx = this.staticCompositeCtx ?? canvas.getContext('2d');
    if (!cacheCtx) {
      return null;
    }
    this.staticCompositeCtx = cacheCtx;
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.globalAlpha = 1;
    cacheCtx.globalCompositeOperation = 'source-over';
    cacheCtx.clearRect(0, 0, canvas.width, canvas.height);
    const staticStart = profile?.enabled ? profile.now() : 0;
    let painted = 0;
    staticEntries.forEach((entry, index) => {
      if (this.paintLayerEntry(entry, index, cacheCtx, renderOptions)) {
        painted += 1;
      }
    });
    if (profile?.enabled) {
      profile.staticMs += profile.now() - staticStart;
    }
    canvas.__vesselStaticPainted = painted;
    this.staticCompositeCanvas = canvas;
    this.staticCompositeKey = key;
    return canvas;
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
    const dpr = Number.isFinite(this.effectiveDpr) && this.effectiveDpr > 0
      ? this.effectiveDpr
      : getRawDevicePixelRatio();
    const width = this.canvas.width;
    const height = this.canvas.height;
    const fallbackCssWidth = Math.max(1, Math.round(width / Math.max(dpr, Number.EPSILON)));
    const fallbackCssHeight = Math.max(1, Math.round(height / Math.max(dpr, Number.EPSILON)));
    const styledCssWidth = Number.parseFloat(this.canvas.style?.width ?? '');
    const styledCssHeight = Number.parseFloat(this.canvas.style?.height ?? '');
    const cssW = isFixed
      ? (Number.isFinite(styledCssWidth) && styledCssWidth > 0 ? styledCssWidth : fallbackCssWidth)
      : width;
    const cssH = isFixed
      ? (Number.isFinite(styledCssHeight) && styledCssHeight > 0 ? styledCssHeight : fallbackCssHeight)
      : height;

    ctx.save();
    logViewerState(ctx, this.canvas, this.metadata, cssW, cssH);
    const clearWidth = width;
    const clearHeight = height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, clearWidth, clearHeight);

    paintGobletBackground(ctx, clearWidth, clearHeight, this.metadata);

    const documentSize = {
      width: Math.max(1, toNum(this.metadata.project?.width, cssW)),
      height: Math.max(1, toNum(this.metadata.project?.height, cssH))
    };
    const displayFilters = getGobletDisplayFilters(this.metadata);
    const hasEnabledDisplayFilters = hasEnabledDisplayFiltersInList(displayFilters);
    const shouldApplyDirectOverlayFilter = hasEnabledDisplayFiltersInList(
      displayFilters,
      'direct-overlay-only',
    );
    const shouldUseDisplayFilterPipeline =
      hasEnabledDisplayFilters && !shouldApplyDirectOverlayFilter;
    const filterSurfaceCanvas = shouldUseDisplayFilterPipeline
      ? ensureDisplayFilterCanvas(
          this.displayFilterState.filterSurfaceCanvas,
          clearWidth,
          clearHeight,
        )
      : null;
    const filterCtx = shouldUseDisplayFilterPipeline
      ? clearDisplayFilterCanvas(filterSurfaceCanvas)
      : null;
    if (shouldUseDisplayFilterPipeline) {
      this.displayFilterState.filterSurfaceCanvas = filterSurfaceCanvas;
    }
    if (filterCtx) {
      paintGobletBackground(filterCtx, clearWidth, clearHeight, this.metadata);
    }
    const renderCtx = filterCtx ?? ctx;

    const sorted = this.sortedLayerEntries;

    if (diagnosticsEnabled) {
      diagnostics.log('[goblet] Layers to render:', sorted.map((entry) => ({
        id: entry.layer.id,
        hasSource: Boolean(entry.source || entry.player || entry.sequentialPlayer),
        visible: entry.layer.visible
      })));
    }
    this.logLayerAnimationReasons(sorted);

    const viewportSize = { width: cssW, height: cssH };
    const designSize = {
      width: Math.max(1, toNum(this.metadata.viewport?.designWidth, cssW)),
      height: Math.max(1, toNum(this.metadata.viewport?.designHeight, cssH))
    };
    let painted = 0;
    const profile = this.renderProfile;
    profile.enabled = isGobletProfileEnabled();
    profile.staticMs = 0;
    profile.dynamicMs = 0;
    profile.filterMs = 0;
    profile.blitMs = 0;
    const renderOptions = {
      documentSize,
      viewportSize,
      designSize,
      isFixed,
      shouldFilterArtwork: hasEnabledDisplayFilters,
      dpr,
      renderWidth: clearWidth,
      renderHeight: clearHeight,
    };
    const staticComposite = this.getStaticComposite(renderOptions, profile);
    if (staticComposite) {
      renderCtx.drawImage(staticComposite, 0, 0);
      painted += staticComposite.__vesselStaticPainted ?? 0;
      const dynamicStart = profile.enabled ? profile.now() : 0;
      this.dynamicLayerEntries.forEach((entry, index) => {
        if (this.paintLayerEntry(entry, index, renderCtx, renderOptions)) {
          painted += 1;
        }
      });
      if (profile.enabled) {
        profile.dynamicMs += profile.now() - dynamicStart;
      }
    } else {
      const dynamicStart = profile.enabled ? profile.now() : 0;
      const paintedInterlaceGroupIds = new Set();
      sorted.forEach((entry, index) => {
        if (this.interlaceLayerIdSet.has(entry.layer.id)) {
          const group = this.interlaceGroups.find((candidate) => (
            candidate.entries.some((member) => member.layer.id === entry.layer.id)
          ));
          if (group && !paintedInterlaceGroupIds.has(group.id)) {
            if (this.paintInterlaceGroup(group, renderCtx, renderOptions)) painted += 1;
            paintedInterlaceGroupIds.add(group.id);
          }
          return;
        }
        if (this.paintLayerEntry(entry, index, renderCtx, renderOptions)) {
          painted += 1;
        }
      });
      if (profile.enabled) {
        profile.dynamicMs += profile.now() - dynamicStart;
      }
    }

    diagnostics.log(`[goblet] Painted ${painted} of ${sorted.length} layers`);

    if (painted === 0 && sorted.length > 0) {
      diagnostics.warn('Render completed but no layers produced pixels');
    }

    if (filterCtx && filterSurfaceCanvas) {
      const filterLengthScale = isFixed ? Math.max(dpr, 1e-4) : 1;
      const filterStart = profile.enabled ? profile.now() : 0;
      const finalFilteredCanvas = applyDisplayFilterStack({
        sourceCanvas: filterSurfaceCanvas,
        displayFilters,
        filterState: this.displayFilterState,
        visibleRect: {
          x: 0,
          y: 0,
          width: clearWidth,
          height: clearHeight,
        },
        lengthScale: filterLengthScale,
      });
      if (profile.enabled) {
        profile.filterMs += profile.now() - filterStart;
      }
      const blitStart = profile.enabled ? profile.now() : 0;
      ctx.drawImage(finalFilteredCanvas, 0, 0);
      if (profile.enabled) {
        profile.blitMs += profile.now() - blitStart;
      }
    } else if (shouldApplyDirectOverlayFilter) {
      const filterStart = profile.enabled ? profile.now() : 0;
      applyDisplayFilterStack({
        sourceCanvas: this.canvas,
        displayFilters,
        filterState: this.displayFilterState,
        directOverlayTarget: {
          ctx,
          rect: {
            x: 0,
            y: 0,
            width: clearWidth,
            height: clearHeight,
          },
        },
      });
      if (profile.enabled) {
        profile.filterMs += profile.now() - filterStart;
      }
    }

    logSummary(painted, sorted.length, startTime);
    this.hasLastRenderProfile = profile.enabled;
    if (profile.enabled) {
      this.lastRenderProfile.staticMs = profile.staticMs;
      this.lastRenderProfile.dynamicMs = profile.dynamicMs;
      this.lastRenderProfile.filterMs = profile.filterMs;
      this.lastRenderProfile.blitMs = profile.blitMs;
    }

    ctx.restore();
  }

  setupAnimationEligibilityObservers() {
    if (this.destroyed) {
      return;
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.isDocumentVisible = !document.hidden;
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof IntersectionObserver !== 'undefined' && this.canvas) {
      this.intersectionObserver = new IntersectionObserver(this.handleIntersectionChange, { threshold: 0 });
      this.intersectionObserver.observe(this.canvas);
    }
  }

  handleVisibilityChange() {
    this.isDocumentVisible = typeof document === 'undefined' || !document.hidden;
    this.reconcileAnimationLoop();
  }

  handleIntersectionChange(entries) {
    const entry = Array.isArray(entries) ? entries[entries.length - 1] : null;
    if (!entry || entry.target !== this.canvas) {
      return;
    }
    this.isCanvasIntersecting = entry.isIntersecting === true;
    this.reconcileAnimationLoop();
  }

  getPauseReasons() {
    const reasons = [];
    if (this.destroyed) reasons.push('destroyed');
    if (this.dynamicPlayers.length === 0) reasons.push('no-dynamic-players');
    if (!this.isDocumentVisible) reasons.push('document-hidden');
    if (!this.isCanvasIntersecting) reasons.push('canvas-offscreen');
    if (this.dynamicPlayers.some((player) => player?._isReinitializing)) reasons.push('scale-transition');
    return reasons;
  }

  canRunAnimation() {
    return !this.destroyed
      && this.dynamicPlayers.length > 0
      && this.isDocumentVisible
      && this.isCanvasIntersecting
      && !this.dynamicPlayers.some((player) => player?._isReinitializing);
  }

  resetPlayerMeasurementWindows() {
    this.dynamicPlayers.forEach((player) => {
      if (typeof player?.resetAdaptiveMeasurement === 'function') {
        player.resetAdaptiveMeasurement();
      }
    });
  }

  reconcileAnimationLoop() {
    if (!this.canRunAnimation()) {
      const wasRunning = this.isAnimationLoopActive;
      this.stop();
      if (wasRunning) {
        this.isAnimationLoopActive = false;
        this.lastTimestamp = 0;
        this.resetPlayerMeasurementWindows();
      }
      return;
    }
    if (!this.isAnimationLoopActive) {
      this.isAnimationLoopActive = true;
      this.lastTimestamp = 0;
      this.resetPlayerMeasurementWindows();
    }
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.handleAnimationFrame);
    }
  }

  start() {
    this.stop();
    this.isAnimationLoopActive = false;
    this.lastTimestamp = 0;
    this.reconcileAnimationLoop();
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
    this.isAnimationLoopActive = false;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
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
    this.reconcileAnimationLoop();
  }

  getProfileSnapshot() {
    const frameProfile = this.frameProfile;
    const frameSummary = frameProfile
      ? {
          totalFrames: frameProfile.totalFrames,
          totalMs: summarizeProfileValues(frameProfile.totalMs, frameProfile.count),
          cpuFillMs: summarizeProfileValues(frameProfile.cpuFillMs, frameProfile.count),
          cpuBlitMs: summarizeProfileValues(frameProfile.cpuBlitMs, frameProfile.count),
          compositeMs: summarizeProfileValues(frameProfile.compositeMs, frameProfile.count),
          filterMs: summarizeProfileValues(frameProfile.filterMs, frameProfile.count),
          fps: summarizeProfileValues(frameProfile.fps, frameProfile.count),
        }
      : null;
    return {
      canvasId: this.canvas?.id ?? null,
      enabled: isGobletProfileEnabled(),
      rafRunning: this.rafId !== null,
      pauseReasons: this.getPauseReasons(),
      rawDpr: this.rawDpr,
      effectiveDpr: this.effectiveDpr,
      isMobileDprCapped: this.isMobileDprCapped,
      backingWidth: this.canvas?.width ?? 0,
      backingHeight: this.canvas?.height ?? 0,
      backingPixels: (this.canvas?.width ?? 0) * (this.canvas?.height ?? 0),
      resizeFlushCount: this.resizeFlushCount,
      frame: frameSummary,
      lastRender: this.hasLastRenderProfile ? { ...this.lastRenderProfile } : null,
      players: this.layerEntries
        .filter((entry) => entry?.player)
        .map((entry) => ({
          layerId: entry.layer?.id ?? null,
          renderPath: entry.player?._lastRenderPath ?? null,
          useWebGL: entry.player?.useWebGL === true,
          webglInitAttempted: entry.player?._webglInitAttempted === true,
          webglInitFailed: entry.player?._webglInitFailed === true,
          webglFallbackReason: entry.player?._webglFallbackReason ?? null,
          adaptiveScaleEnabled: entry.player?._adaptiveScaleEnabled === true,
          renderScale: entry.player?.renderScale ?? 1,
          scaleTransitionActive: entry.player?._isReinitializing === true,
          lastScaleTransitionReason: entry.player?._lastScaleTransitionReason ?? null,
          cpuFillMs: entry.player?._lastCpuFillMs ?? 0,
          cpuBlitMs: entry.player?._lastCpuBlitMs ?? 0,
        })),
    };
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
    const dprState = isFixed
      ? resolveFixedDpr(width, height)
      : {
          rawDpr: getRawDevicePixelRatio(),
          effectiveDpr: getRawDevicePixelRatio(),
          isMobileCapped: false,
        };
    this.rawDpr = dprState.rawDpr;
    this.effectiveDpr = dprState.effectiveDpr;
    this.isMobileDprCapped = dprState.isMobileCapped;
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
      const dimensionRound = matchesCoarsePointer() ? Math.floor : Math.round;
      const backWidth = Math.max(1, dimensionRound(cssWidth * this.effectiveDpr));
      const backHeight = Math.max(1, dimensionRound(cssHeight * this.effectiveDpr));
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
    this.resizeFlushCount += 1;
    this.updateScale();
  }

  handleAnimationFrame(timestamp) {
    this.rafId = null;
    if (!this.canRunAnimation()) {
      return;
    }
    if (!this.lastTimestamp || timestamp <= this.lastTimestamp) {
      this.lastTimestamp = timestamp;
      this.reconcileAnimationLoop();
      return;
    }
    const delta = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const profileEnabled = isGobletProfileEnabled();
    const frameStart = profileEnabled ? profileNow() : 0;
    let cpuFillMs = 0;
    let cpuBlitMs = 0;
    let needsRender = false;
    for (const player of this.dynamicPlayers) {
      if (player && player.advance(delta)) {
        needsRender = true;
      }
      if (profileEnabled) {
        cpuFillMs += player?._lastCpuFillMs ?? 0;
        cpuBlitMs += player?._lastCpuBlitMs ?? 0;
      }
    }
    if (needsRender) {
      this.renderOnce();
    }
    if (profileEnabled) {
      this.frameProfile ??= createFrameProfileState();
      const compositeMs = this.hasLastRenderProfile
        ? this.lastRenderProfile.staticMs + this.lastRenderProfile.dynamicMs
        : 0;
      recordFrameProfile(
        this.frameProfile,
        profileNow() - frameStart,
        cpuFillMs,
        cpuBlitMs,
        compositeMs,
        this.hasLastRenderProfile ? this.lastRenderProfile.filterMs : 0,
        delta > 0 ? 1 / delta : 0,
      );
    }
    this.reconcileAnimationLoop();
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------
const ensureResizeListener = () => {
  if (resizeListenerAttached || typeof window === 'undefined') {
    return;
  }
  const flushActiveViewers = () => {
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
  };
  window.addEventListener('resize', () => {
    if (resizeTrailingTimer === null) {
      flushActiveViewers();
    } else {
      window.clearTimeout(resizeTrailingTimer);
    }
    resizeTrailingTimer = window.setTimeout(() => {
      resizeTrailingTimer = null;
      flushActiveViewers();
    }, RESIZE_TRAILING_MS);
  });
  resizeListenerAttached = true;
};

if (typeof window !== 'undefined') {
  window.__VESSEL_DUMP_GOBLET_PROFILE__ = () => (
    Array.from(ACTIVE_CANVASES.values(), (viewer) => viewer.getProfileSnapshot())
  );
}

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

  canvas[RENDERER_KEY] = viewer;
  canvas.__vesselSourceMetadata = metadata;
  ACTIVE_CANVASES.set(canvas, viewer);
  ensureResizeListener();
  viewer.setupAnimationEligibilityObservers();
  viewer.start();

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
