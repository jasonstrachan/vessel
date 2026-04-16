import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'playwright/test';

import { createGoblet2Bundle } from './fixtures/goblet2Bundle';

const rootDir = process.cwd();

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const buildSingleFileGoblet2Html = () => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = JSON.stringify(createGoblet2Bundle());

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
    await page.waitForFunction(() => Boolean((window as Window & { __gobletSmoke?: { ready?: boolean } }).__gobletSmoke?.ready), undefined, {
      timeout: 5000,
    });

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
});
