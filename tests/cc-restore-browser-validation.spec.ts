import fs from 'node:fs';

import { expect, test } from 'playwright/test';

import { renderSingleFileGobletArtifact } from './helpers/gobletArtifactHarness';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

type VesselStoreWindow = Window & {
  __vesselStore?: {
    setState: (updater: (state: {
      layers: Array<{
        id: string;
        visible?: boolean;
        layerType?: string;
        colorCycleData?: {
          runtimeHydrationState?: string;
          deferredRuntimeRestore?: boolean;
          repairStatus?: { ok: false; reason: string };
          colorCycleBrush?: unknown;
          canvasImageData?: ImageData;
          isAnimating?: boolean;
        };
      }>;
      webglExportSettings: Record<string, unknown>;
    }) => {
      layers?: Array<{
        id: string;
        visible?: boolean;
        layerType?: string;
        colorCycleData?: {
          runtimeHydrationState?: string;
          deferredRuntimeRestore?: boolean;
          repairStatus?: { ok: false; reason: string };
          colorCycleBrush?: unknown;
          canvasImageData?: ImageData;
          isAnimating?: boolean;
        };
      }>;
      webglExportSettings?: Record<string, unknown>;
    }) => void;
    getState: () => {
      activeLayerId: string | null;
      layers: Array<{
        id: string;
        layerType?: string;
        colorCycleData?: {
          runtimeHydrationState?: string;
          deferredRuntimeRestore?: boolean;
          repairStatus?: { ok: false; reason: string };
          colorCycleBrush?: unknown;
          canvasImageData?: ImageData;
          isAnimating?: boolean;
        };
      }>;
      setActiveLayer: (id: string) => void;
      ensureColorCycleLayerRuntime: (id: string, options?: { target?: 'warm' | 'active' }) => Promise<boolean>;
      playColorCycle: (reason?: string) => void;
      pauseColorCycle: (reason?: string) => void;
      saveProject: (request?: { filename?: string; forceDialog?: boolean }) => Promise<void>;
      importProject: (project: unknown, options?: { fileName?: string | null; fileHandle?: FileSystemFileHandle | null }) => Promise<void>;
      toggleModal: (name: 'loadProject' | string) => void;
    };
  };
  __phase10SavedProjectBytes?: Uint8Array;
};

const activeLayerId = 'phase10-active-cc';
const heavyLayerId = 'phase10-heavy-cold-cc';
const previewOnlyLayerId = 'phase10-static-preview-cc';

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const encodeRawImageDataUrl = (
  width: number,
  height: number,
  rgba: [number, number, number, number],
): string => {
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return `data:application/json;base64,${Buffer.from(JSON.stringify({
    width,
    height,
    dataBase64: bytesToBase64(data),
  })).toString('base64')}`;
};

const alignment = {
  fit: 'contain',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'auto',
  offsetPx: { x: 0, y: 0 },
  offsetPercent: { x: 50, y: 50 },
};

