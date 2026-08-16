import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext } from 'playwright/test';

import { createGoblet2Bundle } from './fixtures/goblet2Bundle';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

type Goblet2Bundle = ReturnType<typeof createGoblet2Bundle>;

const createWebGlFallbackBundle = () => {
  const bundle = createGoblet2Bundle();
  const colorCycle = bundle.layers[0]?.colorCycle;
  if (colorCycle) {
    colorCycle.speedMode = 'buffer';
  }
  return bundle;
};

const createSolidTexture = (color: string, width: number, height: number) => (
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`,
  )}`
);

const createSierraTravelBundle = (revealTexture?: string) => {
  const width = 160;
  const height = 48;
  const createLayer = (id: string, texture: string, stackIndex: number) => ({
    id,
    name: id,
    type: 'normal',
    source: { width, height },
    documentBoundsPx: { x: 0, y: 0, width, height },
    documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
    alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
    assets: { texture },
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    stackIndex,
  });
  const bundle = createGoblet2Bundle({
    layers: [
      createLayer('pose-a', createSolidTexture('#000000', width, height), 0),
      createLayer(
        'pose-b',
        revealTexture ?? createSolidTexture('#ff0000', width, height),
        1,
      ),
    ],
  });
  bundle.project.width = width;
  bundle.project.height = height;
  bundle.project.backgroundColor = '#777777';
  bundle.viewport.designWidth = width;
  bundle.viewport.designHeight = height;
  const interlaceBundle = bundle as typeof bundle & {
    interlaceGroups: Array<{
      id: string;
      layerIds: string[];
      settings: {
        cellSize: number;
        dominance: number;
        patternPreset: string;
        motionMode: string;
        direction: string;
        travelCycles: number;
        loopDurationSeconds: number;
        seed: number;
      };
    }>;
  };
  interlaceBundle.interlaceGroups = [{
    id: 'sierra-rigid-sheet',
    layerIds: ['pose-a', 'pose-b'],
    settings: {
      cellSize: 16,
      dominance: 0.92,
      patternPreset: 'sierra-travel',
      motionMode: 'fixed',
      direction: 'right',
      travelCycles: 1,
      loopDurationSeconds: 12,
      seed: 0,
    },
  }];
  return interlaceBundle;
};

const createAdjustmentBundle = (mix = 1) => {
  const width = 16;
  const height = 16;
  const bundle = createGoblet2Bundle({
    layers: [
      {
        id: 'paint',
        name: 'Paint',
        type: 'normal',
        source: { width, height },
        documentBoundsPx: { x: 0, y: 0, width, height },
        documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
        alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
        assets: { texture: createSolidTexture('#ff0000', width, height) },
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        stackIndex: 0,
      },
      {
        id: 'hue-shift',
        name: 'Hue Shift',
        type: 'adjustment',
        source: { width, height },
        documentBoundsPx: { x: 0, y: 0, width, height },
        documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
        alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
        visible: true,
        opacity: mix,
        blendMode: 'source-over',
        stackIndex: 1,
        adjustment: {
          effect: {
            id: 'hue-sat',
            settings: {
              hue: 120,
              saturation: 0,
              vibrance: 0,
              lightness: 0,
              contrast: 0,
              red: 0,
              green: 0,
              blue: 0,
              hueRangeEnabled: false,
              hueRangeStart: 0,
              hueRangeEnd: 360,
            },
          },
        },
      },
    ],
  } as Parameters<typeof createGoblet2Bundle>[0]);
  bundle.project.width = width;
  bundle.project.height = height;
  bundle.project.backgroundColor = 'transparent';
  bundle.viewport.designWidth = width;
  bundle.viewport.designHeight = height;
  return bundle;
};

const createTransparentAdjustmentBundle = () => {
  const bundle = createAdjustmentBundle();
  const paint = bundle.layers[0];
  const adjustment = bundle.layers[1];
  if (paint) {
    paint.assets = { texture: createSolidTexture('#00ff00', 16, 16) };
    paint.documentBoundsPx = { x: 0, y: 0, width: 8, height: 16 };
    paint.documentBoundsPercent = { x: 0, y: 0, width: 50, height: 100 };
  }
  if (adjustment?.adjustment?.effect.id === 'hue-sat') {
    adjustment.adjustment.effect.settings.hue = 0;
    adjustment.adjustment.effect.settings.red = 100;
  }
  return bundle;
};

