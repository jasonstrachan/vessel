import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'playwright/test';

const rootDir = process.cwd();
const SHAPE_COLUMNS = 16;
const SHAPE_ROWS = 16;
const SHAPE_COUNT = SHAPE_COLUMNS * SHAPE_ROWS;
const SURFACE_SIZE = 2000;
const CELL_SIZE = SURFACE_SIZE / SHAPE_COLUMNS;
const SHAPE_MARGIN = 12;
const DITHER_BANDS = 32;
const MEASURE_MS = 1200;
const MIN_RENDER_FPS = 8;
const ORDERED_DITHER_8X8 = [
  0, 48, 12, 60, 3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

type GobletPerfSummary = {
  ready: boolean;
  shapeCount: number;
  nonZeroAlpha: number;
  rafCallbacks: number;
  measuredFps: number;
  avgCallbackMs: number;
  maxCallbackMs: number;
  error?: string;
};

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const toHex = (value: number): string => Math.max(0, Math.min(255, Math.round(value)))
  .toString(16)
  .padStart(2, '0');

const hslToHex = (hue: number, saturation: number, lightness: number): string => {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`;
};

const buildGradientStops = () => ([
  { position: 0, color: '#101014' },
  { position: 0.18, color: '#2e7cf6' },
  { position: 0.38, color: '#4ee3a1' },
  { position: 0.62, color: '#f5d84a' },
  { position: 0.82, color: '#f05a8a' },
  { position: 1, color: '#101014' },
]);

const resolveDitheredGradientIndex = (normalizedPosition: number, x: number, y: number): number => {
  const clampedPosition = Math.max(0, Math.min(1, normalizedPosition));
  const scaledBand = clampedPosition * (DITHER_BANDS - 1);
  const baseBand = Math.floor(scaledBand);
  const fraction = scaledBand - baseBand;
  const threshold = (ORDERED_DITHER_8X8[(y % 8) * 8 + (x % 8)] + 0.5) / 64;
  const ditheredBand = Math.min(DITHER_BANDS - 1, baseBand + (fraction > threshold ? 1 : 0));

  return Math.max(1, Math.min(255, Math.round(1 + (ditheredBand / (DITHER_BANDS - 1)) * 254)));
};

const createIndexBuffers = () => {
  const pixelCount = SURFACE_SIZE * SURFACE_SIZE;
  const indexBuffer = new Array<number>(pixelCount).fill(0);
  const gradientIdBuffer = new Array<number>(pixelCount).fill(0);
  const radius = (CELL_SIZE - SHAPE_MARGIN * 2) / 2;

  for (let shapeIndex = 0; shapeIndex < SHAPE_COUNT; shapeIndex += 1) {
    const cellX = shapeIndex % SHAPE_COLUMNS;
    const cellY = Math.floor(shapeIndex / SHAPE_COLUMNS);
    const originX = cellX * CELL_SIZE;
    const originY = cellY * CELL_SIZE;
    const centerX = originX + CELL_SIZE / 2;
    const centerY = originY + CELL_SIZE / 2;
    const slot = shapeIndex % 4;

    for (let y = originY + SHAPE_MARGIN; y < originY + CELL_SIZE - SHAPE_MARGIN; y += 1) {
      for (let x = originX + SHAPE_MARGIN; x < originX + CELL_SIZE - SHAPE_MARGIN; x += 1) {
        const dx = (x + 0.5 - centerX) / radius;
        const dy = (y + 0.5 - centerY) / radius;
        if (dx * dx + dy * dy > 1) {
          continue;
        }
        const localX = (x - originX - SHAPE_MARGIN) / Math.max(1, CELL_SIZE - SHAPE_MARGIN * 2 - 1);
        const globalIndex = y * SURFACE_SIZE + x;
        indexBuffer[globalIndex] = resolveDitheredGradientIndex(localX, x, y);
        gradientIdBuffer[globalIndex] = slot;
      }
    }
  }

  return { indexBuffer, gradientIdBuffer };
};

export const createGoblet2CcGradientShapesPerfBundle = () => {
  const { indexBuffer, gradientIdBuffer } = createIndexBuffers();
  const baseStops = buildGradientStops();
  const slotPalettes = Array.from({ length: 4 }, (_, slot) => ({
    slot,
    stops: [
      { position: 0, color: hslToHex((slot * 80 + 210) % 360, 74, 18) },
      { position: 0.3, color: hslToHex((slot * 80 + 260) % 360, 78, 52) },
      { position: 0.65, color: hslToHex((slot * 80 + 40) % 360, 82, 58) },
      { position: 1, color: hslToHex((slot * 80 + 210) % 360, 74, 18) },
    ],
  }));

  return {
    format: 'vessel-goblet2',
    version: 1,
    exportedAt: new Date('2026-04-29T00:00:00Z').toISOString(),
    project: {
      id: 'perf-256-cc-gradient-shapes',
      name: '256 CC Gradient Shapes Perf',
      width: SURFACE_SIZE,
      height: SURFACE_SIZE,
      backgroundColor: '#050507',
    },
    colorCycle: { schemaVersion: 2 },
    viewport: {
      mode: 'fixed',
      designWidth: SURFACE_SIZE,
      designHeight: SURFACE_SIZE,
    },
    container: {
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      sizeMode: 'fill',
    },
    animation: {
      fps: 60,
      totalFrames: 120,
      durationSeconds: 2,
      perfectLoop: false,
    },
    settings: {
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minifyOutput: false,
      perfectLoop: false,
      bundleFormat: 'json',
      htmlTitle: '256 CC Gradient Shapes Perf',
    },
    layers: [{
      id: 'cc-gradient-shapes-256',
      name: '256 CC Gradient Shapes',
      type: 'color-cycle',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      source: { width: SURFACE_SIZE, height: SURFACE_SIZE },
      pixelBoundsPx: { x: 0, y: 0, width: SURFACE_SIZE, height: SURFACE_SIZE },
      documentBoundsPx: { x: 0, y: 0, width: SURFACE_SIZE, height: SURFACE_SIZE },
      documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
      alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
      contentBounds: { x: 0, y: 0, width: SURFACE_SIZE, height: SURFACE_SIZE },
      paintedSize: { width: SURFACE_SIZE, height: SURFACE_SIZE },
      colorCycle: {
        mode: 'brush',
        speedMode: 'slot',
        speedMin: 0.1,
        speedMax: 1.2,
        isAnimating: true,
        brushSpeed: 0.35,
        controllerSpeedCps: 0.35,
        layerBaseSpeedCps: 0.35,
        gradient: baseStops,
        slotPalettes,
        slotSpeeds: [
          { slot: 0, speed: 0.22 },
          { slot: 1, speed: 0.34 },
          { slot: 2, speed: 0.46 },
          { slot: 3, speed: 0.58 },
        ],
        coverageBoundsPx: { x: 0, y: 0, width: SURFACE_SIZE, height: SURFACE_SIZE },
        coverageBoundsSourcePx: { x: 0, y: 0, width: SURFACE_SIZE, height: SURFACE_SIZE },
        brushState: {
          width: SURFACE_SIZE,
          height: SURFACE_SIZE,
          indexBuffer,
          gradientIdBuffer,
          gradientStops: baseStops,
          alphaMode: 'opaque-indices',
          animationOffset: 0,
          targetFPS: 60,
          legacySpeedCps: 0.35,
          flowDirection: 'forward',
        },
      },
      stackIndex: 0,
      version: 1,
    }],
  };
};

const buildPerfHtml = () => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = JSON.stringify(createGoblet2CcGradientShapesPerfBundle());

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>256 CC Gradient Shapes Perf</title>',
    '  <style>',
    '    html, body { margin: 0; background: #050507; }',
    '    body { min-height: 100vh; display: grid; place-items: center; }',
    `    canvas { width: ${SURFACE_SIZE}px; height: ${SURFACE_SIZE}px; image-rendering: pixelated; }`,
    '  </style>',
    '</head>',
    '<body>',
    `  <canvas id="perf-canvas" width="${SURFACE_SIZE}" height="${SURFACE_SIZE}"></canvas>`,
    '  <script type="module">',
    `const __ORIGINAL_RAF__ = window.requestAnimationFrame.bind(window);
window.__gobletPerfFrames = [];
window.requestAnimationFrame = (callback) => __ORIGINAL_RAF__((timestamp) => {
  const start = performance.now();
  try {
    return callback(timestamp);
  } finally {
    const elapsed = performance.now() - start;
    window.__gobletPerfFrames.push(elapsed);
  }
});`,
    runtime,
    `const __PERF_METADATA__ = ${metadata};`,
    `const __PERF_CANVAS__ = document.getElementById('perf-canvas');
window.__gobletPerf = { ready: false };
const __countPixels__ = () => {
  const ctx = __PERF_CANVAS__.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, __PERF_CANVAS__.width, __PERF_CANVAS__.height).data;
  let nonZeroAlpha = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0) {
      nonZeroAlpha += 1;
    }
  }
  return nonZeroAlpha;
};
const __measure__ = (durationMs) => new Promise((resolve) => {
  const start = performance.now();
  const startCount = window.__gobletPerfFrames.length;
  const tick = () => {
    if (performance.now() - start >= durationMs) {
      const frames = window.__gobletPerfFrames.slice(startCount);
      const totalCallbackMs = frames.reduce((sum, value) => sum + value, 0);
      resolve({
        rafCallbacks: frames.length,
        measuredFps: frames.length / ((performance.now() - start) / 1000),
        avgCallbackMs: frames.length ? totalCallbackMs / frames.length : 0,
        maxCallbackMs: frames.length ? Math.max(...frames) : 0,
      });
      return;
    }
    __ORIGINAL_RAF__(tick);
  };
  __ORIGINAL_RAF__(tick);
});
try {
  const summary = await renderVesselWebGL(__PERF_METADATA__, __PERF_CANVAS__, {});
  await new Promise((resolve) => __ORIGINAL_RAF__(resolve));
  const nonZeroAlpha = __countPixels__();
  const measurement = await __measure__(${MEASURE_MS});
  window.__gobletPerf = {
    ready: true,
    shapeCount: ${SHAPE_COUNT},
    nonZeroAlpha,
    summary,
    ...measurement,
  };
} catch (error) {
  window.__gobletPerf = {
    ready: true,
    shapeCount: ${SHAPE_COUNT},
    nonZeroAlpha: 0,
    rafCallbacks: 0,
    measuredFps: 0,
    avgCallbackMs: 0,
    maxCallbackMs: 0,
    error: error instanceof Error ? error.message : String(error),
  };
  throw error;
}`,
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
};

test.describe('Goblet 2 256 CC gradient shapes performance', () => {
  test('renders the reusable fixture and records FPS', async ({ page }) => {
    const perfUrl = 'http://goblet-cc-gradient-shapes-perf.test/';
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.route(perfUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildPerfHtml(),
      });
    });

    await page.goto(perfUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as Window & { __gobletPerf?: { ready?: boolean } }).__gobletPerf?.ready), undefined, {
      timeout: 10000,
    });

    const perf = await page.evaluate(() => (
      window as Window & { __gobletPerf?: GobletPerfSummary }
    ).__gobletPerf);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(perf).toMatchObject({ ready: true, shapeCount: SHAPE_COUNT });
    expect(perf).not.toHaveProperty('error');
    expect(perf!.nonZeroAlpha).toBeGreaterThan(0);
    expect(perf!.rafCallbacks).toBeGreaterThan(0);
    expect(perf!.measuredFps).toBeGreaterThanOrEqual(MIN_RENDER_FPS);

    console.log(
      `[goblet-perf] 256 CC gradient shapes: fps=${perf!.measuredFps.toFixed(1)} ` +
      `avgCallback=${perf!.avgCallbackMs.toFixed(2)}ms maxCallback=${perf!.maxCallbackMs.toFixed(2)}ms`
    );
  });
});
