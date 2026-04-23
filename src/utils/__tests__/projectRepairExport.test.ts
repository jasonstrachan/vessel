import { deserializeProjectWithReport, readProjectHealthReport } from '@/utils/projectIO';
import { repairAndExportProject } from '@/utils/projectRepairExport';
import { sanitizeDisplayFilters } from '@/lib/displayFilters';

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
});
