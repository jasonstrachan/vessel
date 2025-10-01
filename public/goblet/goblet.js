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
//alignFitResolver
const { normalizeAlignment, computeLayerTransform, computeLayerDestination } = (() => {
  // Auto-generated from src/utils/alignment/alignFitResolver.ts. Do not edit directly.

  const MIN_DIMENSION = 1e-3;
  const toFinite = (value, fallback = 0) => {
      if (typeof value === 'number') {
          return Number.isFinite(value) ? value : fallback;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
  };
  const clamp = (value, min, max) => {
      if (!Number.isFinite(value)) {
          return min;
      }
      return Math.min(max, Math.max(min, value));
  };
  const clampDimension = (value) => {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
          return MIN_DIMENSION;
      }
      return numeric;
  };
  const roundPlacementValue = (value) => {
      const numeric = toFinite(value, 0);
      return Math.round(numeric * 1000) / 1000;
  };
  const clampPercent = (value) => Math.max(-100, Math.min(100, toFinite(value, 0)));
  const createDefaultAlignment = () => ({
      fit: 'none',
      horizontal: 'left',
      vertical: 'top',
      positioning: 'anchor',
      offsetPx: { x: 0, y: 0 },
      offsetPercent: { x: 0, y: 0 }
  });
  const cloneAlignment = (alignment) => {
      var _a, _b;
      const base = alignment !== null && alignment !== void 0 ? alignment : createDefaultAlignment();
      const positioning = typeof base.positioning === 'string' ? base.positioning : 'anchor';
      const fit = typeof base.fit === 'string' ? base.fit : 'none';
      const shouldIncludePercent = positioning === 'auto' || fit === 'percent';
      return {
          fit,
          horizontal: typeof base.horizontal === 'string' ? base.horizontal : 'left',
          vertical: typeof base.vertical === 'string' ? base.vertical : 'top',
          positioning,
          offsetPx: base.offsetPx && typeof base.offsetPx === 'object'
              ? { x: toFinite(base.offsetPx.x, 0), y: toFinite(base.offsetPx.y, 0) }
              : { x: 0, y: 0 },
          offsetPercent: shouldIncludePercent
              ? {
                  x: toFinite((_a = base.offsetPercent) === null || _a === void 0 ? void 0 : _a.x, 0),
                  y: toFinite((_b = base.offsetPercent) === null || _b === void 0 ? void 0 : _b.y, 0)
              }
              : undefined
      };
  };
  const normalizeAlignment = (alignment) => {
      return cloneAlignment(alignment);
  };
  const deriveAutoPercentOffset = (bounds, mapping, viewport) => {
      const availableX = viewport.width - bounds.width;
      const availableY = viewport.height - bounds.height;
      const normalizedX = toFinite(bounds.x, 0) - mapping.offsetX;
      const normalizedY = toFinite(bounds.y, 0) - mapping.offsetY;
      const percentX = availableX > MIN_DIMENSION
          ? clampPercent((normalizedX / availableX) * 100)
          : 0;
      const percentY = availableY > MIN_DIMENSION
          ? clampPercent((normalizedY / availableY) * 100)
          : 0;
      return {
          x: percentX,
          y: percentY
      };
  };
  const getPercentOffset = (alignment) => {
      var _a;
      const percent = (_a = alignment.offsetPercent) !== null && _a !== void 0 ? _a : { x: 0, y: 0 };
      return {
          x: clampPercent(percent.x),
          y: clampPercent(percent.y)
      };
  };
  const computeAnchorTranslation = ({ alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }) => {
      var _a, _b;
      const extraX = viewportWidth - scaledWidth;
      const extraY = viewportHeight - scaledHeight;
      let translateX = 0;
      let translateY = 0;
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
      translateX += toFinite((_a = alignment.offsetPx) === null || _a === void 0 ? void 0 : _a.x, 0);
      translateY += toFinite((_b = alignment.offsetPx) === null || _b === void 0 ? void 0 : _b.y, 0);
      return { translateX, translateY };
  };
  const computeAutoTranslation = ({ alignment, viewportWidth, viewportHeight, scaledWidth, scaledHeight }, options = {}) => {
      const percent = getPercentOffset(alignment);
      const extraX = viewportWidth - scaledWidth;
      const extraY = viewportHeight - scaledHeight;
      let translateX = extraX * (percent.x / 100);
      let translateY = extraY * (percent.y / 100);
      if (options.applyUniformOffsetPx && alignment.offsetPx) {
          const epsilon = 1e-3;
          if (Math.abs(extraX) <= epsilon && Number.isFinite(alignment.offsetPx.x)) {
              translateX += alignment.offsetPx.x;
          }
          if (Math.abs(extraY) <= epsilon && Number.isFinite(alignment.offsetPx.y)) {
              translateY += alignment.offsetPx.y;
          }
      }
      return { translateX, translateY };
  };
  const computePercentTranslation = ({ alignment, viewportWidth, viewportHeight }) => {
      const percent = getPercentOffset(alignment);
      return {
          translateX: viewportWidth * (percent.x / 100),
          translateY: viewportHeight * (percent.y / 100)
      };
  };
  const resolveScaledTransform = (context, scaleX, scaleY, options = {}) => {
      const { alignment, viewportWidth, viewportHeight, contentWidth, contentHeight } = context;
      const scaledWidth = contentWidth * scaleX;
      const scaledHeight = contentHeight * scaleY;
      const translationContext = {
          alignment,
          viewportWidth,
          viewportHeight,
          scaledWidth,
          scaledHeight
      };
      const translate = options.usePercentTranslation
          ? computePercentTranslation(translationContext)
          : alignment.positioning === 'auto'
              ? computeAutoTranslation(translationContext, { applyUniformOffsetPx: options.allowUniformOffsetPx })
              : computeAnchorTranslation(translationContext);
      return {
          scaleX,
          scaleY,
          translateX: translate.translateX,
          translateY: translate.translateY
      };
  };
  const fitTransformResolvers = {
      none: (context) => resolveScaledTransform(context, 1, 1),
      contain: (context) => {
          const scale = Math.min(context.widthRatio, context.heightRatio);
          return resolveScaledTransform(context, scale, scale);
      },
      cover: (context) => {
          const scale = Math.max(context.widthRatio, context.heightRatio);
          return resolveScaledTransform(context, scale, scale);
      },
      fill: (context) => resolveScaledTransform(context, context.widthRatio, context.heightRatio),
      'fit-width': (context) => {
          const scale = context.widthRatio;
          return resolveScaledTransform(context, scale, scale);
      },
      'fit-height': (context) => {
          const scale = context.heightRatio;
          return resolveScaledTransform(context, scale, scale);
      },
      'scale-down': (context) => {
          const containScale = Math.min(context.widthRatio, context.heightRatio);
          const scale = containScale < 1 ? containScale : 1;
          return resolveScaledTransform(context, scale, scale);
      },
      percent: (context) => resolveScaledTransform(context, 1, 1, { usePercentTranslation: true }),
      uniform: (context) => resolveScaledTransform(context, 1, 1, { allowUniformOffsetPx: true })
  };
  const computeLayerTransform = (surface, viewport, alignment) => {
      var _a;
      const normalized = normalizeAlignment(alignment);
      const contentWidth = clampDimension(surface.width);
      const contentHeight = clampDimension(surface.height);
      const viewportWidth = clampDimension(viewport.width);
      const viewportHeight = clampDimension(viewport.height);
      const context = {
          contentWidth,
          contentHeight,
          viewportWidth,
          viewportHeight,
          widthRatio: viewportWidth / contentWidth,
          heightRatio: viewportHeight / contentHeight,
          alignment: normalized
      };
      const resolver = (_a = fitTransformResolvers[normalized.fit]) !== null && _a !== void 0 ? _a : fitTransformResolvers.none;
      return resolver(context);
  };
  const resolveAutoViewportSize = (mapping) => {
      const canvasWidth = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.canvasWidth, 0));
      const canvasHeight = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.canvasHeight, 0));
      const designWidth = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.designWidth, 0));
      const designHeight = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.designHeight, 0));
      const scaleX = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleX, 1));
      const scaleY = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleY, 1));
      const viewportWidth = designWidth > 0 && scaleX > 0
          ? designWidth * scaleX
          : canvasWidth;
      const viewportHeight = designHeight > 0 && scaleY > 0
          ? designHeight * scaleY
          : canvasHeight;
      return {
          width: viewportWidth || canvasWidth,
          height: viewportHeight || canvasHeight
      };
  };
  const axisToPercent = (axis) => {
      if (axis === 'center') {
          return 50;
      }
      if (axis === 'right' || axis === 'bottom') {
          return 100;
      }
      return 0;
  };
  const resolveBounds = (layer, srcWidth, srcHeight, fallbackAnchor) => {
      var _a, _b, _c;
      const raw = (_b = ((_a = layer.bounds) !== null && _a !== void 0 ? _a : layer.placement)) !== null && _b !== void 0 ? _b : null;
      if (!raw) {
          return { x: 0, y: 0, width: srcWidth, height: srcHeight, anchor: fallbackAnchor };
      }
      return {
          x: toFinite(raw.x, 0),
          y: toFinite(raw.y, 0),
          width: Math.max(1, toFinite(raw.width, srcWidth)),
          height: Math.max(1, toFinite(raw.height, srcHeight)),
          anchor: (_c = raw.anchor) !== null && _c !== void 0 ? _c : fallbackAnchor
      };
  };
  const finalizeDestination = (rect) => ({
      x: roundPlacementValue(rect.x),
      y: roundPlacementValue(rect.y),
      width: roundPlacementValue(rect.width),
      height: roundPlacementValue(rect.height)
  });
  const computeAnchorPosition = (ctx, posScaleX, posScaleY) => {
      var _a, _b;
      const baseX = ctx.mapping.offsetX + ctx.bounds.x * posScaleX;
      const baseY = ctx.mapping.offsetY + ctx.bounds.y * posScaleY;
      return {
          x: baseX + toFinite((_a = ctx.alignment.offsetPx) === null || _a === void 0 ? void 0 : _a.x, 0),
          y: baseY + toFinite((_b = ctx.alignment.offsetPx) === null || _b === void 0 ? void 0 : _b.y, 0)
      };
  };
  const computeAutoPosition = (ctx, width, height) => {
      const availableX = ctx.viewport.width - width;
      const availableY = ctx.viewport.height - height;
      return {
          x: ctx.mapping.offsetX + availableX * (ctx.percent.x / 100),
          y: ctx.mapping.offsetY + availableY * (ctx.percent.y / 100),
          availableX,
          availableY
      };
  };
  const applyUniformAutoOffsets = (ctx, auto) => {
      let { x, y } = auto;
      const offset = ctx.alignment.offsetPx;
      if (!offset) {
          return { x, y };
      }
      const offsetX = toFinite(offset.x, 0);
      const offsetY = toFinite(offset.y, 0);
      if (offsetX !== 0) {
          x += offsetX;
      }
      if (offsetY !== 0) {
          y += offsetY;
      }
      return { x, y };
  };
  const createScaledDestinationResolver = (getScale) => {
      return (ctx) => {
          const { sizeScaleX, sizeScaleY, posScaleX, posScaleY } = getScale(ctx);
          const width = ctx.baseWidth * sizeScaleX;
          const height = ctx.baseHeight * sizeScaleY;
          if (ctx.posMode === 'auto') {
              const auto = computeAutoPosition(ctx, width, height);
              return {
                  x: auto.x,
                  y: auto.y,
                  width,
                  height
              };
          }
          const anchor = computeAnchorPosition(ctx, posScaleX, posScaleY);
          return {
              x: anchor.x,
              y: anchor.y,
              width,
              height
          };
      };
  };
  const uniformDestinationResolver = (ctx) => {
      const uniformScale = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
      const width = ctx.srcWidth * uniformScale;
      const height = ctx.srcHeight * uniformScale;
      if (ctx.posMode === 'auto') {
          const auto = computeAutoPosition(ctx, width, height);
          const adjusted = applyUniformAutoOffsets(ctx, auto);
          return {
              x: adjusted.x,
              y: adjusted.y,
              width,
              height
          };
      }
      const anchor = computeAnchorPosition(ctx, uniformScale, uniformScale);
      return {
          x: anchor.x,
          y: anchor.y,
          width,
          height
      };
  };
  const fillScaleResolver = createScaledDestinationResolver((ctx) => ({
      sizeScaleX: ctx.mapping.scaleX,
      sizeScaleY: ctx.mapping.scaleY,
      posScaleX: ctx.mapping.scaleX,
      posScaleY: ctx.mapping.scaleY
  }));
  const destinationResolvers = {
      none: createScaledDestinationResolver((ctx) => ({
          sizeScaleX: 1,
          sizeScaleY: 1,
          posScaleX: ctx.mapping.scaleX,
          posScaleY: ctx.mapping.scaleY
      })),
      contain: createScaledDestinationResolver((ctx) => {
          const scale = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
          return {
              sizeScaleX: scale,
              sizeScaleY: scale,
              posScaleX: scale,
              posScaleY: scale
          };
      }),
      cover: createScaledDestinationResolver((ctx) => {
          const scale = Math.max(ctx.mapping.scaleX, ctx.mapping.scaleY);
          return {
              sizeScaleX: scale,
              sizeScaleY: scale,
              posScaleX: scale,
              posScaleY: scale
          };
      }),
      fill: fillScaleResolver,
      'fit-width': createScaledDestinationResolver((ctx) => {
          const scale = ctx.mapping.scaleX;
          return {
              sizeScaleX: scale,
              sizeScaleY: scale,
              posScaleX: scale,
              posScaleY: scale
          };
      }),
      'fit-height': createScaledDestinationResolver((ctx) => {
          const scale = ctx.mapping.scaleY;
          return {
              sizeScaleX: scale,
              sizeScaleY: scale,
              posScaleX: scale,
              posScaleY: scale
          };
      }),
      'scale-down': createScaledDestinationResolver((ctx) => {
          const contain = Math.min(ctx.mapping.scaleX, ctx.mapping.scaleY);
          const scale = contain < 1 ? contain : 1;
          return {
              sizeScaleX: scale,
              sizeScaleY: scale,
              posScaleX: scale,
              posScaleY: scale
          };
      }),
      percent: fillScaleResolver,
      uniform: uniformDestinationResolver,
      default: fillScaleResolver
  };
  const computeLayerDestination = (layer, mapping) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
      const srcWidth = Math.max(1, toFinite((_a = layer === null || layer === void 0 ? void 0 : layer.source) === null || _a === void 0 ? void 0 : _a.width, toFinite((_b = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _b === void 0 ? void 0 : _b.width, toFinite((_c = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _c === void 0 ? void 0 : _c.width, 1))));
      const srcHeight = Math.max(1, toFinite((_d = layer === null || layer === void 0 ? void 0 : layer.source) === null || _d === void 0 ? void 0 : _d.height, toFinite((_e = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _e === void 0 ? void 0 : _e.height, toFinite((_f = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _f === void 0 ? void 0 : _f.height, 1))));
      const fallbackAnchor = (_k = (_h = (_g = layer === null || layer === void 0 ? void 0 : layer.bounds) === null || _g === void 0 ? void 0 : _g.anchor) !== null && _h !== void 0 ? _h : (_j = layer === null || layer === void 0 ? void 0 : layer.placement) === null || _j === void 0 ? void 0 : _j.anchor) !== null && _k !== void 0 ? _k : 'top-left';
      const layoutBounds = (_l = layer === null || layer === void 0 ? void 0 : layer.bounds) !== null && _l !== void 0 ? _l : null;
      const hasLayoutBounds = Boolean(layoutBounds && Number.isFinite(layoutBounds.width) && Number.isFinite(layoutBounds.height));
      const offsetX = toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.offsetX, 0);
      const offsetY = toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.offsetY, 0);
      const scaleX = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleX, 1)) || 1;
      const scaleY = Math.max(0, toFinite(mapping === null || mapping === void 0 ? void 0 : mapping.scaleY, 1)) || 1;
      if (hasLayoutBounds) {
          const bx = toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.x, 0);
          const by = toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.y, 0);
          const bw = Math.max(1, toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.width, 1));
          const bh = Math.max(1, toFinite(layoutBounds === null || layoutBounds === void 0 ? void 0 : layoutBounds.height, 1));
          return {
              x: offsetX + bx * scaleX,
              y: offsetY + by * scaleY,
              width: Math.max(1, bw * scaleX),
              height: Math.max(1, bh * scaleY)
          };
      }
      const alignment = normalizeAlignment(layer.alignment);
      const posMode = (_m = alignment.positioning) !== null && _m !== void 0 ? _m : 'anchor';
      const fit = (_p = (_o = layer === null || layer === void 0 ? void 0 : layer.layoutMode) !== null && _o !== void 0 ? _o : alignment.fit) !== null && _p !== void 0 ? _p : 'none';
      const percentWithFallback = (() => {
          var _a;
          const raw = (_a = alignment.offsetPercent) !== null && _a !== void 0 ? _a : { x: 0, y: 0 };
          if (posMode !== 'auto') {
              return raw;
          }
          const x = Number.isFinite(raw.x) ? raw.x : axisToPercent(alignment.horizontal);
          const y = Number.isFinite(raw.y) ? raw.y : axisToPercent(alignment.vertical);
          return { x, y };
      })();
      const originalPercent = (_r = (_q = layer.alignment) === null || _q === void 0 ? void 0 : _q.offsetPercent) !== null && _r !== void 0 ? _r : null;
      const originalPercentX = originalPercent != null ? toFinite(originalPercent.x, Number.NaN) : Number.NaN;
      const originalPercentY = originalPercent != null ? toFinite(originalPercent.y, Number.NaN) : Number.NaN;
      const hasOriginalPercentX = Number.isFinite(originalPercentX);
      const hasOriginalPercentY = Number.isFinite(originalPercentY);
      const bounds = resolveBounds(layer, srcWidth, srcHeight, fallbackAnchor);
      const viewportSize = resolveAutoViewportSize(mapping);
      const normalizedMapping = { offsetX, offsetY, scaleX, scaleY };
      const hasMeaningfulBoundsX = Math.abs(bounds.x) > MIN_DIMENSION;
      const hasMeaningfulBoundsY = Math.abs(bounds.y) > MIN_DIMENSION;
      const percent = (() => {
          if (posMode !== 'auto') {
              return {
                  x: clampPercent(percentWithFallback.x),
                  y: clampPercent(percentWithFallback.y)
              };
          }
          const autoDerived = deriveAutoPercentOffset(bounds, normalizedMapping, viewportSize);
          const derivedX = clampPercent(autoDerived.x);
          const derivedY = clampPercent(autoDerived.y);
          const fallbackX = clampPercent(percentWithFallback.x);
          const fallbackY = clampPercent(percentWithFallback.y);
          const useOriginalX = hasOriginalPercentX && (!hasMeaningfulBoundsX || Math.abs(originalPercentX) > MIN_DIMENSION);
          const useOriginalY = hasOriginalPercentY && (!hasMeaningfulBoundsY || Math.abs(originalPercentY) > MIN_DIMENSION);
          return {
              x: useOriginalX
                  ? clampPercent(originalPercentX)
                  : (Number.isFinite(derivedX) ? derivedX : fallbackX),
              y: useOriginalY
                  ? clampPercent(originalPercentY)
                  : (Number.isFinite(derivedY) ? derivedY : fallbackY)
          };
      })();
      const context = {
          alignment,
          bounds,
          mapping: normalizedMapping,
          percent,
          posMode,
          viewport: viewportSize,
          baseWidth: bounds.width,
          baseHeight: bounds.height,
          srcWidth,
          srcHeight
      };
      const resolver = (_s = destinationResolvers[fit]) !== null && _s !== void 0 ? _s : destinationResolvers.default;
      const rect = resolver(context);
      return finalizeDestination(rect);
  };
  const AlignFitResolver = {
      normalizeAlignment,
      computeLayerTransform,
      computeLayerDestination,
      deriveAutoPercentOffset,
      clampPercent,
      resolveAutoViewportSize
  };


  return { normalizeAlignment, computeLayerTransform, computeLayerDestination };
})();
//alignFitResolver:end



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

    const contentSize = entry.alignment.fit === 'uniform'
      ? {
          width: Math.max(1, entry.surface.width),
          height: Math.max(1, entry.surface.height)
        }
      : entry.content ?? entry.surface;
    const transform = computeLayerTransform(contentSize, viewportForLayer, entry.alignment);

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
    const rawSurfaceWidth = toFinite(layer?.source?.width, NaN);
    const rawSurfaceHeight = toFinite(layer?.source?.height, NaN);
    const fallbackSurfaceWidth = Math.max(1, toFinite(layer?.bounds?.width, toFinite(layer?.placement?.width, 1)));
    const fallbackSurfaceHeight = Math.max(1, toFinite(layer?.bounds?.height, toFinite(layer?.placement?.height, 1)));
    const surfaceWidth = Math.max(1, Number.isFinite(rawSurfaceWidth) && rawSurfaceWidth > 0 ? rawSurfaceWidth : fallbackSurfaceWidth);
    const surfaceHeight = Math.max(1, Number.isFinite(rawSurfaceHeight) && rawSurfaceHeight > 0 ? rawSurfaceHeight : fallbackSurfaceHeight);
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
          const rawFallbackWidth = toFinite(layer?.source?.width, NaN);
          const rawFallbackHeight = toFinite(layer?.source?.height, NaN);
          const inferredWidth = Math.max(1, toFinite(layer?.placement?.width, 1));
          const inferredHeight = Math.max(1, toFinite(layer?.placement?.height, 1));
          const fallbackWidth = Math.max(1, Number.isFinite(rawFallbackWidth) && rawFallbackWidth > 0 ? rawFallbackWidth : inferredWidth);
          const fallbackHeight = Math.max(1, Number.isFinite(rawFallbackHeight) && rawFallbackHeight > 0 ? rawFallbackHeight : inferredHeight);
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

      const alignment = normalizeAlignment(layer.alignment);
      const posMode = alignment.positioning ?? 'anchor';

      const contentWidth = layer.contentBounds
        ? Math.max(1, toFinite(layer.contentBounds.width, placement.frame.width))
        : placement.frame.width;
      const contentHeight = layer.contentBounds
        ? Math.max(1, toFinite(layer.contentBounds.height, placement.frame.height))
        : placement.frame.height;

      const isUniformFit = alignment.fit === 'uniform';
      const uniformWidth = Math.max(1, toFinite(layer.source?.width, contentWidth));
      const uniformHeight = Math.max(1, toFinite(layer.source?.height, contentHeight));
      const sizeBasisWidth = isUniformFit ? uniformWidth : contentWidth;
      const sizeBasisHeight = isUniformFit ? uniformHeight : contentHeight;

      const anchor = alignment.horizontal === 'center' && alignment.vertical === 'center'
        ? 'center'
        : 'top-left';

      if (posMode === 'auto') {
        layer.bounds = {
          x: 0,
          y: 0,
          width: roundPlacementValue(sizeBasisWidth),
          height: roundPlacementValue(sizeBasisHeight),
          anchor
        };
        return;
      }

      const translateX = placement.frame.x + toFinite(placement.transform.translateX, 0);
      const translateY = placement.frame.y + toFinite(placement.transform.translateY, 0);
      const width = Math.max(1, sizeBasisWidth * toFinite(placement.transform.scaleX, 1));
      const height = Math.max(1, sizeBasisHeight * toFinite(placement.transform.scaleY, 1));

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
const applyLayerToContext = (ctx, source, layer, mapping, destinationOverride) => {
  if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
    return false;
  }

  const fit = layer?.layoutMode ?? layer?.alignment?.fit ?? 'none';
  const sourceWidth = source instanceof HTMLImageElement
    ? source.naturalWidth || source.width
    : source.width;
  const sourceHeight = source instanceof HTMLImageElement
    ? source.naturalHeight || source.height
    : source.height;
  const texW = sourceWidth;
  const texH = sourceHeight;

  const destination = destinationOverride ?? computeLayerDestination(layer, mapping);
  if (!destination) {
    return false;
  }

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  let sampleRegion = {
    x: sx,
    y: sy,
    width: sw,
    height: sh
  };

  if (fit === 'uniform') {
    const declaredWidth = Math.max(1, toFinite(layer?.source?.width, sourceWidth));
    const declaredHeight = Math.max(1, toFinite(layer?.source?.height, sourceHeight));
    sw = Math.min(declaredWidth, sourceWidth);
    sh = Math.min(declaredHeight, sourceHeight);
    sampleRegion = {
      x: sx,
      y: sy,
      width: sw,
      height: sh
    };
    const uniformScale = destination.width / Math.max(1, declaredWidth);
    diagnostics.log('UNIFORM MAP', {
      layerId: layer?.id,
      scales: {
        viewport: { x: mapping.scaleX, y: mapping.scaleY },
        uniform: uniformScale
      },
      canvas: {
        width: mapping.canvasWidth,
        height: mapping.canvasHeight
      },
      scaled: {
        width: destination.width,
        height: destination.height
      },
      leftover: {
        x: (mapping.canvasWidth ?? 0) - destination.width,
        y: (mapping.canvasHeight ?? 0) - destination.height
      },
      percent: layer?.alignment?.offsetPercent,
      sourceDeclared: layer?.source,
      textureActual: { texW, texH },
      destination
    });
  } else if (layer?.contentBounds) {
    const boundsRaw = layer.contentBounds;
    const clampedX = clamp(boundsRaw.x, 0, Math.max(0, sourceWidth - 1));
    const clampedY = clamp(boundsRaw.y, 0, Math.max(0, sourceHeight - 1));
    const maxWidth = Math.max(1, sourceWidth - clampedX);
    const maxHeight = Math.max(1, sourceHeight - clampedY);
    sx = clampedX;
    sy = clampedY;
    sw = Math.max(1, Math.min(boundsRaw.width, maxWidth));
    sh = Math.max(1, Math.min(boundsRaw.height, maxHeight));
    sampleRegion = {
      x: sx,
      y: sy,
      width: sw,
      height: sh
    };
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
    drawingFrom: sampleRegion,
    clampedSourceRect: sampleRegion,
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
    sx,
    sy,
    sw,
    sh,
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
    console.log('MAP', mapping);
    console.log('BOUNDS[0]', this.metadata.layers?.[0]?.bounds);
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
