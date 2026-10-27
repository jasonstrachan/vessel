import JSZip from 'jszip';

import { analyzeProjectArchiveRefs, deserializeProjectWithReport, getProjectHealthReport, readProjectHealthReport, readProjectManifest, repairDanglingColorCycleArchiveRefs, serializeProject } from '@/utils/projectIO';
import { repairAndExportProject } from '@/utils/projectRepairExport';
import { sanitizeDisplayFilters } from '@/lib/displayFilters';
import { fnv1aHash } from '@/utils/projectPersistence';

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

describe('projectRepairExport', () => {
  const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const contextProto = (globalThis as unknown as {
    CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
  }).CanvasRenderingContext2D?.prototype;
  const originalRect = contextProto?.rect;

  beforeAll(() => {
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          drawImage: jest.fn(),
          getImageData: jest.fn(() => new ImageData(this.width, this.height)),
          clearRect: jest.fn(),
          putImageData: jest.fn(),
        };
      }
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value: () => '',
    });
  });

  afterAll(() => {
    if (contextProto) {
      contextProto.rect = originalRect;
    }
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas;
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value: originalToDataURL,
    });
  });

  it('repairs a legacy project, saves a canonical copy, and reopens it with expected fidelity', async () => {
    let savedBytes = new Uint8Array(0);
    const fakeHandle = {
      name: 'legacy-repaired.vs',
      createWritable: jest.fn(async () => ({
        write: async (payload: { data: ArrayBuffer }) => {
          savedBytes = new Uint8Array(payload.data);
        },
        truncate: async () => {},
        close: async () => {},
        abort: async () => {},
      })),
    } as unknown as FileSystemFileHandle;

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
                      gradientIdBuffer: Buffer.from(Uint8Array.from([1, 2, 3, 4])).toString('base64'),
                    },
                    gradientDefStore: [
                      {
                        id: 1,
                        kind: 'linear',
                        stops: [
                          { position: 0, color: '#000000' },
                          { position: 1, color: '#ffffff' },
                        ],
                        hash: 'defs-1',
                        source: 'manual',
                        createdAtMs: 123,
                      },
                    ],
                    slotPalettes: [
                      {
                        slot: 0,
                        stops: [
                          { position: 0, color: '#000000' },
                          { position: 1, color: '#ffffff' },
                        ],
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

    const result = await repairAndExportProject(JSON.stringify(legacyProject), {
      fileName: 'legacy.tb',
      existingHandle: fakeHandle,
      confirmWrite: async () => true,
    });

    expect(result).not.toBeNull();
    expect(result?.summary.repairCount).toBeGreaterThan(0);
    expect(result?.fileName).toBe('legacy-repaired.vs');
    expect(savedBytes.byteLength).toBeGreaterThan(0);

    const reopened = await deserializeProjectWithReport(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ));
    const reopenedHealth = await readProjectHealthReport(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ));

    expect(reopened.project.layers[0]?.layerType).toBe('color-cycle');
    expect(reopened.project.layers[0]?.colorCycleData?.gradientDefStore?.[0]?.id).toBe(1);
    expect(reopened.project.layers[0]?.colorCycleData?.slotPalettes?.[0]?.slot).toBe(0);
    expect(reopened.project.layers[0]?.colorCycleData?.activeGradientId).toBe('gradient-1');
    expect(reopenedHealth.colorCycleDuplicationRiskLayers).toEqual([]);
    expect(reopenedHealth.unresolvedColorCycleDefLayers).toEqual([]);
  });

  it('repairs and reopens a legacy raster project while preserving raster pixels and filters', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('Canvas encoding disabled for raster repair test');
      },
    });

    try {
      let savedBytes = new Uint8Array(0);
      const fakeHandle = {
        name: 'legacy-raster-repaired.vs',
        createWritable: jest.fn(async () => ({
          write: async (payload: { data: ArrayBuffer }) => {
            savedBytes = new Uint8Array(payload.data);
          },
          truncate: async () => {},
          close: async () => {},
          abort: async () => {},
        })),
      } as unknown as FileSystemFileHandle;

      const rasterImage = new ImageData(
        new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 255,
          0, 0, 255, 255,
          255, 255, 0, 255,
        ]),
        2,
        2,
      );

      const inputDisplayFilters = [
        { id: 'pixelate', enabled: true, settings: { cellSize: 6 } },
        { id: 'bloom', enabled: true, settings: { blurRadius: 3, intensity: 0.4 } },
      ] as const;

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
          backgroundColor: '#101010',
          viewState: {
            zoom: 1.75,
            displayFilters: inputDisplayFilters,
          },
          layers: [
            {
              id: 'layer-raster',
              name: 'Legacy Raster',
              visible: true,
              opacity: 1,
              blendMode: 'source-over',
              locked: false,
              order: 0,
              imageDataUrl: encodeRawImageDataUrl(rasterImage),
            },
          ],
          customBrushes: [],
        },
      };

      const result = await repairAndExportProject(JSON.stringify(legacyProject), {
        fileName: 'legacy-raster.tb',
        existingHandle: fakeHandle,
        confirmWrite: async () => true,
      });

      expect(result).not.toBeNull();
      expect(result?.fileName).toBe('legacy-raster-repaired.vs');
      expect(savedBytes.byteLength).toBeGreaterThan(0);

      const reopened = await deserializeProjectWithReport(savedBytes.buffer.slice(
        savedBytes.byteOffset,
        savedBytes.byteOffset + savedBytes.byteLength,
      ));

      expect(reopened.project.viewState?.zoom).toBeCloseTo(1.75, 2);
      expect(reopened.project.viewState?.displayFilters).toEqual(
        sanitizeDisplayFilters([...inputDisplayFilters]),
      );

      const rasterLayer = reopened.project.layers.find((layer) => layer.id === 'layer-raster');
      expect(rasterLayer?.layerType).toBe('normal');
      expect(rasterLayer?.imageData?.width).toBe(2);
      expect(rasterLayer?.imageData?.height).toBe(2);
      expect(Array.from(rasterLayer?.imageData?.data ?? [])).toEqual(Array.from(rasterImage.data));
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        configurable: true,
        writable: true,
        value: () => '',
      });
    }
  });

  it('repairs and reopens legacy sequential and color-cycle projects while preserving dithered runtime metadata', async () => {
    let savedBytes = new Uint8Array(0);
    const fakeHandle = {
      name: 'legacy-runtime-repaired.vs',
      createWritable: jest.fn(async () => ({
        write: async (payload: { data: ArrayBuffer }) => {
          savedBytes = new Uint8Array(payload.data);
        },
        truncate: async () => {},
        close: async () => {},
        abort: async () => {},
      })),
    } as unknown as FileSystemFileHandle;

    const legacyProject = {
      version: '1.0.0',
      metadata: {
        name: 'legacy-runtime-repair',
        created: '2025-01-01T00:00:00.000Z',
        modified: '2025-01-01T00:00:00.000Z',
        appVersion: '1.0.0',
      },
      project: {
        id: 'legacy-runtime-repair-project',
        name: 'legacy-runtime-repair',
        width: 2,
        height: 2,
        backgroundColor: '#101010',
        viewState: {
          zoom: 1.75,
          displayFilters: [
            { id: 'pixelate', enabled: true, settings: { cellSize: 6 } },
            { id: 'bloom', enabled: true, settings: { blurRadius: 3, intensity: 0.4 } },
          ],
        },
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
                stampDitherClears: true,
                stampDitherPressureLinked: true,
                pxlEdgeEnabled: true,
                layers: [
                  {
                    layerId: 'layer-cc',
                    strokeData: {
                      gradientIdBuffer: Buffer.from(Uint8Array.from([1, 1, 2, 2])).toString('base64'),
                    },
                    gradientDefStore: [
                      {
                        id: 1,
                        kind: 'linear',
                        stops: [
                          { position: 0, color: '#000000' },
                          { position: 1, color: '#ffffff' },
                        ],
                        hash: 'defs-1',
                        source: 'manual',
                        createdAtMs: 123,
                        slot: 0,
                      },
                      {
                        id: 2,
                        kind: 'linear',
                        stops: [
                          { position: 0, color: '#ff0000' },
                          { position: 1, color: '#00ff00' },
                        ],
                        hash: 'defs-2',
                        source: 'manual',
                        createdAtMs: 124,
                        slot: 1,
                      },
                    ],
                    slotPalettes: [
                      {
                        slot: 0,
                        stops: [
                          { position: 0, color: '#000000' },
                          { position: 1, color: '#ffffff' },
                        ],
                      },
                      {
                        slot: 1,
                        stops: [
                          { position: 0, color: '#ff0000' },
                          { position: 1, color: '#00ff00' },
                        ],
                      },
                    ],
                    nextGradientDefId: 3,
                    activeGradientId: 'gradient-2',
                  },
                ],
              },
            },
          },
          {
            id: 'layer-seq',
            name: 'Legacy Sequential',
            visible: true,
            opacity: 0.8,
            blendMode: 'multiply',
            locked: false,
            order: 1,
            imageDataUrl: '',
            sequentialData: {
              frameCount: 12,
              fps: 12,
              durationMs: 1000,
              events: [
                {
                  id: 'seq-event-1',
                  layerId: 'layer-seq',
                  strokeId: 'stroke-1',
                  timestampMs: 120,
                  frameIndex: 4,
                  brush: {
                    tool: 'brush',
                    brushShape: 'round',
                    size: 8,
                    opacity: 0.75,
                    blendMode: 'source-over',
                    rotation: 0.1,
                    spacing: 1,
                    color: '#ff00ff',
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
                  stamps: [{ x: 1, y: 1, pressure: 0.9, rotation: 0.2, size: 6, alpha: 0.8 }],
                },
              ],
            },
          },
        ],
        customBrushes: [],
      },
    };

    const result = await repairAndExportProject(JSON.stringify(legacyProject), {
      fileName: 'legacy-runtime.tb',
      existingHandle: fakeHandle,
      confirmWrite: async () => true,
    });

    expect(result).not.toBeNull();
    expect(result?.summary.repairCount).toBeGreaterThan(0);
    expect(result?.fileName).toBe('legacy-runtime-repaired.vs');
    expect(savedBytes.byteLength).toBeGreaterThan(0);

    const reopened = await deserializeProjectWithReport(savedBytes.buffer.slice(
      savedBytes.byteOffset,
      savedBytes.byteOffset + savedBytes.byteLength,
    ));

    expect(reopened.project.viewState?.zoom).toBeCloseTo(1.75, 2);
    expect(reopened.project.viewState?.displayFilters).toEqual(sanitizeDisplayFilters([
      { id: 'pixelate', enabled: true, settings: { cellSize: 6 } },
      { id: 'bloom', enabled: true, settings: { blurRadius: 3, intensity: 0.4 } },
    ]));

    const colorCycleLayer = reopened.project.layers.find((layer) => layer.id === 'layer-cc');
    const sequentialLayer = reopened.project.layers.find((layer) => layer.id === 'layer-seq');

    expect(colorCycleLayer?.layerType).toBe('color-cycle');
    expect(colorCycleLayer?.colorCycleData?.gradientDefStore?.map((entry) => entry.id)).toEqual([1, 2]);
    expect(colorCycleLayer?.colorCycleData?.slotPalettes?.map((entry) => entry.slot)).toEqual([0, 1]);
    expect(colorCycleLayer?.colorCycleData?.activeGradientId).toBe('gradient-2');
    expect(colorCycleLayer?.colorCycleData?.brushState).toEqual(expect.objectContaining({
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
      stampDitherClears: true,
      stampDitherPressureLinked: true,
      pxlEdgeEnabled: true,
    }));

    expect(sequentialLayer?.layerType).toBe('sequential');
    expect(sequentialLayer?.sequentialData?.frameCount).toBe(12);
    expect(sequentialLayer?.sequentialData?.fps).toBe(12);
    expect(sequentialLayer?.sequentialData?.durationMs).toBe(1000);
    expect(sequentialLayer?.sequentialData?.events).toHaveLength(1);
    expect(sequentialLayer?.sequentialData?.events[0]?.brush.pluginBrushId).toBe('dither-brush');
    expect(sequentialLayer?.sequentialData?.events[0]?.brush.pluginConfig).toEqual(expect.objectContaining({
      ditherAlgorithm: 'pattern',
      ditherIntensity: 67,
      ditherBayerMatrixSize: 8,
    }));
    expect(sequentialLayer?.sequentialData?.events[0]?.brush.ditherEnabled).toBe(true);
  }, 15000);

  it('repairs, saves, and reopens a mixed legacy project across raster, color-cycle, and sequential layers', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('Canvas encoding disabled for mixed repair test');
      },
    });

    try {
      let savedBytes = new Uint8Array(0);
      const fakeHandle = {
        name: 'legacy-mixed-repaired.vs',
        createWritable: jest.fn(async () => ({
          write: async (payload: { data: ArrayBuffer }) => {
            savedBytes = new Uint8Array(payload.data);
          },
          truncate: async () => {},
          close: async () => {},
          abort: async () => {},
        })),
      } as unknown as FileSystemFileHandle;

      const rasterImage = new ImageData(
        new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 255,
          0, 0, 255, 255,
          255, 255, 0, 255,
        ]),
        2,
        2,
      );

      const legacyProject = {
        version: '1.0.0',
        metadata: {
          name: 'legacy-mixed-repair',
          created: '2025-01-01T00:00:00.000Z',
          modified: '2025-01-01T00:00:00.000Z',
          appVersion: '1.0.0',
        },
        project: {
          id: 'legacy-mixed-repair-project',
          name: 'legacy-mixed-repair',
          width: 2,
          height: 2,
          backgroundColor: '#101010',
          viewState: {
            zoom: 2,
            displayFilters: [
              { id: 'pixelate', enabled: true, settings: { cellSize: 4 } },
              { id: 'bloom', enabled: true, settings: { blurRadius: 2, intensity: 0.35 } },
            ],
          },
          layers: [
            {
              id: 'layer-raster',
              name: 'Legacy Raster',
              visible: true,
              opacity: 1,
              blendMode: 'source-over',
              locked: false,
              order: 0,
              imageDataUrl: encodeRawImageDataUrl(rasterImage),
            },
            {
              id: 'layer-cc',
              name: 'Legacy CC',
              visible: true,
              opacity: 0.9,
              blendMode: 'source-over',
              locked: false,
              order: 1,
              imageDataUrl: '',
              colorCycleData: {
                brushState: {
                  ditherEnabled: true,
                  ditherStrength: 0.5,
                  ditherPixelSize: 3,
                  layers: [
                    {
                      layerId: 'layer-cc',
                      strokeData: {
                        gradientIdBuffer: Buffer.from(Uint8Array.from([1, 1, 2, 2])).toString('base64'),
                      },
                      gradientDefStore: [
                        {
                          id: 1,
                          kind: 'linear',
                          stops: [
                            { position: 0, color: '#000000' },
                            { position: 1, color: '#ffffff' },
                          ],
                          hash: 'defs-1',
                          source: 'manual',
                          createdAtMs: 123,
                          slot: 0,
                        },
                        {
                          id: 2,
                          kind: 'linear',
                          stops: [
                            { position: 0, color: '#ff0000' },
                            { position: 1, color: '#00ff00' },
                          ],
                          hash: 'defs-2',
                          source: 'manual',
                          createdAtMs: 124,
                          slot: 1,
                        },
                      ],
                      slotPalettes: [
                        {
                          slot: 0,
                          stops: [
                            { position: 0, color: '#000000' },
                            { position: 1, color: '#ffffff' },
                          ],
                        },
                        {
                          slot: 1,
                          stops: [
                            { position: 0, color: '#ff0000' },
                            { position: 1, color: '#00ff00' },
                          ],
                        },
                      ],
                      nextGradientDefId: 3,
                      activeGradientId: 'gradient-2',
                    },
                  ],
                },
              },
            },
            {
              id: 'layer-seq',
              name: 'Legacy Sequential',
              visible: true,
              opacity: 0.8,
              blendMode: 'multiply',
              locked: false,
              order: 2,
              imageDataUrl: '',
              sequentialData: {
                frameCount: 12,
                fps: 12,
                durationMs: 1000,
                events: [
                  {
                    id: 'seq-event-1',
                    layerId: 'layer-seq',
                    strokeId: 'stroke-1',
                    timestampMs: 120,
                    frameIndex: 4,
                    brush: {
                      tool: 'brush',
                      brushShape: 'round',
                      size: 8,
                      opacity: 0.75,
                      blendMode: 'source-over',
                      rotation: 0.1,
                      spacing: 1,
                      color: '#ff00ff',
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
                    stamps: [{ x: 1, y: 1, pressure: 0.9, rotation: 0.2, size: 6, alpha: 0.8 }],
                  },
                ],
              },
            },
          ],
          customBrushes: [],
        },
      };

      const result = await repairAndExportProject(JSON.stringify(legacyProject), {
        fileName: 'legacy-mixed.tb',
        existingHandle: fakeHandle,
        confirmWrite: async () => true,
      });

      expect(result).not.toBeNull();
      expect(result?.summary.repairCount).toBeGreaterThan(0);
      expect(result?.fileName).toBe('legacy-mixed-repaired.vs');
      expect(savedBytes.byteLength).toBeGreaterThan(0);

      const reopened = await deserializeProjectWithReport(savedBytes.buffer.slice(
        savedBytes.byteOffset,
        savedBytes.byteOffset + savedBytes.byteLength,
      ));

      expect(reopened.project.viewState?.zoom).toBeCloseTo(2, 2);
      expect(reopened.project.viewState?.displayFilters).toEqual(sanitizeDisplayFilters([
        { id: 'pixelate', enabled: true, settings: { cellSize: 4 } },
        { id: 'bloom', enabled: true, settings: { blurRadius: 2, intensity: 0.35 } },
      ]));

      const rasterLayer = reopened.project.layers.find((layer) => layer.id === 'layer-raster');
      const colorCycleLayer = reopened.project.layers.find((layer) => layer.id === 'layer-cc');
      const sequentialLayer = reopened.project.layers.find((layer) => layer.id === 'layer-seq');

      expect(rasterLayer?.layerType).toBe('normal');
      expect(Array.from(rasterLayer?.imageData?.data ?? [])).toEqual(Array.from(rasterImage.data));

      expect(colorCycleLayer?.layerType).toBe('color-cycle');
      expect(colorCycleLayer?.colorCycleData?.gradientDefStore?.map((entry) => entry.id)).toEqual([1, 2]);
      expect(colorCycleLayer?.colorCycleData?.slotPalettes?.map((entry) => entry.slot)).toEqual([0, 1]);
      expect(colorCycleLayer?.colorCycleData?.activeGradientId).toBe('gradient-2');
      expect(colorCycleLayer?.colorCycleData?.brushState).toEqual(expect.objectContaining({
        ditherEnabled: true,
        ditherStrength: 0.5,
        ditherPixelSize: 3,
      }));

      expect(sequentialLayer?.layerType).toBe('sequential');
      expect(sequentialLayer?.sequentialData?.frameCount).toBe(12);
      expect(sequentialLayer?.sequentialData?.events).toHaveLength(1);
      expect(sequentialLayer?.sequentialData?.events[0]?.brush.pluginBrushId).toBe('dither-brush');
      expect(sequentialLayer?.sequentialData?.events[0]?.brush.ditherEnabled).toBe(true);
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        configurable: true,
        writable: true,
        value: () => '',
      });
    }
  }, 15000);
  const createDeclaredPaintArchive = async (missingPaint: boolean, intactMotion = false) => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 255, 255,
    ]);
    const preview = encodeRawImageDataUrl(new ImageData(pixels, 2, 2));
    const previewBytes = new TextEncoder().encode(preview);
    const paint = new Uint8Array([255, 0, 0, 255]);
    const paintPath = 'buffers/color-cycle/repair-cc/paint.bin';
    const previewPath = 'buffers/color-cycle/repair-cc/canvas-image.txt';
    const motion = { speed: new Uint8Array([12, 0, 0, 23]), flow: new Uint8Array([1, 2, 3, 4]), phase: new Uint8Array([5, 6, 7, 8]) };
    const motionEntries = Object.entries(motion).map(([name, bytes]) => ({ version: 1, path: `buffers/color-cycle/repair-cc/${name}.bin`, checksum: fnv1aHash(bytes), byteLength: bytes.byteLength, dtype: 'uint8', compression: 'deflate' }));
    const archive = new JSZip();
    archive.file('project.json', JSON.stringify({
      version: '1.0.0',
      manifestVersion: 1,
      metadata: { name: 'declared-paint', created: '2025-01-01T00:00:00.000Z', modified: '2025-01-01T00:00:00.000Z', appVersion: '1.0.0' },
      project: {
        id: 'declared-paint-project', name: 'declared-paint', width: 2, height: 2,
        backgroundColor: 'transparent', customBrushes: [],
        layers: [{
          id: 'repair-cc', name: 'Repair CC', visible: true, opacity: 1,
          blendMode: 'source-over', locked: false, order: 0, imageDataUrl: '',
          layerType: 'color-cycle',
          state: { version: 1, dimensions: { width: 2, height: 2 }, paintRef: `zip:${paintPath}`, hasContent: true, ...(intactMotion ? { speedRef: 'zip:buffers/color-cycle/repair-cc/speed.bin', flowRef: 'zip:buffers/color-cycle/repair-cc/flow.bin', phaseRef: 'zip:buffers/color-cycle/repair-cc/phase.bin' } : {}) },
          colorCycleData: { canvasImageData: `zip:${previewPath}` },
        }],
      },
      binaries: { entries: [
        ...(intactMotion ? motionEntries : []),
        { version: 1, path: paintPath, checksum: fnv1aHash(paint), byteLength: paint.byteLength, dtype: 'uint8', compression: 'deflate' },
        { version: 1, path: previewPath, checksum: fnv1aHash(previewBytes), byteLength: previewBytes.byteLength, dtype: 'unknown', compression: 'deflate' },
      ] },
    }));
    archive.file(previewPath, preview);
    if (intactMotion) for (const [name, bytes] of Object.entries(motion)) archive.file(`buffers/color-cycle/repair-cc/${name}.bin`, bytes);
    if (!missingPaint) archive.file(paintPath, paint);
    return { bytes: await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), pixels, preview, paintPath, motion };
  };

  it.each([false, true])('reaches explicit confirmation for a declared but missing paint payload (accept=%s)', async (accept) => {
    const input = await createDeclaredPaintArchive(true, true);
    const originalBytes = input.bytes.slice();
    // This is the reported mismatch: health accepts the declared manifest while
    // archive analysis sees that the actual canonical payload is absent.
    await expect(readProjectHealthReport(input.bytes)).resolves.toBeDefined();
    expect((await analyzeProjectArchiveRefs(input.bytes)).canRepairDanglingColorCycleRefs).toBe(true);
    const originalPicker = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
    const originalEncoding = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toDataURL');
    let savedBytes: Uint8Array = new Uint8Array(0);
    const write = jest.fn(async (payload: { data: ArrayBuffer }) => { savedBytes = new Uint8Array(payload.data); });
    const close = jest.fn(async () => {});
    const newHandle = { name: 'damaged-repaired.vs', createWritable: jest.fn(async () => ({ write, truncate: async () => {}, close, abort: async () => {} })) } as unknown as FileSystemFileHandle;
    const existingHandle = { createWritable: jest.fn() } as unknown as FileSystemFileHandle;
    const picker = jest.fn(async () => newHandle);
    const confirmWrite = jest.fn(async () => accept);
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', { configurable: true, value: () => { throw new Error('Use raw image I/O boundary'); } });
    try {
      const result = await repairAndExportProject(input.bytes, { fileName: 'damaged.vs', existingHandle, confirmWrite });
      expect(confirmWrite).toHaveBeenCalledTimes(1);
      expect(confirmWrite).toHaveBeenCalledWith(expect.objectContaining({
        confirmationMessage: expect.stringContaining(input.paintPath),
        semanticRepairCount: expect.any(Number),
      }));
      expect(existingHandle.createWritable).not.toHaveBeenCalled();
      expect(input.bytes).toEqual(originalBytes);
      if (!accept) {
        expect(result).toBeNull();
        expect(picker).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        return;
      }
      expect(result?.fileName).toBe('damaged-repaired.vs');
      expect(picker).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(result?.project.layers[0]?.colorCycleData?.repairStatus).toEqual(expect.objectContaining({ ok: false, reason: 'missing-paint-buffer' }));
      const repairedPixels = result?.project.layers[0]?.colorCycleData?.canvasImageData;
      expect(repairedPixels).toBeInstanceOf(ImageData);
      expect(Array.from((repairedPixels as ImageData).data)).toEqual(Array.from(input.pixels));
      const manifest = await readProjectManifest(savedBytes);
      expect((await analyzeProjectArchiveRefs(savedBytes)).missingCanonicalColorCycleRefs).toEqual([]);
      expect(manifest.project.layers[0]?.colorCycleData?.repairStatus).toEqual(expect.objectContaining({ ok: false, reason: 'missing-paint-buffer' }));
      const output = await JSZip.loadAsync(savedBytes);
      const layer = manifest.project.layers[0];
      const ref = layer?.colorCycleData?.canvasImageData;
      expect(typeof ref).toBe('string');
      const preview = ref?.startsWith('zip:') ? await output.file(ref.slice(4))!.async('string') : ref;
      expect(preview).toBe(input.preview);
      expect(output.file(input.paintPath)).toBeNull();
      for (const [name, bytes] of Object.entries(input.motion)) {
        expect(await output.file(`buffers/color-cycle/repair-cc/${name}.bin`)!.async('uint8array')).toEqual(bytes);
      }
    } finally {
      if (originalPicker) Object.defineProperty(window, 'showSaveFilePicker', originalPicker);
      else Reflect.deleteProperty(window, 'showSaveFilePicker');
      if (originalEncoding) Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', originalEncoding);
    }
  });

  it('does not mutate repaired eager motion metadata across repeated health reports and saves', async () => {
    const input = await createDeclaredPaintArchive(true, true);
    const originalBytes = input.bytes.slice();
    const archive = (await repairDanglingColorCycleArchiveRefs(input.bytes)).archiveData;
    const { project } = await deserializeProjectWithReport(archive);
    const layer = project.layers[0];
    const sourceBefore = JSON.stringify(layer.colorCycleData?.brushState);
    expect(sourceBefore).toContain(Buffer.from(input.motion.speed).toString('base64'));
    expect(sourceBefore).not.toContain('zip:');
    for (let round = 0; round < 2; round += 1) {
      await getProjectHealthReport(project, project.layers);
      expect(JSON.stringify(layer.colorCycleData?.brushState)).toBe(sourceBefore);
      const saved = await serializeProject(project, project.layers);
      expect(JSON.stringify(layer.colorCycleData?.brushState)).toBe(sourceBefore);
      const output = await JSZip.loadAsync(saved);
      for (const [name, bytes] of Object.entries(input.motion)) {
        expect(await output.file(`buffers/color-cycle/repair-cc/${name}.bin`)!.async('uint8array')).toEqual(bytes);
      }
      expect((await analyzeProjectArchiveRefs(saved)).issues).toEqual([]);
    }
    expect(input.bytes).toEqual(originalBytes);
  });

});