const createScopedAdjustmentBundle = () => {
  const bundle = createTransparentAdjustmentBundle();
  const groupPaint = bundle.layers[0];
  const adjustment = bundle.layers[1];
  if (groupPaint) groupPaint.stackIndex = 1;
  if (adjustment) adjustment.stackIndex = 2;
  bundle.layers.unshift({
    id: 'base',
    name: 'Base',
    type: 'normal',
    source: { width: 16, height: 16 },
    documentBoundsPx: { x: 0, y: 0, width: 16, height: 16 },
    documentBoundsPercent: { x: 0, y: 0, width: 100, height: 100 },
    alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
    assets: { texture: createSolidTexture('#0000ff', 16, 16) },
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    stackIndex: 0,
  });
  bundle.adjustmentGroups = [{
    id: 'scoped-group',
    layerIds: ['paint', 'hue-shift'],
  }];
  return bundle;
};

const buildSingleFileGoblet2Html = (bundle: Goblet2Bundle = createGoblet2Bundle()) => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = JSON.stringify(bundle);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>Goblet 2 Single-File Smoke</title>',
    '  <style>',
    '    html, body { margin: 0; background: #000; }',
    '    body { min-height: 100vh; display: grid; place-items: center; }',
    '    canvas { width: 128px; height: 128px; image-rendering: pixelated; background: #000; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <canvas id="preview-canvas" width="128" height="128"></canvas>',
    '  <script type="module">',
    runtime,
    `const __SMOKE_METADATA__ = ${metadata};`,
    `const __SMOKE_CANVAS__ = document.getElementById('preview-canvas');
window.__gobletSmoke = { ready: false };
const __smokeCountPixels__ = () => {
  const ctx = __SMOKE_CANVAS__.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, __SMOKE_CANVAS__.width, __SMOKE_CANVAS__.height).data;
  let nonZeroAlpha = 0;
  let nonZeroRgba = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0) {
      nonZeroAlpha += 1;
    }
    if (data[index] || data[index + 1] || data[index + 2] || data[index + 3]) {
      nonZeroRgba += 1;
    }
  }
  return { nonZeroAlpha, nonZeroRgba };
};
try {
  const summary = await renderVesselWebGL(__SMOKE_METADATA__, __SMOKE_CANVAS__, {});
  const pixels = __smokeCountPixels__();
  window.__gobletSmoke = { ready: true, summary, ...pixels };
} catch (error) {
  window.__gobletSmoke = {
    ready: true,
    error: error instanceof Error ? error.message : String(error)
  };
  throw error;
}`,
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
};

