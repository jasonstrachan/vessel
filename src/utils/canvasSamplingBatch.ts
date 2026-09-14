type SamplingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type ReadbackBatch = Map<SamplingContext, Map<string, ImageData>>;

const TILE_SIZE = 256;
let activeBatch: ReadbackBatch | null = null;

/** A synchronous sampling pass sees one snapshot per tile; nothing survives the pass. */
export const withCanvasSamplingBatch = <T>(sample: () => T): T => {
  if (activeBatch) return sample();
  activeBatch = new Map();
  try {
    return sample();
  } finally {
    activeBatch = null;
  }
};

export const readCanvasSamplingRegion = (
  context: SamplingContext,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray => {
  if (!activeBatch) return context.getImageData(x, y, width, height).data;
  let tiles = activeBatch.get(context);
  if (!tiles) {
    tiles = new Map();
    activeBatch.set(context, tiles);
  }
  const result = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const px = x + column;
      const py = y + row;
      const tileX = Math.floor(px / TILE_SIZE) * TILE_SIZE;
      const tileY = Math.floor(py / TILE_SIZE) * TILE_SIZE;
      const key = `${tileX}:${tileY}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = context.getImageData(tileX, tileY,
          Math.min(TILE_SIZE, context.canvas.width - tileX),
          Math.min(TILE_SIZE, context.canvas.height - tileY));
        tiles.set(key, tile);
      }
      const source = ((py - tileY) * tile.width + px - tileX) * 4;
      const target = (row * width + column) * 4;
      for (let channel = 0; channel < 4; channel++) result[target + channel] = tile.data[source + channel];
    }
  }
  return result;
};
