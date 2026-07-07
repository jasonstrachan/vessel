import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'playwright/test';

import { computeLayerDestination } from '@/utils/alignment/alignFitResolver';

const rootDir = process.cwd();
const read = (relativePath: string): string => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const VIEWPORT = { width: 12, height: 10 };
const DOCUMENT = { width: 4, height: 2 };
const PAINTED_BOUNDS = { x: 0, y: 0, width: 4, height: 2 };
const PIXEL_MODE_CASES = ['static', 'animated', 'mixed'] as const;
const FIT_MODES = ['none', 'contain', 'cover', 'fill', 'tile'] as const;
const SLOT_CASES = ['palette-fallback', 'slot-clamp'] as const;
const HIDDEN_CASES = ['off', 'on'] as const;
const MASK_CASES = ['none', 'erase', 'soft-edge'] as const;
const DISPLAY_FILTER_CASES = ['off', 'on'] as const;
const FILTERED_MAX_RED_RANGE = { min: 180, max: 192 };
const RED_STOPS = [
  { position: 0, color: '#ff0000' },
  { position: 1, color: '#ff0000' },
];
const GREEN_STOPS = [
  { position: 0, color: '#00ff00' },
  { position: 1, color: '#00ff00' },
];
const RED_BLUE_STOPS = [
  { position: 0, color: '#ff0000' },
  { position: 1, color: '#0000ff' },
];
const GREEN_BLUE_STOPS = [
  { position: 0, color: '#00ff00' },
  { position: 1, color: '#0000ff' },
];
const SOLID_CC_PIXELS = Array(DOCUMENT.width * DOCUMENT.height).fill(255);
const STATIC_SPEEDS = Array(DOCUMENT.width * DOCUMENT.height).fill(0);
const ANIMATED_SPEEDS = Array(DOCUMENT.width * DOCUMENT.height).fill(255);

type PixelModeCase = typeof PIXEL_MODE_CASES[number];
type FitMode = typeof FIT_MODES[number];
type SlotCase = typeof SLOT_CASES[number];
type HiddenCase = typeof HIDDEN_CASES[number];
type MaskCase = typeof MASK_CASES[number];
type DisplayFilterCase = typeof DISPLAY_FILTER_CASES[number];
type ColorStop = {
  position: number;
  color: string;
};
type ColorCycleMaskFixture = {
  width: number;
  height: number;
  data: number[];
};
type ColorCycleFixture = {
  mode: string;
  speedMode: string;
  speedMin?: number;
  speedMax?: number;
  isAnimating: boolean;
  brushState: {
    width: number;
    height: number;
    indexBuffer: number[];
    gradientIdBuffer: number[];
    gradientDefIdBuffer: number[];
    speedBuffer: number[];
    flowBuffer: number[];
    phaseBuffer: number[];
    gradientStops: ColorStop[];
    alphaMode: string;
  };
  slotPalettes: Array<{
    slot: number;
    stops: ColorStop[];
  }>;
  alphaMask?: ColorCycleMaskFixture;
  softEdgeMask?: ColorCycleMaskFixture;
};

type AlphaBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  colorPixels?: number;
  maxRed?: number;
};

