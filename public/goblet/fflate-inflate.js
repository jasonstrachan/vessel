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

export const inflateRaw = (input) => {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('inflateRaw expects a Uint8Array');
  }
  return inflt(input, { i: 2 });
};

export default inflateRaw;
