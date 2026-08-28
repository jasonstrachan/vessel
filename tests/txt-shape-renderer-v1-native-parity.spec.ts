import fs from 'node:fs';

import { expect, test } from 'playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const PROJECT_WIDTH = 512;
const PROJECT_HEIGHT = 100;

const TEXT_STATES = [
  'none',
  'selected',
  'selected-text',
  'selected-crossed-out',
  'crossed-out',
  'overwritten',
  'erased',
  'invisible',
  'invisible-crossed-out',
  'redacted',
  'redacted-crossed-out',
] as const;

type TextState = typeof TEXT_STATES[number];

type PixelSnapshot = {
  height: number;
  pixels: number[];
  width: number;
};

type VesselStoreWindow = Window & {
  __vesselStore?: {
    getState(): {
      currentOffscreenCanvas: HTMLCanvasElement | null;
      markAllCompositeSegmentsDirty(): void;
      project: {
        name: string;
        txtShapes?: Array<Record<string, unknown>>;
      } | null;
      renderStaticComposite(
        canvas: HTMLCanvasElement,
        options: { captureBitmap: boolean; updateTargetCanvas: boolean },
      ): boolean | Promise<boolean>;
      toggleModal(name: string): void;
      updateProject(updates: Record<string, unknown>): void;
    };
    setState(updater: (state: {
      webglExportSettings: Record<string, unknown>;
    }) => {
      webglExportSettings: Record<string, unknown>;
    }): void;
  };
};

const rawImageDataUrl = (width: number, height: number): string => (
  `data:application/json;base64,${Buffer.from(JSON.stringify({
    width,
    height,
    dataBase64: Buffer.alloc(width * height * 4).toString('base64'),
  })).toString('base64')}`
);

const canonicalTreatment = (state: TextState): string | undefined => (
  state === 'none' || state === 'selected' ? undefined : state
);