const createColorCycleLayer = (
  pixelMode: PixelModeCase,
  fit: FitMode,
  slotCase: SlotCase,
  options: {
    id: string;
    name: string;
    visible: boolean;
    forceGreen?: boolean;
    maskCase?: MaskCase;
  },
) => {
  const isAnimated = pixelMode === 'animated';
  const visibleStops = isAnimated
    ? RED_BLUE_STOPS
    : RED_STOPS;
  const hiddenStops = isAnimated
    ? GREEN_BLUE_STOPS
    : GREEN_STOPS;
  const colorCycle: ColorCycleFixture = {
    mode: 'brush',
    speedMode: 'buffer',
    speedMin: isAnimated ? 1 : 0,
    speedMax: isAnimated ? 1 : 0,
    isAnimating: isAnimated,
    brushState: {
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      indexBuffer: SOLID_CC_PIXELS,
      gradientIdBuffer: SOLID_CC_PIXELS,
      gradientDefIdBuffer: SOLID_CC_PIXELS,
      speedBuffer: isAnimated ? ANIMATED_SPEEDS : STATIC_SPEEDS,
      flowBuffer: Array(DOCUMENT.width * DOCUMENT.height).fill(1),
      phaseBuffer: Array(DOCUMENT.width * DOCUMENT.height).fill(0),
      gradientStops: options.forceGreen || slotCase === 'slot-clamp' ? hiddenStops : visibleStops,
      alphaMode: 'opaque-indices',
    },
    slotPalettes: options.forceGreen
      ? [
          {
            slot: 255,
            stops: hiddenStops,
          },
        ]
      : slotCase === 'palette-fallback'
        ? [
            {
              slot: 0,
              stops: hiddenStops,
            },
          ]
        : [
            {
              slot: 0,
              stops: hiddenStops,
            },
            {
              slot: 255,
              stops: visibleStops,
            },
          ],
  };

  if (options.maskCase === 'erase') {
    colorCycle.alphaMask = {
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      data: [0, 0, 255, 255, 0, 0, 255, 255],
    };
  } else if (options.maskCase === 'soft-edge') {
    colorCycle.softEdgeMask = {
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      data: [255, 255, 0, 0, 255, 255, 0, 0],
    };
  }

  return {
    id: options.id,
    name: options.name,
    type: 'color-cycle',
    visible: options.visible,
    source: { ...DOCUMENT },
    documentBoundsPx: { x: 0, y: 0, width: DOCUMENT.width, height: DOCUMENT.height },
    documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
    contentBounds: { ...PAINTED_BOUNDS },
    alignment: {
      fit,
      horizontal: 'left',
      vertical: 'top',
      positioning: 'percent',
      offsetPercent: { x: 0, y: 0 },
    },
    colorCycle,
  };
};

const createFitModeMetadata = (
  pixelMode: PixelModeCase,
  fit: FitMode,
  slotCase: SlotCase = 'palette-fallback',
  hiddenCase: HiddenCase = 'off',
  maskCase: MaskCase = 'none',
  displayFilterCase: DisplayFilterCase = 'off',
) => ({
  format: 'vessel-goblet2',
  version: 1,
  exportedAt: '2026-07-07T00:00:00.000Z',
  project: {
    id: `fit-${fit}`,
    name: `Fit ${fit}`,
    width: DOCUMENT.width,
    height: DOCUMENT.height,
    backgroundColor: '#00000000',
  },
  viewport: {
    mode: 'fill',
    designWidth: VIEWPORT.width,
    designHeight: VIEWPORT.height,
  },
  colorCycle: {
    schemaVersion: 2,
  },
  animation: {
    fps: 30,
    totalFrames: 1,
    durationSeconds: 1 / 30,
    perfectLoop: false,
  },
  settings: {
    includeHiddenLayers: true,
    embedCanvasFallback: false,
    minifyOutput: false,
    perfectLoop: false,
    bundleFormat: 'json',
    htmlTitle: `Fit ${fit}`,
    displayFilters: displayFilterCase === 'on'
      ? [
          {
            id: 'color-grade',
            enabled: true,
            settings: {
              brightness: -0.25,
              contrast: 0,
              saturation: 1,
            },
          },
        ]
      : [],
  },
  layers: [
    ...(pixelMode === 'mixed'
      ? [
          createColorCycleLayer('static', fit, slotCase, {
            id: `static-cc-fit-${fit}-${slotCase}-${maskCase}`,
            name: `Static Color Cycle Fit ${fit} ${slotCase} ${maskCase}`,
            visible: true,
            maskCase,
          }),
        ]
      : []),
    createColorCycleLayer(pixelMode === 'mixed' ? 'animated' : pixelMode, fit, slotCase, {
      id: `cc-fit-${pixelMode}-${fit}-${slotCase}-${maskCase}`,
      name: `Color Cycle Fit ${pixelMode} ${fit} ${slotCase} ${maskCase}`,
      visible: true,
      maskCase,
    }),
    ...(hiddenCase === 'on'
      ? [
          createColorCycleLayer(pixelMode === 'static' ? 'static' : 'animated', fit, slotCase, {
            id: `hidden-cc-fit-${pixelMode}-${fit}-${slotCase}`,
            name: `Hidden Color Cycle Fit ${pixelMode} ${fit} ${slotCase}`,
            visible: false,
            forceGreen: true,
            maskCase,
          }),
        ]
      : []),
  ],
});

