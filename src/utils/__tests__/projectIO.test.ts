import JSZip from 'jszip';

jest.mock('@/utils/debug', () => ({
  ...jest.requireActual('@/utils/debug'),
  debugWarn: jest.fn(),
}));

import { debugWarn } from '@/utils/debug';
import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import {
  analyzeProjectArchiveRefs,
  deserializeProject,
  deserializeProjectWithReport,
  getProjectSaveSizeReport,
  readProjectHealthReport,
  readProjectManifest,
  readProjectPreviewManifest,
  repairDanglingColorCycleArchiveRefs,
  restoreColorCycleBrushes,
  saveProjectToFile,
  serializeProject
} from '@/utils/projectIO';
import {
  getUnexpectedColorCycleStateFields,
  getUnexpectedModernColorCycleDataFields,
  fnv1aHash,
  inferBinaryManifestDType,
} from '@/utils/projectPersistence';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { BrushShape, type Layer, type Project } from '@/types';

jest.setTimeout(20000);

const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

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

const LARGE_PROJECT_IMPORT_BUDGET_MS = 2500;
const LARGE_PROJECT_LAZY_HYDRATION_BUDGET_MS = 1500;

const withPatchedCanvasRect = async <T>(run: () => Promise<T>): Promise<T> => {
  const contextProto = (globalThis as unknown as {
    CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
  }).CanvasRenderingContext2D?.prototype;
  const originalRect = contextProto?.rect;

  if (contextProto && typeof contextProto.rect !== 'function') {
    contextProto.rect = () => {};
  }

  try {
    return await run();
  } finally {
    if (contextProto) {
      contextProto.rect = originalRect;
    }
  }
};

const createBenchmarkColorCycleLayer = (
  index: number,
  width: number,
  height: number,
  visible: boolean,
): Layer => {
  const pixelCount = width * height;
  const paint = new Uint8Array(pixelCount);
  const gradientId = new Uint8Array(pixelCount);
  const speed = new Uint8Array(pixelCount);
  const flow = new Uint8Array(pixelCount);
  const phase = new Uint8Array(pixelCount);
  const gradientDefIds = new Uint16Array(pixelCount);
  const gradientDefId = index + 1;

  paint.fill((index % 7) + 1);
  gradientId.fill((index % 11) + 1);
  speed.fill((index % 5) + 1);
  flow.fill(index % 2);
  phase.fill(index % 13);
  gradientDefIds.fill(gradientDefId);

  const brushCanvas = document.createElement('canvas');
  brushCanvas.width = width;
  brushCanvas.height = height;
  const brush = new ColorCycleBrushCanvas2D(brushCanvas, { brushSize: 6, fps: 24 });
  const layerId = `benchmark-cc-${index}`;

  brush.applyLayerSnapshot(layerId, {
    paintBuffer: paint.buffer.slice(0),
    gradientIdBuffer: gradientId.buffer.slice(0),
    gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
    speedBuffer: speed.buffer.slice(0),
    flowBuffer: flow.buffer.slice(0),
    phaseBuffer: phase.buffer.slice(0),
    hasContent: true,
    strokeCounter: index + 1,
  });

  return {
    id: layerId,
    name: `Benchmark CC ${index}`,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: index,
    imageData: null,
    framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
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
        id: gradientDefId,
        kind: 'linear',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        hash: `benchmark-def-${gradientDefId}`,
        source: 'manual',
        createdAtMs: gradientDefId,
      }],
      mode: 'brush',
      colorCycleBrush: brush as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
    },
  };
};

const createBenchmarkRasterLayer = (index: number, width: number, height: number): Layer => {
  const imageData = createSolidImageData(width, height, [
    (index * 37) % 255,
    (index * 59) % 255,
    (index * 83) % 255,
    255,
  ]);

  return {
    id: `benchmark-raster-${index}`,
    name: `Benchmark Raster ${index}`,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 100 + index,
    imageData,
    framebuffer: createCanvasFromImageData(imageData),
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    version: 1,
  };
};