const createMatrixShapes = () => [
  { id: 'flat-transparent', fillStyle: 'flat' },
  { id: 'dither-opaque', fillStyle: 'dither', backgroundColor: '#31465a' },
  { id: 'glyph-map-opaque', fillStyle: 'flat', backgroundColor: '#58412f', renderMode: 'glyph-map' },
].flatMap((style, rowIndex) => TEXT_STATES.map((state, columnIndex) => {
  const treatment = canonicalTreatment(state);
  return {
    id: `${style.id}-${state}`,
    layerId: 'txt-layer',
    x: 2 + columnIndex * 46,
    y: 2 + rowIndex * 32,
    width: 42,
    height: 28,
    padding: 2,
    columns: 1,
    colorCount: 2,
    content: 'AB\nCD',
    fontFamily: 'tiny5',
    fontSize: 8,
    lineHeight: 1.5,
    textAlign: 'left',
    colorSource: 'manual',
    color: '#d7d0bd',
    selectionColor: '#faf7f0',
    selectionBackgroundColor: '#7a2756',
    colorRanges: [
      { start: 0, end: 2, color: '#d06b54' },
      { start: 3, end: 5, color: '#5b91c5' },
    ],
    selections: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
    ...(treatment ? {
      selectionTreatments: [
        { start: 0, end: 2, treatment },
        { start: 3, end: 5, treatment },
      ],
    } : {}),
    nonCanonicalState: state,
    fillStyle: style.fillStyle,
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.renderMode ? { renderMode: style.renderMode } : {}),
    ...(style.fillStyle === 'dither' ? {
      ditherResolution: 2,
      ditherInkSpread: 28,
    } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}));

const createProjectPayload = (): string => JSON.stringify({
  version: '1.1.0',
  metadata: {
    name: 'txt-renderer-v1-native-parity',
    created: '2026-08-28T00:00:00.000Z',
    modified: '2026-08-28T00:00:00.000Z',
    appVersion: 'txt-renderer-v1-native-parity',
  },
  project: {
    id: 'txt-renderer-v1-native-parity',
    name: 'txt-renderer-v1-native-parity',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    backgroundColor: 'transparent',
    thumbnail: rawImageDataUrl(16, 16),
    customBrushes: [],
    layerGroups: [],
    txtShapePlayback: { blockGap: 100, cursorCount: 8, dragSpeed: 480 },
    txtShapes: createMatrixShapes(),
    layers: [{
      id: 'txt-layer',
      name: 'TXT parity matrix',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      layerType: 'normal',
      imageDataUrl: '',
      alignment: {
        fit: 'none',
        horizontal: 'left',
        vertical: 'top',
        positioning: 'anchor',
        offsetPx: { x: 0, y: 0 },
        offsetPercent: { x: 0, y: 0 },
      },
    }],
  },
});

const captureNativeComposite = async (page: import('playwright/test').Page): Promise<PixelSnapshot> => (
  page.evaluate(async () => {
    await document.fonts.ready;
    const state = (window as VesselStoreWindow).__vesselStore?.getState();
    const canvas = state?.currentOffscreenCanvas;
    if (!state || !canvas) throw new Error('Vessel native composite canvas is unavailable.');
    state.markAllCompositeSegmentsDirty();
    await state.renderStaticComposite(canvas, {
      captureBitmap: false,
      updateTargetCanvas: true,
    });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Vessel native composite context is unavailable.');
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  })
);

const buildRendererParityHtml = (
  metadata: Record<string, unknown>,
  expectedInactive: PixelSnapshot,
  expectedCanonical: PixelSnapshot,
): string => {
  const runtime = fs.readFileSync('public/goblet2/goblet2-inline.js', 'utf8');
  return `<!doctype html><html><body>
<canvas id="preview" width="${PROJECT_WIDTH}" height="${PROJECT_HEIGHT}"></canvas>
<script type="module">
${runtime}
const metadata = ${JSON.stringify(metadata)};
const expectedInactive = new Uint8ClampedArray(${JSON.stringify(expectedInactive.pixels)});
const expectedCanonical = new Uint8ClampedArray(${JSON.stringify(expectedCanonical.pixels)});
const canvas = document.getElementById('preview');
window.__txtParity = { ready: false };
const waitForComposite = () => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const compare = (expected) => {
  const actual = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const expectedSource = document.createElement('canvas');
  expectedSource.width = canvas.width;
  expectedSource.height = canvas.height;
  expectedSource.getContext('2d').putImageData(
    new ImageData(expected, canvas.width, canvas.height),
    0,
    0,
  );
  const expectedDisplay = document.createElement('canvas');
  expectedDisplay.width = canvas.width;
  expectedDisplay.height = canvas.height;
  const expectedContext = expectedDisplay.getContext('2d', { willReadFrequently: true });
  expectedContext.fillStyle = '#2a2a2e';
  expectedContext.fillRect(0, 0, canvas.width, canvas.height);
  expectedContext.fillStyle = '#1c1c1f';
  for (let x = 0; x < canvas.width; x += 20) {
    for (let y = 0; y < canvas.height; y += 20) {
      expectedContext.fillRect(x, y, Math.min(10, canvas.width - x), Math.min(10, canvas.height - y));
      if (x + 10 < canvas.width && y + 10 < canvas.height) {
        expectedContext.fillRect(
          x + 10,
          y + 10,
          Math.min(10, canvas.width - x - 10),
          Math.min(10, canvas.height - y - 10),
        );
      }
    }
  }
  expectedContext.drawImage(expectedSource, 0, 0);
  const expectedComposite = expectedContext
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let differentChannels = 0;
  let differentPixels = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (actual[offset + channel] !== expectedComposite[offset + channel]) {
        differentChannels += 1;
        pixelDiffers = true;
      }
    }
    if (pixelDiffers) differentPixels += 1;
  }
  return { differentChannels, differentPixels };
};
try {
  metadata.automation.objects = metadata.automation.objects.map((object) => (
    String(object.id).startsWith('txt-playback:cursor:')
      ? { ...object, visible: false }
      : object
  ));
  metadata.automation.tracks = metadata.automation.tracks.filter((track) => (
    !String(track.targetId).startsWith('txt-playback:cursor:')
  ));
  await renderVesselWebGL(metadata, canvas, {});
  const renderer = mountGobletRendererV1(metadata, canvas);
  await renderer.ready;
  renderer.setTime(0);
  await waitForComposite();
  const inactive = compare(expectedInactive);
  const selectedMaskIds = new Set(metadata.automation.masks
    .filter((mask) => String(mask.id).endsWith(':mask:selected'))
    .map((mask) => mask.id));
  const fullySelectedTime = Math.max(...metadata.automation.tracks
    .filter((track) => selectedMaskIds.has(track.targetId) && track.property === 'x')
    .flatMap((track) => track.keyframes.map((keyframe) => Number(keyframe.time)))
    .filter((time) => time < metadata.automation.durationSeconds));
  renderer.setTime(fullySelectedTime);
  await waitForComposite();
  const canonical = compare(expectedCanonical);
  window.__txtParity = {
    ready: true,
    inactive,
    canonical,
  };
} catch (error) {
  window.__txtParity = {
    ready: true,
    error: error instanceof Error ? error.message : String(error),
  };
}
</script></body></html>`;
};

const buildRejectedMountHtml = (): string => {
  const runtime = fs.readFileSync('public/goblet2/goblet2-inline.js', 'utf8');
  return `<!doctype html><html><body>
<canvas id="preview" width="16" height="16" data-vessel-layer-overlays="true"></canvas>
<script type="module">
${runtime}
const canvas = document.getElementById('preview');
const layerEntryCounts = [];
canvas.addEventListener('vessel-goblet-txt-layer-overlays', (event) => {
  layerEntryCounts.push(event.detail.entries.length);
});
let error = null;
try {
  mountGobletRendererV1({
    project: { width: 16, height: 16 },
    layers: [{ id: 'txt-layer' }],
    automation: {
      schemaVersion: 1,
      durationSeconds: 1,
      objects: [{
        id: 'shape',
        kind: 'rect',
        layerId: 'txt-layer',
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        fill: '#ffffff',
      }],
      tracks: [{
        targetId: 'missing',
        property: 'x',
        keyframes: [{ time: 0, value: 0 }],
      }],
    },
  }, canvas);
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
window.__rejectedMount = {
  error,
  layerEntryCounts,
  overlayExists: document.getElementById('vessel-renderer-v1') !== null,
};
</script></body></html>`;
};

const buildRejectedResourceHtml = (): string => {
  const runtime = fs.readFileSync('public/goblet2/goblet2-inline.js', 'utf8');
  return `<!doctype html><html><body>
<canvas id="preview" width="16" height="16" data-vessel-layer-overlays="true" style="opacity: 0.75"></canvas>
<script type="module">
${runtime}
const canvas = document.getElementById('preview');
const layerEntryCounts = [];
canvas.addEventListener('vessel-goblet-txt-layer-overlays', (event) => {
  layerEntryCounts.push(event.detail.entries.length);
});
let error = null;
try {
  const renderer = mountGobletRendererV1({
    project: { width: 16, height: 16 },
    layers: [{ id: 'txt-layer' }],
    automation: {
      schemaVersion: 1,
      durationSeconds: 1,
      resources: [{
        id: 'broken',
        kind: 'image',
        dataUrl: 'data:image/png;base64,AAAA',
      }],
      objects: [
        { id: 'artwork', kind: 'artwork', x: 0, y: 0 },
        {
          id: 'shape',
          kind: 'sprite',
          layerId: 'txt-layer',
          resourceId: 'broken',
          x: 0,
          y: 0,
          width: 8,
          height: 8,
        },
      ],
      tracks: [],
    },
  }, canvas);
  await renderer.ready;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
window.__rejectedResource = {
  error,
  layerEntryCounts,
  overlayExists: document.getElementById('vessel-renderer-v1') !== null,
  sourceOpacity: canvas.style.opacity,
};
</script></body></html>`;
};

test('does not publish Renderer v1 side effects before late scene validation succeeds', async ({ page }) => {
  const rejectedMountUrl = 'http://renderer-v1-rejected-mount.test/';
  await page.route(rejectedMountUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildRejectedMountHtml(),
    });
  });
  await page.goto(rejectedMountUrl);
  const result = await page.evaluate(() => (
    window as Window & {
      __rejectedMount?: {
        error: string | null;
        layerEntryCounts: number[];
        overlayExists: boolean;
      };
    }
  ).__rejectedMount);

  expect(result?.error).toContain('track missing:x is invalid or unsupported');
  expect(result?.layerEntryCounts).toEqual([]);
  expect(result?.overlayExists).toBe(false);
});

