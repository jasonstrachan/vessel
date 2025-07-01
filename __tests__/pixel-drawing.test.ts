/**
 * Test suite for pixel-perfect drawing algorithms
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

// Mock graphics object for testing
class MockGraphics {
  public pixels: Uint8ClampedArray;
  public width: number;
  public height: number;
  private loadPixelsCalled = false;
  private updatePixelsCalled = false;

  constructor(width = 100, height = 100) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4); // RGBA
  }

  loadPixels() {
    this.loadPixelsCalled = true;
  }

  updatePixels() {
    this.updatePixelsCalled = true;
  }

  color(colorString: string) {
    // Simple color parsing for test
    return {
      levels: [255, 0, 0, 255] // Red color for testing
    };
  }

  getPixelCalls() {
    return {
      loadPixels: this.loadPixelsCalled,
      updatePixels: this.updatePixelsCalled
    };
  }

  resetCalls() {
    this.loadPixelsCalled = false;
    this.updatePixelsCalled = false;
  }

  getPixelAt(x: number, y: number) {
    const index = (y * this.width + x) * 4;
    return {
      r: this.pixels[index],
      g: this.pixels[index + 1],
      b: this.pixels[index + 2],
      a: this.pixels[index + 3]
    };
  }
}

// Test implementation of the waiting pixel algorithm
class WaitingPixelTester {
  private lastDrawnX = 0;
  private lastDrawnY = 0;
  private waitingPixelX = 0;
  private waitingPixelY = 0;
  private hasWaitingPixel = false;
  public drawCalls: Array<{x: number, y: number}> = [];

  reset() {
    this.lastDrawnX = 0;
    this.lastDrawnY = 0;
    this.waitingPixelX = 0;
    this.waitingPixelY = 0;
    this.hasWaitingPixel = false;
    this.drawCalls = [];
  }

  drawPixel(x: number, y: number) {
    this.drawCalls.push({x, y});
  }

  perfectPixels(currentX: number, currentY: number) {
    const pixelX = Math.round(currentX);
    const pixelY = Math.round(currentY);
    
    // Initialize first pixel
    if (!this.hasWaitingPixel) {
      this.drawPixel(pixelX, pixelY);
      this.lastDrawnX = pixelX;
      this.lastDrawnY = pixelY;
      this.waitingPixelX = pixelX;
      this.waitingPixelY = pixelY;
      this.hasWaitingPixel = true;
      return;
    }
    
    // If current pixel not neighbor to last drawn, draw waiting pixel
    if (Math.abs(pixelX - this.lastDrawnX) > 1 || Math.abs(pixelY - this.lastDrawnY) > 1) {
      this.drawPixel(this.waitingPixelX, this.waitingPixelY);
      // Update queue
      this.lastDrawnX = this.waitingPixelX;
      this.lastDrawnY = this.waitingPixelY;
      this.waitingPixelX = pixelX;
      this.waitingPixelY = pixelY;
    } else {
      this.waitingPixelX = pixelX;
      this.waitingPixelY = pixelY;
    }
  }

  finalize() {
    if (this.hasWaitingPixel) {
      this.drawPixel(this.waitingPixelX, this.waitingPixelY);
    }
  }
}

describe('Waiting Pixel Algorithm', () => {
  let tester: WaitingPixelTester;

  beforeEach(() => {
    tester = new WaitingPixelTester();
  });

  test('should draw initial pixel immediately', () => {
    tester.perfectPixels(5, 5);
    
    expect(tester.drawCalls).toHaveLength(1);
    expect(tester.drawCalls[0]).toEqual({x: 5, y: 5});
  });

  test('should wait for direction confirmation on neighboring pixels', () => {
    tester.perfectPixels(5, 5); // Initial pixel
    tester.perfectPixels(6, 5); // Neighboring pixel - should not draw
    
    expect(tester.drawCalls).toHaveLength(1); // Only initial pixel drawn
  });

  test('should draw waiting pixel when movement exceeds threshold', () => {
    tester.perfectPixels(5, 5);   // Initial pixel at (5,5)
    tester.perfectPixels(6, 5);   // Move to neighbor (6,5) - waiting
    tester.perfectPixels(8, 5);   // Jump to (8,5) - should draw waiting pixel at (6,5)
    
    expect(tester.drawCalls).toHaveLength(2);
    expect(tester.drawCalls[0]).toEqual({x: 5, y: 5}); // Initial
    expect(tester.drawCalls[1]).toEqual({x: 6, y: 5}); // Waiting pixel
  });

  test('should handle diagonal movements correctly', () => {
    tester.perfectPixels(5, 5);   // Initial
    tester.perfectPixels(6, 6);   // Diagonal neighbor - waiting
    tester.perfectPixels(9, 9);   // Far diagonal - should draw waiting pixel
    
    expect(tester.drawCalls).toHaveLength(2);
    expect(tester.drawCalls[0]).toEqual({x: 5, y: 5}); // Initial
    expect(tester.drawCalls[1]).toEqual({x: 6, y: 6}); // Waiting pixel
  });

  test('should draw final waiting pixel on finalize', () => {
    tester.perfectPixels(5, 5);   // Initial
    tester.perfectPixels(6, 5);   // Neighboring - waiting
    tester.finalize();            // Should draw the waiting pixel
    
    expect(tester.drawCalls).toHaveLength(2);
    expect(tester.drawCalls[0]).toEqual({x: 5, y: 5}); // Initial
    expect(tester.drawCalls[1]).toEqual({x: 6, y: 5}); // Final waiting pixel
  });

  test('should prevent L-shaped artifacts in pixel art lines', () => {
    // Simulate drawing a diagonal line that would create L-shapes without the algorithm
    const path = [
      {x: 10, y: 10},  // Start
      {x: 11, y: 10},  // Right
      {x: 11, y: 11},  // Down (would create L-shape)
      {x: 12, y: 11},  // Right
      {x: 12, y: 12},  // Down (would create L-shape)
      {x: 14, y: 14}   // Jump far diagonal
    ];

    path.forEach(point => tester.perfectPixels(point.x, point.y));
    tester.finalize();

    // The algorithm should skip intermediate pixels that form L-shapes
    // Only drawing confirmed direction changes
    expect(tester.drawCalls.length).toBeLessThan(path.length);
    
    // Should start with initial pixel
    expect(tester.drawCalls[0]).toEqual({x: 10, y: 10});
    
    // Should draw final waiting pixel
    const lastCall = tester.drawCalls[tester.drawCalls.length - 1];
    expect(lastCall.x).toBeGreaterThan(10);
    expect(lastCall.y).toBeGreaterThan(10);
  });

  test('should reset state properly', () => {
    tester.perfectPixels(5, 5);
    tester.perfectPixels(6, 5);
    
    expect(tester.drawCalls).toHaveLength(1);
    
    tester.reset();
    
    tester.perfectPixels(10, 10);
    expect(tester.drawCalls).toHaveLength(1); // Fresh start
    expect(tester.drawCalls[0]).toEqual({x: 10, y: 10});
  });
});

describe('Performance Characteristics', () => {
  let tester: WaitingPixelTester;

  beforeEach(() => {
    tester = new WaitingPixelTester();
  });

  test('should minimize draw calls for jittery mouse input', () => {
    // Simulate jittery mouse movement around the same area
    const jitteryPath = [
      {x: 10, y: 10},  // Start
      {x: 11, y: 10},  // Small move
      {x: 10, y: 10},  // Back
      {x: 11, y: 11},  // Small diagonal
      {x: 10, y: 11},  // Back
      {x: 15, y: 15}   // Big jump - should trigger draw
    ];

    jitteryPath.forEach(point => tester.perfectPixels(point.x, point.y));
    tester.finalize();

    // Should have significantly fewer draw calls than input points
    expect(tester.drawCalls.length).toBeLessThan(jitteryPath.length - 2);
  });

  test('should handle rapid sequential calls efficiently', () => {
    const startTime = Date.now();
    
    // Simulate 1000 rapid mouse movements in a more realistic pattern
    let x = 0, y = 0;
    for (let i = 0; i < 1000; i++) {
      // Simulate small jittery movements most of the time, big jumps occasionally
      if (i % 50 === 0) {
        x += 10; y += 10; // Big jump every 50 moves
      } else {
        x += Math.random() < 0.5 ? 1 : 0; // Small movements
        y += Math.random() < 0.5 ? 1 : 0;
      }
      tester.perfectPixels(x, y);
    }
    tester.finalize();
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Should complete quickly (under 100ms for 1000 calls)
    expect(duration).toBeLessThan(100);
    
    // Should have significantly fewer draw calls than input calls due to waiting pixel logic
    expect(tester.drawCalls.length).toBeLessThan(800);
  });
});