import JSZip from 'jszip';
import { deserializeProject, readProjectManifest, serializeProject } from '@/utils/projectIO';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

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
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    const payload = await serializeProject(project);
    const restored = await deserializeProject(payload);

    const restoredLayer1 = restored.layers[0];
    const restoredLayer2 = restored.layers[1];

    expect(readPixel(restoredLayer1.imageData, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(restoredLayer2.imageData, 0, 0)).toEqual([0, 0, 255, 255]);
  });
});
