/** Palette position for a band measured in canvas pixels, independent of mark size. */
export const distanceBandPosition = (distance: number, spacing: number, bands: number): number => {
  const count = Math.max(2, Math.min(254, Math.floor(bands)));
  const band = Math.floor(Math.max(0, distance) / Math.max(1, spacing));
  return (band % count) / (count - 1);
};