const expectedVisibleBounds = (fit: FitMode): AlphaBounds => {
  const dest = computeLayerDestination({
    document: DOCUMENT,
    viewport: VIEWPORT,
    alignment: {
      fit,
      horizontal: 'left',
      vertical: 'top',
      positioning: 'percent',
      offsetPercent: { x: 0, y: 0 },
    },
    paintedBounds: PAINTED_BOUNDS,
  });

  const x1 = Math.max(0, Math.round(dest.x));
  const y1 = Math.max(0, Math.round(dest.y));
  const x2 = Math.min(VIEWPORT.width, Math.round(dest.x + dest.width));
  const y2 = Math.min(VIEWPORT.height, Math.round(dest.y + dest.height));

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
};

const expectedMaskedBounds = (fit: FitMode, maskCase: MaskCase): AlphaBounds => {
  const fullBounds = expectedVisibleBounds(fit);
  if (maskCase === 'none') {
    return fullBounds;
  }

  if (fit === 'tile') {
    const visibleColumnsPerTile = 2;
    const visibleColumns = Array.from({ length: VIEWPORT.width }, (_, x) => (
      x % DOCUMENT.width < visibleColumnsPerTile
    ));
    const minX = visibleColumns.findIndex(Boolean);
    const maxX = visibleColumns.length - 1 - [...visibleColumns].reverse().findIndex(Boolean);
    const colorColumns = visibleColumns.filter(Boolean).length;
    return {
      x: Math.max(0, minX),
      y: 0,
      width: Math.max(0, maxX - minX + 1),
      height: VIEWPORT.height,
      colorPixels: colorColumns * VIEWPORT.height,
    };
  }

  const scaleX = fullBounds.width / DOCUMENT.width;
  const scaleY = fullBounds.height / DOCUMENT.height;
  const x1 = Math.max(0, Math.round(fullBounds.x));
  const y1 = Math.max(0, Math.round(fullBounds.y));
  const x2 = Math.min(VIEWPORT.width, Math.round(fullBounds.x + 2 * scaleX));
  const y2 = Math.min(VIEWPORT.height, Math.round(fullBounds.y + DOCUMENT.height * scaleY));

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
};