const makeCanonicalBrushLayer = (
  id: string,
  name: string,
  order: number,
  width: number,
  height: number,
) => {
  const pixelCount = width * height;
  const paint = new Uint8Array(pixelCount);
  const gradientId = new Uint8Array(pixelCount);
  const gradientDefId = new Uint16Array(pixelCount);
  const speed = new Uint8Array(pixelCount);
  const flow = new Uint8Array(pixelCount);
  const phase = new Uint8Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    paint[index] = index % 7 === 0 ? 0 : 1;
    gradientId[index] = 1;
    gradientDefId[index] = 1;
    speed[index] = index % 3 === 0 ? 160 : 96;
    flow[index] = 64;
    phase[index] = index % 255;
  }

  return {
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order,
    layerType: 'color-cycle',
    alignment,
    colorCycleData: {
      mode: 'brush',
      canvasWidth: width,
      canvasHeight: height,
      canvasImageData: width <= 16 ? encodeRawImageDataUrl(width, height, [80, 130, 220, 255]) : undefined,
      gradient: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#f7e36b' },
      ],
      gradientDefs: [{ id: 'g1', currentSlot: 1 }],
      slotPalettes: [{
        slot: 1,
        stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#f7e36b' },
        ],
      }],
      gradientDefStore: [{
        id: 1,
        kind: 'linear',
        stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#f7e36b' },
        ],
        hash: `phase10-${id}`,
        source: 'manual',
        createdAtMs: 0,
        slot: 1,
      }],
      activeGradientId: 'g1',
      paintSlot: 1,
      brushState: {
        schemaVersion: 1,
        canonicalPaint: true,
        cycleSpeed: 0.35,
        fps: 24,
        brushSize: 8,
        dimensionsByLayerId: {
          [id]: { width, height },
        },
        layers: [{
          layerId: id,
          canonicalPaint: true,
          schemaVersion: 1,
          dimensions: { width, height },
          activeGradientId: 'g1',
          paintSlot: 1,
          gradientDefs: [{ id: 'g1', currentSlot: 1 }],
          slotPalettes: [{
            slot: 1,
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#f7e36b' },
            ],
          }],
          gradientDefStore: [{
            id: 1,
            kind: 'linear',
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#f7e36b' },
            ],
            hash: `phase10-${id}`,
            source: 'manual',
            createdAtMs: 0,
            slot: 1,
          }],
          strokeData: {
            paintBuffer: bytesToBase64(paint),
            gradientIdBuffer: bytesToBase64(gradientId),
            gradientDefIdBuffer: bytesToBase64(new Uint8Array(gradientDefId.buffer)),
            speedBuffer: bytesToBase64(speed),
            flowBuffer: bytesToBase64(flow),
            phaseBuffer: bytesToBase64(phase),
            hasContent: true,
            strokeCounter: 1,
          },
        }],
      },
    },
  };
};

const createPhase10ProjectPayload = (): string => JSON.stringify({
  version: '1.1.0',
  metadata: {
    name: 'phase-10-browser-cc-restore',
    created: '2026-07-05T00:00:00.000Z',
    modified: '2026-07-05T00:00:00.000Z',
    appVersion: 'phase-1.0-browser-validation',
  },
  project: {
    id: 'phase-10-browser-project',
    name: 'phase-10-browser-project',
    width: 1150,
    height: 1150,
    backgroundColor: 'transparent',
    thumbnail: encodeRawImageDataUrl(16, 16, [20, 30, 40, 255]),
    customBrushes: [],
    layerGroups: [],
    layers: [
      makeCanonicalBrushLayer(activeLayerId, 'Active Canonical CC', 0, 1150, 1150),
      makeCanonicalBrushLayer(heavyLayerId, 'Heavy Cold Canonical CC', 1, 1150, 1150),
      {
        id: previewOnlyLayerId,
        name: 'Static Preview Only CC',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 2,
        layerType: 'color-cycle',
        alignment,
        colorCycleData: {
          mode: 'brush',
          canvasWidth: 16,
          canvasHeight: 16,
          canvasImageData: encodeRawImageDataUrl(16, 16, [190, 70, 90, 255]),
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        },
      },
    ],
  },
});

