import fs from 'node:fs';
import path from 'node:path';

import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import { createDefaultExportLayout } from '@/utils/layoutDefaults';
import { deserializeProjectWithReport } from '@/utils/projectIO';
import type { WebGLExportProgressEvent } from '@/utils/export/goblet/gobletTypes';

jest.setTimeout(30000);

type LegacyCorpusManifest = {
  version: number;
  requiredArchives: Array<{
    id: string;
    status: 'covered' | 'todo';
    archivePath?: string;
    expectedOutcome: 'exports-animated' | 'exports-static-with-warning' | 'fails-visibly' | 'todo';
    reason?: string;
  }>;
};

type LegacyCorpusOutcome = Exclude<
  LegacyCorpusManifest['requiredArchives'][number]['expectedOutcome'],
  'todo'
>;

const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
const originalImage = (globalThis as { Image?: unknown }).Image;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

class TestOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): Partial<OffscreenCanvasRenderingContext2D> {
    return {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => new ImageData(this.width, this.height)),
      putImageData: jest.fn(),
    };
  }
}

class TestImage {
  width = 1;
  height = 1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.();
    });
  }
}

const loadManifest = (): LegacyCorpusManifest => {
  const manifestPath = path.resolve(process.cwd(), 'tests/fixtures/goblet2/legacy-corpus.manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LegacyCorpusManifest;
};

const classifyExportOutcome = async (
  archivePath: string,
): Promise<{
  outcome: LegacyCorpusOutcome;
  colorCycleLayerCount: number;
  exportedColorCycleLayerCount: number;
  progressStatuses: string[];
  error?: string;
}> => {
  const bytes = fs.readFileSync(path.resolve(process.cwd(), archivePath));
  const projectBytes = new Uint8Array(bytes);
  const { project } = await deserializeProjectWithReport(projectBytes, {
    lazyColorCycleRuntime: true,
  });
  const colorCycleLayerCount = project.layers.filter((layer) => layer.layerType === 'color-cycle').length;
  const progressEvents: WebGLExportProgressEvent[] = [];

  try {
    const metadata = await exportProjectAsWebGL({
      project,
      layers: project.layers,
      layout: project.exportLayout ?? createDefaultExportLayout(),
      viewport: {
        designWidth: project.width,
        designHeight: project.height,
        mode: 'fixed',
      },
      fps: 30,
      totalFrames: 1,
      durationSeconds: 1 / 30,
      perfectLoop: false,
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minify: false,
      filenameBase: `legacy-corpus-${path.basename(archivePath, '.vs')}`,
      bundleFormat: 'json',
      gobletVersion: 'goblet2',
      onProgress: (event) => progressEvents.push(event),
    });
    const progressStatuses = progressEvents
      .map((event) => event.layer?.status)
      .filter((status): status is string => Boolean(status));
    const exportedColorCycleLayerCount = metadata.layers.filter((layer) => (
      layer.type === 'color-cycle'
    )).length;

    return {
      outcome: 'exports-animated',
      colorCycleLayerCount,
      exportedColorCycleLayerCount,
      progressStatuses,
    };
  } catch (error) {
    const progressStatuses = progressEvents
      .map((event) => event.layer?.status)
      .filter((status): status is string => Boolean(status));
    if (progressStatuses.includes('static-preview')) {
      return {
        outcome: 'exports-static-with-warning',
        colorCycleLayerCount,
        exportedColorCycleLayerCount: 0,
        progressStatuses,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      outcome: 'fails-visibly',
      colorCycleLayerCount,
      exportedColorCycleLayerCount: 0,
      progressStatuses,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

describe('Goblet2 legacy .vs corpus', () => {
  beforeAll(() => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = TestOffscreenCanvas;
    (globalThis as { Image?: unknown }).Image = TestImage;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'blob:legacy-corpus'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      writable: true,
      value(callback: BlobCallback, type?: string): void {
        callback(new Blob(['legacy-corpus-preview'], { type: type ?? 'image/png' }));
      },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value(type?: string): string {
        return `data:${type ?? 'image/png'};base64,bGVnYWN5LWNvcnB1cw==`;
      },
    });
  });

  afterAll(() => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas;
    (globalThis as { Image?: unknown }).Image = originalImage;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      writable: true,
      value: originalAnchorClick,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      writable: true,
      value: originalToBlob,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value: originalToDataURL,
    });
  });

  it('loads every required real archive and observes the documented Goblet export outcome', async () => {
    const manifest = loadManifest();
    expect(manifest.version).toBe(1);

    const coveredEntries = manifest.requiredArchives.filter((entry) => entry.status === 'covered');
    expect(coveredEntries.map((entry) => entry.id).sort()).toEqual([
      'c3-style-damaged-vs-archive',
      'pre-schema-2-vs-archive',
    ]);

    for (const entry of coveredEntries) {
      expect(entry.archivePath).toEqual(expect.any(String));
      expect(entry.expectedOutcome).not.toBe('todo');
      const result = await classifyExportOutcome(entry.archivePath as string);
      expect(result.colorCycleLayerCount).toBeGreaterThan(0);
      if (result.outcome !== entry.expectedOutcome) {
        throw new Error([
          `Legacy corpus outcome mismatch for ${entry.id}.`,
          `Expected: ${entry.expectedOutcome}`,
          `Received: ${result.outcome}`,
          result.error ? `Reason: ${result.error}` : undefined,
        ].filter(Boolean).join('\n'));
      }
      if (entry.expectedOutcome === 'exports-animated') {
        expect(result.exportedColorCycleLayerCount).toBeGreaterThan(0);
      } else if (entry.expectedOutcome === 'exports-static-with-warning') {
        expect(result.progressStatuses).toContain('static-preview');
      } else {
        expect(result.error).toEqual(expect.any(String));
      }
    }
  });
});
