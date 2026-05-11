import type { Rectangle } from '@/types';

export interface FloatingPasteRasterSource {
  imageData: ImageData | null;
  width: number;
  height: number;
  position: { x: number; y: number };
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
}

export interface FloatingPasteRasterProject {
  width: number;
  height: number;
}

export interface FloatingPasteFloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingPasteRasterResult {
  canvas: HTMLCanvasElement;
  roi: Rectangle;
  destinationRect: FloatingPasteFloatRect;
  rotatedBounds: FloatingPasteFloatRect;
}

export const getFloatingPasteDestinationRect = (
  source: FloatingPasteRasterSource
): FloatingPasteFloatRect => ({
  x: source.position.x,
  y: source.position.y,
  width: Math.max(1, source.displayWidth ?? source.width),
  height: Math.max(1, source.displayHeight ?? source.height),
});

export const getFloatingPasteRotatedBounds = (
  rect: FloatingPasteFloatRect,
  rotation = 0
): FloatingPasteFloatRect => {
  if (!rotation) {
    return rect;
  }

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const width = Math.abs(rect.width * cos) + Math.abs(rect.height * sin);
  const height = Math.abs(rect.width * sin) + Math.abs(rect.height * cos);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
};

export const intersectFloatingPasteBoundsWithProject = (
  rect: FloatingPasteFloatRect,
  project: FloatingPasteRasterProject
): Rectangle | null => {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(project.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(project.height, Math.ceil(rect.y + rect.height));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x: left, y: top, width, height };
};

const getSourcePixel = (
  source: FloatingPasteRasterSource & { imageData: ImageData },
  sourceX: number,
  sourceY: number
): [number, number, number, number] => {
  const x = Math.max(0, Math.min(source.width - 1, sourceX));
  const y = Math.max(0, Math.min(source.height - 1, sourceY));
  const index = (y * source.imageData.width + x) * 4;
  return [
    source.imageData.data[index] ?? 0,
    source.imageData.data[index + 1] ?? 0,
    source.imageData.data[index + 2] ?? 0,
    source.imageData.data[index + 3] ?? 0,
  ];
};

export const rasterizeFloatingPasteBitmap = (
  source: FloatingPasteRasterSource,
  project: FloatingPasteRasterProject
): FloatingPasteRasterResult | null => {
  if (!source.imageData) {
    return null;
  }
  const rasterSource = { ...source, imageData: source.imageData };

  const destinationRect = getFloatingPasteDestinationRect(rasterSource);
  const rotation = rasterSource.rotation ?? 0;
  const rotatedBounds = getFloatingPasteRotatedBounds(destinationRect, rotation);
  const roi = intersectFloatingPasteBoundsWithProject(rotatedBounds, project);
  if (!roi) {
    return null;
  }

  const output = new ImageData(roi.width, roi.height);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  const centerX = destinationRect.x + destinationRect.width / 2;
  const centerY = destinationRect.y + destinationRect.height / 2;
  const safeSourceWidth = Math.max(1, rasterSource.width);
  const safeSourceHeight = Math.max(1, rasterSource.height);

  for (let y = 0; y < roi.height; y += 1) {
    const worldY = roi.y + y + 0.5;
    for (let x = 0; x < roi.width; x += 1) {
      const worldX = roi.x + x + 0.5;
      const relX = worldX - centerX;
      const relY = worldY - centerY;
      const unrotatedX = relX * cos - relY * sin + centerX;
      const unrotatedY = relX * sin + relY * cos + centerY;
      const localX = unrotatedX - destinationRect.x;
      const localY = unrotatedY - destinationRect.y;

      if (
        localX < 0 ||
        localY < 0 ||
        localX >= destinationRect.width ||
        localY >= destinationRect.height
      ) {
        continue;
      }

      const sourceX = Math.min(
        safeSourceWidth - 1,
        Math.floor((localX * safeSourceWidth) / destinationRect.width)
      );
      const sourceY = Math.min(
        safeSourceHeight - 1,
        Math.floor((localY * safeSourceHeight) / destinationRect.height)
      );
      const [r, g, b, a] = getSourcePixel(rasterSource, sourceX, sourceY);
      const index = (y * roi.width + x) * 4;
      output.data[index] = r;
      output.data[index + 1] = g;
      output.data[index + 2] = b;
      output.data[index + 3] = a;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = roi.width;
  canvas.height = roi.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.putImageData(output, 0, 0);

  return {
    canvas,
    roi,
    destinationRect,
    rotatedBounds,
  };
};
