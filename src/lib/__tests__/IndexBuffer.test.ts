import { IndexBuffer } from '../IndexBuffer';

describe('IndexBuffer', () => {
  let buffer: IndexBuffer;

  beforeEach(() => {
    buffer = new IndexBuffer(100, 100);
  });

  const collectFilledPixels = () => {
    const { width, height } = buffer.getDimensions();
    const filled: Array<{ x: number; y: number; index: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = buffer.getPixel(x, y);
        if (index > 0) {
          filled.push({ x, y, index });
        }
      }
    }
    return filled;
  };

  const distanceFrom = (x: number, y: number, cx: number, cy: number) => {
    return Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  };

  describe('initialization', () => {
    it('should create buffer with correct dimensions', () => {
      const { width, height } = buffer.getDimensions();
      expect(width).toBe(100);
      expect(height).toBe(100);
    });
    
    it('should initialize with transparent palette', () => {
      const palette = buffer.getPalette();
      expect(palette[0]).toBe('rgba(0,0,0,0)');
      expect(palette.length).toBe(1);
    });
    
    it('should initialize all pixels as transparent', () => {
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          expect(buffer.getPixel(x, y)).toBe(0);
        }
      }
    });
  });
  
  describe('palette management', () => {
    it('should set palette correctly', () => {
      const colors = ['#ff0000', '#00ff00', '#0000ff'];
      buffer.setPalette(colors);
      
      const palette = buffer.getPalette();
      expect(palette[0]).toBe('rgba(0,0,0,0)'); // Still transparent at 0
      expect(palette[1]).toBe('#ff0000');
      expect(palette[2]).toBe('#00ff00');
      expect(palette[3]).toBe('#0000ff');
    });
    
    it('should mark buffer as dirty when palette changes', () => {
      buffer.setPalette(['#ff0000']);
      expect(buffer.needsRedraw()).toBe(true);
    });

    it('should keep high-index colors addressable without wrapping to transparent', () => {
      const colors = Array.from({ length: 256 }, (_, i) => `rgba(${i % 256}, ${(255 - i) % 256}, ${(i * 13) % 256}, 1)`);
      buffer.setPalette(colors);
      const palette = buffer.getPalette();
      expect(palette.length).toBe(256);
      expect(palette[255]).toBe(colors[255]);

      buffer.paintSquare(10, 10, 1, colors[255]);
      expect(buffer.getPixel(10, 10)).toBe(255);

      buffer.paintSquare(12, 10, 1, colors[254]);
      expect(buffer.getPixel(12, 10)).toBe(255);
    });
  });
  
  describe('painting operations', () => {
    beforeEach(() => {
      buffer.setPalette(['#ff0000', '#00ff00', '#0000ff']);
    });
    
    it('should paint circular brush within expected radius', () => {
      const centerX = 50;
      const centerY = 50;
      const brushSize = 10;
      const radius = brushSize / 2;

      buffer.paint(centerX, centerY, brushSize, '#ff0000');

      const filled = collectFilledPixels();
      expect(filled.length).toBeGreaterThan(0);
      expect(buffer.getPixel(centerX, centerY)).toBe(1);

      const maxDistance = Math.max(...filled.map(pixel => distanceFrom(pixel.x, pixel.y, centerX, centerY)));
      const minDistance = Math.min(...filled.map(pixel => distanceFrom(pixel.x, pixel.y, centerX, centerY)));

      expect(maxDistance).toBeLessThanOrEqual(radius + 0.75);
      expect(minDistance).toBeLessThanOrEqual(0.75);

      const nearBoundary = filled.some(pixel => {
        const d = distanceFrom(pixel.x, pixel.y, centerX, centerY);
        return d >= radius - 1 && d <= radius + 0.75;
      });
      expect(nearBoundary).toBe(true);

      expect(buffer.getPixel(40, centerY)).toBe(0);
      expect(buffer.getPixel(60, centerY)).toBe(0);
    });
    
    it('should paint square brush correctly', () => {
      buffer.paintSquare(50, 50, 10, '#00ff00');
      
      // Check corners are painted
      expect(buffer.getPixel(45, 45)).toBe(2); // Green index
      expect(buffer.getPixel(55, 45)).toBe(2);
      expect(buffer.getPixel(45, 55)).toBe(2);
      expect(buffer.getPixel(55, 55)).toBe(2);
      
      // Check outside square
      expect(buffer.getPixel(44, 44)).toBe(0);
      expect(buffer.getPixel(56, 56)).toBe(0);
    });

    it('should honor stamp masks when painting squares', () => {
      const tileSize = 2;
      const mask = new Uint8Array([1, 0, 0, 1]); // simple checker
      const centerX = 50;
      const centerY = 50;
      const brushSize = 4;

      buffer.paintSquareWithIndex(centerX, centerY, brushSize, 2, mask, tileSize);

      const half = brushSize / 2;
      const minX = Math.max(0, Math.floor(centerX - half));
      const maxX = Math.min(99, Math.floor(centerX + half));
      const minY = Math.max(0, Math.floor(centerY - half));
      const maxY = Math.min(99, Math.floor(centerY + half));
      const totalArea = (maxX - minX + 1) * (maxY - minY + 1);

      const filled = collectFilledPixels().filter(
        (pixel) =>
          pixel.index === 2 &&
          pixel.x >= minX &&
          pixel.x <= maxX &&
          pixel.y >= minY &&
          pixel.y <= maxY
      );

      expect(filled.length).toBeGreaterThan(0);
      expect(filled.length).toBeLessThan(totalArea);
      // Ensure mask leaves gaps in a checker pattern
      expect(buffer.getPixel(minX, minY)).toBe(2);
      expect(buffer.getPixel(minX + 1, minY)).toBe(0);
    });
    
    it('should paint line correctly', () => {
      buffer.paintLine(10, 10, 90, 10, 2, '#0000ff');
      
      // Check line is painted
      for (let x = 10; x <= 90; x++) {
        expect(buffer.getPixel(x, 10)).toBe(3); // Blue index
      }
      
      // Check above/below line
      expect(buffer.getPixel(50, 8)).toBe(0);
      expect(buffer.getPixel(50, 12)).toBe(0);
    });

    it('should handle boundary clipping', () => {
      buffer.paint(-5, 50, 10, '#ff0000');
      buffer.paint(105, 50, 10, '#ff0000');
      buffer.paint(50, -5, 10, '#ff0000');
      buffer.paint(50, 105, 10, '#ff0000');

      const filled = collectFilledPixels();
      expect(filled.length).toBe(0);
    });
  });

  describe('index-based helpers', () => {
    beforeEach(() => {
      buffer.setPalette(['#111111', '#222222', '#333333']);
    });

    it('should paint directly with indices without expanding the palette', () => {
      const beforePaletteSize = buffer.getPalette().length;
      expect(beforePaletteSize).toBe(4);

      buffer.paintWithIndex(25, 25, 6, 2);

      expect(buffer.getPixel(25, 25)).toBe(2);
      expect(buffer.needsRedraw()).toBe(true);
      expect(buffer.getPalette().length).toBe(beforePaletteSize);
    });

    it('should clamp indices outside the palette range', () => {
      buffer.paintSquareWithIndex(40, 40, 4, 240);
      expect(buffer.getPixel(40, 40)).toBe(3);
    });

    it('should flood fill using numeric indices', () => {
      for (let x = 10; x <= 30; x++) {
        buffer.setPixel(x, 10, 1);
        buffer.setPixel(x, 30, 1);
      }
      for (let y = 10; y <= 30; y++) {
        buffer.setPixel(10, y, 1);
        buffer.setPixel(30, y, 1);
      }

      buffer.fillWithIndex(20, 20, 200);

      expect(buffer.getPixel(20, 20)).toBe(3);
      expect(buffer.getPixel(11, 11)).toBe(3);
      expect(buffer.getPixel(9, 9)).toBe(0);
    });
  });

  describe('fill operation', () => {
    beforeEach(() => {
      buffer.setPalette(['#ff0000', '#00ff00', '#0000ff']);
    });
    
    it('should flood fill area correctly', () => {
      // Create a closed shape
      for (let x = 20; x <= 80; x++) {
        buffer.setPixel(x, 20, 1); // Top
        buffer.setPixel(x, 80, 1); // Bottom
      }
      for (let y = 20; y <= 80; y++) {
        buffer.setPixel(20, y, 1); // Left
        buffer.setPixel(80, y, 1); // Right
      }
      
      // Fill inside
      buffer.fill(50, 50, '#00ff00');
      
      // Check inside is filled
      expect(buffer.getPixel(50, 50)).toBe(2); // Green
      expect(buffer.getPixel(30, 30)).toBe(2);
      expect(buffer.getPixel(70, 70)).toBe(2);
      
      // Check border is still red
      expect(buffer.getPixel(20, 50)).toBe(1);
      expect(buffer.getPixel(80, 50)).toBe(1);
      
      // Check outside is still transparent
      expect(buffer.getPixel(10, 10)).toBe(0);
      expect(buffer.getPixel(90, 90)).toBe(0);
    });
    
    it('should not fill if clicking on same color', () => {
      buffer.paint(50, 50, 20, '#ff0000');
      const beforeFill = buffer.clone();
      
      buffer.fill(50, 50, '#ff0000');
      
      // Buffer should be unchanged
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          expect(buffer.getPixel(x, y)).toBe(beforeFill.getPixel(x, y));
        }
      }
    });
  });
  
  describe('clear operations', () => {
    beforeEach(() => {
      buffer.setPalette(['#ff0000']);
      buffer.paint(50, 50, 30, '#ff0000');
    });
    
    it('should clear entire buffer', () => {
      buffer.clear();
      
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          expect(buffer.getPixel(x, y)).toBe(0);
        }
      }
    });
    
    it('should clear rectangular area', () => {
      buffer.clearRect(40, 40, 20, 20);
      
      // Check cleared area
      for (let y = 40; y < 60; y++) {
        for (let x = 40; x < 60; x++) {
          expect(buffer.getPixel(x, y)).toBe(0);
        }
      }
      
      const filled = collectFilledPixels();
      const hasOutsidePaint = filled.some(pixel => (
        pixel.x < 40 || pixel.x >= 60 || pixel.y < 40 || pixel.y >= 60
      ));
      expect(hasOutsidePaint).toBe(true);
    });
  });
  
  describe('ImageData conversion', () => {
    it('should convert to ImageData correctly', () => {
      buffer.setPalette(['#ff0000', '#00ff00', '#0000ff']);
      buffer.paint(10, 10, 5, '#ff0000');
      buffer.paint(20, 20, 5, '#00ff00');
      buffer.paint(30, 30, 5, '#0000ff');
      
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      
      const imageData = buffer.getImageData(ctx);
      
      expect(imageData.width).toBe(100);
      expect(imageData.height).toBe(100);
      
      // Check red pixel
      const redIdx = (10 * 100 + 10) * 4;
      expect(imageData.data[redIdx]).toBe(255); // R
      expect(imageData.data[redIdx + 1]).toBe(0); // G
      expect(imageData.data[redIdx + 2]).toBe(0); // B
      expect(imageData.data[redIdx + 3]).toBe(255); // A
      
      // Check green pixel
      const greenIdx = (20 * 100 + 20) * 4;
      expect(imageData.data[greenIdx]).toBe(0); // R
      expect(imageData.data[greenIdx + 1]).toBeGreaterThan(0); // G
      expect(imageData.data[greenIdx + 2]).toBe(0); // B
      
      // Check blue pixel
      const blueIdx = (30 * 100 + 30) * 4;
      expect(imageData.data[blueIdx]).toBe(0); // R
      expect(imageData.data[blueIdx + 1]).toBe(0); // G
      expect(imageData.data[blueIdx + 2]).toBe(255); // B
    });
  });
  
  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      buffer.setPalette(['#ff0000', '#00ff00', '#0000ff']);
      buffer.paint(25, 25, 10, '#ff0000');
      buffer.paint(50, 50, 10, '#00ff00');
      buffer.paint(75, 75, 10, '#0000ff');
      
      const serialized = buffer.serialize();
      const restored = IndexBuffer.deserialize(serialized);
      
      // Check dimensions
      const dims = restored.getDimensions();
      expect(dims.width).toBe(100);
      expect(dims.height).toBe(100);
      
      // Check palette
      const palette = restored.getPalette();
      expect(palette).toEqual(buffer.getPalette());
      
      // Check pixel data
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          expect(restored.getPixel(x, y)).toBe(buffer.getPixel(x, y));
        }
      }
    });
  });
  
  describe('resize', () => {
    it('should resize buffer and preserve existing data', () => {
      buffer.setPalette(['#ff0000']);
      buffer.paint(25, 25, 10, '#ff0000');
      
      buffer.resize(150, 150);
      
      const { width, height } = buffer.getDimensions();
      expect(width).toBe(150);
      expect(height).toBe(150);
      
      // Check old data is preserved
      expect(buffer.getPixel(25, 25)).toBe(1);
      
      // Check new area is transparent
      expect(buffer.getPixel(120, 120)).toBe(0);
    });
    
    it('should crop when resizing smaller', () => {
      buffer.setPalette(['#ff0000']);
      buffer.paint(75, 75, 10, '#ff0000');
      
      buffer.resize(50, 50);
      
      const { width, height } = buffer.getDimensions();
      expect(width).toBe(50);
      expect(height).toBe(50);
      
      // Old data at 75,75 should be gone
      expect(() => buffer.getPixel(75, 75)).not.toThrow();
      expect(buffer.getPixel(75, 75)).toBe(0); // Out of bounds returns 0
    });
  });
  
  describe('clone', () => {
    it('should create independent copy', () => {
      buffer.setPalette(['#ff0000', '#00ff00']);
      buffer.paint(50, 50, 10, '#ff0000');
      
      const clone = buffer.clone();
      
      // Modify original
      buffer.paint(25, 25, 10, '#00ff00');
      
      // Clone should be unchanged
      expect(clone.getPixel(50, 50)).toBe(1); // Still red
      expect(clone.getPixel(25, 25)).toBe(0); // Still transparent
      
      // Original should have new paint
      expect(buffer.getPixel(25, 25)).toBe(2); // Green
    });
  });
});
