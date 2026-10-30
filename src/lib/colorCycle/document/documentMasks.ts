import type { Layer } from '@/types';

import type { ColorCycleDocumentMask, ColorCycleLayerDocumentState } from './colorCycleDocumentContract';
import type { ColorCycleLayerDocument } from './ColorCycleLayerDocument';

const captureMask = (
  canvas: HTMLCanvasElement | undefined,
  image: ImageData | undefined,
  version: number | undefined,
  enabled?: boolean,
): ColorCycleDocumentMask | undefined => {
  if (!canvas && !image) return undefined;
  const source = canvas
    ? canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height)
    : image;
  if (!source) throw new Error('Could not capture color-cycle mask');
  const alpha = new Uint8ClampedArray(source.width * source.height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = source.data[index * 4 + 3];
  return { width: source.width, height: source.height, alpha, version: version ?? 0, enabled };
};

export const captureColorCycleDocumentMasks = (
  data: Layer['colorCycleData'],
): Pick<ColorCycleLayerDocumentState, 'eraseMask' | 'softEdgeMask'> => ({
  eraseMask: captureMask(data?.eraseMask, data?.eraseMaskImageData, data?.eraseMaskVersion),
  softEdgeMask: captureMask(data?.softEdgeMask, data?.softEdgeMaskImageData, data?.softEdgeMaskVersion,
    data?.softEdgeMaskEnabled !== false),
});

export const colorCycleDocumentMaskToImageData = (mask: ColorCycleDocumentMask | undefined): ImageData | undefined => {
  if (!mask) return undefined;
  const image = new ImageData(mask.width, mask.height);
  for (let index = 0; index < mask.alpha.length; index += 1) image.data[index * 4 + 3] = mask.alpha[index];
  return image;
};

export const projectColorCycleDocumentMasks = (
  snapshot: Pick<ColorCycleLayerDocumentState, 'eraseMask' | 'softEdgeMask'>,
): Partial<NonNullable<Layer['colorCycleData']>> => {
  const build = (mask: ColorCycleDocumentMask | undefined) => {
    const image = colorCycleDocumentMaskToImageData(mask);
    if (!image) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not project color-cycle mask');
    ctx.putImageData(image, 0, 0);
    return { image, canvas };
  };
  const erase = build(snapshot.eraseMask);
  const soft = build(snapshot.softEdgeMask);
  return {
    eraseMask: erase?.canvas,
    eraseMaskImageData: erase?.image,
    eraseMaskVersion: snapshot.eraseMask?.version,
    softEdgeMask: soft?.canvas,
    softEdgeMaskImageData: soft?.image,
    softEdgeMaskVersion: snapshot.softEdgeMask?.version,
    softEdgeMaskEnabled: snapshot.softEdgeMask?.enabled,
  };
};

// The layer is an authoring projection. Publish its metadata with the canonical
// channels before store subscribers (including persistence) can observe it.
export const publishColorCycleLayerMetadata = (
  document: ColorCycleLayerDocument | undefined,
  layer: Layer,
  reason: string,
  preserveVersion = false,
): void => {
  if (!document?.replaceState || layer.colorCycleData?.mode === 'recolor') return;
  const before = document.read();
  const data = layer.colorCycleData;
  document.replaceState({
    ...(document.readPreview?.() ?? before).snapshot,
    ...captureColorCycleDocumentMasks(data),
    slotPalettes: data?.slotPalettes,
    gradientDefs: data?.gradientDefs,
    gradientDefStore: data?.gradientDefStore,
    activeGradientId: data?.activeGradientId,
    paintSlot: data?.paintSlot,
    fgActiveSlot: data?.fgActiveSlot,
  }, reason, { pixelsChanged: false });
  if (preserveVersion) document.rebaseVersionAnchors({ version: before.version, pixelVersion: before.pixelVersion });
};
