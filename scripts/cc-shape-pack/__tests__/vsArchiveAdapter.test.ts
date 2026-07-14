import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import sharp from 'sharp';

import { packVsArchiveColorCycleShapes } from '../vsArchiveAdapter';
import { validateProjectFile } from '@/utils/projectIO';

const hash = (bytes: Uint8Array): string => {
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
};

const buildFixture = async (): Promise<{
  bytes: Uint8Array;
  selectedPaintPath: string;
  unselectedPaintPath: string;
  unselectedPaint: Uint8Array;
}> => {
  const zip = new JSZip();
  const width = 4;
  const height = 3;
  const pixels = width * height;
  const selectedPaintPath = 'buffers/color-cycle/selected/paint.bin';
  const unselectedPaintPath = 'buffers/color-cycle/unselected/paint.bin';
  const entries: Array<Record<string, unknown>> = [];
  const add = (path: string, bytes: Uint8Array, dtype: 'uint8' | 'uint16' = 'uint8') => {
    zip.file(path, bytes);
    entries.push({
      version: 1,
      path,
      checksum: hash(bytes),
      byteLength: bytes.byteLength,
      dtype,
      width,
      height,
      encoding: 'raw',
      compression: 'deflate',
    });
  };
  const addLayerBuffers = (layerId: string, paint: Uint8Array) => {
    const base = `buffers/color-cycle/${layerId}`;
    add(`${base}/paint.bin`, paint);
    add(`${base}/gradient-id.bin`, Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 2 : 0));
    const defs = Uint16Array.from({ length: pixels }, (_, index) => paint[index] ? 400 : 0);
    add(`${base}/gradient-def-id.bin`, new Uint8Array(defs.buffer), 'uint16');
    add(`${base}/speed.bin`, Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 100 : 0));
    add(`${base}/flow.bin`, Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 1 : 0));
    add(`${base}/phase.bin`, Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 7 : 0));
  };
  const selectedPaint = Uint8Array.from([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 0, 0,
  ]);
  const unselectedPaint = Uint8Array.from([
    0, 0, 1, 1,
    0, 0, 1, 1,
    0, 0, 0, 0,
  ]);
  addLayerBuffers('selected', selectedPaint);
  addLayerBuffers('unselected', unselectedPaint);
  const previewDataUrl = async (paint: Uint8Array, rgb: readonly [number, number, number]): Promise<string> => {
    const rgba = new Uint8Array(pixels * 4);
    paint.forEach((value, index) => {
      if (!value) return;
      rgba.set([...rgb, 255], index * 4);
    });
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  const selectedPreview = await previewDataUrl(selectedPaint, [255, 0, 0]);
  const unselectedPreview = await previewDataUrl(unselectedPaint, [0, 255, 0]);
  const layer = (id: string, name: string, canvasImageData: string) => ({
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: id === 'selected' ? 0 : 1,
    imageDataUrl: '',
    layerType: 'color-cycle',
    colorCycleData: { documentId: id, canvasWidth: width, canvasHeight: height, canvasImageData },
    state: {
      version: 1,
      dimensions: { width, height },
      paintRef: `zip:buffers/color-cycle/${id}/paint.bin`,
      gradientIdRef: `zip:buffers/color-cycle/${id}/gradient-id.bin`,
      gradientDefIdRef: `zip:buffers/color-cycle/${id}/gradient-def-id.bin`,
      speedRef: `zip:buffers/color-cycle/${id}/speed.bin`,
      flowRef: `zip:buffers/color-cycle/${id}/flow.bin`,
      phaseRef: `zip:buffers/color-cycle/${id}/phase.bin`,
      hasContent: true,
    },
  });
  zip.file('project.json', JSON.stringify({
    version: '3.0.0',
    manifestVersion: 1,
    metadata: {
      name: 'Packing Fixture',
      created: '2026-07-11T00:00:00.000Z',
      modified: '2026-07-11T00:00:00.000Z',
      appVersion: '3.0.0',
    },
    project: {
      id: 'fixture',
      name: 'Packing Fixture',
      width,
      height,
      backgroundColor: '#000000',
      layers: [
        layer('selected', 'Selected', selectedPreview),
        layer('unselected', 'Unselected', unselectedPreview),
      ],
      customBrushes: [],
    },
    binaries: { entries },
  }));
  zip.file('manifest.json', JSON.stringify({
    version: '3.0.0',
    metadata: { name: 'Packing Fixture', created: '', modified: '', appVersion: '3.0.0' },
    project: { id: 'fixture', name: 'Packing Fixture', width, height },
    preview: { dataUrl: 'stale', width: 1, height: 1 },
  }));
  return {
    bytes: await zip.generateAsync({ type: 'uint8array' }),
    selectedPaintPath,
    unselectedPaintPath,
    unselectedPaint,
  };
};

