export const toNum = (v: unknown, fb = 0): number => {
  const numeric = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(numeric) ? numeric : fb;
};
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round3 = (v: unknown): number => Math.round(toNum(v, 0) * 1000) / 1000;
export const posInt = (v: unknown, fb = 1): number => Math.max(1, Math.round(toNum(v, fb)));