test('disposes Renderer v1 side effects when an atlas resource fails to load', async ({ page }) => {
  const rejectedResourceUrl = 'http://renderer-v1-rejected-resource.test/';
  await page.route(rejectedResourceUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildRejectedResourceHtml(),
    });
  });
  await page.goto(rejectedResourceUrl);
  await page.waitForFunction(() => (
    '__rejectedResource' in window
  ));
  const result = await page.evaluate(() => (
    window as Window & {
      __rejectedResource?: {
        error: string | null;
        layerEntryCounts: number[];
        overlayExists: boolean;
        sourceOpacity: string;
      };
    }
  ).__rejectedResource);

  expect(result?.error).toContain('Renderer v1 image failed to load: resource:broken');
  expect(result?.layerEntryCounts).toEqual([1, 0]);
  expect(result?.overlayExists).toBe(false);
  expect(result?.sourceOpacity).toBe('0.75');
});

test('matches Vessel pixels for every TXT treatment, dither, glyph-map, and opaque backgrounds', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(BASE_URL);
  await expect(page.getByRole('button', { name: /Load File/i })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    (window as VesselStoreWindow).__vesselStore!.getState().toggleModal('loadProject');
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'txt-renderer-v1-native-parity.vs',
    mimeType: 'application/vnd.vessel.project+json',
    buffer: Buffer.from(createProjectPayload()),
  });
  await page.getByRole('button', { name: 'Load Project' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as VesselStoreWindow).__vesselStore?.getState().project?.name
  ))).toBe('txt-renderer-v1-native-parity');

  await page.evaluate(() => {
    const state = (window as VesselStoreWindow).__vesselStore!.getState();
    (window as VesselStoreWindow).__vesselStore!.setState((storeState) => ({
      webglExportSettings: {
        ...storeState.webglExportSettings,
        includeHiddenLayers: false,
        bundleFormat: 'json',
        gobletVersion: 'goblet2',
        viewportPreset: 'fixed',
        minifyOutput: false,
        enableGobletDiagnostics: false,
        htmlTitle: 'txt-renderer-v1-native-parity',
      },
    }));
    state.toggleModal('export');
  });
  await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();
  await page.getByRole('button', { name: 'Goblet' }).click();
  await page.locator('button').filter({ hasText: /^Export$/ }).last().click();
  await expect(page.getByRole('dialog', { name: 'Goblet ready' })).toBeVisible({
    timeout: 60_000,
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Renderer v1 parity export did not expose a file path.');
  const metadata = JSON.parse(fs.readFileSync(downloadPath, 'utf8')) as Record<string, unknown>;

  const canonical = await captureNativeComposite(page);
  expect({ width: canonical.width, height: canonical.height }).toEqual({
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
  });
  await page.evaluate(() => {
    const state = (window as VesselStoreWindow).__vesselStore!.getState();
    state.updateProject({
      txtShapes: state.project!.txtShapes!.map((shape) => ({ ...shape, selections: [] })),
    });
  });
  const inactive = await captureNativeComposite(page);

  const parityUrl = 'http://txt-renderer-v1-native-parity.test/';
  await page.route(parityUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: buildRendererParityHtml(metadata, inactive, canonical),
    });
  });
  await page.goto(parityUrl);
  await page.waitForFunction(() => (
    (window as Window & { __txtParity?: { ready?: boolean } }).__txtParity?.ready === true
  ));
  const result = await page.evaluate(() => (
    window as Window & {
      __txtParity?: {
        canonical?: { differentChannels: number; differentPixels: number };
        error?: string;
        inactive?: { differentChannels: number; differentPixels: number };
      };
    }
  ).__txtParity);

  expect(result?.error).toBeUndefined();
  expect(result?.inactive).toMatchObject({ differentChannels: 0, differentPixels: 0 });
  expect(result?.canonical).toMatchObject({ differentChannels: 0, differentPixels: 0 });
});