test.describe('Phase 1.0 color-cycle old-project browser validation', () => {
  test('loads, warms, plays, saves/reloads, and preserves preview-only diagnostics', async ({ page }) => {
    test.setTimeout(180000);
    const projectPayload = createPhase10ProjectPayload();
    await page.goto(BASE_URL);
    await expect(page.getByRole('button', { name: /Load File/i })).toBeVisible({ timeout: 20000 });

    await page.evaluate(() => {
      (window as VesselStoreWindow).__vesselStore!.getState().toggleModal('loadProject');
    });
    await expect(page.getByRole('heading', { name: 'Load Project' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'phase-10-browser-cc-restore.vs',
      mimeType: 'application/vnd.vessel.project+json',
      buffer: Buffer.from(projectPayload),
    });
    await expect(page.getByAltText('phase-10-browser-project preview')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Load Project' }).click();

    await expect.poll(async () => page.evaluate((ids) => {
      const store = (window as VesselStoreWindow).__vesselStore?.getState();
      const layer = store?.layers.find((candidate) => candidate.id === ids.activeLayerId);
      return {
        activeLayerId: store?.activeLayerId ?? null,
        activeHydration: layer?.colorCycleData?.runtimeHydrationState ?? null,
        hasBrush: Boolean(layer?.colorCycleData?.colorCycleBrush),
      };
    }, { activeLayerId })).toMatchObject({
      activeLayerId,
      activeHydration: 'active',
      hasBrush: true,
    });

    const loadedState = await page.evaluate((ids) => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      const heavy = store.layers.find((layer) => layer.id === ids.heavyLayerId);
      const previewOnly = store.layers.find((layer) => layer.id === ids.previewOnlyLayerId);
      return {
        heavyHydration: heavy?.colorCycleData?.runtimeHydrationState ?? null,
        heavyDeferred: heavy?.colorCycleData?.deferredRuntimeRestore ?? null,
        heavyHasBrush: Boolean(heavy?.colorCycleData?.colorCycleBrush),
        previewHydration: previewOnly?.colorCycleData?.runtimeHydrationState ?? null,
        previewRepairReason: previewOnly?.colorCycleData?.repairStatus?.reason ?? null,
        previewHasBrush: Boolean(previewOnly?.colorCycleData?.colorCycleBrush),
      };
    }, { heavyLayerId, previewOnlyLayerId });

    expect(loadedState).toMatchObject({
      heavyHydration: 'cold',
      heavyDeferred: true,
      heavyHasBrush: false,
      previewHydration: 'cold',
      previewRepairReason: 'missing-gradient-bindings',
      previewHasBrush: false,
    });

    await page.evaluate(async (ids) => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      store.setActiveLayer(ids.heavyLayerId);
      const warmed = await store.ensureColorCycleLayerRuntime(ids.heavyLayerId, { target: 'active' });
      if (!warmed) {
        throw new Error('Heavy cold CC layer did not warm to active');
      }
    }, { heavyLayerId });

    await expect.poll(async () => page.evaluate((ids) => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      const heavy = store.layers.find((layer) => layer.id === ids.heavyLayerId);
      return {
        activeLayerId: store.activeLayerId,
        heavyHydration: heavy?.colorCycleData?.runtimeHydrationState ?? null,
        heavyHasBrush: Boolean(heavy?.colorCycleData?.colorCycleBrush),
      };
    }, { heavyLayerId })).toMatchObject({
      activeLayerId: heavyLayerId,
      heavyHydration: 'active',
      heavyHasBrush: true,
    });

    await page.evaluate((ids) => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      store.playColorCycle('phase-1.0-browser-validation');
      const heavy = store.layers.find((layer) => layer.id === ids.heavyLayerId);
      const brush = heavy?.colorCycleData?.colorCycleBrush as
        | {
            getColorCycleLayerDocument?: (layerId: string) => {
              read(): {
                snapshot?: {
                  paintBuffer?: ArrayBuffer;
                  speedBuffer?: ArrayBuffer;
                  hasContent?: boolean;
                };
              };
            } | undefined;
          }
        | undefined;
      const snapshot = brush?.getColorCycleLayerDocument?.(ids.heavyLayerId)?.read().snapshot;
      if (
        snapshot?.hasContent !== true ||
        !(snapshot.paintBuffer instanceof ArrayBuffer) ||
        snapshot.paintBuffer.byteLength === 0 ||
        !(snapshot.speedBuffer instanceof ArrayBuffer) ||
        snapshot.speedBuffer.byteLength === 0
      ) {
        throw new Error(`Heavy CC layer did not restore playable canonical buffers: ${JSON.stringify({
          hasBrush: Boolean(brush),
          hasDocumentReader: typeof brush?.getColorCycleLayerDocument === 'function',
          hasSnapshot: Boolean(snapshot),
          hasContent: snapshot?.hasContent ?? null,
          paintBytes: snapshot?.paintBuffer instanceof ArrayBuffer ? snapshot.paintBuffer.byteLength : null,
          speedBytes: snapshot?.speedBuffer instanceof ArrayBuffer ? snapshot.speedBuffer.byteLength : null,
          keys: snapshot ? Object.keys(snapshot) : [],
        })}`);
      }
      const previewOnly = store.layers.find((layer) => layer.id === ids.previewOnlyLayerId);
      if (previewOnly?.colorCycleData?.colorCycleBrush) {
        throw new Error('Preview-only CC layer was promoted to a runtime brush');
      }
      store.pauseColorCycle('phase-1.0-browser-validation');
    }, { heavyLayerId, previewOnlyLayerId });

    await page.evaluate(() => {
      const savedChunks: Uint8Array[] = [];
      (window as VesselStoreWindow & {
        showSaveFilePicker?: () => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker = async () => ({
        kind: 'file',
        name: 'phase-10-browser-cc-restore-saved.vs',
        async createWritable() {
          return {
            async write(chunk: BlobPart) {
              if (chunk instanceof Uint8Array) {
                savedChunks.push(chunk);
              } else if (chunk instanceof ArrayBuffer) {
                savedChunks.push(new Uint8Array(chunk));
              } else if (chunk instanceof Blob) {
                savedChunks.push(new Uint8Array(await chunk.arrayBuffer()));
              } else if (typeof chunk === 'string') {
                savedChunks.push(new TextEncoder().encode(chunk));
              } else if (chunk && typeof chunk === 'object' && 'data' in chunk) {
                const data = (chunk as { data: BlobPart }).data;
                if (data instanceof Uint8Array) {
                  savedChunks.push(data);
                } else if (data instanceof ArrayBuffer) {
                  savedChunks.push(new Uint8Array(data));
                } else if (data instanceof Blob) {
                  savedChunks.push(new Uint8Array(await data.arrayBuffer()));
                } else if (typeof data === 'string') {
                  savedChunks.push(new TextEncoder().encode(data));
                }
              }
            },
            async close() {
              const total = savedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
              const out = new Uint8Array(total);
              let offset = 0;
              savedChunks.forEach((chunk) => {
                out.set(chunk, offset);
                offset += chunk.byteLength;
              });
              (window as VesselStoreWindow).__phase10SavedProjectBytes = out;
            },
            async truncate(size: number) {
              const total = savedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
              if (size >= total) {
                return;
              }
              let remaining = Math.max(0, size);
              for (let index = 0; index < savedChunks.length; index += 1) {
                const chunk = savedChunks[index];
                if (remaining >= chunk.byteLength) {
                  remaining -= chunk.byteLength;
                  continue;
                }
                savedChunks[index] = chunk.slice(0, remaining);
                savedChunks.splice(index + 1);
                return;
              }
            },
            async abort() {},
          } as FileSystemWritableFileStream;
        },
        async getFile() {
          const bytes = (window as VesselStoreWindow).__phase10SavedProjectBytes ?? new Uint8Array();
          return new File([bytes], 'phase-10-browser-cc-restore-saved.vs');
        },
        async isSameEntry(other: FileSystemHandle) {
          return other.name === 'phase-10-browser-cc-restore-saved.vs';
        },
      } as FileSystemFileHandle);
    });

    await page.evaluate(async () => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      await store.saveProject({ filename: 'phase-10-browser-cc-restore-saved', forceDialog: true });
      if (!(window as VesselStoreWindow).__phase10SavedProjectBytes?.byteLength) {
        throw new Error('Save did not write project bytes');
      }
    });

    const savedBytes = await page.evaluate(() => {
      const savedBytes = (window as VesselStoreWindow).__phase10SavedProjectBytes;
      if (!savedBytes) {
        throw new Error('Missing saved project bytes');
      }
      return Array.from(savedBytes);
    });

    await page.evaluate(() => {
      (window as VesselStoreWindow).__vesselStore!.getState().toggleModal('loadProject');
    });
    await expect(page.getByRole('heading', { name: 'Load Project' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'phase-10-browser-cc-restore-saved.vs',
      mimeType: 'application/vnd.vessel.project+json',
      buffer: Buffer.from(savedBytes),
    });
    await expect(page.getByAltText('phase-10-browser-project preview')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Load Project' }).click();

    await expect.poll(async () => page.evaluate((ids) => {
      const store = (window as VesselStoreWindow).__vesselStore!.getState();
      const active = store.layers.find((layer) => layer.id === ids.activeLayerId);
      const heavy = store.layers.find((layer) => layer.id === ids.heavyLayerId);
      const previewOnly = store.layers.find((layer) => layer.id === ids.previewOnlyLayerId);
      return {
        activeHydration: active?.colorCycleData?.runtimeHydrationState ?? null,
        activeHasBrush: Boolean(active?.colorCycleData?.colorCycleBrush),
        heavyHydration: heavy?.colorCycleData?.runtimeHydrationState ?? null,
        heavyDeferred: heavy?.colorCycleData?.deferredRuntimeRestore ?? null,
        previewHydration: previewOnly?.colorCycleData?.runtimeHydrationState ?? null,
        previewRepairReason: previewOnly?.colorCycleData?.repairStatus?.reason ?? null,
        previewHasBrush: Boolean(previewOnly?.colorCycleData?.colorCycleBrush),
      };
    }, { activeLayerId, heavyLayerId, previewOnlyLayerId })).toMatchObject({
      activeHydration: 'active',
      activeHasBrush: true,
      heavyHydration: 'cold',
      heavyDeferred: true,
      previewHydration: 'cold',
      previewRepairReason: 'missing-gradient-bindings',
      previewHasBrush: false,
    });

    await page.evaluate((ids) => {
      (window as VesselStoreWindow).__vesselStore!.setState((state) => ({
        layers: state.layers.map((layer) => (
          layer.id === ids.previewOnlyLayerId
            ? { ...layer, visible: false }
            : layer
        )),
        webglExportSettings: {
          ...state.webglExportSettings,
          includeHiddenLayers: false,
          bundleFormat: 'json',
          gobletVersion: 'goblet2',
          minifyOutput: false,
          enableGobletDiagnostics: false,
          htmlTitle: 'phase-10-browser-goblet',
        },
      }));
    }, { previewOnlyLayerId });

    await page.evaluate(() => {
      (window as VesselStoreWindow).__vesselStore!.getState().toggleModal('export');
    });
    await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button').filter({ hasText: /^Export$/ }).last().click();
    const download = await downloadPromise;
    await expect(page.getByText('Goblet export complete')).toBeVisible({ timeout: 60000 });

    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error('Goblet JSON download did not expose a filesystem path');
    }
    const gobletMetadata = JSON.parse(fs.readFileSync(downloadPath, 'utf8')) as {
      format?: string;
      layers?: Array<{
        id?: string;
        colorCycle?: {
          brushState?: {
            indexBuffer?: unknown;
            speedBuffer?: unknown;
          };
        };
      }>;
    };
    expect(gobletMetadata.format).toBe('vessel-goblet2');
    const exportedLayerIds = new Set(gobletMetadata.layers?.map((layer) => layer.id));
    expect(exportedLayerIds.has(activeLayerId)).toBe(true);
    expect(exportedLayerIds.has(heavyLayerId)).toBe(true);
    expect(exportedLayerIds.has(previewOnlyLayerId)).toBe(false);
    for (const layerId of [activeLayerId, heavyLayerId]) {
      const layer = gobletMetadata.layers?.find((candidate) => candidate.id === layerId);
      expect(layer?.colorCycle?.brushState?.indexBuffer).toBeTruthy();
      expect(layer?.colorCycle?.brushState?.speedBuffer).toBeTruthy();
    }

    const artifact = await renderSingleFileGobletArtifact(page, gobletMetadata, { animationFrames: 6 });
    expect(artifact.result.error).toBeUndefined();
    expect(artifact.pageErrors).toEqual([]);
    expect(artifact.consoleErrors).toEqual([]);
    const artifactLayerIds = new Set(artifact.result.layers.map((layer) => layer.id));
    expect(artifactLayerIds.has(activeLayerId)).toBe(true);
    expect(artifactLayerIds.has(heavyLayerId)).toBe(true);
    for (const layerId of [activeLayerId, heavyLayerId]) {
      const layer = artifact.result.layers.find((candidate) => candidate.id === layerId);
      expect(layer?.nonZeroAlpha ?? 0).toBeGreaterThan(0);
      expect(layer?.afterAnimationNonZeroAlpha ?? 0).toBeGreaterThan(0);
    }
  });
});