const installControlledBrowserState = async (
  context: BrowserContext,
  { useManualAnimationFrames = false }: { useManualAnimationFrames?: boolean } = {},
) => {
  await context.addInitScript(({ manualAnimationFrames }) => {
    const runtimeWindow = window as Window & {
      __setGobletDocumentHidden?: (isHidden: boolean) => void;
      __setGobletIntersection?: (isIntersecting: boolean) => void;
      __stepGobletAnimationFrame?: (timestamp: number) => boolean;
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(contextId, ...args) {
      if (contextId === 'webgl2') {
        return null;
      }
      return Reflect.apply(originalGetContext, this, [contextId, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;

    let isDocumentHidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isDocumentHidden,
    });
    runtimeWindow.__setGobletDocumentHidden = (isHidden) => {
      isDocumentHidden = isHidden;
      document.dispatchEvent(new Event('visibilitychange'));
    };

    let intersectionCallback: IntersectionObserverCallback | null = null;
    let intersectionTarget: Element | null = null;
    class ControlledIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe(target: Element) {
        intersectionTarget = target;
        intersectionCallback?.([
          { isIntersecting: true, target } as IntersectionObserverEntry,
        ], this);
      }

      disconnect() {
        intersectionTarget = null;
      }

      takeRecords() {
        return [];
      }

      unobserve(target: Element) {
        if (intersectionTarget === target) {
          intersectionTarget = null;
        }
      }
    }
    window.IntersectionObserver = ControlledIntersectionObserver;
    runtimeWindow.__setGobletIntersection = (isIntersecting) => {
      if (!intersectionCallback || !intersectionTarget) {
        return;
      }
      intersectionCallback([
        { isIntersecting, target: intersectionTarget } as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
    };

    if (manualAnimationFrames) {
      let nextAnimationFrameId = 1;
      let virtualNow = 0;
      const animationFrameCallbacks = new Map<number, FrameRequestCallback>();
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => virtualNow,
      });
      window.requestAnimationFrame = (callback) => {
        const animationFrameId = nextAnimationFrameId;
        nextAnimationFrameId += 1;
        animationFrameCallbacks.set(animationFrameId, callback);
        return animationFrameId;
      };
      window.cancelAnimationFrame = (animationFrameId) => {
        animationFrameCallbacks.delete(animationFrameId);
      };
      runtimeWindow.__stepGobletAnimationFrame = (timestamp) => {
        const nextEntry = animationFrameCallbacks.entries().next().value as
          | [number, FrameRequestCallback]
          | undefined;
        if (!nextEntry) {
          return false;
        }
        const [animationFrameId, callback] = nextEntry;
        animationFrameCallbacks.delete(animationFrameId);
        virtualNow = timestamp;
        callback(timestamp);
        return true;
      };
    }
  }, { manualAnimationFrames: useManualAnimationFrames });
};

const waitForSmokeReady = async (page: import('playwright/test').Page) => {
  await page.waitForFunction(() => Boolean((window as Window & {
    __gobletSmoke?: { ready?: boolean };
  }).__gobletSmoke?.ready), undefined, { timeout: 5000 });
};

const renderGobletInterlaceAt = async (
  page: import('playwright/test').Page,
  elapsedSeconds: number,
) => page.evaluate((elapsed) => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  type InterlaceViewer = {
    interlaceElapsedSeconds: number;
    renderOnce: () => void;
  };
  const values = Object.getOwnPropertySymbols(canvas).map((symbol) => (
    (canvas as unknown as Record<symbol, unknown>)[symbol]
  ));
  const viewer = values.find((value): value is InterlaceViewer => (
    typeof value === 'object'
    && value !== null
    && 'interlaceElapsedSeconds' in value
    && 'renderOnce' in value
    && typeof (value as { renderOnce?: unknown }).renderOnce === 'function'
  ));
  if (!viewer) return false;
  viewer.interlaceElapsedSeconds = elapsed;
  viewer.renderOnce();
  return true;
}, elapsedSeconds);

const readProfile = async (page: import('playwright/test').Page) => page.evaluate(() => {
  const dumpProfile = (window as Window & {
    __VESSEL_DUMP_GOBLET_PROFILE__?: () => unknown[];
  }).__VESSEL_DUMP_GOBLET_PROFILE__;
  return dumpProfile?.()[0] as {
    rafRunning: boolean;
    pauseReasons: string[];
    rawDpr: number;
    effectiveDpr: number;
    isMobileDprCapped: boolean;
    backingWidth: number;
    backingHeight: number;
    backingPixels: number;
    resizeFlushCount: number;
    players: Array<{
      useWebGL: boolean;
      webglInitAttempted: boolean;
      webglInitFailed: boolean;
      webglFallbackReason: string | null;
      adaptiveScaleEnabled: boolean;
      renderScale: number;
      scaleTransitionActive: boolean;
      lastScaleTransitionReason: string | null;
    }>;
  };
});

