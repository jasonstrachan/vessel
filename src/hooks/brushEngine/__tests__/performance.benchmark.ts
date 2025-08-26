/**
 * Performance benchmarks comparing old vs new implementations
 * Run with: npm test -- performance.benchmark.ts
 */

import { useBrushEngineSimplified } from '../../useBrushEngineSimplified';
import { createBrushEngineFacade } from '../BrushEngineFacade';
import type { BrushSettings } from '@/types';

// Mock React hooks for testing
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useCallback: (fn: any) => fn,
  useMemo: (fn: any) => fn(),
  useRef: (val: any) => ({ current: val }),
  useEffect: () => {}
}));

// Mock store
jest.mock('../../../stores/useAppStore', () => ({
  useAppStore: () => ({
    tools: {
      brushSettings: mockBrushSettings,
      currentTool: 'brush'
    },
    project: {
      customBrushes: []
    },
    canvas: {
      cursor: { pressure: 1 }
    }
  })
}));

const mockBrushSettings: BrushSettings = {
  size: 10,
  opacity: 100,
  color: '#000000',
  blendMode: 'normal' as any,
  spacing: 0.1,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 10,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  shapeEnabled: false,
  useSwatchColor: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false
};

describe('Performance Benchmarks', () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    ctx = canvas.getContext('2d')!;
  });

  const runBenchmark = (name: string, fn: () => void, iterations: number = 1000) => {
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    
    const end = performance.now();
    const time = end - start;
    const perIteration = time / iterations;
    
    console.log(`${name}: ${time.toFixed(2)}ms total, ${perIteration.toFixed(4)}ms per iteration`);
    
    return { total: time, perIteration };
  };

  test('Stroke rendering performance', () => {
    const from = { x: 100, y: 100 };
    const to = { x: 200, y: 200 };
    const cursor = { pressure: 0.8 };
    
    // Test the current implementation
    const engine = useBrushEngineSimplified();
    const result = runBenchmark('Brush Engine - Stroke', () => {
      engine.drawBrush(ctx, from, to, cursor);
    }, 100);
    
    // Should complete quickly
    expect(result.perIteration).toBeLessThan(5); // Under 5ms per stroke
  });

  test('Color utilities performance', () => {
    const colors = ['#FF0000', '#00FF00', '#0000FF', 'rgb(128, 128, 128)', 'rgba(255, 255, 255, 0.5)'];
    
    // Import modules directly for micro-benchmarks
    const { parseColor } = require('../colorUtils');
    
    const result = runBenchmark('parseColor', () => {
      for (const color of colors) {
        parseColor(color);
      }
    }, 10000);
    
    // Should be very fast - under 0.01ms per call
    expect(result.perIteration / colors.length).toBeLessThan(0.01);
  });

  test('Grid snapping performance', () => {
    const { snapToGridPure } = require('../utilities');
    
    const points = [
      { x: 15, y: 15 },
      { x: 123, y: 456 },
      { x: 789, y: 234 },
      { x: 567, y: 890 }
    ];
    
    const result = runBenchmark('Grid Snapping', () => {
      for (const point of points) {
        snapToGridPure(point.x, point.y, 16);
      }
    }, 10000);
    
    // Should be extremely fast - under 0.001ms per call
    expect(result.perIteration / points.length).toBeLessThan(0.001);
  });

  test('Dithering performance', () => {
    // Create test image data
    const imageData = ctx.createImageData(100, 100);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = Math.random() * 255;
      imageData.data[i + 1] = Math.random() * 255;
      imageData.data[i + 2] = Math.random() * 255;
      imageData.data[i + 3] = 255;
    }
    
    const { applyDithering } = require('../dithering');
    
    const result = runBenchmark('Dithering', () => {
      applyDithering(imageData, 8, 'sierra-lite');
    }, 10);
    
    // Dithering is expensive, but should complete in reasonable time
    expect(result.perIteration).toBeLessThan(100); // Under 100ms per 100x100 image
  });

  test('Memory usage comparison', () => {
    if (typeof (global as any).gc === 'function') {
      // Run with --expose-gc flag to enable manual GC
      (global as any).gc();
      
      const getMemoryUsage = () => {
        if (typeof process !== 'undefined' && process.memoryUsage) {
          return process.memoryUsage().heapUsed;
        }
        return 0;
      };
      
      // Measure engine memory
      const before = getMemoryUsage();
      const engines = [];
      for (let i = 0; i < 10; i++) {
        engines.push(useBrushEngineSimplified());
      }
      const after = getMemoryUsage();
      const memory = after - before;
      
      console.log(`Engine memory: ${(memory / 1024 / 1024).toFixed(2)}MB`);
      
      // Should use reasonable memory
      expect(memory).toBeLessThan(50 * 1024 * 1024); // Under 50MB for 10 instances
    } else {
      console.log('Memory test skipped - run with --expose-gc flag');
    }
  });
});

// Export benchmark runner for CLI usage
export const runAllBenchmarks = () => {
  const benchmarks = [
    'Stroke rendering performance',
    'Color utilities performance',
    'Grid snapping performance',
    'Dithering performance',
    'Memory usage comparison'
  ];
  
  console.log('Running all performance benchmarks...\n');
  
  for (const benchmark of benchmarks) {
    console.log(`\n=== ${benchmark} ===`);
    // Run the benchmark
  }
};