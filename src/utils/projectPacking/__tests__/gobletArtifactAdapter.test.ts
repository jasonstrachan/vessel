import JSZip from 'jszip';

import {
  encodeGobletPackingPayload,
  packGobletArtifactColorCycleShapes,
} from '../../../../scripts/cc-shape-pack/gobletArtifactAdapter';
import { GOBLET_PROPERTY_MINIFY_MAP } from '@/utils/export/goblet/gobletMetadataSchema';
import type { WebGLExportMetadata, WebGLLayerMetadata } from '@/utils/export/goblet/gobletTypes';

const makeLayer = (id: string, name: string, x: number, values: number[]): WebGLLayerMetadata => ({
  id,
  name,
  type: 'color-cycle',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  source: { width: 2, height: 2 },
  documentBoundsPx: { x, y: 0, width: 2, height: 2 },
  documentBoundsPercent: { x: x * 25, y: 0, width: 50, height: 66.667 },
  alignment: {
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
  },
  colorCycle: {
    mode: 'brush',
    isAnimating: true,
    speedMode: 'slot',
    slotSpeeds: [{ slot: 1, speed: 1 }],
    slotPalettes: [{
      slot: 1,
      stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
    }],
    brushState: {
      width: 2,
      height: 2,
      indexBuffer: values,
      gradientIdBuffer: [1, 1, 1, 1],
      gradientDefIdBuffer: [400, 400, 400, 400],
      flowBuffer: [1, 1, 1, 1],
      phaseBuffer: [5, 6, 7, 8],
      gradientStops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
      animationOffset: 0,
      flowDirection: 'forward',
    },
  },
});

const makeMetadata = (): WebGLExportMetadata => ({
  format: 'vessel-goblet2',
  version: 1,
  exportedAt: '2026-07-11T00:00:00.000Z',
  project: {
    id: 'goblet-fixture',
    name: 'Goblet Fixture',
    width: 4,
    height: 3,
    backgroundColor: '#000000',
  },
  viewport: { mode: 'fixed', designWidth: 4, designHeight: 3 },
  container: {
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    sizeMode: 'fixed',
    width: 4,
    height: 3,
    flow: 'stack',
    wrap: false,
    gap: 0,
    align: 'start',
    justify: 'start',
  },
  animation: { fps: 24, totalFrames: 24, durationSeconds: 1, perfectLoop: true },
  settings: {
    includeHiddenLayers: true,
    embedCanvasFallback: false,
    minifyOutput: true,
    pixelPerfectStack: true,
    perfectLoop: true,
    bundleFormat: 'json',
    displayFilters: [],
    htmlTitle: 'Goblet Fixture',
    htmlBackgroundColor: '#000000',
    transparencyBackgroundMode: 'checker',
  },
  layers: [
    makeLayer('selected', 'Selected', 0, [1, 1, 1, 1]),
    makeLayer('unselected', 'Unselected', 2, [2, 2, 2, 2]),
  ],
});

const minify = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(minify);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    GOBLET_PROPERTY_MINIFY_MAP[key as keyof typeof GOBLET_PROPERTY_MINIFY_MAP] ?? key,
    minify(nested),
  ]));
};