const buildFitModeHtml = (): string => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadataByCase = Object.fromEntries(
    PIXEL_MODE_CASES.flatMap((pixelMode) => FIT_MODES.flatMap((fit) => SLOT_CASES.flatMap((slotCase) => (
      HIDDEN_CASES.flatMap((hiddenCase) => MASK_CASES.flatMap((maskCase) => (
        DISPLAY_FILTER_CASES.map((displayFilterCase) => [
          `${pixelMode}:${fit}:${slotCase}:${hiddenCase}:${maskCase}:${displayFilterCase}`,
          createFitModeMetadata(pixelMode, fit, slotCase, hiddenCase, maskCase, displayFilterCase),
        ])
      )))
    )))),
  );

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Goblet2 Fit Mode Rendered Parity</title></head>',
    '<body>',
    '<script type="module">',
    runtime,
    `const metadataByCase = ${JSON.stringify(metadataByCase)};`,
    `const pixelModeCases = ${JSON.stringify(PIXEL_MODE_CASES)};`,
    `const fitModes = ${JSON.stringify(FIT_MODES)};`,
    `const slotCases = ${JSON.stringify(SLOT_CASES)};`,
    `const hiddenCases = ${JSON.stringify(HIDDEN_CASES)};`,
    `const maskCases = ${JSON.stringify(MASK_CASES)};`,
    `const displayFilterCases = ${JSON.stringify(DISPLAY_FILTER_CASES)};`,
    `const readRedBounds = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let colorPixels = 0;
  let maxRed = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const isRedLayerPixel = data[offset] > 128
        && data[offset + 1] < 16
        && data[offset + 2] < 16
        && data[offset + 3] > 128;
      if (isRedLayerPixel) {
        colorPixels += 1;
        maxRed = Math.max(maxRed, data[offset]);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return colorPixels === 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, colorPixels, maxRed };
	};
const readAlphaBounds = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let colorPixels = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      if (data[offset + 3] > 128) {
        colorPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return colorPixels === 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, colorPixels };
};
const readSaturatedBounds = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let colorPixels = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const max = Math.max(data[offset], data[offset + 1], data[offset + 2]);
      const min = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      if (data[offset + 3] > 128 && max > 80 && max - min > 48) {
        colorPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return colorPixels === 0
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, colorPixels };
};
const readRgbChecksum = (canvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 0) {
      sum += data[index] * 3 + data[index + 1] * 5 + data[index + 2] * 7 + data[index + 3] * 11;
    }
  }
  return sum;
};
const getGobletViewer = (canvas) => (
  Object.getOwnPropertySymbols(canvas)
    .map((symbol) => canvas[symbol])
    .find((candidate) => candidate && Array.isArray(candidate.dynamicPlayers))
);
const getColorCycleRuntimeFlags = (canvas) => {
  const viewer = getGobletViewer(canvas);
  const players = Array.isArray(viewer?.dynamicPlayers) ? viewer.dynamicPlayers : [];
  const layerEntries = Array.isArray(viewer?.layerEntries) ? viewer.layerEntries : [];
  const entryPlayers = layerEntries.map((entry) => entry?.player).filter(Boolean);
  return {
    foundViewer: Boolean(viewer),
    layerEntryCount: layerEntries.length,
    playerCount: players.length,
    usesWebGL: players.some((player) => player?.useWebGL === true),
    usesCpu: players.some((player) => player?.useWebGL === false),
    entryPlayerState: entryPlayers.map((player) => ({
      useWebGL: player?.useWebGL === true,
      hasAlphaMask: Boolean(player?.layer?.colorCycle?.alphaMask),
      hasSoftEdgeMask: Boolean(player?.layer?.colorCycle?.softEdgeMask),
      sourceBounds: readRedBounds(player.getCanvas()),
    })),
  };
};
window.__gobletFitModeParity = { ready: false, results: {} };
try {
  for (const pixelMode of pixelModeCases) {
    for (const fit of fitModes) {
      for (const slotCase of slotCases) {
        for (const hiddenCase of hiddenCases) {
          for (const maskCase of maskCases) {
            for (const displayFilterCase of displayFilterCases) {
              const canvas = document.createElement('canvas');
              canvas.width = ${VIEWPORT.width};
              canvas.height = ${VIEWPORT.height};
              document.body.appendChild(canvas);
              const caseName = pixelMode + ':' + fit + ':' + slotCase + ':' + hiddenCase + ':' + maskCase + ':' + displayFilterCase;
              await renderVesselWebGL(
                metadataByCase[caseName],
                canvas,
                {}
              );
              const beforeChecksum = readRgbChecksum(canvas);
              if (pixelMode === 'animated' || pixelMode === 'mixed') {
                const viewer = getGobletViewer(canvas);
                const players = Array.isArray(viewer?.dynamicPlayers) ? viewer.dynamicPlayers : [];
                players.forEach((player) => player?.advance?.(0.5));
                viewer?.renderOnce?.();
              }
              const afterChecksum = readRgbChecksum(canvas);
              window.__gobletFitModeParity.results[caseName] = {
                canvas: { width: canvas.width, height: canvas.height },
                bounds: pixelMode === 'animated' || pixelMode === 'mixed' ? readSaturatedBounds(canvas) : readRedBounds(canvas),
                redBounds: readRedBounds(canvas),
                alphaBounds: readAlphaBounds(canvas),
                saturatedBounds: readSaturatedBounds(canvas),
                animationChanged: pixelMode === 'animated' || pixelMode === 'mixed' ? beforeChecksum !== afterChecksum : false,
                runtime: getColorCycleRuntimeFlags(canvas),
              };
            }
          }
        }
      }
    }
  }
  window.__gobletFitModeParity.ready = true;
} catch (error) {
  window.__gobletFitModeParity = { ready: true, error: error instanceof Error ? error.message : String(error), results: {} };
  throw error;
}`,
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
};

type MalformedPayloadKind = 'brush-buffer-length' | 'mask-length' | 'speed-range';

