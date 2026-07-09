import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'playwright/test';

const rootDir = process.cwd();

const read = (relativePath: string): string => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const EXPECTED_FLOW_BYTES = [1, 2, 3, 1, 1, 2, 3, 1];
const EXPECTED_PHASE_BYTES = [0, 32, 64, 0, 96, 128, 192, 224];
const MASK_CASE_EXPECTATIONS = {
  eraseVisible: { layerEntryCount: 1, hiddenLayerEntryCount: 0 },
  eraseHidden: { layerEntryCount: 2, hiddenLayerEntryCount: 1 },
  softVisible: { layerEntryCount: 1, hiddenLayerEntryCount: 0 },
  softHidden: { layerEntryCount: 2, hiddenLayerEntryCount: 1 },
} as const;

type PixelDiff = {
  maxChannelDelta: number;
  maxAlphaDelta: number;
  mismatchedPixels: number;
  mismatches: Array<{
    pixel: number;
    cpu: number[];
    gpu: number[];
    delta: number[];
  }>;
};

type RuntimePlayerState = {
  useWebGL: boolean;
  webglSlotCount: number | null;
  baseTimeSeconds: number | null;
  legacyOffset01: number | null;
  gradientIds: number[] | null;
  speedBytes: number[] | null;
  slotSpeedData: number[] | null;
  flowBytes: number[] | null;
  phaseBytes: number[] | null;
  paletteSize: number | null;
};

type RuntimeFlags = {
  foundViewer: boolean;
  layerEntryCount: number;
  hiddenLayerEntryCount: number;
  playerCount: number;
  usesWebGL: boolean;
  usesCpu: boolean;
  playerState: RuntimePlayerState[];
};

const createGpuParityMetadata = () => ({
  format: 'vessel-goblet2',
  version: 1,
  exportedAt: '2026-07-07T00:00:00.000Z',
  project: {
    id: 'gpu-parity-project',
    name: 'GPU Parity Project',
    width: 4,
    height: 2,
    backgroundColor: '#00000000',
  },
  colorCycle: {
    schemaVersion: 2,
  },
  viewport: {
    mode: 'fixed',
    designWidth: 4,
    designHeight: 2,
  },
  container: {
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizeMode: 'fill',
  },
  animation: {
    fps: 30,
    totalFrames: 60,
    durationSeconds: 2,
    perfectLoop: false,
  },
  settings: {
    includeHiddenLayers: true,
    embedCanvasFallback: false,
    minifyOutput: false,
    perfectLoop: false,
    bundleFormat: 'json',
    htmlTitle: 'Goblet2 CPU GPU Parity',
    displayFilters: [
      {
        id: 'pixelate',
        enabled: true,
        settings: { cellSize: 2 },
      },
    ],
  },
  layers: [
    {
      id: 'cc-gpu-parity',
      name: 'CC GPU Parity',
      type: 'color-cycle',
      visible: true,
      source: { width: 4, height: 2 },
      documentBoundsPx: { x: 0, y: 0, width: 4, height: 2 },
      documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
      alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
      colorCycle: {
        mode: 'brush',
        speedMode: 'buffer',
        speedMin: 0.1,
        speedMax: 0.5,
        isAnimating: true,
        brushState: {
          width: 4,
          height: 2,
          indexBuffer: [1, 64, 128, 0, 255, 96, 32, 8],
          gradientIdBuffer: [0, 1, 3, 2, 255, 1, 2, 1],
          gradientDefIdBuffer: [1, 1, 1, 0, 1, 1, 1, 1],
          speedBuffer: [255, 128, 0, 0, 32, 200, 1, 254],
          flowBuffer: EXPECTED_FLOW_BYTES,
          phaseBuffer: EXPECTED_PHASE_BYTES,
          gradientStops: [
            { position: 0, color: '#111111' },
            { position: 0.5, color: '#888888' },
            { position: 1, color: '#eeeeee' },
          ],
          animationOffset: 0.125,
          alphaMode: 'opaque-indices',
        },
        alphaMask: {
          width: 4,
          height: 2,
          data: [0, 64, 128, 0, 32, 96, 160, 224],
        },
        softEdgeMask: {
          width: 4,
          height: 2,
          data: [255, 224, 192, 255, 160, 128, 96, 64],
        },
        slotPalettes: [
          {
            slot: 0,
            stops: [
              { position: 0, color: '#ff0000' },
              { position: 1, color: '#0000ff' },
            ],
          },
          {
            slot: 1,
            stops: [
              { position: 0, color: '#00ff00' },
              { position: 1, color: '#ff00ff' },
            ],
          },
          {
            slot: 2,
            stops: [
              { position: 0, color: '#ffffff' },
              { position: 1, color: '#000000' },
            ],
          },
        ],
      },
    },
    {
      id: 'hidden-cc-gpu-parity',
      name: 'Hidden CC GPU Parity',
      type: 'color-cycle',
      visible: false,
      source: { width: 4, height: 2 },
      documentBoundsPx: { x: 0, y: 0, width: 4, height: 2 },
      documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
      alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
      colorCycle: {
        mode: 'brush',
        speedMode: 'buffer',
        speedMin: 0.1,
        speedMax: 0.5,
        isAnimating: true,
        brushState: {
          width: 4,
          height: 2,
          indexBuffer: [255, 255, 255, 255, 255, 255, 255, 255],
          gradientIdBuffer: [0, 0, 0, 0, 0, 0, 0, 0],
          gradientDefIdBuffer: [1, 1, 1, 1, 1, 1, 1, 1],
          speedBuffer: [255, 255, 255, 255, 255, 255, 255, 255],
          flowBuffer: [1, 1, 1, 1, 1, 1, 1, 1],
          phaseBuffer: [0, 0, 0, 0, 0, 0, 0, 0],
          gradientStops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#ffff00' },
          ],
          animationOffset: 0,
          alphaMode: 'opaque-indices',
        },
      },
    },
  ],
});

