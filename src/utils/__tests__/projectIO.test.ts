import JSZip from 'jszip';
import { deserializeProject, readProjectManifest, serializeProject } from '@/utils/projectIO';
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

describe('projectIO serialize/deserialize layering', () => {
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
});