const buildMalformedPayloadHtml = (kind: MalformedPayloadKind): string => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = createFitModeMetadata('static', 'none');
  const brushState = metadata.layers[0].colorCycle.brushState;
  if (kind === 'brush-buffer-length') {
    brushState.phaseBuffer = brushState.phaseBuffer.slice(0, -1);
  } else if (kind === 'mask-length') {
    metadata.layers[0].colorCycle.alphaMask = {
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      data: Array(DOCUMENT.width * DOCUMENT.height - 1).fill(255),
    };
  } else {
    delete (metadata.layers[0].colorCycle as Partial<typeof metadata.layers[0]['colorCycle']>).speedMin;
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Goblet2 Payload Contract</title></head>',
    '<body>',
    '<canvas id="target"></canvas>',
    '<script type="module">',
    runtime,
    `const metadata = ${JSON.stringify(metadata)};`,
    `window.__gobletPayloadContract = { ready: false };
try {
  const canvas = document.getElementById('target');
  canvas.width = ${VIEWPORT.width};
  canvas.height = ${VIEWPORT.height};
  await renderVesselWebGL(metadata, canvas, {});
  window.__gobletPayloadContract = { ready: true, error: null };
} catch (error) {
  window.__gobletPayloadContract = { ready: true, error: error instanceof Error ? error.message : String(error) };
}`,
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
};

const buildLegacyDefaultsHtml = (): string => {
  const runtime = read('public/goblet2/goblet2-inline.js');
  const metadata = createFitModeMetadata('static', 'none');
  metadata.colorCycle.schemaVersion = 1;
  metadata.layers = metadata.layers.slice(0, 1);
  const colorCycle = metadata.layers[0].colorCycle;
  colorCycle.brushState = {
    ...colorCycle.brushState,
    indexBuffer: [1, 255, 0, 0, 0, 0, 0, 0],
    animationOffset: 0,
  };
  delete (colorCycle as Partial<typeof colorCycle>).speedMin;
  delete (colorCycle as Partial<typeof colorCycle>).speedMax;
  delete (colorCycle as Partial<typeof colorCycle>).slotPalettes;
  delete (colorCycle.brushState as Partial<typeof colorCycle.brushState>).gradientIdBuffer;
  delete (colorCycle.brushState as Partial<typeof colorCycle.brushState>).speedBuffer;
  delete (colorCycle.brushState as Partial<typeof colorCycle.brushState>).gradientStops;

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8" /><title>Goblet2 Legacy Defaults</title></head>',
    '<body>',
    '<canvas id="target"></canvas>',
    '<script type="module">',
    runtime,
    `const metadata = ${JSON.stringify(metadata)};`,
    `window.__gobletLegacyDefaults = { ready: false };
const readPixels = (canvas) => Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data);
try {
  const canvas = document.getElementById('target');
  canvas.width = ${VIEWPORT.width};
  canvas.height = ${VIEWPORT.height};
  await renderVesselWebGL(metadata, canvas, {});
  const viewer = Object.getOwnPropertySymbols(canvas)
    .map((symbol) => canvas[symbol])
    .find((candidate) => candidate && Array.isArray(candidate.dynamicPlayers));
  const player = viewer?.layerEntries?.[0]?.player ?? null;
  window.__gobletLegacyDefaults = {
    ready: true,
    error: null,
    pixels: readPixels(canvas).slice(0, 16),
    runtime: {
      playerCount: player ? 1 : 0,
      dynamicPlayerCount: viewer?.dynamicPlayers?.length ?? 0,
      usesWebGL: player?.useWebGL === true,
      usesCpu: player?.useWebGL === false,
      paletteSize: player?.cycleColors ?? null,
      gradientIds: player?.gradientIdBuffer ? Array.from(player.gradientIdBuffer) : null,
      speedBytes: player?.speedBuffer ? Array.from(player.speedBuffer) : null,
    },
  };
} catch (error) {
  window.__gobletLegacyDefaults = { ready: true, error: error instanceof Error ? error.message : String(error) };
}`,
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
};

test.use({
  viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  deviceScaleFactor: 1,
});

