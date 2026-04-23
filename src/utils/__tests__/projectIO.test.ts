import JSZip from 'jszip';
import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import {
  deserializeProject,
  getProjectSaveSizeReport,
  readProjectManifest,
  readProjectPreviewManifest,
  restoreColorCycleBrushes,
  saveProjectToFile,
  serializeProject
} from '@/utils/projectIO';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { BrushShape, type Layer, type Project } from '@/types';

jest.setTimeout(20000);

const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
let consoleWarnSpy: jest.SpyInstance | null = null;

class TestOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return null;
  }
}

beforeAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = TestOffscreenCanvas;
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error('Canvas encoding disabled for tests');
    }
  });
});

afterAll(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas;
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    writable: true,
    value: originalToDataURL
  });
  consoleWarnSpy?.mockRestore();
  consoleWarnSpy = null;
});

const minimalVesselProject = {
  version: '1.0.0',
  metadata: {
    name: 'demo',
    created: '2025-01-01T00:00:00.000Z',
    modified: '2025-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
  },
  project: {
    id: 'p1',
    name: 'demo',
    width: 10,
    height: 10,
    backgroundColor: '#000000',
    layers: [],
    customBrushes: [],
  },
};

const asJson = JSON.stringify(minimalVesselProject);

async function zipWithProjectJson(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('project.json', asJson);
  return zip.generateAsync({ type: 'uint8array' });
}

async function zipWithPreviewManifestOnly(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    version: '1.1.0',
    metadata: minimalVesselProject.metadata,
    project: {
      id: minimalVesselProject.project.id,
      name: minimalVesselProject.project.name,
      width: minimalVesselProject.project.width,
      height: minimalVesselProject.project.height,
      thumbnail: 'data:image/png;base64,preview'
    }
  }));
  return zip.generateAsync({ type: 'uint8array' });
}

async function zipWithPreviewManifestV2Only(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    version: '1.1.0',
    manifestVersion: 2,
    metadata: minimalVesselProject.metadata,
    project: {
      id: minimalVesselProject.project.id,
      name: minimalVesselProject.project.name,
      width: minimalVesselProject.project.width,
      height: minimalVesselProject.project.height,
    },
    preview: {
      dataUrl: 'data:image/webp;base64,preview-v2',
      width: 10,
      height: 10,
      encoding: 'image/webp',
    },
  }));
  return zip.generateAsync({ type: 'uint8array' });
}

const createSolidImageData = (
  width: number,
  height: number,
  color: [number, number, number, number]
): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return new ImageData(data, width, height);
};

const createCanvasFromImageData = (imageData: ImageData): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx?.putImageData(imageData, 0, 0);
  return canvas;
};