const buildCpuGpuParityHtml = (): string => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = JSON.stringify(createGpuParityMetadata());

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Goblet2 CPU GPU Parity</title></head>',
    '<body>',
    '<canvas id="gpu" width="4" height="2"></canvas>',
    '<canvas id="cpu" width="4" height="2"></canvas>',
    '<canvas id="unfiltered" width="4" height="2"></canvas>',
    '<canvas id="plain-gpu" width="4" height="2"></canvas>',
    '<canvas id="plain-cpu" width="4" height="2"></canvas>',
    '<script type="module">',
    runtime,
    `const metadata = ${metadata};`,
    `const gpuCanvas = document.getElementById('gpu');
const cpuCanvas = document.getElementById('cpu');
const unfilteredCanvas = document.getElementById('unfiltered');
const plainGpuCanvas = document.getElementById('plain-gpu');
const plainCpuCanvas = document.getElementById('plain-cpu');
const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalWarn = console.warn.bind(console);
const warnings = [];
console.warn = (...args) => {
  warnings.push(args.map((value) => String(value)).join(' '));
  originalWarn(...args);
};
const rafCallbacks = [];
let rafId = 1;
window.__gobletCpuGpuParity = { ready: false };
window.requestAnimationFrame = (callback) => {
  rafCallbacks.push(callback);
  return rafId++;
};
window.cancelAnimationFrame = () => {};
const stepFrames = async (...timestamps) => {
  for (const timestamp of timestamps) {
    const callbacks = rafCallbacks.splice(0);
    callbacks.forEach((callback) => callback(timestamp));
    await Promise.resolve();
  }
};
const withWebGLDisabled = async (callback) => {
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
    if (type === 'webgl2') {
      return null;
    }
    return originalGetContext.call(this, type, ...args);
  };
  try {
    return await callback();
  } finally {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  }
};
const readPixels = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
};
const getColorCycleRuntimeFlags = (canvas) => {
  const viewer = Object.getOwnPropertySymbols(canvas)
    .map((symbol) => canvas[symbol])
    .find((candidate) => candidate && Array.isArray(candidate.dynamicPlayers));
  const players = Array.isArray(viewer?.dynamicPlayers) ? viewer.dynamicPlayers : [];
  const layerEntries = Array.isArray(viewer?.layerEntries) ? viewer.layerEntries : [];
  return {
    foundViewer: Boolean(viewer),
    layerEntryCount: layerEntries.length,
    hiddenLayerEntryCount: layerEntries.filter((entry) => entry?.layer?.visible === false).length,
    playerCount: players.length,
    usesWebGL: players.some((player) => player?.useWebGL === true),
    usesCpu: players.some((player) => player?.useWebGL === false),
    playerState: players.map((player) => ({
      useWebGL: player?.useWebGL === true,
      webglSlotCount: player?.webglRenderer?.slotCount ?? null,
      baseTimeSeconds: player?.baseTimeSeconds ?? null,
      legacyOffset01: player?.legacyOffset01 ?? null,
      gradientIds: player?.gradientIdBuffer ? Array.from(player.gradientIdBuffer) : null,
      speedBytes: player?.speedBuffer ? Array.from(player.speedBuffer) : null,
      slotSpeedData: player?.slotSpeedData ? Array.from(player.slotSpeedData) : null,
      flowBytes: player?.flowBuffer ? Array.from(player.flowBuffer) : null,
      phaseBytes: player?.phaseBuffer ? Array.from(player.phaseBuffer) : null,
      paletteSize: player?.webglRenderer?.paletteSize ?? player?.cycleColors ?? null,
    })),
  };
};
const diffPixels = (a, b) => {
  let maxChannelDelta = 0;
  let maxAlphaDelta = 0;
  let mismatchedPixels = 0;
  const mismatches = [];
  for (let index = 0; index < a.length; index += 4) {
    const dr = Math.abs(a[index] - b[index]);
    const dg = Math.abs(a[index + 1] - b[index + 1]);
    const db = Math.abs(a[index + 2] - b[index + 2]);
    const da = Math.abs(a[index + 3] - b[index + 3]);
    const maxRgb = Math.max(dr, dg, db);
    maxChannelDelta = Math.max(maxChannelDelta, maxRgb);
    maxAlphaDelta = Math.max(maxAlphaDelta, da);
    if (maxRgb > 0 || da > 0) {
      mismatchedPixels += 1;
      mismatches.push({
        pixel: index / 4,
        cpu: a.slice(index, index + 4),
        gpu: b.slice(index, index + 4),
        delta: [dr, dg, db, da],
      });
    }
  }
  return { maxChannelDelta, maxAlphaDelta, mismatchedPixels, mismatches };
};
const createPlainMetadata = () => {
  const plain = structuredClone(metadata);
  plain.settings.displayFilters = [];
  plain.layers = plain.layers.filter((layer) => layer.visible !== false);
  delete plain.layers[0].colorCycle.alphaMask;
  delete plain.layers[0].colorCycle.softEdgeMask;
  return plain;
};
const createMaskCaseMetadata = ({ mask, includeHidden }) => {
  const masked = structuredClone(metadata);
  masked.layers = includeHidden
    ? masked.layers
    : masked.layers.filter((layer) => layer.visible !== false);
  if (mask === 'erase') {
    delete masked.layers[0].colorCycle.softEdgeMask;
  } else if (mask === 'soft-edge') {
    delete masked.layers[0].colorCycle.alphaMask;
  }
  return masked;
};
const createBlackWhiteFallbackMetadata = () => {
  const fallback = createPlainMetadata();
  fallback.layers[0].colorCycle.brushState = {
    ...fallback.layers[0].colorCycle.brushState,
    indexBuffer: [1, 255, 0, 0, 0, 0, 0, 0],
    gradientIdBuffer: [0, 0, 0, 0, 0, 0, 0, 0],
    speedBuffer: [0, 0, 0, 0, 0, 0, 0, 0],
    flowBuffer: [1, 1, 1, 1, 1, 1, 1, 1],
    phaseBuffer: [0, 0, 0, 0, 0, 0, 0, 0],
    animationOffset: 0,
  };
  delete fallback.layers[0].colorCycle.brushState.gradientStops;
  delete fallback.layers[0].colorCycle.slotPalettes;
  return fallback;
};
const createSlotSpeedMetadata = () => {
  const slotSpeed = createPlainMetadata();
  slotSpeed.layers[0].id = 'slot-speed-gpu-parity';
  slotSpeed.layers[0].name = 'Slot Speed GPU Parity';
  slotSpeed.layers[0].colorCycle = {
    ...slotSpeed.layers[0].colorCycle,
    speedMode: 'slot',
    speedMin: 0,
    speedMax: 2.54,
    slotSpeeds: [
      { slot: 0, speed: 1 },
      { slot: 1, speed: 0 },
      { slot: 2, speed: 4 },
    ],
    brushState: {
      ...slotSpeed.layers[0].colorCycle.brushState,
      speedBuffer: undefined,
      gradientIdBuffer: [0, 1, 2, 0, 1, 2, 0, 1],
      gradientDefIdBuffer: [1, 1, 1, 1, 1, 1, 1, 1],
      flowBuffer: [1, 2, 3, 1, 2, 3, 1, 2],
      phaseBuffer: [0, 0, 0, 64, 64, 64, 128, 128],
    },
  };
  return slotSpeed;
};
const createRenderCanvas = (id) => {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.width = 4;
  canvas.height = 2;
  document.body.appendChild(canvas);
  return canvas;
};
const renderCase = async (name, metadataForCase) => {
  const caseGpuCanvas = createRenderCanvas(name + '-gpu');
  const caseCpuCanvas = createRenderCanvas(name + '-cpu');
  await renderVesselWebGL(metadataForCase, caseGpuCanvas, {});
  await withWebGLDisabled(() => renderVesselWebGL(structuredClone(metadataForCase), caseCpuCanvas, {}));
  return {
    gpuPixels: readPixels(caseGpuCanvas),
    cpuPixels: readPixels(caseCpuCanvas),
    gpuRuntime: getColorCycleRuntimeFlags(caseGpuCanvas),
    cpuRuntime: getColorCycleRuntimeFlags(caseCpuCanvas),
  };
};
try {
  if (typeof setGobletDiagnosticsEnabled === 'function') {
    setGobletDiagnosticsEnabled(true);
  }
  const gpuSummary = await renderVesselWebGL(metadata, gpuCanvas, {});
  const cpuSummary = await withWebGLDisabled(() => renderVesselWebGL(structuredClone(metadata), cpuCanvas, {}));
  const unfilteredMetadata = structuredClone(metadata);
  unfilteredMetadata.settings.displayFilters = [];
  const unfilteredSummary = await renderVesselWebGL(unfilteredMetadata, unfilteredCanvas, {});
  const plainMetadata = createPlainMetadata();
  const plainGpuSummary = await renderVesselWebGL(plainMetadata, plainGpuCanvas, {});
  const plainCpuSummary = await withWebGLDisabled(() => renderVesselWebGL(structuredClone(plainMetadata), plainCpuCanvas, {}));
  const blackWhiteFallback = await renderCase('black-white-fallback', createBlackWhiteFallbackMetadata());
  const slotSpeed = await renderCase('slot-speed', createSlotSpeedMetadata());
  const maskCases = {
    eraseVisible: await renderCase('erase-visible', createMaskCaseMetadata({ mask: 'erase', includeHidden: false })),
    eraseHidden: await renderCase('erase-hidden', createMaskCaseMetadata({ mask: 'erase', includeHidden: true })),
    softVisible: await renderCase('soft-visible', createMaskCaseMetadata({ mask: 'soft-edge', includeHidden: false })),
    softHidden: await renderCase('soft-hidden', createMaskCaseMetadata({ mask: 'soft-edge', includeHidden: true })),
  };
  await stepFrames(1000, 1250);
  const gpuPixels = readPixels(gpuCanvas);
  const cpuPixels = readPixels(cpuCanvas);
  const unfilteredPixels = readPixels(unfilteredCanvas);
  const plainGpuPixels = readPixels(plainGpuCanvas);
  const plainCpuPixels = readPixels(plainCpuCanvas);
  const gpuRuntime = getColorCycleRuntimeFlags(gpuCanvas);
  const cpuRuntime = getColorCycleRuntimeFlags(cpuCanvas);
  const plainGpuRuntime = getColorCycleRuntimeFlags(plainGpuCanvas);
  const plainCpuRuntime = getColorCycleRuntimeFlags(plainCpuCanvas);
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  window.__gobletCpuGpuParity = {
    ready: true,
    gpuSummary,
    cpuSummary,
    unfilteredSummary,
    plainGpuSummary,
    plainCpuSummary,
    diff: diffPixels(cpuPixels, gpuPixels),
    plainDiff: diffPixels(plainCpuPixels, plainGpuPixels),
    blackWhiteFallbackDiff: diffPixels(blackWhiteFallback.cpuPixels, blackWhiteFallback.gpuPixels),
    blackWhiteFallbackPixels: {
      gpu: blackWhiteFallback.gpuPixels,
      cpu: blackWhiteFallback.cpuPixels,
    },
    blackWhiteFallbackRuntime: {
      gpuRuntime: blackWhiteFallback.gpuRuntime,
      cpuRuntime: blackWhiteFallback.cpuRuntime,
    },
    slotSpeedDiff: diffPixels(slotSpeed.cpuPixels, slotSpeed.gpuPixels),
    slotSpeedPixels: {
      gpu: slotSpeed.gpuPixels,
      cpu: slotSpeed.cpuPixels,
    },
    slotSpeedRuntime: {
      gpuRuntime: slotSpeed.gpuRuntime,
      cpuRuntime: slotSpeed.cpuRuntime,
    },
    maskCaseDiffs: Object.fromEntries(Object.entries(maskCases).map(([name, entry]) => [
      name,
      diffPixels(entry.cpuPixels, entry.gpuPixels),
    ])),
    filterDiff: diffPixels(unfilteredPixels, gpuPixels),
    gpuRuntime,
    cpuRuntime,
    plainGpuRuntime,
    plainCpuRuntime,
    maskCaseRuntimes: Object.fromEntries(Object.entries(maskCases).map(([name, entry]) => [
      name,
      {
        gpuRuntime: entry.gpuRuntime,
        cpuRuntime: entry.cpuRuntime,
      },
    ])),
    warnings,
    gpuPixels,
    cpuPixels,
    unfilteredPixels,
    plainGpuPixels,
    plainCpuPixels,
  };
} catch (error) {
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  window.__gobletCpuGpuParity = { ready: true, error: error instanceof Error ? error.message : String(error) };
  throw error;
}`,
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
};

