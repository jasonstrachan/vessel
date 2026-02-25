import { GradientPalette } from '../GradientPalette';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

describe('GradientPalette', () => {
  let palette: GradientPalette;
  
  beforeEach(() => {
    palette = new GradientPalette();
  });
  
  describe('initialization', () => {
    it('should create default black to white gradient', () => {
      const stops = palette.getGradientStops();
      expect(stops).toHaveLength(2);
      expect(stops[0]).toEqual({ position: 0, color: '#000000' });
      expect(stops[1]).toEqual({ position: 1, color: '#ffffff' });
    });
    
    it('should initialize with custom gradient', () => {
      const customStops = [
        { position: 0, color: '#ff0000' },
        { position: 0.5, color: '#00ff00' },
        { position: 1, color: '#0000ff' }
      ];
      
      palette = new GradientPalette(customStops);
      const stops = palette.getGradientStops();
      expect(stops).toEqual(customStops);
    });
    
    it('should generate 256 color palette', () => {
      const colors = palette.getPaletteColors();
      expect(colors.length).toBe(256 * 4); // 256 colors * 4 channels (RGBA)
    });
  });
  
  describe('gradient interpolation', () => {
    beforeEach(() => {
      palette.updateFromGradient([
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ]);
    });
    
    it('should interpolate grayscale correctly', () => {
      const start = palette.getColor(0);
      const middle = palette.getColor(127);
      const end = palette.getColor(255);
      
      // Start should be black
      expect(start.r).toBe(0);
      expect(start.g).toBe(0);
      expect(start.b).toBe(0);
      
      // Middle should be gray
      expect(middle.r).toBeGreaterThan(100);
      expect(middle.r).toBeLessThan(155);
      expect(middle.g).toBeGreaterThan(100);
      expect(middle.g).toBeLessThan(155);
      expect(middle.b).toBeGreaterThan(100);
      expect(middle.b).toBeLessThan(155);
      
      // End should be white
      expect(end.r).toBe(255);
      expect(end.g).toBe(255);
      expect(end.b).toBe(255);
    });
    
    it('should handle multi-stop gradients', () => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },    // Red
        { position: 0.5, color: '#00ff00' },  // Green
        { position: 1, color: '#0000ff' }     // Blue
      ]);
      
      const start = palette.getColor(0);
      const middle = palette.getColor(127);
      const end = palette.getColor(255);
      
      // Start should be red
      expect(start.r).toBe(255);
      expect(start.g).toBe(0);
      expect(start.b).toBe(0);
      
      // Middle should be greenish
      expect(middle.r).toBeLessThan(50);
      expect(middle.g).toBeGreaterThan(200);
      expect(middle.b).toBeLessThan(50);
      
      // End should be blue
      expect(end.r).toBe(0);
      expect(end.g).toBe(0);
      expect(end.b).toBe(255);
    });
    
    it('should auto-add stops at 0 and 1 if missing', () => {
      palette.updateFromGradient([
        { position: 0.25, color: '#ff0000' },
        { position: 0.75, color: '#0000ff' }
      ]);
      
      const stops = palette.getGradientStops();
      expect(stops[0].position).toBe(0);
      expect(stops[stops.length - 1].position).toBe(1);
    });
  });
  
  describe('color cycling', () => {
    beforeEach(() => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },
        { position: 0.5, color: '#00ff00' },
        { position: 1, color: '#0000ff' }
      ]);
    });
    
    it('should shift colors by offset', () => {
      const shifted = palette.shift(0.5);
      
      // After 50% shift, color at index 0 should be what was at index 128
      const shiftedColor = {
        r: shifted[0],
        g: shifted[1],
        b: shifted[2],
        a: shifted[3]
      };
      
      const original128 = palette.getColor(128);
      
      expect(shiftedColor.r).toBeCloseTo(original128.r, 0);
      expect(shiftedColor.g).toBeCloseTo(original128.g, 0);
      expect(shiftedColor.b).toBeCloseTo(original128.b, 0);
    });
    
    it('should wrap colors when shifting', () => {
      const original = palette.getPaletteColors();
      const shifted = palette.shift(1.0); // Full cycle
      
      // Should be back to original
      for (let i = 0; i < original.length; i++) {
        expect(shifted[i]).toBe(original[i]);
      }
    });
    
    it('should handle negative offsets', () => {
      const shifted1 = palette.shift(-0.25);
      const shifted2 = palette.shift(0.75);
      
      // -0.25 should be same as +0.75
      for (let i = 0; i < shifted1.length; i++) {
        expect(shifted1[i]).toBe(shifted2[i]);
      }
    });
  });

  describe('index helpers', () => {
    beforeEach(() => {
      palette.updateFromGradient([
        { position: 0, color: '#000000' },
        { position: 0.5, color: '#888888' },
        { position: 1, color: '#ffffff' }
      ]);
    });

    it('maps normalized positions to 1-based palette indices', () => {
      expect(palette.getIndexForPosition(-0.25)).toBe(1);
      expect(palette.getIndexForPosition(0)).toBe(1);
      expect(palette.getIndexForPosition(0.5)).toBeGreaterThan(120);
      expect(palette.getIndexForPosition(0.5)).toBeLessThan(140);
      expect(palette.getIndexForPosition(1)).toBe(255);
      expect(palette.getIndexForPosition(1.5)).toBe(255);
    });

    it('derives palette indices from discrete steps without string conversions', () => {
      expect(palette.getIndexForStep(0, 8)).toBe(1);
      expect(palette.getIndexForStep(7, 8)).toBe(255);
      expect(palette.getIndexForStep(8, 8)).toBe(1);
      expect(palette.getIndexForStep(15, 8)).toBe(255);
    });
  });
  
  describe('preset gradients', () => {
    it('should create default alternating black and white gradient', () => {
      const defaultPalette = GradientPalette.createDefault();
      const stops = defaultPalette.getGradientStops();

      expect(stops).toEqual(DEFAULT_GRADIENT_STOPS);

      // Ensure alternating colors
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i].color).not.toBe(stops[i - 1].color);
      }
    });

    it('should create rainbow gradient', () => {
      const rainbow = GradientPalette.createRainbow();
      const stops = rainbow.getGradientStops();
      
      expect(stops.length).toBeGreaterThan(5);
      expect(stops[0].color).toBe('#ff0000'); // Red
      expect(stops[stops.length - 1].color).toBe('#9400d3'); // Violet
    });
    
    it('should create fire gradient', () => {
      const fire = GradientPalette.createFire();
      const stops = fire.getGradientStops();
      
      expect(stops.length).toBeGreaterThan(3);
      expect(stops[0].color).toBe('#000000'); // Black
      expect(stops[stops.length - 1].color).toBe('#ffffff'); // White
    });
    
    it('should create ocean gradient', () => {
      const ocean = GradientPalette.createOcean();
      const stops = ocean.getGradientStops();
      
      expect(stops.length).toBeGreaterThan(3);
      // Should have blue colors
      expect(stops.some(s => typeof s.color === 'string' && s.color.includes('00'))).toBe(true);
    });
    
    it('should create sunset gradient', () => {
      const sunset = GradientPalette.createSunset();
      const stops = sunset.getGradientStops();
      
      expect(stops.length).toBeGreaterThan(3);
      expect(stops[0].color).toBe('#1a0033'); // Dark purple
    });
    
    it('should create grayscale gradient', () => {
      const gray = GradientPalette.createGrayscale();
      const stops = gray.getGradientStops();
      
      expect(stops).toHaveLength(2);
      expect(stops[0].color).toBe('#000000');
      expect(stops[1].color).toBe('#ffffff');
    });
  });
  
  describe('utility methods', () => {
    it('should get color as string', () => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#0000ff' }
      ]);
      
      const colorStr = palette.getColorString(0);
      expect(colorStr).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
    });
    
    it('should get palette as string array', () => {
      const strings = palette.getPaletteStrings();
      expect(strings).toHaveLength(256);
      expect(strings.every(s => s.startsWith('rgba('))).toBe(true);
    });
    
    it('should clone palette', () => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#0000ff' }
      ]);
      
      const cloned = palette.clone();
      const originalStops = palette.getGradientStops();
      const clonedStops = cloned.getGradientStops();
      
      expect(clonedStops).toEqual(originalStops);
      
      // Modify original
      palette.updateFromGradient([
        { position: 0, color: '#00ff00' },
        { position: 1, color: '#ff00ff' }
      ]);
      
      // Clone should be unchanged
      expect(cloned.getGradientStops()).toEqual(originalStops);
    });
  });
  
  describe('serialization', () => {
    it('should serialize and deserialize', () => {
      const stops = [
        { position: 0, color: '#ff0000' },
        { position: 0.33, color: '#00ff00' },
        { position: 0.67, color: '#0000ff' },
        { position: 1, color: '#ff00ff' }
      ];
      
      palette.updateFromGradient(stops);
      
      const serialized = palette.serialize();
      const restored = GradientPalette.deserialize(serialized);
      
      expect(restored.getGradientStops()).toEqual(palette.getGradientStops());
      
      // Check colors match
      for (let i = 0; i < 256; i++) {
        const original = palette.getColor(i);
        const restoredColor = restored.getColor(i);
        
        expect(restoredColor.r).toBe(original.r);
        expect(restoredColor.g).toBe(original.g);
        expect(restoredColor.b).toBe(original.b);
        expect(restoredColor.a).toBe(original.a);
      }
    });
  });
  
  describe('applyToIndexBuffer', () => {
    it('should apply palette to index data', () => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#0000ff' }
      ]);
      
      // Create mock index buffer
      const indexData = new Uint8Array([0, 1, 128, 255]); // Various indices
      
      // Create mock ImageData
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        // Skip test if no context (test environment issue)
        return;
      }
      
      const imageData = ctx.createImageData(2, 2);
      
      palette.applyToIndexBuffer(indexData, imageData);
      
      // Check pixel 0 (index 0 = transparent)
      expect(imageData.data[0]).toBe(0);
      expect(imageData.data[1]).toBe(0);
      expect(imageData.data[2]).toBe(0);
      expect(imageData.data[3]).toBe(0);
      
      // Check pixel 1 (index 1 = first palette color)
      const color1 = palette.getColor(0);
      expect(imageData.data[4]).toBe(color1.r);
      expect(imageData.data[5]).toBe(color1.g);
      expect(imageData.data[6]).toBe(color1.b);
      expect(imageData.data[7]).toBe(color1.a);
      
      // Check pixel 2 (index 128 = middle palette color)
      const color128 = palette.getColor(127);
      expect(imageData.data[8]).toBeCloseTo(color128.r, 0);
      expect(imageData.data[9]).toBeCloseTo(color128.g, 0);
      expect(imageData.data[10]).toBeCloseTo(color128.b, 0);
      
      // Check pixel 3 (index 255 = last palette color)  
      const color255 = palette.getColor(254);
      expect(imageData.data[12]).toBeCloseTo(color255.r, 0);
      expect(imageData.data[13]).toBeCloseTo(color255.g, 0);
      expect(imageData.data[14]).toBeCloseTo(color255.b, 0);
    });
    
    it('should apply shifted palette with offset', () => {
      palette.updateFromGradient([
        { position: 0, color: '#ff0000' },
        { position: 0.5, color: '#00ff00' },
        { position: 1, color: '#0000ff' }
      ]);
      
      const indexData = new Uint8Array([1]); // Single pixel with index 1
      
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        return;
      }
      
      const imageData1 = ctx.createImageData(1, 1);
      const imageData2 = ctx.createImageData(1, 1);
      
      // Apply without offset
      palette.applyToIndexBuffer(indexData, imageData1, 0);
      
      // Apply with 50% offset
      palette.applyToIndexBuffer(indexData, imageData2, 0.5);
      
      // Colors should be different
      expect(imageData1.data[0]).not.toBe(imageData2.data[0]);
    });
  });
});