test.describe('Goblet 2 rendered fit-mode parity', () => {
  test('renders layers at the shared fit-mode destinations for fallback, clamp, hidden, mask, and display-filter cases', async ({ page }) => {
    const url = 'http://goblet-fit-mode-parity.test/';
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildFitModeHtml(),
      });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__gobletFitModeParity?.ready), undefined, {
      timeout: 5000,
    });

    const result = await page.evaluate(() => window.__gobletFitModeParity);
    expect(result?.error).toBeUndefined();
    for (const pixelMode of PIXEL_MODE_CASES) {
      for (const fit of FIT_MODES) {
        for (const slotCase of SLOT_CASES) {
          for (const hiddenCase of HIDDEN_CASES) {
            for (const maskCase of MASK_CASES) {
              for (const displayFilterCase of DISPLAY_FILTER_CASES) {
                const caseName = `${pixelMode}:${fit}:${slotCase}:${hiddenCase}:${maskCase}:${displayFilterCase}`;
                const expectedBounds = expectedMaskedBounds(fit, maskCase);
                const entry = result?.results?.[caseName];
                const details = JSON.stringify({ caseName, entry, expectedBounds });
                expect(entry?.canvas).toEqual(VIEWPORT);
                expect(entry?.bounds, details).toMatchObject(expectedBounds);
                expect(entry?.bounds?.colorPixels, details).toBe(
                  expectedBounds.colorPixels ?? expectedBounds.width * expectedBounds.height,
                );
                if (pixelMode === 'animated' || pixelMode === 'mixed') {
                  expect(entry?.runtime?.playerCount, details).toBe(1);
                  expect(entry?.animationChanged, details).toBe(true);
                } else if (displayFilterCase === 'on') {
                  expect(entry?.bounds?.maxRed, details).toBeGreaterThanOrEqual(FILTERED_MAX_RED_RANGE.min);
                  expect(entry?.bounds?.maxRed, details).toBeLessThanOrEqual(FILTERED_MAX_RED_RANGE.max);
                } else {
                  expect(entry?.bounds?.maxRed, details).toBe(255);
                }
              }
            }
          }
        }
      }
    }
  });

  test('rejects malformed schema-2 brush payload lengths before playback', async ({ page }) => {
    const url = 'http://goblet-payload-contract.test/';
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildMalformedPayloadHtml('brush-buffer-length'),
      });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__gobletPayloadContract?.ready), undefined, {
      timeout: 5000,
    });

    const result = await page.evaluate(() => window.__gobletPayloadContract);
    expect(result?.error).toContain('Goblet2 brush payload failed contract validation');
    expect(result?.error).toContain('length-phaseBuffer');
  });

  test('rejects malformed schema-2 mask payload lengths before playback', async ({ page }) => {
    const url = 'http://goblet-mask-contract.test/';
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildMalformedPayloadHtml('mask-length'),
      });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__gobletPayloadContract?.ready), undefined, {
      timeout: 5000,
    });

    const result = await page.evaluate(() => window.__gobletPayloadContract);
    expect(result?.error).toContain('Goblet2 brush payload failed contract validation');
    expect(result?.error).toContain('length-alphaMask');
  });

  test('rejects missing schema-2 speed range before playback', async ({ page }) => {
    const url = 'http://goblet-speed-contract.test/';
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildMalformedPayloadHtml('speed-range'),
      });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__gobletPayloadContract?.ready), undefined, {
      timeout: 5000,
    });

    const result = await page.evaluate(() => window.__gobletPayloadContract);
    expect(result?.error).toContain('Goblet2 brush payload failed contract validation');
    expect(result?.error).toContain('missing-speedMin');
  });

  test('applies documented legacy defaults for schema-1 brush payloads', async ({ page }) => {
    const url = 'http://goblet-legacy-defaults.test/';
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildLegacyDefaultsHtml(),
      });
    });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__gobletLegacyDefaults?.ready), undefined, {
      timeout: 5000,
    });

    const result = await page.evaluate(() => window.__gobletLegacyDefaults);
    expect(result?.error).toBeNull();
    expect(result?.runtime).toMatchObject({
      playerCount: 1,
      dynamicPlayerCount: 0,
      usesWebGL: false,
      usesCpu: true,
      paletteSize: 256,
      gradientIds: null,
      speedBytes: null,
    });
    expect(result?.pixels.slice(0, 4)).toEqual([0, 0, 0, 255]);
    expect(result?.pixels.slice(4, 8).every((value: number, index: number) => (
      index === 3 ? value === 255 : value >= 253
    ))).toBe(true);
  });
});