test.use({
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  },
});

test.describe('Goblet 2 CPU/GPU rendered parity', () => {
  test('matches brush playback pixels between CPU fallback and WebGL2', async ({ page }) => {
    const parityUrl = 'http://goblet-cpu-gpu-parity.test/';
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    const hasWebGL2 = await page.evaluate(() => {
      const probe = document.createElement('canvas');
      return Boolean(probe.getContext('webgl2'));
    });
    test.skip(!hasWebGL2, 'WebGL2 is unavailable in this Playwright browser; GPU rendered parity cannot be measured here.');

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.route(parityUrl, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildCpuGpuParityHtml(),
      });
    });

    await page.goto(parityUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () => Boolean((window as Window & { __gobletCpuGpuParity?: { ready?: boolean } }).__gobletCpuGpuParity?.ready),
      undefined,
      { timeout: 5000 },
    );

    const result = await page.evaluate(() => (
      window as Window & {
        __gobletCpuGpuParity?: {
          ready: boolean;
          error?: string;
          diff: {
            maxChannelDelta: number;
            maxAlphaDelta: number;
            mismatchedPixels: number;
            mismatches: Array<{
              pixel: number;
              cpu: number[];
              gpu: number[];
              delta: number[];
            }>;
          };
          filterDiff: {
            maxChannelDelta: number;
            maxAlphaDelta: number;
            mismatchedPixels: number;
            mismatches: Array<{
              pixel: number;
              cpu: number[];
              gpu: number[];
              delta: number[];
            }>;
          };
          plainDiff: {
            maxChannelDelta: number;
            maxAlphaDelta: number;
            mismatchedPixels: number;
            mismatches: Array<{
              pixel: number;
              cpu: number[];
              gpu: number[];
              delta: number[];
            }>;
          };
          blackWhiteFallbackDiff: PixelDiff;
          blackWhiteFallbackPixels: {
            gpu: number[];
            cpu: number[];
          };
          blackWhiteFallbackRuntime: {
            gpuRuntime: RuntimeFlags;
            cpuRuntime: RuntimeFlags;
          };
          slotSpeedDiff: PixelDiff;
          slotSpeedPixels: {
            gpu: number[];
            cpu: number[];
          };
          slotSpeedRuntime: {
            gpuRuntime: RuntimeFlags;
            cpuRuntime: RuntimeFlags;
          };
          maskCaseDiffs: Record<keyof typeof MASK_CASE_EXPECTATIONS, PixelDiff>;
          gpuRuntime: RuntimeFlags;
          cpuRuntime: RuntimeFlags;
          plainGpuRuntime: RuntimeFlags;
          plainCpuRuntime: RuntimeFlags;
          maskCaseRuntimes: Record<keyof typeof MASK_CASE_EXPECTATIONS, {
            gpuRuntime: RuntimeFlags;
            cpuRuntime: RuntimeFlags;
          }>;
          warnings: string[];
          gpuPixels: number[];
          cpuPixels: number[];
          unfilteredPixels: number[];
          plainGpuPixels: number[];
          plainCpuPixels: number[];
        };
      }
    ).__gobletCpuGpuParity);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(result).toMatchObject({ ready: true });
    expect(result).not.toHaveProperty('error');
    expect(result?.gpuRuntime, result?.warnings.join('\n')).toMatchObject({
      foundViewer: true,
      layerEntryCount: 2,
      hiddenLayerEntryCount: 1,
      playerCount: 1,
      usesWebGL: true,
      usesCpu: false,
    });
    expect(result?.cpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 2,
      hiddenLayerEntryCount: 1,
      playerCount: 1,
      usesWebGL: false,
      usesCpu: true,
    });
    expect(result?.gpuRuntime.playerState[0]).toMatchObject({
      flowBytes: EXPECTED_FLOW_BYTES,
      phaseBytes: EXPECTED_PHASE_BYTES,
      paletteSize: 256,
    });
    expect(result?.cpuRuntime.playerState[0]).toMatchObject({
      flowBytes: EXPECTED_FLOW_BYTES,
      phaseBytes: EXPECTED_PHASE_BYTES,
      paletteSize: 256,
    });
    expect(result?.gpuPixels.length).toBe(4 * 2 * 4);
    expect(result?.cpuPixels.length).toBe(4 * 2 * 4);
    expect(result?.unfilteredPixels.length).toBe(4 * 2 * 4);
    expect(result?.diff.maxChannelDelta, JSON.stringify({
      mismatches: result?.diff.mismatches,
      cpuPixels: result?.cpuPixels,
      gpuPixels: result?.gpuPixels,
      cpuRuntime: result?.cpuRuntime,
      gpuRuntime: result?.gpuRuntime,
    })).toBeLessThanOrEqual(2);
    expect(result?.diff.maxAlphaDelta).toBeLessThanOrEqual(0);
    expect(result?.diff.mismatchedPixels).toBeLessThanOrEqual(6);
    expect(result?.plainGpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: true,
      usesCpu: false,
    });
    expect(result?.plainCpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: false,
      usesCpu: true,
    });
    expect(result?.plainGpuPixels.length).toBe(4 * 2 * 4);
    expect(result?.plainCpuPixels.length).toBe(4 * 2 * 4);
    expect(result?.plainDiff.maxChannelDelta, JSON.stringify({
      mismatches: result?.plainDiff.mismatches,
      cpuPixels: result?.plainCpuPixels,
      gpuPixels: result?.plainGpuPixels,
      cpuRuntime: result?.plainCpuRuntime,
      gpuRuntime: result?.plainGpuRuntime,
    })).toBeLessThanOrEqual(2);
    expect(result?.plainDiff.maxAlphaDelta).toBeLessThanOrEqual(0);
    expect(result?.plainDiff.mismatchedPixels).toBeLessThanOrEqual(6);
    expect(result?.blackWhiteFallbackRuntime.gpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: true,
      usesCpu: false,
    });
    expect(result?.blackWhiteFallbackRuntime.cpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: false,
      usesCpu: true,
    });
    expect(result?.blackWhiteFallbackRuntime.gpuRuntime.playerState[0]).toMatchObject({ paletteSize: 256 });
    expect(result?.blackWhiteFallbackRuntime.cpuRuntime.playerState[0]).toMatchObject({ paletteSize: 256 });
    expect(result?.blackWhiteFallbackDiff.maxChannelDelta, JSON.stringify({
      mismatches: result?.blackWhiteFallbackDiff.mismatches,
      cpuPixels: result?.blackWhiteFallbackPixels.cpu,
      gpuPixels: result?.blackWhiteFallbackPixels.gpu,
      cpuRuntime: result?.blackWhiteFallbackRuntime.cpuRuntime,
      gpuRuntime: result?.blackWhiteFallbackRuntime.gpuRuntime,
    })).toBeLessThanOrEqual(2);
    expect(result?.blackWhiteFallbackDiff.maxAlphaDelta).toBeLessThanOrEqual(0);
    expect(result?.blackWhiteFallbackDiff.mismatchedPixels).toBeLessThanOrEqual(2);
    expect(result?.blackWhiteFallbackPixels.gpu.slice(0, 4)).toEqual([0, 0, 0, 255]);
    expect(result?.blackWhiteFallbackPixels.cpu.slice(0, 4)).toEqual([0, 0, 0, 255]);
    expect(result?.blackWhiteFallbackPixels.gpu.slice(4, 8).every((value, index) => (
      index === 3 ? value === 255 : value >= 253
    )), JSON.stringify({
      gpuPixels: result?.blackWhiteFallbackPixels.gpu,
      cpuPixels: result?.blackWhiteFallbackPixels.cpu,
      runtime: result?.blackWhiteFallbackRuntime,
    })).toBe(true);
    expect(result?.blackWhiteFallbackPixels.cpu.slice(4, 8).every((value, index) => (
      index === 3 ? value === 255 : value >= 253
    ))).toBe(true);
    expect(result?.slotSpeedRuntime.gpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: true,
      usesCpu: false,
    });
    expect(result?.slotSpeedRuntime.cpuRuntime).toMatchObject({
      foundViewer: true,
      layerEntryCount: 1,
      hiddenLayerEntryCount: 0,
      playerCount: 1,
      usesWebGL: false,
      usesCpu: true,
    });
    expect(result?.slotSpeedRuntime.gpuRuntime.playerState[0]).toMatchObject({
      speedBytes: [0, 0, 0, 0, 0, 0, 0, 0],
      slotSpeedData: expect.arrayContaining([1, 0, 4]),
      flowBytes: [1, 2, 3, 1, 2, 3, 1, 2],
      phaseBytes: [0, 0, 0, 64, 64, 64, 128, 128],
      paletteSize: 256,
    });
    expect(result?.slotSpeedDiff.maxChannelDelta, JSON.stringify({
      mismatches: result?.slotSpeedDiff.mismatches,
      cpuPixels: result?.slotSpeedPixels.cpu,
      gpuPixels: result?.slotSpeedPixels.gpu,
      cpuRuntime: result?.slotSpeedRuntime.cpuRuntime,
      gpuRuntime: result?.slotSpeedRuntime.gpuRuntime,
    })).toBeLessThanOrEqual(2);
    expect(result?.slotSpeedDiff.maxAlphaDelta).toBeLessThanOrEqual(0);
    expect(result?.slotSpeedDiff.mismatchedPixels).toBeLessThanOrEqual(6);
    Object.entries(MASK_CASE_EXPECTATIONS).forEach(([caseName, expectedRuntime]) => {
      const typedCaseName = caseName as keyof typeof MASK_CASE_EXPECTATIONS;
      const caseDiff = result?.maskCaseDiffs[typedCaseName];
      const caseRuntime = result?.maskCaseRuntimes[typedCaseName];

      expect(caseRuntime?.gpuRuntime).toMatchObject({
        foundViewer: true,
        ...expectedRuntime,
        playerCount: 1,
        usesWebGL: true,
        usesCpu: false,
      });
      expect(caseRuntime?.cpuRuntime).toMatchObject({
        foundViewer: true,
        ...expectedRuntime,
        playerCount: 1,
        usesWebGL: false,
        usesCpu: true,
      });
      expect(caseDiff?.maxChannelDelta, JSON.stringify({
        caseName,
        mismatches: caseDiff?.mismatches,
        gpuRuntime: caseRuntime?.gpuRuntime,
        cpuRuntime: caseRuntime?.cpuRuntime,
      })).toBeLessThanOrEqual(2);
      expect(caseDiff?.maxAlphaDelta).toBeLessThanOrEqual(0);
      expect(caseDiff?.mismatchedPixels).toBeLessThanOrEqual(6);
    });
    expect(result?.filterDiff.maxChannelDelta, JSON.stringify({
      mismatches: result?.filterDiff.mismatches,
      unfilteredPixels: result?.unfilteredPixels,
      filteredPixels: result?.gpuPixels,
    })).toBeGreaterThan(0);
    expect(result?.filterDiff.mismatchedPixels).toBeGreaterThan(0);
  });
});
