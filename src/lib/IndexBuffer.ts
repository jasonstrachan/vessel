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
    // Always keep transparent at index 0
    this.palette = ['rgba(0,0,0,0)', ...colors];
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
      console.warn('[IndexBuffer] Invalid color:', color);
      return 0; // Return transparent index
    }
    
    // Check if color already exists
    const existingIndex = this.palette.indexOf(color);
    if (existingIndex !== -1) {
      return existingIndex;
    }
    
    // Add new color to palette
    const newIndex = this.palette.length;
    this.palette.push(color);
    // Don't parse color here - let it be parsed lazily during rendering
    
    return newIndex;
  }
  
  /**
   * Paint pixels with a circular brush
   */
  paint(x: number, y: number, brushSize: number, color: string) {
    const colorIndex = this.getColorIndex(color);
    const radius = brushSize / 2;
    const radiusSq = radius * radius;
    
    // Calculate bounds - use center of pixel for calculations
    const centerX = Math.floor(x);
    const centerY = Math.floor(y);
    
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(centerY + radius));
    
    // Paint circular area
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - x;  // Center of pixel
        const dy = py + 0.5 - y;  // Center of pixel
        
        // Check if pixel is within circle
        if (dx * dx + dy * dy <= radiusSq) {
          const index = py * this.width + px;
          this.data[index] = colorIndex;
        }
      }
    }
    
    this.isDirty = true;
  }
  
  /**
   * Paint pixels with a square brush
   */
  paintSquare(x: number, y: number, brushSize: number, color: string) {
    const colorIndex = this.getColorIndex(color);
    const halfSize = brushSize / 2;
    
    // Calculate bounds
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    
    // Paint square area
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const index = py * this.width + px;
        this.data[index] = colorIndex;
      }
    }
    
    this.isDirty = true;
  }
  
  /**
   * Draw a line between two points
   */
  paintLine(x0: number, y0: number, x1: number, y1: number, brushSize: number, color: string) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    
    // Use Bresenham's algorithm for line drawing
    while (true) {
      // Paint at current position
      this.paint(x, y, brushSize, color);
      
      if (x === x1 && y === y1) break;
      
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
    x = Math.floor(x);
    y = Math.floor(y);
    
    // Boundary check
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    
    const colorIndex = this.getColorIndex(color);
    const targetIndex = this.data[y * this.width + x];
    
    // Don't fill if same color
    if (targetIndex === colorIndex) return;
    
    // Stack-based flood fill
    const stack: Array<[number, number]> = [[x, y]];
    
    while (stack.length > 0) {
      const [fx, fy] = stack.pop()!;
      const index = fy * this.width + fx;
      
      // Skip if already filled or different color
      if (this.data[index] !== targetIndex) continue;
      
      // Fill this pixel
      this.data[index] = colorIndex;
      
      // Add neighbors to stack
      if (fx > 0) stack.push([fx - 1, fy]);
      if (fx < this.width - 1) stack.push([fx + 1, fy]);
      if (fy > 0) stack.push([fx, fy - 1]);
      if (fy < this.height - 1) stack.push([fx, fy + 1]);
    }
    
    this.isDirty = true;
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