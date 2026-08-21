import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from 'playwright/test';

const rootDir = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(
  path.join(rootDir, relativePath),
  'utf8',
);

const PROJECT_WIDTH = 100;
const PROJECT_HEIGHT = 1_200;

const metadata = {
  project: {
    id: 'txt-shape-position',
    name: 'TXT Shape position',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    backgroundColor: '#00000000',
  },
  viewport: {
    mode: 'fixed',
    designWidth: PROJECT_WIDTH,
    designHeight: PROJECT_HEIGHT,
  },
  settings: {
    viewportPreset: 'fixed-canvas',
  },
  layers: [{
    id: 'text-layer',
    name: 'Text layer',
    type: 'normal',
    visible: true,
  }],
  textShapes: [{
    id: 'text-shape',
    layerId: 'text-layer',
    x: 5,
    y: 6,
    width: 90,
    height: 1_180,
    padding: 2,
    columns: 3,
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: 'left',
    color: '#000000',
    selectionColor: '#ffffff',
    selectionBackgroundColor: '#000000',
    content: 'STATE A: semantic overlay',
    selections: [{ start: 0, end: 7 }],
  }],
};

const runtimeStub = `
export const debugLog = () => {};
export const isGobletDiagnosticsEnabled = () => false;
export const setGobletDiagnosticsEnabled = () => {};
export const resizeVesselWebGL = () => null;
export const renderVesselWebGL = async (metadata, canvas) => {
  const width = Math.max(1, Number(metadata.project?.width) || 1);
  const height = Math.max(1, Number(metadata.project?.height) || 1);
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  return {};
};
`;

const viewers = [
  {
    name: 'Goblet 1',
    path: 'public/goblet/index.html',
    url: 'http://goblet-txt-shape-position.test/goblet/index.html',
    runtimeUrl: 'http://goblet-txt-shape-position.test/goblet/goblet.js',
  },
  {
    name: 'Goblet 2',
    path: 'public/goblet2/index.html',
    url: 'http://goblet-txt-shape-position.test/goblet2/index.html',
    runtimeUrl: 'http://goblet-txt-shape-position.test/goblet2/goblet2.js',
  },
] as const;

const buildViewerHtml = (viewerPath: string): string => {
  const viewer = read(viewerPath);
  const marker = 'setStatus(readyMessage);';
  if (!viewer.includes(marker)) {
    throw new Error(`${viewerPath} is missing its ready marker`);
  }
  return viewer.replace(
    marker,
    `${marker}\n      await drawMetadata(${JSON.stringify(metadata)});`,
  );
};

const readCanvasOverlayDelta = async (page: Page) => page.evaluate(() => {
  const canvas = document.getElementById('preview-canvas');
  const overlay = document.getElementById('vessel-txt-shapes');
  if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
    return null;
  }
  const canvasRect = canvas.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: overlayRect.x - canvasRect.x,
    y: overlayRect.y - canvasRect.y,
    width: overlayRect.width - canvasRect.width,
    height: overlayRect.height - canvasRect.height,
  };
});

const readTxtShapeColumnGap = async (page: Page) => page.evaluate(() => {
  const shape = document.querySelector('[data-txt-shape-id="text-shape"]');
  return shape instanceof HTMLElement ? getComputedStyle(shape).columnGap : null;
});

test.describe('Goblet TXT Shape overlay positioning and layout', () => {
  for (const viewer of viewers) {
    test(`${viewer.name} matches Vessel columns after recenter and scroll`, async ({ page }) => {
      await page.route(viewer.runtimeUrl, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: runtimeStub,
        });
      });
      await page.route(viewer.url, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: buildViewerHtml(viewer.path),
        });
      });

      await page.setViewportSize({ width: 1_280, height: 1_400 });
      await page.goto(viewer.url, { waitUntil: 'load' });
      await page.waitForSelector('#vessel-txt-shapes');
      await expect.poll(() => readTxtShapeColumnGap(page)).toBe('5px');
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });

      await page.setViewportSize({ width: 1_280, height: 1_000 });
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });

      await page.evaluate(() => window.scrollTo(0, 150));
      await expect.poll(() => readCanvasOverlayDelta(page)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });
  }
});
