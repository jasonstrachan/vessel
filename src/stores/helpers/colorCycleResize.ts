import type {
  ColorCycleLayerDocumentSnapshot,
  ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

const scaleUint8Nearest = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): ArrayBuffer => {
  const scaled = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }
  return scaled.buffer;
};

const scaleUint16Nearest = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): ArrayBuffer => {
  const scaled = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }
  return scaled.buffer;
};

const scaleExactUint8Buffer = (
  buffer: ArrayBuffer | undefined,
  sourcePixels: number,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  name: string,
): ArrayBuffer | undefined => {
  if (!buffer) {
    return undefined;
  }
  const source = new Uint8Array(buffer);
  if (source.length !== sourcePixels) {
    throw new Error(`Cannot resize color-cycle ${name}: expected ${sourcePixels} values, received ${source.length}.`);
  }
  return scaleUint8Nearest(source, sourceWidth, sourceHeight, width, height);
};

const scaleExactUint16Buffer = (
  buffer: ArrayBuffer | undefined,
  sourcePixels: number,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  name: string,
): ArrayBuffer | undefined => {
  if (!buffer) {
    return undefined;
  }
  const source = new Uint16Array(buffer);
  if (source.length !== sourcePixels) {
    throw new Error(`Cannot resize color-cycle ${name}: expected ${sourcePixels} values, received ${source.length}.`);
  }
  return scaleUint16Nearest(source, sourceWidth, sourceHeight, width, height);
};

export const scaleColorCycleDocumentStateNearest = ({
  snapshot,
  width,
  height,
}: {
  snapshot: ColorCycleLayerDocumentSnapshot;
  width: number;
  height: number;
}): ColorCycleLayerDocumentState => {
  const sourceWidth = Math.max(1, Math.floor(snapshot.width));
  const sourceHeight = Math.max(1, Math.floor(snapshot.height));
  const targetWidth = Math.max(1, Math.floor(width));
  const targetHeight = Math.max(1, Math.floor(height));
  const sourcePixels = sourceWidth * sourceHeight;

  return {
    ...snapshot,
    width: targetWidth,
    height: targetHeight,
    paintBuffer: scaleExactUint8Buffer(
      snapshot.paintBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'paint buffer',
    ),
    gradientIdBuffer: scaleExactUint8Buffer(
      snapshot.gradientIdBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'gradient-id buffer',
    ),
    gradientDefIdBuffer: scaleExactUint16Buffer(
      snapshot.gradientDefIdBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'gradient-definition buffer',
    ),
    speedBuffer: scaleExactUint8Buffer(
      snapshot.speedBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'speed buffer',
    ),
    flowBuffer: scaleExactUint8Buffer(
      snapshot.flowBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'flow buffer',
    ),
    phaseBuffer: scaleExactUint8Buffer(
      snapshot.phaseBuffer,
      sourcePixels,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      'phase buffer',
    ),
    sources: { ...snapshot.sources },
  };
};
