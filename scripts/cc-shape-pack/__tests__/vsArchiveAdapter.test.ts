import JSZip from 'jszip';

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
  const layer = (id: string, name: string) => ({
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: id === 'selected' ? 0 : 1,
    imageDataUrl: '',
    layerType: 'color-cycle',
    colorCycleData: { documentId: id, canvasWidth: width, canvasHeight: height },
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
      layers: [layer('selected', 'Selected'), layer('unselected', 'Unselected')],
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
    expect(selectedPaint).toEqual(Uint8Array.from([
      0, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]));
    expect(unselectedPaint).toEqual(fixture.unselectedPaint);
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
    const pixels = width * height;
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
