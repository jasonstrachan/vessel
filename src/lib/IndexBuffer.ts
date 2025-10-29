/**
 * IndexBuffer - Efficient pixel art drawing using indexed colors
 * Instead of WebGL texture, uses ImageData with Uint8Array for pixel indices
 */

export class IndexBuffer {
  private data: Uint8Array;
  private width: number;
  private height: number;
  private palette: string[];
  private isDirty: boolean = false;
  
  // Cache for converted RGBA values
  private rgbaCache: Map<number, [number, number, number, number]> = new Map();
  
  // Shared canvas for color parsing (performance optimization)
  private static colorParseCanvas: HTMLCanvasElement | null = null;
  private static colorParseCtx: CanvasRenderingContext2D | null = null;
  
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    // Initialize with zeros (transparent/no color)
    this.data = new Uint8Array(width * height);
    this.palette = ['rgba(0,0,0,0)']; // Index 0 = transparent
    
    // Pre-populate cache for transparent
    this.rgbaCache.set(0, [0, 0, 0, 0]);
  }
  
  /**
   * Set the color palette for this buffer
   */
  setPalette(colors: string[]) {
    // Always keep transparent at index 0 and clamp to Uint8 capacity (0-255)
    const limited = colors.length > 255 ? colors.slice(0, 255) : colors.slice();
    if (colors.length > 255) {
      // Ensure the final slot preserves the last gradient color
      limited[limited.length - 1] = colors[colors.length - 1];
    }
    this.palette = ['rgba(0,0,0,0)', ...limited];
    // Clear cache when palette changes
    this.rgbaCache.clear();
    this.rgbaCache.set(0, [0, 0, 0, 0]);

    // Don't pre-compute all colors - parse them lazily when needed
    // This avoids parsing 256 colors when gradient changes
    // Colors will be parsed on-demand during rendering
    
    this.isDirty = true;
  }
  
  /**
   * Parse color string to RGBA values and cache
   */
  private parseColorToRGBA(color: string, index: number): [number, number, number, number] {
    if (this.rgbaCache.has(index)) {
      return this.rgbaCache.get(index)!;
    }
    
    // Use shared canvas for performance (avoid creating 256 canvases!)
    if (!IndexBuffer.colorParseCanvas) {
      IndexBuffer.colorParseCanvas = document.createElement('canvas');
      IndexBuffer.colorParseCanvas.width = 1;
      IndexBuffer.colorParseCanvas.height = 1;
      IndexBuffer.colorParseCtx = IndexBuffer.colorParseCanvas.getContext('2d', { willReadFrequently: true });
    }
    
    const ctx = IndexBuffer.colorParseCtx;
    if (!ctx) {
      const rgba: [number, number, number, number] = [0, 0, 0, 255];
      this.rgbaCache.set(index, rgba);
      return rgba;
    }
    
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const rgba: [number, number, number, number] = [data[0], data[1], data[2], data[3]];
    this.rgbaCache.set(index, rgba);
    
    return rgba;
  }
  
  /**
   * Get color index from palette (adds if not found)
   */
  private getColorIndex(color: string): number {
    // Validate color input
    if (!color || typeof color !== 'string') {
      return 0; // Return transparent index
    }
    
    if (color.trim().toLowerCase() === 'transparent') {
      return 0;
    }
    
    // Check if color already exists
    const existingIndex = this.palette.indexOf(color);
    if (existingIndex !== -1) {
      return existingIndex;
    }
    
    if (this.palette.length >= 256) {
      // Palette is saturated; reuse the last non-transparent slot to avoid overflow
      return 255;
    }
    
    // Add new color to palette
    const newIndex = this.palette.length;
    this.palette.push(color);
    // Don't parse color here - let it be parsed lazily during rendering
    
    return newIndex;
  }

  private normalizeColorIndex(colorIndex: number): number {
    if (!Number.isFinite(colorIndex)) {
      return 0;
    }

    const clamped = Math.max(0, Math.min(255, Math.round(colorIndex)));
    if (this.palette.length <= 1) {
      return clamped;
    }

    const maxIndex = Math.min(255, this.palette.length - 1);
    return Math.max(0, Math.min(maxIndex, clamped));
  }

  private paintCircleInternal(x: number, y: number, brushSize: number, colorIndex: number) {
    const normalizedIndex = this.normalizeColorIndex(colorIndex);
    const radius = brushSize / 2;
    const radiusSq = radius * radius;

    const centerX = Math.floor(x);
    const centerY = Math.floor(y);

    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(centerY + radius));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;

        if (dx * dx + dy * dy <= radiusSq) {
          const dataIndex = py * this.width + px;
          this.data[dataIndex] = normalizedIndex;
        }
      }
    }
  }

  /**
   * Paint pixels with a circular brush
   */
  paint(x: number, y: number, brushSize: number, color: string) {
    // TODO(color-cycle): remove once all callers migrate to paintWithIndex.
    const colorIndex = this.getColorIndex(color);
    this.paintCircleInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }

  paintWithIndex(x: number, y: number, brushSize: number, colorIndex: number) {
    this.paintCircleInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }
  
  /**
   * Paint pixels with a square brush
   */
  paintSquare(x: number, y: number, brushSize: number, color: string) {
    // TODO(color-cycle): remove once all callers migrate to paintSquareWithIndex.
    const colorIndex = this.getColorIndex(color);
    this.paintSquareInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }

  paintSquareWithIndex(x: number, y: number, brushSize: number, colorIndex: number) {
    this.paintSquareInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }

  private paintSquareInternal(x: number, y: number, brushSize: number, colorIndex: number) {
    const normalizedIndex = this.normalizeColorIndex(colorIndex);
    const halfSize = brushSize / 2;

    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dataIndex = py * this.width + px;
        this.data[dataIndex] = normalizedIndex;
      }
    }
  }

  /**
   * Paint pixels with a triangle brush (isoceles, flat base)
   */
  paintTriangle(x: number, y: number, brushSize: number, color: string) {
    // TODO(color-cycle): remove once all callers migrate to paintTriangleWithIndex.
    const colorIndex = this.getColorIndex(color);
    this.paintTriangleInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }

  paintTriangleWithIndex(x: number, y: number, brushSize: number, colorIndex: number) {
    this.paintTriangleInternal(x, y, brushSize, colorIndex);
    this.isDirty = true;
  }

  private paintTriangleInternal(x: number, y: number, brushSize: number, colorIndex: number) {
    const normalizedIndex = this.normalizeColorIndex(colorIndex);
    const halfSize = brushSize / 2;

    const topX = x;
    const topY = y - halfSize;
    const leftX = x - halfSize;
    const leftY = y + halfSize;
    const rightX = x + halfSize;
    const rightY = y + halfSize;

    const minX = Math.max(0, Math.floor(Math.min(leftX, rightX, topX)));
    const maxX = Math.min(this.width - 1, Math.floor(Math.max(leftX, rightX, topX)));
    const minY = Math.max(0, Math.floor(Math.min(topY, leftY, rightY)));
    const maxY = Math.min(this.height - 1, Math.floor(Math.max(topY, leftY, rightY)));

    const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
      (px - bx) * (ay - by) - (ax - bx) * (py - by);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;

        const b1 = sign(sampleX, sampleY, topX, topY, leftX, leftY) <= 0;
        const b2 = sign(sampleX, sampleY, leftX, leftY, rightX, rightY) <= 0;
        const b3 = sign(sampleX, sampleY, rightX, rightY, topX, topY) <= 0;

        if ((b1 === b2) && (b2 === b3)) {
          const dataIndex = py * this.width + px;
          this.data[dataIndex] = normalizedIndex;
        }
      }
    }
  }

  /**
   * Draw a line between two points
   */
  paintLine(x0: number, y0: number, x1: number, y1: number, brushSize: number, color: string) {
    // TODO(color-cycle): remove once all callers migrate to paintLineWithIndex.
    const colorIndex = this.getColorIndex(color);
    this.paintLineInternal(x0, y0, x1, y1, brushSize, colorIndex);
    this.isDirty = true;
  }

  paintLineWithIndex(x0: number, y0: number, x1: number, y1: number, brushSize: number, colorIndex: number) {
    this.paintLineInternal(x0, y0, x1, y1, brushSize, colorIndex);
    this.isDirty = true;
  }

  private paintLineInternal(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    brushSize: number,
    colorIndex: number
  ) {
    const normalizedIndex = this.normalizeColorIndex(colorIndex);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      this.paintCircleInternal(x, y, brushSize, normalizedIndex);

      if (x === x1 && y === y1) {
        break;
      }

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Fill an area with a color (flood fill)
   */
  fill(x: number, y: number, color: string) {
    // TODO(color-cycle): remove once all callers migrate to fillWithIndex.
    const colorIndex = this.getColorIndex(color);
    if (this.fillInternal(x, y, colorIndex)) {
      this.isDirty = true;
    }
  }

  fillWithIndex(x: number, y: number, colorIndex: number) {
    if (this.fillInternal(x, y, colorIndex)) {
      this.isDirty = true;
    }
  }

  private fillInternal(x: number, y: number, colorIndex: number): boolean {
    x = Math.floor(x);
    y = Math.floor(y);

    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }

    const normalizedIndex = this.normalizeColorIndex(colorIndex);
    const targetIndex = this.data[y * this.width + x];

    if (targetIndex === normalizedIndex) {
      return false;
    }

    const stack: Array<[number, number]> = [[x, y]];
    let filled = false;

    while (stack.length > 0) {
      const [fx, fy] = stack.pop()!;
      const dataIndex = fy * this.width + fx;

      if (this.data[dataIndex] !== targetIndex) {
        continue;
      }

      this.data[dataIndex] = normalizedIndex;
      filled = true;

      if (fx > 0) stack.push([fx - 1, fy]);
      if (fx < this.width - 1) stack.push([fx + 1, fy]);
      if (fy > 0) stack.push([fx, fy - 1]);
      if (fy < this.height - 1) stack.push([fx, fy + 1]);
    }

    return filled;
  }
  
  /**
   * Clear the buffer
   */
  clear() {
    this.data.fill(0);
    this.isDirty = true;
  }
  
  /**
   * Clear a rectangular area
   */
  clearRect(x: number, y: number, width: number, height: number) {
    const minX = Math.max(0, Math.floor(x));
    const maxX = Math.min(this.width - 1, Math.floor(x + width - 1));
    const minY = Math.max(0, Math.floor(y));
    const maxY = Math.min(this.height - 1, Math.floor(y + height - 1));
    
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        this.data[py * this.width + px] = 0;
      }
    }
    
    this.isDirty = true;
  }
  
  /**
   * Convert index buffer to ImageData using current palette
   */
  getImageData(ctx?: CanvasRenderingContext2D): ImageData {
    // Create or use provided context
    if (!ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      ctx = canvas.getContext('2d')!;
    }
    
    const imageData = ctx.createImageData(this.width, this.height);
    const pixels = imageData.data;
    
    // Convert indices to RGBA
    for (let i = 0; i < this.data.length; i++) {
      const colorIndex = this.data[i];
      
      // Lazy parse color if not in cache
      let rgba = this.rgbaCache.get(colorIndex);
      if (!rgba && colorIndex < this.palette.length) {
        rgba = this.parseColorToRGBA(this.palette[colorIndex], colorIndex);
      }
      if (!rgba) {
        rgba = [0, 0, 0, 0];
      }
      
      const pixelIndex = i * 4;
      pixels[pixelIndex] = rgba[0];
      pixels[pixelIndex + 1] = rgba[1];
      pixels[pixelIndex + 2] = rgba[2];
      pixels[pixelIndex + 3] = rgba[3];
    }
    
    this.isDirty = false;
    return imageData;
  }
  
  /**
   * Draw the buffer to a canvas context
   */
  render(ctx: CanvasRenderingContext2D, x: number = 0, y: number = 0) {
    if (!this.isDirty && !this.lastImageData) return;
    
    const imageData = this.getImageData(ctx);
    ctx.putImageData(imageData, x, y);
  }
  
  private lastImageData?: ImageData;
  
  /**
   * Get pixel index at position
   */
  getPixel(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return 0;
    }
    return this.data[y * this.width + x];
  }
  
  /**
   * Set pixel index at position
   */
  setPixel(x: number, y: number, colorIndex: number) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    this.data[y * this.width + x] = colorIndex;
    this.isDirty = true;
  }
  
  /**
   * Get the current palette
   */
  getPalette(): string[] {
    return [...this.palette];
  }
  
  /**
   * Get buffer dimensions
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
  
  /**
   * Check if buffer needs redraw
   */
  needsRedraw(): boolean {
    return this.isDirty;
  }
  
  /**
   * Clone the buffer
   */
  clone(): IndexBuffer {
    const newBuffer = new IndexBuffer(this.width, this.height);
    newBuffer.data = new Uint8Array(this.data);
    newBuffer.palette = [...this.palette];
    newBuffer.isDirty = this.isDirty;
    
    // Clone the cache
    this.rgbaCache.forEach((value, key) => {
      newBuffer.rgbaCache.set(key, [...value] as [number, number, number, number]);
    });
    
    return newBuffer;
  }
  
  /**
   * Resize the buffer
   */
  resize(newWidth: number, newHeight: number) {
    const newData = new Uint8Array(newWidth * newHeight);
    
    // Copy existing data
    const copyWidth = Math.min(this.width, newWidth);
    const copyHeight = Math.min(this.height, newHeight);
    
    for (let y = 0; y < copyHeight; y++) {
      for (let x = 0; x < copyWidth; x++) {
        const oldIndex = y * this.width + x;
        const newIndex = y * newWidth + x;
        newData[newIndex] = this.data[oldIndex];
      }
    }
    
    this.data = newData;
    this.width = newWidth;
    this.height = newHeight;
    this.isDirty = true;
  }
  
  /**
   * Get direct access to the internal data buffer (no copy)
   * Use with caution - modifying this directly will affect the buffer
   */
  getDirectData(): Uint8Array {
    return this.data;
  }
  
  /**
   * Export buffer data for serialization
   */
  serialize(): {
    width: number;
    height: number;
    data: Uint8Array;
    palette: string[];
  } {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8Array(this.data),
      palette: [...this.palette]
    };
  }
  
  /**
   * Import buffer data from serialization
   */
  static deserialize(data: {
    width: number;
    height: number;
    data: Uint8Array;
    palette: string[];
  }): IndexBuffer {
    const buffer = new IndexBuffer(data.width, data.height);
    buffer.data = new Uint8Array(data.data);
    buffer.palette = [...data.palette];
    buffer.isDirty = true;
    
    // Rebuild cache
    for (let i = 0; i < buffer.palette.length; i++) {
      buffer.parseColorToRGBA(buffer.palette[i], i);
    }
    
    return buffer;
  }
}