test.describe('Goblet 2 single-file runtime smoke', () => {
  test('loads the inline runtime without page errors and paints pixels', async ({ page }) => {
    const smokeUrl = 'http://goblet-smoke.test/';
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

    await page.route(smokeUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildSingleFileGoblet2Html(),
      });
    });

    await page.goto(smokeUrl, { waitUntil: 'load' });
    await waitForSmokeReady(page);

    const smoke = await page.evaluate(() => (window as Window & { __gobletSmoke?: unknown }).__gobletSmoke);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(smoke).toMatchObject({
      ready: true,
    });
    expect(smoke).not.toHaveProperty('error');
    expect(smoke).toMatchObject({
      nonZeroAlpha: expect.any(Number),
      nonZeroRgba: expect.any(Number),
    });
    expect((smoke as { nonZeroAlpha: number }).nonZeroAlpha).toBeGreaterThan(0);
    expect((smoke as { nonZeroRgba: number }).nonZeroRgba).toBeGreaterThan(0);
  });

  test('applies an exported adjustment layer in stack order', async ({ page }) => {
    await page.setContent(buildSingleFileGoblet2Html(createAdjustmentBundle()));
    await expect.poll(async () => page.evaluate(() => (
      (window as Window & { __gobletSmoke?: { ready?: boolean } }).__gobletSmoke?.ready
    ))).toBe(true);

    const pixel = await page.locator('#preview-canvas').evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      const context = target.getContext('2d', { willReadFrequently: true });
      return Array.from(context?.getImageData(
        Math.floor(target.width / 2),
        Math.floor(target.height / 2),
        1,
        1,
      ).data ?? []);
    });

    expect(pixel[1]).toBeGreaterThan(200);
    expect(pixel[0]).toBeLessThan(30);
    expect(pixel[2]).toBeLessThan(30);
  });

  test('uses adjustment-layer opacity as the effect mix', async ({ page }) => {
    await page.setContent(buildSingleFileGoblet2Html(createAdjustmentBundle(0.5)));
    await expect.poll(async () => page.evaluate(() => (
      (window as Window & { __gobletSmoke?: { ready?: boolean } }).__gobletSmoke?.ready
    ))).toBe(true);

    const pixel = await page.locator('#preview-canvas').evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      const context = target.getContext('2d', { willReadFrequently: true });
      return Array.from(context?.getImageData(8, 8, 1, 1).data ?? []);
    });

    expect(pixel[0]).toBeGreaterThanOrEqual(126);
    expect(pixel[0]).toBeLessThanOrEqual(129);
    expect(pixel[1]).toBeGreaterThanOrEqual(126);
    expect(pixel[1]).toBeLessThanOrEqual(129);
    expect(pixel[2]).toBeLessThan(3);
  });

  test('does not adjust the transparent-project viewer background', async ({ page }) => {
    await page.setContent(buildSingleFileGoblet2Html(createTransparentAdjustmentBundle()));
    await expect.poll(async () => page.evaluate(() => (
      (window as Window & { __gobletSmoke?: { ready?: boolean } }).__gobletSmoke?.ready
    ))).toBe(true);

    const pixels = await page.locator('#preview-canvas').evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      const context = target.getContext('2d', { willReadFrequently: true });
      return {
        artwork: Array.from(context?.getImageData(4, 8, 1, 1).data ?? []),
        viewer: Array.from(context?.getImageData(12, 8, 1, 1).data ?? []),
      };
    });

    expect(pixels.artwork[0]).toBeGreaterThan(200);
    expect(pixels.artwork[1]).toBeGreaterThan(200);
    expect(pixels.viewer.slice(0, 4)).toEqual([42, 42, 46, 255]);
  });

  test('isolates a grouped adjustment to lower siblings in that group', async ({ page }) => {
    await page.setContent(buildSingleFileGoblet2Html(createScopedAdjustmentBundle()));
    await expect.poll(async () => page.evaluate(() => (
      (window as Window & { __gobletSmoke?: { ready?: boolean } }).__gobletSmoke?.ready
    ))).toBe(true);

    const pixels = await page.locator('#preview-canvas').evaluate((canvas) => {
      const target = canvas as HTMLCanvasElement;
      const context = target.getContext('2d', { willReadFrequently: true });
      return {
        grouped: Array.from(context?.getImageData(4, 8, 1, 1).data ?? []),
        ungrouped: Array.from(context?.getImageData(12, 8, 1, 1).data ?? []),
      };
    });

    expect(pixels.grouped[0]).toBeGreaterThan(200);
    expect(pixels.grouped[1]).toBeGreaterThan(200);
    expect(pixels.ungrouped.slice(0, 4)).toEqual([0, 0, 255, 255]);
  });

  test('translates one unchanged Sierra plate rigidly across every band', async ({ browser }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 320, height: 160 },
    });
    await installControlledBrowserState(context, { useManualAnimationFrames: true });
    const page = await context.newPage();
    const smokeUrl = 'http://goblet-smoke.test/sierra-rigid-sheet';

    const readRedSpans = async (y: number) => page.evaluate((sampleY) => {
      const canvas = document.querySelector('canvas');
      const context2d = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context2d) return [];
      const data = context2d.getImageData(0, sampleY, canvas.width, 1).data;
      const spans: Array<[number, number]> = [];
      let start = -1;
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = x * 4;
        const isRed = data[offset] > 240 && data[offset + 1] < 16 && data[offset + 2] < 16;
        if (isRed && start < 0) start = x;
        if (!isRed && start >= 0) {
          spans.push([start, x]);
          start = -1;
        }
      }
      if (start >= 0) spans.push([start, canvas.width]);
      return spans;
    }, y);

    try {
      await page.route(smokeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildSingleFileGoblet2Html(createSierraTravelBundle()),
        });
      });
      await page.goto(smokeUrl, { waitUntil: 'load' });
      await waitForSmokeReady(page);

      expect(await renderGobletInterlaceAt(page, 2)).toBe(true);
      expect(await readRedSpans(8)).toEqual([
        [0, 32],
        [64, 96],
        [128, 160],
      ]);
      expect(await readRedSpans(40)).toEqual([
        [0, 16],
        [32, 48],
        [64, 80],
        [96, 112],
        [128, 144],
      ]);

      expect(await renderGobletInterlaceAt(page, 2.5)).toBe(true);
      expect(await readRedSpans(8)).toEqual([
        [8, 40],
        [72, 104],
        [136, 160],
      ]);
      expect(await readRedSpans(40)).toEqual([
        [8, 24],
        [40, 56],
        [72, 88],
        [104, 120],
        [136, 152],
      ]);
    } finally {
      await context.close();
    }
  });

  test('replaces A with B transparency inside each active Sierra cell', async ({ browser }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 320, height: 160 },
    });
    await installControlledBrowserState(context, { useManualAnimationFrames: true });
    const page = await context.newPage();
    const smokeUrl = 'http://goblet-smoke.test/sierra-transparency';
    const revealTexture = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect x="40" y="0" width="8" height="32" fill="#ff0000"/></svg>',
    )}`;

    try {
      await page.route(smokeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildSingleFileGoblet2Html(createSierraTravelBundle(revealTexture)),
        });
      });
      await page.goto(smokeUrl, { waitUntil: 'load' });
      await waitForSmokeReady(page);
      expect(await renderGobletInterlaceAt(page, 0)).toBe(true);

      const pixels = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const context2d = canvas?.getContext('2d', { willReadFrequently: true });
        if (!context2d) return null;
        const read = (x: number, y: number) => (
          Array.from(context2d.getImageData(x, y, 1, 1).data)
        );
        return {
          outsideCell: read(20, 8),
          transparentB: read(36, 8),
          paintedB: read(44, 8),
          betweenCells: read(80, 8),
        };
      });
      expect(pixels).toEqual({
        outsideCell: [0, 0, 0, 255],
        transparentB: [119, 119, 119, 255],
        paintedB: [255, 0, 0, 255],
        betweenCells: [0, 0, 0, 255],
      });
    } finally {
      await context.close();
    }
  });

  test('caps fixed mobile DPR and keeps lifecycle pause state authoritative', async ({ browser }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 3,
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    await installControlledBrowserState(context);
    const page = await context.newPage();
    const smokeUrl = 'http://goblet-smoke.test/?gobletProfile=1';
    const bundle = createWebGlFallbackBundle();
    bundle.project.width = 1200;
    bundle.project.height = 900;
    bundle.viewport.designWidth = 1200;
    bundle.viewport.designHeight = 900;

    try {
      await page.route(smokeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildSingleFileGoblet2Html(bundle),
        });
      });
      await page.goto(smokeUrl, { waitUntil: 'load' });
      await waitForSmokeReady(page);

      const initialProfile = await readProfile(page);
      expect(initialProfile).toMatchObject({
        rafRunning: true,
        rawDpr: 3,
        isMobileDprCapped: true,
      });
      expect(initialProfile.effectiveDpr).toBeLessThanOrEqual(2);
      expect(initialProfile.effectiveDpr).toBeCloseTo(Math.sqrt(4_194_304 / (1200 * 900)));
      expect(initialProfile.backingPixels).toBeLessThanOrEqual(4_194_304);
      expect(initialProfile.players[0]).toMatchObject({
        useWebGL: false,
        webglInitAttempted: true,
        webglInitFailed: true,
        adaptiveScaleEnabled: true,
        renderScale: 1,
      });
      expect(initialProfile.players[0].webglFallbackReason).toEqual(expect.any(String));
      await expect(page.locator('#preview-canvas')).toHaveCSS('width', '1200px');
      await expect(page.locator('#preview-canvas')).toHaveCSS('height', '900px');

      await page.evaluate(() => {
        (window as Window & {
          __setGobletIntersection?: (isIntersecting: boolean) => void;
        }).__setGobletIntersection?.(false);
      });
      await expect.poll(async () => (await readProfile(page)).rafRunning).toBe(false);
      expect((await readProfile(page)).pauseReasons).toContain('canvas-offscreen');

      await page.evaluate(() => {
        document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown'));
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(200);
      expect((await readProfile(page)).rafRunning).toBe(false);

      await page.evaluate(() => {
        (window as Window & {
          __setGobletIntersection?: (isIntersecting: boolean) => void;
        }).__setGobletIntersection?.(true);
      });
      await expect.poll(async () => (await readProfile(page)).rafRunning).toBe(true);

      await page.evaluate(() => {
        (window as Window & {
          __setGobletDocumentHidden?: (isHidden: boolean) => void;
        }).__setGobletDocumentHidden?.(true);
      });
      await expect.poll(async () => (await readProfile(page)).rafRunning).toBe(false);
      expect((await readProfile(page)).pauseReasons).toContain('document-hidden');

      await page.evaluate(() => {
        document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown'));
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(200);
      expect((await readProfile(page)).rafRunning).toBe(false);

      await page.evaluate(() => {
        (window as Window & {
          __setGobletDocumentHidden?: (isHidden: boolean) => void;
        }).__setGobletDocumentHidden?.(false);
      });
      await expect.poll(async () => (await readProfile(page)).rafRunning).toBe(true);

      const resizeCountBeforeBurst = (await readProfile(page)).resizeFlushCount;
      await page.evaluate(() => {
        for (let eventIndex = 0; eventIndex < 5; eventIndex += 1) {
          window.dispatchEvent(new Event('resize'));
        }
      });
      await expect.poll(async () => (await readProfile(page)).resizeFlushCount).toBe(resizeCountBeforeBurst + 2);
    } finally {
      await context.close();
    }
  });

  test('adapts CPU render scale with hysteresis and a transition cooldown', async ({ browser }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    });
    await installControlledBrowserState(context, { useManualAnimationFrames: true });
    const page = await context.newPage();
    const smokeUrl = 'http://goblet-smoke.test/?gobletProfile=1';

    try {
      await page.route(smokeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildSingleFileGoblet2Html(createWebGlFallbackBundle()),
        });
      });
      await page.goto(smokeUrl, { waitUntil: 'load' });
      await waitForSmokeReady(page);

      const slowFrameTimestamps = [1, 100, 1200, 2300, 3400];
      const steppedSlowFrames = await page.evaluate((timestamps) => {
        const stepFrame = (window as Window & {
          __stepGobletAnimationFrame?: (timestamp: number) => boolean;
        }).__stepGobletAnimationFrame;
        return timestamps.map((timestamp) => stepFrame?.(timestamp) === true);
      }, slowFrameTimestamps);
      expect(steppedSlowFrames).toEqual([true, true, true, true, true]);
      await expect.poll(async () => (await readProfile(page)).players[0].renderScale).toBe(0.5);
      expect((await readProfile(page)).players[0]).toMatchObject({
        scaleTransitionActive: false,
        lastScaleTransitionReason: 'three-slow-windows',
      });

      const fastFramesStepped = await page.evaluate(() => {
        const stepFrame = (window as Window & {
          __stepGobletAnimationFrame?: (timestamp: number) => boolean;
        }).__stepGobletAnimationFrame;
        let timestamp = 3400;
        let count = 0;
        for (let frameIndex = 0; frameIndex < 2000; frameIndex += 1) {
          timestamp += 1000 / 60;
          if (!stepFrame?.(timestamp)) {
            break;
          }
          count += 1;
        }
        return count;
      });
      expect(fastFramesStepped).toBeGreaterThan(1800);
      await expect.poll(async () => (await readProfile(page)).players[0].renderScale).toBe(1);
      expect((await readProfile(page)).players[0]).toMatchObject({
        scaleTransitionActive: false,
        lastScaleTransitionReason: 'five-fast-windows',
      });
    } finally {
      await context.close();
    }
  });
});