describe('Goblet artifact CC shape packer', () => {
  it('returns the original artifact unchanged for a diagnostics-only partial packing', async () => {
    const input = new TextEncoder().encode(JSON.stringify(makeMetadata()));

    const result = await packGobletArtifactColorCycleShapes(input, {
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
    expect(result.artifactData).toEqual(input);
  });

  it('packs a selected JSON layer into full document coordinates without mutating unselected metadata', async () => {
    const metadata = makeMetadata();
    const unselectedBefore = JSON.parse(JSON.stringify(metadata.layers[1]));

    const result = await packGobletArtifactColorCycleShapes(
      new TextEncoder().encode(JSON.stringify(metadata)),
      {
        selectors: [{ id: 'selected' }],
        separationByLayerId: { selected: { expectedShapeCount: 1 } },
        padding: 0,
        rotations: [0],
      },
    );

    const output = JSON.parse(new TextDecoder().decode(result.artifactData)) as WebGLExportMetadata;
    const selected = output.layers[0];
    const brush = selected.colorCycle?.brushState;
    expect(brush?.width).toBe(4);
    expect(brush?.height).toBe(3);
    expect(brush?.indexBuffer).toEqual([
      0, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]);
    expect(selected.documentBoundsPx).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(selected.contentBounds).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(output.layers[1]).toEqual(unselectedBefore);
    expect(result.selectedLayerIds).toEqual(['selected']);
  });

  it('consolidates selected Goblet layers and their slot metadata into one destination', async () => {
    const metadata = makeMetadata();

    const result = await packGobletArtifactColorCycleShapes(
      new TextEncoder().encode(JSON.stringify(metadata)),
      {
        selectors: [{ id: 'selected' }, { id: 'unselected' }],
        destinationLayerId: 'selected',
        separationByLayerId: {
          selected: { expectedShapeCount: 1 },
          unselected: { expectedShapeCount: 1 },
        },
        padding: 0,
        rotations: [0],
      },
    );

    const output = JSON.parse(new TextDecoder().decode(result.artifactData)) as WebGLExportMetadata;
    const destination = output.layers[0];
    const paint = destination.colorCycle?.brushState?.indexBuffer as number[];
    const gradientIds = destination.colorCycle?.brushState?.gradientIdBuffer as number[];
    expect(output.layers.map((layer) => layer.id)).toEqual(['selected']);
    expect(paint.filter(Boolean)).toHaveLength(8);
    expect(new Set(gradientIds.filter(Boolean))).toEqual(new Set([1, 2]));
    expect(destination.colorCycle?.slotPalettes?.map((entry) => entry.slot)).toEqual([1, 2]);
    expect(destination.colorCycle?.slotSpeeds?.map((entry) => entry.slot)).toEqual([1, 2]);
  });

  it('preserves ZIP sidecar form and leaves unselected sidecars unchanged', async () => {
    const metadata = makeMetadata();
    metadata.settings.bundleFormat = 'zip-compat';
    const selected = metadata.layers[0].colorCycle!.brushState! as unknown as Record<string, unknown>;
    const zip = new JSZip();
    const selectedIndex = Uint8Array.from([1, 1, 1, 1]);
    const unselectedSidecar = Uint8Array.from([9, 8, 7, 6]);
    zip.file('buffers/selected-index.bin', selectedIndex);
    zip.file('buffers/unselected-proof.bin', unselectedSidecar);
    selected.indexBuffer = { ref: 'buffers/selected-index.bin', encoding: 'u8', byteLength: 4 };
    zip.file('fixture-goblet.json', JSON.stringify(metadata));
    zip.file('index.html', `<!doctype html><script>const packagedMetadataRaw = JSON.parse(\`${JSON.stringify(metadata)}\`);</script>`);
    const input = await zip.generateAsync({ type: 'uint8array' });

    const result = await packGobletArtifactColorCycleShapes(input, {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    });

    const outputZip = await JSZip.loadAsync(result.artifactData);
    const outputMetadata = JSON.parse(await outputZip.file('fixture-goblet.json')!.async('string')) as WebGLExportMetadata;
    const outputIndexRef = outputMetadata.layers[0].colorCycle?.brushState?.indexBuffer as unknown as { byteLength: number };
    expect(outputIndexRef.byteLength).toBe(12);
    expect(await outputZip.file('buffers/selected-index.bin')!.async('uint8array')).toEqual(Uint8Array.from([
      0, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 0, 0,
    ]));
    expect(await outputZip.file('buffers/unselected-proof.bin')!.async('uint8array')).toEqual(unselectedSidecar);
    const outputHtml = await outputZip.file('index.html')!.async('string');
    const marker = 'const packagedMetadataRaw = JSON.parse(`';
    const embeddedStart = outputHtml.indexOf(marker) + marker.length;
    const embeddedEnd = outputHtml.indexOf('`);', embeddedStart);
    const embedded = JSON.parse(outputHtml.slice(embeddedStart, embeddedEnd)) as WebGLExportMetadata;
    expect(embedded.layers[0].colorCycle?.brushState?.width).toBe(4);
  });

  it('preserves Uint16 bytes when an expanded definition sidecar changes length', async () => {
    const zip = new JSZip();
    const values = Uint16Array.from([1, 300, 65_535]);

    const encoded = encodeGobletPackingPayload(
      { ref: 'buffers/defs.bin', encoding: 'u8', byteLength: 4 },
      values,
      zip,
      'gradientDefIdBuffer',
    );

    expect(encoded).toEqual({ ref: 'buffers/defs.bin', encoding: 'u8', byteLength: 6 });
    expect(await zip.file('buffers/defs.bin')!.async('uint8array')).toEqual(
      new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
    );
  });

  it('rewrites the packaged metadata inside a self-contained Goblet HTML file', async () => {
    const metadata = makeMetadata();
    metadata.settings.bundleFormat = 'single-html';
    const metadataJson = JSON.stringify(metadata);
    const html = `<!doctype html><script>const packagedMetadataRaw = JSON.parse(\`${metadataJson}\`);</script>`;

    const result = await packGobletArtifactColorCycleShapes(new TextEncoder().encode(html), {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    });

    const outputHtml = new TextDecoder().decode(result.artifactData);
    const marker = 'const packagedMetadataRaw = JSON.parse(`';
    const start = outputHtml.indexOf(marker) + marker.length;
    const end = outputHtml.indexOf('`);', start);
    const outputMetadata = JSON.parse(outputHtml.slice(start, end)) as WebGLExportMetadata;
    expect(result.artifactKind).toBe('single-html');
    expect(outputMetadata.layers[0].colorCycle?.brushState?.width).toBe(4);
    expect(outputMetadata.layers[0].colorCycle?.brushState?.height).toBe(3);
    expect(outputMetadata.layers[1]).toEqual(metadata.layers[1]);
  });

  it('preserves the minified Goblet metadata schema shape', async () => {
    const metadata = makeMetadata();
    const input = new TextEncoder().encode(JSON.stringify(minify(metadata)));

    const result = await packGobletArtifactColorCycleShapes(input, {
      selectors: [{ id: 'selected' }],
      separationByLayerId: { selected: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    });

    const output = JSON.parse(new TextDecoder().decode(result.artifactData)) as Record<string, unknown>;
    expect(output.f).toBe('vessel-goblet2');
    expect(output.format).toBeUndefined();
    expect(Array.isArray(output.l)).toBe(true);
  });

  it('rejects Goblet layers that depend on source-image alpha', async () => {
    const metadata = makeMetadata();
    metadata.layers[0].assets = { texture: 'data:image/png;base64,source-alpha' };
    metadata.layers[0].colorCycle!.brushState!.alphaMode = 'source';

    await expect(packGobletArtifactColorCycleShapes(
      new TextEncoder().encode(JSON.stringify(metadata)),
      { selectors: [{ id: 'selected' }], padding: 0, rotations: [0] },
    )).rejects.toEqual(expect.objectContaining({
      code: 'unsupported-goblet-source-alpha',
    }));
  });
});
