import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'playwright/test';

import { createGoblet2Bundle } from './fixtures/goblet2Bundle';

const rootDir = process.cwd();

const readText = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const sidecarBytes: Record<string, Uint8Array> = {
  '/buffers/layer-0/brush-indexBuffer.bin': Uint8Array.from([1, 2, 3, 4]),
  '/buffers/layer-0/brush-gradientIdBuffer.bin': Uint8Array.from([0, 0, 0, 0]),
  '/buffers/layer-0/brush-speedBuffer.bin': Uint8Array.from([255, 255, 255, 255]),
  '/buffers/layer-0/brush-flowBuffer.bin': Uint8Array.from([1, 1, 1, 1]),
  '/buffers/layer-0/brush-phaseBuffer.bin': Uint8Array.from([0, 64, 128, 192]),
};

const createSidecarMetadata = () => {
  const metadata = createGoblet2Bundle();
  const brushState = metadata.layers[0].colorCycle?.brushState as Record<string, unknown>;
  brushState.indexBuffer = {
    ref: 'buffers/layer-0/brush-indexBuffer.bin',
    encoding: 'u8',
    byteLength: 4,
  };
  brushState.gradientIdBuffer = {
    ref: 'buffers/layer-0/brush-gradientIdBuffer.bin',
    encoding: 'u8',
    byteLength: 4,
  };
  brushState.speedBuffer = {
    ref: 'buffers/layer-0/brush-speedBuffer.bin',
    encoding: 'u8',
    byteLength: 4,
  };
  brushState.flowBuffer = {
    ref: 'buffers/layer-0/brush-flowBuffer.bin',
    encoding: 'u8',
    byteLength: 4,
  };
  brushState.phaseBuffer = {
    ref: 'buffers/layer-0/brush-phaseBuffer.bin',
    encoding: 'u8',
    byteLength: 4,
  };
  metadata.settings.bundleFormat = 'zip';
  return metadata;
};

const buildExtractedZipHtml = () => [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8" />',
  '  <title>Goblet 2 Binary Sidecar Smoke</title>',
  '  <style>html,body{margin:0;background:#000}canvas{width:128px;height:128px;image-rendering:pixelated}</style>',
  '</head>',
  '<body>',
  '  <canvas id="preview-canvas" width="128" height="128"></canvas>',
  '  <script type="module">',
  "    import { renderVesselWebGL } from './goblet2.js';",
  "    const canvas = document.getElementById('preview-canvas');",
  '    window.__gobletSidecarSmoke = { ready: false };',
  '    const countPixels = () => {',
  "      const ctx = canvas.getContext('2d', { willReadFrequently: true });",
  '      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;',
  '      let nonZeroAlpha = 0;',
  '      let nonZeroRgba = 0;',
  '      for (let index = 0; index < data.length; index += 4) {',
  '        if (data[index + 3] > 0) nonZeroAlpha += 1;',
  '        if (data[index] || data[index + 1] || data[index + 2] || data[index + 3]) nonZeroRgba += 1;',
  '      }',
  '      return { nonZeroAlpha, nonZeroRgba };',
  '    };',
  '    try {',
  "      const metadata = await fetch('./bundle-goblet.json').then((response) => response.json());",
  '      const summary = await renderVesselWebGL(metadata, canvas, {});',
  '      window.__gobletSidecarSmoke = { ready: true, summary, ...countPixels() };',
  '    } catch (error) {',
  '      window.__gobletSidecarSmoke = { ready: true, error: error instanceof Error ? error.message : String(error) };',
  '      throw error;',
  '    }',
  '  </script>',
  '</body>',
  '</html>',
].join('\n');

test.describe('Goblet 2 binary sidecar runtime smoke', () => {
  test('loads extracted ZIP-style metadata and binary buffers over HTTP', async ({ page }) => {
    const baseUrl = 'http://goblet-sidecar.test/';
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

    await page.route('http://goblet-sidecar.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') {
        await route.fulfill({ status: 200, contentType: 'text/html', body: buildExtractedZipHtml() });
        return;
      }
      if (url.pathname === '/bundle-goblet.json') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createSidecarMetadata()),
        });
        return;
      }
      const sidecar = sidecarBytes[url.pathname];
      if (sidecar) {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: Buffer.from(sidecar),
        });
        return;
      }
      const runtimeAsset = url.pathname.slice(1);
      if (
        runtimeAsset === 'goblet2.js' ||
        runtimeAsset === 'alignFitResolver.js' ||
        runtimeAsset === 'displayFilterPipeline.js' ||
        runtimeAsset === 'num.js' ||
        runtimeAsset === 'fflate-inflate.js'
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: readText(`public/goblet2/${runtimeAsset}`),
        });
        return;
      }
      await route.fulfill({ status: 404, body: 'not found' });
    });

    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as Window & { __gobletSidecarSmoke?: { ready?: boolean } }).__gobletSidecarSmoke?.ready), undefined, {
      timeout: 5000,
    });

    const smoke = await page.evaluate(() => (window as Window & { __gobletSidecarSmoke?: unknown }).__gobletSidecarSmoke);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(smoke).toMatchObject({ ready: true });
    expect(smoke).not.toHaveProperty('error');
    expect((smoke as { nonZeroAlpha: number }).nonZeroAlpha).toBeGreaterThan(0);
    expect((smoke as { nonZeroRgba: number }).nonZeroRgba).toBeGreaterThan(0);
  });
});