const createLargeProjectBenchmarkFixture = async (): Promise<{
  payload: Uint8Array;
  totalLayerCount: number;
}> => withPatchedCanvasRect(async () => {
  const width = 128;
  const height = 128;
  const colorCycleLayers = Array.from({ length: 12 }, (_, index) =>
    createBenchmarkColorCycleLayer(index, width, height, index === 0),
  );
  const rasterLayers = Array.from({ length: 6 }, (_, index) =>
    createBenchmarkRasterLayer(index, width, height),
  );
  const layers = [...colorCycleLayers, ...rasterLayers];
  const project: Project = {
    id: 'project-large-import-benchmark',
    name: 'Large Import Benchmark',
    width,
    height,
    backgroundColor: '#000000',
    layers,
    customBrushes: [],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  return {
    payload: await serializeProject(project, layers),
    totalLayerCount: layers.length,
  };
});

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

  it('builds a health report from manifest-only project data', async () => {
    const zipped = await zipWithProjectJson();
    const report = await readProjectHealthReport(zipped);

    expect(report.archiveBytes).toBe(zipped.byteLength);
    expect(report.projectManifestBytes).toBeGreaterThan(0);
    expect(report.binaryPayloadBytes).toBe(0);
    expect(report.colorCycleDuplicationRiskLayers).toEqual([]);
    expect(report.unresolvedColorCycleDefLayers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.primaryWarning).toBeNull();
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

  it('rejects layer envelopes that mix layer families', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-1',
          name: 'bad layer',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
          colorCycleData: {},
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Invalid Vessel project layer envelope for layer-1',
    );
  });

  it('rejects archive refs that are missing from the binary manifest', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          colorCycleData: {
            gradientIdBuffer: 'zip:buffers/color-cycle/layer-cc/gradient-id.bin',
          },
        }],
      },
      binaries: {
        entries: [],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Project archive manifest is missing binary entry buffers/color-cycle/layer-cc/gradient-id.bin',
    );
  });

  it('repairs missing binary manifest entries from zip-backed archives during read', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 2, height: 2 },
            gradientDefStore: [],
            paintRef: 'zip:buffers/color-cycle/layer-cc/paint.bin',
          },
          colorCycleData: {
            canvasWidth: 2,
            canvasHeight: 2,
          },
        }],
      },
      binaries: {
        entries: [],
      },
    }));
    zip.file('buffers/color-cycle/layer-cc/paint.bin', new Uint8Array([1, 2, 3, 4]));

    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const manifest = await readProjectManifest(payload);
    const report = await readProjectHealthReport(payload);

    expect(manifest.binaries?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'buffers/color-cycle/layer-cc/paint.bin',
        byteLength: 4,
        dtype: 'uint8',
      }),
    ]));
    expect(report.warnings).toEqual([]);
  });

  it('rejects missing canonical color-cycle stroke buffers from zip-backed archives', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 2, height: 2 },
            gradientDefStore: [],
            paintRef: 'zip:buffers/color-cycle/layer-cc/paint.bin',
          },
          colorCycleData: {
            canvasWidth: 2,
            canvasHeight: 2,
          },
        }],
      },
      binaries: {
        entries: [],
      },
    }));

    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(readProjectManifest(payload)).rejects.toThrow(
      'Project archive manifest is missing binary entry buffers/color-cycle/layer-cc/paint.bin',
    );
    await expect(readProjectHealthReport(payload)).rejects.toThrow(
      'Project archive manifest is missing binary entry buffers/color-cycle/layer-cc/paint.bin',
    );
    await expect(deserializeProjectWithReport(payload)).rejects.toThrow(
      'Project archive manifest is missing binary entry buffers/color-cycle/layer-cc/paint.bin',
    );
  });

  it('analyzes and explicitly repairs C4-style dangling canonical color-cycle refs', async () => {
    const zip = new JSZip();
    const canvasImage = 'data:image/png;base64,preview';
    const canvasImageBytes = new TextEncoder().encode(canvasImage);
    const projectJson = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        width: 2,
        height: 2,
        layers: [{
          id: 'layer-cc',
          name: 'cc damaged',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 2, height: 2 },
            paintRef: 'zip:buffers/color-cycle/layer-cc/paint.bin',
            speedRef: 'zip:buffers/color-cycle/layer-cc/speed.bin',
            flowRef: 'zip:buffers/color-cycle/layer-cc/flow.bin',
            gradientIdRef: 'zip:buffers/color-cycle/layer-cc/gradient-id.bin',
            gradientDefIdRef: 'zip:buffers/color-cycle/layer-cc/gradient-def-id.bin',
            hasContent: true,
            strokeCounter: 0,
          },
          colorCycleData: {
            canvasImageData: 'zip:buffers/color-cycle/layer-cc/canvas-image.txt',
          },
        }],
      },
      binaries: {
        entries: [
          {
            version: 1,
            path: 'buffers/color-cycle/layer-cc/canvas-image.txt',
            checksum: fnv1aHash(canvasImageBytes),
            byteLength: canvasImageBytes.byteLength,
            dtype: 'unknown',
            compression: 'deflate',
          },
        ],
      },
    };

    zip.file('project.json', JSON.stringify(projectJson));
    zip.file('buffers/color-cycle/layer-cc/canvas-image.txt', canvasImage);
    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    await expect(readProjectManifest(payload)).rejects.toThrow(
      'Project archive manifest is missing binary entry buffers/color-cycle/layer-cc/paint.bin',
    );

    const analysis = await analyzeProjectArchiveRefs(payload);
    expect(analysis.missingCanonicalColorCycleRefs.map((issue) => issue.path)).toEqual([
      'buffers/color-cycle/layer-cc/paint.bin',
      'buffers/color-cycle/layer-cc/speed.bin',
      'buffers/color-cycle/layer-cc/flow.bin',
      'buffers/color-cycle/layer-cc/gradient-id.bin',
      'buffers/color-cycle/layer-cc/gradient-def-id.bin',
    ]);
    expect(analysis.canRepairDanglingColorCycleRefs).toBe(true);

    const repaired = await repairDanglingColorCycleArchiveRefs(payload);
    expect(repaired.report.repairedLayerIds).toEqual(['layer-cc']);
    expect(repaired.report.removedRefs.map((entry) => entry.path)).toEqual([
      'buffers/color-cycle/layer-cc/paint.bin',
      'buffers/color-cycle/layer-cc/speed.bin',
      'buffers/color-cycle/layer-cc/flow.bin',
      'buffers/color-cycle/layer-cc/gradient-id.bin',
      'buffers/color-cycle/layer-cc/gradient-def-id.bin',
    ]);

    const repairedAnalysis = await analyzeProjectArchiveRefs(repaired.archiveData);
    expect(repairedAnalysis.issues).toEqual([]);
    const repairedManifest = await readProjectManifest(repaired.archiveData);
    expect(repairedManifest.project.layers[0]?.layerType).toBe('color-cycle');
    expect(repairedManifest.project.layers[0]?.colorCycleData?.repairStatus).toEqual(
      expect.objectContaining({
        ok: false,
        reason: 'missing-paint-buffer',
      }),
    );
  });

  it('refuses to save dangling canonical color-cycle archive refs', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const colorCycleLayer: Layer = {
      id: 'layer-cc-stale-save',
      name: 'Stale CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        canvasWidth: 2,
        canvasHeight: 2,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-cc-stale-save',
            canonicalPaint: true,
            schemaVersion: 1,
            strokeData: {
              paintBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/paint.bin',
              speedBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/speed.bin',
              flowBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/flow.bin',
              phaseBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/phase.bin',
              gradientIdBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/gradient-id.bin',
              gradientDefIdBuffer: 'zip:buffers/color-cycle/layer-cc-stale-save/gradient-def-id.bin',
              hasContent: true,
              strokeCounter: 1,
            },
          }],
        },
      },
    } as Layer;
    const project: Project = {
      id: 'project-stale-save',
      name: 'Stale Save',
      width: 2,
      height: 2,
      backgroundColor: 'transparent',
      layers: [colorCycleLayer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    await expect(withPatchedCanvasRect(() => serializeProject(project, project.layers))).rejects.toThrow(
      'Project save produced dangling archive ref buffers/color-cycle/layer-cc-stale-save/paint.bin',
    );
  });

  it('drops dangling optional color-cycle runtime refs when the archive payload is gone', async () => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 2, height: 2 },
            gradientDefStore: [],
          },
          colorCycleData: {
            canvasWidth: 2,
            canvasHeight: 2,
            canvasImageData: 'zip:buffers/color-cycle/layer-cc/canvas-image.txt',
          },
        }],
      },
      binaries: {
        entries: [],
      },
    }));

    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const manifest = await readProjectManifest(payload);
    const report = await readProjectHealthReport(payload);
    const deserialized = await deserializeProjectWithReport(payload);

    expect(manifest.project.layers[0]?.colorCycleData?.canvasImageData).toBeUndefined();
    expect(report.warnings).toEqual([]);
    expect(deserialized.project.layers[0]?.layerType).toBe('color-cycle');
  });

  it('rejects dual-authority color-cycle state when canonical fields also remain on colorCycleData', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            gradientDefStore: [],
            gradientIdRef: 'zip:buffers/color-cycle/layer-cc/gradient-id.bin',
          },
          colorCycleData: {
            gradientDefStore: [],
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/color-cycle/layer-cc/gradient-id.bin',
          checksum: 'deadbeef',
          byteLength: 100,
          dtype: 'uint8',
          width: 10,
          height: 10,
          compression: 'deflate',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Dual-authority color-cycle layer payload detected for layer-cc',
    );
  });

  it('rejects dual-authority color-cycle state when canonical runtime refs also remain in brushState', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            gradientDefStore: [],
            flowRef: 'zip:buffers/color-cycle/layer-cc/flow.bin',
          },
          colorCycleData: {
            brushState: {
              layers: [{
                layerId: 'layer-cc',
                strokeData: {
                  flowBuffer: 'zip:buffers/color-cycle/layer-cc/legacy-flow.bin',
                },
              }],
            },
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/color-cycle/layer-cc/flow.bin',
          checksum: 'deadbeef',
          byteLength: 100,
          dtype: 'uint8',
          width: 10,
          height: 10,
          compression: 'deflate',
        }, {
          version: 1,
          path: 'buffers/color-cycle/layer-cc/legacy-flow.bin',
          checksum: 'beadfeed',
          byteLength: 100,
          dtype: 'uint8',
          width: 10,
          height: 10,
          compression: 'deflate',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Dual-authority color-cycle layer payload detected for layer-cc',
    );
  });

  it('rejects binary manifest entries with invalid checksum format', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-normal',
          name: 'normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            imageRef: 'zip:buffers/raster/layer-normal/image.json',
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/raster/layer-normal/image.json',
          checksum: 'not-hex',
          byteLength: 12,
          dtype: 'json',
          width: 10,
          height: 10,
          compression: 'deflate',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Invalid Vessel project binary manifest',
    );
  });

  it('rejects binary manifest entries with invalid dtype', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-normal',
          name: 'normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            imageRef: 'zip:buffers/raster/layer-normal/image.json',
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/raster/layer-normal/image.json',
          checksum: 'deadbeef',
          byteLength: 12,
          dtype: 'float32',
          width: 10,
          height: 10,
          compression: 'deflate',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Invalid Vessel project binary manifest',
    );
  });

  it('rejects binary manifest entries with invalid compression', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-normal',
          name: 'normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            imageRef: 'zip:buffers/raster/layer-normal/image.json',
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/raster/layer-normal/image.json',
          checksum: 'deadbeef',
          byteLength: 12,
          dtype: 'json',
          width: 10,
          height: 10,
          compression: 'brotli',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Invalid Vessel project binary manifest',
    );
  });

  it('rejects unexpected color-cycle state fields in modern manifests', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            gradientDefStore: [],
            isAnimating: true,
          },
          colorCycleData: {},
        }],
      },
      binaries: {
        entries: [],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Unexpected color-cycle state fields for layer-cc: isAnimating',
    );
  });

  it('rejects unexpected color-cycle data fields in modern manifests', async () => {
    const invalidEnvelope = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
          },
          colorCycleData: {
            fgDerivedKey: 'legacy-fg',
          },
        }],
      },
      binaries: {
        entries: [],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidEnvelope))).rejects.toThrow(
      'Unexpected color-cycle data fields for layer-cc: fgDerivedKey',
    );
  });

  it('recovers missing stamp-dither metadata from project brush settings for legacy-compatible CC loads', async () => {
    const payload = JSON.stringify({
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        brushSpecificSettings: {
          'color-cycle-stroke': {
            colorCycleStampDitherEnabled: true,
            colorCycleStampDitherPixelSize: 9,
            colorCycleStampDitherBgFill: false,
            colorCycleStampDitherPressureLinked: true,
            colorCycleStampShape: 'checkered',
            ditherAlgorithm: 'pattern',
            patternStyle: 'crosshatch',
            pxlEdge: true,
          },
        },
        layers: [{
          id: 'layer-cc',
          name: 'cc',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            dither: {
              enabled: false,
              strength: 0,
              pixelSize: 6,
              perceptual: false,
            },
          },
          colorCycleData: {},
        }],
      },
      binaries: {
        entries: [],
      },
    });

    const restored = await deserializeProject(payload);
    const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
    const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
      | {
          serialize?: () => {
            stampShape?: string;
            stampDitherEnabled?: boolean;
            stampDitherPixelSize?: number;
            stampDitherAlgorithm?: string;
            stampDitherPatternStyle?: string;
            stampDitherBgFill?: boolean;
            stampDitherClears?: boolean;
            stampDitherPressureLinked?: boolean;
            pxlEdgeEnabled?: boolean;
          };
        }
      | undefined;
    const restoredState = restoredBrush?.serialize?.();

    expect(restoredState?.stampShape).toBe('checkered');
    expect(restoredState?.stampDitherEnabled).toBe(true);
    expect(restoredState?.stampDitherPixelSize).toBe(9);
    expect(restoredState?.stampDitherAlgorithm).toBe('pattern');
    expect(restoredState?.stampDitherPatternStyle).toBe('crosshatch');
    expect(restoredState?.stampDitherBgFill).toBe(false);
    expect(restoredState?.stampDitherClears).toBe(true);
    expect(restoredState?.stampDitherPressureLinked).toBe(true);
    expect(restoredState?.pxlEdgeEnabled).toBe(true);
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
  it('writes binary manifest entries that match the actual archive payloads', async () => {
    const rasterLayer: Layer = {
      id: 'layer-binary-raster',
      name: 'Binary Raster',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(3, 2, [255, 0, 0, 255]),
      framebuffer: createCanvasFromImageData(createSolidImageData(3, 2, [255, 0, 0, 255])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      version: 1,
    };

    const sequentialLayer: Layer = {
      id: 'layer-binary-seq',
      name: 'Binary Sequential',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 1,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(3, 2, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: {
        frameCount: 2,
        fps: 12,
        durationMs: 167,
        events: [
          {
            id: 'seq-binary-event',
            layerId: 'layer-binary-seq',
            strokeId: 'stroke-binary',
            timestampMs: 40,
            frameIndex: 1,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.ROUND,
              size: 4,
              opacity: 1,
              blendMode: 'source-over',
              rotation: 0,
              spacing: 1,
              color: '#ffffff',
              customStampId: null,
            },
            stamps: [{ x: 1, y: 1, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
          },
        ],
      },
      version: 1,
    };

    const project: Project = {
      id: 'project-binary-integrity',
      name: 'Binary Integrity',
      width: 3,
      height: 2,
      backgroundColor: '#000000',
      layers: [rasterLayer, sequentialLayer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const manifest = await readProjectManifest(payload);
    const zip = await JSZip.loadAsync(payload);

    const binaryEntries = manifest.binaries?.entries ?? [];
    expect(binaryEntries.length).toBeGreaterThan(0);

    for (const entry of binaryEntries) {
      const archiveFile = zip.file(entry.path);
      const normalizedEntry = Array.isArray(archiveFile) ? archiveFile[0] ?? null : archiveFile;
      expect(normalizedEntry).toBeTruthy();
      const bytes = await normalizedEntry!.async('uint8array');
      expect(entry.byteLength).toBe(bytes.byteLength);
      expect(entry.checksum).toBe(fnv1aHash(bytes));
      expect(entry.dtype).toBe(inferBinaryManifestDType(entry.path));
    }
  });

  it('rejects corrupted archived text payloads that no longer match the manifest checksum', async () => {
    const rasterLayer: Layer = {
      id: 'layer-raster-corrupt',
      name: 'Raster Corrupt',
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
      id: 'project-raster-corrupt',
      name: 'Raster Corrupt',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      layers: [rasterLayer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const zip = await JSZip.loadAsync(payload);
    const imageEntry = zip.file('buffers/raster/layer-raster-corrupt/image.json');
    const normalizedImageEntry = Array.isArray(imageEntry) ? imageEntry[0] ?? null : imageEntry;
    const originalImageJson = await normalizedImageEntry?.async('string');
    expect(originalImageJson).toBeTruthy();
    const corruptedImageJson = `${'x'.repeat(Math.max((originalImageJson?.length ?? 1) - 1, 0))}!`;
    zip.file('buffers/raster/layer-raster-corrupt/image.json', corruptedImageJson);

    const corruptedPayload = await zip.generateAsync({ type: 'uint8array' });

    await expect(deserializeProjectWithReport(corruptedPayload)).rejects.toThrow(
      'Project archive binary checksum mismatch for buffers/raster/layer-raster-corrupt/image.json',
    );
  });

  it('rejects corrupted archived binary payloads that no longer match the manifest byte length', async () => {
    const colorCycleLayer = createBenchmarkColorCycleLayer(7, 4, 4, true);
    const project: Project = {
      id: 'project-cc-corrupt',
      name: 'CC Corrupt',
      width: 4,
      height: 4,
      backgroundColor: '#000000',
      layers: [colorCycleLayer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await withPatchedCanvasRect(() => serializeProject(project));
    const zip = await JSZip.loadAsync(payload);
    zip.file('buffers/color-cycle/benchmark-cc-7/paint.bin', Uint8Array.from([1, 2, 3]));

    const corruptedPayload = await zip.generateAsync({ type: 'uint8array' });

    await expect(deserializeProjectWithReport(corruptedPayload)).rejects.toThrow(
      'Project archive binary length mismatch for buffers/color-cycle/benchmark-cc-7/paint.bin',
    );
  });

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
      expect(report.binaryPayloadBytes).toBeGreaterThan(0);
      expect(report.colorCycleDuplicationRiskLayers).toEqual([]);
      expect(report.unresolvedColorCycleDefLayers).toEqual([]);
      expect(report.sectionBreakdown.find((section) => section.name === 'layers')?.bytes ?? 0).toBeGreaterThan(0);
      expect(report.sectionBreakdown.find((section) => section.name === 'binaryPayload')?.bytes ?? 0).toBeGreaterThan(0);
      expect(report.largestLayers.length).toBeGreaterThan(0);
      expect(report.largestLayers.map((layer) => layer.layerId)).toEqual(
        expect.arrayContaining(['layer-report-a', 'layer-report-b']),
      );
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
            state?: {
              paintRef?: string;
              speedRef?: string;
              flowRef?: string;
              phaseRef?: string;
            };
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
      expect(persistedLayer?.strokeData?.paintBuffer).toBeUndefined();
      expect(persistedLayer?.strokeData?.gradientIdBuffer).toBeUndefined();
      expect(persistedLayer?.strokeData?.gradientDefIdBuffer).toBeUndefined();
      expect(persistedLayer?.strokeData?.speedBuffer).toBeUndefined();
      expect(persistedLayer?.strokeData?.flowBuffer).toBeUndefined();
      expect(persistedLayer?.strokeData?.phaseBuffer).toBeUndefined();
      expect(manifest.project.layers[0]?.state?.paintRef).toBe('zip:buffers/color-cycle/layer-cc-compact-archive/paint.bin');
      expect(manifest.project.layers[0]?.state?.speedRef).toBe('zip:buffers/color-cycle/layer-cc-compact-archive/speed.bin');
      expect(manifest.project.layers[0]?.state?.flowRef).toBe('zip:buffers/color-cycle/layer-cc-compact-archive/flow.bin');
      expect(manifest.project.layers[0]?.state?.phaseRef).toBe('zip:buffers/color-cycle/layer-cc-compact-archive/phase.bin');
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
        gradientDefStore: [{
          id: 11,
          kind: 'linear',
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
          hash: 'def-11',
          source: 'manual',
          createdAtMs: 1,
        }],
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
            state?: {
              paintRef?: string;
              gradientIdRef?: string;
              gradientDefIdRef?: string;
              flowRef?: string;
              phaseRef?: string;
            };
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

      const persistedLayer = manifest.project.layers[0];
      expect(persistedLayer?.state?.paintRef).toBe('zip:buffers/color-cycle/layer-cc-external-buffers/paint.bin');
      expect(persistedLayer?.state?.gradientIdRef).toBe('zip:buffers/color-cycle/layer-cc-external-buffers/gradient-id.bin');
      expect(persistedLayer?.state?.gradientDefIdRef).toBe('zip:buffers/color-cycle/layer-cc-external-buffers/gradient-def-id.bin');
      expect(persistedLayer?.state?.flowRef).toBe('zip:buffers/color-cycle/layer-cc-external-buffers/flow.bin');
      expect(persistedLayer?.state?.phaseRef).toBe('zip:buffers/color-cycle/layer-cc-external-buffers/phase.bin');
      expect(persistedLayer?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.paintBuffer).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.flowBuffer).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.phaseBuffer).toBeUndefined();
      expect(zip.file('buffers/color-cycle/layer-cc-external-buffers/paint.bin')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-external-buffers/gradient-id.bin')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-external-buffers/flow.bin')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-external-buffers/phase.bin')).toBeTruthy();
      const binaryEntries = (await readProjectManifest(payload)).binaries?.entries ?? [];
      const paintEntry = binaryEntries.find((entry) => entry.path === 'buffers/color-cycle/layer-cc-external-buffers/paint.bin');
      const gradientDefEntry = binaryEntries.find((entry) => entry.path === 'buffers/color-cycle/layer-cc-external-buffers/gradient-def-id.bin');
      expect(paintEntry).toMatchObject({
        byteLength: 1,
        logicalByteLength: width * height,
        encoding: 'sparse-rect-v1',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });
      expect(gradientDefEntry).toMatchObject({
        byteLength: 2,
        logicalByteLength: width * height * 2,
        encoding: 'sparse-rect-v1',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });

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

  it('externalizes color-cycle image-like payloads into archive entries', async () => {
    const ccImageData = createSolidImageData(3, 3, [12, 34, 56, 255]);
    const eraseMaskImageData = createSolidImageData(3, 3, [0, 0, 0, 255]);
    const recolorOriginalImageData = createSolidImageData(3, 3, [200, 100, 50, 255]);
    const layer: Layer = {
      id: 'layer-cc-image-payloads',
      name: 'CC Image Payloads',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: createSolidImageData(3, 3, [0, 0, 0, 0]),
      framebuffer: createCanvasFromImageData(createSolidImageData(3, 3, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvasImageData: ccImageData,
        canvasWidth: 3,
        canvasHeight: 3,
        eraseMaskImageData,
        eraseMaskVersion: 2,
        recolorSettings: {
          quantizationMode: 'rgb332',
          ditherMode: 'bayer4',
          animation: {
            speed: 1,
            fps: 12,
            ticksPerFrame: 1,
            isPlaying: false,
            currentTick: 0,
            flowDirection: 'forward',
          },
          cycleColors: 4,
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
          indexBuffer: new Uint8Array([1, 2, 3, 4]),
          indexPhaseMap: new Uint8Array([5, 6, 7, 8]),
          phaseMap: new Uint8Array([9, 10, 11, 12]),
          currentLOD: 'full',
          originalImageData: recolorOriginalImageData,
        },
      },
    };
    const project: Project = {
      id: 'project-cc-image-payloads',
      name: 'CC Image Payloads',
      width: 3,
      height: 3,
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
      const manifest = await readProjectManifest(payload);
      const persistedLayer = manifest.project.layers[0];

      expect(persistedLayer?.colorCycleData?.canvasImageData).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/canvas-image.txt',
      );
      expect(persistedLayer?.colorCycleData?.canvasWidth).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.canvasHeight).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.eraseMaskImageData).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/erase-mask.txt',
      );
      expect(persistedLayer?.colorCycleData?.recolorSettings?.originalImageData).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/recolor-original-image.txt',
      );
      expect(persistedLayer?.colorCycleData?.recolorSettings?.indexBuffer).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/recolor-index.bin',
      );
      expect(persistedLayer?.colorCycleData?.recolorSettings?.indexPhaseMap).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/recolor-index-phase.bin',
      );
      expect(persistedLayer?.colorCycleData?.recolorSettings?.phaseMap).toBe(
        'zip:buffers/color-cycle/layer-cc-image-payloads/recolor-phase.bin',
      );
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/canvas-image.txt')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/erase-mask.txt')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/recolor-original-image.txt')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/recolor-index.bin')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/recolor-index-phase.bin')).toBeTruthy();
      expect(zip.file('buffers/color-cycle/layer-cc-image-payloads/recolor-phase.bin')).toBeTruthy();

      const restored = await deserializeProject(payload);
      const restoredLayer = restored.layers[0];
      expect(restoredLayer?.colorCycleData?.canvasImageData?.width).toBe(3);
      expect(restoredLayer?.colorCycleData?.canvasImageData?.height).toBe(3);
      expect(restoredLayer?.colorCycleData?.eraseMaskImageData?.width).toBe(3);
      expect(restoredLayer?.colorCycleData?.eraseMaskImageData?.height).toBe(3);
      expect(restoredLayer?.colorCycleData?.recolorSettings?.originalImageData?.width).toBe(3);
      expect(restoredLayer?.colorCycleData?.recolorSettings?.originalImageData?.height).toBe(3);
      expect(Array.from(restoredLayer?.colorCycleData?.recolorSettings?.indexBuffer ?? [])).toEqual([1, 2, 3, 4]);
      expect(Array.from(restoredLayer?.colorCycleData?.recolorSettings?.indexPhaseMap ?? [])).toEqual([5, 6, 7, 8]);
      expect(Array.from(restoredLayer?.colorCycleData?.recolorSettings?.phaseMap ?? [])).toEqual([9, 10, 11, 12]);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('emits a binary manifest for externalized color-cycle buffers', async () => {
    const gradientIdBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const gradientDefIdBuffer = new Uint16Array([1, 2, 3, 4]).buffer;
    const project: Project = {
      id: 'project-bin-manifest',
      name: 'Binary manifest',
      width: 2,
      height: 2,
      backgroundColor: '#000000',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      customBrushes: [],
      layers: [{
        id: 'cc-layer',
        name: 'CC Layer',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        order: 0,
        imageData: createSolidImageData(2, 2, [0, 0, 0, 0]),
        framebuffer: createCanvasFromImageData(createSolidImageData(2, 2, [0, 0, 0, 0])),
        alignment: createDefaultLayerAlignment(),
        layerType: 'color-cycle',
        colorCycleData: {
          canvasWidth: 2,
          canvasHeight: 2,
          gradientIdBuffer,
          gradientDefIdBuffer,
        },
      }],
      layerGroups: [],
    };

    const serialized = await serializeProject(project);
    const manifest = await readProjectManifest(serialized);
    const entries = manifest.binaries?.entries ?? [];

    expect(manifest.manifestVersion).toBe(1);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'buffers/color-cycle/cc-layer/gradient-id.bin',
          dtype: 'uint8',
          width: 2,
          height: 2,
        }),
        expect.objectContaining({
          path: 'buffers/color-cycle/cc-layer/gradient-def-id.bin',
          dtype: 'uint16',
          width: 2,
          height: 2,
        }),
      ]),
    );
    expect(manifest.project.layers[0]?.state).toEqual(expect.objectContaining({
      version: 1,
      dimensions: { width: 2, height: 2 },
      gradientIdRef: 'zip:buffers/color-cycle/cc-layer/gradient-id.bin',
      gradientDefIdRef: 'zip:buffers/color-cycle/cc-layer/gradient-def-id.bin',
    }));
    expect((manifest.project.layers[0]?.state as { isAnimating?: boolean } | undefined)?.isAnimating).toBeUndefined();
    expect(manifest.project.layers[0]?.colorCycleData?.isAnimating).toBeUndefined();
    expect(manifest.project.layers[0]?.colorCycleData?.gradientIdBuffer).toBeUndefined();
    expect(manifest.project.layers[0]?.colorCycleData?.gradientDefIdBuffer).toBeUndefined();
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
            state?: {
              isAnimating?: boolean;
              dither?: {
                enabled?: boolean;
                strength?: number;
                pixelSize?: number;
                perceptual?: boolean;
              };
            };
            colorCycleData?: {
              isAnimating?: boolean;
              brushState?: unknown;
            };
          }>;
        };
      };

      expect(manifest.project.layers[0]?.colorCycleData?.brushState).toBeUndefined();
      expect(manifest.project.layers[0]?.state?.isAnimating).toBeUndefined();
      expect(manifest.project.layers[0]?.colorCycleData?.isAnimating).toBeUndefined();
      expect(manifest.project.layers[0]?.state?.dither).toBeUndefined();
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('does not persist FG-derived metadata in new-format color-cycle saves', async () => {
    const ccImageData = createSolidImageData(4, 4, [12, 34, 56, 255]);
    const derivedSpec = {
      mode: 'fg-derived' as const,
      baseColor: '#ff8800',
      lightness: 0.5,
      variance: 0.2,
      bands: 4,
      algoVersion: 1,
      key: 'derived-key',
    };
    const layer: Layer = {
      id: 'layer-cc-fg-derived-only',
      name: 'CC FG Derived Only',
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
        fgDerivedKey: derivedSpec.key,
        fgActiveSlot: 3,
        fgDerivedGradients: [{
          key: derivedSpec.key,
          slot: 3,
          spec: derivedSpec,
        }],
        derivedGradients: [{
          key: derivedSpec.key,
          slot: 3,
          spec: derivedSpec,
        }],
      },
    };

    const project: Project = {
      id: 'project-cc-fg-derived-only',
      name: 'CC FG Derived Only',
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
      const manifest = await readProjectManifest(payload);
      const persistedLayer = manifest.project.layers[0];

      expect(persistedLayer?.colorCycleData?.fgDerivedKey).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.fgDerivedGradients).toBeUndefined();
      expect(persistedLayer?.colorCycleData?.derivedGradients).toBeUndefined();

      const restored = await deserializeProject(payload);
      const restoredLayer = restored.layers[0];
      expect(restoredLayer?.colorCycleData?.fgDerivedKey).toBeUndefined();
      expect(restoredLayer?.colorCycleData?.fgDerivedGradients).toBeUndefined();
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('omits legacy color-cycle gradient on new saves when slot palettes already define it', async () => {
    const ccImageData = createSolidImageData(4, 4, [12, 34, 56, 255]);
    const canonicalStops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ];
    const layer: Layer = {
      id: 'layer-cc-gradient-fallback',
      name: 'CC Gradient Fallback',
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
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientDefs: [{ id: 'g0', currentSlot: 2 }],
        slotPalettes: [{ slot: 2, stops: canonicalStops }],
        activeGradientId: 'g0',
      },
    };

    const project: Project = {
      id: 'project-cc-gradient-fallback',
      name: 'CC Gradient Fallback',
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
      const manifest = await readProjectManifest(payload);
      const persistedLayer = manifest.project.layers[0];
      expect(persistedLayer?.colorCycleData?.gradient).toBeUndefined();

      const restored = await deserializeProject(payload);
      expect(restored.layers[0]?.colorCycleData?.gradient).toEqual(canonicalStops);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('keeps new-format color-cycle save fields within the modern allowed surface', async () => {
    const ccImageData = createSolidImageData(4, 4, [12, 34, 56, 255]);
    const layer: Layer = {
      id: 'layer-cc-modern-surface',
      name: 'CC Modern Surface',
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
        gradient: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ],
        gradientDefs: [{ id: 'g0', currentSlot: 1 }],
        slotPalettes: [{ slot: 1, stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ] }],
        activeGradientId: 'g0',
        recolorSettings: {
          quantizationMode: 'rgb332',
          ditherMode: 'bayer4',
          animation: {
            speed: 1,
            fps: 12,
            ticksPerFrame: 1,
            isPlaying: false,
            currentTick: 0,
            flowDirection: 'forward',
          },
          cycleColors: 4,
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
          currentLOD: 'full',
        },
      },
    };

    const project: Project = {
      id: 'project-cc-modern-surface',
      name: 'CC Modern Surface',
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
      const manifest = await readProjectManifest(payload);
      const persistedLayer = manifest.project.layers[0];

      expect(getUnexpectedColorCycleStateFields(persistedLayer?.state)).toEqual([]);
      expect(getUnexpectedModernColorCycleDataFields(persistedLayer?.colorCycleData)).toEqual([]);
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
                speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
                flowBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
                phaseBuffer: Uint8Array.from([2, 2, 2, 2]).buffer,
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
            state?: {
              paintRef?: string;
              gradientIdRef?: string;
              gradientDefIdRef?: string;
            };
            colorCycleData?: {
              gradientIdBuffer?: string;
              gradientDefIdBuffer?: string;
            };
          }>;
        };
      };

      expect(manifest.project.layers[0]?.state?.paintRef).toBe(
        'zip:buffers/color-cycle/layer-cc-authoritative-snapshot/paint.bin',
      );
      expect(manifest.project.layers[0]?.state?.gradientIdRef).toBe(
        'zip:buffers/color-cycle/layer-cc-authoritative-snapshot/gradient-id.bin',
      );
      expect(manifest.project.layers[0]?.state?.gradientDefIdRef).toBe(
        'zip:buffers/color-cycle/layer-cc-authoritative-snapshot/gradient-def-id.bin',
      );
      expect(manifest.project.layers[0]?.colorCycleData?.gradientIdBuffer).toBeUndefined();
      expect(manifest.project.layers[0]?.colorCycleData?.gradientDefIdBuffer).toBeUndefined();
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
                speedBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
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
            state?: {
              paintRef?: string;
              flowRef?: string;
              phaseRef?: string;
            };
            colorCycleData?: {
              brushState?: {
                layers?: Array<{
                  strokeData?: {
                    paintBuffer?: string;
                    gradientIdBuffer?: string;
                    gradientDefIdBuffer?: string;
                    flowBuffer?: string;
                    phaseBuffer?: string;
                  };
                }>;
              };
            };
          }>;
        };
      };

      expect(
        manifest.project.layers[0]?.state?.paintRef
      ).toBe('zip:buffers/color-cycle/layer-cc-flow-save/paint.bin');
      expect(
        manifest.project.layers[0]?.state?.flowRef
      ).toBe('zip:buffers/color-cycle/layer-cc-flow-save/flow.bin');
      expect(
        manifest.project.layers[0]?.state?.phaseRef
      ).toBe('zip:buffers/color-cycle/layer-cc-flow-save/phase.bin');
      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.flowBuffer
      ).toBeUndefined();
      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.phaseBuffer
      ).toBeUndefined();
      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.gradientIdBuffer
      ).toBeUndefined();
      expect(
        manifest.project.layers[0]?.colorCycleData?.brushState?.layers?.[0]?.strokeData?.gradientDefIdBuffer
      ).toBeUndefined();
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
            stampShape: 'checkered',
            stampDitherEnabled: true,
            stampDitherPixelSize: 9,
            stampDitherAlgorithm: 'pattern',
            stampDitherPatternStyle: 'crosshatch',
            stampDitherBgFill: false,
            stampDitherPressureLinked: true,
            pxlEdgeEnabled: true,
            layers: [{
              layerId: 'layer-cc-fill-dither',
              strokeData: {
                hasContent: true,
                strokeCounter: 3,
                paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
                speedBuffer: new Uint8Array([1, 1, 1, 1]).buffer,
                flowBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
                phaseBuffer: new Uint8Array([2, 2, 2, 2]).buffer,
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
      const persistedState = manifest.project.layers[0]?.state as {
        dither?: {
          enabled?: boolean;
          strength?: number;
          pixelSize?: number;
          perceptual?: boolean;
          stampShape?: string;
          stampDitherEnabled?: boolean;
          stampDitherPixelSize?: number;
          stampDitherAlgorithm?: string;
          stampDitherPatternStyle?: string;
          stampDitherBgFill?: boolean;
          stampDitherPressureLinked?: boolean;
          pxlEdgeEnabled?: boolean;
        };
      } | undefined;

      expect(manifest.project.layers[0]?.colorCycleData?.brushState).toBeUndefined();
      expect(persistedState?.dither?.enabled).toBe(true);
      expect(persistedState?.dither?.strength).toBe(0.65);
      expect(persistedState?.dither?.pixelSize).toBe(5);
      expect(persistedState?.dither?.perceptual).toBe(true);
      expect(persistedState?.dither?.stampShape).toBe('checkered');
      expect(persistedState?.dither?.stampDitherEnabled).toBe(true);
      expect(persistedState?.dither?.stampDitherPixelSize).toBe(9);
      expect(persistedState?.dither?.stampDitherAlgorithm).toBe('pattern');
      expect(persistedState?.dither?.stampDitherPatternStyle).toBe('crosshatch');
      expect(persistedState?.dither?.stampDitherBgFill).toBe(false);
      expect(persistedState?.dither?.stampDitherPressureLinked).toBe(true);
      expect(persistedState?.dither?.pxlEdgeEnabled).toBe(true);

      const restored = await deserializeProject(payload);
      const [restoredLayer] = await restoreColorCycleBrushes(restored.layers);
      const restoredBrush = restoredLayer.colorCycleData?.colorCycleBrush as
        | {
            serialize?: () => {
              ditherEnabled?: boolean;
              ditherStrength?: number;
              ditherPixelSize?: number;
              perceptualDither?: boolean;
              stampShape?: string;
              stampDitherEnabled?: boolean;
              stampDitherPixelSize?: number;
              stampDitherAlgorithm?: string;
              stampDitherPatternStyle?: string;
              stampDitherBgFill?: boolean;
              stampDitherClears?: boolean;
              stampDitherPressureLinked?: boolean;
              pxlEdgeEnabled?: boolean;
            };
          }
        | undefined;
      const restoredState = restoredBrush?.serialize?.();

      expect(restoredState?.ditherEnabled).toBe(true);
      expect(restoredState?.ditherStrength).toBe(0.65);
      expect(restoredState?.ditherPixelSize).toBe(5);
      expect(restoredState?.perceptualDither).toBe(true);
      expect(restoredState?.stampShape).toBe('checkered');
      expect(restoredState?.stampDitherEnabled).toBe(true);
      expect(restoredState?.stampDitherPixelSize).toBe(9);
      expect(restoredState?.stampDitherAlgorithm).toBe('pattern');
      expect(restoredState?.stampDitherPatternStyle).toBe('crosshatch');
      expect(restoredState?.stampDitherBgFill).toBe(false);
      expect(restoredState?.stampDitherClears).toBe(true);
      expect(restoredState?.stampDitherPressureLinked).toBe(true);
      expect(restoredState?.pxlEdgeEnabled).toBe(true);
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
    }
  });

  it('keeps external-base-only color-cycle layers as static preview when canonical paint is missing', async () => {
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

    expect(restoredCanvas).toBeTruthy();
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    if (!restoredCanvas) {
      throw new Error('Expected restored color cycle canvas');
    }

    const before = restoredLayer.colorCycleData?.canvasImageData?.data;
    expect(before).toBeTruthy();
    expect(before?.[3]).toBeGreaterThan(0);
  });

  it('preserves legacy color-cycle layer.imageData pixels as static preview when canonical paint is missing', async () => {
    const legacyImageData = createSolidImageData(3, 3, [80, 160, 220, 255]);
    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 3;
    colorCycleCanvas.height = 3;

    const layer: Layer = {
      id: 'layer-cc-legacy-image-data-only',
      name: 'CC Legacy ImageData Only',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: legacyImageData,
      framebuffer: createCanvasFromImageData(legacyImageData),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: colorCycleCanvas,
        canvasWidth: 3,
        canvasHeight: 3,
        isAnimating: false,
        mode: 'brush',
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([layer]);

    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    expect(restoredLayer.colorCycleData?.canvasImageData).toBe(legacyImageData);
    expect(restoredLayer.colorCycleData?.canvasWidth).toBe(3);
    expect(restoredLayer.colorCycleData?.canvasHeight).toBe(3);
    expect(Array.from(restoredLayer.colorCycleData?.canvasImageData?.data.slice(0, 4) ?? [])).toEqual([80, 160, 220, 255]);
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
      const serializedLayer = manifest.project.layers[0];

      expect(serializedLayer?.colorCycleData?.canvasWidth).toBeUndefined();
      expect(serializedLayer?.colorCycleData?.canvasHeight).toBeUndefined();
      expect(serializedLayer?.state).toEqual(expect.objectContaining({
        dimensions: { width: 3, height: 2 },
      }));
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
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    expect(debugWarn).toHaveBeenCalledWith(
      'raw-console',
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

  it('does not reconstruct paint buffers from fallback gradient ids when brushState paint is missing', async () => {
    const brushStateGradientIds = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64');
    const fallbackGradientIds = Buffer.from(Uint8Array.from([7, 7, 7, 7])).toString('base64');
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-no-paint-from-gradient-fallback',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-no-paint-from-gradient-fallback',
        name: 'cc-no-paint-from-gradient-fallback',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-no-paint-from-gradient-fallback',
          name: 'CC No Paint From Gradient Fallback',
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
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(2, 2, [0, 0, 0, 0])),
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
              layers: [{
                layerId: 'layer-cc-no-paint-from-gradient-fallback',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
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
    expect(restoredLayer.colorCycleData?.repairStatus).toMatchObject({
      ok: false,
      reason: 'empty-compatibility-snapshot',
    });
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
  });

  it('marks missing brushState paint with incompatible compatibility snapshot as repair-failed', async () => {
    const brushStateGradientIds = Buffer.from(Uint8Array.from([1, 2, 3])).toString('base64');
    const snapshotImage = createSolidImageData(2, 2, [0, 0, 0, 0]);
    snapshotImage.data[3] = 255;
    snapshotImage.data[8] = 255;
    snapshotImage.data[9] = 255;
    snapshotImage.data[10] = 255;
    snapshotImage.data[11] = 255;
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-paint-from-compatibility-colors',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-paint-from-compatibility-alpha',
        name: 'cc-paint-from-compatibility-colors',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-paint-from-compatibility-alpha',
          name: 'CC Paint From Compatibility Alpha',
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
            canvasImageData: encodeRawImageDataUrl(snapshotImage),
            canvasWidth: 3,
            canvasHeight: 2,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              layers: [{
                layerId: 'layer-cc-paint-from-compatibility-alpha',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
                  gradientIdBuffer: brushStateGradientIds,
                },
              }],
            },
          },
        }],
      },
    };

    const restored = await deserializeProjectWithReport(JSON.stringify(projectPayload));
    expect(restored.colorCycleRepairWarnings).toEqual([expect.objectContaining({
      layerId: 'layer-cc-paint-from-compatibility-alpha',
      status: 'static-preview-only',
      diagnostics: ['static-preview-only', 'repair-failed'],
      reason: 'dimension-mismatch',
      notes: expect.arrayContaining([
        'legacy-color-cycle-import-repair-failed',
        'diagnostic:static-preview-only',
        'diagnostic:repair-failed',
      ]),
    })]);
    const [restoredLayer] = await restoreColorCycleBrushes(restored.project.layers);
    expect(restoredLayer.colorCycleData?.repairStatus).toMatchObject({
      ok: false,
      reason: 'dimension-mismatch',
    });
    expect(restoredLayer.colorCycleData?.repairStatus?.notes).toEqual(expect.arrayContaining([
      'diagnostic:static-preview-only',
      'diagnostic:repair-failed',
    ]));
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
  });

  it('repairs deferred archive brushState refs on import before runtime restore', async () => {
    const width = 2;
    const height = 2;
    const layerId = 'layer-cc-deferred-ref-repair';
    const gradientIdPath = `buffers/color-cycle/${layerId}/gradient-id.bin`;
    const gradientDefIdPath = `buffers/color-cycle/${layerId}/gradient-def-id.bin`;
    const gradientIdBytes = Uint8Array.from([1, 2, 3, 4]);
    const gradientDefIdBytes = new Uint8Array(new Uint16Array([1, 1, 1, 1]).buffer);
    const archive = {
      version: '1.1.0',
      metadata: {
        name: 'deferred-ref-repair',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-deferred-ref-repair',
        name: 'deferred-ref-repair',
        width,
        height,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'active-raster-deferred-ref-repair',
          name: 'Active Raster',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
        }, {
          id: layerId,
          name: 'Deferred Ref Repair',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 1,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width, height },
            mode: 'brush',
            gradientIdRef: `zip:${gradientIdPath}`,
            gradientDefIdRef: `zip:${gradientDefIdPath}`,
            hasContent: true,
            strokeCounter: 1,
          },
          colorCycleData: {
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(width, height, [20, 30, 40, 255])),
            canvasWidth: width,
            canvasHeight: height,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: gradientIdPath,
          checksum: fnv1aHash(gradientIdBytes),
          byteLength: gradientIdBytes.byteLength,
          logicalByteLength: 8 * 1024 * 1024,
          dtype: inferBinaryManifestDType(gradientIdPath),
          width,
          height,
          compression: 'deflate',
        }, {
          version: 1,
          path: gradientDefIdPath,
          checksum: fnv1aHash(gradientDefIdBytes),
          byteLength: gradientDefIdBytes.byteLength,
          logicalByteLength: 8 * 1024 * 1024,
          dtype: inferBinaryManifestDType(gradientDefIdPath),
          width,
          height,
          compression: 'deflate',
        }],
      },
    };
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(archive));
    zip.file(gradientIdPath, gradientIdBytes);
    zip.file(gradientDefIdPath, gradientDefIdBytes);
    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    const restored = await deserializeProject(payload, {
      lazyColorCycleRuntime: true,
      activeLayerId: 'active-raster-deferred-ref-repair',
    });
    const restoredLayer = restored.layers.find((layer) => layer.id === layerId);

    expect(restoredLayer?.colorCycleData?.repairStatus).toBeUndefined();
    expect(restoredLayer?.colorCycleData?.gradientIdBuffer).toBeInstanceOf(ArrayBuffer);
    expect(restoredLayer?.colorCycleData?.gradientDefIdBuffer).toBeInstanceOf(ArrayBuffer);
    expect(restoredLayer?.colorCycleData?.brushState).toEqual(expect.objectContaining({
      layers: [expect.objectContaining({
        layerId,
        strokeData: expect.objectContaining({
          paintBuffer: expect.any(ArrayBuffer),
          gradientIdBuffer: expect.any(ArrayBuffer),
          gradientDefIdBuffer: expect.any(ArrayBuffer),
        }),
      })],
    }));
    expect(restoredLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();

    const [runtimeLayer] = await restoreColorCycleBrushes(restored.layers.filter((layer) => layer.id === layerId));
    const runtimeBrush = runtimeLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (snapshotLayerId: string) => {
            paintBuffer?: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            gradientDefIdBuffer?: ArrayBuffer;
            hasContent?: boolean;
          } | null;
        }
      | undefined;
    const runtimeSnapshot = runtimeBrush?.getLayerSnapshot?.(layerId);
    expect(runtimeLayer.colorCycleData?.repairStatus).toBeUndefined();
    expect(runtimeSnapshot?.paintBuffer).toBeInstanceOf(ArrayBuffer);
    expect(runtimeSnapshot?.gradientIdBuffer).toBeInstanceOf(ArrayBuffer);
    expect(runtimeSnapshot?.gradientDefIdBuffer).toBeInstanceOf(ArrayBuffer);
    expect(runtimeSnapshot?.hasContent).toBe(true);
  });

  it('persists repair-failed color-cycle metadata through save and reopen', async () => {
    const width = 2;
    const height = 2;
    const canvasImageData = createSolidImageData(width, height, [40, 80, 120, 255]);
    const layer: Layer = {
      id: 'layer-cc-repair-failed-save',
      name: 'CC Repair Failed Save',
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
        canvas: createCanvasFromImageData(canvasImageData),
        canvasImageData,
        canvasWidth: width,
        canvasHeight: height,
        mode: 'brush',
        repairStatus: {
          ok: false,
          reason: 'missing-gradient-bindings',
          notes: ['legacy-color-cycle-import-repair-failed'],
        },
      },
    };
    const project: Project = {
      id: 'project-cc-repair-failed-save',
      name: 'CC Repair Failed Save',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await withPatchedCanvasRect(() => serializeProject(project, project.layers));
    const manifest = await readProjectManifest(payload) as {
      project: {
        layers: Array<{
          colorCycleData?: {
            repairStatus?: {
              ok: false;
              reason: string;
              notes?: string[];
            };
          };
        }>;
      };
    };

    expect(manifest.project.layers[0]?.colorCycleData?.repairStatus).toEqual({
      ok: false,
      reason: 'missing-gradient-bindings',
      notes: ['legacy-color-cycle-import-repair-failed'],
    });

    const reopened = await deserializeProject(payload);
    const [reopenedLayer] = await restoreColorCycleBrushes(reopened.layers);
    expect(reopenedLayer.colorCycleData?.repairStatus).toEqual({
      ok: false,
      reason: 'missing-gradient-bindings',
      notes: ['legacy-color-cycle-import-repair-failed'],
    });
    expect(reopenedLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(reopenedLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(readPixel(reopenedLayer.colorCycleData?.canvasImageData ?? null, 0, 0)).toEqual([40, 80, 120, 255]);
  });

  it('preserves deferred brush snapshots across layer object copies', async () => {
    const width = 2048;
    const height = 2048;
    const paintBytes = new Uint8Array(width * height);
    paintBytes.set([9, 8, 7, 6], 0);
    const gradientIdBytes = new Uint8Array(width * height);
    gradientIdBytes.set([1, 2, 3, 4], 0);
    const gradientDefIdBytes = new Uint16Array(width * height);
    gradientDefIdBytes.set([1, 1, 1, 1], 0);
    const speedBytes = new Uint8Array(width * height);
    speedBytes.set([1, 1, 1, 1], 0);
    const flowBytes = new Uint8Array(width * height);
    flowBytes.set([4, 3, 2, 1], 0);
    const phaseBytes = new Uint8Array(width * height);
    phaseBytes.set([5, 6, 7, 8], 0);
    const paintBuffer = Buffer.from(paintBytes).toString('base64');
    const gradientIdBuffer = Buffer.from(gradientIdBytes).toString('base64');
    const gradientDefIdBuffer = Buffer.from(
      gradientDefIdBytes.buffer,
      gradientDefIdBytes.byteOffset,
      gradientDefIdBytes.byteLength,
    ).toString('base64');
    const speedBuffer = Buffer.from(speedBytes).toString('base64');
    const flowBuffer = Buffer.from(flowBytes).toString('base64');
    const phaseBuffer = Buffer.from(phaseBytes).toString('base64');
    const projectPayload = {
      version: '1.1.0',
      metadata: {
        name: 'cc-deferred-copy-safe',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'p-cc-deferred-copy-safe',
        name: 'cc-deferred-copy-safe',
        width,
        height,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'layer-cc-deferred-copy-safe',
          name: 'CC Deferred Copy Safe',
          visible: false,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          layerType: 'color-cycle',
          alignment: createDefaultLayerAlignment(),
          colorCycleData: {
            mode: 'brush',
            canvasImageData: encodeRawImageDataUrl(createSolidImageData(width, height, [20, 30, 40, 255])),
            canvasWidth: width,
            canvasHeight: height,
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
              hash: 'deferred-copy-def',
              source: 'manual',
              createdAtMs: 1,
            }],
            gradientIdBuffer,
            gradientDefIdBuffer,
            brushState: {
              cycleSpeed: 0.2,
              fps: 18,
              layers: [{
                layerId: 'layer-cc-deferred-copy-safe',
                strokeData: {
                  hasContent: true,
                  strokeCounter: 2,
                  paintBuffer,
                  gradientIdBuffer,
                  gradientDefIdBuffer,
                  speedBuffer,
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
    const [deferredLayer] = await restoreColorCycleBrushes(restored.layers, {
      lazy: true,
      activeLayerId: 'other-layer',
    });

    expect(deferredLayer.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(deferredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(deferredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();

    const copiedLayer: Layer = {
      ...deferredLayer,
      visible: true,
      colorCycleData: deferredLayer.colorCycleData
        ? {
            ...deferredLayer.colorCycleData,
            deferredRuntimeRestore: true,
          }
        : deferredLayer.colorCycleData,
    };

    const [warmedLayer] = await restoreColorCycleBrushes([copiedLayer], {
      lazy: false,
      activeLayerId: copiedLayer.id,
    });

    const warmedBrush = warmedLayer.colorCycleData?.colorCycleBrush as
      | {
          getLayerSnapshot?: (layerId: string) => {
            paintBuffer: ArrayBuffer;
            gradientIdBuffer?: ArrayBuffer;
            flowBuffer?: ArrayBuffer;
          } | null;
        }
      | undefined;

    const snapshot = warmedBrush?.getLayerSnapshot?.(warmedLayer.id);
    expect(warmedLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(warmedLayer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(warmedLayer.colorCycleData?.canvasImageData).toBeDefined();
    expect(snapshot).toBeTruthy();
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)).slice(0, 4))).toEqual([9, 8, 7, 6]);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)).slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)).slice(0, 4))).toEqual([4, 3, 2, 1]);
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

  it('does not seed oversized duplicated legacy snapshots from top-level gradient buffers', async () => {
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
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(Array.from(new Uint8Array(restoredLayer.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      Array.from(gradientIds),
    );
  });

  it('defers runtime restore for hidden heavy color-cycle layers when lazy mode is enabled', async () => {
    const width = 2048;
    const height = 2048;
    const payloadSize = width * height;
    const heavyLayer: Layer = {
      id: 'layer-cc-deferred',
      name: 'Deferred CC',
      visible: false,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: new Uint8Array(payloadSize).buffer,
        brushState: {
          cycleSpeed: 0.3,
          fps: 12,
          layers: [{
            layerId: 'layer-cc-deferred',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
              flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
            },
          }],
        },
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([heavyLayer], {
      lazy: true,
      activeLayerId: 'other-layer',
    });

    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
  });

  it('defers runtime restore for visible non-active heavy color-cycle layers when lazy mode is enabled', async () => {
    const width = 2048;
    const height = 2048;
    const payloadSize = width * height;
    const visibleLayer: Layer = {
      id: 'layer-cc-visible',
      name: 'Visible CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: new Uint8Array(payloadSize).buffer,
        brushState: {
          cycleSpeed: 0.3,
          fps: 12,
          layers: [{
            layerId: 'layer-cc-visible',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
              flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
            },
          }],
        },
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([visibleLayer], {
      lazy: true,
      activeLayerId: 'other-layer',
    });

    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
  });

  it('keeps non-active heavy archive color-cycle buffers unhydrated until warm restore', async () => {
    const width = 1152;
    const height = 1152;
    const activeLayerId = 'active-raster-lazy-memory';
    const colorCycleLayerId = 'cold-cc-lazy-memory';
    const pixelCount = width * height;
    const paint = new Uint8Array(pixelCount);
    const gradientId = new Uint8Array(pixelCount);
    const gradientDefId = new Uint16Array(pixelCount);
    const speed = new Uint8Array(pixelCount);
    const flow = new Uint8Array(pixelCount);
    const phase = new Uint8Array(pixelCount);
    paint.fill(1);
    gradientId.fill(2);
    gradientDefId.fill(3);
    speed.fill(4);
    flow.fill(1);
    phase.fill(5);

    const entries = [
      { path: `buffers/color-cycle/${colorCycleLayerId}/paint.bin`, bytes: paint },
      { path: `buffers/color-cycle/${colorCycleLayerId}/gradient-id.bin`, bytes: gradientId },
      { path: `buffers/color-cycle/${colorCycleLayerId}/gradient-def-id.bin`, bytes: new Uint8Array(gradientDefId.buffer) },
      { path: `buffers/color-cycle/${colorCycleLayerId}/speed.bin`, bytes: speed },
      { path: `buffers/color-cycle/${colorCycleLayerId}/flow.bin`, bytes: flow },
      { path: `buffers/color-cycle/${colorCycleLayerId}/phase.bin`, bytes: phase },
    ];
    const ref = (path: string) => `zip:${path}`;
    const archive = {
      version: '1.1.0',
      metadata: {
        name: 'Lazy CC Archive Runtime',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-lazy-cc-archive-runtime',
        name: 'Lazy CC Archive Runtime',
        width,
        height,
        backgroundColor: '#000000',
        layers: [{
          id: activeLayerId,
          name: 'Active Raster',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
        }, {
          id: colorCycleLayerId,
          name: 'Cold CC',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 1,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width, height },
            mode: 'brush',
            gradientDefStore: [{
              id: 3,
              kind: 'linear',
              stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
              hash: 'def-3',
              source: 'manual',
              createdAtMs: 1,
            }],
            paintRef: ref(entries[0].path),
            gradientIdRef: ref(entries[1].path),
            gradientDefIdRef: ref(entries[2].path),
            speedRef: ref(entries[3].path),
            flowRef: ref(entries[4].path),
            phaseRef: ref(entries[5].path),
            hasContent: true,
            strokeCounter: 1,
          },
          colorCycleData: {},
        }],
        customBrushes: [],
      },
      binaries: {
        entries: entries.map((entry) => ({
          version: 1,
          path: entry.path,
          checksum: fnv1aHash(entry.bytes),
          byteLength: entry.bytes.byteLength,
          dtype: inferBinaryManifestDType(entry.path),
          width,
          height,
          compression: 'deflate',
        })),
      },
    };
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(archive));
    entries.forEach((entry) => zip.file(entry.path, entry.bytes));
    const payload = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const deserialized = await deserializeProject(payload, {
      lazyColorCycleRuntime: true,
      activeLayerId,
    });
    const lazyLayer = deserialized.layers.find((layer) => layer.id === colorCycleLayerId);

    expect(lazyLayer?.colorCycleData?.gradientIdBuffer?.byteLength ?? 0).toBeLessThan(width * height);
    expect(lazyLayer?.colorCycleData?.gradientDefIdBuffer?.byteLength ?? 0).toBeLessThan(width * height * 2);

    const restoredColdLayers = await restoreColorCycleBrushes(deserialized.layers, {
      lazy: true,
      activeLayerId,
    });
    const restoredColdLayer = restoredColdLayers.find((layer) => layer.id === colorCycleLayerId);

    expect(restoredColdLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredColdLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredColdLayer?.colorCycleData?.gradientIdBuffer?.byteLength ?? 0).toBeLessThan(width * height);

    const [warmedLayer] = await restoreColorCycleBrushes([restoredColdLayer as Layer], {
      lazy: false,
      activeLayerId: colorCycleLayerId,
    });

    expect(warmedLayer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(warmedLayer.colorCycleData?.gradientIdBuffer?.byteLength).toBe(width * height);
    expect(warmedLayer.colorCycleData?.gradientDefIdBuffer?.byteLength).toBe(width * height * 2);
    expect(warmedLayer.colorCycleData?.colorCycleBrush).toBeTruthy();
  });

  it('copies deferred archive color-cycle binaries when saving before warm restore', async () => {
    const width = 1152;
    const height = 1152;
    const activeLayerId = 'active-raster-lazy-resave';
    const colorCycleLayerId = 'cold-cc-lazy-resave';
    const pixelCount = width * height;
    const paint = new Uint8Array(pixelCount);
    const gradientId = new Uint8Array(pixelCount);
    const gradientDefId = new Uint16Array(pixelCount);
    const speed = new Uint8Array(pixelCount);
    const flow = new Uint8Array(pixelCount);
    const phase = new Uint8Array(pixelCount);
    paint.fill(1);
    gradientId.fill(2);
    gradientDefId.fill(3);
    speed.fill(4);
    flow.fill(1);
    phase.fill(5);

    const entries = [
      { path: `buffers/color-cycle/${colorCycleLayerId}/paint.bin`, bytes: paint },
      { path: `buffers/color-cycle/${colorCycleLayerId}/gradient-id.bin`, bytes: gradientId },
      { path: `buffers/color-cycle/${colorCycleLayerId}/gradient-def-id.bin`, bytes: new Uint8Array(gradientDefId.buffer) },
      { path: `buffers/color-cycle/${colorCycleLayerId}/speed.bin`, bytes: speed },
      { path: `buffers/color-cycle/${colorCycleLayerId}/flow.bin`, bytes: flow },
      { path: `buffers/color-cycle/${colorCycleLayerId}/phase.bin`, bytes: phase },
    ];
    const ref = (path: string) => `zip:${path}`;
    const archive = {
      version: '1.1.0',
      metadata: {
        name: 'Lazy CC Resave',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'project-lazy-cc-resave',
        name: 'Lazy CC Resave',
        width,
        height,
        backgroundColor: '#000000',
        layers: [{
          id: activeLayerId,
          name: 'Active Raster',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'normal',
        }, {
          id: colorCycleLayerId,
          name: 'Cold CC',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 1,
          imageDataUrl: '',
          layerType: 'color-cycle',
          state: {
            version: 1,
            dimensions: { width, height },
            mode: 'brush',
            gradientDefStore: [{
              id: 3,
              kind: 'linear',
              stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
              hash: 'def-3',
              source: 'manual',
              createdAtMs: 1,
            }],
            paintRef: ref(entries[0].path),
            gradientIdRef: ref(entries[1].path),
            gradientDefIdRef: ref(entries[2].path),
            speedRef: ref(entries[3].path),
            flowRef: ref(entries[4].path),
            phaseRef: ref(entries[5].path),
            hasContent: true,
            strokeCounter: 1,
          },
          colorCycleData: {},
        }],
        customBrushes: [],
      },
      binaries: {
        entries: entries.map((entry) => ({
          version: 1,
          path: entry.path,
          checksum: fnv1aHash(entry.bytes),
          byteLength: entry.bytes.byteLength,
          dtype: inferBinaryManifestDType(entry.path),
          width,
          height,
          compression: 'deflate',
        })),
      },
    };
    const sourceZip = new JSZip();
    sourceZip.file('project.json', JSON.stringify(archive));
    entries.forEach((entry) => sourceZip.file(entry.path, entry.bytes));
    const sourcePayload = await sourceZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    const deserialized = await deserializeProject(sourcePayload, {
      lazyColorCycleRuntime: true,
      activeLayerId,
    });
    deserialized.layers = await restoreColorCycleBrushes(deserialized.layers, {
      lazy: true,
      activeLayerId,
    });
    const coldLayer = deserialized.layers.find((layer) => layer.id === colorCycleLayerId);
    expect(coldLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');

    const resavedPayload = await withPatchedCanvasRect(() => serializeProject(deserialized, deserialized.layers));
    const resavedZip = await JSZip.loadAsync(resavedPayload);
    const projectJson = await resavedZip.file('project.json')?.async('string');
    if (!projectJson) {
      throw new Error('Missing project.json');
    }
    const resavedManifest = JSON.parse(projectJson) as {
      binaries?: { entries?: Array<{ path: string; byteLength: number }> };
      project: { layers: Array<{ id: string; state?: Record<string, string | undefined> }> };
    };
    const binaryPaths = new Set((resavedManifest.binaries?.entries ?? []).map((entry) => entry.path));
    const persistedColdLayer = resavedManifest.project.layers.find((layer) => layer.id === colorCycleLayerId);
    const persistedRefs = [
      persistedColdLayer?.state?.paintRef,
      persistedColdLayer?.state?.gradientIdRef,
      persistedColdLayer?.state?.gradientDefIdRef,
      persistedColdLayer?.state?.speedRef,
      persistedColdLayer?.state?.flowRef,
      persistedColdLayer?.state?.phaseRef,
    ];

    for (const persistedRef of persistedRefs) {
      expect(typeof persistedRef).toBe('string');
      const path = (persistedRef as string).slice('zip:'.length);
      expect(binaryPaths.has(path)).toBe(true);
      expect(resavedZip.file(path)).toBeTruthy();
    }

    const restored = await deserializeProject(resavedPayload);
    const restoredLayer = restored.layers.find((layer) => layer.id === colorCycleLayerId);
    expect(restoredLayer?.colorCycleData?.gradientIdBuffer?.byteLength).toBe(width * height);
    expect(restoredLayer?.colorCycleData?.gradientDefIdBuffer?.byteLength).toBe(width * height * 2);
    const restoredBrushState = restoredLayer?.colorCycleData?.brushState as {
      layers?: Array<{ strokeData?: { paintBuffer?: string; flowBuffer?: string } }>;
    } | undefined;
    const restoredStrokeData = restoredBrushState?.layers?.[0]?.strokeData;
    expect(typeof restoredStrokeData?.paintBuffer).toBe('string');
    expect((restoredStrokeData?.paintBuffer ?? '').length).toBeGreaterThan(0);
    expect(typeof restoredStrokeData?.flowBuffer).toBe('string');
    expect((restoredStrokeData?.flowBuffer ?? '').length).toBeGreaterThan(0);
  });

  it('captures live color-cycle brush buffers when layer metadata only has gradient bindings', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-live-save-source';
    const pixelCount = width * height;
    const paint = Uint8Array.from({ length: pixelCount }, (_, index) => (index < 6 ? index + 1 : 0));
    const gradientId = Uint8Array.from({ length: pixelCount }, (_, index) => (index < 6 ? 8 : 0));
    const gradientDefId = new Uint16Array(pixelCount);
    const speed = new Uint8Array(pixelCount);
    const flow = new Uint8Array(pixelCount);
    const phase = new Uint8Array(pixelCount);
    for (let i = 0; i < 6; i += 1) {
      gradientDefId[i] = 12;
      speed[i] = 33;
      flow[i] = 1;
      phase[i] = 44;
    }

    const liveBrushState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [{
        layerId,
        gradientDefs: [{ id: 'g8', currentSlot: 8 }],
        slotPalettes: [{ slot: 8, stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] }],
        gradientDefStore: [{
          id: 12,
          kind: 'linear' as const,
          stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
          hash: 'linear:live',
          source: 'sampled' as const,
          createdAtMs: 1,
          slot: 8,
        }],
        nextGradientDefId: 13,
        paintSlot: 8,
        strokeData: {
          hasContent: true,
          strokeCounter: 9,
          paintBuffer: paint.buffer.slice(0),
          gradientIdBuffer: gradientId.buffer.slice(0),
          gradientDefIdBuffer: gradientDefId.buffer.slice(0),
          speedBuffer: speed.buffer.slice(0),
          flowBuffer: flow.buffer.slice(0),
          phaseBuffer: phase.buffer.slice(0),
        },
      }],
    };

    const layer: Layer = {
      id: layerId,
      name: 'Live CC Save Source',
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
      colorCycleData: {
        canvas: createCanvasFromImageData(createSolidImageData(width, height, [20, 30, 40, 255])),
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: gradientId.buffer.slice(0),
        gradientDefIdBuffer: gradientDefId.buffer.slice(0),
        colorCycleBrush: {
          serialize: () => liveBrushState,
        } as never,
      },
      version: 1,
    };
    const project: Project = {
      id: 'project-live-cc-save-source',
      name: 'Live CC Save Source',
      width,
      height,
      backgroundColor: '#000000',
      layers: [layer],
      customBrushes: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await withPatchedCanvasRect(() => serializeProject(project, project.layers));
    const zip = await JSZip.loadAsync(payload);
    const projectJson = await zip.file('project.json')?.async('string');
    if (!projectJson) {
      throw new Error('Missing project.json');
    }
    const manifest = JSON.parse(projectJson) as {
      project: { layers: Array<{ id: string; state?: Record<string, unknown> }> };
      binaries?: { entries?: Array<{ path: string }> };
    };
    const persistedLayer = manifest.project.layers.find((entry) => entry.id === layerId);
    const binaryPaths = new Set((manifest.binaries?.entries ?? []).map((entry) => entry.path));

    expect(persistedLayer?.state?.paintRef).toBe(`zip:buffers/color-cycle/${layerId}/paint.bin`);
    expect(persistedLayer?.state?.speedRef).toBe(`zip:buffers/color-cycle/${layerId}/speed.bin`);
    expect(persistedLayer?.state?.flowRef).toBe(`zip:buffers/color-cycle/${layerId}/flow.bin`);
    expect(persistedLayer?.state?.phaseRef).toBe(`zip:buffers/color-cycle/${layerId}/phase.bin`);
    expect(persistedLayer?.state?.hasContent).toBe(true);
    expect(persistedLayer?.state?.strokeCounter).toBe(9);
    expect(persistedLayer?.state?.paintSlot).toBe(8);
    expect(binaryPaths.has(`buffers/color-cycle/${layerId}/paint.bin`)).toBe(true);
    expect(binaryPaths.has(`buffers/color-cycle/${layerId}/flow.bin`)).toBe(true);
    expect(zip.file(`buffers/color-cycle/${layerId}/paint.bin`)).toBeTruthy();
  });

  it('does not defer runtime restore for animating non-active heavy color-cycle layers when lazy mode is enabled', async () => {
    const width = 2048;
    const height = 2048;
    const payloadSize = width * height;
    const animatingLayer: Layer = {
      id: 'layer-cc-animating-heavy',
      name: 'Animating Heavy CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        isAnimating: true,
        canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: new Uint8Array(payloadSize).buffer,
        brushState: {
          cycleSpeed: 0.3,
          fps: 12,
          layers: [{
            layerId: 'layer-cc-animating-heavy',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
              flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
            },
          }],
        },
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([animatingLayer], {
      lazy: true,
      activeLayerId: 'other-layer',
    });

    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
  });

  it('does not defer runtime restore for the active heavy color-cycle layer when lazy mode is enabled', async () => {
    const width = 2048;
    const height = 2048;
    const payloadSize = width * height;
    const activeLayer: Layer = {
      id: 'layer-cc-active-heavy',
      name: 'Active Heavy CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: {
        canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
        canvasWidth: width,
        canvasHeight: height,
        gradientIdBuffer: new Uint8Array(payloadSize).buffer,
        brushState: {
          cycleSpeed: 0.3,
          fps: 12,
          layers: [{
            layerId: 'layer-cc-active-heavy',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
              flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
            },
          }],
        },
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([activeLayer], {
      lazy: true,
      activeLayerId: 'layer-cc-active-heavy',
    });

    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
  });

  describe('large-project smoke benchmarks', () => {
    let fixture: Awaited<ReturnType<typeof createLargeProjectBenchmarkFixture>>;

    beforeAll(async () => {
      fixture = await createLargeProjectBenchmarkFixture();
    });

    it('keeps large archive import under the smoke-test budget', async () => {
      const startedAt = performance.now();
      const restored = await deserializeProjectWithReport(fixture.payload);
      const durationMs = performance.now() - startedAt;

      expect(restored.project.layers).toHaveLength(fixture.totalLayerCount);
      expect(durationMs).toBeLessThan(LARGE_PROJECT_IMPORT_BUDGET_MS);
    });

    it('keeps lazy hydration for large hidden CC layer sets under the smoke-test budget', async () => {
      const payloadSize = 2048 * 2048;
      const hiddenLayers = Array.from({ length: 4 }, (_, index): Layer => ({
        id: `benchmark-hidden-heavy-${index}`,
        name: `Benchmark Hidden Heavy ${index}`,
        visible: false,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: index + 1,
        imageData: null,
        framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
        alignment: createDefaultLayerAlignment(),
        layerType: 'color-cycle',
        version: 1,
        colorCycleData: {
          canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
          canvasWidth: 2048,
          canvasHeight: 2048,
          gradientIdBuffer: new Uint8Array(payloadSize).buffer,
          brushState: {
            cycleSpeed: 0.3,
            fps: 12,
            layers: [{
              layerId: `benchmark-hidden-heavy-${index}`,
              strokeData: {
                hasContent: true,
                strokeCounter: 1,
                flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
              },
            }],
          },
        },
      }));
      const activeLayerId = 'benchmark-active-cc';
      const layers: Layer[] = [{
        id: activeLayerId,
        name: 'Benchmark Active CC',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: null,
        framebuffer: createCanvasFromImageData(createSolidImageData(1, 1, [0, 0, 0, 0])),
        alignment: createDefaultLayerAlignment(),
        layerType: 'color-cycle',
        version: 1,
        colorCycleData: {
          canvas: Object.assign(document.createElement('canvas'), { width: 32, height: 32 }),
          canvasWidth: 32,
          canvasHeight: 32,
          gradientIdBuffer: new Uint8Array(32 * 32).buffer,
          brushState: {
            cycleSpeed: 0.3,
            fps: 12,
            layers: [{
              layerId: activeLayerId,
              strokeData: {
                hasContent: true,
                strokeCounter: 1,
                flowBuffer: Buffer.alloc(32 * 32).toString('base64'),
              },
            }],
          },
        },
      }, ...hiddenLayers];

      const startedAt = performance.now();
      const hydratedLayers = await restoreColorCycleBrushes(layers, {
        lazy: true,
        activeLayerId,
      });
      const durationMs = performance.now() - startedAt;

      const activeLayer = hydratedLayers.find((layer) => layer.id === activeLayerId);
      const coldHiddenLayers = hydratedLayers.filter((layer) =>
        layer.id.startsWith('benchmark-hidden-heavy-'),
      );

      expect(activeLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');
      expect(activeLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
      expect(activeLayer?.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
        ok: false,
        reason: 'missing-paint-buffer',
      }));
      expect(coldHiddenLayers).toHaveLength(hiddenLayers.length);
      expect(coldHiddenLayers.every((layer) => (
        layer.colorCycleData?.runtimeHydrationState === 'cold'
        && layer.colorCycleData?.deferredRuntimeRestore === true
        && !layer.colorCycleData?.colorCycleBrush
      ))).toBe(true);
      expect(durationMs).toBeLessThan(LARGE_PROJECT_LAZY_HYDRATION_BUDGET_MS);
    });
  });

  it('does not seed color-cycle runtime paint from persisted gradient buffers when brushState paint is missing', async () => {
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

    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    expect(Array.from(new Uint8Array(restoredLayer.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
      Array.from(gradientIds),
    );
  });

  it('keeps stale empty color-cycle runtime cold when canonical paint is missing', async () => {
    const width = 3;
    const height = 3;
    const colorCycleCanvas = createCanvasFromImageData(createSolidImageData(width, height, [0, 0, 0, 0]));
    const gradientIds = new Uint8Array(width * height);
    gradientIds[4] = 1;
    const gradientDefIds = new Uint16Array(width * height);
    gradientDefIds[4] = 1;

    const layer: Layer = {
      id: 'layer-cc-stale-empty-runtime',
      name: 'CC Stale Empty Runtime',
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
        canvasWidth: width,
        canvasHeight: height,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        gradientIdBuffer: gradientIds.buffer.slice(0),
        gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
        gradientDefStore: [{
          id: 1,
          kind: 'linear',
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
          hash: 'def-1',
          source: 'manual',
          createdAtMs: 1,
          slot: 1,
        }],
        slotPalettes: [{
          slot: 1,
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        }],
        isAnimating: false,
        mode: 'brush',
      },
    };

    const [restoredLayer] = await restoreColorCycleBrushes([layer]);
    const ctx = restoredLayer.colorCycleData?.canvas?.getContext('2d', { willReadFrequently: true });
    const imageData = ctx?.getImageData(0, 0, width, height) ?? null;
    const hasVisiblePixel = imageData
      ? imageData.data.some((value, index) => index % 4 === 3 && value !== 0)
      : false;

    expect(restoredLayer.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(restoredLayer.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoredLayer.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(restoredLayer.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing-paint-buffer',
    }));
    expect(hasVisiblePixel).toBe(false);
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
    expect(manifest.project.layers[0]?.state).toEqual({
      version: 1,
      dimensions: { width: 2, height: 2 },
      imageRef: 'zip:buffers/raster/layer-normal/image.json',
    });
    expect(manifest.project.layers[0]?.imageDataUrl).toBe('');
    expect(manifest.project.layers[1]?.state).toEqual({
      version: 1,
      frameCount: 1,
      fps: 1,
      durationMs: 1,
      encoding: 'chunked-events-v1',
      chunksRef: 'zip:buffers/sequential/layer-seq/chunks.json',
      brushSnapshotsRef: 'zip:buffers/sequential/layer-seq/brush-snapshots.json',
    });
    expect(manifest.project.layers[1]?.sequentialData).toBeUndefined();
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

  it('returns structured repair metadata when legacy color-cycle metadata is promoted from brush snapshots', async () => {
    const gradientIdBuffer = Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64');
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-cc-repair',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-cc-repair-project',
        name: 'legacy-cc-repair',
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
            colorCycleData: {
              brushState: {
                layers: [
                  {
                    layerId: 'layer-cc',
                    strokeData: {
                      gradientIdBuffer,
                    },
                    gradientDefStore: [
                      {
                        id: 1,
                        kind: 'linear',
                        stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
                        hash: 'defs-1',
                        source: 'manual',
                        createdAtMs: 123,
                      },
                    ],
                    slotPalettes: [
                      {
                        slot: 0,
                        stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
                      },
                    ],
                    nextGradientDefId: 2,
                    activeGradientId: 'gradient-1',
                  },
                ],
              },
            },
          },
        ],
        customBrushes: [],
      },
    };

    const result = await deserializeProjectWithReport(JSON.stringify(legacyProject));
    const restoredLayer = result.project.layers[0];

    expect(result.migration.shouldMarkDirty).toBe(true);
    expect(result.migration.repairs.map((repair) => repair.code)).toEqual(expect.arrayContaining([
      'legacy-cc-missing-layer-type',
      'legacy-cc-defaulted-canvas-width',
      'legacy-cc-defaulted-canvas-height',
      'legacy-cc-promoted-gradientDefStore',
      'legacy-cc-promoted-slotPalettes',
      'legacy-cc-promoted-nextGradientDefId',
      'legacy-cc-promoted-activeGradientId',
      'legacy-cc-promoted-gradientIdBuffer',
    ]));
    expect(restoredLayer.layerType).toBe('color-cycle');
    expect(restoredLayer.colorCycleData?.gradientDefStore?.[0]?.id).toBe(1);
    expect(restoredLayer.colorCycleData?.slotPalettes?.[0]?.slot).toBe(0);
    expect(restoredLayer.colorCycleData?.activeGradientId).toBe('gradient-1');
    expect(Array.from(new Uint8Array(restoredLayer.colorCycleData?.gradientIdBuffer as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });

  it('returns raster repair metadata when legacy raster layer type and image payload are repaired', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-raster-repair',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-raster-repair-project',
        name: 'legacy-raster-repair',
        width: 2,
        height: 2,
        backgroundColor: '#000000',
        layers: [
          {
            id: 'layer-raster',
            name: 'Legacy Raster',
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            order: 0,
          },
        ],
        customBrushes: [],
      },
    };

    const result = await deserializeProjectWithReport(JSON.stringify(legacyProject));
    const restoredLayer = result.project.layers[0];

    expect(result.migration.shouldMarkDirty).toBe(true);
    expect(result.migration.repairs.map((repair) => repair.code)).toEqual(expect.arrayContaining([
      'legacy-raster-missing-layer-type',
      'legacy-raster-missing-image-defaulted',
    ]));
    expect(restoredLayer.layerType).toBe('normal');
    expect(restoredLayer.imageData).toBeNull();
  });

  it('fails explicitly when legacy color-cycle payload is structurally invalid', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-cc-conflict',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-cc-conflict-project',
        name: 'legacy-cc-conflict',
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
            colorCycleData: 'invalid-payload',
          },
        ],
        customBrushes: [],
      },
    };

    await expect(deserializeProjectWithReport(JSON.stringify(legacyProject))).rejects.toThrow(
      'Color-cycle layer layer-cc has an invalid payload.',
    );
  });

  it('fails explicitly when legacy color-cycle metadata has ambiguous duplicated authorities', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-cc-ambiguous',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-cc-ambiguous-project',
        name: 'legacy-cc-ambiguous',
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
            colorCycleData: {
              activeGradientId: 'top-level-gradient',
              brushState: {
                layers: [
                  {
                    layerId: 'layer-cc',
                    activeGradientId: 'snapshot-gradient',
                  },
                ],
              },
            },
          },
        ],
        customBrushes: [],
      },
    };

    await expect(deserializeProjectWithReport(JSON.stringify(legacyProject))).rejects.toThrow(
      'Color-cycle layer layer-cc has ambiguous legacy activeGradientId sources.',
    );
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
    const manifestState = manifest.project.layers[0]?.state;
    expect(manifestState).toEqual(expect.objectContaining({
      version: 1,
      frameCount: 24,
      fps: 12,
      durationMs: 2000,
      encoding: 'chunked-events-v1',
      chunksRef: 'zip:buffers/sequential/layer-seq/chunks.json',
      brushSnapshotsRef: 'zip:buffers/sequential/layer-seq/brush-snapshots.json',
    }));
    expect(manifest.project.layers[0]?.sequentialData).toBeUndefined();
    expect(manifest.binaries?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'buffers/sequential/layer-seq/chunks.json',
        dtype: 'json',
      }),
      expect.objectContaining({
        path: 'buffers/sequential/layer-seq/brush-snapshots.json',
        dtype: 'json',
      }),
    ]));

    const restored = await deserializeProject(payload);
    const restoredLayer = restored.layers[0];

    expect(restoredLayer.layerType).toBe('sequential');
    expect(restoredLayer.sequentialData?.frameCount).toBe(sequentialLayer.sequentialData?.frameCount);
    expect(restoredLayer.sequentialData?.fps).toBe(sequentialLayer.sequentialData?.fps);
    expect(restoredLayer.sequentialData?.durationMs).toBe(sequentialLayer.sequentialData?.durationMs);
    expect(restoredLayer.sequentialData?.events).toHaveLength(1);
    const restoredEvent = restoredLayer.sequentialData?.events[0];
    expect(restoredEvent?.id).toBe('seq-event-1');
    expect(restoredEvent?.frameIndex).toBe(5);
    expect(restoredEvent?.timestampMs).toBe(250);
    expect(restoredEvent?.brush.pluginBrushId).toBe('dither-brush');
    expect(restoredEvent?.brush.pluginConfig).toEqual(expect.objectContaining({
      ditherAlgorithm: 'pattern',
      ditherIntensity: 67,
      ditherBayerMatrixSize: 8,
    }));
    expect(restoredEvent?.brush.ditherEnabled).toBe(true);
    expect(restoredEvent?.brush.ditherAlgorithm).toBe('pattern');
    expect(restoredEvent?.stamps[0].x).toBe(10);
    expect(restoredEvent?.stamps[0].y).toBe(12);
    expect(restoredEvent?.stamps[0].size).toBe(5);
    expect(restoredEvent?.stamps[0].alpha).toBeCloseTo(0.7, 2);
    expect(restoredEvent?.stamps[0].pressure).toBeCloseTo(0.8, 2);
    expect(restoredEvent?.stamps[0].rotation).toBeCloseTo(0.1, 3);
  });

  it('rejects dual-authority raster state when imageDataUrl is also persisted', async () => {
    const invalidProject = {
      ...minimalVesselProject,
      manifestVersion: 1,
      project: {
        ...minimalVesselProject.project,
        layers: [{
          id: 'layer-normal',
          name: 'Normal',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: 'data:application/json;base64,abc',
          layerType: 'normal',
          state: {
            version: 1,
            dimensions: { width: 10, height: 10 },
            imageRef: 'zip:buffers/raster/layer-normal/image.json',
          },
        }],
      },
      binaries: {
        entries: [{
          version: 1,
          path: 'buffers/raster/layer-normal/image.json',
          checksum: 'deadbeef',
          byteLength: 3,
          dtype: 'json',
          width: 10,
          height: 10,
          compression: 'deflate',
        }],
      },
    };

    await expect(readProjectManifest(JSON.stringify(invalidProject))).rejects.toThrow(
      'Dual-authority raster layer payload detected for layer-normal',
    );
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

  it('returns repair metadata when sequential legacy payloads are sanitized', async () => {
    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-seq-report',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-seq-report-project',
        name: 'legacy-seq-report',
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

    const result = await deserializeProjectWithReport(JSON.stringify(legacyProject));

    expect(result.migration.shouldMarkDirty).toBe(true);
    expect(result.migration.repairs.map((repair) => repair.code)).toEqual(expect.arrayContaining([
      'legacy-sequential-missing-layer-type',
      'legacy-sequential-sanitized',
    ]));
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
    if (!manifestLayer?.state || !('chunksRef' in manifestLayer.state)) {
      throw new Error('Missing sequential state in serialized manifest');
    }

    manifestLayer.sequentialData = undefined;
    const zip = await JSZip.loadAsync(payload);
    zip.file('project.json', JSON.stringify(manifest));
    const rewrittenPayload = await zip.generateAsync({ type: 'uint8array' });

    const restored = await deserializeProject(rewrittenPayload);
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
