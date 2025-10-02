import { normalizeAlignment, computeLayerTransform, computeLayerDestination } from './alignFitResolver.js';

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

const logViewerState = (ctx, canvas, metadata, cssW, cssH) => {
  if (typeof window === 'undefined' || !ctx || !canvas) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const transform = snapshotTransform(ctx);
  console.log(
    '[VIEWER]',
    'mode=', metadata?.viewport?.mode ?? '-',
    'design=', `${metadata?.viewport?.designWidth ?? '-'}x${metadata?.viewport?.designHeight ?? '-'}`,
    'project=', `${metadata?.project?.width ?? '-'}x${metadata?.project?.height ?? '-'}`,
    'dpr=', dpr,
    'backing=', `${canvas.width}x${canvas.height}`,
    'css=', `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    'viewportCSS=', `${cssW}x${cssH}`,
    'tf=', formatMatrix(transform),
    'smoothing=', ctx.imageSmoothingEnabled
  );
};

const logLayerDraw = (layer, source, sample, destination, units) => {
  const isImage = typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
  const srcW = isImage ? source.naturalWidth || source.width : source.width;
  const srcH = isImage ? source.naturalHeight || source.height : source.height;
  const alignment = layer?.alignment ?? {};
  console.log(
    `[DRAW:${layer?.id ?? 'unknown'}:${units}]`,
    'src=', `${srcW}x${srcH}`,
    'sample=', sample
      ? `${sample.x},${sample.y},${sample.width},${sample.height}`
      : 'null',
    'dest=', destination
      ? `${destination.x},${destination.y},${destination.width},${destination.height}`
      : 'null',
    'fit=', alignment.fit ?? '-',
    'hz/vt=', `${alignment.horizontal ?? '-'}/${alignment.vertical ?? '-'}`,
    'pos=', alignment.positioning ?? '-',
    'off%=', `${alignment.offsetPercent?.x ?? 0},${alignment.offsetPercent?.y ?? 0}`
  );
};

const logSummary = (painted, total, startedAt) => {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    const elapsedMs = Number((Date.now() - startedAt).toFixed(2));
    console.log('[SUMMARY]', 'painted=', painted, 'of', total, 'ms=', elapsedMs);
    return;
  }
  const elapsed = Number((performance.now() - startedAt).toFixed(2));
  console.log('[SUMMARY]', 'painted=', painted, 'of', total, 'ms=', elapsed);
};

const logResize = (canvas, mode) => {
  if (typeof window === 'undefined' || !canvas) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  console.log(
    '[RESIZE]',
    'dpr=', dpr,
    'backing=', `${canvas.width}x${canvas.height}`,
    'css=', `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    'mode=', mode ?? '-'
  );
};

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

