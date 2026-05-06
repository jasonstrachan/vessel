import fs from 'node:fs';
import path from 'node:path';

import type { Page } from 'playwright/test';

import { createGoblet2Bundle } from '../fixtures/goblet2Bundle';

type GobletArtifactLayerResult = {
  id: string;
  nonZeroAlpha: number;
  nonBackgroundPixels: number;
};

export type GobletArtifactResult = {
  ready: boolean;
  error?: string;
  layers: GobletArtifactLayerResult[];
};

const rootDir = process.cwd();

const read = (relativePath: string): string => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

export const createSyntheticAdaLikeGoblet2Metadata = () => {
  const fullLayer = createGoblet2Bundle().layers[0];
  const sparseLayer = {
    ...fullLayer,
    id: 'cc-layer-2',
    name: 'CC Layer 2',
    source: { width: 4, height: 4 },
    documentBoundsPx: { x: 1, y: 1, width: 2, height: 2 },
    documentBoundsPercent: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    colorCycle: {
      ...fullLayer.colorCycle,
      coverageBoundsSourcePx: { x: 1, y: 1, width: 2, height: 2 },
      coverageBoundsPx: { x: 1, y: 1, width: 2, height: 2 },
      brushState: {
        ...(fullLayer.colorCycle?.brushState as Record<string, unknown>),
        width: 4,
        height: 4,
        indexBuffer: [
          0, 0, 0, 0,
          0, 1, 2, 0,
          0, 3, 4, 0,
          0, 0, 0, 0,
        ],
        gradientIdBuffer: new Array(16).fill(0),
        gradientDefIdBuffer: new Array(16).fill(7),
        speedBuffer: new Array(16).fill(255),
        flowBuffer: new Array(16).fill(1),
        phaseBuffer: Array.from({ length: 16 }, (_value, index) => index * 8),
      },
      alphaMask: {
        width: 4,
        height: 4,
        data: [
          0, 0, 0, 0,
          0, 255, 255, 0,
          0, 255, 255, 0,
          0, 0, 0, 0,
        ],
      },
      slotPalettes: [
        ...(fullLayer.colorCycle?.slotPalettes as Array<Record<string, unknown>>),
        {
          slot: 1,
          stops: [
            { position: 0, color: '#ffcc00' },
            { position: 1, color: '#00ccff' },
          ],
        },
      ],
      gradientDefStore: Array.from({ length: 8 }, (_value, index) => ({
        id: index + 1,
        slot: index % 2,
        stops: [
          { position: 0, color: index % 2 === 0 ? '#220000' : '#002200' },
          { position: 1, color: index % 2 === 0 ? '#ffee00' : '#00ffee' },
        ],
      })),
    },
  };

  const hiddenRaster = {
    id: 'hidden-raster',
    name: 'Hidden Raster',
    type: 'raster',
    visible: false,
    source: { width: 2, height: 2 },
    documentBoundsPx: { x: 0, y: 0, width: 2, height: 2 },
    documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
    alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
  };

  return {
    ...createGoblet2Bundle({
    layers: [
      {
        ...fullLayer,
        id: 'cc-layer-1',
        name: 'CC Layer 1',
        colorCycle: {
          ...fullLayer.colorCycle,
          brushState: {
            ...(fullLayer.colorCycle?.brushState as Record<string, unknown>),
            gradientStops: [
              { position: 0, color: '#330000' },
              { position: 1, color: '#ffcc00' },
            ],
          },
          slotPalettes: [{
            slot: 0,
            stops: [
              { position: 0, color: '#330000' },
              { position: 1, color: '#ffcc00' },
            ],
          }],
        },
      },
      sparseLayer,
      hiddenRaster,
    ],
    }),
    project: {
      ...createGoblet2Bundle().project,
      backgroundColor: '#00000000',
    },
  };
};

const buildSingleFileArtifactHtml = (metadata: unknown): string => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Goblet Artifact Harness</title></head>',
    '<body><canvas id="preview-canvas" width="128" height="128"></canvas>',
    '<script type="module">',
    runtime,
    `const metadata = ${JSON.stringify(metadata)};`,
    `const canvas = document.getElementById('preview-canvas');
window.__gobletArtifact = { ready: false, layers: [] };
const countPixels = () => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonZeroAlpha = 0;
  let nonBackgroundPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0) nonZeroAlpha += 1;
    if (data[index] || data[index + 1] || data[index + 2]) nonBackgroundPixels += 1;
  }
  return { nonZeroAlpha, nonBackgroundPixels };
};
try {
  const visible = metadata.layers.filter((layer) => layer.visible !== false);
  const layers = [];
  for (const layer of visible) {
    const isolated = {
      ...metadata,
      layers: metadata.layers.map((candidate) => ({ ...candidate, visible: candidate.id === layer.id })),
    };
    await renderVesselWebGL(isolated, canvas, {});
    layers.push({ id: layer.id, ...countPixels() });
  }
  window.__gobletArtifact = { ready: true, layers };
} catch (error) {
  window.__gobletArtifact = { ready: true, layers: [], error: error instanceof Error ? error.message : String(error) };
  throw error;
}`,
    '</script></body></html>',
  ].join('\n');
};

export const renderSingleFileGobletArtifact = async (
  page: Page,
  metadata = createSyntheticAdaLikeGoblet2Metadata(),
): Promise<{
  result: GobletArtifactResult;
  pageErrors: string[];
  consoleErrors: string[];
}> => {
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

  const url = 'http://goblet-artifact-harness.test/';
  await page.route(url, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildSingleFileArtifactHtml(metadata),
    });
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as Window & { __gobletArtifact?: { ready?: boolean } }).__gobletArtifact?.ready), undefined, {
    timeout: 5000,
  });

  return {
    result: await page.evaluate(() => (window as Window & { __gobletArtifact?: GobletArtifactResult }).__gobletArtifact!),
    pageErrors,
    consoleErrors,
  };
};
