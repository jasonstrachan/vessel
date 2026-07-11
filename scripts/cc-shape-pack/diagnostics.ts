import sharp from 'sharp';

import type { CcShapePackingResult } from '@/lib/colorCycle/shapePacking';

const COLORS = ['#ff5f57', '#febc2e', '#28c840', '#4f8cff', '#af52de', '#ff2d55', '#64d2ff'];

export const buildPackingReport = (
  packing: CcShapePackingResult,
  selectedLayerIds: readonly string[],
): string => JSON.stringify({
  selectedLayerIds,
  metrics: packing.metrics,
  placements: packing.placements.map((placement) => ({
    shapeId: placement.shapeId,
    layerId: placement.layerId,
    sourceBounds: placement.rotated.source.sourceBounds,
    destination: {
      x: placement.x,
      y: placement.y,
      width: placement.rotated.width,
      height: placement.rotated.height,
    },
    rotation: placement.rotation,
    area: placement.rotated.source.area,
    supportShapeIds: placement.supportShapeIds,
    supportSpan: placement.supportSpan,
    stabilityMargin: Number.isFinite(placement.stabilityMargin)
      ? placement.stabilityMargin
      : null,
  })),
}, null, 2);

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export type PackedPreviewSource = Readonly<{
  width: number;
  height: number;
  rgba: Uint8Array;
}>;

const sourceCoordinateForRotatedPixel = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } => {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: y, y: height - 1 - x };
    case 180: return { x: width - 1 - x, y: height - 1 - y };
    case 270: return { x: width - 1 - y, y: x };
  }
};

/** Renders the saved source pixels at their packed locations for visual proof. */
export const buildRenderedPackingPng = async (
  packing: CcShapePackingResult,
  canvasWidth: number,
  canvasHeight: number,
  sourceByLayerId: ReadonlyMap<string, PackedPreviewSource>,
): Promise<Uint8Array | null> => {
  if (sourceByLayerId.size === 0) return null;
  const rgba = new Uint8Array(canvasWidth * canvasHeight * 4);
  let copiedPixels = 0;
  for (const placement of packing.placements) {
    const sourcePreview = sourceByLayerId.get(placement.layerId);
    if (!sourcePreview) continue;
    const shape = placement.rotated.source;
    placement.rotated.mask.forEach((visible, index) => {
      if (!visible) return;
      const localX = index % placement.rotated.width;
      const localY = Math.floor(index / placement.rotated.width);
      const sourceLocal = sourceCoordinateForRotatedPixel(
        localX,
        localY,
        shape.width,
        shape.height,
        placement.rotation,
      );
      const sourceX = shape.sourceBounds.x + sourceLocal.x;
      const sourceY = shape.sourceBounds.y + sourceLocal.y;
      const destinationX = placement.x + localX;
      const destinationY = placement.y + localY;
      if (
        sourceX < 0 || sourceY < 0 || sourceX >= sourcePreview.width || sourceY >= sourcePreview.height ||
        destinationX < 0 || destinationY < 0 || destinationX >= canvasWidth || destinationY >= canvasHeight
      ) return;
      const sourceOffset = (sourceY * sourcePreview.width + sourceX) * 4;
      const destinationOffset = (destinationY * canvasWidth + destinationX) * 4;
      rgba.set(sourcePreview.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
      copiedPixels += 1;
    });
  }
  if (copiedPixels === 0) return null;
  return new Uint8Array(await sharp(rgba, {
    raw: { width: canvasWidth, height: canvasHeight, channels: 4 },
  }).png().toBuffer());
};

export const buildPackingSvg = (
  packing: CcShapePackingResult,
  canvasWidth: number,
  canvasHeight: number,
): string => {
  const placementById = new Map(packing.placements.map((placement) => [placement.shapeId, placement] as const));
  const supportLines = packing.placements.flatMap((placement) => {
    const fromX = placement.x + placement.rotated.centerOfMass.x;
    const fromY = placement.y + placement.rotated.height;
    if (placement.supportShapeIds.length === 0) {
      return [`<line x1="${fromX}" y1="${fromY}" x2="${fromX}" y2="${canvasHeight}" stroke="#ffffff80" stroke-width="0.2" stroke-dasharray="0.5 0.5"/>`];
    }
    return placement.supportShapeIds.map((supportId) => {
      const support = placementById.get(supportId);
      if (!support) return '';
      const toX = support.x + support.rotated.centerOfMass.x;
      return `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${support.y}" stroke="#ffffff80" stroke-width="0.2" stroke-dasharray="0.5 0.5"/>`;
    });
  }).join('');
  const shapes = packing.placements.map((placement, placementIndex) => {
    const color = COLORS[placementIndex % COLORS.length];
    const pixels: string[] = [];
    placement.rotated.mask.forEach((value, index) => {
      if (!value) return;
      const x = placement.x + index % placement.rotated.width;
      const y = placement.y + Math.floor(index / placement.rotated.width);
      pixels.push(`M${x} ${y}h1v1h-1z`);
    });
    return [
      `<path d="${pixels.join('')}" fill="${color}"/>`,
      `<rect x="${placement.x - 1}" y="${placement.y - 1}" width="${placement.rotated.width + 2}" height="${placement.rotated.height + 2}" fill="none" stroke="${color}80" stroke-width="0.15" stroke-dasharray="0.4 0.4"/>`,
      `<rect x="${placement.x}" y="${placement.y}" width="${placement.rotated.width}" height="${placement.rotated.height}" fill="none" stroke="${color}" stroke-width="0.2"/>`,
      `<text x="${placement.x}" y="${Math.max(0.8, placement.y - 0.25)}" font-size="1" fill="${color}">${escapeXml(placement.shapeId)} · ${placement.rotation}°</text>`,
    ].join('');
  }).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#101114"/>',
    supportLines,
    shapes,
    `<line x1="0" y1="${canvasHeight}" x2="${canvasWidth}" y2="${canvasHeight}" stroke="#fff" stroke-width="0.4"/>`,
    '</svg>',
  ].join('');
};