const createDefaultContainerLayout = () => ({
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

    const isUniform = entry.alignment?.fit === 'uniform';
    const paintedBounds = isUniform
      ? {
          x: 0,
          y: 0,
          width: Math.max(1, entry.content?.width ?? surface.width),
          height: Math.max(1, entry.content?.height ?? surface.height)
        }
      : {
          x: 0,
          y: 0,
          width: surface.width,
          height: surface.height
        };

    const transform = computeLayerTransform(entry.document, viewportForLayer, entry.alignment, { paintedBounds });

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

const normalizeLayerSpatialMetadata = (metadata) => {
  if (!metadata || !Array.isArray(metadata.layers)) {
    return metadata;
  }

  const projectWidth = Math.max(1, toFinite(metadata.project?.width, 1));
  const projectHeight = Math.max(1, toFinite(metadata.project?.height, 1));
  const documentSize = {
    width: projectWidth,
    height: projectHeight
  };

  const normalizeRect = (rect, fallback) => {
    if (!rect || typeof rect !== 'object') {
      return null;
    }
    const width = clampDimension(toFinite(rect.width, fallback.width));
    const height = clampDimension(toFinite(rect.height, fallback.height));
    return {
      x: roundPlacementValue(toFinite(rect.x, 0)),
      y: roundPlacementValue(toFinite(rect.y, 0)),
      width: roundPlacementValue(width),
      height: roundPlacementValue(height)
    };
  };

  const normalizePercentRect = (rect) => {
    if (!rect || typeof rect !== 'object') {
      return null;
    }
    return {
      x: roundPlacementValue(toFinite(rect.x, 0)),
      y: roundPlacementValue(toFinite(rect.y, 0)),
      width: roundPlacementValue(toFinite(rect.width, 0)),
      height: roundPlacementValue(toFinite(rect.height, 0))
    };
  };

  const derivePercentFromRect = (rect, document) => {
    if (!rect) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const safeWidth = Math.max(MIN_DIMENSION, document.width);
    const safeHeight = Math.max(MIN_DIMENSION, document.height);
    return {
      x: roundPlacementValue((rect.x / safeWidth) * 100),
      y: roundPlacementValue((rect.y / safeHeight) * 100),
      width: roundPlacementValue((rect.width / safeWidth) * 100),
      height: roundPlacementValue((rect.height / safeHeight) * 100)
    };
  };

  let needsLayoutPlacement = false;

  metadata.layers.forEach((layer) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }

    const sourceWidth = Math.max(1, toFinite(layer?.source?.width, documentSize.width));
    const sourceHeight = Math.max(1, toFinite(layer?.source?.height, documentSize.height));
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
    const layout = normalizeContainerLayout(metadata.container);
    const viewport = {
      width: Math.max(1, toFinite(metadata.viewport?.designWidth ?? metadata.viewport?.width ?? metadata.project?.width, documentSize.width)),
      height: Math.max(1, toFinite(metadata.viewport?.designHeight ?? metadata.viewport?.height ?? metadata.project?.height, documentSize.height))
    };

    const inputs = metadata.layers
      .map((layer) => {
        if (!layer || typeof layer !== 'object') {
          return null;
        }

        const surfaceWidth = Math.max(1, toFinite(layer?.source?.width, documentSize.width));
        const surfaceHeight = Math.max(1, toFinite(layer?.source?.height, documentSize.height));
        const contentWidth = layer.contentBounds
          ? Math.max(1, toFinite(layer.contentBounds.width, surfaceWidth))
          : surfaceWidth;
        const contentHeight = layer.contentBounds
          ? Math.max(1, toFinite(layer.contentBounds.height, surfaceHeight))
          : surfaceHeight;

        return {
          layerId: layer.id,
          surface: { width: clampDimension(surfaceWidth), height: clampDimension(surfaceHeight) },
          content: { width: clampDimension(contentWidth), height: clampDimension(contentHeight) },
          document: { width: documentSize.width, height: documentSize.height },
          alignment: normalizeAlignment(layer.alignment),
          hidden: layer.visible === false
        };
      })
      .filter(Boolean);

    try {
      const placements = resolveContainerLayout(inputs, layout, viewport);
      const placementMap = new Map();
      placements.forEach((placement) => {
        placementMap.set(placement.layerId, placement);
      });

      metadata.layers.forEach((layer) => {
        if (!layer || typeof layer !== 'object') {
          return;
        }
        if (layer.layoutPlacement && typeof layer.layoutPlacement === 'object') {
          return;
        }
        const placement = placementMap.get(layer.id);
        if (!placement) {
          return;
        }

        layer.layoutPlacement = {
          frame: {
            x: roundPlacementValue(placement.frame.x),
            y: roundPlacementValue(placement.frame.y),
            width: roundPlacementValue(placement.frame.width),
            height: roundPlacementValue(placement.frame.height)
          },
          transform: {
            scaleX: roundPlacementValue(placement.transform.scaleX),
            scaleY: roundPlacementValue(placement.transform.scaleY),
            translateX: roundPlacementValue(placement.transform.translateX),
            translateY: roundPlacementValue(placement.transform.translateY),
            rotation: typeof placement.transform.rotation === 'number'
              ? roundPlacementValue(placement.transform.rotation)
              : undefined
          }
        };
      });
    } catch (error) {
      diagnostics.warn('Failed to compute design layout in viewer', error);
    }
  }

  metadata.layers.forEach((layer) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }
    delete layer.bounds;
    delete layer.pixelBoundsPx;
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
  const expanded = normalizeLayerSpatialMetadata(
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
const applyLayerToContext = (ctx, source, layer, destination, units = 'css') => {
  if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
    return false;
  }

  const fit = layer?.alignment?.fit ?? 'none';
  const sourceWidth = source instanceof HTMLImageElement
    ? source.naturalWidth || source.width
    : source.width;
  const sourceHeight = source instanceof HTMLImageElement
    ? source.naturalHeight || source.height
    : source.height;

  if (!destination) {
    return false;
  }

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (layer?.contentBounds && layer?.alignment?.fit === 'uniform') {
    const boundsRaw = layer.contentBounds;
    const clampedX = clamp(boundsRaw.x, 0, Math.max(0, sourceWidth - 1));
    const clampedY = clamp(boundsRaw.y, 0, Math.max(0, sourceHeight - 1));
    const maxWidth = Math.max(1, sourceWidth - clampedX);
    const maxHeight = Math.max(1, sourceHeight - clampedY);
    sx = Math.floor(clampedX);
    sy = Math.floor(clampedY);
    sw = Math.max(1, Math.floor(Math.min(boundsRaw.width, maxWidth)));
    sh = Math.max(1, Math.floor(Math.min(boundsRaw.height, maxHeight)));
  } else if (fit === 'uniform') {
    const declaredWidth = Math.max(1, toFinite(layer?.source?.width, sourceWidth));
    const declaredHeight = Math.max(1, toFinite(layer?.source?.height, sourceHeight));
    sw = Math.min(declaredWidth, sourceWidth);
    sh = Math.min(declaredHeight, sourceHeight);
  } else {
    sx = 0;
    sy = 0;
    sw = sourceWidth;
    sh = sourceHeight;
  }

  const sampleRegion = {
    x: sx,
    y: sy,
    width: sw,
    height: sh
  };

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
    drawingFrom: sampleRegion,
    drawingTo: {
      x: destination.x,
      y: destination.y,
      width: destination.width,
      height: destination.height
    },
    opacity,
    blendMode
  });

  const dx = Math.round(destination.x);
  const dy = Math.round(destination.y);
  const dw = Math.round(destination.width);
  const dh = Math.round(destination.height);

  const drawDestination = { x: dx, y: dy, width: dw, height: dh };
  const destinationForLog = units === 'css' ? destination : drawDestination;
  logLayerDraw(layer, source, sampleRegion, destinationForLog, units);

  const transformBeforeDraw = snapshotTransform(ctx);
  if (!isIdentityTransform(transformBeforeDraw)) {
    warnNonIdentityTransform(layer?.id, transformBeforeDraw);
  }

  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    dx,
    dy,
    dw,
    dh
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
          documentBoundsPx: layerClone.documentBoundsPx
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
      ? Math.max(1, Math.round(toFinite(this.metadata.viewport?.designWidth, fallbackCssWidth)))
      : width;
    const cssH = isFixed
      ? Math.max(1, Math.round(toFinite(this.metadata.viewport?.designHeight, fallbackCssHeight)))
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

    const viewportSize = { width: cssW, height: cssH };
    const documentSize = {
      width: Math.max(1, toFinite(this.metadata.project?.width, cssW)),
      height: Math.max(1, toFinite(this.metadata.project?.height, cssH))
    };
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
      const isUniform = entry.layer.alignment?.fit === 'uniform';
      const uniformBounds = entry.layer.documentBoundsPx;
      const paintedForLayout = isUniform && uniformBounds
        ? uniformBounds
        : {
            x: 0,
            y: 0,
            width: documentSize.width,
            height: documentSize.height
          };

      const destinationCSS = computeLayerDestination({
        document: documentSize,
        viewport: viewportSize,
        alignment: entry.layer.alignment,
        paintedBounds: paintedForLayout
      });
      if (!destinationCSS) {
        diagnostics.log(`[goblet] No destination for layer ${entry.layer.id}`);
        return;
      }

      const destination = isFixed
        ? {
            x: Math.round(destinationCSS.x * dpr),
            y: Math.round(destinationCSS.y * dpr),
            width: Math.max(1, Math.round(destinationCSS.width * dpr)),
            height: Math.max(1, Math.round(destinationCSS.height * dpr))
          }
        : destinationCSS;

      diagnostics.log(`[goblet] About to draw ${entry.layer.id} at:`, {
        css: destinationCSS,
        backing: destination
      });

      const units = isFixed ? 'backing' : 'css';
      if (applyLayerToContext(ctx, source, entry.layer, destination, units)) {
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
    const designWidth = Math.max(1, Math.round(toFinite(this.metadata?.viewport?.designWidth, fallbackCssWidth)));
    const designHeight = Math.max(1, Math.round(toFinite(this.metadata?.viewport?.designHeight, fallbackCssHeight)));

    diagnostics.log('[VIEWER] updateScale called:', {
      oldScale,
      newScale,
      oldCanvasSize: { width: this.canvas.width, height: this.canvas.height },
      newCanvasSize: { width, height },
      viewportMode: this.metadata.viewport.mode
    });

    this.scale = newScale;
    this.summary.scale = { ...this.scale };

    const cssWidth = isFixed ? designWidth : width;
    const cssHeight = isFixed ? designHeight : height;

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
