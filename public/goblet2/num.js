export const toNum = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round3 = (v) => Math.round(toNum(v, 0) * 1000) / 1000;
export const posInt = (v, fb = 1) => Math.max(1, Math.round(toNum(v, fb)));