export const buildSourceSvg = (
  packing: CcShapePackingResult,
  canvasWidth: number,
  canvasHeight: number,
): string => {
  const shapes = packing.placements.map((placement, placementIndex) => {
    const source = placement.rotated.source;
    const color = COLORS[placementIndex % COLORS.length];
    const pixels: string[] = [];
    source.mask.forEach((value, index) => {
      if (!value) return;
      const x = source.sourceBounds.x + index % source.width;
      const y = source.sourceBounds.y + Math.floor(index / source.width);
      pixels.push(`M${x} ${y}h1v1h-1z`);
    });
    return `<path d="${pixels.join('')}" fill="${color}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#101114"/>${shapes}</svg>`;
};

export const buildContactSheetSvg = (packing: CcShapePackingResult): string => {
  const padding = 2;
  const labelHeight = 2;
  const rowWidths = packing.placements.map((placement) => (
    placement.rotated.source.width + placement.rotated.width + padding * 3
  ));
  const rowHeights = packing.placements.map((placement) => (
    Math.max(placement.rotated.source.height, placement.rotated.height) + padding + labelHeight
  ));
  const width = Math.max(1, ...rowWidths);
  const height = Math.max(1, rowHeights.reduce((total, value) => total + value, padding));
  let rowY = padding;
  const rows = packing.placements.map((placement, placementIndex) => {
    const source = placement.rotated.source;
    const color = COLORS[placementIndex % COLORS.length];
    const sourcePixels: string[] = [];
    const rotatedPixels: string[] = [];
    source.mask.forEach((value, index) => {
      if (!value) return;
      sourcePixels.push(`M${padding + index % source.width} ${rowY + labelHeight + Math.floor(index / source.width)}h1v1h-1z`);
    });
    const rotatedX = padding * 2 + source.width;
    placement.rotated.mask.forEach((value, index) => {
      if (!value) return;
      rotatedPixels.push(`M${rotatedX + index % placement.rotated.width} ${rowY + labelHeight + Math.floor(index / placement.rotated.width)}h1v1h-1z`);
    });
    const row = [
      `<text x="${padding}" y="${rowY + 1}" font-size="1" fill="${color}">${escapeXml(placement.shapeId)} source → ${placement.rotation}°</text>`,
      `<path d="${sourcePixels.join('')}" fill="${color}"/>`,
      `<path d="${rotatedPixels.join('')}" fill="${color}"/>`,
    ].join('');
    rowY += Math.max(source.height, placement.rotated.height) + padding + labelHeight;
    return row;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#101114"/>${rows}</svg>`;
};