const encodeRawImageDataUrl = (imageData: ImageData): string => {
  const rawData = {
    width: imageData.width,
    height: imageData.height,
    dataBase64: Buffer.from(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    ).toString('base64'),
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(rawData)).toString('base64')}`;
};

const readPixel = (imageData: ImageData | null, x: number, y: number): [number, number, number, number] => {
  if (!imageData) {
    return [0, 0, 0, 0];
  }
  const idx = (y * imageData.width + x) * 4;
  const { data } = imageData;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
};

describe('projectIO readProjectManifest', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('parses plain JSON string payloads', async () => {
    const manifest = await readProjectManifest(asJson);
    expect(manifest.project.name).toBe('demo');
    expect(manifest.metadata.appVersion).toBe('1.0.0');
  });

  it('parses zipped project data (uint8array)', async () => {
    const zipped = await zipWithProjectJson();
    const manifest = await readProjectManifest(zipped);
    expect(manifest.project.id).toBe('p1');
  });

  it('does not reject valid zip manifests based on unreliable JSZip size metadata', async () => {
    const entry = {
      _data: { uncompressedSize: Number.MAX_SAFE_INTEGER },
      async: jest.fn().mockResolvedValue(new TextEncoder().encode(asJson)),
    };
    const fakeZip = {
      file: jest.fn().mockReturnValue(entry),
    };
    const loadAsyncSpy = jest.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip as unknown as JSZip);

    try {
      const manifest = await readProjectManifest(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
      expect(manifest.project.id).toBe('p1');
      expect(entry.async).toHaveBeenCalledWith('uint8array');
    } finally {
      loadAsyncSpy.mockRestore();
    }
  });

  it('accepts zipped manifests above 32MB when still within archive safety limits', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      ...minimalVesselProject,
      metadata: {
        ...minimalVesselProject.metadata,
        appVersion: 'x'.repeat((33 * 1024 * 1024) + 128),
      },
    }));
    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    const manifest = await readProjectManifest(payload);
    expect(manifest.project.id).toBe('p1');
  });

  it('parses binary-string zip payload via fallback', async () => {
    const zipped = await zipWithProjectJson();
    const binaryString = Array.from(zipped)
      .map((b) => String.fromCharCode(b))
      .join('');

    const manifest = await readProjectManifest(binaryString);
    expect(manifest.project.width).toBe(10);
  });

  it('throws for invalid manifest structure', async () => {
    await expect(readProjectManifest('{}')).rejects.toThrow('Invalid Vessel project file');
  });

  it('rejects project manifests with oversized dimensions', async () => {
    const oversized = {
      ...minimalVesselProject,
      project: {
        ...minimalVesselProject.project,
        width: 20000,
        height: 10,
      },
    };

    await expect(readProjectManifest(JSON.stringify(oversized))).rejects.toThrow('Invalid project dimensions');
  });

  it('rejects project manifests with too many layers', async () => {
    const tooManyLayers = {
      ...minimalVesselProject,
      project: {
        ...minimalVesselProject.project,
        layers: Array.from({ length: 513 }, () => ({})),
      },
    };

    await expect(readProjectManifest(JSON.stringify(tooManyLayers))).rejects.toThrow('Project has too many layers');
  });

  it('throws when zip payload lacks project.json', async () => {
    const zip = new JSZip();
    zip.file('other.txt', 'no project here');
    const payload = await zip.generateAsync({ type: 'uint8array' });

    await expect(readProjectManifest(payload)).rejects.toThrow(/project\.json/);
  });

  it('rejects corrupted binary payloads', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(readProjectManifest(garbage)).rejects.toThrow(/Invalid project file format/);
  });
});

describe('projectIO readProjectPreviewManifest', () => {
  it('prefers archive manifest.json when present', async () => {
    const payload = await zipWithPreviewManifestOnly();
    const manifest = await readProjectPreviewManifest(payload);
    expect(manifest.project.name).toBe('demo');
    expect(manifest.project.thumbnail).toBe('data:image/png;base64,preview');
  });

  it('reads manifestVersion 2 preview payloads and normalizes thumbnail field', async () => {
    const payload = await zipWithPreviewManifestV2Only();
    const manifest = await readProjectPreviewManifest(payload);
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.project.name).toBe('demo');
    expect(manifest.project.thumbnail).toBe('data:image/webp;base64,preview-v2');
    expect(manifest.preview?.encoding).toBe('image/webp');
  });

  it('falls back to project.json when manifest.json is missing', async () => {
    const payload = await zipWithProjectJson();
    const manifest = await readProjectPreviewManifest(payload);
    expect(manifest.project.id).toBe('p1');
    expect(manifest.project.width).toBe(10);
  });

  it('rejects preview manifests with oversized dimensions', async () => {
    const payload = JSON.stringify({
      version: '1.1.0',
      metadata: minimalVesselProject.metadata,
      project: {
        id: 'preview-oversized',
        name: 'Oversized',
        width: 20000,
        height: 10,
      },
    });

    await expect(readProjectPreviewManifest(payload)).rejects.toThrow('Invalid project dimensions');
  });
});

describe('projectIO serialize/deserialize layering', () => {
  it('builds a save size report with section and layer breakdown', async () => {
    const layerA: Layer = {
      id: 'layer-report-a',
      name: 'Report A',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(16, 16, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(16, 16, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };
    const layerB: Layer = {
      id: 'layer-report-b',
      name: 'Report B',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 1,
      imageData: createSolidImageData(64, 64, [0, 255, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(64, 64, [0, 255, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };
    const project: Project = {
      id: 'project-report',
      name: 'Report Demo',
      width: 64,
      height: 64,
      backgroundColor: '#000000',
      layers: [layerA, layerB],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const report = await getProjectSaveSizeReport(project, project.layers);
      expect(report.projectManifestBytes).toBeGreaterThan(0);
      expect(report.previewManifestBytes).toBeGreaterThan(0);
      expect(report.combinedManifestBytes).toBe(report.projectManifestBytes + report.previewManifestBytes);
      expect(report.archiveBytes).toBeGreaterThan(0);
      expect(report.sectionBreakdown.find((section) => section.name === 'layers')?.bytes ?? 0).toBeGreaterThan(0);
      expect(report.largestLayers.length).toBeGreaterThan(0);
      expect(report.largestLayers[0]?.layerId).toBe('layer-report-b');
      expect(report.recommendations.length).toBeGreaterThan(0);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('writes compact CC archives by pruning duplicated animator frame buffers when stroke snapshots already exist', async () => {
    const width = 64;
    const height = 64;
    const paint = new Uint8Array(width * height);
    const gradientId = new Uint8Array(width * height);
    const speed = new Uint8Array(width * height);
    const flow = new Uint8Array(width * height);
    const phase = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    paint[0] = 1;
    gradientId[0] = 9;
    speed[0] = 3;
    flow[0] = 2;
    phase[0] = 7;
    gradientDefIds[0] = 11;

    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = width;
    brushCanvas.height = height;
    const brush = new ColorCycleBrushCanvas2D(brushCanvas, { brushSize: 6, fps: 24 });
    brush.applyLayerSnapshot('layer-cc-compact-archive', {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientId.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      flowBuffer: flow.buffer.slice(0),
      phaseBuffer: phase.buffer.slice(0),
      hasContent: true,
      strokeCounter: 2,
    });
    brush.setGradientSlotStops('layer-cc-compact-archive', 2, [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ]);
    brush.setActiveGradientSlot('layer-cc-compact-archive', 2);

    const layer: Layer = {
      id: 'layer-cc-compact-archive',
      name: 'CC Compact Archive',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(width, height, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: Object.assign(document.createElement('canvas'), { width, height }),
        canvasWidth: width,
        canvasHeight: height,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientDefStore: [{
          id: 11,
          kind: 'linear',
          stops: [
            { position: 0, color: '#112233' },
            { position: 1, color: '#ddeeff' },
          ],
          hash: 'g11',
          source: 'manual',
          createdAtMs: 0,
          slot: 2,
        }],
        mode: 'brush',
        colorCycleBrush: brush as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-compact-archive',
      name: 'CC Compact Archive',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }

      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{
            colorCycleData?: {
              brushState?: {
                layers?: Array<{
                  strokeData?: {
                    paintBuffer?: string;
                    gradientIdBuffer?: string;
                    gradientDefIdBuffer?: string;
                    speedBuffer?: string;
                    flowBuffer?: string;
                    phaseBuffer?: string;
                  };
                  animator?: {
                    indexBuffer: {
                      data?: string;
                      gradientId?: string;
                      speedData?: string;
                      flowData?: string;
                      phaseData?: string;
                    };
                  };
                }>;
              };
            };
          }>;
        };
      };

      const persistedLayer = manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0];
      expect(persistedLayer?.strokeData?.paintBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.strokeData?.gradientIdBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.strokeData?.gradientDefIdBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.strokeData?.speedBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.strokeData?.flowBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.strokeData?.phaseBuffer?.length ?? 0).toBeGreaterThan(0);
      expect(persistedLayer?.animator?.indexBuffer.data ?? '').toBe('');
      expect(persistedLayer?.animator?.indexBuffer.gradientId ?? '').toBe('');
      expect(persistedLayer?.animator?.indexBuffer.speedData ?? '').toBe('');
      expect(persistedLayer?.animator?.indexBuffer.flowData ?? '').toBe('');
      expect(persistedLayer?.animator?.indexBuffer.phaseData ?? '').toBe('');
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('externalizes large color-cycle stroke buffers into binary zip entries and restores them', async () => {
    const width = 64;
    const height = 64;
    const paint = new Uint8Array(width * height);
    const gradientId = new Uint8Array(width * height);
    const speed = new Uint8Array(width * height);
    const flow = new Uint8Array(width * height);
    const phase = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    paint[0] = 1;
    gradientId[0] = 9;
    speed[0] = 3;
    flow[0] = 2;
    phase[0] = 7;
    gradientDefIds[0] = 11;

    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = width;
    brushCanvas.height = height;
    const brush = new ColorCycleBrushCanvas2D(brushCanvas, { brushSize: 6, fps: 24 });
    brush.applyLayerSnapshot('layer-cc-external-buffers', {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientId.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      flowBuffer: flow.buffer.slice(0),
      phaseBuffer: phase.buffer.slice(0),
      hasContent: true,
      strokeCounter: 2,
    });

    const layer: Layer = {
      id: 'layer-cc-external-buffers',
      name: 'CC External Buffers',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(width, height, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: Object.assign(document.createElement('canvas'), { width, height }),
        canvasWidth: width,
        canvasHeight: height,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        mode: 'brush',
        colorCycleBrush: brush as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-external-buffers',
      name: 'CC External Buffers',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }

      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{
            colorCycleData?: {
              gradientIdBuffer?: string;
              gradientDefIdBuffer?: string;
              brushState?: {
                layers?: Array<{
                  strokeData?: {
                    paintBuffer?: string;
                    gradientIdBuffer?: string;
                    gradientDefIdBuffer?: string;
                    speedBuffer?: string;
                    flowBuffer?: string;
                    phaseBuffer?: string;
                  };
                }>;
              };
            };
          }>;
        };
      };

      const persistedLayer = manifest.project.layers[0]?.colorCycleData;
      expect(persistedLayer?.brushState?.layers?.[0]?.strokeData?.paintBuffer?.startsWith('zip:')).toBe(true);
      expect(persistedLayer?.brushState?.layers?.[0]?.strokeData?.flowBuffer?.startsWith('zip:')).toBe(true);
      expect(zip.file('buffers/color-cycle/layer-cc-external-buffers/brush-state/0/paint.bin')).toBeTruthy();

      const restored = await deserializeProject(payload);
      const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
      const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
        | {
            getLayerSnapshot?: (layerId: string) => {
              paintBuffer: ArrayBuffer;
              gradientIdBuffer?: ArrayBuffer;
              gradientDefIdBuffer?: ArrayBuffer;
              flowBuffer?: ArrayBuffer;
              phaseBuffer?: ArrayBuffer;
              hasContent: boolean;
              strokeCounter?: number;
            } | null;
          }
        | undefined;
      const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);
      expect(snapshot).toBeTruthy();
      expect(snapshot?.hasContent).toBe(true);
      expect(snapshot?.strokeCounter).toBe(2);
      expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(paint));
      expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(gradientId));
      expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(gradientDefIds));
      expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(flow));
      expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(phase));
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('restores compact animator metadata records with paintSlot intact', async () => {
    const width = 3;
    const height = 3;
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'compact-cc-metadata',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-compact-cc-metadata',
        name: 'compact-cc-metadata',
        width,
        height,
        backgroundColor: '#000000',
        layers: [{
          id: 'layer-compact-cc-metadata',
          name: 'CC Compact Metadata',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageDataUrl: '',
          alignment: createDefaultLayerAlignment(),
          layerType: 'color-cycle',
          version: 1,
          colorCycleData: {
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(width, height, [120, 40, 200, 255])),
            canvasWidth: width,
            canvasHeight: height,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            isAnimating: false,
            mode: 'brush',
            brushState: {
              layers: [{
                layerId: 'layer-compact-cc-metadata',
                paintSlot: 2,
                animator: {
                  indexBuffer: {
                    width,
                    height,
                    data: '',
                    gradientId: '',
                    speedData: '',
                    flowData: '',
                    phaseData: '',
                    palette: ['#000000', '#ffffff'],
                  },
                  gradient: {
                    gradientStops: [
                      { position: 0, color: '#000000' },
                      { position: 1, color: '#ffffff' },
                    ],
                  },
                  animation: {
                    offset: 0,
                    stats: {
                      targetFPS: 24,
                      actualFPS: 24,
                      frameCount: 1,
                      totalTime: 0,
                      averageFrameTime: 0,
                      isAnimating: false,
                    },
                  },
                },
                strokeData: {
                  paintBuffer: Buffer.from(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0])).toString('base64'),
                  hasContent: true,
                  strokeCounter: 1,
                },
              }],
              cycleSpeed: 0.5,
              fps: 24,
              brushSize: 8,
            },
          },
        }],
        customBrushes: [],
        defaultCustomBrushId: null,
        brushSpecificSettings: {},
        globalBrushSize: 1,
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | { activeGradientSlots?: Map<string, number> }
      | undefined;
    const activeSlot = restoredBrush?.activeGradientSlots?.get(restoredLayer.id);

    expect(activeSlot).toBe(2);
  });

  it('writes v2 preview manifest and omits project.json thumbnail duplication', async () => {
    const toDataURLSpy = jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((type?: string) => {
      if (type === 'image/webp') {
        return 'data:image/webp;base64,preview-webp';
      }
      return 'data:image/png;base64,preview-png';
    });
    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const layer: Layer = {
        id: 'layer-preview',
        name: 'Preview Layer',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
        framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
        alignment: createDefaultLayerAlignment(),
        layerType: 'normal',
        version: 1,
      };
      const project: Project = {
        id: 'project-preview-v2',
        name: 'Preview V2',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        layers: [layer],
        customBrushes: [],
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      };

      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      const manifestJson = await zip.file('manifest.json')?.async('string');
      if (!projectJson || !manifestJson) {
        throw new Error('Missing archive entries');
      }

      const projectManifest = JSON.parse(projectJson) as {
        project: { thumbnail?: string };
      };
      const previewManifest = JSON.parse(manifestJson) as {
        manifestVersion?: number;
        project: { thumbnail?: string };
        preview?: { dataUrl?: string; encoding?: string };
      };

      expect(projectManifest.project.thumbnail).toBeUndefined();
      expect(previewManifest.manifestVersion).toBe(2);
      expect(previewManifest.project.thumbnail).toBeUndefined();
      expect(previewManifest.preview?.dataUrl).toBe('data:image/webp;base64,preview-webp');
      expect(previewManifest.preview?.encoding).toBe('image/webp');

      const parsedPreview = await readProjectPreviewManifest(payload);
      expect(parsedPreview.project.thumbnail).toBe('data:image/webp;base64,preview-webp');
    } finally {
      toDataURLSpy.mockRestore();
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('omits redundant color-cycle layer imageDataUrl when CC snapshots are serialized', async () => {
    const ccImageData = createSolidImageData(4, 4, [12, 34, 56, 255]);
    const layer: Layer = {
      id: 'layer-cc-dedupe',
      name: 'CC Dedupe',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(4, 4, [200, 20, 20, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(4, 4, [200, 20, 20, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvasImageData: ccImageData,
        canvasWidth: ccImageData.width,
        canvasHeight: ccImageData.height,
        isAnimating: false,
      },
    };
    const project: Project = {
      id: 'project-cc-dedupe',
      name: 'CC Dedupe',
      width: 4,
      height: 4,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }
      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{ imageDataUrl?: string; colorCycleData?: { canvasImageData?: string } }>;
        };
      };
      const serializedLayer = manifest.project.layers[0];
      expect(serializedLayer?.imageDataUrl).toBe('');
      expect(typeof serializedLayer?.colorCycleData?.canvasImageData).toBe('string');
      expect(serializedLayer?.colorCycleData?.canvasImageData?.length ?? 0).toBeGreaterThan(0);

      const restored = await deserializeProject(payload);
      const restoredLayer = restored.layers[0];
      expect(restoredLayer?.layerType).toBe('color-cycle');
      expect(restoredLayer?.colorCycleData?.canvasImageData?.width).toBe(4);
      expect(restoredLayer?.colorCycleData?.canvasImageData?.height).toBe(4);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('persists metadata-only color-cycle brushState payloads', async () => {
    const ccImageData = createSolidImageData(4, 4, [12, 34, 56, 255]);
    const layer: Layer = {
      id: 'layer-cc-metadata-only',
      name: 'CC Metadata Only',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(4, 4, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvasImageData: ccImageData,
        canvasWidth: ccImageData.width,
        canvasHeight: ccImageData.height,
        isAnimating: false,
        colorCycleBrush: {
          getFullState: () => ({
            cycleSpeed: 0.35,
            fps: 24,
            brushSize: 7,
            layers: [],
          }),
        } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-metadata-only',
      name: 'CC Metadata Only',
      width: 4,
      height: 4,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }

      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{
            colorCycleData?: {
              brushState?: {
                cycleSpeed?: number;
                fps?: number;
                brushSize?: number;
                layers?: unknown[];
              };
            };
          }>;
        };
      };

      expect(manifest.project.layers[0]?.colorCycleData?.brushState).toEqual({
        cycleSpeed: 0.35,
        fps: 24,
        brushSize: 7,
        layers: [],
      });
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('serializes authoritative color-cycle buffers from the same-layer brush snapshot', async () => {
    const width = 2;
    const height = 2;
    const staleGradientIds = Uint8Array.from([9, 9, 9, 9]);
    const staleGradientDefs = new Uint16Array([7, 7, 7, 7]);
    const snapshotGradientIds = Uint8Array.from([1, 2, 3, 4]);
    const snapshotGradientDefs = new Uint16Array([4, 3, 2, 1]);
    const ccImageData = createSolidImageData(width, height, [12, 34, 56, 255]);

    const layer: Layer = {
      id: 'layer-cc-authoritative-snapshot',
      name: 'CC Authoritative Snapshot',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(width, height, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvasImageData: ccImageData,
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: staleGradientIds.buffer,
        gradientDefIdBuffer: staleGradientDefs.buffer,
        isAnimating: false,
        colorCycleBrush: {
          getFullState: () => ({
            cycleSpeed: 0.35,
            fps: 24,
            brushSize: 7,
            layers: [{
              layerId: 'layer-cc-authoritative-snapshot',
              strokeData: {
                hasContent: true,
                strokeCounter: 2,
                paintBuffer: Uint8Array.from([5, 5, 5, 5]).buffer,
                gradientIdBuffer: snapshotGradientIds.buffer,
                gradientDefIdBuffer: snapshotGradientDefs.buffer,
              },
            }],
          }),
        } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-authoritative-snapshot',
      name: 'CC Authoritative Snapshot',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }

      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{
            colorCycleData?: {
              gradientIdBuffer?: string;
              gradientDefIdBuffer?: string;
            };
          }>;
        };
      };

      expect(manifest.project.layers[0]?.colorCycleData?.gradientIdBuffer).toBe(
        'zip:buffers/color-cycle/layer-cc-authoritative-snapshot/gradient-id.bin',
      );
      expect(manifest.project.layers[0]?.colorCycleData?.gradientDefIdBuffer).toBe(
        'zip:buffers/color-cycle/layer-cc-authoritative-snapshot/gradient-def-id.bin',
      );
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('keeps persisted color-cycle brushState on the layer after deserialize', async () => {
    const savedPaint = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64');
    const savedFlow = Buffer.from(Uint8Array.from([5, 6, 7, 8])).toString('base64');
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-brush-state',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-brush-state',
        name: 'cc-brush-state',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-state',
          name: 'CC Layer',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              layers: [{
                layerId: 'layer-cc-state',
                strokeData: {
                  paintBuffer: savedPaint,
                  flowBuffer: savedFlow,
                },
              }],
            },
          },
        }],
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const restoredLayer = restored.layers[0];

    expect(restoredLayer?.colorCycleData?.brushState).toEqual(projectPayload.project.layers[0].colorCycleData.brushState);
  });

  it('restores metadata-only color-cycle brushState to the runtime brush', async () => {
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-brush-state-metadata-only',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-brush-state-metadata-only',
        name: 'cc-brush-state-metadata-only',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-brush-state-metadata-only',
          name: 'CC Brush State Metadata Only',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(2, 2, [60, 80, 100, 255])),
            canvasWidth: 2,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            brushState: {
              cycleSpeed: 0.35,
              fps: 24,
              brushSize: 7,
              ditherEnabled: true,
              ditherStrength: 0.6,
              ditherPixelSize: 38,
              perceptualDither: false,
              layers: [],
            },
          },
        }],
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          serialize?: () => {
            ditherEnabled?: boolean;
            ditherStrength?: number;
            ditherPixelSize?: number;
            perceptualDither?: boolean;
          };
        }
      | undefined;
    const restoredState = restoredBrush?.serialize?.();

    expect(restoredLayer.colorCycleData?.brushState).toEqual(
      projectPayload.project.layers[0].colorCycleData.brushState,
    );
    expect(restoredState?.ditherEnabled).toBe(true);
    expect(restoredState?.ditherStrength).toBe(0.6);
    expect(restoredState?.ditherPixelSize).toBe(38);
    expect(restoredState?.perceptualDither).toBe(false);
  });

  it('prefers same-layer brush snapshot buffers when deserializing color-cycle data', async () => {
    const persistedGradientIds = Uint8Array.from([9, 9, 9, 9]);
    const persistedGradientDefs = new Uint16Array([8, 8, 8, 8]);
    const snapshotGradientIds = Uint8Array.from([1, 2, 3, 4]);
    const snapshotGradientDefs = new Uint16Array([4, 3, 2, 1]);

    const restored = await deserializeProject(JSON.stringify({
      version: '1.1.0',
      metadata: {
        name: 'cc-authoritative-load',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-authoritative-load',
        name: 'cc-authoritative-load',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-authoritative-load',
          name: 'CC Authoritative Load',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(2, 2, [60, 80, 100, 255])),
            canvasWidth: 2,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            gradientDefStore: [1, 2, 3, 4].map((id, index) => ({
              id,
              kind: 'linear' as const,
              stops: [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ],
              hash: `g${id}`,
              source: 'manual' as const,
              createdAtMs: index,
              slot: index,
            })),
            gradientIdBuffer: Buffer.from(persistedGradientIds).toString('base64'),
            gradientDefIdBuffer: Buffer.from(new Uint8Array(persistedGradientDefs.buffer)).toString('base64'),
            brushState: {
              layers: [{
                layerId: 'layer-cc-authoritative-load',
                strokeData: {
                  paintBuffer: Buffer.from(Uint8Array.from([5, 5, 5, 5])).toString('base64'),
                  gradientIdBuffer: Buffer.from(snapshotGradientIds).toString('base64'),
                  gradientDefIdBuffer: Buffer.from(new Uint8Array(snapshotGradientDefs.buffer)).toString('base64'),
                },
              }],
            },
          },
        }],
      },
    }));

    const restoredLayer = restored.layers[0];
    expect(Array.from(new Uint8Array(restoredLayer.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      [1, 2, 3, 4],
    );
    expect(
      Array.from(new Uint16Array(restoredLayer.colorCycleData?.gradientDefIdBuffer ?? new ArrayBuffer(0))),
    ).toEqual([4, 3, 2, 1]);
  });

  it('falls back to top-level color-cycle def buffers when brush snapshot references missing defs', async () => {
    const restored = await deserializeProject(JSON.stringify({
      version: '1.1.0',
      metadata: {
        name: 'cc-invalid-snapshot-defs',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-invalid-snapshot-defs',
        name: 'cc-invalid-snapshot-defs',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-invalid-snapshot-defs',
          name: 'CC Invalid Snapshot Defs',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(2, 2, [60, 80, 100, 255])),
            canvasWidth: 2,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            gradientDefStore: [{
              id: 1,
              kind: 'linear',
              stops: [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ],
              hash: 'g1',
              source: 'manual',
              createdAtMs: 0,
              slot: 0,
            }],
            gradientIdBuffer: Buffer.from(Uint8Array.from([1, 1, 1, 1])).toString('base64'),
            gradientDefIdBuffer: Buffer.from(new Uint8Array(new Uint16Array([1, 1, 1, 1]).buffer)).toString('base64'),
            brushState: {
              layers: [{
                layerId: 'layer-cc-invalid-snapshot-defs',
                strokeData: {
                  paintBuffer: Buffer.from(Uint8Array.from([5, 5, 5, 5])).toString('base64'),
                  gradientIdBuffer: Buffer.from(Uint8Array.from([2, 2, 2, 2])).toString('base64'),
                  gradientDefIdBuffer: Buffer.from(new Uint8Array(new Uint16Array([2, 2, 2, 2]).buffer)).toString('base64'),
                },
              }],
            },
          },
        }],
      },
    }));

    const restoredLayer = restored.layers[0];
    expect(Array.from(new Uint8Array(restoredLayer.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      [1, 1, 1, 1],
    );
    expect(
      Array.from(new Uint16Array(restoredLayer.colorCycleData?.gradientDefIdBuffer ?? new ArrayBuffer(0))),
    ).toEqual([1, 1, 1, 1]);
  });

  it('serializes flowBuffer and phaseBuffer in color-cycle brushState', async () => {
    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const layer: Layer = {
      id: 'layer-cc-flow-save',
      name: 'CC Flow Save',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas,
        mode: 'brush',
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        colorCycleBrush: {
          getFullState: () => ({
            cycleSpeed: 0.2,
            fps: 18,
            layers: [{
              layerId: 'layer-cc-flow-save',
              strokeData: {
                hasContent: true,
                strokeCounter: 2,
                paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
                flowBuffer: Uint8Array.from([9, 10, 11, 12]).buffer,
                phaseBuffer: Uint8Array.from([64, 96, 128, 192]).buffer,
              },
            }],
          }),
        } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-flow-save',
      name: 'CC Flow Save',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    try {
      const payload = await serializeProject(project, project.layers);
      const zip = await JSZip.loadAsync(payload);
      const projectJson = await zip.file('project.json')?.async('string');
      if (!projectJson) {
        throw new Error('Missing project.json');
      }

      const manifest = JSON.parse(projectJson) as {
        project: {
          layers: Array<{
            colorCycleData?: {
              brushState?: {
                layers?: Array<{ strokeData?: { flowBuffer?: string; phaseBuffer?: string } }>;
              };
            };
          }>;
        };
      };

      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.flowBuffer
      ).toBe('zip:buffers/color-cycle/layer-cc-flow-save/brush-state/0/flow.bin');
      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.phaseBuffer
      ).toBe('zip:buffers/color-cycle/layer-cc-flow-save/brush-state/0/phase.bin');
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('serializes and restores fill dither settings in color-cycle brushState', async () => {
    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = jest.fn();
    }

    const layer: Layer = {
      id: 'layer-cc-fill-dither',
      name: 'CC Fill Dither',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: createCanvasFromImageData(createSolidImageData(2, 2, [10, 20, 30, 255])),
        canvasImageData: createSolidImageData(2, 2, [10, 20, 30, 255]),
        canvasWidth: 2,
        canvasHeight: 2,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        isAnimating: true,
        mode: 'brush',
        colorCycleBrush: {
          getFullState: () => ({
            cycleSpeed: 0.4,
            fps: 24,
            brushSize: 9,
            ditherEnabled: true,
            ditherStrength: 0.65,
            ditherPixelSize: 5,
            perceptualDither: true,
            layers: [{
              layerId: 'layer-cc-fill-dither',
              strokeData: {
                hasContent: true,
                strokeCounter: 3,
                paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
              },
            }],
          }),
        } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
      },
    };

    const project: Project = {
      id: 'project-cc-fill-dither',
      name: 'cc-fill-dither',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      defaultCustomBrushId: null,
      brushSpecificSettings: {},
      globalBrushSize: 1,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      referenceLayerId: null,
      exportLayout: undefined,
      palette: undefined,
      canvasShape: undefined,
    };

    try {
      const payload = await serializeProject(project, project.layers);
      const manifest = await readProjectManifest(payload);
      const persistedBrushState = manifest.project.layers[0]?.colorCycleData?.brushState;

      expect(persistedBrushState?.ditherEnabled).toBe(true);
      expect(persistedBrushState?.ditherStrength).toBe(0.65);
      expect(persistedBrushState?.ditherPixelSize).toBe(5);
      expect(persistedBrushState?.perceptualDither).toBe(true);

      const restored = await deserializeProject(payload);
      const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
      const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
        | {
            serialize?: () => {
              ditherEnabled?: boolean;
              ditherStrength?: number;
              ditherPixelSize?: number;
              perceptualDither?: boolean;
            };
          }
        | undefined;
      const restoredState = restoredBrush?.serialize?.();

      expect(restoredState?.ditherEnabled).toBe(true);
      expect(restoredState?.ditherStrength).toBe(0.65);
      expect(restoredState?.ditherPixelSize).toBe(5);
      expect(restoredState?.perceptualDither).toBe(true);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('preserves recovered color-cycle canvas pixels on first commit when runtime has external base only', async () => {
    const canvasImageData = createSolidImageData(3, 3, [240, 120, 60, 255]);
    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 3;
    colorCycleCanvas.height = 3;

    const layer: Layer = {
      id: 'layer-cc-external-base',
      name: 'CC External Base',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(3, 3, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: colorCycleCanvas,
        canvasImageData,
        canvasWidth: 3,
        canvasHeight: 3,
        isAnimating: false,
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([layer]);
    const restoredCanvas = restoredLayer.colorCycleData?.canvas;
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
        }
      | undefined;

    expect(restoredCanvas).toBeTruthy();
    expect(restoredBrush?.commitToLayer).toBeDefined();
    if (!restoredCanvas || !restoredBrush?.commitToLayer) {
      throw new Error('Expected restored color cycle runtime');
    }

    const before = restoredCanvas.getContext('2d', { willReadFrequently: true })?.getImageData(1, 1, 1, 1);
    expect(before).toBeTruthy();
    const beforePixel = before?.data ?? new Uint8ClampedArray([0, 0, 0, 0]);
    expect(beforePixel[3]).toBeGreaterThan(0);

    restoredBrush.commitToLayer(restoredCanvas, restoredLayer.id);

    const after = restoredCanvas.getContext('2d', { willReadFrequently: true })?.getImageData(1, 1, 1, 1);
    expect(after).toBeTruthy();
    const afterPixel = after?.data ?? new Uint8ClampedArray([0, 0, 0, 0]);
    expect(Array.from(afterPixel)).toEqual(Array.from(beforePixel));
  });

  it('prefers actual color-cycle canvas dimensions over stale saved metadata', async () => {
    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 3;
    colorCycleCanvas.height = 2;

    const layer: Layer = {
      id: 'layer-cc-dims-save',
      name: 'CC Dims Save',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(3, 2, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: colorCycleCanvas,
        canvasImageData: createSolidImageData(3, 2, [10, 20, 30, 255]),
        canvasWidth: 4,
        canvasHeight: 4,
        isAnimating: false,
      },
    };

    const project: Project = {
      id: 'project-cc-dims-save',
      name: 'CC Dims Save',
      width: 3,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    try {
      const payload = await serializeProject(project, project.layers);
      const manifest = await readProjectManifest(payload);
      const serializedColorCycle = manifest.project.layers[0]?.colorCycleData;

      expect(serializedColorCycle?.canvasWidth).toBe(3);
      expect(serializedColorCycle?.canvasHeight).toBe(2);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('drops incompatible cropped color-cycle brushState during load and uses project dimensions', async () => {
    const canvasImageData = createSolidImageData(4, 4, [240, 120, 60, 255]);
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-crop-mismatch',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-crop-mismatch',
        name: 'cc-crop-mismatch',
        width: 3,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-crop-mismatch',
          name: 'CC Crop Mismatch',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(canvasImageData),
            canvasWidth: 4,
            canvasHeight: 4,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              layers: [{
                layerId: 'layer-cc-crop-mismatch',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
                  paintBuffer: Buffer.from(new Uint8Array(16).fill(1)).toString('base64'),
                },
                animator: {
                  indexBuffer: {
                    width: 4,
                    height: 4,
                    data: Buffer.from(new Uint8Array(16).fill(1)).toString('base64'),
                    palette: ['#000000', '#ffffff'],
                  },
                  gradient: {
                    gradientStops: [
                      { position: 0, color: '#000000' },
                      { position: 1, color: '#ffffff' },
                    ],
                  },
                  animation: {
                    offset: 0,
                    stats: {
                      targetFPS: 12,
                      actualFPS: 12,
                      frameCount: 1,
                      totalTime: 0,
                      averageFrameTime: 0,
                      isAnimating: false,
                    },
                  },
                },
              }],
            },
          },
        }],
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);

    expect(restoredLayer.colorCycleData?.canvas?.width).toBe(3);
    expect(restoredLayer.colorCycleData?.canvas?.height).toBe(2);
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeDefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[projectIO] Dropping incompatible color cycle brushState during load',
      expect.objectContaining({
        layerId: 'layer-cc-crop-mismatch',
        canvasWidth: 3,
        canvasHeight: 2,
      }),
    );
  });

  it('restores flowBuffer and phaseBuffer from persisted color-cycle brushState', async () => {
    const flowBuffer = Buffer.from(Uint8Array.from([5, 6, 7, 8])).toString('base64');
    const phaseBuffer = Buffer.from(Uint8Array.from([64, 96, 128, 192])).toString('base64');
    const paintBuffer = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64');
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-flow-restore',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-flow-restore',
        name: 'cc-flow-restore',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-flow-restore',
          name: 'CC Flow Restore',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: '',
            canvasWidth: 2,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              layers: [{
                layerId: 'layer-cc-flow-restore',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
                  paintBuffer,
                  flowBuffer,
                  phaseBuffer,
                },
              }],
            },
          },
        }],
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            flowBuffer?: ArrayBuffer;
            phaseBuffer?: ArrayBuffer;
          } | null;
        }
      | undefined;

    const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);
    expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual([5, 6, 7, 8]);
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([64, 96, 128, 192]);
  });

  it('prefers saved brushState snapshots over fallback gradient buffer seeding during restore', async () => {
    const brushStateGradientIds = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64');
    const fallbackGradientIds = Buffer.from(Uint8Array.from([7, 7, 7, 7])).toString('base64');
    const paintBuffer = Buffer.from(Uint8Array.from([9, 8, 7, 6])).toString('base64');
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-brushstate-precedence',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-brushstate-precedence',
        name: 'cc-brushstate-precedence',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-brushstate-precedence',
          name: 'CC BrushState Precedence',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(2, 2, [20, 30, 40, 255])),
            canvasWidth: 2,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            gradientIdBuffer: fallbackGradientIds,
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              ditherEnabled: true,
              ditherPixelSize: 38,
              layers: [{
                layerId: 'layer-cc-brushstate-precedence',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
                  paintBuffer,
                  gradientIdBuffer: brushStateGradientIds,
                },
              }],
            },
          },
        }],
      },
    };

    const restored = await deserializeProject(JSON.stringify(projectPayload));
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            paintBuffer: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            strokeCounter?: number;
            hasContent: boolean;
          } | null;
        }
      | undefined;

    const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);
    expect(snapshot).toBeTruthy();
    expect(snapshot?.hasContent).toBe(true);
    expect(snapshot?.strokeCounter).toBe(2);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([9, 8, 7, 6]);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
    expect(restoredLayer.colorCycleData?.brushState).toEqual(
      projectPayload.project.layers[0].colorCycleData.brushState,
    );
  });

  it('restores compatible duplicated color-cycle brushState snapshots without collapsing to metadata-only fallback', async () => {
    const width = 3;
    const height = 3;
    const snapshotPaint = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const snapshotGradientIds = Uint8Array.from([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const snapshotSpeed = Uint8Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const snapshotFlow = Uint8Array.from([4, 4, 4, 5, 5, 5, 6, 6, 6]);
    const snapshotPhase = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const snapshotDefs = new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const persistedGradientIds = Uint8Array.from([5, 5, 5, 5, 5, 5, 5, 5, 5]);

    const restored = await deserializeProject(JSON.stringify({
      version: '1.0.0',
      metadata: {
        name: 'oversized-cc',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-oversized-cc',
        name: 'oversized-cc',
        width,
        height,
        backgroundColor: '#000000',
        layers: [{
          id: 'layer-cc-oversized-brush-state',
          name: 'CC Oversized Brush State',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageDataUrl: '',
          alignment: createDefaultLayerAlignment(),
          layerType: 'color-cycle',
          version: 1,
          colorCycleData: {
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(width, height, [120, 40, 200, 255])),
            canvasWidth: width,
            canvasHeight: height,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            gradientIdBuffer: Buffer.from(persistedGradientIds).toString('base64'),
            isAnimating: false,
            mode: 'brush',
            brushState: {
              layers: [{
                layerId: 'layer-cc-oversized-brush-state',
                strokeData: {
                  paintBuffer: Buffer.from(snapshotPaint).toString('base64'),
                  gradientIdBuffer: Buffer.from(snapshotGradientIds).toString('base64'),
                  gradientDefIdBuffer: Buffer.from(snapshotDefs.buffer).toString('base64'),
                  speedBuffer: Buffer.from(snapshotSpeed).toString('base64'),
                  flowBuffer: Buffer.from(snapshotFlow).toString('base64'),
                  phaseBuffer: Buffer.from(snapshotPhase).toString('base64'),
                  hasContent: true,
                  strokeCounter: 1,
                },
                animator: {
                  indexBuffer: {
                    width,
                    height,
                    data: Buffer.from(snapshotPaint).toString('base64'),
                    gradientId: Buffer.from(snapshotGradientIds).toString('base64'),
                    speedData: Buffer.from(snapshotSpeed).toString('base64'),
                    flowData: Buffer.from(snapshotFlow).toString('base64'),
                    phaseData: Buffer.from(snapshotPhase).toString('base64'),
                    palette: ['#000000', '#ffffff'],
                  },
                  gradient: {
                    gradientStops: [
                      { position: 0, color: '#000000' },
                      { position: 1, color: '#ffffff' },
                    ],
                  },
                  animation: {
                    offset: 0,
                    stats: {
                      targetFPS: 24,
                      actualFPS: 24,
                      frameCount: 1,
                      totalTime: 0,
                      averageFrameTime: 0,
                      isAnimating: false,
                    },
                  },
                },
              }],
              cycleSpeed: 0.5,
              fps: 24,
              brushSize: 8,
              ditherEnabled: true,
              ditherStrength: 1,
              ditherPixelSize: 38,
              perceptualDither: false,
            },
          },
        }],
        customBrushes: [],
        defaultCustomBrushId: null,
        brushSpecificSettings: {},
        globalBrushSize: 1,
      },
    }));

    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            paintBuffer: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            gradientDefIdBuffer?: ArrayBuffer;
            speedBuffer?: ArrayBuffer;
            flowBuffer?: ArrayBuffer;
            phaseBuffer?: ArrayBuffer;
            hasContent: boolean;
          } | null;
          serialize?: () => {
            ditherEnabled?: boolean;
            ditherStrength?: number;
            ditherPixelSize?: number;
            perceptualDither?: boolean;
          };
        }
      | undefined;

    const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);
    const restoredState = restoredBrush?.serialize?.();
    expect(snapshot).toBeTruthy();
    expect(snapshot?.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotPaint));
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotGradientIds));
    expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotDefs));
    expect(Array.from(new Uint8Array(snapshot?.speedBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotSpeed));
    expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotFlow));
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(snapshotPhase));
    expect(restoredLayer.colorCycleData?.brushState).toEqual(
      restored.layers[0]?.colorCycleData?.brushState,
    );
    expect(restoredState?.ditherEnabled).toBe(true);
    expect(restoredState?.ditherStrength).toBe(1);
    expect(restoredState?.ditherPixelSize).toBe(38);
    expect(restoredState?.perceptualDither).toBe(false);
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeTruthy();
  });

  it('keeps oversized duplicated legacy snapshots on the persisted-buffer fast path', async () => {
    const width = 3;
    const height = 3;
    const gradientIds = new Uint8Array(width * height);
    gradientIds[2] = 5;
    gradientIds[7] = 9;
    const oversizedBase64 = 'A'.repeat(33 * 1024 * 1024);

    const restored = await deserializeProject(JSON.stringify({
      version: '1.0.0',
      metadata: {
        name: 'oversized-legacy-cc',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-oversized-legacy-cc',
        name: 'oversized-legacy-cc',
        width,
        height,
        backgroundColor: '#000000',
        layers: [{
          id: 'layer-cc-oversized-legacy-brush-state',
          name: 'CC Oversized Legacy Brush State',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageDataUrl: '',
          alignment: createDefaultLayerAlignment(),
          layerType: 'color-cycle',
          version: 1,
          colorCycleData: {
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(width, height, [120, 40, 200, 255])),
            canvasWidth: width,
            canvasHeight: height,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            gradientIdBuffer: Buffer.from(gradientIds).toString('base64'),
            isAnimating: false,
            mode: 'brush',
            brushState: {
              layers: [{
                layerId: 'layer-cc-oversized-legacy-brush-state',
                strokeData: {
                  paintBuffer: oversizedBase64,
                  gradientIdBuffer: oversizedBase64,
                  hasContent: true,
                  strokeCounter: 1,
                },
                animator: {
                  indexBuffer: {
                    width,
                    height,
                    data: oversizedBase64,
                    gradientId: oversizedBase64,
                    palette: ['#000000', '#ffffff'],
                  },
                  gradient: {
                    gradientStops: [
                      { position: 0, color: '#000000' },
                      { position: 1, color: '#ffffff' },
                    ],
                  },
                  animation: {
                    offset: 0,
                    stats: {
                      targetFPS: 24,
                      actualFPS: 24,
                      frameCount: 1,
                      totalTime: 0,
                      averageFrameTime: 0,
                      isAnimating: false,
                    },
                  },
                },
              }],
              cycleSpeed: 0.5,
              fps: 24,
              brushSize: 8,
              ditherEnabled: true,
              ditherStrength: 1,
              ditherPixelSize: 38,
              perceptualDither: false,
            },
          },
        }],
        customBrushes: [],
        defaultCustomBrushId: null,
        brushSpecificSettings: {},
        globalBrushSize: 1,
      },
    }));

    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            gradientIdBuffer?: ArrayBuffer;
            hasContent: boolean;
          } | null;
        }
      | undefined;
    const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);

    expect(snapshot).toBeTruthy();
    expect(snapshot?.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      Array.from(gradientIds),
    );
    expect(restoredLayer.colorCycleData?.brushState).toEqual({
      layers: [{
        layerId: 'layer-cc-oversized-legacy-brush-state',
        animator: {
          indexBuffer: {
            width,
            height,
            data: undefined,
            gradientId: undefined,
            speedData: undefined,
            flowData: undefined,
            phaseData: undefined,
            palette: ['#000000', '#ffffff'],
          },
          gradient: {
            gradientStops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          },
          animation: {
            offset: 0,
            stats: {
              targetFPS: 24,
              actualFPS: 24,
              frameCount: 1,
              totalTime: 0,
              averageFrameTime: 0,
              isAnimating: false,
            },
          },
        },
      }],
      cycleSpeed: 0.5,
      fps: 24,
      brushSize: 8,
      ditherEnabled: true,
      ditherStrength: 1,
      ditherPixelSize: 38,
      perceptualDither: false,
    });
  });

  it('seeds color-cycle runtime from persisted gradient buffers when brushState is missing', async () => {
    const width = 3;
    const height = 3;
    const canvasImageData = createSolidImageData(width, height, [240, 120, 60, 255]);
    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = width;
    colorCycleCanvas.height = height;
    const gradientIds = new Uint8Array(width * height);
    gradientIds[0] = 7;
    gradientIds[4] = 9;

    const layer: Layer = {
      id: 'layer-cc-persisted-gradient',
      name: 'CC Persisted Gradient',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(width, height, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: colorCycleCanvas,
        canvasImageData,
        canvasWidth: width,
        canvasHeight: height,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientIdBuffer: gradientIds.buffer.slice(0),
        isAnimating: false,
        mode: 'brush',
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([layer]);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            paintBuffer: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            hasContent: boolean;
          } | null;
        }
      | undefined;

    const snapshot = restoredBrush?.getLayerSnapshot?.(restoredLayer.id);
    expect(snapshot).toBeTruthy();
    expect(snapshot?.hasContent).toBe(true);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      Array.from(gradientIds),
    );
  });

  it('prefers live color-cycle canvas pixels over stale empty canvasImageData when saving', async () => {
    const width = 2;
    const height = 2;
    const liveCanvasImageData = createSolidImageData(width, height, [25, 200, 120, 255]);
    const staleEmptyImageData = createSolidImageData(width, height, [0, 0, 0, 0]);

    const layer: Layer = {
      id: 'layer-cc-live-canvas-wins',
      name: 'CC Live Canvas Wins',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(staleEmptyImageData),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: createCanvasFromImageData(liveCanvasImageData),
        canvasImageData: staleEmptyImageData,
        canvasWidth: width,
        canvasHeight: height,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        isAnimating: false,
        mode: 'brush',
      },
    };

    const project: Project = {
      id: 'project-cc-live-canvas-wins',
      name: 'cc-live-canvas-wins',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      defaultCustomBrushId: null,
      brushSpecificSettings: {},
      globalBrushSize: 1,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      referenceLayerId: null,
      exportLayout: undefined,
      palette: undefined,
      canvasShape: undefined,
    };

    const serialized = await serializeProject(project);
    const restored = await deserializeProject(serialized);
    const restoredImageData = restored.layers[0]?.colorCycleData?.canvasImageData ?? null;

    expect(readPixel(restoredImageData, 0, 0)).toEqual([25, 200, 120, 255]);
    expect(readPixel(restoredImageData, 1, 1)).toEqual([25, 200, 120, 255]);
  });

  it('prefers per-layer framebuffer pixels when saving', async () => {
    const red = createSolidImageData(2, 2, [255, 0, 0, 255]);
    const green = createSolidImageData(2, 2, [0, 255, 0, 255]);
    const blue = createSolidImageData(2, 2, [0, 0, 255, 255]);

    const layer1: Layer = {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: green,
      framebuffer: createCanvasFromImageData(red),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };

    const layer2: Layer = {
      id: 'layer-2',
      name: 'Layer 2',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 1,
      imageData: blue,
      framebuffer: createCanvasFromImageData(blue),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };

    const project: Project = {
      id: 'p1',
      name: 'demo',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer1, layer2],
      customBrushes: [],
      referenceLayerId: 'layer-2',
      canvasShape: {
        kind: 'circle',
        center: { x: 1, y: 1 },
        radius: 1,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const restored = await deserializeProject(payload);

    const restoredLayer1 = restored.layers[0];
    const restoredLayer2 = restored.layers[1];

    expect(readPixel(restoredLayer1.imageData, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(restoredLayer2.imageData, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(restored.canvasShape?.kind).toBe('circle');
    expect(restored.referenceLayerId).toBe('layer-2');
  });

  it('persists layer types and reference layer metadata in serialized manifest', async () => {
    const project: Project = {
      id: 'project-types',
      name: 'Layer Types Project',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [
        {
          id: 'layer-normal',
          name: 'Normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
          framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal',
          version: 1,
        },
        {
          id: 'layer-seq',
          name: 'Sequential',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 1,
          imageData: createSolidImageData(2, 2, [0, 0, 0, 0]),
          framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [0, 0, 0, 0])),
          alignment: createDefaultLayerAlignment(),
          layerType: 'sequential',
          sequentialData: {
            frameCount: 1,
            fps: 1,
            durationMs: 1,
            events: [],
          },
          version: 1,
        },
      ],
      customBrushes: [],
      referenceLayerId: 'layer-seq',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const manifest = await readProjectManifest(payload);

    expect(manifest.project.referenceLayerId).toBe('layer-seq');
    expect(manifest.project.layers.map((layer) => layer.layerType)).toEqual(['normal', 'sequential']);
  });

  it('migrates legacy flow-encoded gradient ids on load', async () => {
    const legacyGradientIds = [0, 63, 129, 194]; // slots 0, editor, 1, 2 in legacy encoding
    const gradientIdBuffer = Buffer.from(Uint8Array.from(legacyGradientIds)).toString('base64');

    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-project',
        name: 'legacy',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        layers: [
          {
            id: 'layer-cc',
            name: 'Legacy CC',
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            order: 0,
            imageDataUrl: '',
            layerType: 'color-cycle',
            colorCycleData: {
              gradientIdBuffer,
              canvasWidth: 2,
              canvasHeight: 2,
            },
          },
        ],
        customBrushes: [],
      },
    };

    const deserialized = await deserializeProject(JSON.stringify(legacyProject));
    const layer = deserialized.layers[0];
    const buffer = layer.colorCycleData?.gradientIdBuffer;
    expect(buffer).toBeDefined();
    const view = new Uint8Array(buffer as ArrayBuffer);
    expect(Array.from(view)).toEqual([0, 0, 1, 2]);
  });

  it('round-trips sequential layer capture data through serialize/deserialize', async () => {
    const sequentialLayer: Layer = {
      id: 'layer-seq',
      name: 'Sequential Layer',
      visible: true,
      opacity: 0.8,
      blendMode: 'multiply',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(4, 4, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: {
        frameCount: 24,
        fps: 12,
        durationMs: 2000,
        events: [
          {
            id: 'seq-event-1',
            layerId: 'layer-seq',
            strokeId: 'stroke-1',
            timestampMs: 250,
            frameIndex: 5,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.ROUND,
              size: 10,
              opacity: 0.7,
              blendMode: 'source-over',
              rotation: 0.15,
              spacing: 2,
              color: '#ff0000',
              pluginBrushId: 'dither-brush',
              pluginConfig: {
                ditherAlgorithm: 'pattern',
                ditherIntensity: 67,
                ditherBayerMatrixSize: 8,
              },
              ditherEnabled: true,
              ditherAlgorithm: 'pattern',
              customStampId: null,
            },
            stamps: [
              { x: 10, y: 12, pressure: 0.8, rotation: 0.1, size: 5, alpha: 0.7 },
              { x: 12, y: 14, pressure: 0.9, rotation: 0.2, size: 6, alpha: 0.7 },
            ],
          },
        ],
      },
      version: 1,
    };

    const project: Project = {
      id: 'project-seq',
      name: 'Sequential Project',
      width: 4,
      height: 4,
      backgroundColor: '#000000',
      layers: [sequentialLayer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const manifest = await readProjectManifest(payload);
    const manifestSequential = manifest.project.layers[0]?.sequentialData;
    expect(Array.isArray(manifestSequential?.chunks)).toBe(true);
    expect((manifestSequential?.chunks ?? []).length).toBeGreaterThan(0);
    expect(manifestSequential?.brushSnapshots).toBeDefined();

    const restored = await deserializeProject(payload);
    const restoredLayer = restored.layers[0];

    expect(restoredLayer.layerType).toBe('sequential');
    expect(restoredLayer.sequentialData).toEqual(sequentialLayer.sequentialData);
    const restoredEvent = restoredLayer.sequentialData?.events[0];
    expect(restoredEvent?.brush.pluginBrushId).toBe('dither-brush');
    expect(restoredEvent?.brush.pluginConfig).toEqual({
      ditherAlgorithm: 'pattern',
      ditherIntensity: 67,
      ditherBayerMatrixSize: 8,
    });
    expect(restoredEvent?.brush.ditherEnabled).toBe(true);
    expect(restoredEvent?.brush.ditherAlgorithm).toBe('pattern');
  });

  it('sanitizes invalid sequential payloads on load', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-seq',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-seq-project',
        name: 'legacy-seq',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        layers: [
          {
            id: 'layer-seq',
            name: 'Legacy Sequential',
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            order: 0,
            imageDataUrl: '',
            layerType: 'sequential',
            sequentialData: {
              frameCount: 0,
              fps: 0,
              durationMs: 0,
              events: null,
            },
          },
        ],
        customBrushes: [],
      },
    };

    const restored = await deserializeProject(JSON.stringify(legacyProject));
    const restoredLayer = restored.layers[0];

    expect(restoredLayer.layerType).toBe('sequential');
    expect(restoredLayer.sequentialData).toEqual({
      frameCount: 1,
      fps: 1,
      durationMs: 1,
      events: [],
    });
  });

  it('restores sequential events from chunk payload when events are missing', async () => {
    const sourceSequential: NonNullable<Layer['sequentialData']> = {
      frameCount: 12,
      fps: 12,
      durationMs: 1000,
      events: [
        {
          id: 'seq-event-chunk',
          layerId: 'layer-seq',
          strokeId: 'stroke-chunk',
          timestampMs: 120,
          frameIndex: 4,
          brush: {
              tool: 'brush',
              brushShape: BrushShape.ROUND,
              size: 8,
              opacity: 1,
              blendMode: 'source-over' as const,
              rotation: 0,
              spacing: 1,
              color: '#ff00ff',
              customStampId: null,
          },
          stamps: [{ x: 5, y: 7, pressure: 0.9, rotation: 0.2, size: 6.5, alpha: 0.8 }],
        },
      ],
    };

    const seedProject: Project = {
      id: 'project-seq-chunk',
      name: 'Sequential Chunk Seed',
      width: 8,
      height: 8,
      backgroundColor: '#000000',
      layers: [
        {
          id: 'layer-seq',
          name: 'Sequential Layer',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageData: null,
          framebuffer: createCanvasFromImageData(createSolidImageData(8, 8, [0, 0, 0, 0])),
          alignment: createDefaultLayerAlignment(),
          layerType: 'sequential',
          sequentialData: sourceSequential,
          version: 1,
        },
      ],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(seedProject);
    const manifest = await readProjectManifest(payload);
    const manifestLayer = manifest.project.layers[0];
    if (!manifestLayer?.sequentialData) {
      throw new Error('Missing sequential data in serialized manifest');
    }

    manifestLayer.sequentialData = {
      ...manifestLayer.sequentialData,
      events: null,
    };

    const restored = await deserializeProject(JSON.stringify(manifest));
    const restoredLayer = restored.layers[0];
    expect(restoredLayer.layerType).toBe('sequential');
    const restoredEvents = restoredLayer.sequentialData?.events ?? [];
    expect(restoredEvents).toHaveLength(1);
    expect(restoredEvents[0].id).toBe('seq-event-chunk');
    expect(restoredEvents[0].frameIndex).toBe(4);
    expect(restoredEvents[0].timestampMs).toBe(120);
    expect(restoredEvents[0].stamps[0].x).toBe(5);
    expect(restoredEvents[0].stamps[0].y).toBe(7);
    expect(restoredEvents[0].stamps[0].size).toBeCloseTo(6.5, 3);
    expect(restoredEvents[0].stamps[0].alpha).toBeCloseTo(0.8, 2);
    expect(restoredEvents[0].stamps[0].pressure).toBeCloseTo(0.9, 2);
    expect(restoredEvents[0].stamps[0].rotation).toBeCloseTo(0.2, 3);
  });

  it('round-trips layer groups and layer group memberships', async () => {
    const layerA: Layer = {
      id: 'layer-a',
      name: 'Layer A',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      groupId: 'group-1',
      version: 1,
    };
    const layerB: Layer = {
      ...layerA,
      id: 'layer-b',
      name: 'Layer B',
      groupId: 'group-1',
      order: 1,
      imageData: createSolidImageData(2, 2, [0, 255, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [0, 255, 0, 255])),
    };

    const project: Project = {
      id: 'project-groups',
      name: 'Group Project',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layerA, layerB],
      layerGroups: [{ id: 'group-1', name: 'Foreground' }],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const restored = await deserializeProject(payload);

    expect(restored.layerGroups).toEqual([{ id: 'group-1', name: 'Foreground' }]);
    expect(restored.layers.find((layer) => layer.id === 'layer-a')?.groupId).toBe('group-1');
    expect(restored.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
  });

  it('defaults missing layer group metadata for legacy project payloads', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-groups',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-groups-project',
        name: 'legacy-groups',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        layers: [
          {
            id: 'layer-a',
            name: 'Layer A',
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            order: 0,
            imageDataUrl: '',
            layerType: 'normal',
          },
        ],
        customBrushes: [],
      },
    };

    const restored = await deserializeProject(JSON.stringify(legacyProject));
    expect(restored.layerGroups).toEqual([]);
    expect(restored.layers[0]?.groupId).toBeUndefined();
  });

  it('round-trips custom brush color-cycle payload through serialize/deserialize', async () => {
    const brushImageData = createSolidImageData(3, 2, [12, 34, 56, 255]);
    const layer: Layer = {
      id: 'layer-basic',
      name: 'Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };

    const project: Project = {
      id: 'project-custom-cc',
      name: 'Custom Brush CC',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [
        {
          id: 'brush-cc',
          name: 'CC Brush',
          imageData: brushImageData,
          thumbnail: '',
          width: 3,
          height: 2,
          createdAt: 1700000000000,
          naturalWidth: 3,
          naturalHeight: 2,
          maxDimension: 3,
          colorCycle: {
            schemaVersion: 1,
            source: 'color-cycle-layer',
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            speed: 0.4,
            phaseMode: 'jittered',
            phaseJitter: 0.2,
          },
        },
      ],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const restored = await deserializeProject(payload);
    const restoredBrush = restored.customBrushes[0];
    expect(restoredBrush?.id).toBe('brush-cc');
    expect(restoredBrush?.colorCycle).toEqual({
      schemaVersion: 1,
      source: 'color-cycle-layer',
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      speed: 0.4,
      phaseMode: 'jittered',
      phaseJitter: 0.2,
    });
  });

  it('round-trips schema v2 custom brush captured payload through serialize/deserialize', async () => {
    const brushImageData = createSolidImageData(2, 2, [12, 34, 56, 255]);
    const layer: Layer = {
      id: 'layer-basic-v2',
      name: 'Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };

    const project: Project = {
      id: 'project-custom-cc-v2',
      name: 'Custom Brush CC V2',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [
        {
          id: 'brush-cc-v2',
          name: 'CC Brush V2',
          imageData: brushImageData,
          thumbnail: '',
          width: 2,
          height: 2,
          createdAt: 1700000000000,
          naturalWidth: 2,
          naturalHeight: 2,
          maxDimension: 2,
          colorCycle: {
            schemaVersion: 2,
            mode: 'captured-data',
            source: 'color-cycle-layer',
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            speed: 0.4,
            phaseMode: 'global',
            phaseJitter: 0,
            sourceCycleLength: 256,
            mapWidth: 2,
            mapHeight: 2,
            phaseMap: new Uint16Array([0, 64, 128, 255]),
            indexMap: new Uint16Array([1, 2, 3, 4]),
            alphaMask: new Uint8Array([255, 128, 64, 0]),
          },
        },
      ],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const restored = await deserializeProject(payload);
    const restoredBrush = restored.customBrushes[0];
    const cc = restoredBrush?.colorCycle;

    expect(cc?.schemaVersion).toBe(2);
    if (!cc || cc.schemaVersion !== 2) {
      throw new Error('Expected schema v2 color cycle payload');
    }
    expect(cc.mode).toBe('captured-data');
    expect(cc.mapWidth).toBe(2);
    expect(cc.mapHeight).toBe(2);
    expect(Array.from(cc.phaseMap ?? [])).toEqual([0, 64, 128, 255]);
    expect(Array.from(cc.indexMap ?? [])).toEqual([1, 2, 3, 4]);
    expect(Array.from(cc.alphaMask ?? [])).toEqual([255, 128, 64, 0]);
  });
});

describe('projectIO saveProjectToFile', () => {
  it('uses atomic writable creation for handle saves', async () => {
    const layer: Layer = {
      id: 'layer-save-atomic',
      name: 'Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(2, 2, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };
    const project: Project = {
      id: 'project-save-atomic',
      name: 'Save Atomic',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const writable = {
      write: jest.fn().mockResolvedValue(undefined),
      truncate: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      abort: jest.fn().mockResolvedValue(undefined),
    };
    const handle = {
      name: 'atomic.vs',
      createWritable: jest.fn().mockResolvedValue(writable),
    } as unknown as FileSystemFileHandle;

    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }

    try {
      await saveProjectToFile(project, 'atomic.vs', project.layers, handle);
      expect((handle as unknown as { createWritable: jest.Mock }).createWritable).toHaveBeenCalledWith();
      expect(writable.write).toHaveBeenCalledTimes(1);
      expect(writable.truncate).toHaveBeenCalledTimes(1);
      expect(writable.close).toHaveBeenCalledTimes(1);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });
});