describe('VS archive CC shape packer', () => {
  it('rejects VS-only packing flags for Goblet inputs before reading the artifact', () => {
    const result = spawnSync(process.execPath, [
      'scripts/cc-shape-pack.js',
      'missing.goblet.json',
      '--dry-run',
      '--layers',
      'CC Layer',
      '--shape-scale',
      '0.5',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported-goblet-packing-option');
    expect(result.stderr).toContain('--shape-scale');
  });

  it('removes rendered proof files when the next CLI run cannot regenerate them', async () => {
    const fixture = await buildFixture();
    const zip = await JSZip.loadAsync(fixture.bytes);
    const archive = JSON.parse(await zip.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string; colorCycleData: Record<string, unknown> }> };
    };
    const selectedLayer = archive.project.layers.find((layer) => layer.id === 'selected')!;
    delete selectedLayer.colorCycleData.canvasImageData;
    zip.file('project.json', JSON.stringify(archive));

    const directory = await mkdtemp(path.join(tmpdir(), 'vessel-cc-cli-review-'));
    const inputPath = path.join(directory, 'input.vs');
    const configPath = path.join(directory, 'config.json');
    const reportDir = path.join(directory, 'report');
    const renderedPreviewPath = path.join(reportDir, 'packing-preview-rendered.png');
    const renderedContactSheetPath = path.join(reportDir, 'shape-contact-sheet-rendered.png');
    try {
      await mkdir(reportDir);
      await Promise.all([
        writeFile(inputPath, await zip.generateAsync({ type: 'uint8array' })),
        writeFile(configPath, JSON.stringify({ separation: { selected: { expectedShapeCount: 1 } } })),
        writeFile(renderedPreviewPath, 'stale'),
        writeFile(renderedContactSheetPath, 'stale'),
      ]);

      const result = spawnSync(process.execPath, [
        'scripts/cc-shape-pack.js',
        inputPath,
        '--dry-run',
        '--layer-ids',
        'selected',
        '--config',
        configPath,
        '--report-dir',
        reportDir,
        '--no-largest-cc-background',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      await expect(access(renderedPreviewPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(renderedContactSheetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns the original archive unchanged for a diagnostics-only partial packing', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }, { id: 'unselected' }],
      destinationLayerId: 'selected',
      separationByLayerId: {
        selected: { expectedShapeCount: 1 },
        unselected: { expectedShapeCount: 1 },
      },
      allowPartialPreview: true,
      padding: 1,
      rotations: [0],
    });

    expect(result.packing.placements.length).toBeLessThan(result.sourceShapeCount);
    expect(result.archiveData).toEqual(fixture.bytes);
  });

  it('rewrites only the selected canonical buffers and clears the stale preview', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const selectedPaint = await output.file(fixture.selectedPaintPath)?.async('uint8array');
    const unselectedPaint = await output.file(fixture.unselectedPaintPath)?.async('uint8array');
    const preview = JSON.parse(await output.file('manifest.json')!.async('string')) as { preview?: unknown };
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string; colorCycleData?: { canvasImageData?: string } }> };
    };
    const packedCanvasImage = archive.project.layers.find((layer) => layer.id === 'selected')
      ?.colorCycleData?.canvasImageData;
    expect(selectedPaint).toEqual(Uint8Array.from([
      0, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]));
    expect(unselectedPaint).toEqual(fixture.unselectedPaint);
    expect(packedCanvasImage).toMatch(/^data:image\/png;base64,/);
    expect(result.renderedPreviewPng).toBeDefined();
    expect(preview.preview).toBeUndefined();
    expect(result.selectedLayerIds).toEqual(['selected']);
    expect(result.packing.placements[0].y).toBe(1);
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('consolidates multiple selected layers into one destination archive layer', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }, { id: 'unselected' }],
      destinationLayerId: 'selected',
      separationByLayerId: {
        selected: { expectedShapeCount: 1 },
        unselected: { expectedShapeCount: 1 },
      },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string }> };
    };
    const destinationPaint = await output.file(fixture.selectedPaintPath)?.async('uint8array');
    expect(archive.project.layers.map((layer) => layer.id)).toEqual(['selected']);
    expect(destinationPaint?.filter(Boolean)).toHaveLength(8);
    expect(result.selectedLayerIds).toEqual(['selected', 'unselected']);
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('preserves selected CC layers when packing across an interleaved stack', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }, { id: 'unselected' }],
      preserveSelectedCcLayers: true,
      separationByLayerId: {
        selected: { expectedShapeCount: 1 },
        unselected: { expectedShapeCount: 1 },
      },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string }> };
    };
    const selectedPaint = await output.file(fixture.selectedPaintPath)?.async('uint8array');
    const unselectedPaint = await output.file(fixture.unselectedPaintPath)?.async('uint8array');

    expect(archive.project.layers.map((layer) => layer.id)).toEqual(['selected', 'unselected']);
    expect(selectedPaint?.filter(Boolean)).toHaveLength(4);
    expect(unselectedPaint?.filter(Boolean)).toHaveLength(4);
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('stretches the largest CC shape edge-to-edge behind the foreground pack', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }, { id: 'unselected' }],
      largestCcShapeAsBackground: true,
      preserveSelectedCcLayers: true,
      separationByLayerId: {
        selected: { expectedShapeCount: 1 },
        unselected: { expectedShapeCount: 1 },
      },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: {
        layers: Array<{
          id: string;
          order: number;
          colorCycleData?: { canvasImageData?: string };
        }>;
      };
    };
    const backgroundPaint = await output.file(fixture.selectedPaintPath)?.async('uint8array');
    const foregroundPaint = await output.file(fixture.unselectedPaintPath)?.async('uint8array');
    const background = result.packing.placements[0];
    const foregroundPreviewDataUrl = archive.project.layers.find((layer) => layer.id === 'unselected')
      ?.colorCycleData?.canvasImageData;
    const foregroundPreview = await sharp(Buffer.from(
      foregroundPreviewDataUrl!.slice('data:image/png;base64,'.length),
      'base64',
    )).ensureAlpha().raw().toBuffer();
    const foregroundAlpha = Uint8Array.from(foregroundPreview).filter((_, index) => index % 4 === 3);

    expect(background.layerId).toBe('selected');
    expect(background.shapeId).toContain('background-copy');
    expect(background).toMatchObject({ x: 0, y: 0, rotation: 0 });
    expect(background.rotated).toMatchObject({ width: 4, height: 3 });
    expect(result.packing.placements.filter((placement) => placement.layerId === 'selected')).toHaveLength(2);
    expect(backgroundPaint?.filter(Boolean)).toHaveLength(12);
    expect(foregroundPaint?.filter(Boolean)).toHaveLength(4);
    expect(foregroundAlpha.filter(Boolean)).toHaveLength(4);
    expect(result.packing.metrics).toMatchObject({
      occupiedArea: 12,
      boundingWasteArea: 0,
      packingDensity: 1,
    });
    expect(archive.project.layers.map((layer) => [layer.id, layer.order])).toEqual([
      ['selected', 0],
      ['unselected', 1],
    ]);
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('honors an explicit destination layer when adding the background copy', async () => {
    const fixture = await buildFixture();

    const result = await packVsArchiveColorCycleShapes(fixture.bytes, {
      selectors: [{ id: 'selected' }, { id: 'unselected' }],
      destinationLayerId: 'unselected',
      largestCcShapeAsBackground: true,
      separationByLayerId: {
        selected: { expectedShapeCount: 1 },
        unselected: { expectedShapeCount: 1 },
      },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string; order: number }> };
    };
    const destinationPaint = await output.file(fixture.unselectedPaintPath)?.async('uint8array');

    expect(archive.project.layers.map((layer) => [layer.id, layer.order])).toEqual([
      ['unselected', 0],
    ]);
    expect(destinationPaint?.filter(Boolean)).toHaveLength(12);
    expect(result.packing.placements[0].shapeId).toContain('background-copy');
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('extracts and globally packs connected shapes from visible normal layers', async () => {
    const fixture = await buildFixture();
    const zip = await JSZip.loadAsync(fixture.bytes);
    const width = 4;
    const height = 3;
    const rgba = new Uint8Array(width * height * 4);
    rgba.set([10, 20, 30, 255], 0);
    rgba.set([40, 50, 60, 255], 3 * 4);
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const imageBytes = new Uint8Array(Buffer.from(imageDataUrl, 'utf8'));
    const imagePath = 'buffers/raster/normal/image.json';
    zip.file(imagePath, imageDataUrl);
    const archive = JSON.parse(await zip.file('project.json')!.async('string')) as {
      project: { layers: Array<Record<string, unknown>> };
      binaries: { entries: Array<Record<string, unknown>> };
    };
    archive.binaries.entries.push({
      version: 1,
      path: imagePath,
      checksum: hash(imageBytes),
      byteLength: imageBytes.byteLength,
      dtype: 'json',
      encoding: 'raw',
      compression: 'deflate',
    });
    archive.project.layers.push({
      id: 'normal',
      name: 'Normal',
      visible: true,
      opacity: 0.75,
      blendMode: 'multiply',
      locked: false,
      order: 2,
      imageDataUrl: '',
      layerType: 'normal',
      state: {
        version: 1,
        dimensions: { width, height },
        imageRef: `zip:${imagePath}`,
      },
    });
    zip.file('project.json', JSON.stringify(archive));

    const result = await packVsArchiveColorCycleShapes(
      await zip.generateAsync({ type: 'uint8array' }),
      {
        selectors: [{ id: 'selected' }],
        separationByLayerId: { selected: { expectedShapeCount: 1 } },
        includeVisibleRasterLayers: true,
        shapeScale: 0.5,
        padding: 0,
        rotations: [0],
      },
    );

    const output = await JSZip.loadAsync(result.archiveData);
    const packedArchive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: {
        layers: Array<{
          id: string;
          opacity: number;
          blendMode: string;
          state?: { imageRef?: string };
        }>;
      };
    };
    const normalLayer = packedArchive.project.layers.find((layer) => layer.id === 'normal');
    const packedImageDataUrl = await output.file(imagePath)!.async('string');
    const packedImage = await sharp(Buffer.from(
      packedImageDataUrl.slice('data:image/png;base64,'.length),
      'base64',
    )).ensureAlpha().raw().toBuffer();
    const alpha = Uint8Array.from(packedImage).filter((_, index) => index % 4 === 3);

    expect(result.sourceShapeCount).toBe(3);
    expect(result.packing.placements).toHaveLength(3);
    expect(result.packing.placements.find((placement) => placement.layerId === 'selected')?.rotated.width).toBe(1);
    expect(result.appliedShapeScale).toBe(0.5);
    expect(result.renderedContactSheetPng).toBeDefined();
    expect(result.selectedLayerIds).toEqual(['selected', 'normal']);
    expect(result.packing.placements.map((placement) => placement.layerId)).toContain('normal');
    expect(alpha.filter(Boolean)).toHaveLength(2);
    expect(normalLayer).toMatchObject({
      opacity: 0.75,
      blendMode: 'multiply',
      state: { imageRef: `zip:${imagePath}` },
    });
    await expect(validateProjectFile(result.archiveData)).resolves.toEqual({ valid: true });
  });

  it('automatically keeps the largest tested complete zero-overlap scale', async () => {
    const fixture = await buildFixture();
    const zip = await JSZip.loadAsync(fixture.bytes);
    const fullCanvasPaint = new Uint8Array(12).fill(1);
    zip.file(fixture.selectedPaintPath, fullCanvasPaint);
    const archive = JSON.parse(await zip.file('project.json')!.async('string')) as {
      binaries: { entries: Array<{ path: string; checksum: string; byteLength: number }> };
    };
    const paintEntry = archive.binaries.entries.find((entry) => entry.path === fixture.selectedPaintPath)!;
    paintEntry.checksum = hash(fullCanvasPaint);
    paintEntry.byteLength = fullCanvasPaint.byteLength;
    zip.file('project.json', JSON.stringify(archive));

    const result = await packVsArchiveColorCycleShapes(
      await zip.generateAsync({ type: 'uint8array' }),
      {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      autoFitWithoutOverlap: true,
      padding: 0,
      rotations: [0, 90],
      beamWidth: 1,
      },
    );

    expect(result.appliedShapeScale).toBe(1);
    expect(result.packing.placements).toHaveLength(1);
    expect(result.packing.placements[0].supportShapeIds).toEqual([]);
  });

  it('ignores retained soft-edge mask data when the saved mask is disabled', async () => {
    const fixture = await buildFixture();
    const zip = await JSZip.loadAsync(fixture.bytes);
    const archive = JSON.parse(await zip.file('project.json')!.async('string')) as {
      project: { layers: Array<{ id: string; colorCycleData: Record<string, unknown> }> };
    };
    const selected = archive.project.layers.find((layer) => layer.id === 'selected')!;
    selected.colorCycleData.softEdgeMaskEnabled = false;
    selected.colorCycleData.softEdgeMaskImageData =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwADAgH/5ncLrgAAAABJRU5ErkJggg==';
    zip.file('project.json', JSON.stringify(archive));

    const result = await packVsArchiveColorCycleShapes(
      await zip.generateAsync({ type: 'uint8array' }),
      {
        selectors: [{ id: 'selected' }],
        separationByLayerId: { selected: { expectedShapeCount: 1 } },
        padding: 0,
        rotations: [0],
      },
    );

    expect(result.sourceShapeCount).toBe(1);
  });

  it('packs legacy inline brush buffers and keeps the animator copy synchronized', async () => {
    const zip = new JSZip();
    const width = 4;
    const height = 3;
    const paint = Uint8Array.from([
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 0, 0,
    ]);
    const channel = (value: number) => Uint8Array.from(paint, (pixel) => pixel ? value : 0);
    const gradientDefIds = Uint16Array.from(paint, (pixel) => pixel ? 400 : 0);
    const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
    const strokeData = {
      hasContent: true,
      paintBuffer: base64(paint),
      gradientIdBuffer: base64(channel(2)),
      gradientDefIdBuffer: base64(new Uint8Array(gradientDefIds.buffer)),
      speedBuffer: base64(channel(100)),
      flowBuffer: base64(channel(1)),
    };
    const animatorIndex = {
      width,
      height,
      data: strokeData.paintBuffer,
      gradientId: strokeData.gradientIdBuffer,
      speedData: strokeData.speedBuffer,
      flowData: strokeData.flowBuffer,
      palette: [],
    };
    zip.file('project.json', JSON.stringify({
      version: '3.0.0',
      metadata: { name: 'Legacy', created: '', modified: '', appVersion: '3.0.0' },
      project: {
        id: 'legacy',
        name: 'Legacy',
        width,
        height,
        backgroundColor: '#000000',
        customBrushes: [],
        layers: [{
          id: 'selected',
          name: 'Selected',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          order: 0,
          imageDataUrl: '',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: width,
            canvasHeight: height,
            gradientIdBuffer: strokeData.gradientIdBuffer,
            gradientDefIdBuffer: strokeData.gradientDefIdBuffer,
            brushState: {
              layers: [{
                layerId: 'selected',
                strokeData,
                animator: {
                  indexBuffer: animatorIndex,
                  gradient: { gradientStops: [] },
                  animation: { offset: 0, stats: {} },
                },
              }],
            },
          },
        }],
      },
    }));

    const result = await packVsArchiveColorCycleShapes(await zip.generateAsync({ type: 'uint8array' }), {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    });

    const output = await JSZip.loadAsync(result.archiveData);
    const archive = JSON.parse(await output.file('project.json')!.async('string')) as {
      project: {
        layers: Array<{
          colorCycleData: {
            gradientIdBuffer: string;
            gradientDefIdBuffer: string;
            brushState: {
              layers: Array<{
                strokeData: Record<string, string>;
                animator: { indexBuffer: Record<string, string> };
              }>;
            };
          };
        }>;
      };
    };
    const colorCycleData = archive.project.layers[0].colorCycleData;
    const snapshot = colorCycleData.brushState.layers[0];
    const expectedPaint = Uint8Array.from([
      0, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]);
    expect(new Uint8Array(Buffer.from(snapshot.strokeData.paintBuffer, 'base64'))).toEqual(expectedPaint);
    expect(snapshot.animator.indexBuffer.data).toBe(snapshot.strokeData.paintBuffer);
    expect(snapshot.animator.indexBuffer.gradientId).toBe(snapshot.strokeData.gradientIdBuffer);
    expect(snapshot.animator.indexBuffer.phaseData).toBe(snapshot.strokeData.phaseBuffer);
    expect(colorCycleData.gradientIdBuffer).toBe(snapshot.strokeData.gradientIdBuffer);
    expect(colorCycleData.gradientDefIdBuffer).toBe(snapshot.strokeData.gradientDefIdBuffer);
  });
});
